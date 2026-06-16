import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalDatabase, type LocalDatabase } from '../../../src/electron/backend/database.js';
import { indexFeatureArtifact } from '../../../src/electron/backend/featureArtifacts.js';
import { registerIpcHandlers } from '../../../src/electron/backend/ipcHandlers.js';
import { listDataAssets, upsertDataAsset, upsertSourceRoot } from '../../../src/electron/backend/dataLibrary/repository.js';
import { createPatient, getSettings, getWorkbenchData } from '../../../src/electron/backend/repositories.js';
import type {
  ApiResult,
  BackendTask,
  ImportPatientsResult,
  ScanAndImportDataLibraryResult,
  ScanEegFolderResult,
  SourceRoot,
} from '../../../src/domain/backendTypes.js';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    electronMocks.handlers.set(channel, handler);
  }),
  showOpenDialog: vi.fn(),
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.handle,
  },
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
  },
  shell: {
    openPath: electronMocks.openPath,
    showItemInFolder: electronMocks.showItemInFolder,
  },
}));

const roots: string[] = [];
const locals: LocalDatabase[] = [];

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-ipc-'));
  roots.push(root);
  return root;
}

async function openTempDatabase(): Promise<LocalDatabase> {
  const local = await openLocalDatabase(createTempRoot());
  locals.push(local);
  return local;
}

async function reopenDatabase(local: LocalDatabase): Promise<LocalDatabase> {
  const reloaded = await openLocalDatabase(local.paths.dataRoot);
  locals.push(reloaded);
  return reloaded;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeMinimalDataLibraryFixture(sourceRoot: string): string {
  const assetPath = path.join(sourceRoot, 'Patient_tACS_M1_EEG', '基线', 'sub01穆祥贵', 'mxg1.cnt');
  writeFile(assetPath, 'raw eeg');
  return assetPath;
}

function manualOutputPath(
  local: LocalDatabase,
  task: BackendTask,
  suffix: 'stage02_after_bad_segment' | 'stage04_after_ica_artifact',
): string {
  const manifest = JSON.parse(task.inputJson);
  const rawFile = manifest.baselineRawCntFiles?.[0] ?? `${manifest.patientId}.cnt`;
  const rawBaseName = path.basename(rawFile, path.extname(rawFile));

  return path.join(
    local.paths.outputsRoot,
    'preprocess',
    task.batchId ?? 'manual',
    'processed',
    manifest.patientId,
    `${rawBaseName}_${suffix}.set`,
  );
}

function indexBaselineCntAsset(local: LocalDatabase, patientId: string, subjectCode = 'sub01'): string {
  const sourceRoot = upsertSourceRoot(local.db, {
    projectName: 'M1',
    rootPath: path.join(local.paths.dataRoot, 'source-library'),
    status: 'active',
  });
  const baselineCntPath = path.join(
    sourceRoot.rootPath,
    'Patient_tACS_M1_EEG',
    '基线',
    subjectCode,
    'mxg1.cnt',
  );
  writeFile(baselineCntPath, 'raw cnt');
  upsertDataAsset(local.db, {
    sourceRootId: sourceRoot.id,
    patientId,
    subjectCode,
    sourceSubjectCode: subjectCode,
    subjectName: '',
    cohort: 'patient',
    stage: '基线',
    assetType: 'raw_eeg_cnt',
    filePath: baselineCntPath,
    backupPath: null,
    fileSize: fs.statSync(baselineCntPath).size,
    fileHash: '',
    existsOnDisk: true,
    matchStatus: 'matched',
  });

  return baselineCntPath;
}

function indexPreprocessedSetAsset(local: LocalDatabase, patientId: string, subjectCode = 'sub01'): string {
  const sourceRoot = upsertSourceRoot(local.db, {
    projectName: 'M1',
    rootPath: path.join(local.paths.dataRoot, 'source-library'),
    status: 'active',
  });
  let eoSetPath = '';

  for (const stateSubjectCode of [`${subjectCode}1`, `${subjectCode}2`]) {
    const setPath = path.join(
      sourceRoot.rootPath,
      'Patient_tACS_M1_RestingStateEEG_afterProcess',
      '基线',
      stateSubjectCode,
      `${stateSubjectCode}.set`,
    );
    const fdtPath = path.join(
      sourceRoot.rootPath,
      'Patient_tACS_M1_RestingStateEEG_afterProcess',
      '基线',
      stateSubjectCode,
      `${stateSubjectCode}.fdt`,
    );

    writeFile(setPath, 'preprocessed set');
    writeFile(fdtPath, 'preprocessed fdt');

    for (const [assetType, filePath] of [
      ['processed_eeg_set', setPath],
      ['processed_eeg_fdt', fdtPath],
    ] as const) {
      upsertDataAsset(local.db, {
        sourceRootId: sourceRoot.id,
        patientId,
        subjectCode: stateSubjectCode,
        sourceSubjectCode: stateSubjectCode,
        subjectName: '',
        cohort: 'patient',
        stage: '基线',
        assetType,
        filePath,
        backupPath: null,
        fileSize: fs.statSync(filePath).size,
        fileHash: '',
        existsOnDisk: true,
        matchStatus: 'matched',
      });
    }

    if (stateSubjectCode.endsWith('1')) {
      eoSetPath = setPath;
    }
  }

  return eoSetPath;
}

function configureMatlabToolchain(local: LocalDatabase) {
  const matlabPath = path.join(local.paths.dataRoot, 'MATLAB', 'bin', 'matlab.exe');
  const eeglabPath = path.join(local.paths.dataRoot, 'tools', 'eeglab');
  const electrodeLocationFile = path.join(local.paths.dataRoot, 'tools', 'standard-10-5-cap385.elp');

  writeFile(matlabPath, 'matlab stub');
  fs.mkdirSync(eeglabPath, { recursive: true });
  writeFile(electrodeLocationFile, 'electrode locations');

  return { matlabPath, eeglabPath, electrodeLocationFile };
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = electronMocks.handlers.get(channel);

  if (!handler) {
    throw new Error(`Missing IPC handler: ${channel}`);
  }

  return (await handler({}, ...args)) as T;
}

beforeEach(() => {
  electronMocks.handlers.clear();
  electronMocks.handle.mockClear();
  electronMocks.showOpenDialog.mockReset();
  electronMocks.openPath.mockReset();
  electronMocks.showItemInFolder.mockReset();
});

afterEach(() => {
  for (const local of locals.splice(0)) {
    local.close();
  }

  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('registerIpcHandlers', () => {
  it('registers backend channels and persists mutating repository operations', async () => {
    const local = await openTempDatabase();
    const save = vi.spyOn(local, 'save');

    registerIpcHandlers(local);

    const emptyQueue = await invoke('backend:startNextQueuedTask');
    expect(emptyQueue).toEqual({
      ok: false,
      message: '没有待执行任务。',
      taskId: null,
      taskType: null,
    });

    expect([...electronMocks.handlers.keys()].sort()).toEqual([
      'backend:backupClinicalDocuments',
      'backend:cancelTask',
      'backend:clearWorkspaceData',
      'backend:completeExistingPreprocessManualStep',
      'backend:completeExistingPreprocessRun',
      'backend:completeExplainabilityTask',
      'backend:completeFeatureGenerationTask',
      'backend:completePredictionTask',
      'backend:completePreprocessManualStep',
      'backend:createBatchSummaryReport',
      'backend:createExplainabilityBatch',
      'backend:createFeatureGenerationBatch',
      'backend:createPatient',
      'backend:createPatientReport',
      'backend:createPreprocessBatch',
      'backend:deleteExplanationArtifact',
      'backend:deletePatient',
      'backend:getDataLibraryStatus',
      'backend:getPatientDocumentDetail',
      'backend:getPreprocessOutputs',
      'backend:getSettings',
      'backend:getWorkbenchData',
      'backend:importExistingPatientRun',
      'backend:importPatientsCsv',
      'backend:indexExistingExplanationResults',
      'backend:indexExistingFeatureResults',
      'backend:indexExplanationArtifact',
      'backend:indexFeatureArtifact',
      'backend:launchExistingPreprocessManualStep',
      'backend:launchPreprocessManualStep',
      'backend:listBatchSummaryReports',
      'backend:listDataAssets',
      'backend:listExplanationArtifacts',
      'backend:listExplanationOverview',
      'backend:listFeatureArtifacts',
      'backend:listFeatureOverview',
      'backend:listPatientAssetSummary',
      'backend:listPatientReports',
      'backend:listPatients',
      'backend:listPredictionModels',
      'backend:listPredictionQueue',
      'backend:listSourceRoots',
      'backend:listTaskLogs',
      'backend:listTasks',
      'backend:markManualStepCompleted',
      'backend:openAssetLocation',
      'backend:openBackupDirectory',
      'backend:openBatchSummaryReport',
      'backend:openExplanationArtifact',
      'backend:openFeatureArtifact',
      'backend:openPatientReport',
      'backend:prepareExplainabilityExecution',
      'backend:prepareFeatureGenerationExecution',
      'backend:preparePredictionExecution',
      'backend:preparePreprocessMatlabExecution',
      'backend:registerEegFile',
      'backend:registerPredictionModel',
      'backend:resolveManualAssetMatch',
      'backend:retryTask',
      'backend:runBatchPrediction',
      'backend:runExplainabilityExecution',
      'backend:runFeatureGenerationExecution',
      'backend:runPredictionExecution',
      'backend:runPreprocessMatlabExecution',
      'backend:saveExistingPredictionResult',
      'backend:savePredictionResult',
      'backend:scanAndImportDataLibrary',
      'backend:scanEegFolder',
      'backend:scanRegisteredEegFiles',
      'backend:selectDataLibraryRoot',
      'backend:startNextQueuedTask',
      'backend:updateDataAssetIndex',
      'backend:updatePatient',
      'backend:updateSettings',
      'backend:upsertSourceRoot',
    ]);

    const patientId = await invoke<string>('backend:createPatient', {
      subjectCode: 'sub01',
      affectedHand: '左手',
    });
    const eegFilePath = path.join(local.paths.dataRoot, 'sub01_EO.set');
    fs.writeFileSync(eegFilePath, 'placeholder');
    const eegFileId = await invoke<string>('backend:registerEegFile', {
      patientId,
      condition: 'EO',
      filePath: eegFilePath,
    });
    const sourceRoot = upsertSourceRoot(local.db, {
      projectName: 'M1',
      rootPath: local.paths.dataRoot,
      status: 'active',
    });
    const baselineCntPath = path.join(local.paths.dataRoot, 'Patient_tACS_M1_EEG', '基线', 'sub01', 'mxg1.cnt');
    writeFile(baselineCntPath, 'raw cnt');
    upsertDataAsset(local.db, {
      sourceRootId: sourceRoot.id,
      patientId,
      subjectCode: 'sub01',
      sourceSubjectCode: 'sub01',
      subjectName: '',
      cohort: 'patient',
      stage: '基线',
      assetType: 'raw_eeg_cnt',
      filePath: baselineCntPath,
      backupPath: null,
      fileSize: fs.statSync(baselineCntPath).size,
      fileHash: '',
      existsOnDisk: true,
      matchStatus: 'matched',
    });
    const settings = await invoke<ReturnType<typeof getSettings>>('backend:updateSettings', {
      matlabExecutable: 'C:\\MATLAB\\bin\\matlab.exe',
    });
    const updatedPatient = await invoke('backend:updatePatient', patientId, {
      notes: 'ready for preprocessing',
    });
    const patients = await invoke('backend:listPatients');
    const scanRegistered = await invoke<ScanEegFolderResult>('backend:scanRegisteredEegFiles');
    const preprocess = await invoke<{ ok: boolean; message: string }>('backend:createPreprocessBatch', {
      patientIds: [patientId],
      selectedEmptyChannels: [],
      selectedBadChannels: [],
      referenceMode: 'average',
      downsampleRate: 500,
      highPassHz: 1,
      lowPassHz: 45,
      notchHz: 50,
    });
    const queuedTask = await invoke<BackendTask[]>('backend:listTasks', { status: 'waiting_manual' });
    writeFile(manualOutputPath(local, queuedTask[0], 'stage02_after_bad_segment'), 'bad segment reviewed set');
    const completedManualStep = await invoke<ApiResult>('backend:completePreprocessManualStep', queuedTask[0].id);
    const tasks = await invoke('backend:listTasks', { status: 'queued' });
    const logs = await invoke('backend:listTaskLogs', { level: 'info' });
    const workbench = await invoke<ReturnType<typeof getWorkbenchData>>('backend:getWorkbenchData');
    const deleted = await invoke<{ ok: boolean; message: string }>('backend:deletePatient', patientId);

    expect(patientId).toEqual(expect.any(String));
    expect(eegFileId).toEqual(expect.any(String));
    expect(settings.matlabExecutable).toBe('C:\\MATLAB\\bin\\matlab.exe');
    expect(updatedPatient).toEqual(expect.objectContaining({ id: patientId, notes: 'ready for preprocessing' }));
    expect(patients).toEqual([expect.objectContaining({ id: patientId, subjectCode: 'sub01' })]);
    expect(scanRegistered).toEqual({ scannedFiles: 1, registeredFiles: 1, unmatchedFiles: [] });
    expect(preprocess.ok).toBe(true);
    expect(completedManualStep).toEqual({
      ok: true,
      message: '人工节点已完成：人工去除坏段。下一步请运行 MATLAB 完成坏导插值和 ICA。',
    });
    expect(tasks).toEqual([expect.objectContaining({ patientId, status: 'queued', type: 'preprocess' })]);
    expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({ level: 'info' })]));
    expect(workbench.patients).toEqual([
      expect.objectContaining({
        id: 'sub01',
        patientId,
        hand: '左手',
        eo: true,
      }),
    ]);
    expect(deleted.ok).toBe(true);
    expect(save).toHaveBeenCalledTimes(8);
  });

  it('handles feature artifact indexing and feature generation task requests', async () => {
    const local = await openTempDatabase();
    const save = vi.spyOn(local, 'save');
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '左手' });
    const psdPath = path.join(local.paths.outputsRoot, 'features', 'sub01_psd_eo.npz');
    const completedPsdPath = path.join(local.paths.outputsRoot, 'features', 'sub01_completed_psd_eo.npz');
    const completedFcPath = path.join(local.paths.outputsRoot, 'features', 'sub01_completed_fc_ec.npz');
    const manifestPath = path.join(local.paths.outputsRoot, 'features', 'sub01_feature_manifest.json');
    writeFile(psdPath, 'psd features');
    writeFile(completedPsdPath, 'completed psd features');
    writeFile(completedFcPath, 'completed fc features');
    writeFile(
      manifestPath,
      JSON.stringify({
        artifacts: [
          {
            kind: 'PSD',
            state: 'EO',
            filePath: completedPsdPath,
            featureCount: 5580,
            params: { method: 'welch', alignment: 'right_affected_c3', shape: [62, 90] },
          },
          {
            kind: 'FC',
            state: 'EC',
            filePath: completedFcPath,
            featureCount: 11346,
            params: { method: 'wpli', metric: 'wpli', alignment: 'right_affected_c3', shape: [1891, 6] },
          },
        ],
      }),
    );

    registerIpcHandlers(local);
    electronMocks.openPath.mockResolvedValue('');

    const artifactId = await invoke<string>('backend:indexFeatureArtifact', {
      patientId,
      kind: 'PSD',
      state: 'EO',
      filePath: psdPath,
      featureCount: 5580,
      params: { method: 'welch' },
    });
    const artifacts = await invoke('backend:listFeatureArtifacts', { patientId });
    const overview = await invoke('backend:listFeatureOverview');
    const opened = await invoke<ApiResult>('backend:openFeatureArtifact', artifactId);
    const missing = await invoke<ApiResult>('backend:openFeatureArtifact', 'missing-artifact');
    indexPreprocessedSetAsset(local, patientId);
    const batch = await invoke('backend:createFeatureGenerationBatch', {
      patientIds: [patientId],
      featureKinds: ['PSD', 'FC'],
      states: ['EO', 'EC'],
      overwrite: true,
    });
    const featureTasks = await invoke<BackendTask[]>('backend:listTasks', { status: 'queued' });
    const prepared = await invoke<ApiResult>('backend:prepareFeatureGenerationExecution', featureTasks[0].id);
    const completed = await invoke(
      'backend:completeFeatureGenerationTask',
      featureTasks[0].id,
      manifestPath,
    );
    const completedArtifacts = await invoke('backend:listFeatureArtifacts', { patientId });
    const remainingQueued = await invoke<BackendTask[]>('backend:listTasks', { status: 'queued' });

    expect(artifactId).toEqual(expect.any(String));
    expect(artifacts).toEqual([expect.objectContaining({ id: artifactId, kind: 'PSD', filePath: psdPath })]);
    expect(overview).toEqual([expect.objectContaining({ patientId, subjectCode: 'sub01', psdCount: 1 })]);
    expect(opened).toEqual({ ok: true, message: '已打开特征文件。' });
    expect(missing).toEqual({ ok: false, message: '特征文件不存在或文件已丢失。' });
    expect(electronMocks.openPath).toHaveBeenCalledWith(psdPath);
    expect(batch).toEqual(expect.objectContaining({ ok: true, queuedTasks: 1 }));
    expect(prepared).toEqual(expect.objectContaining({ ok: true, message: expect.stringContaining('特征生成任务包已准备') }));
    expect(completed).toEqual(
      expect.objectContaining({
        ok: true,
        indexedArtifacts: 2,
        artifactIds: [expect.any(String), expect.any(String)],
      }),
    );
    expect(completedArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'PSD', state: 'EO', filePath: completedPsdPath }),
        expect.objectContaining({ kind: 'FC', state: 'EC', filePath: completedFcPath }),
      ]),
    );
    expect(remainingQueued).toEqual([]);
    expect(save).toHaveBeenCalledTimes(4);
  });

  it('handles prediction model, queue, batch, and result requests', async () => {
    const local = await openTempDatabase();
    const save = vi.spyOn(local, 'save');
    const patientId = createPatient(local.db, { subjectCode: 'sub01', affectedHand: '左手' });
    const featurePaths = {
      psdEo: path.join(local.paths.outputsRoot, 'features', 'sub01_psd_eo.npz'),
      psdEc: path.join(local.paths.outputsRoot, 'features', 'sub01_psd_ec.npz'),
      fcEo: path.join(local.paths.outputsRoot, 'features', 'sub01_fc_eo.npz'),
      fcEc: path.join(local.paths.outputsRoot, 'features', 'sub01_fc_ec.npz'),
    };
    const modelPath = path.join(local.paths.dataRoot, 'models', 'custom_model.json');
    const predictionResultPath = path.join(local.paths.outputsRoot, 'predictions', 'sub01_prediction.json');
    for (const featurePath of Object.values(featurePaths)) {
      writeFile(featurePath, 'features');
    }
    writeFile(modelPath, '{"model":"custom"}');
    writeFile(
      predictionResultPath,
      JSON.stringify({
        predictedClass: '比例恢复',
        probability: 0.87,
        threshold: 0.5,
        labelDefinition: '比例恢复 (PR) vs 恢复不良',
      }),
    );
    for (const [kind, state, filePath, params] of [
      ['PSD', 'EO', featurePaths.psdEo, { alignment: 'right_affected_c3', shape: [62, 90] }],
      ['PSD', 'EC', featurePaths.psdEc, { alignment: 'right_affected_c3', shape: [62, 90] }],
      ['FC', 'EO', featurePaths.fcEo, { metric: 'wpli', alignment: 'right_affected_c3', shape: [1891, 6] }],
      ['FC', 'EC', featurePaths.fcEc, { metric: 'wpli', alignment: 'right_affected_c3', shape: [1891, 6] }],
    ] as const) {
      indexFeatureArtifact(local.db, {
        patientId,
        kind,
        state,
        filePath,
        params,
      });
    }

    registerIpcHandlers(local);

    const registeredModel = await invoke<{ id: string }>('backend:registerPredictionModel', {
      taskId: 'pr',
      name: 'CustomModel',
      version: 'v1',
      inputType: 'EEG-only',
      inputs: ['PSD'],
      artifactPath: modelPath,
    });
    const models = await invoke('backend:listPredictionModels');
    const batch = await invoke('backend:runBatchPrediction', {
      taskId: 'pr',
      modelId: 'm2',
      patientIds: [patientId],
    });
    const queuedTasks = await invoke<BackendTask[]>('backend:listTasks', { status: 'queued' });
    const preparedPrediction = await invoke<ApiResult>('backend:preparePredictionExecution', queuedTasks[0].id);
    const completedPrediction = await invoke<ApiResult & { predictionId?: string | null }>(
      'backend:completePredictionTask',
      queuedTasks[0].id,
      predictionResultPath,
    );
    const completedQueue = await invoke('backend:listPredictionQueue', { taskId: 'pr' });
    const predictionId = await invoke('backend:savePredictionResult', {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      predictedClass: '恢复不良',
      probability: 0.22,
      threshold: 0.5,
      labelDefinition: '比例恢复 (PR) vs 恢复不良',
    });
    const queue = await invoke('backend:listPredictionQueue', { taskId: 'pr' });

    expect(registeredModel).toEqual(expect.objectContaining({ id: expect.any(String) }));
    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'm2' }),
        expect.objectContaining({ id: registeredModel.id, name: 'CustomModel', artifactPath: modelPath }),
      ]),
    );
    expect(batch).toEqual(expect.objectContaining({ ok: true, queuedTasks: 1 }));
    expect(preparedPrediction).toEqual(expect.objectContaining({ ok: true, message: expect.stringContaining('预测任务包已准备') }));
    expect(completedPrediction).toEqual({
      ok: true,
      message: '预测任务已完成：比例恢复 0.87。',
      predictionId: expect.any(String),
    });
    expect(completedQueue).toEqual([
      expect.objectContaining({
        patientId,
        prediction: '比例恢复',
        probability: 0.87,
        status: '已完成',
      }),
    ]);
    expect(predictionId).toEqual(expect.any(String));
    expect(queue).toEqual([
      expect.objectContaining({
        patientId,
        prediction: '恢复不良',
        probability: 0.22,
      }),
    ]);
    expect(save).toHaveBeenCalledTimes(5);
  });

  it('handles patient report creation, listing, and opening requests', async () => {
    const local = await openTempDatabase();
    const save = vi.spyOn(local, 'save');
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });

    registerIpcHandlers(local);
    electronMocks.openPath.mockResolvedValue('');

    const result = await invoke<{ ok: boolean; report: { id: string; patientId: string; subjectCode: string; status: string; filePath: string } }>('backend:createPatientReport', {
      patientId,
      title: 'tACS EEG 康复结局预测报告',
    });
    const reports = await invoke('backend:listPatientReports', { patientId });
    const opened = await invoke<ApiResult>('backend:openPatientReport', result.report.id);
    const missing = await invoke<ApiResult>('backend:openPatientReport', 'missing-report');

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        report: expect.objectContaining({ patientId, subjectCode: 'sub01', status: '已生成' }),
      }),
    );
    expect(fs.existsSync(result.report.filePath)).toBe(true);
    expect(reports).toEqual([expect.objectContaining({ id: result.report.id, patientId })]);
    expect(opened).toEqual({ ok: true, message: '已打开患者报告。' });
    expect(missing).toEqual({ ok: false, message: '报告不存在或文件已丢失。' });
    expect(electronMocks.openPath).toHaveBeenCalledWith(result.report.filePath);
    expect(save).toHaveBeenCalledOnce();
  });

  it('handles batch summary report creation, listing, and opening requests', async () => {
    const local = await openTempDatabase();
    const save = vi.spyOn(local, 'save');
    createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });

    registerIpcHandlers(local);
    electronMocks.openPath.mockResolvedValue('');

    const result = await invoke<{ ok: boolean; report: { id: string; status: string; filePath: string; patientCount: number } }>(
      'backend:createBatchSummaryReport',
      { title: 'tACS EEG 康复结局批次汇总' },
    );
    const reports = await invoke('backend:listBatchSummaryReports');
    const opened = await invoke<ApiResult>('backend:openBatchSummaryReport', result.report.id);
    const missing = await invoke<ApiResult>('backend:openBatchSummaryReport', 'missing-report');

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        report: expect.objectContaining({ status: '已生成', patientCount: 1 }),
      }),
    );
    expect(fs.existsSync(result.report.filePath)).toBe(true);
    expect(reports).toEqual([expect.objectContaining({ id: result.report.id, patientCount: 1 })]);
    expect(opened).toEqual({ ok: true, message: '已打开批次汇总。' });
    expect(missing).toEqual({ ok: false, message: '批次汇总不存在或文件已丢失。' });
    expect(electronMocks.openPath).toHaveBeenCalledWith(result.report.filePath);
    expect(save).toHaveBeenCalledOnce();
  });

  it('handles explainability artifact indexing, task requests, and opening requests', async () => {
    const local = await openTempDatabase();
    const save = vi.spyOn(local, 'save');
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });
    const artifactPath = path.join(local.paths.outputsRoot, 'explainability', 'sub01_shap.svg');
    const completedArtifactPath = path.join(local.paths.outputsRoot, 'explainability', 'sub01_psd_heatmap.png');
    const manifestPath = path.join(local.paths.outputsRoot, 'explainability', 'sub01_explainability_manifest.json');
    const executablePath = path.join(local.paths.dataRoot, 'tools', 'python.exe');
    const scriptPath = path.join(local.paths.dataRoot, 'scripts', 'explain_recovery.py');
    writeFile(artifactPath, '<svg>shap</svg>');
    writeFile(completedArtifactPath, 'heatmap');
    writeFile(executablePath, 'python stub');
    writeFile(scriptPath, 'explainability script stub');
    writeFile(
      manifestPath,
      JSON.stringify({
        artifacts: [
          {
            artifactType: 'psd_heatmap',
            title: 'sub01 PSD heatmap',
            method: 'Integrated Gradients',
            filePath: completedArtifactPath,
            topFeatures: [{ name: 'Oz Alpha PSD', score: 0.22, modality: 'PSD', direction: 'positive' }],
          },
        ],
      }),
    );
    const executeExplainability = vi.fn().mockImplementation(async (_executable: string, args: string[]) => {
      const packagePath = args[args.length - 1];
      const taskPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      writeFile(
        taskPackage.outputs.manifestPath,
        JSON.stringify({
          artifacts: [
            {
              artifactType: 'psd_heatmap',
              title: 'sub01 PSD heatmap',
              method: 'Integrated Gradients',
              filePath: completedArtifactPath,
              topFeatures: [{ name: 'Oz Alpha PSD', score: 0.22, modality: 'PSD', direction: 'positive' }],
            },
          ],
        }),
      );
      return { exitCode: 0, stdout: 'explainability generated', stderr: '' };
    });

    registerIpcHandlers(local, { executeExplainability });
    electronMocks.openPath.mockResolvedValue('');

    await invoke('backend:savePredictionResult', {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      predictedClass: '比例恢复',
      probability: 0.87,
      threshold: 0.5,
      labelDefinition: '比例恢复 (PR) vs 恢复不良',
    });
    const artifactId = await invoke<string>('backend:indexExplanationArtifact', {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      artifactType: 'patient_shap',
      title: 'sub01 SHAP force plot',
      method: 'SHAP',
      filePath: artifactPath,
      topFeatures: [{ name: 'Oz Alpha PSD', score: 0.22, modality: 'PSD', direction: 'positive' }],
    });
    const artifacts = await invoke('backend:listExplanationArtifacts', { patientId });
    const overview = await invoke('backend:listExplanationOverview', { taskId: 'pr' });
    const batch = await invoke('backend:createExplainabilityBatch', {
      taskId: 'pr',
      modelId: 'm2',
      patientIds: [patientId],
      artifactTypes: ['global_importance', 'patient_shap'],
      executor: { executablePath, scriptPath },
    });
    const queuedExplainability = await invoke<BackendTask[]>('backend:listTasks', { status: 'queued' });
    const completedExplainability = await invoke(
      'backend:runExplainabilityExecution',
      queuedExplainability[0].id,
    );
    const completedArtifacts = await invoke('backend:listExplanationArtifacts', { patientId });
    const opened = await invoke<ApiResult>('backend:openExplanationArtifact', artifactId);
    const missing = await invoke<ApiResult>('backend:openExplanationArtifact', 'missing-artifact');

    expect(artifactId).toEqual(expect.any(String));
    expect(artifacts).toEqual([expect.objectContaining({ id: artifactId, patientId, artifactType: 'patient_shap' })]);
    expect(overview).toEqual([expect.objectContaining({ patientId, subjectCode: 'sub01', artifactCount: 1 })]);
    expect(batch).toEqual(expect.objectContaining({ ok: true, queuedTasks: 1 }));
    expect(completedExplainability).toEqual(
      expect.objectContaining({
        ok: true,
        indexedArtifacts: 1,
        artifactIds: [expect.any(String)],
        exitCode: 0,
        stdout: 'explainability generated',
      }),
    );
    expect(executeExplainability).toHaveBeenCalledWith(
      executablePath,
      expect.arrayContaining([scriptPath, expect.stringContaining(`${queuedExplainability[0].id}-explainability.json`)]),
    );
    expect(completedArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifactType: 'psd_heatmap', filePath: completedArtifactPath }),
      ]),
    );
    expect(opened).toEqual({ ok: true, message: '已打开解释性文件。' });
    expect(missing).toEqual({ ok: false, message: '解释性文件不存在或文件已丢失。' });
    expect(electronMocks.openPath).toHaveBeenCalledWith(artifactPath);
    expect(save).toHaveBeenCalledTimes(4);
  });

  it('handles data library status, indexing, lists, detail, and open-location requests', async () => {
    const local = await openTempDatabase();
    const save = vi.spyOn(local, 'save');
    const sourceRoot = createTempRoot();
    const assetPath = writeMinimalDataLibraryFixture(sourceRoot);

    registerIpcHandlers(local);
    electronMocks.openPath.mockResolvedValue('');

    const initialStatus = await invoke('backend:getDataLibraryStatus');
    const source = await invoke<SourceRoot>('backend:upsertSourceRoot', {
      projectName: 'M1',
      rootPath: sourceRoot,
      status: 'active',
    });
    const sourceRoots = await invoke('backend:listSourceRoots');
    const scan = await invoke<ScanAndImportDataLibraryResult>('backend:updateDataAssetIndex', sourceRoot);
    const reloaded = await reopenDatabase(local);
    const persistedAssets = listDataAssets(reloaded.db);
    const assets = await invoke<ReturnType<typeof listDataAssets>>('backend:listDataAssets');
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });
    const resolved = await invoke('backend:resolveManualAssetMatch', assets[0].id, patientId);
    const summary = await invoke('backend:listPatientAssetSummary');
    const detail = await invoke('backend:getPatientDocumentDetail', 'missing-patient');
    const openedAsset = await invoke<ApiResult>('backend:openAssetLocation', assets[0].id);
    const missingAsset = await invoke<ApiResult>('backend:openAssetLocation', 'missing-asset');
    const openedBackup = await invoke<ApiResult>('backend:openBackupDirectory');

    expect(initialStatus).toEqual(expect.objectContaining({ indexedFiles: 0, sourceRoot: null }));
    expect(source).toEqual(expect.objectContaining({ rootPath: sourceRoot, projectName: 'M1' }));
    expect(sourceRoots).toEqual([expect.objectContaining({ id: source.id, rootPath: sourceRoot })]);
    expect(scan).toEqual(
      expect.objectContaining({
        sourceRootId: expect.any(String),
        indexedAssets: 1,
        backedUpDocuments: 0,
        errors: [],
      }),
    );
    expect(persistedAssets).toEqual([expect.objectContaining({ filePath: assetPath })]);
    expect(assets).toEqual([expect.objectContaining({ id: expect.any(String), filePath: assetPath })]);
    expect(resolved).toEqual(
      expect.objectContaining({
        ok: true,
        asset: expect.objectContaining({ id: assets[0].id, patientId, subjectCode: 'sub01', matchStatus: 'matched' }),
      }),
    );
    expect(summary).toEqual([expect.objectContaining({ subjectCode: 'sub01' })]);
    expect(detail).toEqual(expect.objectContaining({ patient: null, assets: [], completeness: [] }));
    expect(openedAsset).toEqual({ ok: true, message: '已打开文件位置。' });
    expect(missingAsset).toEqual({ ok: false, message: '文件不存在或未找到资产记录。' });
    expect(openedBackup).toEqual({ ok: true, message: '已打开备份目录。' });
    expect(electronMocks.showItemInFolder).toHaveBeenCalledWith(assetPath);
    expect(electronMocks.openPath).toHaveBeenCalledWith(local.paths.clinicalDocsBackupRoot);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('opens a directory picker for selecting the data library root', async () => {
    const local = await openTempDatabase();
    const sourceRoot = createTempRoot();

    registerIpcHandlers(local);
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [sourceRoot] });

    await expect(invoke<string | null>('backend:selectDataLibraryRoot')).resolves.toBe(sourceRoot);
    expect(electronMocks.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory'],
      title: '选择数据与文档库根目录',
    });
  });

  it('launches a preprocessing manual checkpoint through Electron shell.openPath', async () => {
    const local = await openTempDatabase();
    const patientId = await Promise.resolve(createPatient(local.db, { subjectCode: 'sub01' }));
    const baselineCntPath = indexBaselineCntAsset(local, patientId);
    const matlabPath = path.join(local.paths.dataRoot, 'tools', 'matlab.exe');
    const eeglabPath = path.join(local.paths.dataRoot, 'tools', 'eeglab');
    writeFile(matlabPath, 'matlab stub');
    fs.mkdirSync(eeglabPath, { recursive: true });

    registerIpcHandlers(local);
    electronMocks.openPath.mockResolvedValue('');

    await invoke('backend:updateSettings', { matlabExecutable: matlabPath, eeglabPath });
    await invoke('backend:createPreprocessBatch', {
      patientIds: [patientId],
      selectedEmptyChannels: [],
      selectedBadChannels: [],
      referenceMode: 'average',
      downsampleRate: 500,
      highPassHz: 1,
      lowPassHz: 45,
      notchHz: 50,
    });
    const tasks = await invoke<Array<{ id: string }>>('backend:listTasks', { status: 'waiting_manual' });
    const task = tasks[0] as unknown as BackendTask;
    const rawBaseName = path.basename(baselineCntPath, path.extname(baselineCntPath));
    writeFile(
      path.join(
        local.paths.outputsRoot,
        'preprocess',
        task.batchId ?? 'manual',
        'processed',
        patientId,
        `${rawBaseName}_stage01_before_bad_segment.set`,
      ),
      'bad segment candidate set',
    );
    const result = await invoke<ApiResult & { packagePath?: string; launchTargetPath?: string }>(
      'backend:launchPreprocessManualStep',
      tasks[0].id,
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        packagePath: expect.stringContaining(path.join('outputs', 'preprocess')),
        launchTargetPath: expect.stringContaining('launch-eeglab'),
      }),
    );
    expect(electronMocks.openPath).toHaveBeenCalledWith(result.launchTargetPath);
    expect(fs.existsSync(result.packagePath ?? '')).toBe(true);
  });

  it('prepares a MATLAB preprocessing command through IPC', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCntAsset(local, patientId);
    const { matlabPath, eeglabPath, electrodeLocationFile } = configureMatlabToolchain(local);

    registerIpcHandlers(local);

    await invoke('backend:updateSettings', { matlabExecutable: matlabPath, eeglabPath, defaultElectrodeLocationFile: electrodeLocationFile });
    await invoke('backend:createPreprocessBatch', {
      patientIds: [patientId],
      selectedEmptyChannels: [],
      selectedBadChannels: [],
      referenceMode: 'average',
      downsampleRate: 500,
      highPassHz: 1,
      lowPassHz: 45,
      notchHz: 50,
    });
    const tasks = await invoke<Array<{ id: string }>>('backend:listTasks', { status: 'waiting_manual' });
    const result = await invoke<ApiResult & { scriptPath?: string; packagePath?: string; command?: string }>(
      'backend:preparePreprocessMatlabExecution',
      tasks[0].id,
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        scriptPath: path.join(local.paths.outputsRoot, 'preprocess', 'matlab', 'run_preprocess_task.m'),
        packagePath: expect.stringContaining(`${tasks[0].id}-matlab-execution.json`),
        command: expect.stringContaining('-batch'),
      }),
    );
  });

  it('runs MATLAB preprocessing through IPC with the configured executor', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCntAsset(local, patientId);
    const { matlabPath, eeglabPath, electrodeLocationFile } = configureMatlabToolchain(local);
    const executeMatlab = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'stage01 saved',
      stderr: '',
    });

    registerIpcHandlers(local, { executeMatlab });

    await invoke('backend:updateSettings', { matlabExecutable: matlabPath, eeglabPath, defaultElectrodeLocationFile: electrodeLocationFile });
    await invoke('backend:createPreprocessBatch', {
      patientIds: [patientId],
      selectedEmptyChannels: [],
      selectedBadChannels: [],
      referenceMode: 'average',
      downsampleRate: 500,
      highPassHz: 1,
      lowPassHz: 45,
      notchHz: 50,
    });
    const tasks = await invoke<Array<{ id: string }>>('backend:listTasks', { status: 'waiting_manual' });
    const result = await invoke<ApiResult & { exitCode?: number; stdout?: string }>(
      'backend:runPreprocessMatlabExecution',
      tasks[0].id,
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        exitCode: 0,
        stdout: 'stage01 saved',
      }),
    );
    expect(executeMatlab).toHaveBeenCalledWith(
      matlabPath,
      expect.arrayContaining(['-batch', expect.stringContaining('run_preprocess_task')]),
    );
  });

  it('returns preprocessing output summaries through IPC', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCntAsset(local, patientId);

    registerIpcHandlers(local);

    await invoke('backend:createPreprocessBatch', {
      patientIds: [patientId],
      selectedEmptyChannels: [],
      selectedBadChannels: [],
      referenceMode: 'average',
      downsampleRate: 500,
      highPassHz: 1,
      lowPassHz: 45,
      notchHz: 50,
    });
    const tasks = await invoke<Array<{ id: string; batchId: string }>>('backend:listTasks', { status: 'waiting_manual' });
    const outputDir = path.join(local.paths.outputsRoot, 'preprocess', tasks[0].batchId, 'processed', patientId);
    const finalSetPath = path.join(outputDir, 'sub01_preprocessed_final.set');
    writeFile(finalSetPath, 'final set');

    const outputs = await invoke('backend:getPreprocessOutputs', patientId);

    expect(outputs).toEqual(
      expect.objectContaining({
        patientId,
        subjectCode: 'sub01',
        latestTaskId: tasks[0].id,
        files: expect.arrayContaining([
          expect.objectContaining({ filePath: finalSetPath, kind: 'final_set' }),
        ]),
      }),
    );
  });

  it('returns errors instead of opening missing files or failed backup directories', async () => {
    const local = await openTempDatabase();

    registerIpcHandlers(local);
    electronMocks.openPath.mockResolvedValue('access denied');

    const openedBackup = await invoke<ApiResult>('backend:openBackupDirectory');
    const openedAsset = await invoke<ApiResult>('backend:openAssetLocation', 'missing-asset');

    expect(openedBackup).toEqual({ ok: false, message: 'access denied' });
    expect(openedAsset).toEqual({ ok: false, message: '文件不存在或未找到资产记录。' });
    expect(electronMocks.showItemInFolder).not.toHaveBeenCalled();
  });

  it('returns cancellation results for file and folder picker handlers without saving', async () => {
    const local = await openTempDatabase();
    const save = vi.spyOn(local, 'save');

    registerIpcHandlers(local);
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    const imported = await invoke<ImportPatientsResult>('backend:importPatientsCsv');
    const scanned = await invoke<ScanEegFolderResult>('backend:scanEegFolder');

    expect(imported).toEqual({
      created: 0,
      updated: 0,
      skipped: 0,
      errors: ['用户取消选择'],
    });
    expect(scanned).toEqual({
      scannedFiles: 0,
      registeredFiles: 0,
      unmatchedFiles: [],
    });
    expect(save).not.toHaveBeenCalled();
  });
});
