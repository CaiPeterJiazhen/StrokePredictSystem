export type BackendWorkflowStatus =
  | '未开始'
  | '待处理'
  | '处理中'
  | '等待人工处理'
  | '已完成'
  | '需复核'
  | '失败';

export type BackendReportStatus = '未生成' | '草稿' | '已生成' | '已签发';
export type BackendExplanationStatus = '未生成' | '生成中' | '已生成' | '需复核';
export type BackendTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_manual'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export type BackendLogLevel = 'info' | 'warning' | 'error';
export type EegCondition = 'EO' | 'EC' | 'UNKNOWN';
export type WorkbenchHandText =
  | '左手'
  | '右手'
  | '双手'
  | '右肢不利 (LH)'
  | '左肢不利 (RH)'
  | '-';
export type WorkbenchStatusText =
  | BackendWorkflowStatus
  | 'PSD/FC 已完成'
  | 'FC 失败'
  | '提取中...'
  | '暂停 (缺数据)'
  | '-';
export type WorkbenchPredictionText =
  | '比例恢复'
  | '恢复不良'
  | '待接入预测结果'
  | '-'
  | 'Residual <= 1.5'
  | 'Residual > 1.5';

export interface BackendPatient {
  id: string;
  subjectCode: string;
  name: string;
  age: number | null;
  sex: '男' | '女' | '';
  diagnosis: string;
  affectedHand: '左手' | '右手' | '双手' | '';
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackendEegFile {
  id: string;
  patientId: string;
  condition: EegCondition;
  filePath: string;
  fileFormat: string;
  existsOnDisk: boolean;
  registeredAt: string;
  lastCheckedAt: string;
}

export interface BackendWorkflowStatusRow {
  patientId: string;
  preprocessStatus: BackendWorkflowStatus;
  featureStatus: BackendWorkflowStatus;
  predictionStatus: BackendWorkflowStatus;
  explanationStatus: BackendExplanationStatus;
  reportStatus: BackendReportStatus;
  lastError: string;
  updatedAt: string;
}

export interface BackendTask {
  id: string;
  type:
    | 'import_patients'
    | 'scan_eeg_files'
    | 'preprocess'
    | 'feature_generation'
    | 'prediction'
    | 'explainability'
    | 'report_export'
    | 'data_library_scan'
    | 'data_library_backup';
  patientId: string | null;
  batchId: string | null;
  status: BackendTaskStatus;
  priority: 'normal' | 'high';
  inputJson: string;
  outputJson: string;
  errorMessage: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface StartNextQueuedTaskResult extends ApiResult {
  taskId: string | null;
  taskType: BackendTask['type'] | null;
}

export interface BackendTaskLog {
  id: string;
  taskId: string | null;
  patientId: string | null;
  level: BackendLogLevel;
  source: 'app' | 'database' | 'matlab' | 'eeglab' | 'prediction' | 'explainability' | 'report';
  message: string;
  createdAt: string;
}

export interface WorkbenchPatientRow {
  id: string;
  patientId: string;
  hand: WorkbenchHandText;
  eo: boolean;
  ec: boolean;
  preStatus: WorkbenchStatusText;
  featStatus: WorkbenchStatusText;
  task: string;
  predict: WorkbenchPredictionText;
  prob: number | null;
  report: BackendReportStatus | '-';
}

export interface TaskQueueRow {
  id: string;
  type?: BackendTask['type'];
  status?: BackendTaskStatus;
  patient: string;
  name: string;
  progress?: number;
  time?: string;
  action?: string;
  manualFiles?: TaskQueueManualFileRow[];
}

export type RightPanelTaskRow = TaskQueueRow;

export interface WorkbenchTaskGroups {
  queued?: TaskQueueRow[];
  running: TaskQueueRow[];
  manual: TaskQueueRow[];
  failed: TaskQueueRow[];
}

export type RightPanelTasks = WorkbenchTaskGroups;

export interface WorkbenchLogLine {
  id: string;
  text: string;
  level: BackendLogLevel;
}

export type RightPanelLogLine = WorkbenchLogLine;

export interface TaskQueueManualFileRow {
  condition: EegCondition;
  label: '睁眼' | '闭眼' | '未知';
  sourceFileName: string;
  stageFileName: string;
}

export interface WorkbenchData {
  patients: WorkbenchPatientRow[];
  tasks: WorkbenchTaskGroups;
  logs: WorkbenchLogLine[];
  dataRoot: string;
}

export interface CreatePatientInput {
  subjectCode: string;
  name?: string;
  age?: number | null;
  sex?: '男' | '女' | '';
  diagnosis?: string;
  affectedHand?: '左手' | '右手' | '双手' | '';
  notes?: string;
}

export type UpdatePatientInput = Partial<CreatePatientInput>;

export interface RegisterEegFileInput {
  patientId: string;
  condition: EegCondition;
  filePath: string;
}

export interface ImportPatientsResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface ScanEegFolderResult {
  scannedFiles: number;
  registeredFiles: number;
  unmatchedFiles: string[];
}

export type CohortType = 'patient' | 'health' | 'project';
export type DataAssetStage = '基线' | '即时' | '阶段' | '最终' | '随访1' | '不适用';
export type DataAssetType =
  | 'raw_eeg_cnt'
  | 'processed_eeg_set'
  | 'processed_eeg_fdt'
  | 'clinical_excel'
  | 'record_pdf'
  | 'completeness_workbook'
  | 'electrode_location'
  | 'channel_file'
  | 'archive';
export type DataAssetMatchStatus = 'matched' | 'unmatched' | 'needs_review';
export type DataLibraryImportStatus = 'idle' | 'running' | 'completed' | 'failed';
export type PairStatus = 'complete' | 'missing_set' | 'missing_fdt' | 'not_applicable';
export type ComputedCompletenessStatus = 'complete' | 'partial' | 'missing' | 'needs_review';

export interface SourceRoot {
  id: string;
  projectName: string;
  rootPath: string;
  status: 'active' | 'missing' | 'archived';
  lastScannedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DataAsset {
  id: string;
  sourceRootId: string;
  patientId: string | null;
  subjectCode: string;
  sourceSubjectCode: string;
  subjectName: string;
  cohort: CohortType;
  stage: DataAssetStage;
  assetType: DataAssetType;
  filePath: string;
  backupPath: string | null;
  fileSize: number;
  fileHash: string;
  existsOnDisk: boolean;
  matchStatus: DataAssetMatchStatus;
  indexedAt: string;
  lastCheckedAt: string;
}

export interface ClinicalMetrics {
  patientId: string;
  sourceWorkbook: string;
  diseaseCourse: string;
  affectedSideRaw: string;
  fmaBefore: number | null;
  fmaAfter: number | null;
  mbiBefore: number | null;
  mbiAfter: number | null;
  bbtBefore: string;
  bbtAfter: string;
  mmse: number | null;
  missingData: string;
  dropoutReason: string;
  mriCount: number | null;
  updatedAt: string;
}

export interface DataCompleteness {
  patientId: string | null;
  subjectCode: string;
  stage: DataAssetStage;
  task: '睁眼' | '闭眼' | '运动想象' | '抓握任务' | 'resting_unknown';
  rawCntCount: number;
  processedSetCount: number;
  processedFdtCount: number;
  setFdtPairStatus: PairStatus;
  workbookStatus: 'Y' | 'X' | '' | null;
  computedStatus: ComputedCompletenessStatus;
  updatedAt: string;
}

export interface DataLibrarySummaryRow {
  patientId: string | null;
  subjectCode: string;
  subjectName: string;
  cohort: CohortType;
  hasClinicalInfo: boolean;
  hasRecordPdf: boolean;
  baselineRawCount: number;
  baselineProcessedPairs: number;
  immediateProcessedPairs: number;
  phaseProcessedPairs: number;
  finalProcessedPairs: number;
  completenessScore: string;
  issueCount: number;
  matchStatus: DataAssetMatchStatus;
}

export interface PatientDocumentDetail {
  patient: BackendPatient | null;
  clinicalMetrics: ClinicalMetrics | null;
  assets: DataAsset[];
  completeness: DataCompleteness[];
  warnings: string[];
}

export interface ResolveManualAssetMatchResult extends ApiResult {
  asset: DataAsset | null;
}

export interface ScanAndImportDataLibraryResult {
  sourceRootId: string;
  createdPatients: number;
  updatedPatients: number;
  indexedAssets: number;
  backedUpDocuments: number;
  missingFiles: number;
  pairIssues: number;
  unmatchedFiles: number;
  manualReviewItems: number;
  errors: string[];
}

export interface DataLibraryStatus {
  sourceRoot: SourceRoot | null;
  indexedFiles: number;
  missingFiles: number;
  backedUpDocuments: number;
  manualReviewItems: number;
  lastScanMessage: string;
}

export type FeatureArtifactKind = 'PSD' | 'FC' | 'SUMMARY' | 'PREVIEW';
export type FeatureArtifactState = 'EO' | 'EC' | 'EO_EC' | 'UNKNOWN';

export interface FeatureArtifact {
  id: string;
  patientId: string;
  subjectCode: string;
  kind: FeatureArtifactKind;
  state: FeatureArtifactState;
  filePath: string;
  fileFormat: string;
  fileSize: number;
  featureCount: number;
  params: Record<string, unknown>;
  preview: Record<string, unknown>;
  existsOnDisk: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FeatureArtifactOverviewRow {
  patientId: string;
  subjectCode: string;
  patientName: string;
  featureStatus: BackendWorkflowStatus;
  psdCount: number;
  fcCount: number;
  summaryCount: number;
  previewCount: number;
  latestFeatureAt: string | null;
  hasEegFeatures: boolean;
}

export interface IndexFeatureArtifactInput {
  patientId: string;
  kind: FeatureArtifactKind;
  state?: FeatureArtifactState;
  filePath: string;
  featureCount?: number;
  params?: Record<string, unknown>;
  preview?: Record<string, unknown>;
}

export interface ListFeatureArtifactsFilter {
  patientId?: string;
  kind?: FeatureArtifactKind;
  state?: FeatureArtifactState;
  existsOnDisk?: boolean;
}

export interface FeatureGenerationBatchInput {
  patientIds: string[];
  featureKinds: readonly FeatureArtifactKind[];
  states: readonly FeatureArtifactState[];
  overwrite: boolean;
  params?: Record<string, unknown>;
}

export interface FeatureGenerationBatchResult extends ApiResult {
  batchId: string;
  queuedTasks: number;
  skippedPatients: string[];
}

export interface FeatureGenerationCompleteResult extends ApiResult {
  indexedArtifacts: number;
  artifactIds: string[];
}

export interface FeatureGenerationPrepareResult extends ApiResult {
  packagePath?: string;
  outputDirectory?: string;
  manifestPath?: string;
  executablePath?: string;
  scriptPath?: string;
  command?: string;
  args?: string[];
}

export interface FeatureGenerationRunResult extends FeatureGenerationPrepareResult {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  indexedArtifacts?: number;
  artifactIds?: string[];
}

export type PredictionInputType = 'EEG-only' | 'EEG+Clinical';
export type RecoveryPredictionClass = '比例恢复' | '恢复不良';
export type PredictionModelStatus = '当前版本' | '候选版本' | '归档版本';
export type PredictionModelFamily = 'traditional_ml' | 'residual_aware_ssl_cnn';
export type PredictionCheckpointMode =
  | 'saved_deployment_model'
  | 'fold_checkpoint_ensemble'
  | 'deployment_checkpoint'
  | 'external_script';

export interface PredictionModel {
  id: string;
  taskId: string;
  name: string;
  version: string;
  modelFamily: PredictionModelFamily;
  checkpointMode: PredictionCheckpointMode;
  inputType: PredictionInputType;
  inputs: string[];
  validation: string;
  accuracy: number | null;
  balancedAccuracy: number | null;
  rocAuc: number | null;
  prAuc: number | null;
  status: PredictionModelStatus;
  artifactPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterPredictionModelInput {
  taskId: string;
  name: string;
  version: string;
  modelFamily?: PredictionModelFamily;
  checkpointMode?: PredictionCheckpointMode;
  inputType: PredictionInputType;
  inputs: string[];
  validation?: string;
  accuracy?: number | null;
  balancedAccuracy?: number | null;
  rocAuc?: number | null;
  prAuc?: number | null;
  status?: PredictionModelStatus;
  artifactPath: string;
}

export interface PredictionQueueRow {
  patientId: string;
  subjectCode: string;
  patientName: string;
  taskId: string;
  hasEegFeatures: boolean;
  hasClinical: boolean;
  prediction: RecoveryPredictionClass | null;
  probability: number | null;
  modelUsed: string;
  status: BackendWorkflowStatus;
  explanationStatus: BackendExplanationStatus;
  submittedAt: string;
}

export interface PredictionSkippedPatient {
  patientId: string;
  reason: string;
}

export interface PredictionBatchInput {
  taskId: string;
  modelId: string;
  patientIds?: string[];
  executor?: {
    executablePath: string;
    scriptPath?: string;
    extraArgs?: string[];
  };
}

export interface PredictionBatchResult extends ApiResult {
  batchId: string;
  queuedTasks: number;
  skippedPatients: PredictionSkippedPatient[];
}

export interface PredictionCompleteResult extends ApiResult {
  predictionId: string | null;
}

export interface PredictionPrepareResult extends ApiResult {
  packagePath?: string;
  outputDirectory?: string;
  resultPath?: string;
  executablePath?: string;
  scriptPath?: string;
  command?: string;
  args?: string[];
}

export interface PredictionRunResult extends PredictionPrepareResult {
  predictionId: string | null;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}

export interface SavePredictionResultInput {
  patientId: string;
  taskId: string;
  modelId: string;
  predictedClass: RecoveryPredictionClass;
  probability: number;
  threshold: number;
  labelDefinition: string;
  featureArtifactIds?: string[];
}

export interface ListPredictionQueueFilter {
  taskId?: string;
  patientId?: string;
}

export type ExplanationArtifactType =
  | 'global_importance'
  | 'patient_shap'
  | 'psd_heatmap'
  | 'fc_network'
  | 'method_manifest';
export type ExplanationFeatureDirection = 'positive' | 'negative' | 'neutral';

export interface ExplanationTopFeature {
  name: string;
  score: number;
  modality: string;
  direction?: ExplanationFeatureDirection;
}

export interface ExplanationArtifact {
  id: string;
  patientId: string;
  subjectCode: string;
  patientName: string;
  taskId: string;
  modelId: string;
  modelName: string;
  modelVersion: string;
  artifactType: ExplanationArtifactType;
  title: string;
  method: string;
  filePath: string;
  fileFormat: string;
  fileSize: number;
  topFeatures: ExplanationTopFeature[];
  preview: Record<string, unknown>;
  existsOnDisk: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IndexExplanationArtifactInput {
  patientId: string;
  taskId: string;
  modelId: string;
  artifactType: ExplanationArtifactType;
  title: string;
  method?: string;
  filePath: string;
  topFeatures?: ExplanationTopFeature[];
  preview?: Record<string, unknown>;
}

export interface ListExplanationArtifactsFilter {
  patientId?: string;
  taskId?: string;
  modelId?: string;
  artifactType?: ExplanationArtifactType;
  existsOnDisk?: boolean;
}

export interface ExplanationOverviewRow {
  patientId: string;
  subjectCode: string;
  patientName: string;
  taskId: string;
  prediction: RecoveryPredictionClass | null;
  probability: number | null;
  modelUsed: string;
  explanationStatus: BackendExplanationStatus;
  artifactCount: number;
  topFeatureName: string;
  latestExplanationAt: string | null;
}

export interface ListExplanationOverviewFilter {
  taskId?: string;
  patientId?: string;
}

export interface ExplainabilityBatchInput {
  taskId: string;
  modelId: string;
  patientIds?: string[];
  artifactTypes: readonly ExplanationArtifactType[];
  executor?: {
    executablePath: string;
    scriptPath?: string;
    extraArgs?: string[];
  };
}

export interface ExplainabilityBatchResult extends ApiResult {
  batchId: string;
  queuedTasks: number;
  skippedPatients: PredictionSkippedPatient[];
}

export interface ExplainabilityCompleteResult extends ApiResult {
  indexedArtifacts: number;
  artifactIds: string[];
}

export interface ExplainabilityPrepareResult extends ApiResult {
  packagePath?: string;
  outputDirectory?: string;
  manifestPath?: string;
  executablePath?: string;
  scriptPath?: string;
  command?: string;
  args?: string[];
}

export interface ExplainabilityRunResult extends ExplainabilityPrepareResult {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  indexedArtifacts: number;
  artifactIds: string[];
}

export type PatientReportFormat = 'html';

export interface PatientReport {
  id: string;
  patientId: string;
  subjectCode: string;
  patientName: string;
  format: PatientReportFormat;
  status: BackendReportStatus;
  filePath: string;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportExportInput {
  patientId: string;
  title?: string;
  format?: PatientReportFormat;
}

export interface ReportExportResult extends ApiResult {
  report: PatientReport | null;
}

export interface ListPatientReportsFilter {
  patientId?: string;
  status?: BackendReportStatus;
}

export type BatchSummaryReportFormat = 'csv';

export interface BatchSummaryReport {
  id: string;
  format: BatchSummaryReportFormat;
  status: BackendReportStatus;
  filePath: string;
  patientCount: number;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface BatchSummaryExportInput {
  title?: string;
  format?: BatchSummaryReportFormat;
}

export interface BatchSummaryExportResult extends ApiResult {
  report: BatchSummaryReport | null;
}

export interface ListBatchSummaryReportsFilter {
  status?: BackendReportStatus;
}

export interface ListTasksFilter {
  limit?: number;
  status?: BackendTaskStatus;
  patientId?: string;
  type?: BackendTask['type'];
}

export interface ListTaskLogsFilter {
  limit?: number;
  patientId?: string;
  taskId?: string;
  level?: BackendLogLevel;
}

export interface BackendSettings {
  dataRoot: string;
  outputRoot: string;
  matlabExecutable: string;
  eeglabPath: string;
  defaultElectrodeLocationFile: string;
  pythonExecutable: string;
  featureGeneratorScript: string;
  predictionScript: string;
  explainabilityScript: string;
  modelLibraryRoot: string;
  defaultDownsampleRate: string;
  defaultHighPassHz: string;
  defaultLowPassHz: string;
  defaultNotchHz: string;
}

export interface PreprocessBatchInput {
  patientIds: string[];
  selectedEmptyChannels: string[];
  selectedBadChannels: string[];
  referenceMode: 'average' | 'm1m2';
  downsampleRate: number;
  highPassHz: number;
  lowPassHz: number;
  notchHz: number;
}

export interface ApiResult {
  ok: boolean;
  message: string;
}

export type MatlabSessionState = 'not_started' | 'starting' | 'ready' | 'stale';

export interface MatlabSessionStatusResult extends ApiResult {
  running: boolean;
  ready: boolean;
  state: MatlabSessionState;
  sessionRoot?: string;
  workerScriptPath?: string;
  configPath?: string;
  requestDir?: string;
  heartbeatPath?: string;
  command?: string;
  pid?: number | null;
}

export interface PreprocessBatchResult extends ApiResult {
  batchId?: string;
  taskIds?: string[];
}

export type ExistingPreprocessManualStep = 'bad_segments' | 'ica_artifacts';

export interface ExistingPatientRunInput {
  subjectCode?: string;
  subjectName?: string;
  affectedHand?: BackendPatient['affectedHand'];
  preprocessedPatientRoot?: string;
  featureRoot?: string;
  predictionCsvPath?: string;
  explainabilityRoot?: string;
}

export interface ExistingPatientStageInput extends ExistingPatientRunInput {
  patientIds?: string[];
  taskId?: string;
  modelId?: string;
  step?: ExistingPreprocessManualStep;
}

export interface ExistingPatientStageResult extends ApiResult {
  patientId?: string;
  subjectCode?: string;
  taskId?: string;
  modelId?: string;
  scriptPath?: string;
  launchTargetPath?: string;
  indexedArtifacts?: number;
  artifactIds?: string[];
  predictionId?: string | null;
}

export interface PreprocessManualLaunchResult extends ApiResult {
  packagePath?: string;
  launchTargetPath?: string;
  manualSaveRequestPath?: string;
  manualSaveDonePath?: string;
  manualSaveErrorPath?: string;
  manualSaveOutputPaths?: string[];
}

export interface PreprocessMatlabPrepareResult extends ApiResult {
  scriptPath?: string;
  packagePath?: string;
  command?: string;
  launcherScriptPath?: string;
  powershellLauncherPath?: string;
  donePath?: string;
  errorPath?: string;
  logPath?: string;
}

export interface PreprocessMatlabRunResult extends PreprocessMatlabPrepareResult {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}

export type PreprocessOutputFileKind =
  | 'final_set'
  | 'final_fdt'
  | 'intermediate_set'
  | 'intermediate_fdt'
  | 'manual_instructions'
  | 'params'
  | 'status'
  | 'log'
  | 'matlab_package'
  | 'other';

export interface PreprocessOutputFile {
  filePath: string;
  fileName: string;
  kind: PreprocessOutputFileKind;
  fileSize: number;
  existsOnDisk: boolean;
}

export interface PreprocessOutputSummary {
  patientId: string;
  subjectCode: string;
  latestTaskId: string | null;
  taskStatus: BackendTaskStatus | null;
  outputDirectories: string[];
  files: PreprocessOutputFile[];
  warnings: string[];
}
