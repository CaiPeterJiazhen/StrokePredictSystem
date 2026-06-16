import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'sql.js';
import type {
  ApiResult,
  BackendLogLevel,
  BackendEegFile,
  BackendPatient,
  BackendSettings,
  BackendTask,
  BackendTaskLog,
  BackendTaskStatus,
  BackendWorkflowStatus,
  CreatePatientInput,
  EegCondition,
  ListTaskLogsFilter,
  ListTasksFilter,
  RegisterEegFileInput,
  ScanEegFolderResult,
  UpdatePatientInput,
  WorkbenchData,
  WorkbenchHandText,
  WorkbenchPredictionText,
  WorkbenchStatusText,
} from '../../domain/backendTypes.js';
import { DEFAULT_APP_ROOT } from './appPaths.js';
import { nowIso } from './database.js';
import { manualFileTaskId, type ManualFileTaskCondition } from './manualTaskIds.js';

type SqlParam = string | number | null;
type SqlRow = Record<string, unknown>;
type PatientDbRow = {
  id: string;
  subject_code: string;
  name: string;
  age: number | null;
  sex: BackendPatient['sex'];
  diagnosis: string;
  affected_hand: BackendPatient['affectedHand'];
  notes: string;
  created_at: string;
  updated_at: string;
};

export type AddTaskInput = {
  type: BackendTask['type'];
  patientId?: string | null;
  batchId?: string | null;
  status?: BackendTaskStatus;
  priority?: BackendTask['priority'];
  inputJson?: string;
  outputJson?: string;
  errorMessage?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export type AddTaskLogInput = {
  taskId?: string | null;
  patientId?: string | null;
  level: BackendLogLevel;
  source: BackendTaskLog['source'];
  message: string;
};

export type UpdateSettingsInput = Partial<BackendSettings> & Record<string, unknown>;

export type PatientMatchRow = {
  id: string;
  subjectCode: string;
};

const defaultSettings: BackendSettings = {
  dataRoot: '',
  outputRoot: path.join(DEFAULT_APP_ROOT, 'outputs'),
  matlabExecutable: '',
  eeglabPath: '',
  defaultElectrodeLocationFile: '',
  pythonExecutable: '',
  featureGeneratorScript: '',
  predictionScript: '',
  explainabilityScript: '',
  modelLibraryRoot: '',
  defaultDownsampleRate: '500',
  defaultHighPassHz: '1',
  defaultLowPassHz: '45',
  defaultNotchHz: '50',
};

const installedMatlabExecutableCandidates = [
  'F:\\Matlab2020a\\bin\\matlab.exe',
  'C:\\Program Files\\MATLAB\\R2020a\\bin\\matlab.exe',
];

const installedEeglabPathCandidates = [
  'F:\\Matlab2020a\\toolbox\\eeglab2021.1',
];

const installedElectrodeLocationCandidates = [
  'F:\\Matlab2020a\\toolbox\\eeglab2021.1\\plugins\\dipfit\\standard_BESA\\standard-10-5-cap385.elp',
  'F:\\Matlab2020a\\toolbox\\eeglab2021.1\\plugins\\dipfit\\standard_BEM\\elec\\standard_1005.elc',
  'F:\\Matlab2020a\\toolbox\\eeglab2021.1\\functions\\supportfiles\\Standard-10-5-Cap385.sfp',
];

const installedPythonExecutableCandidates = [
  'D:\\anaconda\\python.exe',
  'C:\\Users\\HPGZZ\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe',
];

const bundledEngineScriptCandidates = {
  featureGeneratorScript: [path.resolve('engines', 'generate_features.py')],
  predictionScript: [path.resolve('engines', 'predict_recovery.py')],
  explainabilityScript: [path.resolve('engines', 'explain_recovery.py')],
};

const settingKeys = Object.keys(defaultSettings) as Array<keyof BackendSettings>;
const workbenchHands = new Set<WorkbenchHandText>(['左手', '右手', '双手', '右肢不利 (LH)', '左肢不利 (RH)', '-']);

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

function firstExistingPath(candidates: string[], expectedType: 'file' | 'directory'): string {
  return (
    candidates.find((candidate) => {
      if (!fs.existsSync(candidate)) return false;
      const stat = fs.statSync(candidate);
      return expectedType === 'file' ? stat.isFile() : stat.isDirectory();
    }) ?? ''
  );
}

function settingsWithDetectedDefaults(settings: BackendSettings): BackendSettings {
  return {
    ...settings,
    outputRoot:
      settings.outputRoot.trim() || path.join(DEFAULT_APP_ROOT, 'outputs'),
    matlabExecutable:
      settings.matlabExecutable.trim() || firstExistingPath(installedMatlabExecutableCandidates, 'file'),
    eeglabPath:
      settings.eeglabPath.trim() || firstExistingPath(installedEeglabPathCandidates, 'directory'),
    defaultElectrodeLocationFile:
      settings.defaultElectrodeLocationFile.trim() || firstExistingPath(installedElectrodeLocationCandidates, 'file'),
    pythonExecutable:
      settings.pythonExecutable.trim() || firstExistingPath(installedPythonExecutableCandidates, 'file'),
    featureGeneratorScript:
      settings.featureGeneratorScript.trim() || firstExistingPath(bundledEngineScriptCandidates.featureGeneratorScript, 'file'),
    predictionScript:
      settings.predictionScript.trim() || firstExistingPath(bundledEngineScriptCandidates.predictionScript, 'file'),
    explainabilityScript:
      settings.explainabilityScript.trim() || firstExistingPath(bundledEngineScriptCandidates.explainabilityScript, 'file'),
  };
}

function ensureDefaultSettings(db: Database): void {
  const timestamp = nowIso();

  for (const key of settingKeys) {
    run(db, 'INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [
      key,
      defaultSettings[key],
      timestamp,
    ]);
  }
}

function settingsFromRows(rows: Array<{ key: unknown; value: unknown }>): BackendSettings {
  const settings = { ...defaultSettings };

  for (const row of rows) {
    if (typeof row.key === 'string' && settingKeys.includes(row.key as keyof BackendSettings)) {
      settings[row.key as keyof BackendSettings] = String(row.value ?? '');
    }
  }

  return settingsWithDetectedDefaults(settings);
}

function toPatientHand(value: unknown): WorkbenchHandText {
  if (typeof value === 'string' && value !== '' && workbenchHands.has(value as WorkbenchHandText)) {
    return value as WorkbenchHandText;
  }

  return '-';
}

function toStatusText(value: unknown): WorkbenchStatusText {
  return String(value || '未开始') as WorkbenchStatusText;
}

function predictionText(predictionStatus: unknown): WorkbenchPredictionText {
  return predictionStatus === '已完成' ? '待接入预测结果' : '-';
}

function taskPatient(patientLabel: unknown, patientId: unknown, batchId: unknown): string {
  if (typeof patientLabel === 'string' && patientLabel) {
    return patientLabel;
  }

  if (typeof patientId === 'string' && patientId) {
    return patientId;
  }

  if (typeof batchId === 'string' && batchId) {
    return batchId;
  }

  return 'batch';
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function taskDisplayName(taskType: unknown, inputJson: string, outputJson: string): string {
  const output = parseJsonRecord(outputJson);
  const input = parseJsonRecord(inputJson);

  return stringValue(output.displayName) ?? stringValue(input.displayName) ?? String(taskType);
}

function taskAction(errorMessage: unknown, inputJson: string, outputJson: string): string | undefined {
  const output = parseJsonRecord(outputJson);
  const input = parseJsonRecord(inputJson);
  const explicitAction = stringValue(output.manualAction) ?? stringValue(input.manualAction);

  if (explicitAction) {
    return explicitAction;
  }

  return stringValue(errorMessage) ?? undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
}

function eegConditionFromFilePath(filePath: string): EegCondition {
  const stem = path.basename(filePath, path.extname(filePath)).toLowerCase().replace(/_preprocessed_final$/, '');

  if (/1$|_eo$|-eo$/.test(stem)) return 'EO';
  if (/2$|_ec$|-ec$/.test(stem)) return 'EC';

  const pathSegments = path.dirname(filePath).split(/[\\/]+/).filter(Boolean).reverse();
  for (const segment of pathSegments) {
    const normalized = segment.toLowerCase();
    if (/^eo$|_eo$|-eo$/.test(normalized)) return 'EO';
    if (/^ec$|_ec$|-ec$/.test(normalized)) return 'EC';
  }

  return 'UNKNOWN';
}

function manualConditionLabel(condition: EegCondition): '睁眼' | '闭眼' | '未知' {
  if (condition === 'EO') return '睁眼';
  if (condition === 'EC') return '闭眼';
  return '未知';
}

function manualStageInputSuffix(action: string | undefined): string | null {
  const text = action ?? '';

  if (text.includes('ICA') || text.includes('伪迹')) {
    return 'stage03_before_ica_artifact';
  }

  if (text.includes('坏段')) {
    return 'stage01_before_bad_segment';
  }

  return null;
}

function manualStageOutputSuffix(action: string | undefined): string | null {
  const text = action ?? '';

  if (text.includes('ICA') || text.includes('伪迹')) {
    return 'stage04_after_ica_artifact';
  }

  if (text.includes('坏段')) {
    return 'stage02_after_bad_segment';
  }

  return null;
}

function manualTaskFileOutputExists(
  outputRoot: string,
  task: { patient_id: string | null; batch_id: string | null },
  input: Record<string, unknown>,
  filePath: string,
  action: string | undefined,
): boolean {
  const outputSuffix = manualStageOutputSuffix(action);

  if (!outputSuffix) {
    return false;
  }

  const batchId = task.batch_id ?? stringValue(input.batchId) ?? 'manual';
  const patientId = task.patient_id ?? stringValue(input.patientId);

  if (!patientId) {
    return false;
  }

  const rawBaseName = path.basename(filePath, path.extname(filePath));
  const outputPath = path.join(outputRoot, 'preprocess', batchId, 'processed', patientId, `${rawBaseName}_${outputSuffix}.set`);
  return fs.existsSync(outputPath);
}

function manualTaskFiles(
  inputJson: string,
  action: string | undefined,
  outputRoot: string,
  task: { patient_id: string | null; batch_id: string | null },
): WorkbenchData['tasks']['manual'][number]['manualFiles'] {
  const input = parseJsonRecord(inputJson);
  const rawFiles = arrayOfStrings(input.baselineRawCntFiles)
    .filter((filePath) => {
      const condition = eegConditionFromFilePath(filePath);
      return condition === 'EO' || condition === 'EC';
    })
    .filter((filePath) => !manualTaskFileOutputExists(outputRoot, task, input, filePath, action));
  const stageSuffix = manualStageInputSuffix(action);

  if (!stageSuffix || rawFiles.length === 0) {
    return undefined;
  }

  const conditionOrder: Record<EegCondition, number> = { EO: 0, EC: 1, UNKNOWN: 2 };

  return rawFiles
    .map((filePath) => {
      const condition = eegConditionFromFilePath(filePath);
      const rawBaseName = path.basename(filePath, path.extname(filePath));

      return {
        condition,
        label: manualConditionLabel(condition),
        sourceFileName: path.basename(filePath),
        stageFileName: `${rawBaseName}_${stageSuffix}.set`,
      };
    })
    .sort((left, right) => (
      conditionOrder[left.condition] - conditionOrder[right.condition] ||
      left.stageFileName.localeCompare(right.stageFileName)
    ));
}

function splitManualTaskRows(
  row: WorkbenchData['tasks']['manual'][number],
  files: NonNullable<WorkbenchData['tasks']['manual'][number]['manualFiles']>,
): Array<WorkbenchData['tasks']['manual'][number]> {
  if (files.length === 0) {
    return [];
  }

  return files.map((file) => ({
    ...row,
    id: manualFileTaskId(row.id, file.condition as ManualFileTaskCondition),
    name: `${row.name} · ${file.label}`,
    action: row.action ? `${row.action}（${file.label} ${file.condition}）` : undefined,
    manualFiles: [file],
  }));
}

function workbenchOutputRoot(db: Database, dataRoot: string): string {
  const configuredOutputRoot = getSettings(db).outputRoot.trim();
  const defaultOutputRoot = path.join(DEFAULT_APP_ROOT, 'outputs');

  if (configuredOutputRoot && configuredOutputRoot !== defaultOutputRoot) {
    return configuredOutputRoot;
  }

  return path.join(dataRoot, 'outputs');
}

function preprocessFinalAvailability(db: Database, outputRoot: string): Map<string, Set<EegCondition>> {
  const tasks = queryAll<{
    patient_id: string | null;
    batch_id: string | null;
    input_json: string;
  }>(
    db,
    `SELECT patient_id, batch_id, input_json
     FROM tasks
     WHERE type = 'preprocess'`,
  );
  const availability = new Map<string, Set<EegCondition>>();

  for (const task of tasks) {
    const input = parseJsonRecord(task.input_json);
    const patientId = task.patient_id ?? stringValue(input.patientId);

    if (!patientId) {
      continue;
    }

    const batchId = task.batch_id ?? stringValue(input.batchId) ?? 'manual';
    const rawFiles = arrayOfStrings(input.baselineRawCntFiles);

    for (const rawFile of rawFiles) {
      const condition = eegConditionFromFilePath(rawFile);

      if (condition !== 'EO' && condition !== 'EC') {
        continue;
      }

      const rawBaseName = path.basename(rawFile, path.extname(rawFile));
      const finalPath = path.join(
        outputRoot,
        'preprocess',
        batchId,
        'processed',
        patientId,
        `${rawBaseName}_preprocessed_final.set`,
      );

      if (!fs.existsSync(finalPath)) {
        continue;
      }

      if (!availability.has(patientId)) {
        availability.set(patientId, new Set<EegCondition>());
      }
      availability.get(patientId)?.add(condition);
    }
  }

  return availability;
}

function patientFromRow(row: PatientDbRow): BackendPatient {
  return {
    id: row.id,
    subjectCode: row.subject_code,
    name: row.name,
    age: row.age,
    sex: row.sex,
    diagnosis: row.diagnosis,
    affectedHand: row.affected_hand,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function taskFromRow(row: {
  id: string;
  type: BackendTask['type'];
  patient_id: string | null;
  batch_id: string | null;
  status: BackendTaskStatus;
  priority: BackendTask['priority'];
  input_json: string;
  output_json: string;
  error_message: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}): BackendTask {
  return {
    id: row.id,
    type: row.type,
    patientId: row.patient_id,
    batchId: row.batch_id,
    status: row.status,
    priority: row.priority,
    inputJson: row.input_json,
    outputJson: row.output_json,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function taskLogFromRow(row: {
  id: string;
  task_id: string | null;
  patient_id: string | null;
  level: BackendLogLevel;
  source: BackendTaskLog['source'];
  message: string;
  created_at: string;
}): BackendTaskLog {
  return {
    id: row.id,
    taskId: row.task_id,
    patientId: row.patient_id,
    level: row.level,
    source: row.source,
    message: row.message,
    createdAt: row.created_at,
  };
}

export function createPatient(db: Database, input: CreatePatientInput): string {
  const timestamp = nowIso();
  const existing = queryOne<{
    id: string;
    name: string;
    age: number | null;
    sex: string;
    diagnosis: string;
    affected_hand: string;
    notes: string;
  }>(db, 'SELECT id, name, age, sex, diagnosis, affected_hand, notes FROM patients WHERE subject_code = ?', [
    input.subjectCode,
  ]);

  if (existing) {
    run(
      db,
      `UPDATE patients
       SET name = ?, age = ?, sex = ?, diagnosis = ?, affected_hand = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.name ?? existing.name,
        input.age !== undefined ? input.age : existing.age,
        input.sex ?? existing.sex,
        input.diagnosis ?? existing.diagnosis,
        input.affectedHand ?? existing.affected_hand,
        input.notes ?? existing.notes,
        timestamp,
        existing.id,
      ],
    );
    run(
      db,
      `INSERT OR IGNORE INTO workflow_status (
        patient_id, preprocess_status, feature_status, prediction_status, explanation_status, report_status, last_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [existing.id, '未开始', '未开始', '未开始', '未生成', '未生成', '', timestamp],
    );

    return existing.id;
  }

  const id = randomUUID();
  run(
    db,
    `INSERT INTO patients (
      id, subject_code, name, age, sex, diagnosis, affected_hand, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.subjectCode,
      input.name ?? '',
      input.age ?? null,
      input.sex ?? '',
      input.diagnosis ?? '',
      input.affectedHand ?? '',
      input.notes ?? '',
      timestamp,
      timestamp,
    ],
  );
  run(
    db,
    `INSERT INTO workflow_status (
      patient_id, preprocess_status, feature_status, prediction_status, explanation_status, report_status, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, '未开始', '未开始', '未开始', '未生成', '未生成', '', timestamp],
  );
  addTaskLog(db, {
    patientId: id,
    level: 'info',
    source: 'database',
    message: `Patient ${input.subjectCode} created`,
  });

  return id;
}

export function listPatients(db: Database): BackendPatient[] {
  const rows = queryAll<PatientDbRow>(
    db,
    `SELECT id, subject_code, name, age, sex, diagnosis, affected_hand, notes, created_at, updated_at
     FROM patients
     ORDER BY subject_code`,
  );

  return rows.map(patientFromRow);
}

export function updatePatient(db: Database, id: string, input: UpdatePatientInput): BackendPatient | null {
  const existing = queryOne<PatientDbRow>(
    db,
    `SELECT id, subject_code, name, age, sex, diagnosis, affected_hand, notes, created_at, updated_at
     FROM patients
     WHERE id = ?`,
    [id],
  );

  if (!existing) {
    return null;
  }

  const timestamp = nowIso();
  run(
    db,
    `UPDATE patients
     SET subject_code = ?, name = ?, age = ?, sex = ?, diagnosis = ?, affected_hand = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.subjectCode ?? existing.subject_code,
      input.name ?? existing.name,
      input.age !== undefined ? input.age : existing.age,
      input.sex ?? existing.sex,
      input.diagnosis ?? existing.diagnosis,
      input.affectedHand ?? existing.affected_hand,
      input.notes ?? existing.notes,
      timestamp,
      id,
    ],
  );

  const updated = queryOne<PatientDbRow>(
    db,
    `SELECT id, subject_code, name, age, sex, diagnosis, affected_hand, notes, created_at, updated_at
     FROM patients
     WHERE id = ?`,
    [id],
  );

  return updated ? patientFromRow(updated) : null;
}

export function deletePatient(db: Database, id: string): ApiResult {
  const existing = queryOne<{ subject_code: string }>(db, 'SELECT subject_code FROM patients WHERE id = ?', [id]);

  if (!existing) {
    return { ok: false, message: '未找到要删除的患者。' };
  }

  run(db, 'DELETE FROM task_logs WHERE patient_id = ? OR task_id IN (SELECT id FROM tasks WHERE patient_id = ?)', [id, id]);
  run(db, 'DELETE FROM tasks WHERE patient_id = ?', [id]);
  run(db, 'DELETE FROM data_assets WHERE patient_id = ? OR (cohort = ? AND subject_code = ?)', [
    id,
    'patient',
    existing.subject_code,
  ]);
  run(db, 'DELETE FROM data_completeness WHERE patient_id = ? OR subject_code = ?', [id, existing.subject_code]);
  run(db, 'DELETE FROM patients WHERE id = ?', [id]);
  addTaskLog(db, {
    level: 'info',
    source: 'database',
    message: `Patient ${existing.subject_code} deleted`,
  });

  return { ok: true, message: `已删除患者 ${existing.subject_code}。` };
}

export function clearWorkspaceData(db: Database): ApiResult {
  try {
    run(db, 'BEGIN');
    run(db, 'DELETE FROM batch_reports');
    run(db, 'DELETE FROM patient_reports');
    run(db, 'DELETE FROM explanation_artifacts');
    run(db, 'DELETE FROM prediction_results');
    run(db, 'DELETE FROM feature_artifacts');
    run(db, 'DELETE FROM task_logs');
    run(db, 'DELETE FROM tasks');
    run(db, 'DELETE FROM eeg_files');
    run(db, 'DELETE FROM workflow_status');
    run(db, 'DELETE FROM clinical_metrics');
    run(db, 'DELETE FROM data_completeness');
    run(db, 'DELETE FROM data_assets');
    run(db, 'DELETE FROM source_roots');
    run(db, 'DELETE FROM patients');
    run(db, 'COMMIT');
  } catch (error) {
    run(db, 'ROLLBACK');
    throw error;
  }

  addTaskLog(db, {
    level: 'info',
    source: 'database',
    message: 'Workspace patient and data library records cleared',
  });

  return { ok: true, message: '已清空患者工作台与数据文档库记录。' };
}

export function registerEegFile(db: Database, input: RegisterEegFileInput): string {
  const id = randomUUID();
  const timestamp = nowIso();
  const extension = path.extname(input.filePath).replace(/^\./, '').toLowerCase();

  run(
    db,
    `INSERT OR REPLACE INTO eeg_files (
      id, patient_id, condition, file_path, file_format, exists_on_disk, registered_at, last_checked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.patientId,
      input.condition,
      input.filePath,
      extension || 'unknown',
      fs.existsSync(input.filePath) ? 1 : 0,
      timestamp,
      timestamp,
    ],
  );
  addTaskLog(db, {
    patientId: input.patientId,
    level: 'info',
    source: 'database',
    message: `EEG file registered: ${input.condition} ${input.filePath}`,
  });

  return id;
}

export function addTask(db: Database, input: AddTaskInput): string {
  const id = randomUUID();

  run(
    db,
    `INSERT INTO tasks (
      id, type, patient_id, batch_id, status, priority, input_json, output_json,
      error_message, created_at, started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.type,
      input.patientId ?? null,
      input.batchId ?? null,
      input.status ?? 'queued',
      input.priority ?? 'normal',
      input.inputJson ?? '{}',
      input.outputJson ?? '{}',
      input.errorMessage ?? '',
      nowIso(),
      input.startedAt ?? null,
      input.finishedAt ?? null,
    ],
  );

  return id;
}

export function setPreprocessWorkflowStatus(
  db: Database,
  patientId: string,
  preprocessStatus: BackendWorkflowStatus,
  lastError = '',
): void {
  const timestamp = nowIso();

  run(
    db,
    `INSERT OR IGNORE INTO workflow_status (
      patient_id, preprocess_status, feature_status, prediction_status, explanation_status, report_status, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [patientId, preprocessStatus, '未开始', '未开始', '未生成', '未生成', lastError, timestamp],
  );
  run(
    db,
    `UPDATE workflow_status
     SET preprocess_status = ?, last_error = ?, updated_at = ?
     WHERE patient_id = ?`,
    [preprocessStatus, lastError, timestamp, patientId],
  );
}

export function completeTask(db: Database, taskId: string, outputJson = '{}'): void {
  run(db, 'UPDATE tasks SET status = ?, output_json = ?, finished_at = ? WHERE id = ?', [
    'completed',
    outputJson,
    nowIso(),
    taskId,
  ]);
}

export function failTask(db: Database, taskId: string, errorMessage: string): void {
  run(db, 'UPDATE tasks SET status = ?, error_message = ?, finished_at = ? WHERE id = ?', [
    'failed',
    errorMessage,
    nowIso(),
    taskId,
  ]);
}

export function addTaskLog(db: Database, input: AddTaskLogInput): string {
  const id = randomUUID();

  run(
    db,
    `INSERT INTO task_logs (id, task_id, patient_id, level, source, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.taskId ?? null,
      input.patientId ?? null,
      input.level,
      input.source,
      input.message,
      nowIso(),
    ],
  );

  return id;
}

export function patientExistsBySubjectCode(db: Database, subjectCode: string): boolean {
  const row = queryOne<{ id: string }>(db, 'SELECT id FROM patients WHERE subject_code = ?', [subjectCode]);
  return row !== null;
}

export function listPatientsForMatching(db: Database): PatientMatchRow[] {
  const rows = queryAll<{ id: string; subject_code: string }>(
    db,
    'SELECT id, subject_code FROM patients ORDER BY LENGTH(subject_code) DESC, subject_code',
  );

  return rows.map((row) => ({
    id: row.id,
    subjectCode: row.subject_code,
  }));
}

export function listEegFilesForPatient(db: Database, patientId: string): BackendEegFile[] {
  const rows = queryAll<{
    id: string;
    patient_id: string;
    condition: EegCondition;
    file_path: string;
    file_format: string;
    exists_on_disk: number;
    registered_at: string;
    last_checked_at: string;
  }>(
    db,
    `SELECT id, patient_id, condition, file_path, file_format, exists_on_disk, registered_at, last_checked_at
     FROM eeg_files
     WHERE patient_id = ?
     ORDER BY condition, file_path`,
    [patientId],
  );

  return rows.map((row) => ({
    id: row.id,
    patientId: row.patient_id,
    condition: row.condition,
    filePath: row.file_path,
    fileFormat: row.file_format,
    existsOnDisk: row.exists_on_disk === 1,
    registeredAt: row.registered_at,
    lastCheckedAt: row.last_checked_at,
  }));
}

export function scanRegisteredEegFiles(db: Database): ScanEegFolderResult {
  const files = queryAll<{ id: string; file_path: string }>(db, 'SELECT id, file_path FROM eeg_files');
  const timestamp = nowIso();
  let existingFiles = 0;

  for (const file of files) {
    const existsOnDisk = fs.existsSync(file.file_path);
    if (existsOnDisk) {
      existingFiles += 1;
    }

    run(db, 'UPDATE eeg_files SET exists_on_disk = ?, last_checked_at = ? WHERE id = ?', [
      existsOnDisk ? 1 : 0,
      timestamp,
      file.id,
    ]);
  }

  return {
    scannedFiles: files.length,
    registeredFiles: existingFiles,
    unmatchedFiles: [],
  };
}

export function listTasks(db: Database, filter: ListTasksFilter = {}): BackendTask[] {
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (filter.status) {
    where.push('status = ?');
    params.push(filter.status);
  }

  if (filter.patientId) {
    where.push('patient_id = ?');
    params.push(filter.patientId);
  }

  if (filter.type) {
    where.push('type = ?');
    params.push(filter.type);
  }

  const limit = Math.min(Math.max(Number(filter.limit ?? 30), 1), 200);
  params.push(limit);

  const rows = queryAll<{
    id: string;
    type: BackendTask['type'];
    patient_id: string | null;
    batch_id: string | null;
    status: BackendTaskStatus;
    priority: BackendTask['priority'];
    input_json: string;
    output_json: string;
    error_message: string;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
  }>(
    db,
    `SELECT id, type, patient_id, batch_id, status, priority, input_json, output_json,
      error_message, created_at, started_at, finished_at
     FROM tasks
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC
     LIMIT ?`,
    params,
  );

  return rows.map(taskFromRow);
}

export function listRecentTasks(db: Database, limit = 30): BackendTask[] {
  return listTasks(db, { limit });
}

export function retryTask(db: Database, taskId: string): ApiResult {
  const task = queryOne<{
    id: string;
    patient_id: string | null;
    status: BackendTaskStatus;
  }>(db, 'SELECT id, patient_id, status FROM tasks WHERE id = ?', [taskId]);

  if (!task) {
    return { ok: false, message: '未找到任务。' };
  }

  if (!['failed', 'cancelled', 'skipped'].includes(task.status)) {
    return { ok: false, message: '只有失败、已取消或已跳过的任务可以重试。' };
  }

  run(
    db,
    `UPDATE tasks
     SET status = 'queued', error_message = '', started_at = NULL, finished_at = NULL
     WHERE id = ?`,
    [taskId],
  );
  addTaskLog(db, {
    taskId,
    patientId: task.patient_id,
    level: 'info',
    source: 'app',
    message: '任务已重新加入待执行队列。',
  });

  return { ok: true, message: '任务已重新加入待执行队列。' };
}

export function cancelTask(db: Database, taskId: string): ApiResult {
  const task = queryOne<{
    id: string;
    patient_id: string | null;
    status: BackendTaskStatus;
  }>(db, 'SELECT id, patient_id, status FROM tasks WHERE id = ?', [taskId]);

  if (!task) {
    return { ok: false, message: '未找到任务。' };
  }

  if (!['queued', 'running', 'waiting_manual'].includes(task.status)) {
    return { ok: false, message: '只有待执行、运行中或等待人工的任务可以取消。' };
  }

  run(db, `UPDATE tasks SET status = 'cancelled', finished_at = ? WHERE id = ?`, [nowIso(), taskId]);
  addTaskLog(db, {
    taskId,
    patientId: task.patient_id,
    level: 'warning',
    source: 'app',
    message: '任务已取消。',
  });

  return { ok: true, message: '任务已取消。' };
}

export function listTaskLogs(db: Database, filter: ListTaskLogsFilter = {}): BackendTaskLog[] {
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (filter.patientId) {
    where.push('patient_id = ?');
    params.push(filter.patientId);
  }

  if (filter.taskId) {
    where.push('task_id = ?');
    params.push(filter.taskId);
  }

  if (filter.level) {
    where.push('level = ?');
    params.push(filter.level);
  }

  const limit = Math.min(Math.max(Number(filter.limit ?? 80), 1), 500);
  params.push(limit);

  const rows = queryAll<{
    id: string;
    task_id: string | null;
    patient_id: string | null;
    level: BackendLogLevel;
    source: BackendTaskLog['source'];
    message: string;
    created_at: string;
  }>(
    db,
    `SELECT id, task_id, patient_id, level, source, message, created_at
     FROM task_logs
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC
     LIMIT ?`,
    params,
  );

  return rows.map(taskLogFromRow);
}

export function getSettings(db: Database): BackendSettings {
  ensureDefaultSettings(db);
  return settingsFromRows(queryAll(db, 'SELECT key, value FROM settings'));
}

export function updateSettings(db: Database, input: UpdateSettingsInput): BackendSettings {
  ensureDefaultSettings(db);
  const timestamp = nowIso();

  for (const key of settingKeys) {
    const value = input[key];

    if (value !== undefined) {
      run(db, 'UPDATE settings SET value = ?, updated_at = ? WHERE key = ?', [String(value), timestamp, key]);
    }
  }

  return getSettings(db);
}

export function getWorkbenchData(db: Database, dataRoot: string): WorkbenchData {
  const outputRoot = workbenchOutputRoot(db, dataRoot);
  const finalAvailability = preprocessFinalAvailability(db, outputRoot);
  const patientRows = queryAll<{
    patient_id: string;
    subject_code: string;
    affected_hand: string;
    preprocess_status: BackendWorkflowStatus;
    feature_status: BackendWorkflowStatus;
    prediction_status: BackendWorkflowStatus;
    predicted_class: WorkbenchPredictionText | null;
    prediction_probability: number | null;
    report_status: string;
    eo_available: number;
    ec_available: number;
  }>(
    db,
    `SELECT
      p.id AS patient_id,
      p.subject_code,
      p.affected_hand,
      COALESCE(ws.preprocess_status, '未开始') AS preprocess_status,
      COALESCE(ws.feature_status, '未开始') AS feature_status,
      COALESCE(ws.prediction_status, '未开始') AS prediction_status,
      (
        SELECT pr.predicted_class
        FROM prediction_results pr
        WHERE pr.patient_id = p.id
        ORDER BY pr.updated_at DESC
        LIMIT 1
      ) AS predicted_class,
      (
        SELECT pr.probability
        FROM prediction_results pr
        WHERE pr.patient_id = p.id
        ORDER BY pr.updated_at DESC
        LIMIT 1
      ) AS prediction_probability,
      COALESCE(ws.report_status, '未生成') AS report_status,
      MAX(CASE WHEN ef.condition = 'EO' AND ef.exists_on_disk = 1 THEN 1 ELSE 0 END) AS eo_available,
      MAX(CASE WHEN ef.condition = 'EC' AND ef.exists_on_disk = 1 THEN 1 ELSE 0 END) AS ec_available
    FROM patients p
    LEFT JOIN workflow_status ws ON ws.patient_id = p.id
    LEFT JOIN eeg_files ef ON ef.patient_id = p.id
    GROUP BY p.id, p.subject_code, p.affected_hand, ws.preprocess_status, ws.feature_status, ws.prediction_status, ws.report_status
    ORDER BY p.subject_code`,
  );
  const recentTasks = queryAll<{
    id: string;
    type: string;
    patient_id: string | null;
    patient_label: string | null;
    batch_id: string | null;
    status: BackendTaskStatus;
    created_at: string;
    input_json: string;
    output_json: string;
    error_message: string;
  }>(
    db,
    `SELECT t.id, t.type, t.patient_id, p.subject_code AS patient_label, t.batch_id, t.status, t.created_at,
      t.input_json, t.output_json, t.error_message
     FROM tasks t
     LEFT JOIN patients p ON p.id = t.patient_id
     ORDER BY t.created_at DESC
     LIMIT 30`,
  );
  const logs = queryAll<{
    id: string;
    level: BackendLogLevel;
    source: string;
    message: string;
    created_at: string;
  }>(
    db,
    `SELECT id, level, source, message, created_at
     FROM task_logs
     ORDER BY created_at DESC
     LIMIT 80`,
  );
  const tasks: WorkbenchData['tasks'] = {
    queued: [],
    running: [],
    manual: [],
    failed: [],
  };

  for (const task of recentTasks) {
    const action = taskAction(task.error_message, task.input_json, task.output_json);
    const manualFiles = task.status === 'waiting_manual' && task.type === 'preprocess'
      ? manualTaskFiles(task.input_json, action, outputRoot, task)
      : undefined;
    const row = {
      id: task.id,
      type: task.type as BackendTask['type'],
      status: task.status,
      patient: taskPatient(task.patient_label, task.patient_id, task.batch_id),
      name: taskDisplayName(task.type, task.input_json, task.output_json),
      time: task.created_at,
      action,
      manualFiles,
    };

    if (task.status === 'queued') {
      tasks.queued?.push(row);
    } else if (task.status === 'running') {
      tasks.running.push(row);
    } else if (task.status === 'waiting_manual') {
      if (task.type === 'preprocess' && manualFiles && manualFiles.length > 0) {
        tasks.manual.push(...splitManualTaskRows(row, manualFiles));
      } else {
        tasks.manual.push(row);
      }
    } else if (task.status === 'failed') {
      tasks.failed.push(row);
    }
  }

  return {
    patients: patientRows.map((patient) => {
      const finalConditions = finalAvailability.get(patient.patient_id);

      return {
        id: patient.subject_code,
        patientId: patient.patient_id,
        hand: toPatientHand(patient.affected_hand),
        eo: patient.eo_available === 1 || finalConditions?.has('EO') === true,
        ec: patient.ec_available === 1 || finalConditions?.has('EC') === true,
        preStatus: toStatusText(patient.preprocess_status),
        featStatus: toStatusText(patient.feature_status),
        task: 'tACS_Outcome',
        predict: patient.predicted_class ?? predictionText(patient.prediction_status),
        prob: patient.prediction_probability === null ? null : Number(patient.prediction_probability),
        report: patient.report_status === '' ? '未生成' : (patient.report_status as WorkbenchData['patients'][number]['report']),
      };
    }),
    tasks,
    logs: logs.map((log) => ({
      id: log.id,
      text: `[${log.level.toUpperCase()}] ${log.created_at} - ${log.source}: ${log.message}`,
      level: log.level,
    })),
    dataRoot,
  };
}
