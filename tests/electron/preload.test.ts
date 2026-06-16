import { describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  exposeInMainWorld: vi.fn((key: string, value: unknown) => {
    electronMocks.exposed.set(key, value);
  }),
  invoke: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
  },
}));

describe('preload bridge', () => {
  it('exposes neuroPredict without exposing ipcRenderer directly', async () => {
    electronMocks.exposed.clear();
    electronMocks.exposeInMainWorld.mockClear();
    electronMocks.invoke.mockReset();

    await import('../../src/electron/preload.js');

    const bridge = electronMocks.exposed.get('neuroPredict') as {
      platform: NodeJS.Platform;
      database: Record<string, (...args: unknown[]) => Promise<unknown>>;
      tasks: Record<string, (...args: unknown[]) => Promise<unknown>>;
      settings: Record<string, (...args: unknown[]) => Promise<unknown>>;
      ipcRenderer?: unknown;
    };

    expect(electronMocks.exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(bridge.platform).toBe(process.platform);
    expect(bridge.ipcRenderer).toBeUndefined();
    expect(Object.keys(bridge.database).sort()).toEqual([
      'backupClinicalDocuments',
      'clearWorkspaceData',
      'completeExistingPreprocessManualStep',
      'completeExistingPreprocessRun',
      'completeExplainabilityTask',
      'completeFeatureGenerationTask',
      'completePredictionTask',
      'createBatchSummaryReport',
      'createExplainabilityBatch',
      'createFeatureGenerationBatch',
      'createPatient',
      'createPatientReport',
      'deleteExplanationArtifact',
      'deletePatient',
      'getDataLibraryStatus',
      'getPatientDocumentDetail',
      'getWorkbenchData',
      'importExistingPatientRun',
      'importPatientsCsv',
      'indexExistingExplanationResults',
      'indexExistingFeatureResults',
      'indexExplanationArtifact',
      'indexFeatureArtifact',
      'launchExistingPreprocessManualStep',
      'listBatchSummaryReports',
      'listDataAssets',
      'listExplanationArtifacts',
      'listExplanationOverview',
      'listFeatureArtifacts',
      'listFeatureOverview',
      'listPatientAssetSummary',
      'listPatientReports',
      'listPatients',
      'listPredictionModels',
      'listPredictionQueue',
      'listSourceRoots',
      'openAssetLocation',
      'openBackupDirectory',
      'openBatchSummaryReport',
      'openExplanationArtifact',
      'openFeatureArtifact',
      'openPatientReport',
      'prepareExplainabilityExecution',
      'prepareFeatureGenerationExecution',
      'preparePredictionExecution',
      'registerEegFile',
      'registerPredictionModel',
      'resolveManualAssetMatch',
      'runBatchPrediction',
      'runExplainabilityExecution',
      'runFeatureGenerationExecution',
      'runPredictionExecution',
      'saveExistingPredictionResult',
      'savePredictionResult',
      'scanAndImportDataLibrary',
      'scanEegFolder',
      'scanRegisteredEegFiles',
      'selectDataLibraryRoot',
      'updateDataAssetIndex',
      'updatePatient',
      'upsertSourceRoot',
    ]);
    expect(Object.keys(bridge.tasks).sort()).toEqual([
      'cancelTask',
      'completePreprocessManualStep',
      'createPreprocessBatch',
      'getPreprocessOutputs',
      'launchPreprocessManualStep',
      'listTaskLogs',
      'listTasks',
      'markManualStepCompleted',
      'preparePreprocessMatlabExecution',
      'retryTask',
      'runPreprocessMatlabExecution',
      'getMatlabSessionStatus',
      'startMatlabSession',
      'startNextQueuedTask',
    ].sort());
    expect(Object.keys(bridge.settings).sort()).toEqual(['getSettings', 'updateSettings']);

    const createPatientInput = { subjectCode: 'sub01' };
    const registerEegFileInput = { patientId: 'sub01', condition: 'EO', filePath: 'sub01_EO.set' };
    const preprocessInput = {
      patientIds: ['sub01'],
      selectedEmptyChannels: [],
      selectedBadChannels: [],
      referenceMode: 'average',
      downsampleRate: 500,
      highPassHz: 1,
      lowPassHz: 45,
      notchHz: 50,
    };
    const settingsInput = { dataRoot: 'C:\\data' };

    await bridge.database.getWorkbenchData();
    await bridge.database.listPatients();
    await bridge.database.createPatient(createPatientInput);
    await bridge.database.updatePatient('patient-1', createPatientInput);
    await bridge.database.deletePatient('patient-1');
    await bridge.database.clearWorkspaceData();
    await bridge.database.registerEegFile(registerEegFileInput);
    await bridge.database.scanRegisteredEegFiles();
    await bridge.database.importExistingPatientRun();
    await bridge.database.launchExistingPreprocessManualStep({ patientIds: ['patient-1'], step: 'bad_segments' });
    await bridge.database.completeExistingPreprocessManualStep({ patientIds: ['patient-1'], step: 'bad_segments' });
    await bridge.database.completeExistingPreprocessRun({ patientIds: ['patient-1'] });
    await bridge.database.indexExistingFeatureResults({ patientIds: ['patient-1'] });
    await bridge.database.saveExistingPredictionResult({ patientIds: ['patient-1'], taskId: 'pr', modelId: 'm2' });
    await bridge.database.indexExistingExplanationResults({ patientIds: ['patient-1'], taskId: 'pr', modelId: 'm2' });
    await bridge.database.importPatientsCsv();
    await bridge.database.scanEegFolder();
    await bridge.database.getDataLibraryStatus();
    await bridge.database.listSourceRoots();
    await bridge.database.upsertSourceRoot({ projectName: 'M1', rootPath: 'F:\\data', status: 'active' });
    await bridge.database.scanAndImportDataLibrary('F:\\data');
    await bridge.database.updateDataAssetIndex('F:\\data');
    await bridge.database.backupClinicalDocuments('F:\\data');
    await bridge.database.selectDataLibraryRoot();
    await bridge.database.listDataAssets({ patientId: 'patient-1' });
    await bridge.database.listPatientAssetSummary();
    await bridge.database.getPatientDocumentDetail('patient-1');
    await bridge.database.openAssetLocation('asset-1');
    await bridge.database.openBackupDirectory();
    await bridge.database.resolveManualAssetMatch('asset-1', 'patient-1');
    await bridge.database.indexExplanationArtifact({
      patientId: 'patient-1',
      taskId: 'pr',
      modelId: 'm2',
      artifactType: 'patient_shap',
      title: 'sub01 SHAP force plot',
      filePath: 'F:\\explainability\\sub01_shap.svg',
    });
    await bridge.database.listExplanationArtifacts({ patientId: 'patient-1' });
    await bridge.database.listExplanationOverview({ taskId: 'pr' });
    await bridge.database.deleteExplanationArtifact('explanation-1');
    await bridge.database.createExplainabilityBatch({
      taskId: 'pr',
      modelId: 'm2',
      patientIds: ['patient-1'],
      artifactTypes: ['patient_shap'],
    });
    await bridge.database.completeExplainabilityTask('explainability-task-1', 'F:\\explainability\\manifest.json');
    await bridge.database.prepareExplainabilityExecution('explainability-task-1');
    await bridge.database.runExplainabilityExecution('explainability-task-1');
    await bridge.database.openExplanationArtifact('explanation-1');
    await bridge.database.indexFeatureArtifact({
      patientId: 'patient-1',
      kind: 'PSD',
      state: 'EO',
      filePath: 'F:\\features\\sub01_psd.npz',
    });
    await bridge.database.listFeatureArtifacts({ patientId: 'patient-1' });
    await bridge.database.listFeatureOverview();
    await bridge.database.createFeatureGenerationBatch({
      patientIds: ['patient-1'],
      featureKinds: ['PSD', 'FC'],
      states: ['EO', 'EC'],
      overwrite: false,
    });
    await bridge.database.completeFeatureGenerationTask('feature-task-1', 'F:\\features\\feature_manifest.json');
    await bridge.database.prepareFeatureGenerationExecution('feature-task-1');
    await bridge.database.runFeatureGenerationExecution('feature-task-1');
    await bridge.database.openFeatureArtifact('feature-1');
    await bridge.database.listPredictionModels();
    await bridge.database.registerPredictionModel({
      taskId: 'pr',
      name: 'CustomModel',
      version: 'v1',
      inputType: 'EEG-only',
      inputs: ['PSD'],
      artifactPath: 'F:\\models\\custom.json',
    });
    await bridge.database.listPredictionQueue({ taskId: 'pr' });
    await bridge.database.runBatchPrediction({ taskId: 'pr', modelId: 'm2', patientIds: ['patient-1'] });
    await bridge.database.preparePredictionExecution('prediction-task-1');
    await bridge.database.runPredictionExecution('prediction-task-1');
    await bridge.database.completePredictionTask('prediction-task-1', 'F:\\predictions\\sub01_prediction.json');
    await bridge.database.savePredictionResult({
      patientId: 'patient-1',
      taskId: 'pr',
      modelId: 'm2',
      predictedClass: '比例恢复',
      probability: 0.87,
      threshold: 0.5,
      labelDefinition: '比例恢复 (PR) vs 恢复不良',
    });
    await bridge.database.createPatientReport({
      patientId: 'patient-1',
      title: 'tACS EEG 康复结局预测报告',
    });
    await bridge.database.listPatientReports({ patientId: 'patient-1' });
    await bridge.database.openPatientReport('report-1');
    await bridge.database.createBatchSummaryReport({
      title: 'tACS EEG 康复结局批次汇总',
    });
    await bridge.database.listBatchSummaryReports();
    await bridge.database.openBatchSummaryReport('batch-report-1');
    await bridge.tasks.listTasks({ status: 'queued' });
    await bridge.tasks.listTaskLogs({ level: 'info' });
    await bridge.tasks.retryTask('failed-task-1');
    await bridge.tasks.cancelTask('queued-task-1');
    await bridge.tasks.startNextQueuedTask();
    await bridge.tasks.createPreprocessBatch(preprocessInput);
    await bridge.tasks.completePreprocessManualStep('task-1');
    await bridge.tasks.markManualStepCompleted('task-1');
    await bridge.tasks.getPreprocessOutputs('patient-1');
    await bridge.tasks.launchPreprocessManualStep('task-1');
    await bridge.tasks.preparePreprocessMatlabExecution('task-1');
    await bridge.tasks.runPreprocessMatlabExecution('task-1');
    await bridge.tasks.startMatlabSession();
    await bridge.tasks.getMatlabSessionStatus();
    await bridge.settings.getSettings();
    await bridge.settings.updateSettings(settingsInput);

    expect(electronMocks.invoke.mock.calls).toEqual([
      ['backend:getWorkbenchData'],
      ['backend:listPatients'],
      ['backend:createPatient', createPatientInput],
      ['backend:updatePatient', 'patient-1', createPatientInput],
      ['backend:deletePatient', 'patient-1'],
      ['backend:clearWorkspaceData'],
      ['backend:registerEegFile', registerEegFileInput],
      ['backend:scanRegisteredEegFiles'],
      ['backend:importExistingPatientRun', undefined],
      ['backend:launchExistingPreprocessManualStep', { patientIds: ['patient-1'], step: 'bad_segments' }],
      ['backend:completeExistingPreprocessManualStep', { patientIds: ['patient-1'], step: 'bad_segments' }],
      ['backend:completeExistingPreprocessRun', { patientIds: ['patient-1'] }],
      ['backend:indexExistingFeatureResults', { patientIds: ['patient-1'] }],
      ['backend:saveExistingPredictionResult', { patientIds: ['patient-1'], taskId: 'pr', modelId: 'm2' }],
      ['backend:indexExistingExplanationResults', { patientIds: ['patient-1'], taskId: 'pr', modelId: 'm2' }],
      ['backend:importPatientsCsv'],
      ['backend:scanEegFolder'],
      ['backend:getDataLibraryStatus'],
      ['backend:listSourceRoots'],
      ['backend:upsertSourceRoot', { projectName: 'M1', rootPath: 'F:\\data', status: 'active' }],
      ['backend:scanAndImportDataLibrary', 'F:\\data'],
      ['backend:updateDataAssetIndex', 'F:\\data'],
      ['backend:backupClinicalDocuments', 'F:\\data'],
      ['backend:selectDataLibraryRoot'],
      ['backend:listDataAssets', { patientId: 'patient-1' }],
      ['backend:listPatientAssetSummary'],
      ['backend:getPatientDocumentDetail', 'patient-1'],
      ['backend:openAssetLocation', 'asset-1'],
      ['backend:openBackupDirectory'],
      ['backend:resolveManualAssetMatch', 'asset-1', 'patient-1'],
      ['backend:indexExplanationArtifact', {
        patientId: 'patient-1',
        taskId: 'pr',
        modelId: 'm2',
        artifactType: 'patient_shap',
        title: 'sub01 SHAP force plot',
        filePath: 'F:\\explainability\\sub01_shap.svg',
      }],
      ['backend:listExplanationArtifacts', { patientId: 'patient-1' }],
      ['backend:listExplanationOverview', { taskId: 'pr' }],
      ['backend:deleteExplanationArtifact', 'explanation-1'],
      ['backend:createExplainabilityBatch', {
        taskId: 'pr',
        modelId: 'm2',
        patientIds: ['patient-1'],
        artifactTypes: ['patient_shap'],
      }],
      ['backend:completeExplainabilityTask', 'explainability-task-1', 'F:\\explainability\\manifest.json'],
      ['backend:prepareExplainabilityExecution', 'explainability-task-1'],
      ['backend:runExplainabilityExecution', 'explainability-task-1'],
      ['backend:openExplanationArtifact', 'explanation-1'],
      ['backend:indexFeatureArtifact', {
        patientId: 'patient-1',
        kind: 'PSD',
        state: 'EO',
        filePath: 'F:\\features\\sub01_psd.npz',
      }],
      ['backend:listFeatureArtifacts', { patientId: 'patient-1' }],
      ['backend:listFeatureOverview'],
      ['backend:createFeatureGenerationBatch', {
        patientIds: ['patient-1'],
        featureKinds: ['PSD', 'FC'],
        states: ['EO', 'EC'],
        overwrite: false,
      }],
      ['backend:completeFeatureGenerationTask', 'feature-task-1', 'F:\\features\\feature_manifest.json'],
      ['backend:prepareFeatureGenerationExecution', 'feature-task-1'],
      ['backend:runFeatureGenerationExecution', 'feature-task-1'],
      ['backend:openFeatureArtifact', 'feature-1'],
      ['backend:listPredictionModels'],
      ['backend:registerPredictionModel', {
        taskId: 'pr',
        name: 'CustomModel',
        version: 'v1',
        inputType: 'EEG-only',
        inputs: ['PSD'],
        artifactPath: 'F:\\models\\custom.json',
      }],
      ['backend:listPredictionQueue', { taskId: 'pr' }],
      ['backend:runBatchPrediction', { taskId: 'pr', modelId: 'm2', patientIds: ['patient-1'] }],
      ['backend:preparePredictionExecution', 'prediction-task-1'],
      ['backend:runPredictionExecution', 'prediction-task-1'],
      ['backend:completePredictionTask', 'prediction-task-1', 'F:\\predictions\\sub01_prediction.json'],
      ['backend:savePredictionResult', {
        patientId: 'patient-1',
        taskId: 'pr',
        modelId: 'm2',
        predictedClass: '比例恢复',
        probability: 0.87,
        threshold: 0.5,
        labelDefinition: '比例恢复 (PR) vs 恢复不良',
      }],
      ['backend:createPatientReport', {
        patientId: 'patient-1',
        title: 'tACS EEG 康复结局预测报告',
      }],
      ['backend:listPatientReports', { patientId: 'patient-1' }],
      ['backend:openPatientReport', 'report-1'],
      ['backend:createBatchSummaryReport', {
        title: 'tACS EEG 康复结局批次汇总',
      }],
      ['backend:listBatchSummaryReports', undefined],
      ['backend:openBatchSummaryReport', 'batch-report-1'],
      ['backend:listTasks', { status: 'queued' }],
      ['backend:listTaskLogs', { level: 'info' }],
      ['backend:retryTask', 'failed-task-1'],
      ['backend:cancelTask', 'queued-task-1'],
      ['backend:startNextQueuedTask'],
      ['backend:createPreprocessBatch', preprocessInput],
      ['backend:completePreprocessManualStep', 'task-1'],
      ['backend:markManualStepCompleted', 'task-1'],
      ['backend:getPreprocessOutputs', 'patient-1'],
      ['backend:launchPreprocessManualStep', 'task-1'],
      ['backend:preparePreprocessMatlabExecution', 'task-1'],
      ['backend:runPreprocessMatlabExecution', 'task-1'],
      ['backend:startMatlabSession'],
      ['backend:getMatlabSessionStatus'],
      ['backend:getSettings'],
      ['backend:updateSettings', settingsInput],
    ]);
  });
});
