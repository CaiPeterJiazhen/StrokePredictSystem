import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase, type LocalDatabase } from '../../../../src/electron/backend/database.js';
import { listPatients, listTasks } from '../../../../src/electron/backend/repositories.js';
import {
  backupClinicalDocuments,
  scanAndImportDataLibrary,
  updateDataAssetIndex,
} from '../../../../src/electron/backend/dataLibrary/scanAndImport.js';
import {
  getDataLibraryStatus,
  getPatientDocumentDetail,
  listDataAssets,
  listPatientAssetSummary,
} from '../../../../src/electron/backend/dataLibrary/repository.js';

const roots: string[] = [];
const locals: LocalDatabase[] = [];

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function openTempDatabase(): Promise<LocalDatabase> {
  const local = await openLocalDatabase(tempRoot('stroke-scan-import-db-'));
  locals.push(local);
  return local;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

async function writeClinicalWorkbook(filePath: string): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('clinical');

  worksheet.addRow(['编号', '姓名', '年龄', '性别', '患病侧', '治疗前FMA', '治疗后FMA']);
  worksheet.addRow(['sub01', '穆祥贵', 71, '男', '左手', 63, 65]);
  await workbook.xlsx.writeFile(filePath);
}

async function writeEegM1Fixture(sourceRoot: string): Promise<{ setPath: string; fdtPath: string }> {
  writeFile(
    path.join(sourceRoot, 'Patient_tACS_M1_EEG', '基线', 'sub01穆祥贵', 'mxg1.cnt'),
    'raw eeg',
  );
  const setPath = path.join(
    sourceRoot,
    'Patient_tACS_M1_RestingStateEEG_afterProcess',
    '基线',
    'sub01穆祥贵',
    'mxg1.set',
  );
  writeFile(setPath, 'set file');
  const fdtPath = path.join(
    sourceRoot,
    'Patient_tACS_M1_RestingStateEEG_afterProcess',
    '基线',
    'sub01穆祥贵',
    'mxg1.fdt',
  );
  writeFile(fdtPath, 'fdt file');
  writeFile(path.join(sourceRoot, '患者记录本', 'sub01穆祥贵.pdf'), '%PDF-1.4');
  await writeClinicalWorkbook(path.join(sourceRoot, 'M1组病历记录表.xlsx'));

  return { setPath, fdtPath };
}

afterEach(() => {
  for (const local of locals.splice(0)) local.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('scanAndImportDataLibrary', () => {
  it('imports clinical patients, indexes EEG assets, backs up documents, and computes baseline pairs', async () => {
    const sourceRoot = tempRoot('stroke-eeg-m1-fixture-');
    await writeEegM1Fixture(sourceRoot);

    const local = await openTempDatabase();
    const result = await scanAndImportDataLibrary(local.db, local.paths, sourceRoot);

    expect(result).toEqual(
      expect.objectContaining({
        createdPatients: 1,
        indexedAssets: 5,
        backedUpDocuments: 2,
        missingFiles: 0,
        unmatchedFiles: 0,
      }),
    );
    expect(result.errors).toEqual([]);

    const patients = listPatients(local.db);
    expect(patients).toEqual([
      expect.objectContaining({
        subjectCode: 'sub01',
        name: '穆祥贵',
        sex: '男',
      }),
    ]);

    const assets = listDataAssets(local.db);
    const rawAsset = assets.find((asset) => asset.assetType === 'raw_eeg_cnt');
    expect(rawAsset).toEqual(
      expect.objectContaining({
        backupPath: null,
        subjectCode: 'sub01',
        stage: '基线',
        matchStatus: 'matched',
      }),
    );
    const recordPdf = assets.find((asset) => asset.assetType === 'record_pdf');
    expect(recordPdf?.backupPath).toContain('clinical_docs');
    expect(
      assets
        .filter((asset) => ['raw_eeg_cnt', 'processed_eeg_set', 'processed_eeg_fdt'].includes(asset.assetType))
        .every((asset) => asset.backupPath === null),
    ).toBe(true);

    const summary = listPatientAssetSummary(local.db);
    const patientSummary = summary.find((row) => row.subjectCode === 'sub01' && row.cohort === 'patient');
    expect(patientSummary).toEqual(
      expect.objectContaining({
        baselineRawCount: 1,
        baselineProcessedPairs: 1,
      }),
    );

    const status = getDataLibraryStatus(local.db);
    expect(status.indexedFiles).toBe(5);

    const patientDetail = getPatientDocumentDetail(local.db, patients[0].id);
    expect(patientDetail.clinicalMetrics).toEqual(
      expect.objectContaining({
        fmaBefore: 63,
        fmaAfter: 65,
      }),
    );

    const tasks = listTasks(local.db, { type: 'data_library_scan' });
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        status: 'completed',
      }),
    );

    const repeatResult = await scanAndImportDataLibrary(local.db, local.paths, sourceRoot);
    expect(repeatResult.backedUpDocuments).toBe(0);
  });

  it('normalizes a selected project subfolder back to the data library root before scanning', async () => {
    const sourceRoot = tempRoot('stroke-eeg-m1-subfolder-fixture-');
    await writeEegM1Fixture(sourceRoot);
    const selectedSubfolder = path.join(sourceRoot, 'Patient_tACS_M1_EEG');

    const local = await openTempDatabase();
    const result = await scanAndImportDataLibrary(local.db, local.paths, selectedSubfolder);

    expect(result).toEqual(
      expect.objectContaining({
        indexedAssets: 5,
        createdPatients: 1,
      }),
    );
    expect(getDataLibraryStatus(local.db).sourceRoot?.rootPath).toBe(sourceRoot);
    expect(listPatientAssetSummary(local.db).some((row) => row.subjectCode === 'sub01')).toBe(true);
  });

  it('marks stale assets missing and recomputes completeness from files currently on disk', async () => {
    const sourceRoot = tempRoot('stroke-eeg-m1-stale-fixture-');
    const { fdtPath } = await writeEegM1Fixture(sourceRoot);
    const local = await openTempDatabase();

    await scanAndImportDataLibrary(local.db, local.paths, sourceRoot);
    fs.rmSync(fdtPath);
    const result = await scanAndImportDataLibrary(local.db, local.paths, sourceRoot);

    expect(result.missingFiles).toBeGreaterThan(0);
    const patients = listPatients(local.db);
    const staleFdt = listDataAssets(local.db).find((asset) => asset.filePath === fdtPath);
    expect(staleFdt).toEqual(
      expect.objectContaining({
        existsOnDisk: false,
        fileSize: 0,
      }),
    );

    const patientSummary = listPatientAssetSummary(local.db).find(
      (row) => row.subjectCode === 'sub01' && row.cohort === 'patient',
    );
    expect(patientSummary).toEqual(
      expect.objectContaining({
        baselineProcessedPairs: 0,
      }),
    );

    const patientDetail = getPatientDocumentDetail(local.db, patients[0].id);
    expect(patientDetail.completeness).toEqual([
      expect.objectContaining({
        setFdtPairStatus: 'missing_fdt',
        computedStatus: 'partial',
      }),
    ]);
    expect(patientDetail.warnings.some((warning) => warning.includes('missing_fdt') || warning.includes('partial'))).toBe(
      true,
    );
    expect(getDataLibraryStatus(local.db).missingFiles).toBeGreaterThan(0);
  });

  it('keeps completeness under review when a previously complete processed pair is fully deleted', async () => {
    const sourceRoot = tempRoot('stroke-eeg-m1-stale-pair-fixture-');
    const { setPath, fdtPath } = await writeEegM1Fixture(sourceRoot);
    const local = await openTempDatabase();

    await scanAndImportDataLibrary(local.db, local.paths, sourceRoot);
    fs.rmSync(setPath);
    fs.rmSync(fdtPath);
    const result = await scanAndImportDataLibrary(local.db, local.paths, sourceRoot);

    expect(result.pairIssues).toBeGreaterThan(0);
    const patients = listPatients(local.db);
    const patientDetail = getPatientDocumentDetail(local.db, patients[0].id);
    expect(patientDetail.completeness).toEqual([
      expect.objectContaining({
        processedSetCount: 0,
        processedFdtCount: 0,
        computedStatus: expect.not.stringMatching(/^complete$/),
      }),
    ]);
    expect(patientDetail.warnings.length).toBeGreaterThan(0);
    const patientSummary = listPatientAssetSummary(local.db).find(
      (row) => row.subjectCode === 'sub01' && row.cohort === 'patient',
    );
    expect(patientSummary?.issueCount).toBeGreaterThan(0);
  });

  it('separates asset indexing from document backups', async () => {
    const sourceRoot = tempRoot('stroke-eeg-m1-entrypoints-fixture-');
    await writeEegM1Fixture(sourceRoot);
    const local = await openTempDatabase();

    const indexResult = await updateDataAssetIndex(local.db, local.paths, sourceRoot);
    expect(indexResult).toEqual(
      expect.objectContaining({
        createdPatients: 0,
        indexedAssets: 5,
        backedUpDocuments: 0,
      }),
    );
    expect(listPatients(local.db)).toEqual([]);
    expect(
      listDataAssets(local.db)
        .filter((asset) => ['record_pdf', 'clinical_excel'].includes(asset.assetType))
        .every((asset) => asset.backupPath === null),
    ).toBe(true);

    const backupOnlyRoot = tempRoot('stroke-eeg-m1-backup-only-fixture-');
    await writeEegM1Fixture(backupOnlyRoot);
    const backupLocal = await openTempDatabase();
    const backupResult = await backupClinicalDocuments(backupLocal.db, backupLocal.paths, backupOnlyRoot);
    const backupAssets = listDataAssets(backupLocal.db);

    expect(backupResult).toEqual(
      expect.objectContaining({
        indexedAssets: 2,
        backedUpDocuments: 2,
      }),
    );
    expect(backupAssets.map((asset) => asset.assetType).sort()).toEqual(['clinical_excel', 'record_pdf']);
    expect(backupAssets.every((asset) => asset.backupPath?.includes('clinical_docs'))).toBe(true);

    const repeatBackupResult = await backupClinicalDocuments(backupLocal.db, backupLocal.paths, backupOnlyRoot);
    expect(repeatBackupResult.backedUpDocuments).toBe(0);
  });

  it('preserves existing document backup metadata during asset-index refreshes', async () => {
    const sourceRoot = tempRoot('stroke-eeg-m1-preserve-backup-fixture-');
    await writeEegM1Fixture(sourceRoot);
    const local = await openTempDatabase();

    await scanAndImportDataLibrary(local.db, local.paths, sourceRoot);
    const originalDocumentAsset = listDataAssets(local.db).find((asset) => asset.assetType === 'record_pdf');
    expect(originalDocumentAsset?.backupPath).toContain('clinical_docs');
    expect(originalDocumentAsset?.fileHash).not.toBe('');

    await updateDataAssetIndex(local.db, local.paths, sourceRoot);
    const refreshedDocumentAsset = listDataAssets(local.db).find((asset) => asset.assetType === 'record_pdf');

    expect(refreshedDocumentAsset).toEqual(
      expect.objectContaining({
        backupPath: originalDocumentAsset?.backupPath,
        fileHash: originalDocumentAsset?.fileHash,
      }),
    );
  });
});
