import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'sql.js';
import type {
  BackendWorkflowStatus,
  FeatureArtifact,
  FeatureArtifactKind,
  FeatureArtifactOverviewRow,
  FeatureArtifactState,
  FeatureGenerationBatchInput,
  FeatureGenerationBatchResult,
  FeatureGenerationCompleteResult,
  FeatureGenerationPrepareResult,
  FeatureGenerationRunResult,
  IndexFeatureArtifactInput,
  ListFeatureArtifactsFilter,
} from '../../domain/backendTypes.js';
import type { AppPaths } from './appPaths.js';
import { nowIso } from './database.js';
import { assertFeatureArtifactContract, buildFeatureGenerationContract } from './modelPipelineContract.js';
import { addTask, addTaskLog, completeTask, failTask } from './repositories.js';

type SqlParam = string | number | null;
type SqlRow = Record<string, unknown>;

type FeatureGenerationTaskRow = {
  id: string;
  type: string;
  patient_id: string | null;
  batch_id: string | null;
  status: string;
  input_json: string;
  output_json: string;
};

type FeatureGenerationPatient = {
  subjectCode: string;
  affectedHand: string;
};

type FeatureInputAsset = {
  id?: unknown;
  source?: unknown;
  stage?: unknown;
  assetType?: unknown;
  filePath?: unknown;
  existsOnDisk?: unknown;
};

type FeatureEegStatePair = {
  state: 'EO' | 'EC';
  setPath: string;
  fdtPath: string;
  setAssetId?: unknown;
  fdtAssetId?: unknown;
  source?: unknown;
  stage?: unknown;
};

type FeatureManifestArtifact = {
  kind: FeatureArtifactKind;
  state?: FeatureArtifactState;
  filePath: string;
  featureCount?: number;
  params?: Record<string, unknown>;
  preview?: Record<string, unknown>;
};

type FeatureExecutorConfig = {
  executablePath: string;
  scriptPath: string;
  extraArgs: string[];
};

type FeatureGeneratorProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type FeatureGeneratorExecutor = (
  executablePath: string,
  args: string[],
) => Promise<FeatureGeneratorProcessResult>;

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

function safeJson(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {});
}

function parseJson(value: string): Record<string, unknown> {
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
    throw new Error('特征结果清单格式不正确。');
  }

  return parsed as Record<string, unknown>;
}

function fileFormat(filePath: string): string {
  return path.extname(filePath).replace(/^\./, '').toLowerCase() || 'unknown';
}

function fileSize(filePath: string): number {
  return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
}

function ensureFeatureWorkflowStatus(
  db: Database,
  patientId: string,
  featureStatus: BackendWorkflowStatus,
  lastError = '',
): void {
  const timestamp = nowIso();

  run(
    db,
    `INSERT OR IGNORE INTO workflow_status (
      patient_id, preprocess_status, feature_status, prediction_status, explanation_status, report_status, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [patientId, '未开始', featureStatus, '未开始', '未生成', '未生成', lastError, timestamp],
  );
  run(
    db,
    `UPDATE workflow_status
     SET feature_status = ?, last_error = ?, updated_at = ?
     WHERE patient_id = ?`,
    [featureStatus, lastError, timestamp, patientId],
  );
}

function getFeatureGenerationTask(db: Database, taskId: string): FeatureGenerationTaskRow | null {
  return queryOne<FeatureGenerationTaskRow>(
    db,
    `SELECT id, type, patient_id, batch_id, status, input_json, output_json
     FROM tasks
     WHERE id = ?`,
    [taskId],
  );
}

function featureGenerationPatient(db: Database, patientId: string): FeatureGenerationPatient | null {
  const patient = queryOne<{ subject_code: string; affected_hand: string }>(
    db,
    'SELECT subject_code, affected_hand FROM patients WHERE id = ?',
    [patientId],
  );

  return patient ? { subjectCode: patient.subject_code, affectedHand: patient.affected_hand } : null;
}

function featureTaskRequest(task: FeatureGenerationTaskRow): Record<string, unknown> {
  return parseJson(task.input_json);
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
}

function normalizeFeatureExecutorConfig(params: Record<string, unknown>): FeatureExecutorConfig | null {
  const executor = params.executor;

  if (!executor || typeof executor !== 'object' || Array.isArray(executor)) {
    return null;
  }

  const config = executor as Record<string, unknown>;
  const executablePath = typeof config.executablePath === 'string' ? config.executablePath.trim() : '';
  const scriptPath = typeof config.scriptPath === 'string' ? config.scriptPath.trim() : '';
  const extraArgs = normalizeStringArray(config.extraArgs);

  if (!executablePath) {
    return null;
  }

  return {
    executablePath,
    scriptPath,
    extraArgs,
  };
}

function featureExecutionOutputDirectory(paths: AppPaths, task: FeatureGenerationTaskRow, subjectCode: string): string {
  return path.join(paths.outputsRoot, 'features', task.batch_id ?? 'feature_generation', subjectCode);
}

function quoteCommandArg(arg: string): string {
  if (!/[\\/\s]/.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/"/g, '\\"')}"`;
}

function buildFeatureGenerationArgs(config: FeatureExecutorConfig, packagePath: string): string[] {
  return [
    ...(config.scriptPath ? [config.scriptPath] : []),
    ...config.extraArgs,
    packagePath,
  ];
}

function buildFeatureGenerationCommand(config: FeatureExecutorConfig, packagePath: string): string {
  return [config.executablePath, ...buildFeatureGenerationArgs(config, packagePath)].map(quoteCommandArg).join(' ');
}

function defaultExecuteFeatureGenerator(
  executablePath: string,
  args: string[],
): Promise<FeatureGeneratorProcessResult> {
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

function featureAssetKey(filePath: string): string {
  return path.normalize(filePath).toLowerCase();
}

function featureSetStem(filePath: string): string {
  return path.join(path.dirname(filePath), path.basename(filePath, path.extname(filePath))).toLowerCase();
}

function eegStateFromName(value: string): FeatureArtifactState {
  const stem = value.toLowerCase().replace(/_preprocessed_final$/, '');
  if (/1$|_eo$|-eo$/.test(stem)) return 'EO';
  if (/2$|_ec$|-ec$/.test(stem)) return 'EC';
  return 'UNKNOWN';
}

function eegStateFromParentSegment(value: string): FeatureArtifactState {
  const segment = value.toLowerCase();
  if (/^eo$|_eo$|-eo$/.test(segment) || /^sub\d*1$/.test(segment)) return 'EO';
  if (/^ec$|_ec$|-ec$/.test(segment) || /^sub\d*2$/.test(segment)) return 'EC';
  return 'UNKNOWN';
}

function eegStateFromFilePath(filePath: string): FeatureArtifactState {
  const fileStemState = eegStateFromName(path.basename(filePath, path.extname(filePath)));

  if (fileStemState !== 'UNKNOWN') {
    return fileStemState;
  }

  const pathSegments = path.dirname(filePath).split(/[\\/]+/).filter(Boolean).reverse();

  for (const segment of pathSegments) {
    const segmentState = eegStateFromParentSegment(segment);
    if (segmentState !== 'UNKNOWN') {
      return segmentState;
    }
  }

  return 'UNKNOWN';
}

function dataLibraryFeatureInputAssets(db: Database, patientId: string): Array<Record<string, unknown>> {
  return queryAll<{
    id: string;
    stage: string;
    asset_type: string;
    file_path: string;
    exists_on_disk: number;
  }>(
    db,
    `SELECT id, stage, asset_type, file_path, exists_on_disk
     FROM data_assets
     WHERE patient_id = ?
      AND exists_on_disk = 1
      AND asset_type IN ('processed_eeg_set', 'processed_eeg_fdt')
     ORDER BY stage, asset_type, file_path`,
    [patientId],
  )
    .filter((asset) => fs.existsSync(asset.file_path))
    .map((asset) => ({
      id: asset.id,
      source: 'data_library',
      stage: asset.stage,
      assetType: asset.asset_type,
      filePath: asset.file_path,
      existsOnDisk: asset.exists_on_disk === 1,
    }));
}

function preprocessOutputFeatureInputAssets(
  db: Database,
  paths: AppPaths,
  patientId: string,
): Array<Record<string, unknown>> {
  const tasks = queryAll<FeatureGenerationTaskRow>(
    db,
    `SELECT id, type, patient_id, batch_id, status, input_json, output_json
     FROM tasks
     WHERE type = 'preprocess'
      AND patient_id = ?
      AND status = 'completed'
     ORDER BY finished_at DESC, created_at DESC`,
    [patientId],
  );
  const assets: Array<Record<string, unknown>> = [];

  for (const task of tasks) {
    const taskPackage = parseJson(task.input_json);
    const rawFiles = Array.isArray(taskPackage.baselineRawCntFiles)
      ? taskPackage.baselineRawCntFiles.filter((filePath): filePath is string => typeof filePath === 'string')
      : [];
    const batchId =
      task.batch_id ?? (typeof taskPackage.batchId === 'string' && taskPackage.batchId ? taskPackage.batchId : 'manual');
    const outputRoot = path.join(paths.outputsRoot, 'preprocess', batchId, 'processed', patientId);

    for (const rawFile of rawFiles) {
      const rawBaseName = path.basename(rawFile, path.extname(rawFile));
      const finalSetPath = path.join(outputRoot, `${rawBaseName}_preprocessed_final.set`);
      const finalFdtPath = path.join(outputRoot, `${rawBaseName}_preprocessed_final.fdt`);

      if (fs.existsSync(finalSetPath)) {
        assets.push({
          id: `${task.id}:final_set:${featureAssetKey(finalSetPath)}`,
          source: 'preprocess_output',
          taskId: task.id,
          stage: '基线',
          assetType: 'processed_eeg_set',
          filePath: finalSetPath,
          existsOnDisk: true,
        });
      }

      if (fs.existsSync(finalFdtPath)) {
        assets.push({
          id: `${task.id}:final_fdt:${featureAssetKey(finalFdtPath)}`,
          source: 'preprocess_output',
          taskId: task.id,
          stage: '基线',
          assetType: 'processed_eeg_fdt',
          filePath: finalFdtPath,
          existsOnDisk: true,
        });
      }
    }
  }

  return assets;
}

function featureInputAssets(db: Database, paths: AppPaths, patientId: string): Array<Record<string, unknown>> {
  const assets = [
    ...dataLibraryFeatureInputAssets(db, patientId),
    ...preprocessOutputFeatureInputAssets(db, paths, patientId),
  ];
  const seen = new Set<string>();

  return assets.filter((asset) => {
    const key = typeof asset.filePath === 'string' ? featureAssetKey(asset.filePath) : String(asset.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildEegStatePairs(assets: FeatureInputAsset[]): FeatureEegStatePair[] {
  const pairsByState = new Map<
    'EO' | 'EC',
    Map<
      string,
      {
        set?: FeatureInputAsset;
        fdt?: FeatureInputAsset;
      }
    >
  >([
    ['EO', new Map()],
    ['EC', new Map()],
  ]);

  for (const asset of assets) {
    if (asset.assetType !== 'processed_eeg_set' && asset.assetType !== 'processed_eeg_fdt') continue;
    if (typeof asset.filePath !== 'string' || !fs.existsSync(asset.filePath)) continue;

    const state = eegStateFromFilePath(asset.filePath);
    if (state !== 'EO' && state !== 'EC') continue;

    const stem = featureSetStem(asset.filePath);
    const statePairs = pairsByState.get(state)!;
    const pair = statePairs.get(stem) ?? {};

    if (asset.assetType === 'processed_eeg_set') {
      pair.set = asset;
    } else {
      pair.fdt = asset;
    }

    statePairs.set(stem, pair);
  }

  return (['EO', 'EC'] as const).map((state) => {
    const completePair = [...pairsByState.get(state)!.values()].find((pair) => pair.set && pair.fdt);

    if (
      !completePair?.set ||
      !completePair.fdt ||
      typeof completePair.set.filePath !== 'string' ||
      typeof completePair.fdt.filePath !== 'string'
    ) {
      throw new Error(`缺少 ${state} 状态的预处理 EEG .set/.fdt 配对输入。`);
    }

    return {
      state,
      setPath: completePair.set.filePath,
      fdtPath: completePair.fdt.filePath,
      setAssetId: completePair.set.id,
      fdtAssetId: completePair.fdt.id,
      source: completePair.set.source ?? completePair.fdt.source,
      stage: completePair.set.stage ?? completePair.fdt.stage,
    };
  });
}

function hasFeatureGenerationInputs(db: Database, paths: AppPaths, patientId: string): boolean {
  const patient = featureGenerationPatient(db, patientId);

  if (!patient) {
    return false;
  }

  try {
    buildFeatureGenerationContract(patient.affectedHand);
    buildEegStatePairs(featureInputAssets(db, paths, patientId));
    return true;
  } catch {
    return false;
  }
}

function manifestArtifacts(manifest: Record<string, unknown>): FeatureManifestArtifact[] {
  const artifacts = manifest.artifacts;

  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error('特征结果清单未包含任何特征文件。');
  }

  return artifacts.map((artifact, index) => {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      throw new Error(`特征结果清单第 ${index + 1} 项格式不正确。`);
    }

    const item = artifact as Record<string, unknown>;
    const kind = item.kind;
    const state = item.state;
    const filePathValue = item.filePath;

    if (kind !== 'PSD' && kind !== 'FC' && kind !== 'SUMMARY' && kind !== 'PREVIEW') {
      throw new Error(`特征结果清单第 ${index + 1} 项 kind 不支持。`);
    }

    if (state !== undefined && state !== 'EO' && state !== 'EC' && state !== 'EO_EC' && state !== 'UNKNOWN') {
      throw new Error(`特征结果清单第 ${index + 1} 项 state 不支持。`);
    }

    if (typeof filePathValue !== 'string' || filePathValue.trim() === '') {
      throw new Error(`特征结果清单第 ${index + 1} 项缺少 filePath。`);
    }

    return {
      kind,
      state: state as FeatureArtifactState | undefined,
      filePath: filePathValue,
      featureCount: typeof item.featureCount === 'number' ? item.featureCount : undefined,
      params:
        item.params && typeof item.params === 'object' && !Array.isArray(item.params)
          ? (item.params as Record<string, unknown>)
          : undefined,
      preview:
        item.preview && typeof item.preview === 'object' && !Array.isArray(item.preview)
          ? (item.preview as Record<string, unknown>)
          : undefined,
    };
  });
}

function artifactFromRow(row: {
  id: string;
  patient_id: string;
  subject_code: string;
  kind: FeatureArtifactKind;
  state: FeatureArtifactState;
  file_path: string;
  file_format: string;
  file_size: number;
  feature_count: number;
  params_json: string;
  preview_json: string;
  exists_on_disk: number;
  created_at: string;
  updated_at: string;
}): FeatureArtifact {
  return {
    id: row.id,
    patientId: row.patient_id,
    subjectCode: row.subject_code,
    kind: row.kind,
    state: row.state,
    filePath: row.file_path,
    fileFormat: row.file_format,
    fileSize: row.file_size,
    featureCount: row.feature_count,
    params: parseJson(row.params_json),
    preview: parseJson(row.preview_json),
    existsOnDisk: row.exists_on_disk === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function indexFeatureArtifact(db: Database, input: IndexFeatureArtifactInput): string {
  const patient = queryOne<{ id: string; subject_code: string }>(
    db,
    'SELECT id, subject_code FROM patients WHERE id = ?',
    [input.patientId],
  );

  if (!patient) {
    throw new Error(`Cannot index feature artifact for missing patient: ${input.patientId}`);
  }

  const state = input.state ?? 'UNKNOWN';
  const existing = queryOne<{ id: string; created_at: string }>(
    db,
    `SELECT id, created_at
     FROM feature_artifacts
     WHERE patient_id = ? AND kind = ? AND state = ? AND file_path = ?`,
    [input.patientId, input.kind, state, input.filePath],
  );
  const id = existing?.id ?? randomUUID();
  const timestamp = nowIso();
  const existsOnDisk = fs.existsSync(input.filePath);

  run(
    db,
    `INSERT OR REPLACE INTO feature_artifacts (
      id, patient_id, kind, state, file_path, file_format, file_size, feature_count,
      params_json, preview_json, exists_on_disk, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.patientId,
      input.kind,
      state,
      input.filePath,
      fileFormat(input.filePath),
      fileSize(input.filePath),
      input.featureCount ?? 0,
      safeJson(input.params),
      safeJson(input.preview),
      existsOnDisk ? 1 : 0,
      existing?.created_at ?? timestamp,
      timestamp,
    ],
  );

  ensureFeatureWorkflowStatus(
    db,
    input.patientId,
    existsOnDisk ? '已完成' : '需复核',
    existsOnDisk ? '' : `特征文件不存在：${input.filePath}`,
  );
  addTaskLog(db, {
    patientId: input.patientId,
    level: existsOnDisk ? 'info' : 'warning',
    source: 'database',
    message: `Feature artifact indexed: ${patient.subject_code} ${input.kind} ${state} ${input.filePath}`,
  });

  return id;
}

export function listFeatureArtifacts(db: Database, filter: ListFeatureArtifactsFilter = {}): FeatureArtifact[] {
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (filter.patientId) {
    where.push('fa.patient_id = ?');
    params.push(filter.patientId);
  }

  if (filter.kind) {
    where.push('fa.kind = ?');
    params.push(filter.kind);
  }

  if (filter.state) {
    where.push('fa.state = ?');
    params.push(filter.state);
  }

  if (filter.existsOnDisk !== undefined) {
    where.push('fa.exists_on_disk = ?');
    params.push(filter.existsOnDisk ? 1 : 0);
  }

  const rows = queryAll<{
    id: string;
    patient_id: string;
    subject_code: string;
    kind: FeatureArtifactKind;
    state: FeatureArtifactState;
    file_path: string;
    file_format: string;
    file_size: number;
    feature_count: number;
    params_json: string;
    preview_json: string;
    exists_on_disk: number;
    created_at: string;
    updated_at: string;
  }>(
    db,
    `SELECT fa.id, fa.patient_id, p.subject_code, fa.kind, fa.state, fa.file_path, fa.file_format,
      fa.file_size, fa.feature_count, fa.params_json, fa.preview_json, fa.exists_on_disk,
      fa.created_at, fa.updated_at
     FROM feature_artifacts fa
     INNER JOIN patients p ON p.id = fa.patient_id
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY p.subject_code,
      CASE fa.kind
        WHEN 'PSD' THEN 1
        WHEN 'FC' THEN 2
        WHEN 'SUMMARY' THEN 3
        WHEN 'PREVIEW' THEN 4
        ELSE 5
      END,
      fa.state,
      fa.file_path`,
    params,
  );

  return rows.map(artifactFromRow);
}

export function listFeatureOverview(db: Database): FeatureArtifactOverviewRow[] {
  const rows = queryAll<{
    patient_id: string;
    subject_code: string;
    patient_name: string;
    feature_status: BackendWorkflowStatus;
    psd_count: number;
    fc_count: number;
    summary_count: number;
    preview_count: number;
    latest_feature_at: string | null;
  }>(
    db,
    `SELECT
      p.id AS patient_id,
      p.subject_code,
      p.name AS patient_name,
      COALESCE(ws.feature_status, '未开始') AS feature_status,
      SUM(CASE WHEN fa.kind = 'PSD' AND fa.exists_on_disk = 1 THEN 1 ELSE 0 END) AS psd_count,
      SUM(CASE WHEN fa.kind = 'FC' AND fa.exists_on_disk = 1 THEN 1 ELSE 0 END) AS fc_count,
      SUM(CASE WHEN fa.kind = 'SUMMARY' AND fa.exists_on_disk = 1 THEN 1 ELSE 0 END) AS summary_count,
      SUM(CASE WHEN fa.kind = 'PREVIEW' AND fa.exists_on_disk = 1 THEN 1 ELSE 0 END) AS preview_count,
      MAX(fa.updated_at) AS latest_feature_at
     FROM patients p
     LEFT JOIN workflow_status ws ON ws.patient_id = p.id
     LEFT JOIN feature_artifacts fa ON fa.patient_id = p.id
     GROUP BY p.id, p.subject_code, p.name, ws.feature_status
     ORDER BY p.subject_code`,
  );

  return rows.map((row) => ({
    patientId: row.patient_id,
    subjectCode: row.subject_code,
    patientName: row.patient_name,
    featureStatus: row.feature_status,
    psdCount: Number(row.psd_count ?? 0),
    fcCount: Number(row.fc_count ?? 0),
    summaryCount: Number(row.summary_count ?? 0),
    previewCount: Number(row.preview_count ?? 0),
    latestFeatureAt: row.latest_feature_at,
    hasEegFeatures: Number(row.psd_count ?? 0) + Number(row.fc_count ?? 0) > 0,
  }));
}

export function createFeatureGenerationBatch(
  db: Database,
  paths: AppPaths,
  input: FeatureGenerationBatchInput,
): FeatureGenerationBatchResult {
  const batchId = randomUUID();
  const skippedPatients: string[] = [];
  let queuedTasks = 0;

  for (const patientId of input.patientIds) {
    const patient = queryOne<{ id: string; subject_code: string }>(
      db,
      'SELECT id, subject_code FROM patients WHERE id = ?',
      [patientId],
    );

    if (!patient) {
      skippedPatients.push(patientId);
      continue;
    }

    if (!hasFeatureGenerationInputs(db, paths, patientId)) {
      skippedPatients.push(patientId);
      continue;
    }

    addTask(db, {
      type: 'feature_generation',
      patientId,
      batchId,
      status: 'queued',
      inputJson: JSON.stringify({
        displayName: 'PSD/FC 特征生成',
        subjectCode: patient.subject_code,
        featureKinds: input.featureKinds,
        states: input.states,
        overwrite: input.overwrite,
        params: input.params ?? {},
      }),
    });
    ensureFeatureWorkflowStatus(db, patientId, '待处理');
    addTaskLog(db, {
      patientId,
      level: 'info',
      source: 'app',
      message: `Feature generation queued: ${patient.subject_code}`,
    });
    queuedTasks += 1;
  }

  return {
    ok: queuedTasks > 0,
    message:
      queuedTasks === 0 && skippedPatients.length > 0
        ? `未创建特征生成任务，${skippedPatients.length} 位患者缺少可用的预处理 EEG 输入。`
        : skippedPatients.length > 0
          ? `已创建 ${queuedTasks} 个特征生成任务，跳过 ${skippedPatients.length} 位患者。`
          : `已创建 ${queuedTasks} 个特征生成任务。`,
    batchId,
    queuedTasks,
    skippedPatients,
  };
}

export function prepareFeatureGenerationExecution(
  db: Database,
  paths: AppPaths,
  taskId: string,
): FeatureGenerationPrepareResult {
  const task = getFeatureGenerationTask(db, taskId);

  if (!task || task.type !== 'feature_generation') {
    return { ok: false, message: '未找到特征生成任务。' };
  }

  if (!task.patient_id) {
    return { ok: false, message: '特征生成任务缺少患者信息。' };
  }

  const patient = featureGenerationPatient(db, task.patient_id);

  if (!patient) {
    return { ok: false, message: '特征生成任务关联的患者不存在。' };
  }

  const eegAssets = featureInputAssets(db, paths, task.patient_id);
  let contract: ReturnType<typeof buildFeatureGenerationContract>;
  let eegStatePairs: FeatureEegStatePair[];

  try {
    contract = buildFeatureGenerationContract(patient.affectedHand);
    eegStatePairs = buildEegStatePairs(eegAssets);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  const request = featureTaskRequest(task);
  const params =
    request.params && typeof request.params === 'object' && !Array.isArray(request.params)
      ? (request.params as Record<string, unknown>)
      : {};
  const executor = normalizeFeatureExecutorConfig(params);
  const outputDirectory = featureExecutionOutputDirectory(paths, task, patient.subjectCode);
  const manifestPath = path.join(outputDirectory, 'feature_manifest.json');
  const packagePath = path.join(outputDirectory, `${task.id}-feature-generation.json`);
  const command = executor ? buildFeatureGenerationCommand(executor, packagePath) : '';
  const args = executor ? buildFeatureGenerationArgs(executor, packagePath) : [];

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    packagePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        type: 'feature_generation_task_package',
        exportedAt: nowIso(),
        taskId: task.id,
        patientId: task.patient_id,
        subjectCode: patient.subjectCode,
        batchId: task.batch_id,
        contract,
        request: {
          featureKinds: normalizeStringArray(request.featureKinds),
          states: normalizeStringArray(request.states),
          overwrite: request.overwrite === true,
          params,
        },
        inputs: {
          eegAssets,
          eegStatePairs,
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
        displayName: 'PSD/FC 特征生成',
        featurePackagePath: packagePath,
        featureOutputDirectory: outputDirectory,
        featureManifestPath: manifestPath,
        featureExecutablePath: executor?.executablePath ?? '',
        featureScriptPath: executor?.scriptPath ?? '',
        featureCommand: command,
      }),
      task.id,
    ],
  );
  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'info',
    source: 'app',
    message: `特征生成任务包已准备: ${packagePath}`,
  });

  return {
    ok: true,
    message: `特征生成任务包已准备。任务包：${packagePath}`,
    packagePath,
    outputDirectory,
    manifestPath,
    executablePath: executor?.executablePath,
    scriptPath: executor?.scriptPath,
    command,
    args,
  };
}

function failFeatureGenerationExecution(
  db: Database,
  task: FeatureGenerationTaskRow,
  message: string,
  outputPatch: Partial<FeatureGenerationRunResult> = {},
): FeatureGenerationRunResult {
  failTask(db, task.id, message);

  if (task.patient_id) {
    ensureFeatureWorkflowStatus(db, task.patient_id, '失败', message);
  }

  db.run(
    `UPDATE tasks
     SET output_json = ?
     WHERE id = ?`,
    [JSON.stringify({ ...parseJson(task.output_json), ...outputPatch }), task.id],
  );
  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'error',
    source: 'app',
    message,
  });

  return {
    ...outputPatch,
    ok: false,
    message,
  };
}

export async function runFeatureGenerationExecution(
  db: Database,
  paths: AppPaths,
  taskId: string,
  executeFeatureGenerator: FeatureGeneratorExecutor = defaultExecuteFeatureGenerator,
): Promise<FeatureGenerationRunResult> {
  const prepared = prepareFeatureGenerationExecution(db, paths, taskId);

  if (!prepared.ok) {
    return prepared;
  }

  const task = getFeatureGenerationTask(db, taskId);

  if (!task || task.type !== 'feature_generation') {
    return { ok: false, message: '未找到特征生成任务。' };
  }

  if (!task.patient_id) {
    return { ok: false, message: '特征生成任务缺少患者信息。' };
  }

  if (!prepared.executablePath || !prepared.args) {
    const message = '特征生成执行器未配置，请在任务参数中提供 params.executor.executablePath。';
    return failFeatureGenerationExecution(db, task, message, prepared);
  }

  if (!fs.existsSync(prepared.executablePath)) {
    const message = `特征生成执行器不存在：${prepared.executablePath}`;
    return failFeatureGenerationExecution(db, task, message, prepared);
  }

  if (prepared.scriptPath && !fs.existsSync(prepared.scriptPath)) {
    const message = `特征生成脚本不存在：${prepared.scriptPath}`;
    return failFeatureGenerationExecution(db, task, message, prepared);
  }

  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'info',
    source: 'app',
    message: `开始执行特征生成: ${prepared.command}`,
  });

  db.run(
    `UPDATE tasks
     SET status = ?, started_at = ?
     WHERE id = ?`,
    ['running', nowIso(), task.id],
  );
  ensureFeatureWorkflowStatus(db, task.patient_id, '处理中');

  let processResult: FeatureGeneratorProcessResult;

  try {
    processResult = await executeFeatureGenerator(prepared.executablePath, prepared.args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    processResult = {
      exitCode: null,
      stdout: '',
      stderr: message,
    };
  }

  const outputPatch = {
    ...prepared,
    featureExitCode: processResult.exitCode,
    featureStdout: processResult.stdout,
    featureStderr: processResult.stderr,
    featureLastRunAt: nowIso(),
    exitCode: processResult.exitCode,
    stdout: processResult.stdout,
    stderr: processResult.stderr,
  };

  if (processResult.exitCode !== 0) {
    const reason = processResult.stderr || processResult.stdout || `exitCode=${processResult.exitCode}`;
    const message = `特征生成执行失败：${reason}`;
    return failFeatureGenerationExecution(db, getFeatureGenerationTask(db, taskId) ?? task, message, outputPatch);
  }

  const completion = completeFeatureGenerationTask(db, task.id, prepared.manifestPath ?? '');
  const completedTask = getFeatureGenerationTask(db, task.id);

  if (completedTask) {
    db.run(
      `UPDATE tasks
       SET output_json = ?
       WHERE id = ?`,
      [
        JSON.stringify({
          ...parseJson(completedTask.output_json),
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

export function completeFeatureGenerationTask(
  db: Database,
  taskId: string,
  manifestPath: string,
): FeatureGenerationCompleteResult {
  const task = getFeatureGenerationTask(db, taskId);

  if (!task || task.type !== 'feature_generation') {
    return {
      ok: false,
      message: '未找到特征生成任务。',
      indexedArtifacts: 0,
      artifactIds: [],
    };
  }

  if (!task.patient_id) {
    return {
      ok: false,
      message: '特征生成任务缺少患者信息。',
      indexedArtifacts: 0,
      artifactIds: [],
    };
  }

  if (!fs.existsSync(manifestPath)) {
    const message = `特征结果清单不存在：${manifestPath}`;
    failTask(db, task.id, message);
    ensureFeatureWorkflowStatus(db, task.patient_id, '失败', message);
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'error',
      source: 'app',
      message,
    });
    return { ok: false, message, indexedArtifacts: 0, artifactIds: [] };
  }

  let artifacts: FeatureManifestArtifact[];

  try {
    artifacts = manifestArtifacts(parseJsonFile(manifestPath));
    for (const artifact of artifacts) {
      assertFeatureArtifactContract({ kind: artifact.kind, state: artifact.state, params: artifact.params });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failTask(db, task.id, message);
    ensureFeatureWorkflowStatus(db, task.patient_id, '失败', message);
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'error',
      source: 'app',
      message,
    });
    return { ok: false, message, indexedArtifacts: 0, artifactIds: [] };
  }

  const missingFiles = artifacts.map((artifact) => artifact.filePath).filter((filePath) => !fs.existsSync(filePath));

  if (missingFiles.length > 0) {
    const message = `特征结果文件不存在：${missingFiles.join('；')}`;
    failTask(db, task.id, message);
    ensureFeatureWorkflowStatus(db, task.patient_id, '失败', message);
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'error',
      source: 'app',
      message,
    });
    return { ok: false, message, indexedArtifacts: 0, artifactIds: [] };
  }

  const artifactIds = artifacts.map((artifact) =>
    indexFeatureArtifact(db, {
      patientId: task.patient_id!,
      kind: artifact.kind,
      state: artifact.state,
      filePath: artifact.filePath,
      featureCount: artifact.featureCount,
      params: artifact.params,
      preview: artifact.preview,
    }),
  );
  const outputJson = JSON.stringify({
    displayName: 'PSD/FC 特征生成',
    manifestPath,
    artifactIds,
    indexedArtifacts: artifactIds.length,
    completedAt: nowIso(),
  });

  completeTask(db, task.id, outputJson);
  ensureFeatureWorkflowStatus(db, task.patient_id, '已完成');
  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'info',
    source: 'app',
    message: `特征生成任务已完成，已索引 ${artifactIds.length} 个特征文件。`,
  });

  return {
    ok: true,
    message: `特征生成任务已完成，已索引 ${artifactIds.length} 个特征文件。`,
    indexedArtifacts: artifactIds.length,
    artifactIds,
  };
}

export function getFeatureArtifact(db: Database, artifactId: string): FeatureArtifact | null {
  const row = queryOne<{
    id: string;
    patient_id: string;
    subject_code: string;
    kind: FeatureArtifactKind;
    state: FeatureArtifactState;
    file_path: string;
    file_format: string;
    file_size: number;
    feature_count: number;
    params_json: string;
    preview_json: string;
    exists_on_disk: number;
    created_at: string;
    updated_at: string;
  }>(
    db,
    `SELECT fa.id, fa.patient_id, p.subject_code, fa.kind, fa.state, fa.file_path, fa.file_format,
      fa.file_size, fa.feature_count, fa.params_json, fa.preview_json, fa.exists_on_disk,
      fa.created_at, fa.updated_at
     FROM feature_artifacts fa
     INNER JOIN patients p ON p.id = fa.patient_id
     WHERE fa.id = ?`,
    [artifactId],
  );

  return row ? artifactFromRow(row) : null;
}
