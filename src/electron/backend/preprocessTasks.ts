import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Database } from 'sql.js';
import type {
  ApiResult,
  BackendTaskStatus,
  EegCondition,
  PreprocessBatchInput,
  PreprocessBatchResult,
  PreprocessManualLaunchResult,
  PreprocessMatlabPrepareResult,
  PreprocessMatlabRunResult,
  PreprocessOutputFile,
  PreprocessOutputFileKind,
  PreprocessOutputSummary,
} from '../../domain/backendTypes.js';
import { listDataAssets } from './dataLibrary/repository.js';
import { nowIso } from './database.js';
import type { AppPaths } from './appPaths.js';
import { addTask, addTaskLog, getSettings, setPreprocessWorkflowStatus } from './repositories.js';
import { parseManualFileTaskId, type ManualFileTaskCondition } from './manualTaskIds.js';

const m1m2Channels = new Set(['m1', 'm2']);

type PreprocessStepMode = 'matlab_batch' | 'manual_eeglab';
type PreprocessStepStatus = 'planned' | 'waiting_manual' | 'blocked' | 'completed' | 'skipped';

type PreprocessStep = {
  id: string;
  label: string;
  mode: PreprocessStepMode;
  canBatch: boolean;
  status: PreprocessStepStatus;
  note?: string;
  selectedChannels?: string[];
};

type PreprocessManualCheckpoint = {
  stepId: string;
  label: string;
  status: Extract<PreprocessStepStatus, 'waiting_manual' | 'blocked' | 'completed'>;
  actionLabel: string;
};

type PreprocessTaskPackage = {
  schemaVersion: 1;
  type: 'eeg_preprocess_task_package';
  displayName: string;
  manualAction: string;
  batchId: string;
  patientId: string;
  baselineRawCntFiles: string[];
  parameters: Omit<PreprocessBatchInput, 'patientIds'>;
  steps: PreprocessStep[];
  manualCheckpoints: PreprocessManualCheckpoint[];
  executor: {
    matlab: 'pending';
    eeglabWindow: 'external_or_embedded_pending';
  };
  warnings: string[];
};

type PreprocessTaskRow = {
  id: string;
  type: string;
  patient_id: string | null;
  batch_id: string | null;
  status: string;
  input_json: string;
  output_json: string;
};

type ManualLaunchExport = {
  schemaVersion: 1;
  exportedAt: string;
  taskId: string;
  patientId: string;
  batchId: string | null;
  currentManualCheckpoint: PreprocessManualCheckpoint;
  manualSave: ManualSaveBridge;
  taskPackage: PreprocessTaskPackage;
};

type ManualSaveBridge = {
  requestPath: string;
  donePath: string;
  errorPath: string;
  helperPath: string;
  inputPaths: string[];
  outputPaths: string[];
};

type ManualCompletionOptions = {
  saveTimeoutMs?: number;
  savePollIntervalMs?: number;
};

type MatlabExecutionExport = {
  schemaVersion: 1;
  exportedAt: string;
  taskId: string;
  patientId: string;
  batchId: string | null;
  matlab: {
    matlabExecutable: string;
    eeglabPath: string;
    electrodeLocationFile: string;
    entryScriptPath: string;
    command: string;
  };
  taskPackage: PreprocessTaskPackage;
};

type MatlabProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type MatlabExecutor = (matlabExecutable: string, args: string[]) => Promise<MatlabProcessResult>;

function hasM1M2EmptyChannel(input: PreprocessBatchInput): boolean {
  return input.selectedEmptyChannels.some((channel) => m1m2Channels.has(channel.trim().toLowerCase()));
}

function queryOne<T extends Record<string, unknown>>(db: Database, sql: string, params: Array<string | number | null> = []): T | null {
  const stmt = db.prepare(sql);

  try {
    stmt.bind(params);

    if (!stmt.step()) {
      return null;
    }

    return stmt.getAsObject() as T;
  } finally {
    stmt.free();
  }
}

function queryAll<T extends Record<string, unknown>>(db: Database, sql: string, params: Array<string | number | null> = []): T[] {
  const stmt = db.prepare(sql);
  const rows: T[] = [];

  try {
    stmt.bind(params);

    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }

    return rows;
  } finally {
    stmt.free();
  }
}

function parseTaskPackage(value: string): PreprocessTaskPackage | null {
  try {
    const parsed: unknown = JSON.parse(value);

    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (parsed as { type?: unknown }).type === 'eeg_preprocess_task_package'
    ) {
      return parsed as PreprocessTaskPackage;
    }

    return null;
  } catch {
    return null;
  }
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Keep malformed output JSON from breaking later execution bookkeeping.
  }

  return {};
}

function getPreprocessTask(db: Database, taskId: string): PreprocessTaskRow | null {
  return queryOne<PreprocessTaskRow>(
    db,
    `SELECT id, type, patient_id, batch_id, status, input_json, output_json
     FROM tasks
     WHERE id = ?`,
    [taskId],
  );
}

function currentManualCheckpoint(taskPackage: PreprocessTaskPackage): PreprocessManualCheckpoint | null {
  return taskPackage.manualCheckpoints.find((checkpoint) => checkpoint.status === 'waiting_manual') ?? null;
}

function manualCheckpointOutputSuffix(checkpoint: PreprocessManualCheckpoint): string {
  if (checkpoint.stepId === 'manual_bad_segment_rejection') {
    return 'stage02_after_bad_segment';
  }

  if (checkpoint.stepId === 'manual_ica_artifact_rejection') {
    return 'stage04_after_ica_artifact';
  }

  return checkpoint.stepId;
}

function manualCheckpointOutputPaths(
  paths: AppPaths,
  task: PreprocessTaskRow,
  taskPackage: PreprocessTaskPackage,
  checkpoint: PreprocessManualCheckpoint,
): string[] {
  return preprocessOutputPaths(paths, task, taskPackage, manualCheckpointOutputSuffix(checkpoint));
}

function preprocessOutputRoot(paths: AppPaths, task: PreprocessTaskRow, taskPackage: PreprocessTaskPackage): string {
  return path.join(
    paths.outputsRoot,
    'preprocess',
    task.batch_id ?? taskPackage.batchId ?? 'manual',
    'processed',
    task.patient_id ?? taskPackage.patientId,
  );
}

function preprocessRawConditionFromFilePath(filePath: string): EegCondition {
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

function restingPreprocessRawFiles(rawFiles: string[]): string[] {
  const conditionOrder: Record<EegCondition, number> = { EO: 0, EC: 1, UNKNOWN: 2 };

  return rawFiles
    .filter((filePath) => {
      const condition = preprocessRawConditionFromFilePath(filePath);
      return condition === 'EO' || condition === 'EC';
    })
    .sort((left, right) => {
      const leftCondition = preprocessRawConditionFromFilePath(left);
      const rightCondition = preprocessRawConditionFromFilePath(right);
      return conditionOrder[leftCondition] - conditionOrder[rightCondition] || left.localeCompare(right);
    });
}

function manualConditionLabel(condition: ManualFileTaskCondition): '睁眼' | '闭眼' {
  return condition === 'EO' ? '睁眼' : '闭眼';
}

function taskPackageForManualCondition(
  taskPackage: PreprocessTaskPackage,
  condition: ManualFileTaskCondition | null,
): PreprocessTaskPackage {
  const restingFiles = restingPreprocessRawFiles(taskPackage.baselineRawCntFiles);

  if (!condition) {
    return {
      ...taskPackage,
      baselineRawCntFiles: restingFiles,
    };
  }

  return {
    ...taskPackage,
    baselineRawCntFiles: restingFiles.filter((filePath) => preprocessRawConditionFromFilePath(filePath) === condition),
  };
}

function samePathList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const normalize = (value: string) => path.resolve(value).toLowerCase();
  return left.map(normalize).sort().join('\n') === right.map(normalize).sort().join('\n');
}

function preprocessOutputPaths(
  paths: AppPaths,
  task: PreprocessTaskRow,
  taskPackage: PreprocessTaskPackage,
  suffix: string,
): string[] {
  const outputRoot = preprocessOutputRoot(paths, task, taskPackage);

  return restingPreprocessRawFiles(taskPackage.baselineRawCntFiles).map((rawFile) => {
    const rawBaseName = path.basename(rawFile, path.extname(rawFile));
    return path.join(outputRoot, `${rawBaseName}_${suffix}.set`);
  });
}

function allPreprocessOutputsExist(
  paths: AppPaths,
  task: PreprocessTaskRow,
  taskPackage: PreprocessTaskPackage,
  suffix: string,
): boolean {
  const expectedPaths = preprocessOutputPaths(paths, task, taskPackage, suffix);

  return expectedPaths.length > 0 && expectedPaths.every((filePath) => fs.existsSync(filePath));
}

function validateManualCheckpointOutput(
  db: Database,
  paths: AppPaths,
  task: PreprocessTaskRow,
  taskPackage: PreprocessTaskPackage,
  checkpoint: PreprocessManualCheckpoint,
): ApiResult | null {
  const rawFiles = restingPreprocessRawFiles(taskPackage.baselineRawCntFiles);

  if (rawFiles.length === 0) {
    const message = '未找到该患者的基线睁眼/闭眼静息态 CNT 原始 EEG 文件，无法继续预处理人工节点。';
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'warning',
      source: 'eeglab',
      message,
    });
    return { ok: false, message };
  }

  const expectedPaths = manualCheckpointOutputPaths(paths, task, taskPackage, checkpoint);
  const missingPaths = expectedPaths.filter((filePath) => !fs.existsSync(filePath));

  if (missingPaths.length === 0) {
    return null;
  }

  const message = `未检测到 EEGLAB 保存的${checkpoint.label}结果文件：${missingPaths.join('；')}。请在 EEGLAB 中保存后再继续。`;
  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'warning',
    source: 'eeglab',
    message,
  });

  return { ok: false, message };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textFileIfExists(filePath: string): string {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }

  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function bridgeRecordFromOutput(
  output: Record<string, unknown>,
  condition: ManualFileTaskCondition | null,
): Record<string, unknown> {
  if (condition && output.manualSaveByCondition && typeof output.manualSaveByCondition === 'object' && !Array.isArray(output.manualSaveByCondition)) {
    const conditionRecord = (output.manualSaveByCondition as Record<string, unknown>)[condition];

    if (conditionRecord && typeof conditionRecord === 'object' && !Array.isArray(conditionRecord)) {
      return conditionRecord as Record<string, unknown>;
    }
  }

  return output;
}

function manualSaveBridgeFromTaskOutput(
  task: PreprocessTaskRow,
  checkpoint: PreprocessManualCheckpoint,
  condition: ManualFileTaskCondition | null,
  expectedOutputPaths: string[],
): ManualSaveBridge | null {
  const output = parseJsonRecord(task.output_json);
  const bridgeRecord = bridgeRecordFromOutput(output, condition);
  const requestPath = typeof bridgeRecord.manualSaveRequestPath === 'string' ? bridgeRecord.manualSaveRequestPath : '';
  const donePath = typeof bridgeRecord.manualSaveDonePath === 'string' ? bridgeRecord.manualSaveDonePath : '';
  const errorPath = typeof bridgeRecord.manualSaveErrorPath === 'string' ? bridgeRecord.manualSaveErrorPath : '';
  const stepId = typeof bridgeRecord.manualSaveStepId === 'string' ? bridgeRecord.manualSaveStepId : '';
  const outputPaths = Array.isArray(bridgeRecord.manualSaveOutputPaths)
    ? bridgeRecord.manualSaveOutputPaths.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];

  if (!requestPath || !donePath || !errorPath || stepId !== checkpoint.stepId || outputPaths.length === 0) {
    return null;
  }

  if (!samePathList(outputPaths, expectedOutputPaths)) {
    return null;
  }

  return {
    requestPath,
    donePath,
    errorPath,
    helperPath: '',
    inputPaths: [],
    outputPaths,
  };
}

async function requestManualCheckpointSaveIfAvailable(
  db: Database,
  paths: AppPaths,
  task: PreprocessTaskRow,
  taskPackage: PreprocessTaskPackage,
  checkpoint: PreprocessManualCheckpoint,
  condition: ManualFileTaskCondition | null,
  options: ManualCompletionOptions = {},
): Promise<ApiResult | null> {
  if (allPreprocessOutputsExist(paths, task, taskPackage, manualCheckpointOutputSuffix(checkpoint))) {
    return null;
  }

  const expectedOutputPaths = manualCheckpointOutputPaths(paths, task, taskPackage, checkpoint);
  const saveBridge = manualSaveBridgeFromTaskOutput(task, checkpoint, condition, expectedOutputPaths);

  if (!saveBridge) {
    return null;
  }

  for (const transientPath of [saveBridge.donePath, saveBridge.errorPath]) {
    if (fs.existsSync(transientPath)) {
      fs.rmSync(transientPath, { force: true });
    }
  }
  fs.mkdirSync(path.dirname(saveBridge.requestPath), { recursive: true });
  fs.writeFileSync(saveBridge.requestPath, `requestedAt=${nowIso()}\n`, 'utf8');
  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'info',
    source: 'eeglab',
    message: `已请求 EEGLAB 自动保存${checkpoint.label}结果。`,
  });

  const timeoutMs = Math.max(0, options.saveTimeoutMs ?? 15000);
  const pollIntervalMs = Math.max(10, options.savePollIntervalMs ?? 250);
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    if (allPreprocessOutputsExist(paths, task, taskPackage, manualCheckpointOutputSuffix(checkpoint))) {
      addTaskLog(db, {
        taskId: task.id,
        patientId: task.patient_id,
        level: 'info',
        source: 'eeglab',
        message: `EEGLAB 已自动保存${checkpoint.label}结果。`,
      });
      return null;
    }

    if (fs.existsSync(saveBridge.errorPath)) {
      const errorText = textFileIfExists(saveBridge.errorPath);
      const message = `EEGLAB 自动保存${checkpoint.label}失败：${errorText || saveBridge.errorPath}`;
      addTaskLog(db, {
        taskId: task.id,
        patientId: task.patient_id,
        level: 'error',
        source: 'eeglab',
        message,
      });
      return { ok: false, message };
    }

    await delay(pollIntervalMs);
  }

  const expectedPaths = manualCheckpointOutputPaths(paths, task, taskPackage, checkpoint);
  const missingPaths = expectedPaths.filter((filePath) => !fs.existsSync(filePath));
  const message = `已向 EEGLAB 发送自动保存请求，但尚未检测到${checkpoint.label}结果文件：${missingPaths.join('；')}。请确认 EEGLAB 窗口仍打开，并且人工处理已完成。`;
  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'warning',
    source: 'eeglab',
    message,
  });

  return { ok: false, message };
}

function addPreprocessWarning(db: Database, task: PreprocessTaskRow, message: string, source: 'database' | 'matlab' | 'eeglab' = 'matlab'): void {
  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'warning',
    source,
    message,
  });
}

function validateMatlabExecutionInputs(
  db: Database,
  task: PreprocessTaskRow,
  taskPackage: PreprocessTaskPackage,
  settings: ReturnType<typeof getSettings>,
): ApiResult | null {
  const rawFiles = restingPreprocessRawFiles(taskPackage.baselineRawCntFiles);

  if (rawFiles.length === 0) {
    const message = '未找到该患者的基线睁眼/闭眼静息态 CNT 原始 EEG 文件，请先在数据与文档库中完成索引。';
    addPreprocessWarning(db, task, message, 'database');
    return { ok: false, message };
  }

  const missingRawFiles = rawFiles.filter((filePath) => !fs.existsSync(filePath));

  if (missingRawFiles.length > 0) {
    const message = `基线 CNT 原始 EEG 文件不存在：${missingRawFiles.join('；')}。请先更新数据与文档库索引。`;
    addPreprocessWarning(db, task, message, 'database');
    return { ok: false, message };
  }

  const eeglabPath = settings.eeglabPath.trim();

  if (!eeglabPath) {
    const message = '请先在环境设置中配置 EEGLAB 路径。';
    addPreprocessWarning(db, task, '未配置 EEGLAB 路径，无法准备 MATLAB 执行命令。');
    return { ok: false, message };
  }

  if (!fs.existsSync(eeglabPath) || !fs.statSync(eeglabPath).isDirectory()) {
    const message = 'EEGLAB 路径不存在，请检查环境设置。';
    addPreprocessWarning(db, task, 'EEGLAB 路径不存在，无法准备 MATLAB 执行命令。');
    return { ok: false, message };
  }

  const electrodeLocationFile = settings.defaultElectrodeLocationFile.trim();

  if (!electrodeLocationFile) {
    const message = '请先在环境设置中配置电极定位文件。';
    addPreprocessWarning(db, task, '未配置电极定位文件，无法准备 MATLAB 执行命令。');
    return { ok: false, message };
  }

  if (!fs.existsSync(electrodeLocationFile) || !fs.statSync(electrodeLocationFile).isFile()) {
    const message = '电极定位文件不存在，请检查环境设置。';
    addPreprocessWarning(db, task, '电极定位文件不存在，无法准备 MATLAB 执行命令。');
    return { ok: false, message };
  }

  return null;
}

function validExistingPath(value: string): string | null {
  const normalized = value.trim();

  if (!normalized || !fs.existsSync(normalized)) {
    return null;
  }

  return normalized;
}

function configuredLaunchTarget(db: Database): { targetPath: string | null; hasConfiguredPath: boolean } {
  const settings = getSettings(db);
  const configuredPaths = [settings.matlabExecutable.trim(), settings.eeglabPath.trim()].filter(Boolean);

  return {
    targetPath:
      validExistingPath(settings.matlabExecutable) ??
      validExistingPath(settings.eeglabPath),
    hasConfiguredPath: configuredPaths.length > 0,
  };
}

function configuredEeglabLaunch(db: Database): {
  matlabExecutable: string | null;
  eeglabPath: string | null;
  hasConfiguredPath: boolean;
} {
  const settings = getSettings(db);
  const matlabExecutable = validExistingPath(settings.matlabExecutable);
  const eeglabPath = validExistingPath(settings.eeglabPath);

  return {
    matlabExecutable,
    eeglabPath,
    hasConfiguredPath: Boolean(settings.matlabExecutable.trim() || settings.eeglabPath.trim()),
  };
}

function manualCheckpointInputSuffix(checkpoint: PreprocessManualCheckpoint): string {
  if (checkpoint.stepId === 'manual_bad_segment_rejection') {
    return 'stage01_before_bad_segment';
  }

  if (checkpoint.stepId === 'manual_ica_artifact_rejection') {
    return 'stage03_before_ica_artifact';
  }

  return checkpoint.stepId;
}

function manualCheckpointInputPath(
  paths: AppPaths,
  task: PreprocessTaskRow,
  taskPackage: PreprocessTaskPackage,
  checkpoint: PreprocessManualCheckpoint,
): string | null {
  const expectedPaths = preprocessOutputPaths(paths, task, taskPackage, manualCheckpointInputSuffix(checkpoint));

  return expectedPaths.find((filePath) => fs.existsSync(filePath)) ?? null;
}

function manualCheckpointExpectedInputPaths(
  paths: AppPaths,
  task: PreprocessTaskRow,
  taskPackage: PreprocessTaskPackage,
  checkpoint: PreprocessManualCheckpoint,
): string[] {
  return preprocessOutputPaths(paths, task, taskPackage, manualCheckpointInputSuffix(checkpoint));
}

function manualCheckpointInputPaths(
  paths: AppPaths,
  task: PreprocessTaskRow,
  taskPackage: PreprocessTaskPackage,
  checkpoint: PreprocessManualCheckpoint,
): string[] {
  return manualCheckpointExpectedInputPaths(paths, task, taskPackage, checkpoint).filter((filePath) => fs.existsSync(filePath));
}

function matlabCellArrayLiteral(values: string[]): string {
  return `{${values.map((value) => `'${matlabStringLiteral(value)}'`).join(', ')}}`;
}

function manualSaveBridgePaths(
  paths: AppPaths,
  task: PreprocessTaskRow,
  taskPackage: PreprocessTaskPackage,
  checkpoint: PreprocessManualCheckpoint,
  condition: ManualFileTaskCondition | null,
): ManualSaveBridge {
  const outputDir = path.join(paths.outputsRoot, 'preprocess', task.batch_id ?? taskPackage.batchId ?? 'manual');
  const bridgeDir = path.join(outputDir, 'manual-save');
  fs.mkdirSync(bridgeDir, { recursive: true });
  const filePrefix = [task.id, checkpoint.stepId, condition].filter(Boolean).join('-');

  return {
    requestPath: path.join(bridgeDir, `${filePrefix}-request.txt`),
    donePath: path.join(bridgeDir, `${filePrefix}-done.txt`),
    errorPath: path.join(bridgeDir, `${filePrefix}-error.txt`),
    helperPath: path.join(bridgeDir, 'neuro_predict_manual_save_poll.m'),
    inputPaths: manualCheckpointInputPaths(paths, task, taskPackage, checkpoint),
    outputPaths: manualCheckpointOutputPaths(paths, task, taskPackage, checkpoint),
  };
}

function manualSaveHelperContents(): string {
  return [
    'function neuro_predict_manual_save_poll(requestPath, donePath, errorPath, outputPaths)',
    '% Auto-generated by NeuroPredict. Polls for an app save request and saves open EEGLAB datasets.',
    "if exist(requestPath, 'file') ~= 2",
    '    return;',
    'end',
    'try',
    "    if exist(donePath, 'file') == 2, delete(donePath); end",
    "    if exist(errorPath, 'file') == 2, delete(errorPath); end",
    "    if exist(requestPath, 'file') == 2, delete(requestPath); end",
    "    ALLEEG = evalin('base', 'ALLEEG');",
    "    EEG = evalin('base', 'EEG');",
    "    CURRENTSET = evalin('base', 'CURRENTSET');",
    "    datasetIndices = [];",
    "    if evalin('base', 'exist(''NeuroPredictManualDatasetIndices'', ''var'')')",
    "        datasetIndices = evalin('base', 'NeuroPredictManualDatasetIndices');",
    '    end',
    '    if ~isempty(CURRENTSET) && CURRENTSET > 0 && CURRENTSET <= numel(ALLEEG)',
    '        [ALLEEG, EEG, CURRENTSET] = eeg_store(ALLEEG, EEG, CURRENTSET);',
    "        assignin('base', 'ALLEEG', ALLEEG);",
    "        assignin('base', 'EEG', EEG);",
    "        assignin('base', 'CURRENTSET', CURRENTSET);",
    '    end',
    "    if isempty(outputPaths)",
    "        error('NeuroPredict:NoManualOutputs', 'No manual output paths were provided.');",
    '    end',
    '    for idx = 1:numel(outputPaths)',
    '        outputPath = outputPaths{idx};',
    '        datasetIndex = [];',
    '        if numel(outputPaths) == 1 && ~isempty(CURRENTSET)',
    '            datasetIndex = CURRENTSET;',
    '        elseif numel(datasetIndices) >= idx',
    '            datasetIndex = datasetIndices(idx);',
    '        end',
    "        if ~isempty(datasetIndex) && datasetIndex > 0 && datasetIndex <= numel(ALLEEG) && isfield(ALLEEG(datasetIndex), 'data') && ~isempty(ALLEEG(datasetIndex).data)",
    '            EEG_TO_SAVE = ALLEEG(datasetIndex);',
    "        elseif numel(ALLEEG) >= idx && isfield(ALLEEG(idx), 'data') && ~isempty(ALLEEG(idx).data)",
    '            EEG_TO_SAVE = ALLEEG(idx);',
    '        elseif idx == 1',
    '            EEG_TO_SAVE = EEG;',
    '        else',
    "            error('NeuroPredict:MissingDataset', 'EEGLAB dataset %d is not loaded for automatic save.', idx);",
    '        end',
    '        [folder, name] = fileparts(outputPath);',
    "        if exist(folder, 'dir') ~= 7, mkdir(folder); end",
    '        EEG_TO_SAVE = eeg_checkset(EEG_TO_SAVE);',
    "        pop_saveset(EEG_TO_SAVE, 'filename', [name '.set'], 'filepath', folder);",
    '    end',
    "    fid = fopen(donePath, 'w');",
    '    if fid >= 0',
    "        fprintf(fid, 'saved=%d\\n', numel(outputPaths));",
    '        fclose(fid);',
    '    end',
    'catch ME',
    "    fid = fopen(errorPath, 'w');",
    '    if fid >= 0',
    "        fprintf(fid, '%s\\n', getReport(ME, 'extended', 'hyperlinks', 'off'));",
    '        fclose(fid);',
    '    end',
    'end',
    'end',
    '',
  ].join('\n');
}

function writeManualSaveHelper(saveBridge: ManualSaveBridge): void {
  fs.mkdirSync(path.dirname(saveBridge.helperPath), { recursive: true });
  fs.writeFileSync(saveBridge.helperPath, manualSaveHelperContents(), 'utf8');
  for (const transientPath of [saveBridge.requestPath, saveBridge.donePath, saveBridge.errorPath]) {
    if (fs.existsSync(transientPath)) {
      fs.rmSync(transientPath, { force: true });
    }
  }
}

function quoteCmdPath(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function powershellSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function matlabSafeFileToken(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '');
  return (normalized || 'manual').slice(0, 12);
}

function writeEeglabMatlabLauncher(scriptPath: string, matlabScriptLines: string[]): void {
  fs.writeFileSync(scriptPath, `${matlabScriptLines.join('\n')}\n`, 'utf8');
}

function writeEeglabPowerShellLauncher(scriptPath: string, matlabExecutable: string, matlabLauncherScriptPath: string): void {
  const launcherCommands = `run('${matlabStringLiteral(matlabLauncherScriptPath)}')`;
  const content = [
    "$ErrorActionPreference = 'Stop'",
    `$matlabExe = ${powershellSingleQuoted(matlabExecutable)}`,
    `$matlabCommands = ${powershellSingleQuoted(launcherCommands)}`,
    'function Invoke-NeuroPredictMatlabCommands($matlab) {',
    '  try { $matlab.Visible = 1 } catch { }',
    '  $matlab.Execute($matlabCommands) | Out-Null',
    '}',
    'function Invoke-NeuroPredictExistingMatlabWindow {',
    '  try {',
    '    Add-Type -AssemblyName System.Windows.Forms',
    "    $matlabProcess = Get-Process -Name MATLAB -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
    '    if ($null -eq $matlabProcess) { return $false }',
    '    $shell = New-Object -ComObject WScript.Shell',
    '    if (-not $shell.AppActivate([int]$matlabProcess.Id)) { return $false }',
    '    Start-Sleep -Milliseconds 400',
    '    [System.Windows.Forms.Clipboard]::SetText($matlabCommands)',
    "    [System.Windows.Forms.SendKeys]::SendWait('^v')",
    "    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')",
    '    return $true',
    '  } catch {',
    '    return $false',
    '  }',
    '}',
    'try {',
    "  $matlab = [Runtime.InteropServices.Marshal]::GetActiveObject('Matlab.Application')",
    '  Invoke-NeuroPredictMatlabCommands $matlab',
    '} catch {',
    '  if (-not (Invoke-NeuroPredictExistingMatlabWindow)) {',
    "    Start-Process -FilePath $matlabExe -ArgumentList @('-nosplash', '-r', $matlabCommands)",
    '  }',
    '}',
    '',
  ].join('\r\n');

  fs.writeFileSync(scriptPath, content, 'utf8');
}

function writeEeglabLauncher(
  paths: AppPaths,
  task: PreprocessTaskRow,
  taskPackage: PreprocessTaskPackage,
  checkpoint: PreprocessManualCheckpoint,
  condition: ManualFileTaskCondition | null,
  matlabExecutable: string,
  eeglabPath: string,
  packagePath: string,
  saveBridge: ManualSaveBridge,
): string {
  const outputDir = path.join(paths.outputsRoot, 'preprocess', task.batch_id ?? 'manual');
  fs.mkdirSync(outputDir, { recursive: true });
  writeManualSaveHelper(saveBridge);
  const inputPathsLiteral = matlabCellArrayLiteral(saveBridge.inputPaths);
  const outputPathsLiteral = matlabCellArrayLiteral(saveBridge.outputPaths);
  const matlabScriptLines = [
    '% Auto-generated by NeuroPredict.',
    'try',
    `addpath('${matlabStringLiteral(eeglabPath)}');`,
    `addpath('${matlabStringLiteral(path.dirname(saveBridge.helperPath))}');`,
    '[ALLEEG, EEG, CURRENTSET, ALLCOM] = eeglab;',
    `NeuroPredictManualInputPaths = ${inputPathsLiteral};`,
    `NeuroPredictManualSaveOutputPaths = ${outputPathsLiteral};`,
    'NeuroPredictManualDatasetIndices = zeros(1, numel(NeuroPredictManualInputPaths));',
    'for NeuroPredictManualIndex = 1:numel(NeuroPredictManualInputPaths)',
    '    [NeuroPredictSetFolder, NeuroPredictSetName, NeuroPredictSetExt] = fileparts(NeuroPredictManualInputPaths{NeuroPredictManualIndex});',
    "    EEG = pop_loadset('filename', [NeuroPredictSetName NeuroPredictSetExt], 'filepath', NeuroPredictSetFolder);",
    "    EEG.setname = NeuroPredictSetName;",
    '    [ALLEEG, EEG, CURRENTSET] = eeg_store(ALLEEG, EEG, 0);',
    '    NeuroPredictManualDatasetIndices(NeuroPredictManualIndex) = CURRENTSET;',
    'end',
    `NeuroPredictManualSaveTimer = timer('ExecutionMode', 'fixedSpacing', 'Period', 1, 'TimerFcn', @(~,~) neuro_predict_manual_save_poll('${matlabStringLiteral(saveBridge.requestPath)}', '${matlabStringLiteral(saveBridge.donePath)}', '${matlabStringLiteral(saveBridge.errorPath)}', NeuroPredictManualSaveOutputPaths));`,
    'start(NeuroPredictManualSaveTimer);',
    "assignin('base', 'NeuroPredictManualSaveTimer', NeuroPredictManualSaveTimer);",
    "assignin('base', 'NeuroPredictManualSaveOutputPaths', NeuroPredictManualSaveOutputPaths);",
    "assignin('base', 'NeuroPredictManualDatasetIndices', NeuroPredictManualDatasetIndices);",
    'eeglab redraw;',
    `disp('NeuroPredict manual package: ${matlabStringLiteral(packagePath)}');`,
    `disp('NeuroPredict automatic save request: ${matlabStringLiteral(saveBridge.requestPath)}');`,
    'catch ME',
    "disp(getReport(ME, 'extended', 'hyperlinks', 'off'));",
    'end',
  ].filter(Boolean);
  const launcherSuffix = condition ? `-${condition}` : '';
  const matlabScriptSuffix = condition ? `_${condition}` : '';
  const matlabLauncherScriptPath = path.join(
    outputDir,
    `neuro_predict_${matlabSafeFileToken(task.id)}${matlabScriptSuffix}_launch_eeglab.m`,
  );
  const launcherPath = path.join(outputDir, `${task.id}${launcherSuffix}-launch-eeglab.cmd`);
  const powershellLauncherPath = path.join(outputDir, `${task.id}${launcherSuffix}-launch-eeglab.ps1`);
  writeEeglabMatlabLauncher(matlabLauncherScriptPath, matlabScriptLines);
  writeEeglabPowerShellLauncher(powershellLauncherPath, matlabExecutable, matlabLauncherScriptPath);
  const content = [
    '@echo off',
    'REM NeuroPredict EEGLAB manual checkpoint launcher.',
    `REM Manual checkpoint: ${checkpoint.label}`,
    `REM Task package: ${packagePath}`,
    `set "MATLAB_EXE=${matlabExecutable}"`,
    `set "EEGLAB_PATH=${eeglabPath}"`,
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${quoteCmdPath(powershellLauncherPath)}`,
    '',
  ].join('\r\n');

  fs.writeFileSync(launcherPath, content, 'utf8');
  return launcherPath;
}

function exportManualLaunchPackage(
  paths: AppPaths,
  task: PreprocessTaskRow,
  taskPackage: PreprocessTaskPackage,
  checkpoint: PreprocessManualCheckpoint,
  condition: ManualFileTaskCondition | null,
  saveBridge: ManualSaveBridge,
): string {
  const outputDir = path.join(paths.outputsRoot, 'preprocess', task.batch_id ?? 'manual');
  fs.mkdirSync(outputDir, { recursive: true });
  const packageSuffix = condition ? `-${condition}` : '';
  const packagePath = path.join(outputDir, `${task.id}${packageSuffix}-manual-package.json`);
  const runtimeTaskPackage: PreprocessTaskPackage = {
    ...taskPackage,
    baselineRawCntFiles: restingPreprocessRawFiles(taskPackage.baselineRawCntFiles),
  };
  const payload: ManualLaunchExport = {
    schemaVersion: 1,
    exportedAt: nowIso(),
    taskId: task.id,
    patientId: task.patient_id ?? runtimeTaskPackage.patientId,
    batchId: task.batch_id,
    currentManualCheckpoint: checkpoint,
    manualSave: saveBridge,
    taskPackage: runtimeTaskPackage,
  };

  fs.writeFileSync(packagePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return packagePath;
}

function matlabStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function commandDoubleQuoted(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function matlabEntryScriptContents(): string {
  return [
    'function run_preprocess_task(taskPackagePath)',
    '% Auto-generated by NeuroPredict.',
    '% EEGLAB performs the EEG preprocessing. NeuroPredict only launches and records this run.',
    "if nargin < 1 || isempty(taskPackagePath)",
    "    error('NeuroPredict:MissingTaskPackage', 'taskPackagePath is required.');",
    'end',
    'rawText = fileread(taskPackagePath);',
    'task = jsondecode(rawText);',
    'pkg = task.taskPackage;',
    'params = pkg.parameters;',
    "fprintf('NeuroPredict preprocessing task: %s\\n', char(task.taskId));",
    "fprintf('Patient: %s\\n', char(task.patientId));",
    "if isfield(task, 'matlab') && isfield(task.matlab, 'eeglabPath')",
    "    eeglabPath = char(string(task.matlab.eeglabPath));",
    "    if ~isempty(eeglabPath) && exist(eeglabPath, 'dir') == 7",
    '        addpath(eeglabPath);',
    '    end',
    'end',
    "if exist('eeglab', 'file') ~= 2",
    "    error('NeuroPredict:EEGLABMissing', 'EEGLAB is not on the MATLAB path. Configure EEGLAB path in NeuroPredict.');",
    'end',
    "outputRoot = fullfile(fileparts(taskPackagePath), 'processed', char(string(pkg.patientId)));",
    "if exist(outputRoot, 'dir') ~= 7",
    '    mkdir(outputRoot);',
    'end',
    'np_write_instructions(outputRoot);',
    'rawFiles = np_json_strings(pkg.baselineRawCntFiles);',
    'if isempty(rawFiles)',
    "    error('NeuroPredict:NoRawFiles', 'No baseline raw EEG files were found in the task package.');",
    'end',
    "[ALLEEG, EEG, CURRENTSET, ALLCOM] = eeglab('nogui'); %#ok<ASGLU,NASGU>",
    'for fileIndex = 1:numel(rawFiles)',
    '    rawFile = rawFiles{fileIndex};',
    '    [EEG, baseName] = np_load_eeg(rawFile);',
    '    EEG = eeg_checkset(EEG);',
    "    EEG.setname = [baseName '_neuro_preprocess'];",
    "    electrodeLocationFile = '';",
    "    if isfield(task, 'matlab') && isfield(task.matlab, 'electrodeLocationFile')",
    '        electrodeLocationFile = char(string(task.matlab.electrodeLocationFile));',
    '    end',
    "    if ~isempty(electrodeLocationFile) && exist(electrodeLocationFile, 'file') == 2",
    "        EEG = pop_chanedit(EEG, 'lookup', electrodeLocationFile);",
    '        EEG = eeg_checkset(EEG);',
    '    end',
    '    emptyChannels = np_existing_channels(EEG, np_json_strings(params.selectedEmptyChannels));',
    '    if ~isempty(emptyChannels)',
    "        EEG = pop_select(EEG, 'nochannel', emptyChannels);",
    '        EEG = eeg_checkset(EEG);',
    '    end',
    '    targetRate = double(params.downsampleRate);',
    '    if ~isnan(targetRate) && targetRate > 0 && abs(double(EEG.srate) - targetRate) > 0.01',
    '        EEG = pop_resample(EEG, targetRate);',
    '        EEG = eeg_checkset(EEG);',
    '    end',
    '    highPass = double(params.highPassHz);',
    '    lowPass = double(params.lowPassHz);',
    '    notchHz = double(params.notchHz);',
    '    if ~isnan(highPass) && highPass > 0',
    '        EEG = pop_eegfiltnew(EEG, highPass, []);',
    '        EEG = eeg_checkset(EEG);',
    '    end',
    '    if ~isnan(lowPass) && lowPass > 0',
    '        EEG = pop_eegfiltnew(EEG, [], lowPass);',
    '        EEG = eeg_checkset(EEG);',
    '    end',
    '    if ~isnan(notchHz) && notchHz > 0',
    '        EEG = pop_eegfiltnew(EEG, max(notchHz - 1, 0.1), notchHz + 1, [], 1);',
    '        EEG = eeg_checkset(EEG);',
    '    end',
    "    stage01Path = fullfile(outputRoot, [baseName '_stage01_before_bad_segment.set']);",
    "    stage02Path = fullfile(outputRoot, [baseName '_stage02_after_bad_segment.set']);",
    "    stage03Path = fullfile(outputRoot, [baseName '_stage03_before_ica_artifact.set']);",
    "    stage04Path = fullfile(outputRoot, [baseName '_stage04_after_ica_artifact.set']);",
    "    finalPath = fullfile(outputRoot, [baseName '_preprocessed_final.set']);",
    "    if exist(stage04Path, 'file') == 2",
    '        EEG = np_load_set(stage04Path);',
    '        EEG = np_rereference(EEG, params.referenceMode);',
    '        np_save_set(EEG, finalPath);',
    "        fprintf('Saved final preprocessed EEG: %s\\n', finalPath);",
    "    elseif exist(stage02Path, 'file') == 2",
    '        EEG = np_load_set(stage02Path);',
    '        badChannels = np_existing_channels(EEG, np_json_strings(params.selectedBadChannels));',
    '        badIdx = np_channel_indices(EEG, badChannels);',
    '        if ~isempty(badIdx)',
    "            EEG = pop_interp(EEG, badIdx, 'spherical');",
    '            EEG = eeg_checkset(EEG);',
    '        end',
    "        EEG = pop_runica(EEG, 'icatype', 'runica', 'extended', 1, 'interrupt', 'off');",
    '        EEG = eeg_checkset(EEG);',
    '        np_save_set(EEG, stage03Path);',
    "        fprintf('Saved ICA-ready EEG for manual artifact rejection: %s\\n', stage03Path);",
    '    else',
    '        np_save_set(EEG, stage01Path);',
    "        fprintf('Saved EEG for manual bad-segment rejection: %s\\n', stage01Path);",
    '    end',
    'end',
    "fprintf('NeuroPredict EEGLAB preprocessing run finished.\\n');",
    'end',
    '',
    'function [EEG, baseName] = np_load_eeg(filePath)',
    '    [folder, name, ext] = fileparts(filePath);',
    '    baseName = name;',
    '    switch lower(ext)',
    "        case '.cnt'",
    "            EEG = pop_loadcnt(filePath, 'dataformat', 'auto');",
    "        case '.set'",
    "            EEG = pop_loadset('filename', [name ext], 'filepath', folder);",
    "        case {'.edf', '.bdf'}",
    '            EEG = pop_biosig(filePath);',
    '        otherwise',
    "            error('NeuroPredict:UnsupportedEEGFormat', 'Unsupported EEG file format: %s', ext);",
    '    end',
    'end',
    '',
    'function EEG = np_load_set(setPath)',
    '    [folder, name, ext] = fileparts(setPath);',
    "    EEG = pop_loadset('filename', [name ext], 'filepath', folder);",
    '    EEG = eeg_checkset(EEG);',
    'end',
    '',
    'function np_save_set(EEG, setPath)',
    '    [folder, name] = fileparts(setPath);',
    "    if exist(folder, 'dir') ~= 7",
    '        mkdir(folder);',
    '    end',
    "    pop_saveset(EEG, 'filename', [name '.set'], 'filepath', folder);",
    'end',
    '',
    'function labels = np_json_strings(value)',
    '    labels = {};',
    '    if nargin < 1 || isempty(value)',
    '        return;',
    '    end',
    '    if iscell(value)',
    "        labels = cellfun(@(item) char(string(item)), value, 'UniformOutput', false);",
    '    elseif isstring(value)',
    '        labels = cellstr(value);',
    '    elseif ischar(value)',
    '        labels = {value};',
    '    else',
    '        try',
    '            labels = cellstr(string(value));',
    '        catch',
    '            labels = {};',
    '        end',
    '    end',
    "    labels = labels(~cellfun(@(item) isempty(strtrim(item)), labels));",
    'end',
    '',
    'function existing = np_existing_channels(EEG, requested)',
    '    existing = {};',
    "    if isempty(requested) || ~isfield(EEG, 'chanlocs')",
    '        return;',
    '    end',
    '    eegLabels = {EEG.chanlocs.labels};',
    '    eegLabelsLower = lower(eegLabels);',
    '    for idx = 1:numel(requested)',
    '        label = char(string(requested{idx}));',
    '        matchIndex = find(strcmpi(eegLabelsLower, lower(label)), 1);',
    '        if ~isempty(matchIndex)',
    '            existing{end + 1} = eegLabels{matchIndex}; %#ok<AGROW>',
    '        end',
    '    end',
    'end',
    '',
    'function indices = np_channel_indices(EEG, requested)',
    '    indices = [];',
    '    if isempty(requested)',
    '        return;',
    '    end',
    '    eegLabels = {EEG.chanlocs.labels};',
    '    for idx = 1:numel(requested)',
    '        matchIndex = find(strcmpi(eegLabels, requested{idx}), 1);',
    '        if ~isempty(matchIndex)',
    '            indices(end + 1) = matchIndex; %#ok<AGROW>',
    '        end',
    '    end',
    'end',
    '',
    'function EEG = np_rereference(EEG, referenceMode)',
    '    mode = char(string(referenceMode));',
    "    if strcmpi(mode, 'm1m2')",
    "        refIdx = np_channel_indices(EEG, {'M1', 'M2'});",
    '        if numel(refIdx) < 2',
    "            error('NeuroPredict:MissingReferenceChannels', 'M1/M2 reference was requested but M1 and M2 were not both present.');",
    '        end',
    '        EEG = pop_reref(EEG, refIdx);',
    '    else',
    '        EEG = pop_reref(EEG, []);',
    '    end',
    '    EEG = eeg_checkset(EEG);',
    'end',
    '',
    'function np_write_instructions(outputRoot)',
    "    instructionPath = fullfile(outputRoot, 'manual_preprocess_instructions.txt');",
    "    fid = fopen(instructionPath, 'w');",
    '    if fid < 0',
    '        return;',
    '    end',
    "    fprintf(fid, 'NeuroPredict EEGLAB manual checkpoints\\n');",
    "    fprintf(fid, '1. After stage01, open *_stage01_before_bad_segment.set in EEGLAB, reject bad segments, and save as *_stage02_after_bad_segment.set.\\n');",
    "    fprintf(fid, '2. Run this MATLAB task again. It will interpolate selected bad channels and run ICA, then save *_stage03_before_ica_artifact.set.\\n');",
    "    fprintf(fid, '3. Open *_stage03_before_ica_artifact.set, remove artifact ICA components, and save as *_stage04_after_ica_artifact.set.\\n');",
    "    fprintf(fid, '4. Run this MATLAB task again. It will rereference and save *_preprocessed_final.set.\\n');",
    '    fclose(fid);',
    'end',
    '',
  ].join('\n');
}

function ensureMatlabEntryScript(paths: AppPaths): string {
  const scriptDir = path.join(paths.outputsRoot, 'preprocess', 'matlab');
  fs.mkdirSync(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, 'run_preprocess_task.m');
  fs.writeFileSync(scriptPath, matlabEntryScriptContents(), 'utf8');
  return scriptPath;
}

function buildMatlabBatchExpression(scriptPath: string, packagePath: string): string {
  return `addpath('${matlabStringLiteral(path.dirname(scriptPath))}'); run_preprocess_task('${matlabStringLiteral(packagePath)}')`;
}

function buildMatlabCommand(matlabExecutable: string, scriptPath: string, packagePath: string): string {
  return `${commandDoubleQuoted(matlabExecutable)} -batch ${commandDoubleQuoted(buildMatlabBatchExpression(scriptPath, packagePath))}`;
}

function buildMatlabArgs(scriptPath: string, packagePath: string): string[] {
  return ['-batch', buildMatlabBatchExpression(scriptPath, packagePath)];
}

function defaultExecuteMatlab(matlabExecutable: string, args: string[]): Promise<MatlabProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(matlabExecutable, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function exportMatlabExecutionPackage(
  paths: AppPaths,
  task: PreprocessTaskRow,
  taskPackage: PreprocessTaskPackage,
  matlabExecutable: string,
  eeglabPath: string,
  electrodeLocationFile: string,
  scriptPath: string,
  command: string,
): string {
  const outputDir = path.join(paths.outputsRoot, 'preprocess', task.batch_id ?? 'matlab');
  fs.mkdirSync(outputDir, { recursive: true });
  const packagePath = path.join(outputDir, `${task.id}-matlab-execution.json`);
  const runtimeTaskPackage: PreprocessTaskPackage = {
    ...taskPackage,
    baselineRawCntFiles: restingPreprocessRawFiles(taskPackage.baselineRawCntFiles),
  };
  const payload: MatlabExecutionExport = {
    schemaVersion: 1,
    exportedAt: nowIso(),
    taskId: task.id,
    patientId: task.patient_id ?? runtimeTaskPackage.patientId,
    batchId: task.batch_id,
    matlab: {
      matlabExecutable,
      eeglabPath,
      electrodeLocationFile,
      entryScriptPath: scriptPath,
      command,
    },
    taskPackage: runtimeTaskPackage,
  };

  fs.writeFileSync(packagePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return packagePath;
}

function baselineRawCntFiles(db: Database, patientId: string): string[] {
  const rawFiles = listDataAssets(db, { patientId })
    .filter((asset) => asset.stage === '基线' && asset.assetType === 'raw_eeg_cnt' && asset.existsOnDisk)
    .map((asset) => asset.filePath)
    .sort((left, right) => left.localeCompare(right));

  return restingPreprocessRawFiles(rawFiles);
}

function classifyPreprocessOutputFile(filePath: string): PreprocessOutputFileKind {
  const fileName = path.basename(filePath).toLowerCase();
  const extension = path.extname(fileName).toLowerCase();

  if (fileName === 'manual_preprocess_instructions.txt') return 'manual_instructions';
  if (fileName.endsWith('-matlab-execution.json')) return 'matlab_package';
  if (fileName.includes('preprocess_params')) return 'params';
  if (fileName.includes('preprocess_status') || fileName.includes('status')) return 'status';
  if (fileName.endsWith('_preprocessed_final.set')) return 'final_set';
  if (fileName.endsWith('_preprocessed_final.fdt')) return 'final_fdt';
  if (extension === '.set') return 'intermediate_set';
  if (extension === '.fdt') return 'intermediate_fdt';
  if (extension === '.log' || extension === '.txt') return 'log';
  return 'other';
}

function outputFileFromPath(filePath: string): PreprocessOutputFile | null {
  if (!fs.existsSync(filePath)) return null;
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) return null;

  return {
    filePath,
    fileName: path.basename(filePath),
    kind: classifyPreprocessOutputFile(filePath),
    fileSize: stats.size,
    existsOnDisk: true,
  };
}

function collectFilesRecursive(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const stats = fs.statSync(rootDir);
  if (!stats.isDirectory()) return [];

  const discovered: string[] = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      discovered.push(...collectFilesRecursive(entryPath));
    } else if (entry.isFile()) {
      discovered.push(entryPath);
    }
  }

  return discovered;
}

function addExistingFilePath(target: Set<string>, filePath: unknown): void {
  if (typeof filePath === 'string' && filePath.trim() && fs.existsSync(filePath)) {
    target.add(filePath);
  }
}

export function getPreprocessOutputs(db: Database, paths: AppPaths, patientId: string): PreprocessOutputSummary {
  const patient = queryOne<{ id: string; subject_code: string }>(
    db,
    'SELECT id, subject_code FROM patients WHERE id = ?',
    [patientId],
  );

  if (!patient) {
    return {
      patientId,
      subjectCode: '',
      latestTaskId: null,
      taskStatus: null,
      outputDirectories: [],
      files: [],
      warnings: ['未找到患者。'],
    };
  }

  const tasks = queryAll<PreprocessTaskRow & { created_at: string }>(
    db,
    `SELECT id, type, patient_id, batch_id, status, input_json, output_json, created_at
     FROM tasks
     WHERE type = 'preprocess' AND patient_id = ?
     ORDER BY created_at DESC`,
    [patientId],
  );
  const latestTask = tasks[0] ?? null;
  const outputDirectories = new Set<string>();
  const outputFiles = new Set<string>();

  for (const task of tasks) {
    const taskPackage = parseTaskPackage(task.input_json);
    const outputRecord = parseJsonRecord(task.output_json);
    const batchId = task.batch_id ?? taskPackage?.batchId ?? null;

    if (batchId) {
      const batchRoot = path.join(paths.outputsRoot, 'preprocess', batchId);
      const patientOutputDir = path.join(batchRoot, 'processed', patientId);
      outputDirectories.add(patientOutputDir);

      for (const filePath of collectFilesRecursive(patientOutputDir)) {
        outputFiles.add(filePath);
      }

      addExistingFilePath(outputFiles, path.join(batchRoot, `${task.id}-matlab-execution.json`));
      addExistingFilePath(outputFiles, path.join(batchRoot, `${task.id}-manual-package.json`));
    }

    addExistingFilePath(outputFiles, outputRecord.matlabPackagePath);
    addExistingFilePath(outputFiles, outputRecord.manualPackagePath);
    addExistingFilePath(outputFiles, outputRecord.matlabScriptPath);
  }

  const files = Array.from(outputFiles)
    .map(outputFileFromPath)
    .filter((file): file is PreprocessOutputFile => Boolean(file))
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.filePath.localeCompare(right.filePath));
  const warnings: string[] = [];

  if (!latestTask) {
    warnings.push('未找到该患者的预处理任务。');
  }

  return {
    patientId,
    subjectCode: patient.subject_code,
    latestTaskId: latestTask?.id ?? null,
    taskStatus: (latestTask?.status as BackendTaskStatus | undefined) ?? null,
    outputDirectories: Array.from(outputDirectories).sort((left, right) => left.localeCompare(right)),
    files,
    warnings,
  };
}

function createSteps(input: PreprocessBatchInput): PreprocessStep[] {
  return [
    {
      id: 'import_raw_eeg',
      label: '导入 CNT 原始 EEG',
      mode: 'matlab_batch',
      canBatch: true,
      status: 'planned',
    },
    {
      id: 'electrode_location',
      label: '电极定位',
      mode: 'matlab_batch',
      canBatch: true,
      status: 'planned',
      note: '默认使用 64 导定位文件，保留 HEO/VEO/EKG/EMG 等辅助通道供用户选择移除。',
    },
    {
      id: 'remove_empty_channels',
      label: '移除空电极',
      mode: 'matlab_batch',
      canBatch: true,
      status: 'planned',
      selectedChannels: input.selectedEmptyChannels,
    },
    {
      id: 'downsample',
      label: '降采样率',
      mode: 'matlab_batch',
      canBatch: true,
      status: 'planned',
      note: `${input.downsampleRate} Hz`,
    },
    {
      id: 'filter',
      label: '滤波',
      mode: 'matlab_batch',
      canBatch: true,
      status: 'planned',
      note: `${input.highPassHz}-${input.lowPassHz} Hz, notch ${input.notchHz} Hz`,
    },
    {
      id: 'manual_bad_segment_rejection',
      label: '人工去除坏段',
      mode: 'manual_eeglab',
      canBatch: false,
      status: 'waiting_manual',
      note: '需要打开 EEGLAB 交互窗口，由用户确认坏段。',
    },
    {
      id: 'interpolate_bad_channels',
      label: '插值坏导',
      mode: 'matlab_batch',
      canBatch: false,
      status: input.selectedBadChannels.length > 0 ? 'blocked' : 'skipped',
      selectedChannels: input.selectedBadChannels,
      note: input.selectedBadChannels.length > 0 ? '等待坏段人工处理完成后执行。' : '未选择坏导，默认跳过。',
    },
    {
      id: 'run_ica',
      label: '跑 ICA',
      mode: 'matlab_batch',
      canBatch: true,
      status: 'blocked',
      note: '等待坏段人工处理和可选坏导插值完成后执行。',
    },
    {
      id: 'manual_ica_artifact_rejection',
      label: '人工去除 ICA 伪迹',
      mode: 'manual_eeglab',
      canBatch: false,
      status: 'blocked',
      note: 'ICA 完成后需要用户在 EEGLAB 中选择伪迹成分。',
    },
    {
      id: 'rereference_and_save',
      label: '重参考并保存',
      mode: 'matlab_batch',
      canBatch: true,
      status: 'blocked',
      note: input.referenceMode === 'm1m2' ? '使用 M1/M2 作为参考电极。' : '使用平均参考。',
    },
  ];
}

function createTaskPackage(db: Database, input: PreprocessBatchInput, patientId: string, batchId: string): PreprocessTaskPackage {
  const rawFiles = baselineRawCntFiles(db, patientId);
  const warnings = rawFiles.length === 0 ? ['未在数据与文档库中找到该患者的基线 CNT 原始 EEG 文件。'] : [];

  return {
    schemaVersion: 1,
    type: 'eeg_preprocess_task_package',
    displayName: '静息态 EEG 预处理',
    manualAction: '打开 EEGLAB 完成人工去除坏段',
    batchId,
    patientId,
    baselineRawCntFiles: rawFiles,
    parameters: {
      selectedEmptyChannels: input.selectedEmptyChannels,
      selectedBadChannels: input.selectedBadChannels,
      referenceMode: input.referenceMode,
      downsampleRate: input.downsampleRate,
      highPassHz: input.highPassHz,
      lowPassHz: input.lowPassHz,
      notchHz: input.notchHz,
    },
    steps: createSteps(input),
    manualCheckpoints: [
      {
        stepId: 'manual_bad_segment_rejection',
        label: '人工去除坏段',
        status: 'waiting_manual',
        actionLabel: '打开 EEGLAB 完成人工去除坏段',
      },
      {
        stepId: 'manual_ica_artifact_rejection',
        label: '人工去除 ICA 伪迹',
        status: 'blocked',
        actionLabel: '打开 EEGLAB 完成人工去除 ICA 伪迹',
      },
    ],
    executor: {
      matlab: 'pending',
      eeglabWindow: 'external_or_embedded_pending',
    },
    warnings,
  };
}

function setStepStatus(taskPackage: PreprocessTaskPackage, stepId: string, status: PreprocessStepStatus): void {
  const step = taskPackage.steps.find((item) => item.id === stepId);

  if (step) {
    step.status = status;
  }
}

function setCheckpointStatus(
  taskPackage: PreprocessTaskPackage,
  stepId: string,
  status: PreprocessManualCheckpoint['status'],
): void {
  const checkpoint = taskPackage.manualCheckpoints.find((item) => item.stepId === stepId);

  if (checkpoint) {
    checkpoint.status = status;
  }
}

function checkpointStatus(taskPackage: PreprocessTaskPackage, stepId: string): PreprocessManualCheckpoint['status'] | null {
  return taskPackage.manualCheckpoints.find((item) => item.stepId === stepId)?.status ?? null;
}

function completeInitialBatchSteps(taskPackage: PreprocessTaskPackage): void {
  for (const stepId of ['import_raw_eeg', 'electrode_location', 'remove_empty_channels', 'downsample', 'filter']) {
    setStepStatus(taskPackage, stepId, 'completed');
  }
}

function updateTaskForManualProgress(
  db: Database,
  taskId: string,
  taskPackage: PreprocessTaskPackage,
  status: Extract<BackendTaskStatus, 'queued' | 'waiting_manual' | 'completed'>,
): void {
  const existingOutput = queryOne<{ output_json: string }>(db, 'SELECT output_json FROM tasks WHERE id = ?', [taskId]);
  const output = {
    ...parseJsonRecord(existingOutput?.output_json ?? '{}'),
    displayName: taskPackage.displayName,
    manualAction: taskPackage.manualAction,
  };

  db.run(
    `UPDATE tasks
     SET status = ?, input_json = ?, output_json = ?, finished_at = ?
     WHERE id = ?`,
    [
      status,
      JSON.stringify(taskPackage),
      JSON.stringify(output),
      status === 'completed' ? nowIso() : null,
      taskId,
    ],
  );
}

function advancePreprocessAfterMatlabRun(
  db: Database,
  paths: AppPaths,
  task: PreprocessTaskRow,
  taskPackage: PreprocessTaskPackage,
): string {
  if (!task.patient_id) {
    return 'MATLAB 预处理已执行，但任务缺少患者信息，未能推进状态。';
  }

  if (allPreprocessOutputsExist(paths, task, taskPackage, 'preprocessed_final')) {
    completeInitialBatchSteps(taskPackage);
    setStepStatus(taskPackage, 'manual_bad_segment_rejection', 'completed');
    setCheckpointStatus(taskPackage, 'manual_bad_segment_rejection', 'completed');
    setStepStatus(
      taskPackage,
      'interpolate_bad_channels',
      taskPackage.parameters.selectedBadChannels.length > 0 ? 'completed' : 'skipped',
    );
    setStepStatus(taskPackage, 'run_ica', 'completed');
    setStepStatus(taskPackage, 'manual_ica_artifact_rejection', 'completed');
    setCheckpointStatus(taskPackage, 'manual_ica_artifact_rejection', 'completed');
    setStepStatus(taskPackage, 'rereference_and_save', 'completed');
    taskPackage.manualAction = '预处理已完成';

    updateTaskForManualProgress(db, task.id, taskPackage, 'completed');
    setPreprocessWorkflowStatus(db, task.patient_id, '已完成');
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'info',
      source: 'matlab',
      message: '预处理任务已完成，已生成最终预处理文件。',
    });

    return 'MATLAB 预处理已执行，最终预处理文件已生成。';
  }

  if (checkpointStatus(taskPackage, 'manual_ica_artifact_rejection') === 'completed') {
    completeInitialBatchSteps(taskPackage);
    setStepStatus(taskPackage, 'manual_bad_segment_rejection', 'completed');
    setCheckpointStatus(taskPackage, 'manual_bad_segment_rejection', 'completed');
    setStepStatus(
      taskPackage,
      'interpolate_bad_channels',
      taskPackage.parameters.selectedBadChannels.length > 0 ? 'completed' : 'skipped',
    );
    setStepStatus(taskPackage, 'run_ica', 'completed');
    setStepStatus(taskPackage, 'manual_ica_artifact_rejection', 'completed');
    setCheckpointStatus(taskPackage, 'manual_ica_artifact_rejection', 'completed');
    setStepStatus(taskPackage, 'rereference_and_save', 'planned');
    taskPackage.manualAction = '运行 MATLAB 完成重参考和最终保存';

    updateTaskForManualProgress(db, task.id, taskPackage, 'queued');
    setPreprocessWorkflowStatus(db, task.patient_id, '处理中');
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'warning',
      source: 'matlab',
      message: 'MATLAB 已执行重参考流程，但尚未检测到全部最终预处理文件，请继续运行 MATLAB 完成重参考和最终保存。',
    });

    return 'MATLAB 已执行重参考流程，但尚未检测到全部最终预处理文件。请继续运行 MATLAB 完成重参考和最终保存。';
  }

  if (allPreprocessOutputsExist(paths, task, taskPackage, 'stage03_before_ica_artifact')) {
    completeInitialBatchSteps(taskPackage);
    setStepStatus(taskPackage, 'manual_bad_segment_rejection', 'completed');
    setCheckpointStatus(taskPackage, 'manual_bad_segment_rejection', 'completed');
    setStepStatus(
      taskPackage,
      'interpolate_bad_channels',
      taskPackage.parameters.selectedBadChannels.length > 0 ? 'completed' : 'skipped',
    );
    setStepStatus(taskPackage, 'run_ica', 'completed');
    setStepStatus(taskPackage, 'manual_ica_artifact_rejection', 'waiting_manual');
    setCheckpointStatus(taskPackage, 'manual_ica_artifact_rejection', 'waiting_manual');
    setStepStatus(taskPackage, 'rereference_and_save', 'blocked');
    taskPackage.manualAction = '打开 EEGLAB 完成人工去除 ICA 伪迹';

    updateTaskForManualProgress(db, task.id, taskPackage, 'waiting_manual');
    setPreprocessWorkflowStatus(db, task.patient_id, '等待人工处理');
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'info',
      source: 'matlab',
      message: 'MATLAB 已生成 ICA 人工处理文件，等待人工去除 ICA 伪迹。',
    });

    return 'MATLAB 预处理已执行，已生成 ICA 人工处理文件。请继续人工去除 ICA 伪迹。';
  }

  if (checkpointStatus(taskPackage, 'manual_bad_segment_rejection') === 'completed') {
    completeInitialBatchSteps(taskPackage);
    setStepStatus(taskPackage, 'manual_bad_segment_rejection', 'completed');
    setCheckpointStatus(taskPackage, 'manual_bad_segment_rejection', 'completed');
    setStepStatus(
      taskPackage,
      'interpolate_bad_channels',
      taskPackage.parameters.selectedBadChannels.length > 0 ? 'planned' : 'skipped',
    );
    setStepStatus(taskPackage, 'run_ica', 'planned');
    setStepStatus(taskPackage, 'manual_ica_artifact_rejection', 'blocked');
    setCheckpointStatus(taskPackage, 'manual_ica_artifact_rejection', 'blocked');
    setStepStatus(taskPackage, 'rereference_and_save', 'blocked');
    taskPackage.manualAction = '运行 MATLAB 完成坏导插值和 ICA';

    updateTaskForManualProgress(db, task.id, taskPackage, 'queued');
    setPreprocessWorkflowStatus(db, task.patient_id, '处理中');
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'warning',
      source: 'matlab',
      message: 'MATLAB 已执行 ICA 流程，但尚未检测到全部 ICA 人工处理输入文件，请继续运行 MATLAB 完成坏导插值和 ICA。',
    });

    return 'MATLAB 已执行 ICA 流程，但尚未检测到全部 ICA 人工处理输入文件。请继续运行 MATLAB 完成坏导插值和 ICA。';
  }

  if (allPreprocessOutputsExist(paths, task, taskPackage, 'stage01_before_bad_segment')) {
    completeInitialBatchSteps(taskPackage);
    setStepStatus(taskPackage, 'manual_bad_segment_rejection', 'waiting_manual');
    setCheckpointStatus(taskPackage, 'manual_bad_segment_rejection', 'waiting_manual');
    taskPackage.manualAction = '打开 EEGLAB 完成人工去除坏段';

    updateTaskForManualProgress(db, task.id, taskPackage, 'waiting_manual');
    setPreprocessWorkflowStatus(db, task.patient_id, '等待人工处理');
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'info',
      source: 'matlab',
      message: 'MATLAB 已生成坏段人工处理文件，等待人工去除坏段。',
    });

    return 'MATLAB 预处理已执行，已生成坏段人工处理文件。请继续人工去除坏段。';
  }

  return 'MATLAB 预处理已执行。请按输出目录中的 manual_preprocess_instructions.txt 完成人工节点后再次运行。';
}

export async function completePreprocessManualStep(
  db: Database,
  paths: AppPaths,
  taskId: string,
  options: ManualCompletionOptions = {},
): Promise<ApiResult> {
  const manualTarget = parseManualFileTaskId(taskId);
  const task = getPreprocessTask(db, manualTarget.taskId);

  if (!task || task.type !== 'preprocess') {
    return { ok: false, message: '未找到预处理任务。' };
  }

  if (!task.patient_id) {
    return { ok: false, message: '预处理任务缺少患者信息。' };
  }

  const taskPackage = parseTaskPackage(task.input_json);

  if (!taskPackage) {
    return { ok: false, message: '预处理任务包格式不正确。' };
  }

  const currentCheckpoint = currentManualCheckpoint(taskPackage);

  if (!currentCheckpoint) {
    return { ok: false, message: '当前没有等待完成的人工节点。' };
  }

  const selectedTaskPackage = taskPackageForManualCondition(taskPackage, manualTarget.condition);

  if (manualTarget.condition && selectedTaskPackage.baselineRawCntFiles.length === 0) {
    return { ok: false, message: `当前预处理任务没有${manualConditionLabel(manualTarget.condition)}静息态文件。` };
  }

  if (currentCheckpoint.stepId === 'manual_bad_segment_rejection') {
    const saveError = await requestManualCheckpointSaveIfAvailable(
      db,
      paths,
      task,
      selectedTaskPackage,
      currentCheckpoint,
      manualTarget.condition,
      options,
    );

    if (saveError) {
      return saveError;
    }

    const validationError = validateManualCheckpointOutput(db, paths, task, selectedTaskPackage, currentCheckpoint);

    if (validationError) {
      return validationError;
    }

    if (manualTarget.condition && !allPreprocessOutputsExist(paths, task, taskPackage, manualCheckpointOutputSuffix(currentCheckpoint))) {
      const label = manualConditionLabel(manualTarget.condition);
      addTaskLog(db, {
        taskId: task.id,
        patientId: task.patient_id,
        level: 'info',
        source: 'eeglab',
        message: `人工节点已完成: 人工去除坏段（${label} ${manualTarget.condition}）。`,
      });
      return {
        ok: true,
        message: `人工节点已完成：人工去除坏段（${label} ${manualTarget.condition}）。请继续处理剩余静息态文件。`,
      };
    }

    completeInitialBatchSteps(taskPackage);
    setStepStatus(taskPackage, 'manual_bad_segment_rejection', 'completed');
    setCheckpointStatus(taskPackage, 'manual_bad_segment_rejection', 'completed');
    setStepStatus(
      taskPackage,
      'interpolate_bad_channels',
      taskPackage.parameters.selectedBadChannels.length > 0 ? 'planned' : 'skipped',
    );
    setStepStatus(taskPackage, 'run_ica', 'planned');
    setStepStatus(taskPackage, 'manual_ica_artifact_rejection', 'blocked');
    setCheckpointStatus(taskPackage, 'manual_ica_artifact_rejection', 'blocked');
    taskPackage.manualAction = '运行 MATLAB 完成坏导插值和 ICA';

    updateTaskForManualProgress(db, task.id, taskPackage, 'queued');
    setPreprocessWorkflowStatus(db, task.patient_id, '处理中');
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'info',
      source: 'eeglab',
      message: '人工节点已完成: 人工去除坏段。',
    });
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'info',
      source: 'matlab',
      message: '等待 MATLAB 执行: 坏导插值和 ICA。',
    });

    return { ok: true, message: '人工节点已完成：人工去除坏段。下一步请运行 MATLAB 完成坏导插值和 ICA。' };
  }

  if (currentCheckpoint.stepId === 'manual_ica_artifact_rejection') {
    const saveError = await requestManualCheckpointSaveIfAvailable(
      db,
      paths,
      task,
      selectedTaskPackage,
      currentCheckpoint,
      manualTarget.condition,
      options,
    );

    if (saveError) {
      return saveError;
    }

    const validationError = validateManualCheckpointOutput(db, paths, task, selectedTaskPackage, currentCheckpoint);

    if (validationError) {
      return validationError;
    }

    if (manualTarget.condition && !allPreprocessOutputsExist(paths, task, taskPackage, manualCheckpointOutputSuffix(currentCheckpoint))) {
      const label = manualConditionLabel(manualTarget.condition);
      addTaskLog(db, {
        taskId: task.id,
        patientId: task.patient_id,
        level: 'info',
        source: 'eeglab',
        message: `人工节点已完成: 人工去除 ICA 伪迹（${label} ${manualTarget.condition}）。`,
      });
      return {
        ok: true,
        message: `人工节点已完成：人工去除 ICA 伪迹（${label} ${manualTarget.condition}）。请继续处理剩余静息态文件。`,
      };
    }

    setStepStatus(taskPackage, 'manual_ica_artifact_rejection', 'completed');
    setCheckpointStatus(taskPackage, 'manual_ica_artifact_rejection', 'completed');
    setStepStatus(taskPackage, 'rereference_and_save', 'planned');
    taskPackage.manualAction = '运行 MATLAB 完成重参考和最终保存';

    updateTaskForManualProgress(db, task.id, taskPackage, 'queued');
    setPreprocessWorkflowStatus(db, task.patient_id, '处理中');
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'info',
      source: 'eeglab',
      message: '人工节点已完成: 人工去除 ICA 伪迹。',
    });
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'info',
      source: 'matlab',
      message: '等待 MATLAB 执行: 重参考和最终保存。',
    });

    return { ok: true, message: '人工节点已完成：人工去除 ICA 伪迹。下一步请运行 MATLAB 完成重参考和最终保存。' };
  }

  return { ok: false, message: '未知的人工节点，无法推进预处理任务。' };
}

export async function launchPreprocessManualStep(
  db: Database,
  paths: AppPaths,
  taskId: string,
  openPath: (targetPath: string) => Promise<string>,
): Promise<PreprocessManualLaunchResult> {
  const manualTarget = parseManualFileTaskId(taskId);
  const task = getPreprocessTask(db, manualTarget.taskId);

  if (!task || task.type !== 'preprocess') {
    return { ok: false, message: '未找到预处理任务。' };
  }

  if (!task.patient_id) {
    return { ok: false, message: '预处理任务缺少患者信息。' };
  }

  const taskPackage = parseTaskPackage(task.input_json);

  if (!taskPackage) {
    return { ok: false, message: '预处理任务包格式不正确。' };
  }

  const checkpoint = currentManualCheckpoint(taskPackage);

  if (!checkpoint) {
    return { ok: false, message: '当前没有等待打开的人工节点。' };
  }

  const selectedTaskPackage = taskPackageForManualCondition(taskPackage, manualTarget.condition);

  if (manualTarget.condition && selectedTaskPackage.baselineRawCntFiles.length === 0) {
    return { ok: false, message: `当前预处理任务没有${manualConditionLabel(manualTarget.condition)}静息态文件。` };
  }

  const expectedInputPaths = manualCheckpointExpectedInputPaths(paths, task, selectedTaskPackage, checkpoint);
  const checkpointInputPath = manualCheckpointInputPath(paths, task, selectedTaskPackage, checkpoint);

  if (!checkpointInputPath) {
    const expectedSuffix = manualCheckpointInputSuffix(checkpoint);
    const expectedPath = expectedInputPaths[0] ?? expectedSuffix;

    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'warning',
      source: 'app',
      message: `人工节点输入文件尚未生成: ${expectedPath}`,
    });
    return {
      ok: false,
      message: `请先运行 MATLAB 预处理生成人工节点输入文件 (${expectedSuffix})，再唤起 EEGLAB。预期位置：${expectedPath}`,
    };
  }

  const { matlabExecutable, eeglabPath, hasConfiguredPath } = configuredEeglabLaunch(db);

  if (!hasConfiguredPath) {
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'warning',
      source: 'app',
      message: '未配置 MATLAB 可执行文件或 EEGLAB 路径。',
    });
    return { ok: false, message: '请先在环境设置中配置 MATLAB 可执行文件或 EEGLAB 路径。' };
  }

  if (!matlabExecutable || !eeglabPath) {
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'warning',
      source: 'app',
      message: '已配置的 MATLAB 可执行文件或 EEGLAB 路径不存在。',
    });
    return { ok: false, message: '请在环境设置中同时配置有效的 MATLAB 可执行文件和 EEGLAB 路径。' };
  }

  let packagePath: string;
  let launcherPath: string;
  let saveBridge: ManualSaveBridge;

  try {
    saveBridge = manualSaveBridgePaths(paths, task, selectedTaskPackage, checkpoint, manualTarget.condition);
    packagePath = exportManualLaunchPackage(paths, task, selectedTaskPackage, checkpoint, manualTarget.condition, saveBridge);
    launcherPath = writeEeglabLauncher(
      paths,
      task,
      selectedTaskPackage,
      checkpoint,
      manualTarget.condition,
      matlabExecutable,
      eeglabPath,
      packagePath,
      saveBridge,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'error',
      source: 'app',
      message: `导出预处理任务包失败: ${message}`,
    });
    return { ok: false, message: `导出预处理任务包失败：${message}` };
  }

  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'info',
    source: 'app',
    message: `已导出预处理任务包和 EEGLAB 启动脚本: ${packagePath}; ${launcherPath}`,
  });

  const openError = await openPath(launcherPath);

  if (openError) {
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'error',
      source: 'app',
      message: `打开 MATLAB/EEGLAB 失败: ${openError}`,
    });
    return {
      ok: false,
      message: `任务包已导出，但打开 MATLAB/EEGLAB 失败：${openError}`,
      packagePath,
      launchTargetPath: launcherPath,
    };
  }

  db.run(
    `UPDATE tasks
     SET output_json = ?
     WHERE id = ?`,
    [
      JSON.stringify({
        ...parseJsonRecord(task.output_json),
        displayName: taskPackage.displayName,
        manualAction: taskPackage.manualAction,
        manualPackagePath: packagePath,
        launchTargetPath: launcherPath,
        manualSaveStepId: checkpoint.stepId,
        manualSaveRequestPath: saveBridge.requestPath,
        manualSaveDonePath: saveBridge.donePath,
        manualSaveErrorPath: saveBridge.errorPath,
        manualSaveOutputPaths: saveBridge.outputPaths,
        manualSaveByCondition: {
          ...(() => {
            const previous = parseJsonRecord(task.output_json).manualSaveByCondition;
            return previous && typeof previous === 'object' && !Array.isArray(previous)
              ? (previous as Record<string, unknown>)
              : {};
          })(),
          ...(manualTarget.condition
            ? {
                [manualTarget.condition]: {
                  manualSaveStepId: checkpoint.stepId,
                  manualSaveRequestPath: saveBridge.requestPath,
                  manualSaveDonePath: saveBridge.donePath,
                  manualSaveErrorPath: saveBridge.errorPath,
                  manualSaveOutputPaths: saveBridge.outputPaths,
                },
              }
            : {}),
        },
      }),
      task.id,
    ],
  );
  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'info',
    source: 'app',
    message: `已请求打开 MATLAB/EEGLAB: ${launcherPath}（通过启动脚本）`,
  });

  return {
    ok: true,
    message: `已导出预处理任务包并打开 MATLAB/EEGLAB。任务包：${packagePath}`,
    packagePath,
    launchTargetPath: launcherPath,
    manualSaveRequestPath: saveBridge.requestPath,
    manualSaveDonePath: saveBridge.donePath,
    manualSaveErrorPath: saveBridge.errorPath,
    manualSaveOutputPaths: saveBridge.outputPaths,
  };
}

export function preparePreprocessMatlabExecution(
  db: Database,
  paths: AppPaths,
  taskId: string,
): PreprocessMatlabPrepareResult {
  const manualTarget = parseManualFileTaskId(taskId);
  const task = getPreprocessTask(db, manualTarget.taskId);

  if (!task || task.type !== 'preprocess') {
    return { ok: false, message: '未找到预处理任务。' };
  }

  if (!task.patient_id) {
    return { ok: false, message: '预处理任务缺少患者信息。' };
  }

  const taskPackage = parseTaskPackage(task.input_json);

  if (!taskPackage) {
    return { ok: false, message: '预处理任务包格式不正确。' };
  }

  const settings = getSettings(db);
  const matlabExecutable = settings.matlabExecutable.trim();

  if (!matlabExecutable) {
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'warning',
      source: 'matlab',
      message: '未配置 MATLAB 可执行文件，无法准备 MATLAB 执行命令。',
    });
    return { ok: false, message: '请先在环境设置中配置 MATLAB 可执行文件。' };
  }

  if (!fs.existsSync(matlabExecutable)) {
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'warning',
      source: 'matlab',
      message: 'MATLAB 可执行文件路径不存在，无法准备 MATLAB 执行命令。',
    });
    return { ok: false, message: 'MATLAB 可执行文件路径不存在，请检查环境设置。' };
  }

  const validationError = validateMatlabExecutionInputs(db, task, taskPackage, settings);

  if (validationError) {
    return validationError;
  }

  let scriptPath: string;
  let packagePath: string;
  let command: string;

  try {
    scriptPath = ensureMatlabEntryScript(paths);
    const provisionalPackagePath = path.join(paths.outputsRoot, 'preprocess', task.batch_id ?? 'matlab', `${task.id}-matlab-execution.json`);
    command = buildMatlabCommand(matlabExecutable, scriptPath, provisionalPackagePath);
    packagePath = exportMatlabExecutionPackage(
      paths,
      task,
      taskPackage,
      matlabExecutable,
      settings.eeglabPath.trim(),
      settings.defaultElectrodeLocationFile.trim(),
      scriptPath,
      command,
    );
    command = buildMatlabCommand(matlabExecutable, scriptPath, packagePath);
    packagePath = exportMatlabExecutionPackage(
      paths,
      task,
      taskPackage,
      matlabExecutable,
      settings.eeglabPath.trim(),
      settings.defaultElectrodeLocationFile.trim(),
      scriptPath,
      command,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'error',
      source: 'matlab',
      message: `准备 MATLAB 执行入口失败: ${message}`,
    });
    return { ok: false, message: `准备 MATLAB 执行入口失败：${message}` };
  }

  db.run(
    `UPDATE tasks
     SET output_json = ?
     WHERE id = ?`,
    [
      JSON.stringify({
        displayName: taskPackage.displayName,
        manualAction: taskPackage.manualAction,
        matlabScriptPath: scriptPath,
        matlabPackagePath: packagePath,
        matlabCommand: command,
      }),
      task.id,
    ],
  );
  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'info',
    source: 'matlab',
    message: `MATLAB 执行入口已准备: ${scriptPath}`,
  });

  return {
    ok: true,
    message: `MATLAB 执行入口已准备。脚本：${scriptPath}；命令：${command}`,
    scriptPath,
    packagePath,
    command,
  };
}

export async function runPreprocessMatlabExecution(
  db: Database,
  paths: AppPaths,
  taskId: string,
  executeMatlab: MatlabExecutor = defaultExecuteMatlab,
): Promise<PreprocessMatlabRunResult> {
  const manualTarget = parseManualFileTaskId(taskId);
  const prepared = preparePreprocessMatlabExecution(db, paths, manualTarget.taskId);

  if (!prepared.ok) {
    return prepared;
  }

  const task = getPreprocessTask(db, manualTarget.taskId);

  if (!task || task.type !== 'preprocess') {
    return { ok: false, message: '未找到预处理任务。' };
  }

  if (!task.patient_id) {
    return { ok: false, message: '预处理任务缺少患者信息。' };
  }

  if (!prepared.scriptPath || !prepared.packagePath) {
    return { ok: false, message: 'MATLAB 执行入口不完整，无法启动预处理。' };
  }

  const settings = getSettings(db);
  const matlabExecutable = settings.matlabExecutable.trim();
  const args = buildMatlabArgs(prepared.scriptPath, prepared.packagePath);

  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'info',
    source: 'matlab',
    message: `开始执行 MATLAB 预处理: ${prepared.command}`,
  });

  let processResult: MatlabProcessResult;

  try {
    processResult = await executeMatlab(matlabExecutable, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    processResult = {
      exitCode: null,
      stdout: '',
      stderr: message,
    };
  }

  const output = {
    ...parseJsonRecord(task.output_json),
    matlabScriptPath: prepared.scriptPath,
    matlabPackagePath: prepared.packagePath,
    matlabCommand: prepared.command,
    matlabExitCode: processResult.exitCode,
    matlabStdout: processResult.stdout,
    matlabStderr: processResult.stderr,
    matlabLastRunAt: nowIso(),
  };

  db.run(
    `UPDATE tasks
     SET output_json = ?
     WHERE id = ?`,
    [JSON.stringify(output), task.id],
  );

  if (processResult.exitCode === 0) {
    const taskPackage = parseTaskPackage(task.input_json);
    const progressMessage = taskPackage
      ? advancePreprocessAfterMatlabRun(db, paths, task, taskPackage)
      : 'MATLAB 预处理已执行。请按输出目录中的 manual_preprocess_instructions.txt 完成人工节点后再次运行。';

    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'info',
      source: 'matlab',
      message: 'MATLAB 预处理执行完成。',
    });
    return {
      ...prepared,
      ok: true,
      message: progressMessage,
      exitCode: processResult.exitCode,
      stdout: processResult.stdout,
      stderr: processResult.stderr,
    };
  }

  addTaskLog(db, {
    taskId: task.id,
    patientId: task.patient_id,
    level: 'error',
    source: 'matlab',
    message: `MATLAB 预处理执行失败: ${processResult.stderr || `exitCode=${processResult.exitCode}`}`,
  });

  return {
    ...prepared,
    ok: false,
    message: `MATLAB 预处理执行失败：${processResult.stderr || `exitCode=${processResult.exitCode}`}`,
    exitCode: processResult.exitCode,
    stdout: processResult.stdout,
    stderr: processResult.stderr,
  };
}

export function createPreprocessBatch(db: Database, input: PreprocessBatchInput): PreprocessBatchResult {
  if (input.patientIds.length === 0) {
    return { ok: false, message: '请先选择至少一位患者。' };
  }

  if (input.referenceMode === 'm1m2' && hasM1M2EmptyChannel(input)) {
    return { ok: false, message: '空导联包含 M1/M2，不能再选择 M1/M2 重参考。' };
  }

  const batchId = `preprocess-${Date.now()}`;
  const taskIds: string[] = [];

  for (const patientId of input.patientIds) {
    const taskPackage = createTaskPackage(db, input, patientId, batchId);
    const taskId = addTask(db, {
      type: 'preprocess',
      patientId,
      batchId,
      status: 'waiting_manual',
      inputJson: JSON.stringify(taskPackage),
    });
    taskIds.push(taskId);

    setPreprocessWorkflowStatus(db, patientId, '等待人工处理');
    addTaskLog(db, {
      taskId,
      patientId,
      level: 'info',
      source: 'database',
      message: `已生成预处理任务包，包含 ${taskPackage.baselineRawCntFiles.length} 个基线 CNT 文件。`,
    });
    addTaskLog(db, {
      taskId,
      patientId,
      level: 'info',
      source: 'eeglab',
      message: '等待人工节点: 人工去除坏段。',
    });

    for (const warning of taskPackage.warnings) {
      addTaskLog(db, {
        taskId,
        patientId,
        level: 'warning',
        source: 'database',
        message: warning,
      });
    }
  }

  return { ok: true, message: `已创建 ${input.patientIds.length} 个预处理任务。`, batchId, taskIds };
}
