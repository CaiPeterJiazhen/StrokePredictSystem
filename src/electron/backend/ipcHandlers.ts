import fs from 'node:fs';
import { dialog, ipcMain, shell } from 'electron';
import { ensureOutputRoot } from './appPaths.js';
import type {
  CreatePatientInput,
  BatchSummaryExportInput,
  ExistingPatientStageInput,
  ExistingPatientRunInput,
  ListBatchSummaryReportsFilter,
  ExplainabilityBatchInput,
  FeatureGenerationBatchInput,
  IndexFeatureArtifactInput,
  IndexExplanationArtifactInput,
  ListExplanationArtifactsFilter,
  ListExplanationOverviewFilter,
  ListFeatureArtifactsFilter,
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
} from '../../domain/backendTypes.js';
import {
  backupClinicalDocuments,
  scanAndImportDataLibrary,
  updateDataAssetIndex,
} from './dataLibrary/scanAndImport.js';
import {
  getDataLibraryStatus,
  getPatientDocumentDetail,
  listDataAssets,
  listPatientAssetSummary,
  listSourceRoots,
  resolveManualAssetMatch,
  upsertSourceRoot,
  type UpsertSourceRootInput,
} from './dataLibrary/repository.js';
import {
  completeExistingPreprocessManualStep,
  completeExistingPreprocessRun,
  importExistingPatientRun,
  indexExistingExplanationResults,
  indexExistingFeatureResults,
  launchExistingPreprocessManualStep,
  saveExistingPredictionResult,
} from './existingResultsWorkflow.js';
import {
  completeExplainabilityTask,
  createExplainabilityBatch,
  deleteExplanationArtifact,
  type ExplainabilityExecutor,
  getExplanationArtifact,
  indexExplanationArtifact,
  listExplanationArtifacts,
  listExplanationOverview,
  prepareExplainabilityExecution,
  runExplainabilityExecution,
} from './explainability.js';
import type { LocalDatabase } from './database.js';
import {
  completeFeatureGenerationTask,
  createFeatureGenerationBatch,
  type FeatureGeneratorExecutor,
  getFeatureArtifact,
  indexFeatureArtifact,
  listFeatureArtifacts,
  listFeatureOverview,
  prepareFeatureGenerationExecution,
  runFeatureGenerationExecution,
} from './featureArtifacts.js';
import { importPatientsFromCsv } from './importPatients.js';
import {
  completePreprocessManualStep,
  createPreprocessBatch,
  getPreprocessOutputs,
  launchPreprocessManualStep,
  type MatlabExecutor,
  preparePreprocessMatlabExecution,
  runPreprocessMatlabExecution,
} from './preprocessTasks.js';
import {
  completePredictionTask,
  createPredictionBatch,
  listPredictionModels,
  listPredictionQueue,
  type PredictionExecutor,
  preparePredictionExecution,
  registerPredictionModel,
  runPredictionExecution,
  savePredictionResult,
} from './predictions.js';
import {
  createBatchSummaryReport,
  createPatientReport,
  getBatchSummaryReport,
  getPatientReport,
  listBatchSummaryReports,
  listPatientReports,
} from './reports.js';
import {
  createPatient,
  cancelTask,
  clearWorkspaceData,
  deletePatient,
  getSettings,
  getWorkbenchData,
  listPatients,
  listTaskLogs,
  listTasks,
  registerEegFile,
  retryTask,
  scanRegisteredEegFiles,
  updatePatient,
  updateSettings,
  type UpdateSettingsInput,
} from './repositories.js';
import { scanEegFolderForPatients } from './scanEegFiles.js';
import { startNextQueuedTask } from './taskQueue.js';

async function persist<T>(local: LocalDatabase, operation: () => T | Promise<T>): Promise<T> {
  const result = await operation();
  local.save();
  return result;
}

function applyConfiguredOutputRoot(local: LocalDatabase): void {
  const outputRoot = getSettings(local.db).outputRoot.trim();

  if (!outputRoot) return;

  ensureOutputRoot(outputRoot);
  local.paths.outputsRoot = outputRoot;
}

export function registerIpcHandlers(
  local: LocalDatabase,
  options: {
    executeMatlab?: MatlabExecutor;
    executeFeatureGenerator?: FeatureGeneratorExecutor;
    executePrediction?: PredictionExecutor;
    executeExplainability?: ExplainabilityExecutor;
  } = {},
): void {
  applyConfiguredOutputRoot(local);

  ipcMain.handle('backend:getWorkbenchData', () => getWorkbenchData(local.db, local.paths.dataRoot));

  ipcMain.handle('backend:listPatients', () => listPatients(local.db));

  ipcMain.handle('backend:createPatient', (_event, input: CreatePatientInput) =>
    persist(local, () => createPatient(local.db, input)),
  );

  ipcMain.handle('backend:updatePatient', (_event, id: string, input: UpdatePatientInput) =>
    persist(local, () => updatePatient(local.db, id, input)),
  );

  ipcMain.handle('backend:deletePatient', (_event, id: string) => persist(local, () => deletePatient(local.db, id)));

  ipcMain.handle('backend:clearWorkspaceData', () => persist(local, () => clearWorkspaceData(local.db)));

  ipcMain.handle('backend:registerEegFile', (_event, input: RegisterEegFileInput) =>
    persist(local, () => registerEegFile(local.db, input)),
  );

  ipcMain.handle('backend:scanRegisteredEegFiles', () => persist(local, () => scanRegisteredEegFiles(local.db)));

  ipcMain.handle('backend:importExistingPatientRun', (_event, input?: ExistingPatientRunInput) =>
    persist(local, () => importExistingPatientRun(local.db, local.paths, input)),
  );

  ipcMain.handle('backend:launchExistingPreprocessManualStep', (_event, input: ExistingPatientStageInput) =>
    persist(local, () => launchExistingPreprocessManualStep(local.db, local.paths, input, shell.openPath)),
  );

  ipcMain.handle('backend:completeExistingPreprocessManualStep', (_event, input: ExistingPatientStageInput) =>
    persist(local, () => completeExistingPreprocessManualStep(local.db, local.paths, input)),
  );

  ipcMain.handle('backend:completeExistingPreprocessRun', (_event, input: ExistingPatientStageInput) =>
    persist(local, () => completeExistingPreprocessRun(local.db, local.paths, input)),
  );

  ipcMain.handle('backend:indexExistingFeatureResults', (_event, input: ExistingPatientStageInput) =>
    persist(local, () => indexExistingFeatureResults(local.db, local.paths, input)),
  );

  ipcMain.handle('backend:saveExistingPredictionResult', (_event, input: ExistingPatientStageInput) =>
    persist(local, () => saveExistingPredictionResult(local.db, local.paths, input)),
  );

  ipcMain.handle('backend:indexExistingExplanationResults', (_event, input: ExistingPatientStageInput) =>
    persist(local, () => indexExistingExplanationResults(local.db, local.paths, input)),
  );

  ipcMain.handle('backend:getSettings', () => getSettings(local.db));

  ipcMain.handle('backend:updateSettings', (_event, input: UpdateSettingsInput) =>
    persist(local, () => {
      const settings = updateSettings(local.db, input);
      applyConfiguredOutputRoot(local);
      return settings;
    }),
  );

  ipcMain.handle('backend:createPreprocessBatch', (_event, input: PreprocessBatchInput) =>
    persist(local, () => createPreprocessBatch(local.db, input)),
  );

  ipcMain.handle('backend:completePreprocessManualStep', (_event, taskId: string) =>
    persist(local, () => completePreprocessManualStep(local.db, local.paths, taskId)),
  );

  ipcMain.handle('backend:markManualStepCompleted', (_event, taskId: string) =>
    persist(local, () => completePreprocessManualStep(local.db, local.paths, taskId)),
  );

  ipcMain.handle('backend:getPreprocessOutputs', (_event, patientId: string) =>
    getPreprocessOutputs(local.db, local.paths, patientId),
  );

  ipcMain.handle('backend:launchPreprocessManualStep', (_event, taskId: string) =>
    persist(local, () => launchPreprocessManualStep(local.db, local.paths, taskId, shell.openPath)),
  );

  ipcMain.handle('backend:preparePreprocessMatlabExecution', (_event, taskId: string) =>
    persist(local, () => preparePreprocessMatlabExecution(local.db, local.paths, taskId)),
  );

  ipcMain.handle('backend:runPreprocessMatlabExecution', (_event, taskId: string) =>
    persist(local, () => runPreprocessMatlabExecution(local.db, local.paths, taskId, options.executeMatlab)),
  );

  ipcMain.handle('backend:listTasks', (_event, filter?: ListTasksFilter) => listTasks(local.db, filter));

  ipcMain.handle('backend:listTaskLogs', (_event, filter?: ListTaskLogsFilter) => listTaskLogs(local.db, filter));

  ipcMain.handle('backend:retryTask', (_event, taskId: string) =>
    persist(local, () => retryTask(local.db, taskId)),
  );

  ipcMain.handle('backend:cancelTask', (_event, taskId: string) =>
    persist(local, () => cancelTask(local.db, taskId)),
  );

  ipcMain.handle('backend:startNextQueuedTask', async () => {
    const result = await startNextQueuedTask(local.db, local.paths, {
      executeMatlab: options.executeMatlab,
      executeFeatureGenerator: options.executeFeatureGenerator,
      executePrediction: options.executePrediction,
      executeExplainability: options.executeExplainability,
    });

    if (result.taskId) {
      local.save();
    }

    return result;
  });

  ipcMain.handle('backend:importPatientsCsv', async () => {
    const selection = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CSV files', extensions: ['csv'] }],
    });

    if (selection.canceled || selection.filePaths.length === 0) {
      return { created: 0, updated: 0, skipped: 0, errors: ['用户取消选择'] };
    }

    return persist(local, () => importPatientsFromCsv(local.db, selection.filePaths[0]));
  });

  ipcMain.handle('backend:scanEegFolder', async () => {
    const selection = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });

    if (selection.canceled || selection.filePaths.length === 0) {
      return { scannedFiles: 0, registeredFiles: 0, unmatchedFiles: [] };
    }

    return persist(local, () => scanEegFolderForPatients(local.db, selection.filePaths[0]));
  });

  ipcMain.handle('backend:selectDataLibraryRoot', async () => {
    const selection = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择数据与文档库根目录',
    });

    if (selection.canceled || selection.filePaths.length === 0) {
      return null;
    }

    return selection.filePaths[0];
  });

  ipcMain.handle('backend:getDataLibraryStatus', () => getDataLibraryStatus(local.db));

  ipcMain.handle('backend:listSourceRoots', () => listSourceRoots(local.db));

  ipcMain.handle('backend:upsertSourceRoot', (_event, input: UpsertSourceRootInput) =>
    persist(local, () => upsertSourceRoot(local.db, input)),
  );

  ipcMain.handle('backend:scanAndImportDataLibrary', (_event, rootPath: string) =>
    persist(local, () => scanAndImportDataLibrary(local.db, local.paths, rootPath)),
  );

  ipcMain.handle('backend:updateDataAssetIndex', (_event, rootPath: string) =>
    persist(local, () => updateDataAssetIndex(local.db, local.paths, rootPath)),
  );

  ipcMain.handle('backend:backupClinicalDocuments', (_event, rootPath: string) =>
    persist(local, () => backupClinicalDocuments(local.db, local.paths, rootPath)),
  );

  ipcMain.handle('backend:listDataAssets', (_event, filter?: Parameters<typeof listDataAssets>[1]) =>
    listDataAssets(local.db, filter),
  );

  ipcMain.handle('backend:listPatientAssetSummary', () => listPatientAssetSummary(local.db));

  ipcMain.handle('backend:getPatientDocumentDetail', (_event, patientId: string) =>
    getPatientDocumentDetail(local.db, patientId),
  );

  ipcMain.handle('backend:resolveManualAssetMatch', (_event, assetId: string, patientId: string) =>
    persist(local, () => resolveManualAssetMatch(local.db, assetId, patientId)),
  );

  ipcMain.handle('backend:indexExplanationArtifact', (_event, input: IndexExplanationArtifactInput) =>
    persist(local, () => indexExplanationArtifact(local.db, input)),
  );

  ipcMain.handle('backend:listExplanationArtifacts', (_event, filter?: ListExplanationArtifactsFilter) =>
    listExplanationArtifacts(local.db, filter),
  );

  ipcMain.handle('backend:listExplanationOverview', (_event, filter?: ListExplanationOverviewFilter) =>
    listExplanationOverview(local.db, filter),
  );

  ipcMain.handle('backend:deleteExplanationArtifact', (_event, artifactId: string) =>
    persist(local, () => deleteExplanationArtifact(local.db, artifactId)),
  );

  ipcMain.handle('backend:createExplainabilityBatch', (_event, input: ExplainabilityBatchInput) =>
    persist(local, () => createExplainabilityBatch(local.db, input)),
  );

  ipcMain.handle('backend:completeExplainabilityTask', (_event, taskId: string, manifestPath: string) =>
    persist(local, () => completeExplainabilityTask(local.db, taskId, manifestPath)),
  );

  ipcMain.handle('backend:prepareExplainabilityExecution', (_event, taskId: string) =>
    persist(local, () => prepareExplainabilityExecution(local.db, local.paths, taskId)),
  );

  ipcMain.handle('backend:runExplainabilityExecution', (_event, taskId: string) =>
    persist(local, () => runExplainabilityExecution(local.db, local.paths, taskId, options.executeExplainability)),
  );

  ipcMain.handle('backend:openExplanationArtifact', async (_event, artifactId: string) => {
    const artifact = getExplanationArtifact(local.db, artifactId);

    if (!artifact || !fs.existsSync(artifact.filePath)) {
      return { ok: false, message: '解释性文件不存在或文件已丢失。' };
    }

    const error = await shell.openPath(artifact.filePath);

    if (error) {
      return { ok: false, message: error };
    }

    return { ok: true, message: '已打开解释性文件。' };
  });

  ipcMain.handle('backend:indexFeatureArtifact', (_event, input: IndexFeatureArtifactInput) =>
    persist(local, () => indexFeatureArtifact(local.db, input)),
  );

  ipcMain.handle('backend:listFeatureArtifacts', (_event, filter?: ListFeatureArtifactsFilter) =>
    listFeatureArtifacts(local.db, filter),
  );

  ipcMain.handle('backend:listFeatureOverview', () => listFeatureOverview(local.db));

  ipcMain.handle('backend:createFeatureGenerationBatch', (_event, input: FeatureGenerationBatchInput) =>
    persist(local, () => createFeatureGenerationBatch(local.db, local.paths, input)),
  );

  ipcMain.handle('backend:completeFeatureGenerationTask', (_event, taskId: string, manifestPath: string) =>
    persist(local, () => completeFeatureGenerationTask(local.db, taskId, manifestPath)),
  );

  ipcMain.handle('backend:prepareFeatureGenerationExecution', (_event, taskId: string) =>
    persist(local, () => prepareFeatureGenerationExecution(local.db, local.paths, taskId)),
  );

  ipcMain.handle('backend:runFeatureGenerationExecution', (_event, taskId: string) =>
    persist(local, () => runFeatureGenerationExecution(local.db, local.paths, taskId, options.executeFeatureGenerator)),
  );

  ipcMain.handle('backend:openFeatureArtifact', async (_event, artifactId: string) => {
    const artifact = getFeatureArtifact(local.db, artifactId);

    if (!artifact || !fs.existsSync(artifact.filePath)) {
      return { ok: false, message: '特征文件不存在或文件已丢失。' };
    }

    const error = await shell.openPath(artifact.filePath);

    if (error) {
      return { ok: false, message: error };
    }

    return { ok: true, message: '已打开特征文件。' };
  });

  ipcMain.handle('backend:listPredictionModels', (_event, taskId?: string) =>
    listPredictionModels(local.db, taskId),
  );

  ipcMain.handle('backend:registerPredictionModel', (_event, input: RegisterPredictionModelInput) =>
    persist(local, () => registerPredictionModel(local.db, input)),
  );

  ipcMain.handle('backend:listPredictionQueue', (_event, filter?: ListPredictionQueueFilter) =>
    listPredictionQueue(local.db, filter),
  );

  ipcMain.handle('backend:runBatchPrediction', (_event, input: PredictionBatchInput) =>
    persist(local, () => createPredictionBatch(local.db, input)),
  );

  ipcMain.handle('backend:preparePredictionExecution', (_event, taskId: string) =>
    persist(local, () => preparePredictionExecution(local.db, local.paths, taskId)),
  );

  ipcMain.handle('backend:runPredictionExecution', (_event, taskId: string) =>
    persist(local, () => runPredictionExecution(local.db, local.paths, taskId, options.executePrediction)),
  );

  ipcMain.handle('backend:completePredictionTask', (_event, taskId: string, resultPath: string) =>
    persist(local, () => completePredictionTask(local.db, taskId, resultPath)),
  );

  ipcMain.handle('backend:savePredictionResult', (_event, input: SavePredictionResultInput) =>
    persist(local, () => savePredictionResult(local.db, input)),
  );

  ipcMain.handle('backend:createPatientReport', (_event, input: ReportExportInput) =>
    persist(local, () => createPatientReport(local.db, local.paths, input)),
  );

  ipcMain.handle('backend:listPatientReports', (_event, filter?: ListPatientReportsFilter) =>
    listPatientReports(local.db, filter),
  );

  ipcMain.handle('backend:openPatientReport', async (_event, reportId: string) => {
    const report = getPatientReport(local.db, reportId);

    if (!report || !fs.existsSync(report.filePath)) {
      return { ok: false, message: '报告不存在或文件已丢失。' };
    }

    const error = await shell.openPath(report.filePath);

    if (error) {
      return { ok: false, message: error };
    }

    return { ok: true, message: '已打开患者报告。' };
  });

  ipcMain.handle('backend:createBatchSummaryReport', (_event, input?: BatchSummaryExportInput) =>
    persist(local, () => createBatchSummaryReport(local.db, local.paths, input)),
  );

  ipcMain.handle('backend:listBatchSummaryReports', (_event, filter?: ListBatchSummaryReportsFilter) =>
    listBatchSummaryReports(local.db, filter),
  );

  ipcMain.handle('backend:openBatchSummaryReport', async (_event, reportId: string) => {
    const report = getBatchSummaryReport(local.db, reportId);

    if (!report || !fs.existsSync(report.filePath)) {
      return { ok: false, message: '批次汇总不存在或文件已丢失。' };
    }

    const error = await shell.openPath(report.filePath);

    if (error) {
      return { ok: false, message: error };
    }

    return { ok: true, message: '已打开批次汇总。' };
  });

  ipcMain.handle('backend:openAssetLocation', (_event, assetId: string) => {
    const asset = listDataAssets(local.db).find((item) => item.id === assetId);

    if (!asset || !fs.existsSync(asset.filePath)) {
      return { ok: false, message: '文件不存在或未找到资产记录。' };
    }

    shell.showItemInFolder(asset.filePath);
    return { ok: true, message: '已打开文件位置。' };
  });

  ipcMain.handle('backend:openBackupDirectory', async () => {
    const error = await shell.openPath(local.paths.clinicalDocsBackupRoot);

    if (error) {
      return { ok: false, message: error };
    }

    return { ok: true, message: '已打开备份目录。' };
  });
}
