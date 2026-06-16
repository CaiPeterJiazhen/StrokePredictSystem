import { mockLogs, mockPatients, mockTasks } from '../domain/mockData';
import type {
  ApiResult,
  BatchSummaryExportInput,
  BatchSummaryExportResult,
  BatchSummaryReport,
  BackendPatient,
  BackendSettings,
  BackendTask,
  BackendTaskLog,
  DataAsset,
  DataAssetMatchStatus,
  DataLibraryStatus,
  DataLibrarySummaryRow,
  CreatePatientInput,
  ExistingPatientRunInput,
  ExistingPatientStageInput,
  ExistingPatientStageResult,
  ExplainabilityBatchInput,
  ExplainabilityBatchResult,
  ExplainabilityCompleteResult,
  ExplainabilityPrepareResult,
  ExplainabilityRunResult,
  ExplanationArtifact,
  ExplanationOverviewRow,
  FeatureArtifact,
  FeatureArtifactOverviewRow,
  FeatureGenerationCompleteResult,
  FeatureGenerationBatchInput,
  FeatureGenerationBatchResult,
  FeatureGenerationPrepareResult,
  FeatureGenerationRunResult,
  IndexExplanationArtifactInput,
  IndexFeatureArtifactInput,
  ListExplanationArtifactsFilter,
  ListExplanationOverviewFilter,
  ListPatientReportsFilter,
  ListBatchSummaryReportsFilter,
  ListFeatureArtifactsFilter,
  ListPredictionQueueFilter,
  ImportPatientsResult,
  ListTaskLogsFilter,
  ListTasksFilter,
  MatlabSessionStatusResult,
  PatientDocumentDetail,
  PatientReport,
  PredictionBatchInput,
  PredictionBatchResult,
  PredictionCompleteResult,
  PredictionPrepareResult,
  PredictionRunResult,
  PredictionModel,
  PredictionQueueRow,
  PreprocessBatchInput,
  PreprocessBatchResult,
  PreprocessOutputSummary,
  RegisterPredictionModelInput,
  RegisterEegFileInput,
  ReportExportInput,
  ReportExportResult,
  ResolveManualAssetMatchResult,
  ScanAndImportDataLibraryResult,
  ScanEegFolderResult,
  SavePredictionResultInput,
  SourceRoot,
  StartNextQueuedTaskResult,
  UpdatePatientInput,
  WorkbenchData,
  WorkbenchTaskGroups,
} from '../domain/backendTypes';

type UpsertSourceRootInput = {
  projectName: string;
  rootPath: string;
  status: SourceRoot['status'];
  lastScannedAt?: string | null;
};

type ListDataAssetsFilter = {
  patientId?: string;
  sourceRootId?: string;
  matchStatus?: DataAssetMatchStatus;
};

function getBridge() {
  return window.neuroPredict;
}

function buildMockWorkbenchData(): WorkbenchData {
  const tasks: WorkbenchTaskGroups = {
    queued: [],
    running: mockTasks
      .filter((task) => task.status === '处理中')
      .map((task) => ({
        id: task.id,
        patient: task.patientId,
        name: task.task,
        progress: 46,
        time: task.updatedAt,
        action: task.stage,
      })),
    manual: mockTasks
      .filter((task) => task.status === '需复核')
      .map((task) => ({
        id: task.id,
        patient: task.patientId,
        name: task.task,
        time: task.updatedAt,
        action: task.stage,
      })),
    failed: mockTasks
      .filter((task) => task.status === '失败')
      .map((task) => ({
        id: task.id,
        patient: task.patientId,
        name: task.task,
        time: task.updatedAt,
        action: task.stage,
      })),
  };

  return {
    patients: mockPatients.map((patient) => ({
      id: patient.id,
      patientId: patient.id,
      hand: patient.affectedHand,
      eo: patient.eo,
      ec: patient.ec,
      preStatus: patient.preprocessStatus,
      featStatus: patient.featureStatus,
      task: patient.task,
      predict: patient.prediction ?? '-',
      prob: patient.probability,
      report: patient.reportStatus,
    })),
    tasks,
    logs: mockLogs.map((log) => ({
      id: log.id,
      text: `[${log.time}] ${log.source}: ${log.message}`,
      level: log.level,
    })),
    dataRoot: '浏览器预览模式',
  };
}

function browserScanFallback(message: string): ScanAndImportDataLibraryResult {
  return {
    sourceRootId: '',
    createdPatients: 0,
    updatedPatients: 0,
    indexedAssets: 0,
    backedUpDocuments: 0,
    missingFiles: 0,
    pairIssues: 0,
    unmatchedFiles: 0,
    manualReviewItems: 0,
    errors: [message],
  };
}

export async function getWorkbenchData(): Promise<WorkbenchData> {
  return getBridge()?.database.getWorkbenchData() ?? buildMockWorkbenchData();
}

export async function importPatientsCsv(): Promise<ImportPatientsResult> {
  return (
    getBridge()?.database.importPatientsCsv() ?? {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: ['浏览器预览模式不支持打开本地文件'],
    }
  );
}

export async function listPatients(): Promise<BackendPatient[]> {
  return getBridge()?.database.listPatients() ?? [];
}

export async function createPatient(input: CreatePatientInput): Promise<string | null> {
  return getBridge()?.database.createPatient(input) ?? null;
}

export async function updatePatient(id: string, input: UpdatePatientInput): Promise<BackendPatient | null> {
  return getBridge()?.database.updatePatient(id, input) ?? null;
}

export async function deletePatient(id: string): Promise<ApiResult> {
  return (
    getBridge()?.database.deletePatient(id) ?? {
      ok: false,
      message: '浏览器预览模式不支持修改本地患者库',
    }
  );
}

export async function clearWorkspaceData(): Promise<ApiResult> {
  const bridge = getBridge();

  if (bridge?.database.clearWorkspaceData) {
    return bridge.database.clearWorkspaceData();
  }

  if (bridge?.database.getWorkbenchData && bridge.database.deletePatient) {
    const workbench = await bridge.database.getWorkbenchData();
    const patientIds: string[] = Array.from(
      new Set<string>(
        (workbench?.patients ?? [])
          .map((patient: { patientId?: string; id?: string }) => patient.patientId ?? patient.id)
          .filter((patientId: unknown): patientId is string => typeof patientId === 'string' && patientId.trim() !== ''),
      ),
    );

    for (const patientId of patientIds) {
      const result = await bridge.database.deletePatient(patientId);
      if (!result?.ok) {
        return result ?? { ok: false, message: `删除患者 ${patientId} 失败。` };
      }
    }

    return {
      ok: true,
      message: '已清空患者工作台记录。旧版 Electron 桥接未暴露数据文档库清空接口，请重启软件以启用完整清空。',
    };
  }

  return (
    {
      ok: false,
      message: '浏览器预览模式不支持清空本地患者库',
    }
  );
}

export async function registerEegFile(input: RegisterEegFileInput): Promise<string | null> {
  return getBridge()?.database.registerEegFile(input) ?? null;
}

export async function scanEegFolder(): Promise<ScanEegFolderResult> {
  return (
    getBridge()?.database.scanEegFolder() ?? {
      scannedFiles: 0,
      registeredFiles: 0,
      unmatchedFiles: [],
    }
  );
}

export async function scanRegisteredEegFiles(): Promise<ScanEegFolderResult> {
  return (
    getBridge()?.database.scanRegisteredEegFiles() ?? {
      scannedFiles: 0,
      registeredFiles: 0,
      unmatchedFiles: [],
    }
  );
}

export async function importExistingPatientRun(
  input?: ExistingPatientRunInput,
): Promise<ExistingPatientStageResult> {
  return (
    getBridge()?.database.importExistingPatientRun?.(input) ?? {
      ok: false,
      message: '浏览器预览模式不支持接入本地既有单患者结果',
    }
  );
}

export async function launchExistingPreprocessManualStep(
  input: ExistingPatientStageInput,
): Promise<ExistingPatientStageResult> {
  return (
    getBridge()?.database.launchExistingPreprocessManualStep?.(input) ?? {
      ok: false,
      message: '浏览器预览模式不支持唤起本地 MATLAB/EEGLAB',
    }
  );
}

export async function completeExistingPreprocessManualStep(
  input: ExistingPatientStageInput,
): Promise<ExistingPatientStageResult> {
  return (
    getBridge()?.database.completeExistingPreprocessManualStep?.(input) ?? {
      ok: false,
      message: '浏览器预览模式不支持确认本地 EEGLAB 人工节点',
    }
  );
}

export async function completeExistingPreprocessRun(
  input: ExistingPatientStageInput,
): Promise<ExistingPatientStageResult> {
  return (
    getBridge()?.database.completeExistingPreprocessRun?.(input) ?? {
      ok: false,
      message: '浏览器预览模式不支持绑定本地既有预处理结果',
    }
  );
}

export async function indexExistingFeatureResults(
  input: ExistingPatientStageInput,
): Promise<ExistingPatientStageResult> {
  return (
    getBridge()?.database.indexExistingFeatureResults?.(input) ?? {
      ok: false,
      message: '浏览器预览模式不支持索引本地既有 PSD/FC 特征',
    }
  );
}

export async function saveExistingPredictionResult(
  input: ExistingPatientStageInput,
): Promise<ExistingPatientStageResult> {
  return (
    getBridge()?.database.saveExistingPredictionResult?.(input) ?? {
      ok: false,
      message: '浏览器预览模式不支持读取本地既有预测结果',
    }
  );
}

export async function indexExistingExplanationResults(
  input: ExistingPatientStageInput,
): Promise<ExistingPatientStageResult> {
  return (
    getBridge()?.database.indexExistingExplanationResults?.(input) ?? {
      ok: false,
      message: '浏览器预览模式不支持索引本地既有解释性分析结果',
    }
  );
}

export async function getDataLibraryStatus(): Promise<DataLibraryStatus> {
  return (
    getBridge()?.database.getDataLibraryStatus?.() ?? {
      sourceRoot: null,
      indexedFiles: 0,
      missingFiles: 0,
      backedUpDocuments: 0,
      manualReviewItems: 0,
      lastScanMessage: '浏览器预览模式未连接本地数据与文档库',
    }
  );
}

export async function listSourceRoots(): Promise<SourceRoot[]> {
  return getBridge()?.database.listSourceRoots?.() ?? [];
}

export async function upsertSourceRoot(input: UpsertSourceRootInput): Promise<SourceRoot | null> {
  return getBridge()?.database.upsertSourceRoot?.(input) ?? null;
}

export async function scanAndImportDataLibrary(rootPath: string): Promise<ScanAndImportDataLibraryResult> {
  return (
    getBridge()?.database.scanAndImportDataLibrary?.(rootPath) ??
    browserScanFallback('浏览器预览模式不支持扫描本地数据目录')
  );
}

export async function updateDataAssetIndex(rootPath: string): Promise<ScanAndImportDataLibraryResult> {
  return (
    getBridge()?.database.updateDataAssetIndex?.(rootPath) ??
    browserScanFallback('浏览器预览模式不支持更新本地数据索引')
  );
}

export async function backupClinicalDocuments(rootPath: string): Promise<ScanAndImportDataLibraryResult> {
  return (
    getBridge()?.database.backupClinicalDocuments?.(rootPath) ??
    browserScanFallback('浏览器预览模式不支持备份本地临床文档')
  );
}

export async function selectDataLibraryRoot(): Promise<string | null> {
  return getBridge()?.database.selectDataLibraryRoot?.() ?? null;
}

export async function listDataAssets(filter?: ListDataAssetsFilter): Promise<DataAsset[]> {
  return getBridge()?.database.listDataAssets?.(filter) ?? [];
}

export async function listPatientAssetSummary(): Promise<DataLibrarySummaryRow[]> {
  return getBridge()?.database.listPatientAssetSummary?.() ?? [];
}

export async function getPatientDocumentDetail(patientId: string): Promise<PatientDocumentDetail> {
  return (
    getBridge()?.database.getPatientDocumentDetail?.(patientId) ?? {
      patient: null,
      clinicalMetrics: null,
      assets: [],
      completeness: [],
      warnings: ['浏览器预览模式未连接本地数据与文档库'],
    }
  );
}

export async function openAssetLocation(assetId: string): Promise<ApiResult> {
  return (
    getBridge()?.database.openAssetLocation?.(assetId) ?? {
      ok: false,
      message: '浏览器预览模式不支持打开本地路径',
    }
  );
}

export async function openBackupDirectory(): Promise<ApiResult> {
  return (
    getBridge()?.database.openBackupDirectory?.() ?? {
      ok: false,
      message: '浏览器预览模式不支持打开本地路径',
    }
  );
}

export async function resolveManualAssetMatch(
  assetId: string,
  patientId: string,
): Promise<ResolveManualAssetMatchResult> {
  return (
    getBridge()?.database.resolveManualAssetMatch?.(assetId, patientId) ?? {
      ok: false,
      message: '浏览器预览模式不支持人工匹配本地资产',
      asset: null,
    }
  );
}

export async function indexExplanationArtifact(input: IndexExplanationArtifactInput): Promise<string | null> {
  return getBridge()?.database.indexExplanationArtifact?.(input) ?? null;
}

export async function listExplanationArtifacts(
  filter?: ListExplanationArtifactsFilter,
): Promise<ExplanationArtifact[]> {
  return getBridge()?.database.listExplanationArtifacts?.(filter) ?? [];
}

export async function listExplanationOverview(
  filter?: ListExplanationOverviewFilter,
): Promise<ExplanationOverviewRow[]> {
  return getBridge()?.database.listExplanationOverview?.(filter) ?? [];
}

export async function deleteExplanationArtifact(artifactId: string): Promise<ApiResult> {
  return (
    getBridge()?.database.deleteExplanationArtifact?.(artifactId) ?? {
      ok: false,
      message: '浏览器预览模式不支持删除本地解释性产物',
    }
  );
}

export async function createExplainabilityBatch(
  input: ExplainabilityBatchInput,
): Promise<ExplainabilityBatchResult> {
  return (
    getBridge()?.database.createExplainabilityBatch?.(input) ?? {
      ok: false,
      message: '浏览器预览模式不支持创建本地解释性任务',
      batchId: '',
      queuedTasks: 0,
      skippedPatients: [],
    }
  );
}

export async function completeExplainabilityTask(
  taskId: string,
  manifestPath: string,
): Promise<ExplainabilityCompleteResult> {
  return (
    getBridge()?.database.completeExplainabilityTask?.(taskId, manifestPath) ?? {
      ok: false,
      message: '浏览器预览模式不支持完成本地解释性任务',
      indexedArtifacts: 0,
      artifactIds: [],
    }
  );
}

export async function prepareExplainabilityExecution(taskId: string): Promise<ExplainabilityPrepareResult> {
  return (
    getBridge()?.database.prepareExplainabilityExecution?.(taskId) ?? {
      ok: false,
      message: '浏览器预览模式不支持准备本地解释性执行',
    }
  );
}

export async function runExplainabilityExecution(taskId: string): Promise<ExplainabilityRunResult> {
  return (
    getBridge()?.database.runExplainabilityExecution?.(taskId) ?? {
      ok: false,
      message: '浏览器预览模式不支持运行本地解释性执行',
      exitCode: null,
      stdout: '',
      stderr: '',
      indexedArtifacts: 0,
      artifactIds: [],
    }
  );
}

export async function openExplanationArtifact(artifactId: string): Promise<ApiResult> {
  return (
    getBridge()?.database.openExplanationArtifact?.(artifactId) ?? {
      ok: false,
      message: '浏览器预览模式不支持打开本地解释性文件',
    }
  );
}

export async function indexFeatureArtifact(input: IndexFeatureArtifactInput): Promise<string | null> {
  return getBridge()?.database.indexFeatureArtifact?.(input) ?? null;
}

export async function listFeatureArtifacts(filter?: ListFeatureArtifactsFilter): Promise<FeatureArtifact[]> {
  return getBridge()?.database.listFeatureArtifacts?.(filter) ?? [];
}

export async function listFeatureOverview(): Promise<FeatureArtifactOverviewRow[]> {
  return getBridge()?.database.listFeatureOverview?.() ?? [];
}

export async function createFeatureGenerationBatch(
  input: FeatureGenerationBatchInput,
): Promise<FeatureGenerationBatchResult | ApiResult> {
  return (
    getBridge()?.database.createFeatureGenerationBatch?.(input) ?? {
      ok: false,
      message: '浏览器预览模式不支持创建本地特征生成任务',
    }
  );
}

export async function completeFeatureGenerationTask(
  taskId: string,
  manifestPath: string,
): Promise<FeatureGenerationCompleteResult> {
  return (
    getBridge()?.database.completeFeatureGenerationTask?.(taskId, manifestPath) ?? {
      ok: false,
      message: '浏览器预览模式不支持完成本地特征生成任务',
      indexedArtifacts: 0,
      artifactIds: [],
    }
  );
}

export async function prepareFeatureGenerationExecution(taskId: string): Promise<FeatureGenerationPrepareResult> {
  return (
    getBridge()?.database.prepareFeatureGenerationExecution?.(taskId) ?? {
      ok: false,
      message: '浏览器预览模式不支持准备本地特征生成执行',
    }
  );
}

export async function runFeatureGenerationExecution(taskId: string): Promise<FeatureGenerationRunResult> {
  return (
    getBridge()?.database.runFeatureGenerationExecution?.(taskId) ?? {
      ok: false,
      message: '浏览器预览模式不支持运行本地特征生成',
      exitCode: null,
      stdout: '',
      stderr: '',
      indexedArtifacts: 0,
      artifactIds: [],
    }
  );
}

export async function openFeatureArtifact(artifactId: string): Promise<ApiResult> {
  return (
    getBridge()?.database.openFeatureArtifact?.(artifactId) ?? {
      ok: false,
      message: '浏览器预览模式不支持打开本地特征文件',
    }
  );
}

export async function listPredictionModels(taskId?: string): Promise<PredictionModel[]> {
  return getBridge()?.database.listPredictionModels?.(taskId) ?? [];
}

export async function registerPredictionModel(input: RegisterPredictionModelInput): Promise<PredictionModel | null> {
  return getBridge()?.database.registerPredictionModel?.(input) ?? null;
}

export async function listPredictionQueue(filter?: ListPredictionQueueFilter): Promise<PredictionQueueRow[]> {
  return getBridge()?.database.listPredictionQueue?.(filter) ?? [];
}

export async function runBatchPrediction(input: PredictionBatchInput): Promise<PredictionBatchResult | ApiResult> {
  return (
    getBridge()?.database.runBatchPrediction?.(input) ?? {
      ok: false,
      message: '浏览器预览模式不支持运行本地批量预测',
    }
  );
}

export async function preparePredictionExecution(taskId: string): Promise<PredictionPrepareResult> {
  return (
    getBridge()?.database.preparePredictionExecution?.(taskId) ?? {
      ok: false,
      message: '浏览器预览模式不支持准备本地预测执行',
    }
  );
}

export async function runPredictionExecution(taskId: string): Promise<PredictionRunResult> {
  return (
    getBridge()?.database.runPredictionExecution?.(taskId) ?? {
      ok: false,
      message: '浏览器预览模式不支持运行本地预测执行',
      predictionId: null,
      exitCode: null,
      stdout: '',
      stderr: '',
    }
  );
}

export async function completePredictionTask(taskId: string, resultPath: string): Promise<PredictionCompleteResult> {
  return (
    getBridge()?.database.completePredictionTask?.(taskId, resultPath) ?? {
      ok: false,
      message: '浏览器预览模式不支持完成本地预测任务',
      predictionId: null,
    }
  );
}

export async function savePredictionResult(input: SavePredictionResultInput): Promise<string | null> {
  return getBridge()?.database.savePredictionResult?.(input) ?? null;
}

export async function createPatientReport(input: ReportExportInput): Promise<ReportExportResult> {
  return (
    getBridge()?.database.createPatientReport?.(input) ?? {
      ok: false,
      message: '浏览器预览模式不支持生成本地患者报告',
      report: null,
    }
  );
}

export async function listPatientReports(filter?: ListPatientReportsFilter): Promise<PatientReport[]> {
  return getBridge()?.database.listPatientReports?.(filter) ?? [];
}

export async function openPatientReport(reportId: string): Promise<ApiResult> {
  return (
    getBridge()?.database.openPatientReport?.(reportId) ?? {
      ok: false,
      message: '浏览器预览模式不支持打开本地报告',
    }
  );
}

export async function createBatchSummaryReport(input?: BatchSummaryExportInput): Promise<BatchSummaryExportResult> {
  return (
    getBridge()?.database.createBatchSummaryReport?.(input) ?? {
      ok: false,
      message: '浏览器预览模式不支持生成本地批次汇总',
      report: null,
    }
  );
}

export async function listBatchSummaryReports(filter?: ListBatchSummaryReportsFilter): Promise<BatchSummaryReport[]> {
  return getBridge()?.database.listBatchSummaryReports?.(filter) ?? [];
}

export async function openBatchSummaryReport(reportId: string): Promise<ApiResult> {
  return (
    getBridge()?.database.openBatchSummaryReport?.(reportId) ?? {
      ok: false,
      message: '浏览器预览模式不支持打开本地批次汇总',
    }
  );
}

export async function listTasks(filter?: ListTasksFilter): Promise<BackendTask[]> {
  return getBridge()?.tasks.listTasks(filter) ?? [];
}

export async function listTaskLogs(filter?: ListTaskLogsFilter): Promise<BackendTaskLog[]> {
  return getBridge()?.tasks.listTaskLogs(filter) ?? [];
}

export async function retryTask(taskId: string): Promise<ApiResult> {
  return (
    getBridge()?.tasks.retryTask?.(taskId) ?? {
      ok: false,
      message: '浏览器预览模式不支持重试本地任务',
    }
  );
}

export async function cancelTask(taskId: string): Promise<ApiResult> {
  return (
    getBridge()?.tasks.cancelTask?.(taskId) ?? {
      ok: false,
      message: '浏览器预览模式不支持取消本地任务',
    }
  );
}

export async function startNextQueuedTask(): Promise<StartNextQueuedTaskResult> {
  return (
    getBridge()?.tasks.startNextQueuedTask?.() ?? {
      ok: false,
      message: '浏览器预览模式不支持运行本地任务队列',
      taskId: null,
      taskType: null,
    }
  );
}

export async function getSettings(): Promise<BackendSettings | null> {
  return getBridge()?.settings.getSettings() ?? null;
}

export async function updateSettings(input: Partial<BackendSettings>): Promise<BackendSettings | null> {
  return getBridge()?.settings.updateSettings(input) ?? null;
}

export async function startPreprocessing(request: PreprocessBatchInput): Promise<PreprocessBatchResult> {
  return (
    getBridge()?.tasks.createPreprocessBatch(request) ?? {
      ok: true,
      message: 'mock ok: 预处理任务已进入浏览器预览占位队列，未调用后端。',
    }
  );
}

export async function completePreprocessManualStep(taskId: string): Promise<ApiResult> {
  return (
    getBridge()?.tasks.completePreprocessManualStep(taskId) ?? {
      ok: false,
      message: '浏览器预览模式不支持更新本地预处理任务',
    }
  );
}

export async function markManualStepCompleted(taskId: string): Promise<ApiResult> {
  const bridge = getBridge();
  return (
    bridge?.tasks.markManualStepCompleted?.(taskId) ??
    bridge?.tasks.completePreprocessManualStep?.(taskId) ?? {
      ok: false,
      message: '浏览器预览模式不支持更新本地预处理任务',
    }
  );
}

export async function getPreprocessOutputs(patientId: string): Promise<PreprocessOutputSummary> {
  return (
    getBridge()?.tasks.getPreprocessOutputs?.(patientId) ?? {
      patientId,
      subjectCode: '',
      latestTaskId: null,
      taskStatus: null,
      outputDirectories: [],
      files: [],
      warnings: ['浏览器预览模式未连接本地预处理输出'],
    }
  );
}

export async function launchPreprocessManualStep(taskId: string): Promise<ApiResult> {
  return (
    getBridge()?.tasks.launchPreprocessManualStep(taskId) ?? {
      ok: false,
      message: '浏览器预览模式不支持打开 MATLAB/EEGLAB',
    }
  );
}

export async function preparePreprocessMatlabExecution(taskId: string): Promise<ApiResult> {
  return (
    getBridge()?.tasks.preparePreprocessMatlabExecution(taskId) ?? {
      ok: false,
      message: '浏览器预览模式不支持准备 MATLAB 执行',
    }
  );
}

export async function runPreprocessMatlabExecution(taskId: string): Promise<ApiResult> {
  return (
    getBridge()?.tasks.runPreprocessMatlabExecution(taskId) ?? {
      ok: false,
      message: '浏览器预览模式不支持运行 MATLAB 预处理',
    }
  );
}

export async function startMatlabSession(): Promise<MatlabSessionStatusResult> {
  return (
    getBridge()?.tasks.startMatlabSession?.() ?? {
      ok: false,
      message: '浏览器预览模式不支持打开 MATLAB 会话',
      running: false,
      ready: false,
      state: 'not_started',
    }
  );
}

export async function getMatlabSessionStatus(): Promise<MatlabSessionStatusResult> {
  return (
    getBridge()?.tasks.getMatlabSessionStatus?.() ?? {
      ok: false,
      message: '浏览器预览模式未连接 MATLAB 会话',
      running: false,
      ready: false,
      state: 'not_started',
    }
  );
}
