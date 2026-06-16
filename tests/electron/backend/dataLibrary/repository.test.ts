import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase, type LocalDatabase } from '../../../../src/electron/backend/database.js';
import { createPatient } from '../../../../src/electron/backend/repositories.js';
import {
  getDataLibraryStatus,
  getPatientDocumentDetail,
  listDataAssets,
  listPatientAssetSummary,
  listSourceRoots,
  markSourceRootScanned,
  resolveManualAssetMatch,
  upsertClinicalMetrics,
  upsertDataAsset,
  upsertDataCompleteness,
  upsertSourceRoot,
} from '../../../../src/electron/backend/dataLibrary/repository.js';

const roots: string[] = [];
const locals: LocalDatabase[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-data-lib-repo-'));
  roots.push(root);
  return root;
}

async function openTempDatabase(): Promise<LocalDatabase> {
  const local = await openLocalDatabase(tempRoot());
  locals.push(local);
  return local;
}

afterEach(() => {
  for (const local of locals.splice(0)) local.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('data library repository', () => {
  it('upserts source roots and assets by their natural keys', async () => {
    const local = await openTempDatabase();
    const sourceRoot = upsertSourceRoot(local.db, {
      projectName: 'EEG_M1',
      rootPath: 'F:\\CJZFile\\EEG_M1',
      status: 'active',
    });
    const updatedRoot = upsertSourceRoot(local.db, {
      projectName: 'EEG_M1 Updated',
      rootPath: 'F:\\CJZFile\\EEG_M1',
      status: 'missing',
    });

    expect(updatedRoot.id).toBe(sourceRoot.id);
    expect(updatedRoot.projectName).toBe('EEG_M1 Updated');
    expect(updatedRoot.status).toBe('missing');

    const firstAsset = upsertDataAsset(local.db, {
      sourceRootId: sourceRoot.id,
      patientId: null,
      subjectCode: 'sub01',
      sourceSubjectCode: 'sub001',
      subjectName: '穆祥贵',
      cohort: 'patient',
      stage: '基线',
      assetType: 'raw_eeg_cnt',
      filePath: 'F:\\CJZFile\\EEG_M1\\Patient_tACS_M1_EEG\\基线\\sub01穆祥贵\\mxg1.cnt',
      backupPath: null,
      fileSize: 123,
      fileHash: '',
      existsOnDisk: true,
      matchStatus: 'needs_review',
    });
    const updatedAsset = upsertDataAsset(local.db, {
      ...firstAsset,
      patientId: null,
      fileSize: 456,
      existsOnDisk: false,
      matchStatus: 'matched',
    });

    expect(updatedAsset.id).toBe(firstAsset.id);
    expect(updatedAsset.fileSize).toBe(456);
    expect(updatedAsset.existsOnDisk).toBe(false);
    expect(listDataAssets(local.db, { sourceRootId: sourceRoot.id })).toHaveLength(1);
  });

  it('lists source roots for renderer data root management', async () => {
    const local = await openTempDatabase();
    const firstRoot = upsertSourceRoot(local.db, {
      projectName: 'EEG_M1',
      rootPath: 'F:\\CJZFile\\EEG_M1',
      status: 'active',
    });
    const secondRoot = upsertSourceRoot(local.db, {
      projectName: 'Archive',
      rootPath: 'F:\\CJZFile\\EEG_M1_archive',
      status: 'archived',
      lastScannedAt: '2026-06-14T08:30:00.000Z',
    });

    expect(listSourceRoots(local.db)).toEqual([
      expect.objectContaining({ id: firstRoot.id, rootPath: firstRoot.rootPath, status: 'active' }),
      expect.objectContaining({ id: secondRoot.id, rootPath: secondRoot.rootPath, status: 'archived' }),
    ]);
  });

  it('resolves a manual-review asset to a selected patient', async () => {
    const local = await openTempDatabase();
    const sourceRoot = upsertSourceRoot(local.db, {
      projectName: 'EEG_M1',
      rootPath: 'F:\\CJZFile\\EEG_M1',
      status: 'active',
    });
    const patientId = createPatient(local.db, {
      subjectCode: 'sub01',
      name: '穆祥贵',
      sex: '男',
    });
    const asset = upsertDataAsset(local.db, {
      sourceRootId: sourceRoot.id,
      patientId: null,
      subjectCode: 'unmatched',
      sourceSubjectCode: 'mxg',
      subjectName: '',
      cohort: 'patient',
      stage: '基线',
      assetType: 'raw_eeg_cnt',
      filePath: 'F:\\CJZFile\\EEG_M1\\Patient_tACS_M1_EEG\\基线\\unknown\\mxg1.cnt',
      backupPath: null,
      fileSize: 123,
      fileHash: '',
      existsOnDisk: true,
      matchStatus: 'needs_review',
    });

    const result = resolveManualAssetMatch(local.db, asset.id, patientId);

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: '已将资产匹配到患者 sub01。',
        asset: expect.objectContaining({
          id: asset.id,
          patientId,
          subjectCode: 'sub01',
          sourceSubjectCode: 'mxg',
          subjectName: '穆祥贵',
          matchStatus: 'matched',
        }),
      }),
    );
    expect(listDataAssets(local.db, { matchStatus: 'needs_review' })).toEqual([]);
    expect(getDataLibraryStatus(local.db).manualReviewItems).toBe(0);
    expect(getPatientDocumentDetail(local.db, patientId).assets).toEqual([
      expect.objectContaining({ id: asset.id, matchStatus: 'matched' }),
    ]);
  });

  it('aggregates patient summary, clinical details, completeness, and status counts', async () => {
    const local = await openTempDatabase();
    const sourceRoot = upsertSourceRoot(local.db, {
      projectName: 'EEG_M1',
      rootPath: 'F:\\CJZFile\\EEG_M1',
      status: 'active',
    });
    const patientId = createPatient(local.db, {
      subjectCode: 'sub01',
      name: '穆祥贵',
      age: 71,
      sex: '男',
      affectedHand: '左手',
    });

    upsertClinicalMetrics(local.db, {
      patientId,
      sourceWorkbook: 'M1组病历记录表.xlsx',
      diseaseCourse: '17天',
      affectedSideRaw: '左手',
      fmaBefore: 63,
      fmaAfter: 65,
      mbiBefore: 80,
      mbiAfter: 95,
      bbtBefore: '左18右26',
      bbtAfter: '左20右29',
      mmse: null,
      missingData: '',
      dropoutReason: '',
      mriCount: null,
    });

    upsertDataAsset(local.db, {
      sourceRootId: sourceRoot.id,
      patientId,
      subjectCode: 'sub01',
      sourceSubjectCode: 'sub01',
      subjectName: '穆祥贵',
      cohort: 'patient',
      stage: '基线',
      assetType: 'raw_eeg_cnt',
      filePath: 'F:\\CJZFile\\EEG_M1\\Patient_tACS_M1_EEG\\基线\\sub01穆祥贵\\mxg1.cnt',
      backupPath: null,
      fileSize: 123,
      fileHash: '',
      existsOnDisk: true,
      matchStatus: 'matched',
    });
    upsertDataAsset(local.db, {
      sourceRootId: sourceRoot.id,
      patientId,
      subjectCode: 'sub01',
      sourceSubjectCode: 'sub01',
      subjectName: '穆祥贵',
      cohort: 'patient',
      stage: '基线',
      assetType: 'processed_eeg_set',
      filePath: 'F:\\CJZFile\\EEG_M1\\Patient_tACS_M1_EEG\\基线\\sub01穆祥贵\\mxg1.set',
      backupPath: null,
      fileSize: 200,
      fileHash: '',
      existsOnDisk: true,
      matchStatus: 'matched',
    });
    upsertDataAsset(local.db, {
      sourceRootId: sourceRoot.id,
      patientId,
      subjectCode: 'sub01',
      sourceSubjectCode: 'sub01',
      subjectName: '穆祥贵',
      cohort: 'patient',
      stage: '基线',
      assetType: 'processed_eeg_fdt',
      filePath: 'F:\\CJZFile\\EEG_M1\\Patient_tACS_M1_EEG\\基线\\sub01穆祥贵\\mxg1.fdt',
      backupPath: null,
      fileSize: 300,
      fileHash: '',
      existsOnDisk: true,
      matchStatus: 'matched',
    });
    upsertDataAsset(local.db, {
      sourceRootId: sourceRoot.id,
      patientId,
      subjectCode: 'sub01',
      sourceSubjectCode: 'sub01',
      subjectName: '穆祥贵',
      cohort: 'patient',
      stage: '不适用',
      assetType: 'record_pdf',
      filePath: 'F:\\CJZFile\\EEG_M1\\M1组病历\\sub01穆祥贵.pdf',
      backupPath: 'C:\\Users\\me\\Documents\\StrokePredictSystem\\backups\\clinical_docs\\pdf\\sub01.pdf',
      fileSize: 900,
      fileHash: 'hash',
      existsOnDisk: true,
      matchStatus: 'matched',
    });
    upsertDataCompleteness(local.db, {
      patientId,
      subjectCode: 'sub01',
      stage: '基线',
      task: '睁眼',
      rawCntCount: 1,
      processedSetCount: 1,
      processedFdtCount: 1,
      setFdtPairStatus: 'complete',
      workbookStatus: 'Y',
      computedStatus: 'complete',
    });

    markSourceRootScanned(local.db, sourceRoot.id);

    const status = getDataLibraryStatus(local.db);
    const summary = listPatientAssetSummary(local.db);
    const detail = getPatientDocumentDetail(local.db, patientId);

    expect(status.sourceRoot?.rootPath).toBe('F:\\CJZFile\\EEG_M1');
    expect(status.indexedFiles).toBe(4);
    expect(status.backedUpDocuments).toBe(1);
    expect(status.missingFiles).toBe(0);
    expect(summary).toEqual([
      expect.objectContaining({
        patientId,
        subjectCode: 'sub01',
        subjectName: '穆祥贵',
        cohort: 'patient',
        hasClinicalInfo: true,
        hasRecordPdf: true,
        baselineRawCount: 1,
        baselineProcessedPairs: 1,
        immediateProcessedPairs: 0,
        phaseProcessedPairs: 0,
        finalProcessedPairs: 0,
        issueCount: 0,
        matchStatus: 'matched',
      }),
    ]);
    expect(detail.patient).toEqual(expect.objectContaining({ id: patientId, subjectCode: 'sub01' }));
    expect(detail.clinicalMetrics).toEqual(expect.objectContaining({ fmaBefore: 63, fmaAfter: 65 }));
    expect(detail.assets).toHaveLength(4);
    expect(detail.completeness).toEqual([expect.objectContaining({ setFdtPairStatus: 'complete' })]);
    expect(detail.warnings).toEqual([]);
  });

  it('does not multiply asset summary counts when a patient has multiple clinical workbooks', async () => {
    const local = await openTempDatabase();
    const sourceRoot = upsertSourceRoot(local.db, {
      projectName: 'EEG_M1',
      rootPath: 'F:\\CJZFile\\EEG_M1',
      status: 'active',
    });
    const patientId = createPatient(local.db, {
      subjectCode: 'sub02',
      name: '单庆明',
      age: 68,
      sex: '男',
      affectedHand: '右手',
    });

    for (const sourceWorkbook of ['M1组病历记录表.xlsx', 'M1组补充病历记录表.xlsx']) {
      upsertClinicalMetrics(local.db, {
        patientId,
        sourceWorkbook,
        diseaseCourse: '20天',
        affectedSideRaw: '右手',
        fmaBefore: 60,
        fmaAfter: 64,
        mbiBefore: 78,
        mbiAfter: 90,
        bbtBefore: '',
        bbtAfter: '',
        mmse: null,
        missingData: '',
        dropoutReason: '',
        mriCount: null,
      });
    }

    upsertDataAsset(local.db, {
      sourceRootId: sourceRoot.id,
      patientId,
      subjectCode: 'sub02',
      sourceSubjectCode: 'sub02',
      subjectName: '单庆明',
      cohort: 'patient',
      stage: '基线',
      assetType: 'raw_eeg_cnt',
      filePath: 'F:\\CJZFile\\EEG_M1\\Patient_tACS_M1_EEG\\基线\\sub02单庆明\\sqm1.cnt',
      backupPath: null,
      fileSize: 100,
      fileHash: '',
      existsOnDisk: true,
      matchStatus: 'matched',
    });
    upsertDataAsset(local.db, {
      sourceRootId: sourceRoot.id,
      patientId,
      subjectCode: 'sub02',
      sourceSubjectCode: 'sub02',
      subjectName: '单庆明',
      cohort: 'patient',
      stage: '基线',
      assetType: 'processed_eeg_set',
      filePath: 'F:\\CJZFile\\EEG_M1\\Patient_tACS_M1_EEG\\基线\\sub02单庆明\\sqm1.set',
      backupPath: null,
      fileSize: 200,
      fileHash: '',
      existsOnDisk: true,
      matchStatus: 'matched',
    });
    upsertDataAsset(local.db, {
      sourceRootId: sourceRoot.id,
      patientId,
      subjectCode: 'sub02',
      sourceSubjectCode: 'sub02',
      subjectName: '单庆明',
      cohort: 'patient',
      stage: '基线',
      assetType: 'processed_eeg_fdt',
      filePath: 'F:\\CJZFile\\EEG_M1\\Patient_tACS_M1_EEG\\基线\\sub02单庆明\\sqm1.fdt',
      backupPath: null,
      fileSize: 300,
      fileHash: '',
      existsOnDisk: true,
      matchStatus: 'matched',
    });

    const summary = listPatientAssetSummary(local.db);

    expect(summary).toEqual([
      expect.objectContaining({
        patientId,
        subjectCode: 'sub02',
        hasClinicalInfo: true,
        baselineRawCount: 1,
        baselineProcessedPairs: 1,
        issueCount: 0,
      }),
    ]);
  });

  it('ignores missing EEG assets when computing summary pair counts', async () => {
    const local = await openTempDatabase();
    const sourceRoot = upsertSourceRoot(local.db, {
      projectName: 'EEG_M1',
      rootPath: 'F:\\CJZFile\\EEG_M1',
      status: 'active',
    });
    const patientId = createPatient(local.db, {
      subjectCode: 'sub03',
      name: '测试患者',
      sex: '女',
    });

    upsertDataAsset(local.db, {
      sourceRootId: sourceRoot.id,
      patientId,
      subjectCode: 'sub03',
      sourceSubjectCode: 'sub03',
      subjectName: '测试患者',
      cohort: 'patient',
      stage: '基线',
      assetType: 'processed_eeg_set',
      filePath: 'F:\\CJZFile\\EEG_M1\\Patient_tACS_M1_EEG\\基线\\sub03测试患者\\test.set',
      backupPath: null,
      fileSize: 200,
      fileHash: '',
      existsOnDisk: true,
      matchStatus: 'matched',
    });
    const fdtAsset = upsertDataAsset(local.db, {
      sourceRootId: sourceRoot.id,
      patientId,
      subjectCode: 'sub03',
      sourceSubjectCode: 'sub03',
      subjectName: '测试患者',
      cohort: 'patient',
      stage: '基线',
      assetType: 'processed_eeg_fdt',
      filePath: 'F:\\CJZFile\\EEG_M1\\Patient_tACS_M1_EEG\\基线\\sub03测试患者\\test.fdt',
      backupPath: null,
      fileSize: 300,
      fileHash: '',
      existsOnDisk: true,
      matchStatus: 'matched',
    });

    expect(listPatientAssetSummary(local.db)[0]).toEqual(
      expect.objectContaining({
        baselineProcessedPairs: 1,
      }),
    );

    upsertDataAsset(local.db, {
      ...fdtAsset,
      fileSize: 0,
      existsOnDisk: false,
    });

    expect(listPatientAssetSummary(local.db)[0]).toEqual(
      expect.objectContaining({
        baselineProcessedPairs: 0,
      }),
    );
  });

  it('keeps patient and health summaries separate when null-patient subject codes overlap', async () => {
    const local = await openTempDatabase();
    const sourceRoot = upsertSourceRoot(local.db, {
      projectName: 'EEG_M1',
      rootPath: 'F:\\CJZFile\\EEG_M1',
      status: 'active',
    });

    upsertDataAsset(local.db, {
      sourceRootId: sourceRoot.id,
      patientId: null,
      subjectCode: 'sub01',
      sourceSubjectCode: 'sub01',
      subjectName: '患者sub01',
      cohort: 'patient',
      stage: '基线',
      assetType: 'raw_eeg_cnt',
      filePath: 'F:\\CJZFile\\EEG_M1\\Patient_tACS_M1_EEG\\基线\\sub01患者\\patient.cnt',
      backupPath: null,
      fileSize: 100,
      fileHash: '',
      existsOnDisk: true,
      matchStatus: 'matched',
    });
    upsertDataAsset(local.db, {
      sourceRootId: sourceRoot.id,
      patientId: null,
      subjectCode: 'sub01',
      sourceSubjectCode: 'sub01',
      subjectName: '健康sub01',
      cohort: 'health',
      stage: '不适用',
      assetType: 'raw_eeg_cnt',
      filePath: 'F:\\CJZFile\\EEG_M1\\Health_tACS_M1_EEG\\sub01健康\\health.cnt',
      backupPath: null,
      fileSize: 100,
      fileHash: '',
      existsOnDisk: true,
      matchStatus: 'matched',
    });

    const summary = listPatientAssetSummary(local.db);

    expect(summary).toHaveLength(2);
    expect(summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patientId: null,
          subjectCode: 'sub01',
          cohort: 'patient',
          baselineRawCount: 1,
          issueCount: 0,
        }),
        expect.objectContaining({
          patientId: null,
          subjectCode: 'sub01',
          cohort: 'health',
          baselineRawCount: 0,
          issueCount: 0,
        }),
      ]),
    );
  });
});
