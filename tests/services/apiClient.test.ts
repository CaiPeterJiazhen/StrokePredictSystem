import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPatient,
  backupClinicalDocuments,
  clearWorkspaceData,
  completePreprocessManualStep,
  markManualStepCompleted,
  deletePatient,
  getSettings,
  getDataLibraryStatus,
  getPatientDocumentDetail,
  getPreprocessOutputs,
  createFeatureGenerationBatch,
  completeFeatureGenerationTask,
  prepareFeatureGenerationExecution,
  runFeatureGenerationExecution,
  createExplainabilityBatch,
  completeExplainabilityTask,
  prepareExplainabilityExecution,
  runExplainabilityExecution,
  indexFeatureArtifact,
  indexExplanationArtifact,
  getWorkbenchData,
  importPatientsCsv,
  listDataAssets,
  listFeatureArtifacts,
  listExplanationArtifacts,
  listExplanationOverview,
  listFeatureOverview,
  listPatientAssetSummary,
  createPatientReport,
  createBatchSummaryReport,
  listPredictionModels,
  registerPredictionModel,
  listPredictionQueue,
  listPatientReports,
  listBatchSummaryReports,
  listPatients,
  listSourceRoots,
  listTaskLogs,
  listTasks,
  retryTask,
  cancelTask,
  launchPreprocessManualStep,
  openAssetLocation,
  openBackupDirectory,
  openExplanationArtifact,
  openFeatureArtifact,
  openPatientReport,
  openBatchSummaryReport,
  resolveManualAssetMatch,
  preparePreprocessMatlabExecution,
  runBatchPrediction,
  completePredictionTask,
  preparePredictionExecution,
  runPredictionExecution,
  runPreprocessMatlabExecution,
  getMatlabSessionStatus,
  startMatlabSession,
  savePredictionResult,
  scanEegFolder,
  scanAndImportDataLibrary,
  scanRegisteredEegFiles,
  selectDataLibraryRoot,
  startNextQueuedTask,
  startPreprocessing,
  registerEegFile,
  updateDataAssetIndex,
  updatePatient,
  updateSettings,
  upsertSourceRoot,
} from '../../src/services/apiClient';
import { mockLogs, mockPatients } from '../../src/domain/mockData';
import type {
  BackendPatient,
  BackendSettings,
  CreatePatientInput,
  DataAsset,
  DataLibraryStatus,
  DataLibrarySummaryRow,
  PatientDocumentDetail,
  PreprocessBatchInput,
  RegisterEegFileInput,
  ScanAndImportDataLibraryResult,
  SourceRoot,
  WorkbenchData,
  FeatureArtifact,
  ExplanationArtifact,
  ExplanationOverviewRow,
  FeatureArtifactOverviewRow,
  PredictionModel,
  PredictionQueueRow,
  PatientReport,
  BatchSummaryReport,
} from '../../src/domain/backendTypes';
import type { NeuroPredictBridge } from '../../src/electron/preload';

const preprocessInput: PreprocessBatchInput = {
  patientIds: ['P-2026-001'],
  selectedEmptyChannels: ['A1'],
  selectedBadChannels: ['F3'],
  referenceMode: 'average',
  downsampleRate: 250,
  highPassHz: 0.5,
  lowPassHz: 45,
  notchHz: 50,
};

const settingsInput: Partial<BackendSettings> = {
  matlabExecutable: 'C:\\MATLAB\\bin\\matlab.exe',
};

const patientInput: CreatePatientInput = {
  subjectCode: 'sub01',
};

const eegFileInput: RegisterEegFileInput = {
  patientId: 'patient-1',
  condition: 'EO',
  filePath: 'F:\\data\\sub01_eo.set',
};

const featureArtifactInput = {
  patientId: 'patient-1',
  kind: 'PSD' as const,
  state: 'EO' as const,
  filePath: 'F:\\features\\sub01_psd.npz',
};

const featureBatchInput = {
  patientIds: ['patient-1'],
  featureKinds: ['PSD', 'FC'] as const,
  states: ['EO', 'EC'] as const,
  overwrite: false,
};

const featureManifestPath = 'F:\\features\\feature_manifest.json';

const predictionBatchInput = {
  taskId: 'pr',
  modelId: 'm2',
  patientIds: ['patient-1'],
};

const registerPredictionModelInput = {
  taskId: 'pr',
  name: 'CustomModel',
  version: 'v1',
  inputType: 'EEG-only' as const,
  inputs: ['PSD'],
  artifactPath: 'F:\\models\\custom.json',
};

const predictionResultInput = {
  patientId: 'patient-1',
  taskId: 'pr',
  modelId: 'm2',
  predictedClass: '比例恢复' as const,
  probability: 0.87,
  threshold: 0.5,
  labelDefinition: '比例恢复 (PR) vs 恢复不良',
};

const predictionResultPath = 'F:\\predictions\\sub01_prediction.json';

const reportInput = {
  patientId: 'patient-1',
  title: 'tACS EEG 康复结局预测报告',
};

const batchSummaryInput = {
  title: 'tACS EEG 康复结局批次汇总',
};

const explanationArtifactInput = {
  patientId: 'patient-1',
  taskId: 'pr',
  modelId: 'm2',
  artifactType: 'patient_shap' as const,
  title: 'sub01 SHAP force plot',
  method: 'SHAP',
  filePath: 'F:\\explainability\\sub01_shap.svg',
  topFeatures: [{ name: 'Oz Alpha PSD', score: 0.22, modality: 'PSD', direction: 'positive' as const }],
};

const explanationBatchInput = {
  taskId: 'pr',
  modelId: 'm2',
  patientIds: ['patient-1'],
  artifactTypes: ['patient_shap'] as const,
};

const explanationManifestPath = 'F:\\explainability\\manifest.json';

function setBridge(bridge: NeuroPredictBridge) {
  window.neuroPredict = bridge;
}

interface BridgeOverrides {
  platform?: NeuroPredictBridge['platform'];
  database?: Partial<NeuroPredictBridge['database']>;
  tasks?: Partial<NeuroPredictBridge['tasks']>;
  settings?: Partial<NeuroPredictBridge['settings']>;
}

function createBridge(overrides?: BridgeOverrides): NeuroPredictBridge {
  const bridge: NeuroPredictBridge = {
    platform: 'win32',
    database: {
      getWorkbenchData: vi.fn(),
      listPatients: vi.fn(),
      createPatient: vi.fn(),
      updatePatient: vi.fn(),
      deletePatient: vi.fn(),
      registerEegFile: vi.fn(),
      scanRegisteredEegFiles: vi.fn(),
      importPatientsCsv: vi.fn(),
      scanEegFolder: vi.fn(),
      getDataLibraryStatus: vi.fn(),
      listSourceRoots: vi.fn(),
      upsertSourceRoot: vi.fn(),
      scanAndImportDataLibrary: vi.fn(),
      updateDataAssetIndex: vi.fn(),
      backupClinicalDocuments: vi.fn(),
      selectDataLibraryRoot: vi.fn(),
      listDataAssets: vi.fn(),
      listPatientAssetSummary: vi.fn(),
      getPatientDocumentDetail: vi.fn(),
      openAssetLocation: vi.fn(),
      openBackupDirectory: vi.fn(),
      indexExplanationArtifact: vi.fn(),
      listExplanationArtifacts: vi.fn(),
      listExplanationOverview: vi.fn(),
      createExplainabilityBatch: vi.fn(),
      completeExplainabilityTask: vi.fn(),
      prepareExplainabilityExecution: vi.fn(),
      runExplainabilityExecution: vi.fn(),
      openExplanationArtifact: vi.fn(),
      indexFeatureArtifact: vi.fn(),
      listFeatureArtifacts: vi.fn(),
      listFeatureOverview: vi.fn(),
      createFeatureGenerationBatch: vi.fn(),
      completeFeatureGenerationTask: vi.fn(),
      openFeatureArtifact: vi.fn(),
      listPredictionModels: vi.fn(),
      listPredictionQueue: vi.fn(),
      runBatchPrediction: vi.fn(),
      completePredictionTask: vi.fn(),
      savePredictionResult: vi.fn(),
      createPatientReport: vi.fn(),
      listPatientReports: vi.fn(),
      openPatientReport: vi.fn(),
      createBatchSummaryReport: vi.fn(),
      listBatchSummaryReports: vi.fn(),
      openBatchSummaryReport: vi.fn(),
      },
    tasks: {
      listTasks: vi.fn(),
      listTaskLogs: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
      startNextQueuedTask: vi.fn(),
      createPreprocessBatch: vi.fn(),
      completePreprocessManualStep: vi.fn(),
      markManualStepCompleted: vi.fn(),
      getPreprocessOutputs: vi.fn(),
      launchPreprocessManualStep: vi.fn(),
      preparePreprocessMatlabExecution: vi.fn(),
      runPreprocessMatlabExecution: vi.fn(),
      startMatlabSession: vi.fn(),
      getMatlabSessionStatus: vi.fn(),
    },
    settings: {
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
    },
  };

  return {
    ...bridge,
    ...overrides,
    database: { ...bridge.database, ...overrides?.database },
    tasks: { ...bridge.tasks, ...overrides?.tasks },
    settings: { ...bridge.settings, ...overrides?.settings },
  };
}

afterEach(() => {
  delete window.neuroPredict;
  vi.restoreAllMocks();
});

describe('apiClient browser fallback', () => {
  it('builds workbench data from mock domain data when the Electron bridge is absent', async () => {
    const data = await getWorkbenchData();

    expect(data.patients).toHaveLength(mockPatients.length);
    expect(data.logs).toHaveLength(mockLogs.length);
    expect(data.patients[0]).toMatchObject({
      id: mockPatients[0].id,
      hand: mockPatients[0].affectedHand,
      eo: mockPatients[0].eo,
      ec: mockPatients[0].ec,
      preStatus: mockPatients[0].preprocessStatus,
      featStatus: mockPatients[0].featureStatus,
      predict: mockPatients[0].prediction,
      prob: mockPatients[0].probability,
      report: mockPatients[0].reportStatus,
    });
  });

  it('returns local-preview placeholders for backend-only actions', async () => {
    await expect(importPatientsCsv()).resolves.toEqual({
      created: 0,
      updated: 0,
      skipped: 0,
      errors: ['浏览器预览模式不支持打开本地文件'],
    });
    await expect(listPatients()).resolves.toEqual([]);
    await expect(createPatient(patientInput)).resolves.toBeNull();
    await expect(updatePatient('patient-1', patientInput)).resolves.toBeNull();
    await expect(deletePatient('patient-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持修改本地患者库',
    });
    await expect(registerEegFile(eegFileInput)).resolves.toBeNull();
    await expect(scanRegisteredEegFiles()).resolves.toEqual({
      scannedFiles: 0,
      registeredFiles: 0,
      unmatchedFiles: [],
    });
    await expect(listTasks()).resolves.toEqual([]);
    await expect(listTaskLogs()).resolves.toEqual([]);
    await expect(retryTask('failed-task-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持重试本地任务',
    });
    await expect(cancelTask('queued-task-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持取消本地任务',
    });
    await expect(startNextQueuedTask()).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持运行本地任务队列',
      taskId: null,
      taskType: null,
    });
    await expect(scanEegFolder()).resolves.toEqual({
      scannedFiles: 0,
      registeredFiles: 0,
      unmatchedFiles: [],
    });
    await expect(getSettings()).resolves.toBeNull();
    await expect(updateSettings(settingsInput)).resolves.toBeNull();
    await expect(startPreprocessing(preprocessInput)).resolves.toEqual({
      ok: true,
      message: expect.stringContaining('mock ok'),
    });
    await expect(completePreprocessManualStep('task-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持更新本地预处理任务',
    });
    await expect(markManualStepCompleted('task-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持更新本地预处理任务',
    });
    await expect(launchPreprocessManualStep('task-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持打开 MATLAB/EEGLAB',
    });
    await expect(preparePreprocessMatlabExecution('task-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持准备 MATLAB 执行',
    });
    await expect(runPreprocessMatlabExecution('task-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持运行 MATLAB 预处理',
    });
    await expect(startMatlabSession()).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持打开 MATLAB 会话',
      running: false,
      ready: false,
      state: 'not_started',
    });
    await expect(getMatlabSessionStatus()).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式未连接 MATLAB 会话',
      running: false,
      ready: false,
      state: 'not_started',
    });
    await expect(getPreprocessOutputs('patient-1')).resolves.toEqual({
      patientId: 'patient-1',
      subjectCode: '',
      latestTaskId: null,
      taskStatus: null,
      outputDirectories: [],
      files: [],
      warnings: ['浏览器预览模式未连接本地预处理输出'],
    });
  });

  it('falls back to deleting visible patients when the preload bridge lacks clearWorkspaceData', async () => {
    const deletePatientMock = vi.fn().mockResolvedValue({ ok: true, message: 'deleted' });
    const bridge = createBridge({
      database: {
        getWorkbenchData: vi.fn().mockResolvedValue({
          patients: [
            { id: 'sub01', patientId: 'patient-1' },
            { id: 'sub02', patientId: 'patient-2' },
          ],
          tasks: { running: [], manual: [], failed: [] },
          logs: [],
          dataRoot: 'C:\\Users\\HPGZZ\\Documents\\StrokePredictSystem',
        }),
        deletePatient: deletePatientMock,
      },
    });
    setBridge(bridge);

    await expect(clearWorkspaceData()).resolves.toEqual({
      ok: true,
      message: '已清空患者工作台记录。旧版 Electron 桥接未暴露数据文档库清空接口，请重启软件以启用完整清空。',
    });
    expect(deletePatientMock).toHaveBeenCalledTimes(2);
    expect(deletePatientMock).toHaveBeenNthCalledWith(1, 'patient-1');
    expect(deletePatientMock).toHaveBeenNthCalledWith(2, 'patient-2');
  });

  it('returns safe browser placeholders for data library operations', async () => {
    await expect(getDataLibraryStatus()).resolves.toEqual({
      sourceRoot: null,
      indexedFiles: 0,
      missingFiles: 0,
      backedUpDocuments: 0,
      manualReviewItems: 0,
      lastScanMessage: '浏览器预览模式未连接本地数据与文档库',
    });
    await expect(listSourceRoots()).resolves.toEqual([]);
    await expect(upsertSourceRoot({ projectName: 'M1', rootPath: 'F:\\CJZFile\\EEG_M1', status: 'active' })).resolves.toBeNull();
    await expect(scanAndImportDataLibrary('F:\\CJZFile\\EEG_M1')).resolves.toEqual({
      sourceRootId: '',
      createdPatients: 0,
      updatedPatients: 0,
      indexedAssets: 0,
      backedUpDocuments: 0,
      missingFiles: 0,
      pairIssues: 0,
      unmatchedFiles: 0,
      manualReviewItems: 0,
      errors: ['浏览器预览模式不支持扫描本地数据目录'],
    });
    await expect(updateDataAssetIndex('F:\\CJZFile\\EEG_M1')).resolves.toEqual({
      sourceRootId: '',
      createdPatients: 0,
      updatedPatients: 0,
      indexedAssets: 0,
      backedUpDocuments: 0,
      missingFiles: 0,
      pairIssues: 0,
      unmatchedFiles: 0,
      manualReviewItems: 0,
      errors: ['浏览器预览模式不支持更新本地数据索引'],
    });
    await expect(backupClinicalDocuments('F:\\CJZFile\\EEG_M1')).resolves.toEqual({
      sourceRootId: '',
      createdPatients: 0,
      updatedPatients: 0,
      indexedAssets: 0,
      backedUpDocuments: 0,
      missingFiles: 0,
      pairIssues: 0,
      unmatchedFiles: 0,
      manualReviewItems: 0,
      errors: ['浏览器预览模式不支持备份本地临床文档'],
    });
    await expect(selectDataLibraryRoot()).resolves.toBeNull();
    await expect(listDataAssets()).resolves.toEqual([]);
    await expect(listPatientAssetSummary()).resolves.toEqual([]);
    await expect(getPatientDocumentDetail('patient-1')).resolves.toEqual({
      patient: null,
      clinicalMetrics: null,
      assets: [],
      completeness: [],
      warnings: ['浏览器预览模式未连接本地数据与文档库'],
    });
    await expect(openAssetLocation('asset-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持打开本地路径',
    });
    await expect(openBackupDirectory()).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持打开本地路径',
    });
    await expect(resolveManualAssetMatch('asset-1', 'patient-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持人工匹配本地资产',
      asset: null,
    });
    await expect(indexExplanationArtifact(explanationArtifactInput)).resolves.toBeNull();
    await expect(listExplanationArtifacts({ patientId: 'patient-1' })).resolves.toEqual([]);
    await expect(listExplanationOverview({ taskId: 'pr' })).resolves.toEqual([]);
    await expect(createExplainabilityBatch(explanationBatchInput)).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持创建本地解释性任务',
      batchId: '',
      queuedTasks: 0,
      skippedPatients: [],
    });
    await expect(completeExplainabilityTask('explainability-task-1', explanationManifestPath)).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持完成本地解释性任务',
      indexedArtifacts: 0,
      artifactIds: [],
    });
    await expect(prepareExplainabilityExecution('explainability-task-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持准备本地解释性执行',
    });
    await expect(runExplainabilityExecution('explainability-task-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持运行本地解释性执行',
      exitCode: null,
      stdout: '',
      stderr: '',
      indexedArtifacts: 0,
      artifactIds: [],
    });
    await expect(openExplanationArtifact('explanation-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持打开本地解释性文件',
    });
    await expect(indexFeatureArtifact(featureArtifactInput)).resolves.toBeNull();
    await expect(listFeatureArtifacts({ patientId: 'patient-1' })).resolves.toEqual([]);
    await expect(listFeatureOverview()).resolves.toEqual([]);
    await expect(createFeatureGenerationBatch(featureBatchInput)).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持创建本地特征生成任务',
    });
    await expect(completeFeatureGenerationTask('feature-task-1', featureManifestPath)).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持完成本地特征生成任务',
      indexedArtifacts: 0,
      artifactIds: [],
    });
    await expect(prepareFeatureGenerationExecution('feature-task-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持准备本地特征生成执行',
    });
    await expect(runFeatureGenerationExecution('feature-task-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持运行本地特征生成',
      exitCode: null,
      stdout: '',
      stderr: '',
      indexedArtifacts: 0,
      artifactIds: [],
    });
    await expect(openFeatureArtifact('feature-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持打开本地特征文件',
    });
    await expect(listPredictionModels()).resolves.toEqual([]);
    await expect(registerPredictionModel(registerPredictionModelInput)).resolves.toBeNull();
    await expect(listPredictionQueue({ taskId: 'pr' })).resolves.toEqual([]);
    await expect(runBatchPrediction(predictionBatchInput)).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持运行本地批量预测',
    });
    await expect(preparePredictionExecution('prediction-task-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持准备本地预测执行',
    });
    await expect(runPredictionExecution('prediction-task-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持运行本地预测执行',
      predictionId: null,
      exitCode: null,
      stdout: '',
      stderr: '',
    });
    await expect(completePredictionTask('prediction-task-1', predictionResultPath)).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持完成本地预测任务',
      predictionId: null,
    });
    await expect(savePredictionResult(predictionResultInput)).resolves.toBeNull();
    await expect(createPatientReport(reportInput)).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持生成本地患者报告',
      report: null,
    });
    await expect(listPatientReports({ patientId: 'patient-1' })).resolves.toEqual([]);
    await expect(openPatientReport('report-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持打开本地报告',
    });
    await expect(createBatchSummaryReport(batchSummaryInput)).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持生成本地批次汇总',
      report: null,
    });
    await expect(listBatchSummaryReports()).resolves.toEqual([]);
    await expect(openBatchSummaryReport('batch-report-1')).resolves.toEqual({
      ok: false,
      message: '浏览器预览模式不支持打开本地批次汇总',
    });
  });
});

describe('apiClient Electron bridge', () => {
  it('forwards supported operations to window.neuroPredict', async () => {
    const workbench: WorkbenchData = {
      patients: [],
      tasks: { running: [], manual: [], failed: [] },
      logs: [],
      dataRoot: 'F:\\data',
    };
    const settings: BackendSettings = {
      dataRoot: 'F:\\data',
      outputRoot: 'F:\\out',
      matlabExecutable: 'matlab',
      eeglabPath: 'F:\\eeglab',
      defaultElectrodeLocationFile: '',
      pythonExecutable: 'F:\\tools\\python.exe',
      featureGeneratorScript: 'F:\\engines\\generate_features.py',
      predictionScript: 'F:\\engines\\predict_recovery.py',
      explainabilityScript: 'F:\\engines\\explain_recovery.py',
      modelLibraryRoot: 'F:\\models',
      defaultDownsampleRate: '250',
      defaultHighPassHz: '0.5',
      defaultLowPassHz: '45',
      defaultNotchHz: '50',
    };
    const patients: BackendPatient[] = [
      {
        id: 'patient-1',
        subjectCode: 'sub01',
        name: '',
        age: null,
        sex: '',
        diagnosis: '',
        affectedHand: '',
        notes: '',
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
      },
    ];
    const sourceRoot: SourceRoot = {
      id: 'source-1',
      projectName: 'M1',
      rootPath: 'F:\\data',
      status: 'active',
      lastScannedAt: null,
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
    };
    const status: DataLibraryStatus = {
      sourceRoot,
      indexedFiles: 1,
      missingFiles: 0,
      backedUpDocuments: 0,
      manualReviewItems: 0,
      lastScanMessage: 'Last scanned at 2026-06-14T00:00:00.000Z',
    };
    const scanResult: ScanAndImportDataLibraryResult = {
      sourceRootId: 'source-1',
      createdPatients: 0,
      updatedPatients: 0,
      indexedAssets: 1,
      backedUpDocuments: 0,
      missingFiles: 0,
      pairIssues: 0,
      unmatchedFiles: 0,
      manualReviewItems: 0,
      errors: [],
    };
    const assets: DataAsset[] = [
      {
        id: 'asset-1',
        sourceRootId: 'source-1',
        patientId: 'patient-1',
        subjectCode: 'sub01',
        sourceSubjectCode: 'sub01',
        subjectName: '',
        cohort: 'patient',
        stage: '基线',
        assetType: 'raw_eeg_cnt',
        filePath: 'F:\\data\\sub01.cnt',
        backupPath: null,
        fileSize: 10,
        fileHash: '',
        existsOnDisk: true,
        matchStatus: 'matched',
        indexedAt: '2026-06-14T00:00:00.000Z',
        lastCheckedAt: '2026-06-14T00:00:00.000Z',
      },
    ];
    const summary: DataLibrarySummaryRow[] = [
      {
        patientId: 'patient-1',
        subjectCode: 'sub01',
        subjectName: '',
        cohort: 'patient',
        hasClinicalInfo: false,
        hasRecordPdf: false,
        baselineRawCount: 1,
        baselineProcessedPairs: 0,
        immediateProcessedPairs: 0,
        phaseProcessedPairs: 0,
        finalProcessedPairs: 0,
        completenessScore: '完整',
        issueCount: 0,
        matchStatus: 'matched',
      },
    ];
    const detail: PatientDocumentDetail = {
      patient: patients[0],
      clinicalMetrics: null,
      assets,
      completeness: [],
      warnings: [],
    };
    const featureArtifacts: FeatureArtifact[] = [
      {
        id: 'feature-1',
        patientId: 'patient-1',
        subjectCode: 'sub01',
        kind: 'PSD',
        state: 'EO',
        filePath: 'F:\\features\\sub01_psd.npz',
        fileFormat: 'npz',
        fileSize: 12,
        featureCount: 5580,
        params: {},
        preview: {},
        existsOnDisk: true,
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
      },
    ];
    const featureOverview: FeatureArtifactOverviewRow[] = [
      {
        patientId: 'patient-1',
        subjectCode: 'sub01',
        patientName: '',
        featureStatus: '已完成',
        psdCount: 1,
        fcCount: 0,
        summaryCount: 0,
        previewCount: 0,
        latestFeatureAt: '2026-06-14T00:00:00.000Z',
        hasEegFeatures: true,
      },
    ];
    const predictionModels: PredictionModel[] = [
      {
        id: 'm2',
        taskId: 'pr',
        name: 'RandomForest_Baseline',
        version: 'v1.5.2',
        inputType: 'EEG-only',
        inputs: ['PSD', 'FC'],
        modelFamily: 'traditional_ml',
        checkpointMode: 'external_script',
        validation: 'LOSO',
        accuracy: 0.782,
        balancedAccuracy: 0.75,
        rocAuc: 0.83,
        prAuc: 0.8,
        status: '当前版本',
        artifactPath: '',
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
      },
    ];
    const predictionQueue: PredictionQueueRow[] = [
      {
        patientId: 'patient-1',
        subjectCode: 'sub01',
        patientName: '',
        taskId: 'pr',
        hasEegFeatures: true,
        hasClinical: false,
        prediction: '比例恢复',
        probability: 0.87,
        modelUsed: 'RandomForest_Baseline v1.5.2',
        status: '已完成',
        explanationStatus: '未生成',
        submittedAt: '2026-06-14T00:00:00.000Z',
      },
    ];
    const explanationArtifacts: ExplanationArtifact[] = [
      {
        id: 'explanation-1',
        patientId: 'patient-1',
        subjectCode: 'sub01',
        patientName: '穆祥贵',
        taskId: 'pr',
        modelId: 'm2',
        modelName: 'RandomForest_Baseline',
        modelVersion: 'v1.5.2',
        artifactType: 'patient_shap',
        title: 'sub01 SHAP force plot',
        method: 'SHAP',
        filePath: 'F:\\explainability\\sub01_shap.svg',
        fileFormat: 'svg',
        fileSize: 12,
        topFeatures: [{ name: 'Oz Alpha PSD', score: 0.22, modality: 'PSD', direction: 'positive' }],
        preview: { baseValue: 0.52, outputValue: 0.87 },
        existsOnDisk: true,
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
      },
    ];
    const explanationOverview: ExplanationOverviewRow[] = [
      {
        patientId: 'patient-1',
        subjectCode: 'sub01',
        patientName: '穆祥贵',
        taskId: 'pr',
        prediction: '比例恢复',
        probability: 0.87,
        modelUsed: 'RandomForest_Baseline v1.5.2',
        explanationStatus: '已生成',
        artifactCount: 1,
        topFeatureName: 'Oz Alpha PSD',
        latestExplanationAt: '2026-06-14T00:00:00.000Z',
      },
    ];
    const reports: PatientReport[] = [
      {
        id: 'report-1',
        patientId: 'patient-1',
        subjectCode: 'sub01',
        patientName: '',
        format: 'html',
        status: '已生成',
        filePath: 'F:\\reports\\sub01_recovery-report.html',
        generatedAt: '2026-06-14T00:00:00.000Z',
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
      },
    ];
    const batchReports: BatchSummaryReport[] = [
      {
        id: 'batch-report-1',
        format: 'csv',
        status: '已生成',
        filePath: 'F:\\reports\\batch\\batch-summary.csv',
        patientCount: 1,
        generatedAt: '2026-06-14T00:00:00.000Z',
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
      },
    ];
    const bridge = createBridge({
      database: {
        getWorkbenchData: vi.fn().mockResolvedValue(workbench),
        listPatients: vi.fn().mockResolvedValue(patients),
        createPatient: vi.fn().mockResolvedValue('patient-1'),
        updatePatient: vi.fn().mockResolvedValue(patients[0]),
        deletePatient: vi.fn().mockResolvedValue({ ok: true, message: 'deleted' }),
        registerEegFile: vi.fn().mockResolvedValue('eeg-1'),
        scanRegisteredEegFiles: vi.fn().mockResolvedValue({ scannedFiles: 2, registeredFiles: 1, unmatchedFiles: [] }),
        importPatientsCsv: vi.fn().mockResolvedValue({ created: 1, updated: 2, skipped: 3, errors: [] }),
        scanEegFolder: vi.fn().mockResolvedValue({ scannedFiles: 4, registeredFiles: 5, unmatchedFiles: ['x.set'] }),
        getDataLibraryStatus: vi.fn().mockResolvedValue(status),
        listSourceRoots: vi.fn().mockResolvedValue([sourceRoot]),
        upsertSourceRoot: vi.fn().mockResolvedValue(sourceRoot),
        scanAndImportDataLibrary: vi.fn().mockResolvedValue(scanResult),
        updateDataAssetIndex: vi.fn().mockResolvedValue(scanResult),
        backupClinicalDocuments: vi.fn().mockResolvedValue(scanResult),
        selectDataLibraryRoot: vi.fn().mockResolvedValue('F:\\CJZFile\\EEG_M1'),
        listDataAssets: vi.fn().mockResolvedValue(assets),
        listPatientAssetSummary: vi.fn().mockResolvedValue(summary),
        getPatientDocumentDetail: vi.fn().mockResolvedValue(detail),
        openAssetLocation: vi.fn().mockResolvedValue({ ok: true, message: 'opened asset' }),
        openBackupDirectory: vi.fn().mockResolvedValue({ ok: true, message: 'opened backup' }),
        resolveManualAssetMatch: vi.fn().mockResolvedValue({
          ok: true,
          message: 'matched',
          asset: assets[0],
        }),
        indexExplanationArtifact: vi.fn().mockResolvedValue('explanation-1'),
        listExplanationArtifacts: vi.fn().mockResolvedValue(explanationArtifacts),
        listExplanationOverview: vi.fn().mockResolvedValue(explanationOverview),
        createExplainabilityBatch: vi.fn().mockResolvedValue({
          ok: true,
          message: 'explainability queued',
          batchId: 'explainability-batch-1',
          queuedTasks: 1,
          skippedPatients: [],
        }),
        completeExplainabilityTask: vi.fn().mockResolvedValue({
          ok: true,
          message: 'explainability completed',
          indexedArtifacts: 2,
          artifactIds: ['explanation-1', 'explanation-2'],
        }),
        prepareExplainabilityExecution: vi.fn().mockResolvedValue({
          ok: true,
          message: 'explainability prepared',
          packagePath: 'F:\\explainability\\task.json',
        }),
        runExplainabilityExecution: vi.fn().mockResolvedValue({
          ok: true,
          message: 'explainability completed',
          exitCode: 0,
          stdout: 'explainability generated',
          stderr: '',
          indexedArtifacts: 2,
          artifactIds: ['explanation-1', 'explanation-2'],
        }),
        openExplanationArtifact: vi.fn().mockResolvedValue({ ok: true, message: 'opened explanation' }),
        indexFeatureArtifact: vi.fn().mockResolvedValue('feature-1'),
        listFeatureArtifacts: vi.fn().mockResolvedValue(featureArtifacts),
        listFeatureOverview: vi.fn().mockResolvedValue(featureOverview),
        createFeatureGenerationBatch: vi.fn().mockResolvedValue({
          ok: true,
          message: 'queued',
          batchId: 'feature-batch-1',
          queuedTasks: 1,
          skippedPatients: [],
        }),
        completeFeatureGenerationTask: vi.fn().mockResolvedValue({
          ok: true,
          message: 'completed',
          indexedArtifacts: 2,
          artifactIds: ['feature-1', 'feature-2'],
        }),
        prepareFeatureGenerationExecution: vi.fn().mockResolvedValue({
          ok: true,
          message: 'prepared',
          packagePath: 'F:\\features\\task.json',
        }),
        runFeatureGenerationExecution: vi.fn().mockResolvedValue({
          ok: true,
          message: 'completed',
          exitCode: 0,
          stdout: 'features generated',
          stderr: '',
          indexedArtifacts: 2,
          artifactIds: ['feature-1', 'feature-2'],
        }),
        openFeatureArtifact: vi.fn().mockResolvedValue({ ok: true, message: 'opened feature' }),
        listPredictionModels: vi.fn().mockResolvedValue(predictionModels),
        registerPredictionModel: vi.fn().mockResolvedValue(predictionModels[0]),
        listPredictionQueue: vi.fn().mockResolvedValue(predictionQueue),
        runBatchPrediction: vi.fn().mockResolvedValue({
          ok: true,
          message: 'prediction queued',
          batchId: 'prediction-batch-1',
          queuedTasks: 1,
          skippedPatients: [],
        }),
        preparePredictionExecution: vi.fn().mockResolvedValue({
          ok: true,
          message: 'prediction prepared',
          packagePath: 'F:\\predictions\\task.json',
        }),
        runPredictionExecution: vi.fn().mockResolvedValue({
          ok: true,
          message: 'prediction completed',
          predictionId: 'prediction-1',
          exitCode: 0,
          stdout: 'prediction generated',
          stderr: '',
        }),
        completePredictionTask: vi.fn().mockResolvedValue({
          ok: true,
          message: 'prediction completed',
          predictionId: 'prediction-1',
        }),
        savePredictionResult: vi.fn().mockResolvedValue('prediction-1'),
        createPatientReport: vi.fn().mockResolvedValue({
          ok: true,
          message: 'report generated',
          report: reports[0],
        }),
        listPatientReports: vi.fn().mockResolvedValue(reports),
        openPatientReport: vi.fn().mockResolvedValue({ ok: true, message: 'opened report' }),
        createBatchSummaryReport: vi.fn().mockResolvedValue({
          ok: true,
          message: 'batch summary generated',
          report: batchReports[0],
        }),
        listBatchSummaryReports: vi.fn().mockResolvedValue(batchReports),
        openBatchSummaryReport: vi.fn().mockResolvedValue({ ok: true, message: 'opened batch summary' }),
      },
      tasks: {
        listTasks: vi.fn().mockResolvedValue([]),
        listTaskLogs: vi.fn().mockResolvedValue([]),
        retryTask: vi.fn().mockResolvedValue({ ok: true, message: 'retried' }),
        cancelTask: vi.fn().mockResolvedValue({ ok: true, message: 'cancelled' }),
        startNextQueuedTask: vi.fn().mockResolvedValue({
          ok: true,
          message: 'ran next',
          taskId: 'feature-task-1',
          taskType: 'feature_generation',
        }),
        createPreprocessBatch: vi.fn().mockResolvedValue({ ok: true, message: 'queued' }),
        completePreprocessManualStep: vi.fn().mockResolvedValue({ ok: true, message: 'manual done' }),
        markManualStepCompleted: vi.fn().mockResolvedValue({ ok: true, message: 'manual done' }),
        launchPreprocessManualStep: vi.fn().mockResolvedValue({
          ok: true,
          message: 'launched',
          packagePath: 'C:\\out\\task.json',
          launchTargetPath: 'C:\\MATLAB\\matlab.exe',
        }),
        preparePreprocessMatlabExecution: vi.fn().mockResolvedValue({
          ok: true,
          message: 'prepared',
          scriptPath: 'C:\\out\\run_preprocess_task.m',
          packagePath: 'C:\\out\\task.json',
          command: '"C:\\MATLAB\\matlab.exe" -batch "..."',
        }),
        runPreprocessMatlabExecution: vi.fn().mockResolvedValue({
          ok: true,
          message: 'ran',
          exitCode: 0,
          stdout: 'stage01 saved',
          stderr: '',
        }),
        getPreprocessOutputs: vi.fn().mockResolvedValue({
          patientId: 'patient-1',
          subjectCode: 'sub01',
          latestTaskId: 'task-1',
          taskStatus: 'completed',
          outputDirectories: ['C:\\out\\preprocess\\sub01'],
          files: [],
          warnings: [],
        }),
      },
      settings: {
        getSettings: vi.fn().mockResolvedValue(settings),
        updateSettings: vi.fn().mockResolvedValue({ ...settings, ...settingsInput }),
      },
    });
    setBridge(bridge);

    await expect(getWorkbenchData()).resolves.toBe(workbench);
    await expect(listPatients()).resolves.toBe(patients);
    await expect(createPatient(patientInput)).resolves.toBe('patient-1');
    await expect(updatePatient('patient-1', patientInput)).resolves.toBe(patients[0]);
    await expect(deletePatient('patient-1')).resolves.toEqual({ ok: true, message: 'deleted' });
    await expect(registerEegFile(eegFileInput)).resolves.toBe('eeg-1');
    await expect(scanRegisteredEegFiles()).resolves.toEqual({ scannedFiles: 2, registeredFiles: 1, unmatchedFiles: [] });
    await expect(importPatientsCsv()).resolves.toEqual({ created: 1, updated: 2, skipped: 3, errors: [] });
    await expect(scanEegFolder()).resolves.toEqual({ scannedFiles: 4, registeredFiles: 5, unmatchedFiles: ['x.set'] });
    await expect(getDataLibraryStatus()).resolves.toBe(status);
    await expect(listSourceRoots()).resolves.toEqual([sourceRoot]);
    await expect(upsertSourceRoot({ projectName: 'M1', rootPath: 'F:\\data', status: 'active' })).resolves.toBe(sourceRoot);
    await expect(scanAndImportDataLibrary('F:\\data')).resolves.toBe(scanResult);
    await expect(updateDataAssetIndex('F:\\data')).resolves.toBe(scanResult);
    await expect(backupClinicalDocuments('F:\\data')).resolves.toBe(scanResult);
    await expect(selectDataLibraryRoot()).resolves.toBe('F:\\CJZFile\\EEG_M1');
    await expect(listDataAssets({ patientId: 'patient-1' })).resolves.toBe(assets);
    await expect(listPatientAssetSummary()).resolves.toBe(summary);
    await expect(getPatientDocumentDetail('patient-1')).resolves.toBe(detail);
    await expect(openAssetLocation('asset-1')).resolves.toEqual({ ok: true, message: 'opened asset' });
    await expect(openBackupDirectory()).resolves.toEqual({ ok: true, message: 'opened backup' });
    await expect(resolveManualAssetMatch('asset-1', 'patient-1')).resolves.toEqual({
      ok: true,
      message: 'matched',
      asset: assets[0],
    });
    await expect(indexExplanationArtifact(explanationArtifactInput)).resolves.toBe('explanation-1');
    await expect(listExplanationArtifacts({ patientId: 'patient-1' })).resolves.toBe(explanationArtifacts);
    await expect(listExplanationOverview({ taskId: 'pr' })).resolves.toBe(explanationOverview);
    await expect(createExplainabilityBatch(explanationBatchInput)).resolves.toEqual({
      ok: true,
      message: 'explainability queued',
      batchId: 'explainability-batch-1',
      queuedTasks: 1,
      skippedPatients: [],
    });
    await expect(completeExplainabilityTask('explainability-task-1', explanationManifestPath)).resolves.toEqual({
      ok: true,
      message: 'explainability completed',
      indexedArtifacts: 2,
      artifactIds: ['explanation-1', 'explanation-2'],
    });
    await expect(prepareExplainabilityExecution('explainability-task-1')).resolves.toEqual({
      ok: true,
      message: 'explainability prepared',
      packagePath: 'F:\\explainability\\task.json',
    });
    await expect(runExplainabilityExecution('explainability-task-1')).resolves.toEqual({
      ok: true,
      message: 'explainability completed',
      exitCode: 0,
      stdout: 'explainability generated',
      stderr: '',
      indexedArtifacts: 2,
      artifactIds: ['explanation-1', 'explanation-2'],
    });
    await expect(openExplanationArtifact('explanation-1')).resolves.toEqual({ ok: true, message: 'opened explanation' });
    await expect(indexFeatureArtifact(featureArtifactInput)).resolves.toBe('feature-1');
    await expect(listFeatureArtifacts({ patientId: 'patient-1' })).resolves.toBe(featureArtifacts);
    await expect(listFeatureOverview()).resolves.toBe(featureOverview);
    await expect(createFeatureGenerationBatch(featureBatchInput)).resolves.toEqual({
      ok: true,
      message: 'queued',
      batchId: 'feature-batch-1',
      queuedTasks: 1,
      skippedPatients: [],
    });
    await expect(completeFeatureGenerationTask('feature-task-1', featureManifestPath)).resolves.toEqual({
      ok: true,
      message: 'completed',
      indexedArtifacts: 2,
      artifactIds: ['feature-1', 'feature-2'],
    });
    await expect(prepareFeatureGenerationExecution('feature-task-1')).resolves.toEqual({
      ok: true,
      message: 'prepared',
      packagePath: 'F:\\features\\task.json',
    });
    await expect(runFeatureGenerationExecution('feature-task-1')).resolves.toEqual({
      ok: true,
      message: 'completed',
      exitCode: 0,
      stdout: 'features generated',
      stderr: '',
      indexedArtifacts: 2,
      artifactIds: ['feature-1', 'feature-2'],
    });
    await expect(openFeatureArtifact('feature-1')).resolves.toEqual({ ok: true, message: 'opened feature' });
    await expect(listPredictionModels()).resolves.toBe(predictionModels);
    await expect(registerPredictionModel(registerPredictionModelInput)).resolves.toBe(predictionModels[0]);
    await expect(listPredictionQueue({ taskId: 'pr' })).resolves.toBe(predictionQueue);
    await expect(runBatchPrediction(predictionBatchInput)).resolves.toEqual({
      ok: true,
      message: 'prediction queued',
      batchId: 'prediction-batch-1',
      queuedTasks: 1,
      skippedPatients: [],
    });
    await expect(preparePredictionExecution('prediction-task-1')).resolves.toEqual({
      ok: true,
      message: 'prediction prepared',
      packagePath: 'F:\\predictions\\task.json',
    });
    await expect(runPredictionExecution('prediction-task-1')).resolves.toEqual({
      ok: true,
      message: 'prediction completed',
      predictionId: 'prediction-1',
      exitCode: 0,
      stdout: 'prediction generated',
      stderr: '',
    });
    await expect(completePredictionTask('prediction-task-1', predictionResultPath)).resolves.toEqual({
      ok: true,
      message: 'prediction completed',
      predictionId: 'prediction-1',
    });
    await expect(savePredictionResult(predictionResultInput)).resolves.toBe('prediction-1');
    await expect(createPatientReport(reportInput)).resolves.toEqual({
      ok: true,
      message: 'report generated',
      report: reports[0],
    });
    await expect(listPatientReports({ patientId: 'patient-1' })).resolves.toBe(reports);
    await expect(openPatientReport('report-1')).resolves.toEqual({ ok: true, message: 'opened report' });
    await expect(createBatchSummaryReport(batchSummaryInput)).resolves.toEqual({
      ok: true,
      message: 'batch summary generated',
      report: batchReports[0],
    });
    await expect(listBatchSummaryReports()).resolves.toBe(batchReports);
    await expect(openBatchSummaryReport('batch-report-1')).resolves.toEqual({ ok: true, message: 'opened batch summary' });
    await expect(listTasks({ status: 'queued' })).resolves.toEqual([]);
    await expect(listTaskLogs({ level: 'info' })).resolves.toEqual([]);
    await expect(retryTask('failed-task-1')).resolves.toEqual({ ok: true, message: 'retried' });
    await expect(cancelTask('queued-task-1')).resolves.toEqual({ ok: true, message: 'cancelled' });
    await expect(startNextQueuedTask()).resolves.toEqual({
      ok: true,
      message: 'ran next',
      taskId: 'feature-task-1',
      taskType: 'feature_generation',
    });
    await expect(getSettings()).resolves.toBe(settings);
    await expect(updateSettings(settingsInput)).resolves.toMatchObject(settingsInput);
    await expect(startPreprocessing(preprocessInput)).resolves.toEqual({ ok: true, message: 'queued' });
    await expect(completePreprocessManualStep('task-1')).resolves.toEqual({ ok: true, message: 'manual done' });
    await expect(markManualStepCompleted('task-1')).resolves.toEqual({ ok: true, message: 'manual done' });
    await expect(launchPreprocessManualStep('task-1')).resolves.toEqual({
      ok: true,
      message: 'launched',
      packagePath: 'C:\\out\\task.json',
      launchTargetPath: 'C:\\MATLAB\\matlab.exe',
    });
    await expect(preparePreprocessMatlabExecution('task-1')).resolves.toEqual({
      ok: true,
      message: 'prepared',
      scriptPath: 'C:\\out\\run_preprocess_task.m',
      packagePath: 'C:\\out\\task.json',
      command: '"C:\\MATLAB\\matlab.exe" -batch "..."',
    });
    await expect(runPreprocessMatlabExecution('task-1')).resolves.toEqual({
      ok: true,
      message: 'ran',
      exitCode: 0,
      stdout: 'stage01 saved',
      stderr: '',
    });
    vi.mocked(bridge.tasks.startMatlabSession).mockResolvedValue({
      ok: true,
      message: 'MATLAB 会话已启动',
      running: true,
      ready: false,
      state: 'starting',
    });
    vi.mocked(bridge.tasks.getMatlabSessionStatus).mockResolvedValue({
      ok: true,
      message: 'MATLAB 会话正在启动',
      running: true,
      ready: false,
      state: 'starting',
    });
    await expect(startMatlabSession()).resolves.toEqual({
      ok: true,
      message: 'MATLAB 会话已启动',
      running: true,
      ready: false,
      state: 'starting',
    });
    await expect(getMatlabSessionStatus()).resolves.toEqual({
      ok: true,
      message: 'MATLAB 会话正在启动',
      running: true,
      ready: false,
      state: 'starting',
    });
    await expect(getPreprocessOutputs('patient-1')).resolves.toEqual({
      patientId: 'patient-1',
      subjectCode: 'sub01',
      latestTaskId: 'task-1',
      taskStatus: 'completed',
      outputDirectories: ['C:\\out\\preprocess\\sub01'],
      files: [],
      warnings: [],
    });

    expect(bridge.database.getWorkbenchData).toHaveBeenCalledOnce();
    expect(bridge.database.listPatients).toHaveBeenCalledOnce();
    expect(bridge.database.createPatient).toHaveBeenCalledWith(patientInput);
    expect(bridge.database.updatePatient).toHaveBeenCalledWith('patient-1', patientInput);
    expect(bridge.database.deletePatient).toHaveBeenCalledWith('patient-1');
    expect(bridge.database.registerEegFile).toHaveBeenCalledWith(eegFileInput);
    expect(bridge.database.scanRegisteredEegFiles).toHaveBeenCalledOnce();
    expect(bridge.database.importPatientsCsv).toHaveBeenCalledOnce();
    expect(bridge.database.scanEegFolder).toHaveBeenCalledOnce();
    expect(bridge.database.getDataLibraryStatus).toHaveBeenCalledOnce();
    expect(bridge.database.listSourceRoots).toHaveBeenCalledOnce();
    expect(bridge.database.upsertSourceRoot).toHaveBeenCalledWith({
      projectName: 'M1',
      rootPath: 'F:\\data',
      status: 'active',
    });
    expect(bridge.database.scanAndImportDataLibrary).toHaveBeenCalledWith('F:\\data');
    expect(bridge.database.updateDataAssetIndex).toHaveBeenCalledWith('F:\\data');
    expect(bridge.database.backupClinicalDocuments).toHaveBeenCalledWith('F:\\data');
    expect(bridge.database.selectDataLibraryRoot).toHaveBeenCalledOnce();
    expect(bridge.database.listDataAssets).toHaveBeenCalledWith({ patientId: 'patient-1' });
    expect(bridge.database.listPatientAssetSummary).toHaveBeenCalledOnce();
    expect(bridge.database.getPatientDocumentDetail).toHaveBeenCalledWith('patient-1');
    expect(bridge.database.openAssetLocation).toHaveBeenCalledWith('asset-1');
    expect(bridge.database.openBackupDirectory).toHaveBeenCalledOnce();
    expect(bridge.database.resolveManualAssetMatch).toHaveBeenCalledWith('asset-1', 'patient-1');
    expect(bridge.database.indexExplanationArtifact).toHaveBeenCalledWith(explanationArtifactInput);
    expect(bridge.database.listExplanationArtifacts).toHaveBeenCalledWith({ patientId: 'patient-1' });
    expect(bridge.database.listExplanationOverview).toHaveBeenCalledWith({ taskId: 'pr' });
    expect(bridge.database.createExplainabilityBatch).toHaveBeenCalledWith(explanationBatchInput);
    expect(bridge.database.completeExplainabilityTask).toHaveBeenCalledWith('explainability-task-1', explanationManifestPath);
    expect(bridge.database.prepareExplainabilityExecution).toHaveBeenCalledWith('explainability-task-1');
    expect(bridge.database.runExplainabilityExecution).toHaveBeenCalledWith('explainability-task-1');
    expect(bridge.database.openExplanationArtifact).toHaveBeenCalledWith('explanation-1');
    expect(bridge.database.indexFeatureArtifact).toHaveBeenCalledWith(featureArtifactInput);
    expect(bridge.database.listFeatureArtifacts).toHaveBeenCalledWith({ patientId: 'patient-1' });
    expect(bridge.database.listFeatureOverview).toHaveBeenCalledOnce();
    expect(bridge.database.createFeatureGenerationBatch).toHaveBeenCalledWith(featureBatchInput);
    expect(bridge.database.completeFeatureGenerationTask).toHaveBeenCalledWith('feature-task-1', featureManifestPath);
    expect(bridge.database.prepareFeatureGenerationExecution).toHaveBeenCalledWith('feature-task-1');
    expect(bridge.database.runFeatureGenerationExecution).toHaveBeenCalledWith('feature-task-1');
    expect(bridge.database.openFeatureArtifact).toHaveBeenCalledWith('feature-1');
    expect(bridge.database.listPredictionModels).toHaveBeenCalledOnce();
    expect(bridge.database.registerPredictionModel).toHaveBeenCalledWith(registerPredictionModelInput);
    expect(bridge.database.listPredictionQueue).toHaveBeenCalledWith({ taskId: 'pr' });
    expect(bridge.database.runBatchPrediction).toHaveBeenCalledWith(predictionBatchInput);
    expect(bridge.database.preparePredictionExecution).toHaveBeenCalledWith('prediction-task-1');
    expect(bridge.database.runPredictionExecution).toHaveBeenCalledWith('prediction-task-1');
    expect(bridge.database.completePredictionTask).toHaveBeenCalledWith('prediction-task-1', predictionResultPath);
    expect(bridge.database.savePredictionResult).toHaveBeenCalledWith(predictionResultInput);
    expect(bridge.database.createPatientReport).toHaveBeenCalledWith(reportInput);
    expect(bridge.database.listPatientReports).toHaveBeenCalledWith({ patientId: 'patient-1' });
    expect(bridge.database.openPatientReport).toHaveBeenCalledWith('report-1');
    expect(bridge.database.createBatchSummaryReport).toHaveBeenCalledWith(batchSummaryInput);
    expect(bridge.database.listBatchSummaryReports).toHaveBeenCalledOnce();
    expect(bridge.database.openBatchSummaryReport).toHaveBeenCalledWith('batch-report-1');
    expect(bridge.tasks.listTasks).toHaveBeenCalledWith({ status: 'queued' });
    expect(bridge.tasks.listTaskLogs).toHaveBeenCalledWith({ level: 'info' });
    expect(bridge.tasks.retryTask).toHaveBeenCalledWith('failed-task-1');
    expect(bridge.tasks.cancelTask).toHaveBeenCalledWith('queued-task-1');
    expect(bridge.tasks.startNextQueuedTask).toHaveBeenCalledOnce();
    expect(bridge.settings.getSettings).toHaveBeenCalledOnce();
    expect(bridge.settings.updateSettings).toHaveBeenCalledWith(settingsInput);
    expect(bridge.tasks.createPreprocessBatch).toHaveBeenCalledWith(preprocessInput);
    expect(bridge.tasks.completePreprocessManualStep).toHaveBeenCalledWith('task-1');
    expect(bridge.tasks.markManualStepCompleted).toHaveBeenCalledWith('task-1');
    expect(bridge.tasks.launchPreprocessManualStep).toHaveBeenCalledWith('task-1');
    expect(bridge.tasks.preparePreprocessMatlabExecution).toHaveBeenCalledWith('task-1');
    expect(bridge.tasks.runPreprocessMatlabExecution).toHaveBeenCalledWith('task-1');
    expect(bridge.tasks.startMatlabSession).toHaveBeenCalledOnce();
    expect(bridge.tasks.getMatlabSessionStatus).toHaveBeenCalledOnce();
    expect(bridge.tasks.getPreprocessOutputs).toHaveBeenCalledWith('patient-1');
  });
});
