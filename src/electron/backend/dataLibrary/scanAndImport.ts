import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'sql.js';
import type {
  ComputedCompletenessStatus,
  DataAssetMatchStatus,
  DataAssetStage,
  DataAssetType,
  PairStatus,
  ScanAndImportDataLibraryResult,
} from '../../../domain/backendTypes.js';
import type { AppPaths } from '../appPaths.js';
import { nowIso } from '../database.js';
import {
  addTask,
  addTaskLog,
  completeTask,
  createPatient,
  failTask,
  listPatientsForMatching,
  patientExistsBySubjectCode,
} from '../repositories.js';
import { backupClinicalDocument, shouldBackupAssetType } from './documentBackup.js';
import { parseClinicalWorkbook, parseCompletenessWorkbook, type ParsedCompletenessRow } from './excelParsers.js';
import {
  classifyDataLibraryPath,
  dataLibraryProjectDirectoryNames,
  dataLibraryProjectFileNames,
  type ClassifiedDataLibraryPath,
} from './pathClassifier.js';
import {
  listDataAssets,
  markSourceRootScanned,
  upsertClinicalMetrics,
  upsertDataAsset,
  upsertDataCompleteness,
  upsertSourceRoot,
} from './repository.js';

type ClassifiedFile = {
  filePath: string;
  classification: ClassifiedDataLibraryPath;
};

type PatientMatch = {
  id: string;
  subjectCode: string;
};

type CompletenessCounts = {
  patientId: string | null;
  subjectCode: string;
  stage: DataAssetStage;
  rawCntCount: number;
  processedSetCount: number;
  processedFdtCount: number;
  hadProcessedAssetsBefore: boolean;
};

type ScanMode = 'full' | 'indexOnly' | 'backupOnly';

type RunOptions = {
  mode: ScanMode;
  taskType: 'data_library_scan' | 'data_library_backup';
};

function emptyResult(sourceRootId = ''): ScanAndImportDataLibraryResult {
  return {
    sourceRootId,
    createdPatients: 0,
    updatedPatients: 0,
    indexedAssets: 0,
    backedUpDocuments: 0,
    missingFiles: 0,
    pairIssues: 0,
    unmatchedFiles: 0,
    manualReviewItems: 0,
    errors: [],
  };
}

function scanFiles(rootPath: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...scanFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function directoryLooksLikeDataLibraryRoot(dirPath: string): boolean {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return false;
  }

  return fs.readdirSync(dirPath, { withFileTypes: true }).some((entry) => {
    if (entry.isDirectory()) {
      return dataLibraryProjectDirectoryNames.has(entry.name);
    }

    return entry.isFile() && dataLibraryProjectFileNames.has(entry.name);
  });
}

function resolveDataLibraryScanRoot(rootPath: string): string {
  let current = path.resolve(rootPath);

  if (fs.existsSync(current) && fs.statSync(current).isFile()) {
    current = path.dirname(current);
  }

  while (true) {
    if (directoryLooksLikeDataLibraryRoot(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return rootPath;
    }
    current = parent;
  }
}

function classifyFiles(rootPath: string): ClassifiedFile[] {
  return scanFiles(rootPath)
    .map((filePath) => ({
      filePath,
      classification: classifyDataLibraryPath(rootPath, filePath),
    }))
    .filter((item): item is ClassifiedFile => item.classification !== null);
}

function listExistingBackupPaths(rootPath: string): Set<string> {
  const existing = new Set<string>();

  if (!fs.existsSync(rootPath)) {
    return existing;
  }

  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name);

    if (entry.isDirectory()) {
      for (const nested of listExistingBackupPaths(entryPath)) {
        existing.add(nested);
      }
    } else if (entry.isFile()) {
      existing.add(entryPath);
    }
  }

  return existing;
}

function patientMap(db: Database): Map<string, PatientMatch> {
  return new Map(listPatientsForMatching(db).map((patient) => [patient.subjectCode, patient]));
}

function matchStatusForAsset(
  classification: ClassifiedDataLibraryPath,
  patientsBySubjectCode: Map<string, PatientMatch>,
): DataAssetMatchStatus {
  if (classification.cohort === 'project') {
    return 'matched';
  }

  if (!classification.subjectCode) {
    return 'needs_review';
  }

  if (classification.cohort === 'health') {
    return 'matched';
  }

  return patientsBySubjectCode.has(classification.subjectCode) ? 'matched' : 'unmatched';
}

function patientIdForAsset(
  classification: ClassifiedDataLibraryPath,
  patientsBySubjectCode: Map<string, PatientMatch>,
): string | null {
  if (classification.cohort !== 'patient' || !classification.subjectCode) {
    return null;
  }

  return patientsBySubjectCode.get(classification.subjectCode)?.id ?? null;
}

function fileSize(filePath: string, existsOnDisk: boolean): number {
  if (!existsOnDisk) {
    return 0;
  }

  return fs.statSync(filePath).size;
}

function shouldParseClinicalAsset(assetType: DataAssetType): boolean {
  return assetType === 'clinical_excel';
}

function shouldParseCompletenessAsset(assetType: DataAssetType): boolean {
  return assetType === 'completeness_workbook';
}

function shouldProcessFile(mode: ScanMode, assetType: DataAssetType): boolean {
  if (mode === 'backupOnly') {
    return shouldBackupAssetType(assetType);
  }

  return true;
}

function shouldMarkStaleAsset(mode: ScanMode, assetType: DataAssetType): boolean {
  return shouldProcessFile(mode, assetType);
}

async function importClinicalPatients(
  db: Database,
  files: ClassifiedFile[],
  result: ScanAndImportDataLibraryResult,
): Promise<void> {
  const clinicalFiles = files.filter((file) => shouldParseClinicalAsset(file.classification.assetType));

  for (const file of clinicalFiles) {
    const rows = await parseClinicalWorkbook(file.filePath);

    for (const row of rows) {
      const exists = patientExistsBySubjectCode(db, row.subjectCode);
      const patientId = createPatient(db, {
        subjectCode: row.subjectCode,
        name: row.name,
        age: row.age,
        sex: row.sex,
        affectedHand: row.affectedHand,
      });

      if (exists) {
        result.updatedPatients += 1;
      } else {
        result.createdPatients += 1;
      }

      upsertClinicalMetrics(db, {
        patientId,
        sourceWorkbook: row.sourceWorkbook,
        diseaseCourse: row.diseaseCourse,
        affectedSideRaw: row.affectedSideRaw,
        fmaBefore: row.fmaBefore,
        fmaAfter: row.fmaAfter,
        mbiBefore: row.mbiBefore,
        mbiAfter: row.mbiAfter,
        bbtBefore: row.bbtBefore,
        bbtAfter: row.bbtAfter,
        mmse: row.mmse,
        missingData: row.missingData,
        dropoutReason: row.dropoutReason,
        mriCount: row.mriCount,
      });
    }
  }
}

async function parseCompletenessRows(files: ClassifiedFile[]): Promise<ParsedCompletenessRow[]> {
  const completenessRows: ParsedCompletenessRow[] = [];

  for (const file of files.filter((item) => shouldParseCompletenessAsset(item.classification.assetType))) {
    completenessRows.push(...(await parseCompletenessWorkbook(file.filePath)));
  }

  return completenessRows;
}

function updateCompletenessCounts(
  counts: Map<string, CompletenessCounts>,
  patientId: string | null,
  classification: ClassifiedDataLibraryPath,
): void {
  if (!classification.subjectCode) {
    return;
  }

  const key = `${classification.subjectCode}\u0000${classification.stage}`;
  const existing =
    counts.get(key) ??
    ({
      patientId,
      subjectCode: classification.subjectCode,
      stage: classification.stage,
      rawCntCount: 0,
      processedSetCount: 0,
      processedFdtCount: 0,
      hadProcessedAssetsBefore: false,
    } satisfies CompletenessCounts);

  existing.patientId = patientId ?? existing.patientId;

  if (classification.assetType === 'raw_eeg_cnt') {
    existing.rawCntCount += 1;
  } else if (classification.assetType === 'processed_eeg_set') {
    existing.processedSetCount += 1;
  } else if (classification.assetType === 'processed_eeg_fdt') {
    existing.processedFdtCount += 1;
  } else {
    return;
  }

  counts.set(key, existing);
}

function markHistoricalProcessedAssets(
  counts: Map<string, CompletenessCounts>,
  existingAssets: ReturnType<typeof listDataAssets>,
  filesSeenThisScan: Set<string>,
  mode: ScanMode,
): void {
  for (const asset of existingAssets) {
    if (
      filesSeenThisScan.has(asset.filePath) ||
      !shouldMarkStaleAsset(mode, asset.assetType) ||
      (asset.assetType !== 'processed_eeg_set' && asset.assetType !== 'processed_eeg_fdt') ||
      !asset.subjectCode
    ) {
      continue;
    }

    const key = `${asset.subjectCode}\u0000${asset.stage}`;
    const existing =
      counts.get(key) ??
      ({
        patientId: asset.patientId,
        subjectCode: asset.subjectCode,
        stage: asset.stage,
        rawCntCount: 0,
        processedSetCount: 0,
        processedFdtCount: 0,
        hadProcessedAssetsBefore: false,
      } satisfies CompletenessCounts);
    existing.patientId = asset.patientId ?? existing.patientId;
    existing.hadProcessedAssetsBefore = true;
    counts.set(key, existing);
  }
}

function pairStatus(counts: CompletenessCounts): PairStatus {
  const { processedSetCount: setCount, processedFdtCount: fdtCount } = counts;

  if (setCount === 0 && fdtCount === 0) {
    if (counts.hadProcessedAssetsBefore) {
      return 'missing_fdt';
    }

    return 'not_applicable';
  }

  if (setCount === fdtCount) {
    return 'complete';
  }

  return setCount > fdtCount ? 'missing_fdt' : 'missing_set';
}

function computedStatus(counts: CompletenessCounts, status: PairStatus): ComputedCompletenessStatus {
  if (status === 'complete') {
    return 'complete';
  }

  if (status === 'not_applicable') {
    return counts.rawCntCount > 0 ? 'complete' : 'missing';
  }

  return 'partial';
}

function workbookStatusBySubjectStage(rows: ParsedCompletenessRow[]): Map<string, ParsedCompletenessRow['workbookStatus']> {
  const statuses = new Map<string, ParsedCompletenessRow['workbookStatus']>();

  for (const row of rows) {
    statuses.set(`${row.subjectCode}\u0000${row.stage}`, row.workbookStatus);
  }

  return statuses;
}

function upsertCompleteness(
  db: Database,
  counts: Map<string, CompletenessCounts>,
  completenessRows: ParsedCompletenessRow[],
  result: ScanAndImportDataLibraryResult,
): void {
  const workbookStatuses = workbookStatusBySubjectStage(completenessRows);

  for (const item of counts.values()) {
    const setFdtPairStatus = pairStatus(item);
    const status = computedStatus(item, setFdtPairStatus);

    if (setFdtPairStatus !== 'complete' && setFdtPairStatus !== 'not_applicable') {
      result.pairIssues += 1;
    }

    upsertDataCompleteness(db, {
      patientId: item.patientId,
      subjectCode: item.subjectCode,
      stage: item.stage,
      task: 'resting_unknown',
      rawCntCount: item.rawCntCount,
      processedSetCount: item.processedSetCount,
      processedFdtCount: item.processedFdtCount,
      setFdtPairStatus,
      workbookStatus: workbookStatuses.get(`${item.subjectCode}\u0000${item.stage}`) ?? null,
      computedStatus: status,
    });
  }
}

function markStaleAssetsMissing(
  db: Database,
  existingAssets: ReturnType<typeof listDataAssets>,
  filesSeenThisScan: Set<string>,
  mode: ScanMode,
  result: ScanAndImportDataLibraryResult,
): void {
  for (const asset of existingAssets) {
    if (filesSeenThisScan.has(asset.filePath) || !shouldMarkStaleAsset(mode, asset.assetType)) {
      continue;
    }

    upsertDataAsset(db, {
      sourceRootId: asset.sourceRootId,
      patientId: asset.patientId,
      subjectCode: asset.subjectCode,
      sourceSubjectCode: asset.sourceSubjectCode,
      subjectName: asset.subjectName,
      cohort: asset.cohort,
      stage: asset.stage,
      assetType: asset.assetType,
      filePath: asset.filePath,
      backupPath: asset.backupPath,
      fileSize: 0,
      fileHash: asset.fileHash,
      existsOnDisk: false,
      matchStatus: asset.matchStatus,
    });
    result.missingFiles += 1;
  }
}

function existingAssetByPath(existingAssets: ReturnType<typeof listDataAssets>): Map<string, ReturnType<typeof listDataAssets>[number]> {
  return new Map(existingAssets.map((asset) => [asset.filePath, asset]));
}

async function runScanAndImport(
  db: Database,
  paths: AppPaths,
  rootPath: string,
  options: RunOptions,
): Promise<ScanAndImportDataLibraryResult> {
  const scanRootPath = resolveDataLibraryScanRoot(rootPath);
  const taskId = addTask(db, {
    type: options.taskType,
    status: 'running',
    inputJson: JSON.stringify({
      rootPath: scanRootPath,
      ...(scanRootPath !== rootPath ? { selectedRootPath: rootPath } : {}),
    }),
    startedAt: nowIso(),
  });
  const result = emptyResult();

  try {
    const sourceRoot = upsertSourceRoot(db, {
      projectName: path.basename(scanRootPath),
      rootPath: scanRootPath,
      status: fs.existsSync(scanRootPath) ? 'active' : 'missing',
    });
    result.sourceRootId = sourceRoot.id;

    const existingAssets = listDataAssets(db, { sourceRootId: sourceRoot.id });
    const assetsByPath = existingAssetByPath(existingAssets);
    const files = classifyFiles(scanRootPath).filter((file) => shouldProcessFile(options.mode, file.classification.assetType));
    if (options.mode === 'full') {
      await importClinicalPatients(db, files, result);
    }
    const completenessRows = options.mode === 'backupOnly' ? [] : await parseCompletenessRows(files);
    const patientsBySubjectCode = patientMap(db);
    const completenessCounts = new Map<string, CompletenessCounts>();
    const filesSeenThisScan = new Set(files.map((file) => file.filePath));
    const existingBackupPaths = listExistingBackupPaths(paths.clinicalDocsBackupRoot);

    for (const file of files) {
      const existsOnDisk = fs.existsSync(file.filePath);
      const patientId = patientIdForAsset(file.classification, patientsBySubjectCode);
      const matchStatus = matchStatusForAsset(file.classification, patientsBySubjectCode);
      const existingAsset = assetsByPath.get(file.filePath);
      let backupPath: string | null = existingAsset?.backupPath ?? null;
      let fileHash = existingAsset?.fileHash ?? '';

      if (!existsOnDisk) {
        result.missingFiles += 1;
      }

      if (existsOnDisk && options.mode !== 'indexOnly' && shouldBackupAssetType(file.classification.assetType)) {
        const backup = backupClinicalDocument({
          sourcePath: file.filePath,
          clinicalDocsBackupRoot: paths.clinicalDocsBackupRoot,
          assetType: file.classification.assetType,
          subjectCode: file.classification.subjectCode,
        });
        backupPath = backup.backupPath;
        fileHash = backup.fileHash;
        if (!existingBackupPaths.has(backup.backupPath)) {
          result.backedUpDocuments += 1;
          existingBackupPaths.add(backup.backupPath);
        }
      }

      upsertDataAsset(db, {
        sourceRootId: sourceRoot.id,
        patientId,
        subjectCode: file.classification.subjectCode,
        sourceSubjectCode: file.classification.sourceSubjectCode,
        subjectName: file.classification.subjectName,
        cohort: file.classification.cohort,
        stage: file.classification.stage,
        assetType: file.classification.assetType,
        filePath: file.filePath,
        backupPath,
        fileSize: fileSize(file.filePath, existsOnDisk),
        fileHash,
        existsOnDisk,
        matchStatus,
      });

      result.indexedAssets += 1;
      if (matchStatus === 'unmatched') {
        result.unmatchedFiles += 1;
      } else if (matchStatus === 'needs_review') {
        result.manualReviewItems += 1;
      }

      if (options.mode !== 'backupOnly') {
        updateCompletenessCounts(completenessCounts, patientId, file.classification);
      }
    }

    markStaleAssetsMissing(db, existingAssets, filesSeenThisScan, options.mode, result);
    if (options.mode !== 'backupOnly') {
      markHistoricalProcessedAssets(completenessCounts, existingAssets, filesSeenThisScan, options.mode);
      upsertCompleteness(db, completenessCounts, completenessRows, result);
    }
    result.manualReviewItems += result.pairIssues;
    markSourceRootScanned(db, sourceRoot.id);
    addTaskLog(db, {
      taskId,
      level: 'info',
      source: 'app',
      message: `Data library scan completed: indexed ${result.indexedAssets}, backed up ${result.backedUpDocuments}, unmatched ${result.unmatchedFiles}`,
    });
    completeTask(db, taskId, JSON.stringify(result));

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message);
    failTask(db, taskId, message);
    addTaskLog(db, {
      taskId,
      level: 'error',
      source: 'app',
      message: `Data library scan failed: ${message}`,
    });

    return result;
  }
}

export async function scanAndImportDataLibrary(
  db: Database,
  paths: AppPaths,
  rootPath: string,
): Promise<ScanAndImportDataLibraryResult> {
  return runScanAndImport(db, paths, rootPath, { mode: 'full', taskType: 'data_library_scan' });
}

export async function updateDataAssetIndex(
  db: Database,
  paths: AppPaths,
  rootPath: string,
): Promise<ScanAndImportDataLibraryResult> {
  return runScanAndImport(db, paths, rootPath, { mode: 'indexOnly', taskType: 'data_library_scan' });
}

export async function backupClinicalDocuments(
  db: Database,
  paths: AppPaths,
  rootPath: string,
): Promise<ScanAndImportDataLibraryResult> {
  return runScanAndImport(db, paths, rootPath, { mode: 'backupOnly', taskType: 'data_library_backup' });
}
