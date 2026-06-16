import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'sql.js';
import type {
  BackendExplanationStatus,
  BackendWorkflowStatus,
  FeatureArtifactKind,
  FeatureArtifactState,
  ListPredictionQueueFilter,
  PredictionBatchInput,
  PredictionBatchResult,
  PredictionCheckpointMode,
  PredictionCompleteResult,
  PredictionPrepareResult,
  PredictionRunResult,
  PredictionInputType,
  PredictionModel,
  PredictionModelFamily,
  PredictionModelStatus,
  PredictionQueueRow,
  RegisterPredictionModelInput,
  RecoveryPredictionClass,
  SavePredictionResultInput,
} from '../../domain/backendTypes.js';
import type { AppPaths } from './appPaths.js';
import { nowIso } from './database.js';
import {
  MODEL_PIPELINE_CONTRACT,
  assertAffectedSideForModelPipeline,
  assertFeatureArtifactContract,
} from './modelPipelineContract.js';
import { addTask, addTaskLog, completeTask, failTask } from './repositories.js';

type SqlParam = string | number | null;
type SqlRow = Record<string, unknown>;

type PredictionTaskRow = {
  id: string;
  type: string;
  patient_id: string | null;
  batch_id: string | null;
  status: string;
  input_json: string;
  output_json: string;
};

type ParsedPredictionResult = {
  predictedClass: RecoveryPredictionClass;
  probability: number;
  threshold: number;
  labelDefinition: string;
};

type PredictionExecutorConfig = {
  executablePath: string;
  scriptPath: string;
  extraArgs: string[];
};

type PredictionProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

type PredictionFeatureInput = {
  id: string;
  kind: FeatureArtifactKind;
  state: FeatureArtifactState;
  filePath: string;
  featureCount: number;
  params: Record<string, unknown>;
};

export type PredictionExecutor = (executablePath: string, args: string[]) => Promise<PredictionProcessResult>;

const STRICT_PREDICTION_INPUTS_ERROR = '缺 PSD/FC(wPLI) EO/EC 特征或患侧信息';

const defaultPredictionModels = [
  {
    id: 'm1',
    taskId: 'pr',
    name: 'Logistic_L1_PSD_WPLI',
    version: 'paper_loso_baseline',
    modelFamily: 'traditional_ml',
    checkpointMode: 'external_script',
    inputType: 'EEG-only',
    inputs: ['PSD', 'WPLI', 'EO', 'EC'],
    validation:
      'scripts/04_train_ml_baselines.py; Acc 0.7368; BAcc 0.7333; Sens 0.8000; Spec 0.6667; Brier 0.2080',
    accuracy: 0.7368,
    balancedAccuracy: 0.7333,
    rocAuc: 0.7111,
    prAuc: 0.7754,
    status: '归档版本',
    artifactPath: '',
  },
  {
    id: 'm-no-ssl-cnn',
    taskId: 'pr',
    name: 'No_SSL_CNN',
    version: 'paper_loso_supervised',
    modelFamily: 'residual_aware_ssl_cnn',
    checkpointMode: 'fold_checkpoint_ensemble',
    inputType: 'EEG-only',
    inputs: ['PSD', 'WPLI', 'EO', 'EC'],
    validation:
      'scripts/05_train_supervised_loso.py; Acc 0.7632; BAcc 0.7567; Sens 0.8800; Spec 0.6333; Brier 0.1983',
    accuracy: 0.7632,
    balancedAccuracy: 0.7567,
    rocAuc: 0.7733,
    prAuc: 0.7535,
    status: '候选版本',
    artifactPath: '',
  },
  {
    id: 'm-barlow-cnn',
    taskId: 'pr',
    name: 'Barlow_CNN',
    version: 'paper_loso_patient_barlow',
    modelFamily: 'residual_aware_ssl_cnn',
    checkpointMode: 'fold_checkpoint_ensemble',
    inputType: 'EEG-only',
    inputs: ['PSD', 'WPLI', 'EO', 'EC', 'patient_barlow_ssl'],
    validation:
      'scripts/29_train_patient_barlow_stabilized.py; Acc 0.7895; BAcc 0.7822; Sens 0.9200; Spec 0.6444; Brier 0.1978',
    accuracy: 0.7895,
    balancedAccuracy: 0.7822,
    rocAuc: 0.7767,
    prAuc: 0.7532,
    status: '候选版本',
    artifactPath: '',
  },
  {
    id: 'm-residual-aware-cnn',
    taskId: 'pr',
    name: 'ResidualAware_CNN',
    version: 'paper_loso_no_ssl',
    modelFamily: 'residual_aware_ssl_cnn',
    checkpointMode: 'fold_checkpoint_ensemble',
    inputType: 'EEG-only',
    inputs: ['PSD', 'WPLI', 'EO', 'EC', 'residual_aware_heads'],
    validation:
      'scripts/30_train_residual_aware_patient_barlow.py --pretraining-mode no_ssl; Acc 0.8158; BAcc 0.8122; Sens 0.8800; Spec 0.7444; Brier 0.1304',
    accuracy: 0.8158,
    balancedAccuracy: 0.8122,
    rocAuc: 0.8989,
    prAuc: 0.9084,
    status: '候选版本',
    artifactPath: '',
  },
  {
    id: 'm2',
    taskId: 'pr',
    name: 'ResidualAware_SSL_CNN',
    version: 'locked_10seed_final',
    modelFamily: 'residual_aware_ssl_cnn',
    checkpointMode: 'fold_checkpoint_ensemble',
    inputType: 'EEG-only',
    inputs: ['PSD', 'WPLI', 'EO', 'EC', '10-seed LOSO ensemble'],
    validation:
      'Final locked main model; seeds 0/1/2/3/4/5/7/13/21/42; Acc 0.8474; BAcc 0.8411; Sens 0.9600; Spec 0.7223; Brier 0.1324; source final_Residual_ssl_cnn.csv',
    accuracy: 0.8474,
    balancedAccuracy: 0.8411,
    rocAuc: 0.8867,
    prAuc: 0.891,
    status: '当前版本',
    artifactPath: '',
  },
] satisfies Array<Omit<PredictionModel, 'createdAt' | 'updatedAt'>>;

const predictionTaskLabelDefinitions: Record<string, string> = {
  pr: '比例恢复 (PR) vs 恢复不良',
};

function queryAll<T extends SqlRow>(db: Database, sql: string, params: SqlParam[] = []): T[] {
  const stmt = db.prepare(sql);

  try {
    stmt.bind(params);
    const rows: T[] = [];

    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }

    return rows;
  } finally {
    stmt.free();
  }
}

function queryOne<T extends SqlRow>(db: Database, sql: string, params: SqlParam[] = []): T | null {
  return queryAll<T>(db, sql, params)[0] ?? null;
}

function run(db: Database, sql: string, params: SqlParam[] = []): void {
  db.run(sql, params);
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseJsonFile(filePath: string): Record<string, unknown> {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('预测结果文件格式不正确。');
  }

  return parsed as Record<string, unknown>;
}

function getPredictionTask(db: Database, taskId: string): PredictionTaskRow | null {
  return queryOne<PredictionTaskRow>(
    db,
    `SELECT id, type, patient_id, batch_id, status, input_json, output_json
     FROM tasks
     WHERE id = ?`,
    [taskId],
  );
}

function predictionPatientSubjectCode(db: Database, patientId: string): string | null {
  return queryOne<{ subject_code: string }>(
    db,
    'SELECT subject_code FROM patients WHERE id = ?',
    [patientId],
  )?.subject_code ?? null;
}

function patientAffectedHand(db: Database, patientId: string): string {
  return queryOne<{ affected_hand: string }>(
    db,
    'SELECT affected_hand FROM patients WHERE id = ?',
    [patientId],
  )?.affected_hand ?? '';
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
}

function predictionLabelDefinition(taskId: string): string {
  return predictionTaskLabelDefinitions[taskId] ?? taskId;
}

function isPredictionModelFamily(value: unknown): value is PredictionModelFamily {
  return value === 'traditional_ml' || value === 'residual_aware_ssl_cnn';
}

function isPredictionCheckpointMode(value: unknown): value is PredictionCheckpointMode {
  return (
    value === 'saved_deployment_model' ||
    value === 'fold_checkpoint_ensemble' ||
    value === 'deployment_checkpoint' ||
    value === 'external_script'
  );
}

function normalizeModelFamily(model: Pick<PredictionModel, 'name' | 'inputs'>): PredictionModel['modelFamily'] {
  const searchable = [model.name, ...model.inputs].join(' ');
  return /residual|barlow|ssl|cnn/i.test(searchable) ? 'residual_aware_ssl_cnn' : 'traditional_ml';
}

function normalizeCheckpointMode(
  modelFamily: PredictionModelFamily,
  value: unknown,
): PredictionModel['checkpointMode'] {
  if (isPredictionCheckpointMode(value)) {
    return value;
  }

  return modelFamily === 'residual_aware_ssl_cnn' ? 'fold_checkpoint_ensemble' : 'external_script';
}

function normalizePredictionExecutorConfig(input: Record<string, unknown>): PredictionExecutorConfig | null {
  const executor = input.executor;

  if (!executor || typeof executor !== 'object' || Array.isArray(executor)) {
    return null;
  }

  const config = executor as Record<string, unknown>;
  const executablePath = typeof config.executablePath === 'string' ? config.executablePath.trim() : '';
  const scriptPath = typeof config.scriptPath === 'string' ? config.scriptPath.trim() : '';

  if (!executablePath) {
    return null;
  }

  return {
    executablePath,
    scriptPath,
    extraArgs: normalizeStringArray(config.extraArgs),
  };
}

function predictionExecutionOutputDirectory(paths: AppPaths, task: PredictionTaskRow, subjectCode: string): string {
  return path.join(paths.outputsRoot, 'predictions', task.batch_id ?? 'prediction', subjectCode);
}

function quoteCommandArg(arg: string): string {
  if (!/[\\/\s]/.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/"/g, '\\"')}"`;
}

function buildPredictionArgs(config: PredictionExecutorConfig, packagePath: string): string[] {
  return [
    ...(config.scriptPath ? [config.scriptPath] : []),
    ...config.extraArgs,
    packagePath,
  ];
}

function buildPredictionCommand(config: PredictionExecutorConfig, packagePath: string): string {
  return [config.executablePath, ...buildPredictionArgs(config, packagePath)].map(quoteCommandArg).join(' ');
}

function defaultExecutePrediction(executablePath: string, args: string[]): Promise<PredictionProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(executablePath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      resolve({ exitCode: null, stdout, stderr: stderr || error.message });
    });
    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function predictionFeatureInputs(db: Database, patientId: string): PredictionFeatureInput[] {
  return queryAll<{
    id: string;
    kind: string;
    state: string;
    file_path: string;
    feature_count: number;
    params_json: string;
  }>(
    db,
    `SELECT id, kind, state, file_path, feature_count, params_json
     FROM feature_artifacts
     WHERE patient_id = ? AND exists_on_disk = 1
     ORDER BY kind, state, file_path`,
    [patientId],
  ).map((feature) => ({
    id: feature.id,
    kind: feature.kind as FeatureArtifactKind,
    state: feature.state as FeatureArtifactState,
    filePath: feature.file_path,
    featureCount: feature.feature_count,
    params: parseJsonObject(feature.params_json),
  }));
}

function strictPredictionFeatureInputs(db: Database, patientId: string): PredictionFeatureInput[] {
  const features = predictionFeatureInputs(db, patientId);
  const requiredPairs = [
    { kind: 'PSD', state: 'EO' },
    { kind: 'PSD', state: 'EC' },
    { kind: 'FC', state: 'EO' },
    { kind: 'FC', state: 'EC' },
  ] as const;
  const requiredFeatures: PredictionFeatureInput[] = [];

  for (const { kind, state } of requiredPairs) {
    const candidates = features.filter((item) => item.kind === kind && item.state === state);
    let contractError: Error | null = null;
    const feature = candidates.find((candidate) => {
      try {
        assertFeatureArtifactContract({
          kind: candidate.kind,
          state: candidate.state,
          params: candidate.params,
        });
        return true;
      } catch (error) {
        if (!contractError) {
          contractError = error instanceof Error ? error : new Error(String(error));
        }
        return false;
      }
    });

    if (!feature) {
      if (contractError) {
        throw contractError;
      }
      throw new Error(STRICT_PREDICTION_INPUTS_ERROR);
    }

    requiredFeatures.push(feature);
  }

  return requiredFeatures;
}

function parsePredictionResult(manifest: Record<string, unknown>): ParsedPredictionResult {
  const payload =
    manifest.prediction && typeof manifest.prediction === 'object' && !Array.isArray(manifest.prediction)
      ? (manifest.prediction as Record<string, unknown>)
      : manifest;
  const predictedClass = payload.predictedClass;
  const probability = payload.probability;
  const threshold = payload.threshold;
  const labelDefinition = payload.labelDefinition;

  if (predictedClass !== '比例恢复' && predictedClass !== '恢复不良') {
    throw new Error('预测结果类别必须是“比例恢复”或“恢复不良”。');
  }

  if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error('预测概率必须是 0 到 1 之间的数字。');
  }

  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('预测阈值必须是 0 到 1 之间的数字。');
  }

  if (typeof labelDefinition !== 'string' || labelDefinition.trim() === '') {
    throw new Error('预测结果缺少标签定义。');
  }

  return {
    predictedClass,
    probability,
    threshold,
    labelDefinition: labelDefinition.trim(),
  };
}

function failPredictionTask(db: Database, task: PredictionTaskRow, message: string): PredictionCompleteResult {
  failTask(db, task.id, message);

  if (task.patient_id) {
    ensurePredictionWorkflowStatus(db, task.patient_id, '失败', '未生成', message);
  }

  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'error',
    source: 'prediction',
    message,
  });

  return { ok: false, message, predictionId: null };
}

function ensureDefaultPredictionModels(db: Database): void {
  const timestamp = nowIso();

  for (const model of defaultPredictionModels) {
    run(
      db,
      `INSERT INTO prediction_models (
        id, task_id, name, version, model_family, checkpoint_mode, input_type, inputs_json, validation, accuracy,
        balanced_accuracy, roc_auc, pr_auc, status, artifact_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        task_id = excluded.task_id,
        name = excluded.name,
        version = excluded.version,
        model_family = excluded.model_family,
        checkpoint_mode = excluded.checkpoint_mode,
        input_type = excluded.input_type,
        inputs_json = excluded.inputs_json,
        validation = excluded.validation,
        accuracy = excluded.accuracy,
        balanced_accuracy = excluded.balanced_accuracy,
        roc_auc = excluded.roc_auc,
        pr_auc = excluded.pr_auc,
        status = excluded.status,
        artifact_path = excluded.artifact_path,
        updated_at = excluded.updated_at`,
      [
        model.id,
        model.taskId,
        model.name,
        model.version,
        model.modelFamily,
        model.checkpointMode,
        model.inputType,
        JSON.stringify(model.inputs),
        model.validation,
        model.accuracy,
        model.balancedAccuracy,
        model.rocAuc,
        model.prAuc,
        model.status,
        model.artifactPath,
        timestamp,
        timestamp,
      ],
    );
  }
}

function modelFromRow(row: {
  id: string;
  task_id: string;
  name: string;
  version: string;
  model_family: string;
  checkpoint_mode: string;
  input_type: PredictionInputType;
  inputs_json: string;
  validation: string;
  accuracy: number | null;
  balanced_accuracy: number | null;
  roc_auc: number | null;
  pr_auc: number | null;
  status: PredictionModelStatus;
  artifact_path: string;
  created_at: string;
  updated_at: string;
}): PredictionModel {
  const inputs = parseJsonArray(row.inputs_json);
  const inferredModelFamily = normalizeModelFamily({ name: row.name, inputs });
  const storedModelFamily = isPredictionModelFamily(row.model_family) ? row.model_family : null;
  const modelFamily =
    storedModelFamily === 'traditional_ml' && inferredModelFamily === 'residual_aware_ssl_cnn'
      ? inferredModelFamily
      : (storedModelFamily ?? inferredModelFamily);
  const checkpointMode =
    modelFamily === 'residual_aware_ssl_cnn' &&
    row.model_family === 'traditional_ml' &&
    row.checkpoint_mode === 'external_script'
      ? 'fold_checkpoint_ensemble'
      : normalizeCheckpointMode(modelFamily, row.checkpoint_mode);

  return {
    id: row.id,
    taskId: row.task_id,
    name: row.name,
    version: row.version,
    modelFamily,
    checkpointMode,
    inputType: row.input_type,
    inputs,
    validation: row.validation,
    accuracy: row.accuracy,
    balancedAccuracy: row.balanced_accuracy,
    rocAuc: row.roc_auc,
    prAuc: row.pr_auc,
    status: row.status,
    artifactPath: row.artifact_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ensurePredictionWorkflowStatus(
  db: Database,
  patientId: string,
  predictionStatus: BackendWorkflowStatus,
  explanationStatus: BackendExplanationStatus = '未生成',
  lastError = '',
): void {
  const timestamp = nowIso();

  run(
    db,
    `INSERT OR IGNORE INTO workflow_status (
      patient_id, preprocess_status, feature_status, prediction_status, explanation_status, report_status, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [patientId, '未开始', '未开始', predictionStatus, explanationStatus, '未生成', lastError, timestamp],
  );
  run(
    db,
    `UPDATE workflow_status
     SET prediction_status = ?, explanation_status = ?, last_error = ?, updated_at = ?
     WHERE patient_id = ?`,
    [predictionStatus, explanationStatus, lastError, timestamp, patientId],
  );
}

function hasEegFeatures(db: Database, patientId: string): boolean {
  const row = queryOne<{ feature_count: number }>(
    db,
    `SELECT COUNT(*) AS feature_count
     FROM feature_artifacts
     WHERE patient_id = ? AND exists_on_disk = 1 AND kind IN ('PSD', 'FC')`,
    [patientId],
  );

  return Number(row?.feature_count ?? 0) > 0;
}

function hasClinicalData(db: Database, patientId: string): boolean {
  const row = queryOne<{ clinical_count: number }>(
    db,
    'SELECT COUNT(*) AS clinical_count FROM clinical_metrics WHERE patient_id = ?',
    [patientId],
  );

  return Number(row?.clinical_count ?? 0) > 0;
}

function listPatientIds(db: Database): string[] {
  return queryAll<{ id: string }>(db, 'SELECT id FROM patients ORDER BY subject_code').map((row) => row.id);
}

function getPredictionModel(db: Database, taskId: string, modelId: string): PredictionModel | null {
  return listPredictionModels(db, taskId).find((model) => model.id === modelId) ?? null;
}

function assertFiniteMetric(value: number | null | undefined, label: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} 必须是 0 到 1 之间的数字。`);
  }

  return value;
}

function normalizePredictionModelStatus(value: PredictionModelStatus | undefined): PredictionModelStatus {
  return value === '当前版本' || value === '候选版本' || value === '归档版本' ? value : '候选版本';
}

function requireNonEmptyModelText(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label}不能为空。`);
  }

  return normalized;
}

export function registerPredictionModel(db: Database, input: RegisterPredictionModelInput): PredictionModel {
  ensureDefaultPredictionModels(db);

  const taskId = requireNonEmptyModelText(input.taskId, '标签任务');
  const name = requireNonEmptyModelText(input.name, '模型名称');
  const version = requireNonEmptyModelText(input.version, '模型版本');
  const artifactPath = requireNonEmptyModelText(input.artifactPath, '模型文件路径');

  if (input.inputType !== 'EEG-only' && input.inputType !== 'EEG+Clinical') {
    throw new Error('模型输入类型必须是 EEG-only 或 EEG+Clinical。');
  }

  if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
    throw new Error(`模型文件不存在：${artifactPath}`);
  }

  const existing = queryOne<{ id: string; created_at: string }>(
    db,
    'SELECT id, created_at FROM prediction_models WHERE task_id = ? AND name = ? AND version = ?',
    [taskId, name, version],
  );
  const timestamp = nowIso();
  const id = existing?.id ?? randomUUID();
  const inputs = input.inputs.filter((item) => item.trim() !== '').map((item) => item.trim());
  const modelFamily = isPredictionModelFamily(input.modelFamily)
    ? input.modelFamily
    : normalizeModelFamily({ name, inputs });
  const checkpointMode = normalizeCheckpointMode(modelFamily, input.checkpointMode);

  run(
    db,
    `INSERT INTO prediction_models (
      id, task_id, name, version, model_family, checkpoint_mode, input_type, inputs_json, validation, accuracy,
      balanced_accuracy, roc_auc, pr_auc, status, artifact_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      task_id = excluded.task_id,
      name = excluded.name,
      version = excluded.version,
      model_family = excluded.model_family,
      checkpoint_mode = excluded.checkpoint_mode,
      input_type = excluded.input_type,
      inputs_json = excluded.inputs_json,
      validation = excluded.validation,
      accuracy = excluded.accuracy,
      balanced_accuracy = excluded.balanced_accuracy,
      roc_auc = excluded.roc_auc,
      pr_auc = excluded.pr_auc,
      status = excluded.status,
      artifact_path = excluded.artifact_path,
      updated_at = excluded.updated_at`,
    [
      id,
      taskId,
      name,
      version,
      modelFamily,
      checkpointMode,
      input.inputType,
      JSON.stringify(inputs),
      input.validation?.trim() ?? '',
      assertFiniteMetric(input.accuracy, 'Accuracy'),
      assertFiniteMetric(input.balancedAccuracy, 'Balanced accuracy'),
      assertFiniteMetric(input.rocAuc, 'ROC AUC'),
      assertFiniteMetric(input.prAuc, 'PR AUC'),
      normalizePredictionModelStatus(input.status),
      artifactPath,
      existing?.created_at ?? timestamp,
      timestamp,
    ],
  );

  const model = queryOne<Parameters<typeof modelFromRow>[0]>(
    db,
    `SELECT id, task_id, name, version, model_family, checkpoint_mode, input_type, inputs_json, validation, accuracy,
      balanced_accuracy, roc_auc, pr_auc, status, artifact_path, created_at, updated_at
     FROM prediction_models
     WHERE id = ?`,
    [id],
  );

  if (!model) {
    throw new Error('Failed to register prediction model.');
  }

  return modelFromRow(model);
}

export function listPredictionModels(db: Database, taskId?: string): PredictionModel[] {
  ensureDefaultPredictionModels(db);
  const params: SqlParam[] = [];
  const where = taskId ? 'WHERE task_id = ?' : '';

  if (taskId) {
    params.push(taskId);
  }

  const rows = queryAll<{
    id: string;
    task_id: string;
    name: string;
    version: string;
    model_family: string;
    checkpoint_mode: string;
    input_type: PredictionInputType;
    inputs_json: string;
    validation: string;
    accuracy: number | null;
    balanced_accuracy: number | null;
    roc_auc: number | null;
    pr_auc: number | null;
    status: PredictionModelStatus;
    artifact_path: string;
    created_at: string;
    updated_at: string;
  }>(
    db,
    `SELECT id, task_id, name, version, model_family, checkpoint_mode, input_type, inputs_json, validation, accuracy,
      balanced_accuracy, roc_auc, pr_auc, status, artifact_path, created_at, updated_at
     FROM prediction_models
     ${where}
     ORDER BY task_id, CASE status WHEN '当前版本' THEN 1 WHEN '候选版本' THEN 2 ELSE 3 END, name, version`,
    params,
  );

  return rows.map(modelFromRow);
}

export function createPredictionBatch(db: Database, input: PredictionBatchInput): PredictionBatchResult {
  const model = getPredictionModel(db, input.taskId, input.modelId);
  const batchId = randomUUID();
  const skippedPatients: PredictionBatchResult['skippedPatients'] = [];
  let queuedTasks = 0;

  if (!model) {
    return {
      ok: false,
      message: '未找到与当前标签定义匹配的模型。',
      batchId,
      queuedTasks: 0,
      skippedPatients: [],
    };
  }

  for (const patientId of input.patientIds?.length ? input.patientIds : listPatientIds(db)) {
    const patient = queryOne<{ id: string; subject_code: string }>(
      db,
      'SELECT id, subject_code FROM patients WHERE id = ?',
      [patientId],
    );

    if (!patient) {
      skippedPatients.push({ patientId, reason: '患者不存在' });
      continue;
    }

    try {
      assertAffectedSideForModelPipeline(patientAffectedHand(db, patientId));
      strictPredictionFeatureInputs(db, patientId);
    } catch {
      skippedPatients.push({ patientId, reason: STRICT_PREDICTION_INPUTS_ERROR });
      continue;
    }

    if (model.inputType === 'EEG+Clinical' && !hasClinicalData(db, patientId)) {
      skippedPatients.push({ patientId, reason: '缺临床数据' });
      continue;
    }

    addTask(db, {
      type: 'prediction',
      patientId,
      batchId,
      status: 'queued',
      inputJson: JSON.stringify({
        displayName: '批量预测',
        taskId: input.taskId,
        modelId: input.modelId,
        modelName: model.name,
        modelVersion: model.version,
        inputType: model.inputType,
        labelDefinition: predictionLabelDefinition(input.taskId),
        subjectCode: patient.subject_code,
        executor: input.executor ?? null,
      }),
    });
    ensurePredictionWorkflowStatus(db, patientId, '待处理');
    addTaskLog(db, {
      patientId,
      level: 'info',
      source: 'prediction',
      message: `Prediction queued: ${patient.subject_code} ${model.name} ${model.version}`,
    });
    queuedTasks += 1;
  }

  return {
    ok: queuedTasks > 0,
    message:
      skippedPatients.length > 0
        ? `已创建 ${queuedTasks} 个预测任务，跳过 ${skippedPatients.length} 位患者。`
        : `已创建 ${queuedTasks} 个预测任务。`,
    batchId,
    queuedTasks,
    skippedPatients,
  };
}

export function savePredictionResult(db: Database, input: SavePredictionResultInput): string {
  const patient = queryOne<{ id: string; subject_code: string }>(
    db,
    'SELECT id, subject_code FROM patients WHERE id = ?',
    [input.patientId],
  );
  const model = getPredictionModel(db, input.taskId, input.modelId);

  if (!patient) {
    throw new Error(`Cannot save prediction for missing patient: ${input.patientId}`);
  }

  if (!model) {
    throw new Error(`Cannot save prediction for missing model: ${input.modelId}`);
  }

  const id = randomUUID();
  const timestamp = nowIso();

  run(
    db,
    `INSERT INTO prediction_results (
      id, patient_id, task_id, model_id, predicted_class, probability, threshold,
      label_definition, explanation_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.patientId,
      input.taskId,
      input.modelId,
      input.predictedClass,
      input.probability,
      input.threshold,
      input.labelDefinition,
      '未生成',
      timestamp,
      timestamp,
    ],
  );
  ensurePredictionWorkflowStatus(db, input.patientId, '已完成', '未生成');
  addTaskLog(db, {
    patientId: input.patientId,
    level: 'info',
    source: 'prediction',
    message: `Prediction saved: ${patient.subject_code} ${input.predictedClass} ${input.probability}`,
  });

  return id;
}

export function preparePredictionExecution(
  db: Database,
  paths: AppPaths,
  taskId: string,
): PredictionPrepareResult {
  const task = getPredictionTask(db, taskId);

  if (!task || task.type !== 'prediction') {
    return { ok: false, message: '未找到预测任务。' };
  }

  if (!task.patient_id) {
    return { ok: false, message: '预测任务缺少患者信息。' };
  }

  const subjectCode = predictionPatientSubjectCode(db, task.patient_id);

  if (!subjectCode) {
    return { ok: false, message: '预测任务关联的患者不存在。' };
  }

  const input = parseJsonObject(task.input_json);
  const taskName = typeof input.taskId === 'string' ? input.taskId : '';
  const modelId = typeof input.modelId === 'string' ? input.modelId : '';
  const model = taskName && modelId ? getPredictionModel(db, taskName, modelId) : null;
  const labelDefinition =
    typeof input.labelDefinition === 'string' && input.labelDefinition.trim()
      ? input.labelDefinition.trim()
      : predictionLabelDefinition(taskName);

  if (!taskName || !modelId || !model) {
    return { ok: false, message: '预测任务缺少标签定义或模型信息。' };
  }

  if (model.artifactPath && (!fs.existsSync(model.artifactPath) || !fs.statSync(model.artifactPath).isFile())) {
    return { ok: false, message: `预测模型文件不存在：${model.artifactPath}` };
  }

  let affectedSide: ReturnType<typeof assertAffectedSideForModelPipeline>;
  let featureArtifacts: PredictionFeatureInput[];

  try {
    affectedSide = assertAffectedSideForModelPipeline(patientAffectedHand(db, task.patient_id));
    featureArtifacts = strictPredictionFeatureInputs(db, task.patient_id);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  const featureArtifactIds = featureArtifacts.map((feature) => feature.id);
  const executor = normalizePredictionExecutorConfig(input);
  const outputDirectory = predictionExecutionOutputDirectory(paths, task, subjectCode);
  const packagePath = path.join(outputDirectory, `${task.id}-prediction.json`);
  const resultPath = path.join(outputDirectory, `${task.id}-prediction-result.json`);
  const command = executor ? buildPredictionCommand(executor, packagePath) : '';
  const args = executor ? buildPredictionArgs(executor, packagePath) : [];

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    packagePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        type: 'prediction_task_package',
        exportedAt: nowIso(),
        taskId: task.id,
        patientId: task.patient_id,
        subjectCode,
        batchId: task.batch_id,
        request: {
          taskId: taskName,
          modelId,
          labelDefinition,
        },
        contract: {
          requiredStates: MODEL_PIPELINE_CONTRACT.requiredStates,
          requiredFeatureKinds: ['PSD', 'FC'],
          fcMetric: MODEL_PIPELINE_CONTRACT.wpliMetric,
          alignment: MODEL_PIPELINE_CONTRACT.alignment,
          affectedSide,
        },
        model: {
          id: model.id,
          name: model.name,
          version: model.version,
          modelFamily: model.modelFamily,
          checkpointMode: model.checkpointMode,
          inputType: model.inputType,
          inputs: model.inputs,
          artifactPath: model.artifactPath,
        },
        inputs: {
          featureArtifacts,
          featureArtifactIds,
        },
        outputs: {
          outputDirectory,
          resultPath,
        },
        executor: executor
          ? {
              executablePath: executor.executablePath,
              scriptPath: executor.scriptPath,
              args,
              command,
            }
          : null,
      },
      null,
      2,
    ),
  );

  db.run(
    `UPDATE tasks
     SET output_json = ?
     WHERE id = ?`,
    [
      JSON.stringify({
        displayName: '批量预测',
        predictionPackagePath: packagePath,
        predictionOutputDirectory: outputDirectory,
        predictionResultPath: resultPath,
        predictionExecutablePath: executor?.executablePath ?? '',
        predictionScriptPath: executor?.scriptPath ?? '',
        predictionCommand: command,
      }),
      task.id,
    ],
  );
  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'info',
    source: 'prediction',
    message: `预测任务包已准备: ${packagePath}`,
  });

  return {
    ok: true,
    message: `预测任务包已准备。任务包：${packagePath}`,
    packagePath,
    outputDirectory,
    resultPath,
    executablePath: executor?.executablePath,
    scriptPath: executor?.scriptPath,
    command,
    args,
  };
}

function failPredictionExecution(
  db: Database,
  task: PredictionTaskRow,
  message: string,
  outputPatch: Partial<PredictionRunResult> = {},
): PredictionRunResult {
  const failed = failPredictionTask(db, task, message);

  db.run(
    `UPDATE tasks
     SET output_json = ?
     WHERE id = ?`,
    [JSON.stringify({ ...parseJsonObject(task.output_json), ...outputPatch }), task.id],
  );

  return {
    ...outputPatch,
    ok: failed.ok,
    message: failed.message,
    predictionId: failed.predictionId,
  };
}

export async function runPredictionExecution(
  db: Database,
  paths: AppPaths,
  taskId: string,
  executePrediction: PredictionExecutor = defaultExecutePrediction,
): Promise<PredictionRunResult> {
  const prepared = preparePredictionExecution(db, paths, taskId);

  if (!prepared.ok) {
    return { ...prepared, predictionId: null };
  }

  const task = getPredictionTask(db, taskId);

  if (!task || task.type !== 'prediction') {
    return { ok: false, message: '未找到预测任务。', predictionId: null };
  }

  if (!task.patient_id) {
    return { ok: false, message: '预测任务缺少患者信息。', predictionId: null };
  }

  if (!prepared.executablePath || !prepared.args) {
    const message = '预测执行器未配置，请在任务参数中提供 executor.executablePath。';
    return failPredictionExecution(db, task, message, prepared);
  }

  if (!fs.existsSync(prepared.executablePath)) {
    const message = `预测执行器不存在：${prepared.executablePath}`;
    return failPredictionExecution(db, task, message, prepared);
  }

  if (prepared.scriptPath && !fs.existsSync(prepared.scriptPath)) {
    const message = `预测脚本不存在：${prepared.scriptPath}`;
    return failPredictionExecution(db, task, message, prepared);
  }

  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'info',
    source: 'prediction',
    message: `开始执行预测: ${prepared.command}`,
  });
  db.run(
    `UPDATE tasks
     SET status = ?, started_at = ?
     WHERE id = ?`,
    ['running', nowIso(), task.id],
  );
  ensurePredictionWorkflowStatus(db, task.patient_id, '处理中');

  let processResult: PredictionProcessResult;

  try {
    processResult = await executePrediction(prepared.executablePath, prepared.args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    processResult = { exitCode: null, stdout: '', stderr: message };
  }

  const outputPatch = {
    ...prepared,
    predictionExitCode: processResult.exitCode,
    predictionStdout: processResult.stdout,
    predictionStderr: processResult.stderr,
    predictionLastRunAt: nowIso(),
    exitCode: processResult.exitCode,
    stdout: processResult.stdout,
    stderr: processResult.stderr,
  };

  if (processResult.exitCode !== 0) {
    const reason = processResult.stderr || processResult.stdout || `exitCode=${processResult.exitCode}`;
    return failPredictionExecution(db, getPredictionTask(db, task.id) ?? task, `预测执行失败：${reason}`, outputPatch);
  }

  const completion = completePredictionTask(db, task.id, prepared.resultPath ?? '');
  const completedTask = getPredictionTask(db, task.id);

  if (completedTask) {
    db.run(
      `UPDATE tasks
       SET output_json = ?
       WHERE id = ?`,
      [
        JSON.stringify({
          ...parseJsonObject(completedTask.output_json),
          ...outputPatch,
          predictionId: completion.predictionId,
        }),
        task.id,
      ],
    );
  }

  return {
    ...prepared,
    ...completion,
    exitCode: processResult.exitCode,
    stdout: processResult.stdout,
    stderr: processResult.stderr,
  };
}

export function completePredictionTask(
  db: Database,
  taskId: string,
  resultPath: string,
): PredictionCompleteResult {
  const task = getPredictionTask(db, taskId);

  if (!task || task.type !== 'prediction') {
    return {
      ok: false,
      message: '未找到预测任务。',
      predictionId: null,
    };
  }

  if (!task.patient_id) {
    return {
      ok: false,
      message: '预测任务缺少患者信息。',
      predictionId: null,
    };
  }

  if (!fs.existsSync(resultPath)) {
    return failPredictionTask(db, task, `预测结果文件不存在：${resultPath}`);
  }

  const input = parseJsonObject(task.input_json);
  const taskName = typeof input.taskId === 'string' && input.taskId ? input.taskId : '';
  const modelId = typeof input.modelId === 'string' && input.modelId ? input.modelId : '';
  const expectedLabelDefinition =
    typeof input.labelDefinition === 'string' && input.labelDefinition.trim()
      ? input.labelDefinition.trim()
      : predictionLabelDefinition(taskName);

  if (!taskName || !modelId) {
    return failPredictionTask(db, task, '预测任务缺少标签定义或模型信息。');
  }

  let prediction: ParsedPredictionResult;

  try {
    prediction = parsePredictionResult(parseJsonFile(resultPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failPredictionTask(db, task, message);
  }

  if (prediction.labelDefinition !== expectedLabelDefinition) {
    return failPredictionTask(
      db,
      task,
      `预测结果标签定义不匹配：期望“${expectedLabelDefinition}”，实际“${prediction.labelDefinition}”。`,
    );
  }

  const predictionId = savePredictionResult(db, {
    patientId: task.patient_id,
    taskId: taskName,
    modelId,
    predictedClass: prediction.predictedClass,
    probability: prediction.probability,
    threshold: prediction.threshold,
    labelDefinition: prediction.labelDefinition,
  });
  const outputJson = JSON.stringify({
    displayName: '批量预测',
    resultPath,
    predictionId,
    predictedClass: prediction.predictedClass,
    probability: prediction.probability,
    threshold: prediction.threshold,
    completedAt: nowIso(),
  });

  completeTask(db, task.id, outputJson);
  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'info',
    source: 'prediction',
    message: `预测任务已完成：${prediction.predictedClass} ${prediction.probability}。`,
  });

  return {
    ok: true,
    message: `预测任务已完成：${prediction.predictedClass} ${prediction.probability}。`,
    predictionId,
  };
}

export function listPredictionQueue(
  db: Database,
  filter: ListPredictionQueueFilter = {},
): PredictionQueueRow[] {
  ensureDefaultPredictionModels(db);
  const taskId = filter.taskId ?? 'pr';
  const patients = queryAll<{
    patient_id: string;
    subject_code: string;
    patient_name: string;
    prediction_status: BackendWorkflowStatus;
    feature_count: number;
    clinical_count: number;
  }>(
    db,
    `SELECT
      p.id AS patient_id,
      p.subject_code,
      p.name AS patient_name,
      COALESCE(ws.prediction_status, '未开始') AS prediction_status,
      COUNT(DISTINCT CASE WHEN fa.exists_on_disk = 1 AND fa.kind IN ('PSD', 'FC') THEN fa.id END) AS feature_count,
      COUNT(DISTINCT cm.source_workbook) AS clinical_count
     FROM patients p
     LEFT JOIN workflow_status ws ON ws.patient_id = p.id
     LEFT JOIN feature_artifacts fa ON fa.patient_id = p.id
     LEFT JOIN clinical_metrics cm ON cm.patient_id = p.id
     ${filter.patientId ? 'WHERE p.id = ?' : ''}
     GROUP BY p.id, p.subject_code, p.name, ws.prediction_status
     ORDER BY p.subject_code`,
    filter.patientId ? [filter.patientId] : [],
  );

  return patients.map((patient) => {
    const result = queryOne<{
      predicted_class: RecoveryPredictionClass;
      probability: number;
      explanation_status: BackendExplanationStatus;
      updated_at: string;
      model_name: string;
      model_version: string;
    }>(
      db,
      `SELECT pr.predicted_class, pr.probability, pr.explanation_status, pr.updated_at,
        pm.name AS model_name, pm.version AS model_version
       FROM prediction_results pr
       INNER JOIN prediction_models pm ON pm.id = pr.model_id
       WHERE pr.patient_id = ? AND pr.task_id = ?
       ORDER BY pr.updated_at DESC
       LIMIT 1`,
      [patient.patient_id, taskId],
    );

    return {
      patientId: patient.patient_id,
      subjectCode: patient.subject_code,
      patientName: patient.patient_name,
      taskId,
      hasEegFeatures: Number(patient.feature_count ?? 0) > 0,
      hasClinical: Number(patient.clinical_count ?? 0) > 0,
      prediction: result?.predicted_class ?? null,
      probability: result?.probability ?? null,
      modelUsed: result ? `${result.model_name} ${result.model_version}` : '-',
      status: result ? '已完成' : patient.prediction_status,
      explanationStatus: result?.explanation_status ?? '未生成',
      submittedAt: result?.updated_at ?? '',
    };
  });
}
