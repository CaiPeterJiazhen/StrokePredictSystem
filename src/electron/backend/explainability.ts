import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'sql.js';
import type {
  ApiResult,
  BackendExplanationStatus,
  ExplainabilityBatchInput,
  ExplainabilityBatchResult,
  ExplainabilityCompleteResult,
  ExplainabilityPrepareResult,
  ExplainabilityRunResult,
  ExplanationArtifact,
  ExplanationFeatureDirection,
  ExplanationArtifactType,
  ExplanationOverviewRow,
  ExplanationTopFeature,
  IndexExplanationArtifactInput,
  ListExplanationArtifactsFilter,
  ListExplanationOverviewFilter,
  PredictionModel,
  RecoveryPredictionClass,
} from '../../domain/backendTypes.js';
import type { AppPaths } from './appPaths.js';
import { nowIso } from './database.js';
import { listPredictionModels, listPredictionQueue } from './predictions.js';
import { addTask, addTaskLog, completeTask, failTask } from './repositories.js';

type SqlParam = string | number | null;
type SqlRow = Record<string, unknown>;

type ExplainabilityTaskRow = {
  id: string;
  type: string;
  patient_id: string | null;
  batch_id: string | null;
  status: string;
  input_json: string;
  output_json: string;
};

type ExplainabilityManifestArtifact = {
  artifactType: ExplanationArtifactType;
  title: string;
  method?: string;
  filePath: string;
  topFeatures?: ExplanationTopFeature[];
  preview?: Record<string, unknown>;
};

type ExplainabilityExecutorConfig = {
  executablePath: string;
  scriptPath: string;
  extraArgs: string[];
};

type ExplainabilityProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type ExplainabilityExecutor = (
  executablePath: string,
  args: string[],
) => Promise<ExplainabilityProcessResult>;

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

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
}

function normalizeExplainabilityExecutorConfig(input: Record<string, unknown>): ExplainabilityExecutorConfig | null {
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

function parseJsonFile(filePath: string): Record<string, unknown> {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('解释性结果清单格式不正确。');
  }

  return parsed as Record<string, unknown>;
}

function normalizeDirection(value: unknown): ExplanationFeatureDirection | undefined {
  return value === 'positive' || value === 'negative' || value === 'neutral' ? value : undefined;
}

function parseTopFeatures(value: string): ExplanationTopFeature[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
      .map((item) => ({
        name: String(item.name ?? ''),
        score: Number(item.score ?? 0),
        modality: String(item.modality ?? ''),
        direction: normalizeDirection(item.direction),
      }))
      .filter((item) => item.name !== '');
  } catch {
    return [];
  }
}

function normalizeTopFeatures(value: unknown): ExplanationTopFeature[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      name: String(item.name ?? ''),
      score: Number(item.score ?? 0),
      modality: String(item.modality ?? ''),
      direction: normalizeDirection(item.direction),
    }))
    .filter((item) => item.name !== '');
}

function getExplainabilityTask(db: Database, taskId: string): ExplainabilityTaskRow | null {
  return queryOne<ExplainabilityTaskRow>(
    db,
    `SELECT id, type, patient_id, batch_id, status, input_json, output_json
     FROM tasks
     WHERE id = ?`,
    [taskId],
  );
}

function explanationExecutionOutputDirectory(paths: AppPaths, task: ExplainabilityTaskRow, subjectCode: string): string {
  return path.join(paths.outputsRoot, 'explainability', task.batch_id ?? 'explainability', subjectCode);
}

function quoteCommandArg(arg: string): string {
  if (!/[\\/\s]/.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/"/g, '\\"')}"`;
}

function buildExplainabilityArgs(config: ExplainabilityExecutorConfig, packagePath: string): string[] {
  return [
    ...(config.scriptPath ? [config.scriptPath] : []),
    ...config.extraArgs,
    packagePath,
  ];
}

function buildExplainabilityCommand(config: ExplainabilityExecutorConfig, packagePath: string): string {
  return [config.executablePath, ...buildExplainabilityArgs(config, packagePath)].map(quoteCommandArg).join(' ');
}

function defaultExecuteExplainability(
  executablePath: string,
  args: string[],
): Promise<ExplainabilityProcessResult> {
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

function explanationFeatureInputs(db: Database, patientId: string): Array<Record<string, unknown>> {
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
    kind: feature.kind,
    state: feature.state,
    filePath: feature.file_path,
    featureCount: feature.feature_count,
    params: parseJsonObject(feature.params_json),
  }));
}

function manifestArtifacts(manifest: Record<string, unknown>): ExplainabilityManifestArtifact[] {
  const artifacts = manifest.artifacts;

  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error('解释性结果清单未包含任何解释性文件。');
  }

  return artifacts.map((artifact, index) => {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      throw new Error(`解释性结果清单第 ${index + 1} 项格式不正确。`);
    }

    const item = artifact as Record<string, unknown>;
    const artifactType = item.artifactType;
    const title = item.title;
    const filePathValue = item.filePath;

    if (
      artifactType !== 'global_importance' &&
      artifactType !== 'patient_shap' &&
      artifactType !== 'psd_heatmap' &&
      artifactType !== 'fc_network' &&
      artifactType !== 'method_manifest'
    ) {
      throw new Error(`解释性结果清单第 ${index + 1} 项 artifactType 不支持。`);
    }

    if (typeof title !== 'string' || title.trim() === '') {
      throw new Error(`解释性结果清单第 ${index + 1} 项缺少 title。`);
    }

    if (typeof filePathValue !== 'string' || filePathValue.trim() === '') {
      throw new Error(`解释性结果清单第 ${index + 1} 项缺少 filePath。`);
    }

    return {
      artifactType,
      title,
      method: typeof item.method === 'string' ? item.method : undefined,
      filePath: filePathValue,
      topFeatures: normalizeTopFeatures(item.topFeatures),
      preview:
        item.preview && typeof item.preview === 'object' && !Array.isArray(item.preview)
          ? (item.preview as Record<string, unknown>)
          : undefined,
    };
  });
}

function failExplainabilityTask(
  db: Database,
  task: ExplainabilityTaskRow,
  message: string,
  taskId: string,
  modelId: string,
): ExplainabilityCompleteResult {
  failTask(db, task.id, message);

  if (task.patient_id) {
    ensureExplanationWorkflowStatus(db, task.patient_id, '需复核', message);
    if (taskId && modelId) {
      updatePredictionExplanationStatus(db, task.patient_id, taskId, modelId, '需复核');
    }
  }

  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'error',
    source: 'explainability',
    message,
  });

  return { ok: false, message, indexedArtifacts: 0, artifactIds: [] };
}

function fileFormat(filePath: string): string {
  return path.extname(filePath).replace(/^\./, '').toLowerCase() || 'unknown';
}

function fileSize(filePath: string): number {
  return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
}

function getModel(db: Database, taskId: string, modelId: string): PredictionModel | null {
  return listPredictionModels(db, taskId).find((model) => model.id === modelId) ?? null;
}

function getPatient(db: Database, patientId: string): { id: string; subject_code: string; name: string } | null {
  return queryOne<{ id: string; subject_code: string; name: string }>(
    db,
    'SELECT id, subject_code, name FROM patients WHERE id = ?',
    [patientId],
  );
}

function getLatestPredictionDetail(
  db: Database,
  patientId: string,
  taskId: string,
  modelId: string,
): {
  id: string;
  predicted_class: RecoveryPredictionClass;
  probability: number;
  threshold: number;
  label_definition: string;
  explanation_status: BackendExplanationStatus;
  updated_at: string;
} | null {
  return queryOne<{
    id: string;
    predicted_class: RecoveryPredictionClass;
    probability: number;
    threshold: number;
    label_definition: string;
    explanation_status: BackendExplanationStatus;
    updated_at: string;
  }>(
    db,
    `SELECT id, predicted_class, probability, threshold, label_definition, explanation_status, updated_at
     FROM prediction_results
     WHERE patient_id = ? AND task_id = ? AND model_id = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [patientId, taskId, modelId],
  );
}

function getPredictionDetailById(
  db: Database,
  predictionId: string,
  patientId: string,
  taskId: string,
  modelId: string,
): ReturnType<typeof getLatestPredictionDetail> {
  return queryOne<{
    id: string;
    predicted_class: RecoveryPredictionClass;
    probability: number;
    threshold: number;
    label_definition: string;
    explanation_status: BackendExplanationStatus;
    updated_at: string;
  }>(
    db,
    `SELECT id, predicted_class, probability, threshold, label_definition, explanation_status, updated_at
     FROM prediction_results
     WHERE id = ? AND patient_id = ? AND task_id = ? AND model_id = ?
     LIMIT 1`,
    [predictionId, patientId, taskId, modelId],
  );
}

function getLatestPredictionResult(
  db: Database,
  patientId: string,
  taskId: string,
  modelId: string,
): { id: string } | null {
  return queryOne<{ id: string }>(
    db,
    `SELECT id
     FROM prediction_results
     WHERE patient_id = ? AND task_id = ? AND model_id = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [patientId, taskId, modelId],
  );
}

function ensureExplanationWorkflowStatus(
  db: Database,
  patientId: string,
  explanationStatus: BackendExplanationStatus,
  lastError = '',
): void {
  const timestamp = nowIso();

  run(
    db,
    `INSERT OR IGNORE INTO workflow_status (
      patient_id, preprocess_status, feature_status, prediction_status, explanation_status, report_status, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [patientId, '未开始', '未开始', '未开始', explanationStatus, '未生成', lastError, timestamp],
  );
  run(
    db,
    `UPDATE workflow_status
     SET explanation_status = ?, last_error = ?, updated_at = ?
     WHERE patient_id = ?`,
    [explanationStatus, lastError, timestamp, patientId],
  );
}

function updatePredictionExplanationStatus(
  db: Database,
  patientId: string,
  taskId: string,
  modelId: string,
  explanationStatus: BackendExplanationStatus,
): void {
  const timestamp = nowIso();

  run(
    db,
    `UPDATE prediction_results
     SET explanation_status = ?, updated_at = ?
     WHERE id = (
       SELECT id
       FROM prediction_results
       WHERE patient_id = ? AND task_id = ? AND model_id = ?
       ORDER BY updated_at DESC
       LIMIT 1
     )`,
    [explanationStatus, timestamp, patientId, taskId, modelId],
  );
}

function artifactFromRow(row: {
  id: string;
  patient_id: string;
  subject_code: string;
  patient_name: string;
  task_id: string;
  model_id: string;
  model_name: string;
  model_version: string;
  artifact_type: ExplanationArtifactType;
  title: string;
  method: string;
  file_path: string;
  file_format: string;
  file_size: number;
  top_features_json: string;
  preview_json: string;
  exists_on_disk: number;
  created_at: string;
  updated_at: string;
}): ExplanationArtifact {
  return {
    id: row.id,
    patientId: row.patient_id,
    subjectCode: row.subject_code,
    patientName: row.patient_name,
    taskId: row.task_id,
    modelId: row.model_id,
    modelName: row.model_name,
    modelVersion: row.model_version,
    artifactType: row.artifact_type,
    title: row.title,
    method: row.method,
    filePath: row.file_path,
    fileFormat: row.file_format,
    fileSize: row.file_size,
    topFeatures: parseTopFeatures(row.top_features_json),
    preview: parseJsonObject(row.preview_json),
    existsOnDisk: row.exists_on_disk === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function indexExplanationArtifact(db: Database, input: IndexExplanationArtifactInput): string {
  const patient = getPatient(db, input.patientId);
  const model = getModel(db, input.taskId, input.modelId);

  if (!patient) {
    throw new Error(`Cannot index explanation artifact for missing patient: ${input.patientId}`);
  }

  if (!model) {
    throw new Error(`Cannot index explanation artifact for missing model: ${input.modelId}`);
  }

  const existing = queryOne<{ id: string; created_at: string }>(
    db,
    `SELECT id, created_at
     FROM explanation_artifacts
     WHERE patient_id = ? AND task_id = ? AND model_id = ? AND artifact_type = ? AND file_path = ?`,
    [input.patientId, input.taskId, input.modelId, input.artifactType, input.filePath],
  );
  const id = existing?.id ?? randomUUID();
  const timestamp = nowIso();
  const existsOnDisk = fs.existsSync(input.filePath);
  const status: BackendExplanationStatus = existsOnDisk ? '已生成' : '需复核';
  const lastError = existsOnDisk ? '' : `解释性文件不存在：${input.filePath}`;

  run(
    db,
    `INSERT OR REPLACE INTO explanation_artifacts (
      id, patient_id, task_id, model_id, artifact_type, title, method, file_path, file_format,
      file_size, top_features_json, preview_json, exists_on_disk, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.patientId,
      input.taskId,
      input.modelId,
      input.artifactType,
      input.title,
      input.method ?? '',
      input.filePath,
      fileFormat(input.filePath),
      fileSize(input.filePath),
      JSON.stringify(input.topFeatures ?? []),
      JSON.stringify(input.preview ?? {}),
      existsOnDisk ? 1 : 0,
      existing?.created_at ?? timestamp,
      timestamp,
    ],
  );
  ensureExplanationWorkflowStatus(db, input.patientId, status, lastError);
  updatePredictionExplanationStatus(db, input.patientId, input.taskId, input.modelId, status);
  addTaskLog(db, {
    patientId: input.patientId,
    level: existsOnDisk ? 'info' : 'warning',
    source: 'explainability',
    message: `Explanation artifact indexed: ${patient.subject_code} ${input.artifactType} ${input.filePath}`,
  });

  return id;
}

export function deleteExplanationArtifact(db: Database, artifactId: string): ApiResult {
  const artifact = queryOne<{
    id: string;
    patient_id: string;
    task_id: string;
    model_id: string;
    title: string;
  }>(
    db,
    `SELECT id, patient_id, task_id, model_id, title
     FROM explanation_artifacts
     WHERE id = ?`,
    [artifactId],
  );

  if (!artifact) {
    return { ok: false, message: '未找到解释性产物。' };
  }

  run(db, 'DELETE FROM explanation_artifacts WHERE id = ?', [artifactId]);

  const remaining = queryOne<{ count: number }>(
    db,
    `SELECT COUNT(*) AS count
     FROM explanation_artifacts
     WHERE patient_id = ? AND task_id = ? AND model_id = ?`,
    [artifact.patient_id, artifact.task_id, artifact.model_id],
  );

  if (Number(remaining?.count ?? 0) === 0) {
    ensureExplanationWorkflowStatus(db, artifact.patient_id, '未生成');
    updatePredictionExplanationStatus(db, artifact.patient_id, artifact.task_id, artifact.model_id, '未生成');
  }

  addTaskLog(db, {
    patientId: artifact.patient_id,
    level: 'info',
    source: 'explainability',
    message: `Explanation artifact deleted: ${artifact.title}`,
  });

  return { ok: true, message: `已删除解释性产物 ${artifact.title}。` };
}

export function listExplanationArtifacts(
  db: Database,
  filter: ListExplanationArtifactsFilter = {},
): ExplanationArtifact[] {
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (filter.patientId) {
    where.push('ea.patient_id = ?');
    params.push(filter.patientId);
  }

  if (filter.taskId) {
    where.push('ea.task_id = ?');
    params.push(filter.taskId);
  }

  if (filter.modelId) {
    where.push('ea.model_id = ?');
    params.push(filter.modelId);
  }

  if (filter.artifactType) {
    where.push('ea.artifact_type = ?');
    params.push(filter.artifactType);
  }

  if (filter.existsOnDisk !== undefined) {
    where.push('ea.exists_on_disk = ?');
    params.push(filter.existsOnDisk ? 1 : 0);
  }

  const rows = queryAll<Parameters<typeof artifactFromRow>[0]>(
    db,
    `SELECT
      ea.id, ea.patient_id, p.subject_code, p.name AS patient_name,
      ea.task_id, ea.model_id, pm.name AS model_name, pm.version AS model_version,
      ea.artifact_type, ea.title, ea.method, ea.file_path, ea.file_format, ea.file_size,
      ea.top_features_json, ea.preview_json, ea.exists_on_disk, ea.created_at, ea.updated_at
     FROM explanation_artifacts ea
     INNER JOIN patients p ON p.id = ea.patient_id
     INNER JOIN prediction_models pm ON pm.id = ea.model_id
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY p.subject_code,
      CASE ea.artifact_type
        WHEN 'global_importance' THEN 1
        WHEN 'patient_shap' THEN 2
        WHEN 'psd_heatmap' THEN 3
        WHEN 'fc_network' THEN 4
        ELSE 5
      END,
      ea.updated_at DESC`,
    params,
  );

  return rows.map(artifactFromRow);
}

export function listExplanationOverview(
  db: Database,
  filter: ListExplanationOverviewFilter = {},
): ExplanationOverviewRow[] {
  const taskId = filter.taskId ?? 'pr';

  return listPredictionQueue(db, { taskId, patientId: filter.patientId }).map((row) => {
    const artifactSummary = queryOne<{ artifact_count: number; latest_explanation_at: string | null }>(
      db,
      `SELECT COUNT(*) AS artifact_count, MAX(updated_at) AS latest_explanation_at
       FROM explanation_artifacts
       WHERE patient_id = ? AND task_id = ?`,
      [row.patientId, taskId],
    );
    const latestFeatures = queryOne<{ top_features_json: string }>(
      db,
      `SELECT top_features_json
       FROM explanation_artifacts
       WHERE patient_id = ? AND task_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      [row.patientId, taskId],
    );
    const topFeatureName = parseTopFeatures(latestFeatures?.top_features_json ?? '')[0]?.name ?? '';

    return {
      patientId: row.patientId,
      subjectCode: row.subjectCode,
      patientName: row.patientName,
      taskId,
      prediction: row.prediction,
      probability: row.probability,
      modelUsed: row.modelUsed,
      explanationStatus: row.explanationStatus,
      artifactCount: Number(artifactSummary?.artifact_count ?? 0),
      topFeatureName,
      latestExplanationAt: artifactSummary?.latest_explanation_at ?? null,
    };
  });
}

export function createExplainabilityBatch(
  db: Database,
  input: ExplainabilityBatchInput,
): ExplainabilityBatchResult {
  const model = getModel(db, input.taskId, input.modelId);
  const batchId = randomUUID();
  const skippedPatients: ExplainabilityBatchResult['skippedPatients'] = [];
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

  const patientIds =
    input.patientIds && input.patientIds.length > 0
      ? input.patientIds
      : queryAll<{ id: string }>(db, 'SELECT id FROM patients ORDER BY subject_code').map((row) => row.id);

  for (const patientId of patientIds) {
    const patient = getPatient(db, patientId);

    if (!patient) {
      skippedPatients.push({ patientId, reason: '患者不存在' });
      continue;
    }

    const prediction = getLatestPredictionResult(db, patientId, input.taskId, input.modelId);

    if (!prediction) {
      skippedPatients.push({ patientId, reason: '没有预测结果' });
      continue;
    }

    addTask(db, {
      type: 'explainability',
      patientId,
      batchId,
      status: 'queued',
      inputJson: JSON.stringify({
        displayName: '模型解释性分析',
        taskId: input.taskId,
        modelId: input.modelId,
        modelName: model.name,
        modelVersion: model.version,
        predictionResultId: prediction.id,
        subjectCode: patient.subject_code,
        artifactTypes: input.artifactTypes,
        executor: input.executor ?? null,
      }),
    });
    ensureExplanationWorkflowStatus(db, patientId, '生成中');
    updatePredictionExplanationStatus(db, patientId, input.taskId, input.modelId, '生成中');
    addTaskLog(db, {
      patientId,
      level: 'info',
      source: 'explainability',
      message: `Explainability queued: ${patient.subject_code} ${model.name} ${model.version}`,
    });
    queuedTasks += 1;
  }

  return {
    ok: queuedTasks > 0,
    message:
      skippedPatients.length > 0
        ? `已创建 ${queuedTasks} 个解释性任务，跳过 ${skippedPatients.length} 位患者。`
        : `已创建 ${queuedTasks} 个解释性任务。`,
    batchId,
    queuedTasks,
    skippedPatients,
  };
}

export function prepareExplainabilityExecution(
  db: Database,
  paths: AppPaths,
  taskId: string,
): ExplainabilityPrepareResult {
  const task = getExplainabilityTask(db, taskId);

  if (!task || task.type !== 'explainability') {
    return { ok: false, message: '未找到解释性任务。' };
  }

  if (!task.patient_id) {
    return { ok: false, message: '解释性任务缺少患者信息。' };
  }

  const patient = getPatient(db, task.patient_id);

  if (!patient) {
    return { ok: false, message: '解释性任务关联的患者不存在。' };
  }

  const input = parseJsonObject(task.input_json);
  const predictionTaskId = typeof input.taskId === 'string' ? input.taskId : '';
  const modelId = typeof input.modelId === 'string' ? input.modelId : '';
  const queuedPredictionResultId = typeof input.predictionResultId === 'string' ? input.predictionResultId : '';
  const model = predictionTaskId && modelId ? getModel(db, predictionTaskId, modelId) : null;
  const prediction = predictionTaskId && modelId
    ? queuedPredictionResultId
      ? getPredictionDetailById(db, queuedPredictionResultId, task.patient_id, predictionTaskId, modelId)
      : getLatestPredictionDetail(db, task.patient_id, predictionTaskId, modelId)
    : null;

  if (!predictionTaskId || !modelId || !model) {
    return { ok: false, message: '解释性任务缺少标签定义或模型信息。' };
  }

  if (!prediction) {
    return { ok: false, message: '解释性任务缺少预测结果。' };
  }

  const executor = normalizeExplainabilityExecutorConfig(input);
  const outputDirectory = explanationExecutionOutputDirectory(paths, task, patient.subject_code);
  const manifestPath = path.join(outputDirectory, 'explainability_manifest.json');
  const packagePath = path.join(outputDirectory, `${task.id}-explainability.json`);
  const command = executor ? buildExplainabilityCommand(executor, packagePath) : '';
  const args = executor ? buildExplainabilityArgs(executor, packagePath) : [];

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    packagePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        type: 'explainability_task_package',
        exportedAt: nowIso(),
        taskId: task.id,
        patientId: task.patient_id,
        subjectCode: patient.subject_code,
        batchId: task.batch_id,
        request: {
          taskId: predictionTaskId,
          modelId,
          artifactTypes: normalizeStringArray(input.artifactTypes),
          target: 'classification_logit',
          labelDefinition: prediction.label_definition,
        },
        model: {
          id: model.id,
          name: model.name,
          version: model.version,
          inputType: model.inputType,
          inputs: model.inputs,
          artifactPath: model.artifactPath,
        },
        prediction: {
          id: prediction.id,
          predictedClass: prediction.predicted_class,
          probability: prediction.probability,
          threshold: prediction.threshold,
          labelDefinition: prediction.label_definition,
          explanationStatus: prediction.explanation_status,
          updatedAt: prediction.updated_at,
        },
        inputs: {
          featureArtifacts: explanationFeatureInputs(db, task.patient_id),
        },
        outputs: {
          outputDirectory,
          manifestPath,
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
        displayName: '模型解释性分析',
        explanationPackagePath: packagePath,
        explanationOutputDirectory: outputDirectory,
        explanationManifestPath: manifestPath,
        explanationExecutablePath: executor?.executablePath ?? '',
        explanationScriptPath: executor?.scriptPath ?? '',
        explanationCommand: command,
      }),
      task.id,
    ],
  );
  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'info',
    source: 'explainability',
    message: `解释性任务包已准备: ${packagePath}`,
  });

  return {
    ok: true,
    message: `解释性任务包已准备。任务包：${packagePath}`,
    packagePath,
    outputDirectory,
    manifestPath,
    executablePath: executor?.executablePath,
    scriptPath: executor?.scriptPath,
    command,
    args,
  };
}

function failExplainabilityExecution(
  db: Database,
  task: ExplainabilityTaskRow,
  message: string,
  predictionTaskId: string,
  modelId: string,
  outputPatch: Partial<ExplainabilityRunResult> = {},
): ExplainabilityRunResult {
  const failed = failExplainabilityTask(db, task, message, predictionTaskId, modelId);

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
    indexedArtifacts: 0,
    artifactIds: [],
  };
}

export async function runExplainabilityExecution(
  db: Database,
  paths: AppPaths,
  taskId: string,
  executeExplainability: ExplainabilityExecutor = defaultExecuteExplainability,
): Promise<ExplainabilityRunResult> {
  const prepared = prepareExplainabilityExecution(db, paths, taskId);

  if (!prepared.ok) {
    return { ...prepared, indexedArtifacts: 0, artifactIds: [] };
  }

  const task = getExplainabilityTask(db, taskId);

  if (!task || task.type !== 'explainability') {
    return { ok: false, message: '未找到解释性任务。', indexedArtifacts: 0, artifactIds: [] };
  }

  if (!task.patient_id) {
    return { ok: false, message: '解释性任务缺少患者信息。', indexedArtifacts: 0, artifactIds: [] };
  }

  const input = parseJsonObject(task.input_json);
  const predictionTaskId = typeof input.taskId === 'string' && input.taskId ? input.taskId : '';
  const modelId = typeof input.modelId === 'string' && input.modelId ? input.modelId : '';

  if (!prepared.executablePath || !prepared.args) {
    const message = '解释性执行器未配置，请在任务参数中提供 executor.executablePath。';
    return failExplainabilityExecution(db, task, message, predictionTaskId, modelId, prepared);
  }

  if (!fs.existsSync(prepared.executablePath)) {
    const message = `解释性执行器不存在：${prepared.executablePath}`;
    return failExplainabilityExecution(db, task, message, predictionTaskId, modelId, prepared);
  }

  if (prepared.scriptPath && !fs.existsSync(prepared.scriptPath)) {
    const message = `解释性脚本不存在：${prepared.scriptPath}`;
    return failExplainabilityExecution(db, task, message, predictionTaskId, modelId, prepared);
  }

  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'info',
    source: 'explainability',
    message: `开始执行解释性分析: ${prepared.command}`,
  });
  db.run(
    `UPDATE tasks
     SET status = ?, started_at = ?
     WHERE id = ?`,
    ['running', nowIso(), task.id],
  );
  ensureExplanationWorkflowStatus(db, task.patient_id, '生成中');

  let processResult: ExplainabilityProcessResult;

  try {
    processResult = await executeExplainability(prepared.executablePath, prepared.args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    processResult = { exitCode: null, stdout: '', stderr: message };
  }

  const outputPatch = {
    ...prepared,
    explanationExitCode: processResult.exitCode,
    explanationStdout: processResult.stdout,
    explanationStderr: processResult.stderr,
    explanationLastRunAt: nowIso(),
    exitCode: processResult.exitCode,
    stdout: processResult.stdout,
    stderr: processResult.stderr,
  };

  if (processResult.exitCode !== 0) {
    const reason = processResult.stderr || processResult.stdout || `exitCode=${processResult.exitCode}`;
    return failExplainabilityExecution(
      db,
      getExplainabilityTask(db, task.id) ?? task,
      `解释性执行失败：${reason}`,
      predictionTaskId,
      modelId,
      outputPatch,
    );
  }

  const completion = completeExplainabilityTask(db, task.id, prepared.manifestPath ?? '');
  const completedTask = getExplainabilityTask(db, task.id);

  if (completedTask) {
    db.run(
      `UPDATE tasks
       SET output_json = ?
       WHERE id = ?`,
      [
        JSON.stringify({
          ...parseJsonObject(completedTask.output_json),
          ...outputPatch,
          indexedArtifacts: completion.indexedArtifacts,
          artifactIds: completion.artifactIds,
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

export function completeExplainabilityTask(
  db: Database,
  taskId: string,
  manifestPath: string,
): ExplainabilityCompleteResult {
  const task = getExplainabilityTask(db, taskId);

  if (!task || task.type !== 'explainability') {
    return {
      ok: false,
      message: '未找到解释性任务。',
      indexedArtifacts: 0,
      artifactIds: [],
    };
  }

  if (!task.patient_id) {
    return {
      ok: false,
      message: '解释性任务缺少患者信息。',
      indexedArtifacts: 0,
      artifactIds: [],
    };
  }

  const input = parseJsonObject(task.input_json);
  const predictionTaskId = typeof input.taskId === 'string' && input.taskId ? input.taskId : '';
  const modelId = typeof input.modelId === 'string' && input.modelId ? input.modelId : '';

  if (!predictionTaskId || !modelId) {
    return failExplainabilityTask(db, task, '解释性任务缺少标签定义或模型信息。', predictionTaskId, modelId);
  }

  if (!fs.existsSync(manifestPath)) {
    return failExplainabilityTask(db, task, `解释性结果清单不存在：${manifestPath}`, predictionTaskId, modelId);
  }

  let artifacts: ExplainabilityManifestArtifact[];

  try {
    artifacts = manifestArtifacts(parseJsonFile(manifestPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failExplainabilityTask(db, task, message, predictionTaskId, modelId);
  }

  const missingFiles = artifacts.map((artifact) => artifact.filePath).filter((filePath) => !fs.existsSync(filePath));

  if (missingFiles.length > 0) {
    return failExplainabilityTask(
      db,
      task,
      `解释性结果文件不存在：${missingFiles.join('；')}`,
      predictionTaskId,
      modelId,
    );
  }

  const artifactIds = artifacts.map((artifact) =>
    indexExplanationArtifact(db, {
      patientId: task.patient_id!,
      taskId: predictionTaskId,
      modelId,
      artifactType: artifact.artifactType,
      title: artifact.title,
      method: artifact.method,
      filePath: artifact.filePath,
      topFeatures: artifact.topFeatures,
      preview: artifact.preview,
    }),
  );
  const outputJson = JSON.stringify({
    displayName: '模型解释性分析',
    manifestPath,
    artifactIds,
    indexedArtifacts: artifactIds.length,
    completedAt: nowIso(),
  });

  completeTask(db, task.id, outputJson);
  ensureExplanationWorkflowStatus(db, task.patient_id, '已生成');
  updatePredictionExplanationStatus(db, task.patient_id, predictionTaskId, modelId, '已生成');
  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'info',
    source: 'explainability',
    message: `解释性任务已完成，已索引 ${artifactIds.length} 个解释性文件。`,
  });

  return {
    ok: true,
    message: `解释性任务已完成，已索引 ${artifactIds.length} 个解释性文件。`,
    indexedArtifacts: artifactIds.length,
    artifactIds,
  };
}

export function getExplanationArtifact(db: Database, artifactId: string): ExplanationArtifact | null {
  return listExplanationArtifacts(db).find((artifact) => artifact.id === artifactId) ?? null;
}
