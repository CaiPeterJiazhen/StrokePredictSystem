import { contextBridge, ipcRenderer } from 'electron';
import type {
  BackendSettings,
  BatchSummaryExportInput,
  CreatePatientInput,
  DataAssetMatchStatus,
  ExistingPatientRunInput,
  ExistingPatientStageInput,
  ExplainabilityBatchInput,
  FeatureGenerationBatchInput,
  IndexExplanationArtifactInput,
  IndexFeatureArtifactInput,
  ListExplanationArtifactsFilter,
  ListExplanationOverviewFilter,
  ListFeatureArtifactsFilter,
  ListBatchSummaryReportsFilter,
  ListPatientReportsFilter,
  ListPredictionQueueFilter,
  ListTaskLogsFilter,
  ListTasksFilter,
  PredictionBatchInput,
  PreprocessBatchInput,
  RegisterPredictionModelInput,
  RegisterEegFileInput,
  ReportExportInput,
  SavePredictionResultInput,
  UpdatePatientInput,
} from '../domain/backendTypes.js';
import type { UpsertSourceRootInput } from './backend/dataLibrary/repository.js';

type ListDataAssetsFilter = {
  patientId?: string;
  sourceRootId?: string;
  matchStatus?: DataAssetMatchStatus;
};

const neuroPredict = {
  platform: process.platform,
  database: {
    getWorkbenchData: () => ipcRenderer.invoke('backend:getWorkbenchData'),
    listPatients: () => ipcRenderer.invoke('backend:listPatients'),
    createPatient: (input: CreatePatientInput) => ipcRenderer.invoke('backend:createPatient', input),
    updatePatient: (id: string, input: UpdatePatientInput) => ipcRenderer.invoke('backend:updatePatient', id, input),
    deletePatient: (id: string) => ipcRenderer.invoke('backend:deletePatient', id),
    clearWorkspaceData: () => ipcRenderer.invoke('backend:clearWorkspaceData'),
    registerEegFile: (input: RegisterEegFileInput) => ipcRenderer.invoke('backend:registerEegFile', input),
    scanRegisteredEegFiles: () => ipcRenderer.invoke('backend:scanRegisteredEegFiles'),
    importExistingPatientRun: (input?: ExistingPatientRunInput) =>
      ipcRenderer.invoke('backend:importExistingPatientRun', input),
    launchExistingPreprocessManualStep: (input: ExistingPatientStageInput) =>
      ipcRenderer.invoke('backend:launchExistingPreprocessManualStep', input),
    completeExistingPreprocessManualStep: (input: ExistingPatientStageInput) =>
      ipcRenderer.invoke('backend:completeExistingPreprocessManualStep', input),
    completeExistingPreprocessRun: (input: ExistingPatientStageInput) =>
      ipcRenderer.invoke('backend:completeExistingPreprocessRun', input),
    indexExistingFeatureResults: (input: ExistingPatientStageInput) =>
      ipcRenderer.invoke('backend:indexExistingFeatureResults', input),
    saveExistingPredictionResult: (input: ExistingPatientStageInput) =>
      ipcRenderer.invoke('backend:saveExistingPredictionResult', input),
    indexExistingExplanationResults: (input: ExistingPatientStageInput) =>
      ipcRenderer.invoke('backend:indexExistingExplanationResults', input),
    importPatientsCsv: () => ipcRenderer.invoke('backend:importPatientsCsv'),
    scanEegFolder: () => ipcRenderer.invoke('backend:scanEegFolder'),
    selectDataLibraryRoot: () => ipcRenderer.invoke('backend:selectDataLibraryRoot'),
    getDataLibraryStatus: () => ipcRenderer.invoke('backend:getDataLibraryStatus'),
    listSourceRoots: () => ipcRenderer.invoke('backend:listSourceRoots'),
    upsertSourceRoot: (input: UpsertSourceRootInput) => ipcRenderer.invoke('backend:upsertSourceRoot', input),
    scanAndImportDataLibrary: (rootPath: string) => ipcRenderer.invoke('backend:scanAndImportDataLibrary', rootPath),
    updateDataAssetIndex: (rootPath: string) => ipcRenderer.invoke('backend:updateDataAssetIndex', rootPath),
    backupClinicalDocuments: (rootPath: string) => ipcRenderer.invoke('backend:backupClinicalDocuments', rootPath),
    listDataAssets: (filter?: ListDataAssetsFilter) => ipcRenderer.invoke('backend:listDataAssets', filter),
    listPatientAssetSummary: () => ipcRenderer.invoke('backend:listPatientAssetSummary'),
    getPatientDocumentDetail: (patientId: string) => ipcRenderer.invoke('backend:getPatientDocumentDetail', patientId),
    resolveManualAssetMatch: (assetId: string, patientId: string) =>
      ipcRenderer.invoke('backend:resolveManualAssetMatch', assetId, patientId),
    indexExplanationArtifact: (input: IndexExplanationArtifactInput) =>
      ipcRenderer.invoke('backend:indexExplanationArtifact', input),
    listExplanationArtifacts: (filter?: ListExplanationArtifactsFilter) =>
      ipcRenderer.invoke('backend:listExplanationArtifacts', filter),
    listExplanationOverview: (filter?: ListExplanationOverviewFilter) =>
      ipcRenderer.invoke('backend:listExplanationOverview', filter),
    deleteExplanationArtifact: (artifactId: string) =>
      ipcRenderer.invoke('backend:deleteExplanationArtifact', artifactId),
    createExplainabilityBatch: (input: ExplainabilityBatchInput) =>
      ipcRenderer.invoke('backend:createExplainabilityBatch', input),
    completeExplainabilityTask: (taskId: string, manifestPath: string) =>
      ipcRenderer.invoke('backend:completeExplainabilityTask', taskId, manifestPath),
    prepareExplainabilityExecution: (taskId: string) =>
      ipcRenderer.invoke('backend:prepareExplainabilityExecution', taskId),
    runExplainabilityExecution: (taskId: string) =>
      ipcRenderer.invoke('backend:runExplainabilityExecution', taskId),
    openExplanationArtifact: (artifactId: string) => ipcRenderer.invoke('backend:openExplanationArtifact', artifactId),
    indexFeatureArtifact: (input: IndexFeatureArtifactInput) => ipcRenderer.invoke('backend:indexFeatureArtifact', input),
    listFeatureArtifacts: (filter?: ListFeatureArtifactsFilter) =>
      ipcRenderer.invoke('backend:listFeatureArtifacts', filter),
    listFeatureOverview: () => ipcRenderer.invoke('backend:listFeatureOverview'),
    createFeatureGenerationBatch: (input: FeatureGenerationBatchInput) =>
      ipcRenderer.invoke('backend:createFeatureGenerationBatch', input),
    completeFeatureGenerationTask: (taskId: string, manifestPath: string) =>
      ipcRenderer.invoke('backend:completeFeatureGenerationTask', taskId, manifestPath),
    prepareFeatureGenerationExecution: (taskId: string) =>
      ipcRenderer.invoke('backend:prepareFeatureGenerationExecution', taskId),
    runFeatureGenerationExecution: (taskId: string) =>
      ipcRenderer.invoke('backend:runFeatureGenerationExecution', taskId),
    openFeatureArtifact: (artifactId: string) => ipcRenderer.invoke('backend:openFeatureArtifact', artifactId),
    listPredictionModels: (taskId?: string) =>
      taskId === undefined
        ? ipcRenderer.invoke('backend:listPredictionModels')
        : ipcRenderer.invoke('backend:listPredictionModels', taskId),
    registerPredictionModel: (input: RegisterPredictionModelInput) =>
      ipcRenderer.invoke('backend:registerPredictionModel', input),
    listPredictionQueue: (filter?: ListPredictionQueueFilter) =>
      ipcRenderer.invoke('backend:listPredictionQueue', filter),
    runBatchPrediction: (input: PredictionBatchInput) => ipcRenderer.invoke('backend:runBatchPrediction', input),
    preparePredictionExecution: (taskId: string) =>
      ipcRenderer.invoke('backend:preparePredictionExecution', taskId),
    runPredictionExecution: (taskId: string) =>
      ipcRenderer.invoke('backend:runPredictionExecution', taskId),
    completePredictionTask: (taskId: string, resultPath: string) =>
      ipcRenderer.invoke('backend:completePredictionTask', taskId, resultPath),
    savePredictionResult: (input: SavePredictionResultInput) =>
      ipcRenderer.invoke('backend:savePredictionResult', input),
    createPatientReport: (input: ReportExportInput) => ipcRenderer.invoke('backend:createPatientReport', input),
    listPatientReports: (filter?: ListPatientReportsFilter) =>
      ipcRenderer.invoke('backend:listPatientReports', filter),
    openPatientReport: (reportId: string) => ipcRenderer.invoke('backend:openPatientReport', reportId),
    createBatchSummaryReport: (input?: BatchSummaryExportInput) =>
      ipcRenderer.invoke('backend:createBatchSummaryReport', input),
    listBatchSummaryReports: (filter?: ListBatchSummaryReportsFilter) =>
      ipcRenderer.invoke('backend:listBatchSummaryReports', filter),
    openBatchSummaryReport: (reportId: string) => ipcRenderer.invoke('backend:openBatchSummaryReport', reportId),
    openAssetLocation: (assetId: string) => ipcRenderer.invoke('backend:openAssetLocation', assetId),
    openBackupDirectory: () => ipcRenderer.invoke('backend:openBackupDirectory'),
  },
  tasks: {
    listTasks: (filter?: ListTasksFilter) => ipcRenderer.invoke('backend:listTasks', filter),
    listTaskLogs: (filter?: ListTaskLogsFilter) => ipcRenderer.invoke('backend:listTaskLogs', filter),
    retryTask: (taskId: string) => ipcRenderer.invoke('backend:retryTask', taskId),
    cancelTask: (taskId: string) => ipcRenderer.invoke('backend:cancelTask', taskId),
    startNextQueuedTask: () => ipcRenderer.invoke('backend:startNextQueuedTask'),
    createPreprocessBatch: (input: PreprocessBatchInput) =>
      ipcRenderer.invoke('backend:createPreprocessBatch', input),
    completePreprocessManualStep: (taskId: string) =>
      ipcRenderer.invoke('backend:completePreprocessManualStep', taskId),
    markManualStepCompleted: (taskId: string) =>
      ipcRenderer.invoke('backend:markManualStepCompleted', taskId),
    getPreprocessOutputs: (patientId: string) => ipcRenderer.invoke('backend:getPreprocessOutputs', patientId),
    launchPreprocessManualStep: (taskId: string) =>
      ipcRenderer.invoke('backend:launchPreprocessManualStep', taskId),
    preparePreprocessMatlabExecution: (taskId: string) =>
      ipcRenderer.invoke('backend:preparePreprocessMatlabExecution', taskId),
    runPreprocessMatlabExecution: (taskId: string) =>
      ipcRenderer.invoke('backend:runPreprocessMatlabExecution', taskId),
  },
  settings: {
    getSettings: () => ipcRenderer.invoke('backend:getSettings'),
    updateSettings: (input: Partial<BackendSettings>) => ipcRenderer.invoke('backend:updateSettings', input),
  },
};

contextBridge.exposeInMainWorld('neuroPredict', neuroPredict);

type DatabaseBridge = typeof neuroPredict.database;
type DataLibraryDatabaseMethod =
  | 'getDataLibraryStatus'
  | 'clearWorkspaceData'
  | 'importExistingPatientRun'
  | 'launchExistingPreprocessManualStep'
  | 'completeExistingPreprocessManualStep'
  | 'completeExistingPreprocessRun'
  | 'indexExistingFeatureResults'
  | 'saveExistingPredictionResult'
  | 'indexExistingExplanationResults'
  | 'listSourceRoots'
  | 'selectDataLibraryRoot'
  | 'upsertSourceRoot'
  | 'scanAndImportDataLibrary'
  | 'updateDataAssetIndex'
  | 'backupClinicalDocuments'
  | 'listDataAssets'
  | 'listPatientAssetSummary'
  | 'getPatientDocumentDetail'
  | 'resolveManualAssetMatch'
  | 'indexExplanationArtifact'
  | 'listExplanationArtifacts'
  | 'listExplanationOverview'
  | 'deleteExplanationArtifact'
  | 'createExplainabilityBatch'
  | 'completeExplainabilityTask'
  | 'prepareExplainabilityExecution'
  | 'runExplainabilityExecution'
  | 'openExplanationArtifact'
  | 'indexFeatureArtifact'
  | 'listFeatureArtifacts'
  | 'listFeatureOverview'
  | 'createFeatureGenerationBatch'
  | 'completeFeatureGenerationTask'
  | 'prepareFeatureGenerationExecution'
  | 'runFeatureGenerationExecution'
  | 'openFeatureArtifact'
  | 'listPredictionModels'
  | 'registerPredictionModel'
  | 'listPredictionQueue'
  | 'runBatchPrediction'
  | 'preparePredictionExecution'
  | 'runPredictionExecution'
  | 'completePredictionTask'
  | 'savePredictionResult'
  | 'createPatientReport'
  | 'listPatientReports'
  | 'openPatientReport'
  | 'createBatchSummaryReport'
  | 'listBatchSummaryReports'
  | 'openBatchSummaryReport'
  | 'openAssetLocation'
  | 'openBackupDirectory';

export type NeuroPredictBridge = Omit<typeof neuroPredict, 'database'> & {
  database: Omit<DatabaseBridge, DataLibraryDatabaseMethod> & Partial<Pick<DatabaseBridge, DataLibraryDatabaseMethod>>;
};
