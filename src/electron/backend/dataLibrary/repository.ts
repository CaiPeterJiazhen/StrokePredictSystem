import { randomUUID } from 'node:crypto';
import type { Database } from 'sql.js';
import type {
  BackendPatient,
  ClinicalMetrics,
  DataAsset,
  DataAssetMatchStatus,
  DataCompleteness,
  DataLibraryStatus,
  DataLibrarySummaryRow,
  PatientDocumentDetail,
  ResolveManualAssetMatchResult,
  SourceRoot,
} from '../../../domain/backendTypes.js';
import { nowIso } from '../database.js';

type SqlParam = string | number | null;
type SqlRow = Record<string, unknown>;

export type UpsertSourceRootInput = {
  projectName: string;
  rootPath: string;
  status: SourceRoot['status'];
  lastScannedAt?: string | null;
};

export type UpsertDataAssetInput = Omit<DataAsset, 'id' | 'indexedAt' | 'lastCheckedAt'>;
export type UpsertClinicalMetricsInput = Omit<ClinicalMetrics, 'updatedAt'>;
export type UpsertDataCompletenessInput = Omit<DataCompleteness, 'updatedAt'>;

function queryAll<T extends SqlRow>(db: Database, sql: string, params: SqlParam[] = []): T[] {
  const stmt = db.prepare(sql);

  try {
    stmt.bind(params);
    const rows: T[] = [];

    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }

    return rows;
  } finally {
    stmt.free();
  }
}

function queryOne<T extends SqlRow>(db: Database, sql: string, params: SqlParam[] = []): T | null {
  return queryAll<T>(db, sql, params)[0] ?? null;
}

function run(db: Database, sql: string, params: SqlParam[] = []): void {
  db.run(sql, params);
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function sourceRootFromRow(row: {
  id: string;
  project_name: string;
  root_path: string;
  status: SourceRoot['status'];
  last_scanned_at: string | null;
  created_at: string;
  updated_at: string;
}): SourceRoot {
  return {
    id: row.id,
    projectName: row.project_name,
    rootPath: row.root_path,
    status: row.status,
    lastScannedAt: row.last_scanned_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dataAssetFromRow(row: {
  id: string;
  source_root_id: string;
  patient_id: string | null;
  subject_code: string;
  source_subject_code: string;
  subject_name: string;
  cohort: DataAsset['cohort'];
  stage: DataAsset['stage'];
  asset_type: DataAsset['assetType'];
  file_path: string;
  backup_path: string | null;
  file_size: number;
  file_hash: string;
  exists_on_disk: number;
  match_status: DataAssetMatchStatus;
  indexed_at: string;
  last_checked_at: string;
}): DataAsset {
  return {
    id: row.id,
    sourceRootId: row.source_root_id,
    patientId: row.patient_id,
    subjectCode: row.subject_code,
    sourceSubjectCode: row.source_subject_code,
    subjectName: row.subject_name,
    cohort: row.cohort,
    stage: row.stage,
    assetType: row.asset_type,
    filePath: row.file_path,
    backupPath: row.backup_path,
    fileSize: row.file_size,
    fileHash: row.file_hash,
    existsOnDisk: row.exists_on_disk === 1,
    matchStatus: row.match_status,
    indexedAt: row.indexed_at,
    lastCheckedAt: row.last_checked_at,
  };
}

function clinicalMetricsFromRow(row: {
  patient_id: string;
  source_workbook: string;
  disease_course: string;
  affected_side_raw: string;
  fma_before: number | null;
  fma_after: number | null;
  mbi_before: number | null;
  mbi_after: number | null;
  bbt_before: string;
  bbt_after: string;
  mmse: number | null;
  missing_data: string;
  dropout_reason: string;
  mri_count: number | null;
  updated_at: string;
}): ClinicalMetrics {
  return {
    patientId: row.patient_id,
    sourceWorkbook: row.source_workbook,
    diseaseCourse: row.disease_course,
    affectedSideRaw: row.affected_side_raw,
    fmaBefore: row.fma_before,
    fmaAfter: row.fma_after,
    mbiBefore: row.mbi_before,
    mbiAfter: row.mbi_after,
    bbtBefore: row.bbt_before,
    bbtAfter: row.bbt_after,
    mmse: row.mmse,
    missingData: row.missing_data,
    dropoutReason: row.dropout_reason,
    mriCount: row.mri_count,
    updatedAt: row.updated_at,
  };
}

function dataCompletenessFromRow(row: {
  patient_id: string | null;
  subject_code: string;
  stage: DataCompleteness['stage'];
  task: DataCompleteness['task'];
  raw_cnt_count: number;
  processed_set_count: number;
  processed_fdt_count: number;
  set_fdt_pair_status: DataCompleteness['setFdtPairStatus'];
  workbook_status: DataCompleteness['workbookStatus'];
  computed_status: DataCompleteness['computedStatus'];
  updated_at: string;
}): DataCompleteness {
  return {
    patientId: row.patient_id,
    subjectCode: row.subject_code,
    stage: row.stage,
    task: row.task,
    rawCntCount: row.raw_cnt_count,
    processedSetCount: row.processed_set_count,
    processedFdtCount: row.processed_fdt_count,
    setFdtPairStatus: row.set_fdt_pair_status,
    workbookStatus: row.workbook_status,
    computedStatus: row.computed_status,
    updatedAt: row.updated_at,
  };
}

function patientFromRow(row: {
  id: string;
  subject_code: string;
  name: string;
  age: number | null;
  sex: BackendPatient['sex'];
  diagnosis: string;
  affected_hand: BackendPatient['affectedHand'];
  notes: string;
  created_at: string;
  updated_at: string;
}): BackendPatient {
  return {
    id: row.id,
    subjectCode: row.subject_code,
    name: row.name,
    age: row.age,
    sex: row.sex,
    diagnosis: row.diagnosis,
    affectedHand: row.affected_hand,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getSourceRootById(db: Database, id: string): SourceRoot | null {
  const row = queryOne<Parameters<typeof sourceRootFromRow>[0]>(
    db,
    `SELECT id, project_name, root_path, status, last_scanned_at, created_at, updated_at
     FROM source_roots
     WHERE id = ?`,
    [id],
  );

  return row ? sourceRootFromRow(row) : null;
}

export function upsertSourceRoot(db: Database, input: UpsertSourceRootInput): SourceRoot {
  const existing = queryOne<{ id: string; created_at: string }>(db, 'SELECT id, created_at FROM source_roots WHERE root_path = ?', [
    input.rootPath,
  ]);
  const timestamp = nowIso();
  const id = existing?.id ?? randomUUID();

  if (existing) {
    run(
      db,
      `UPDATE source_roots
       SET project_name = ?, status = ?, last_scanned_at = ?, updated_at = ?
       WHERE id = ?`,
      [input.projectName, input.status, input.lastScannedAt ?? null, timestamp, id],
    );
  } else {
    run(
      db,
      `INSERT INTO source_roots (id, project_name, root_path, status, last_scanned_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.projectName, input.rootPath, input.status, input.lastScannedAt ?? null, timestamp, timestamp],
    );
  }

  const sourceRoot = getSourceRootById(db, id);
  if (!sourceRoot) {
    throw new Error('Failed to upsert source root.');
  }

  return sourceRoot;
}

export function listSourceRoots(db: Database): SourceRoot[] {
  return queryAll<Parameters<typeof sourceRootFromRow>[0]>(
    db,
    `SELECT id, project_name, root_path, status, last_scanned_at, created_at, updated_at
     FROM source_roots
     ORDER BY created_at ASC, root_path ASC`,
  ).map(sourceRootFromRow);
}

export function markSourceRootScanned(db: Database, sourceRootId: string): void {
  const timestamp = nowIso();
  run(db, 'UPDATE source_roots SET last_scanned_at = ?, updated_at = ? WHERE id = ?', [
    timestamp,
    timestamp,
    sourceRootId,
  ]);
}

export function getDataLibraryStatus(db: Database): DataLibraryStatus {
  const sourceRootRow = queryOne<Parameters<typeof sourceRootFromRow>[0]>(
    db,
    `SELECT id, project_name, root_path, status, last_scanned_at, created_at, updated_at
     FROM source_roots
     ORDER BY updated_at DESC
     LIMIT 1`,
  );
  const counts = queryOne<{
    indexed_files: number;
    missing_files: number;
    backed_up_documents: number;
    manual_review_items: number;
  }>(
    db,
    `SELECT
      COUNT(*) AS indexed_files,
      SUM(CASE WHEN exists_on_disk = 0 THEN 1 ELSE 0 END) AS missing_files,
      SUM(CASE WHEN backup_path IS NOT NULL AND backup_path != '' THEN 1 ELSE 0 END) AS backed_up_documents,
      SUM(CASE WHEN match_status = 'needs_review' THEN 1 ELSE 0 END) AS manual_review_items
     FROM data_assets`,
  );
  const sourceRoot = sourceRootRow ? sourceRootFromRow(sourceRootRow) : null;

  return {
    sourceRoot,
    indexedFiles: Number(counts?.indexed_files ?? 0),
    missingFiles: Number(counts?.missing_files ?? 0),
    backedUpDocuments: Number(counts?.backed_up_documents ?? 0),
    manualReviewItems: Number(counts?.manual_review_items ?? 0),
    lastScanMessage: sourceRoot?.lastScannedAt ? `Last scanned at ${sourceRoot.lastScannedAt}` : 'No data library scan yet',
  };
}

export function upsertDataAsset(db: Database, input: UpsertDataAssetInput): DataAsset {
  const existing = queryOne<{ id: string; indexed_at: string }>(
    db,
    'SELECT id, indexed_at FROM data_assets WHERE source_root_id = ? AND file_path = ?',
    [input.sourceRootId, input.filePath],
  );
  const timestamp = nowIso();
  const id = existing?.id ?? randomUUID();

  if (existing) {
    run(
      db,
      `UPDATE data_assets
       SET patient_id = ?, subject_code = ?, source_subject_code = ?, subject_name = ?, cohort = ?, stage = ?,
        asset_type = ?, backup_path = ?, file_size = ?, file_hash = ?, exists_on_disk = ?, match_status = ?,
        last_checked_at = ?
       WHERE id = ?`,
      [
        input.patientId,
        input.subjectCode,
        input.sourceSubjectCode,
        input.subjectName,
        input.cohort,
        input.stage,
        input.assetType,
        input.backupPath,
        input.fileSize,
        input.fileHash,
        input.existsOnDisk ? 1 : 0,
        input.matchStatus,
        timestamp,
        id,
      ],
    );
  } else {
    run(
      db,
      `INSERT INTO data_assets (
        id, source_root_id, patient_id, subject_code, source_subject_code, subject_name, cohort, stage,
        asset_type, file_path, backup_path, file_size, file_hash, exists_on_disk, match_status, indexed_at,
        last_checked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.sourceRootId,
        input.patientId,
        input.subjectCode,
        input.sourceSubjectCode,
        input.subjectName,
        input.cohort,
        input.stage,
        input.assetType,
        input.filePath,
        input.backupPath,
        input.fileSize,
        input.fileHash,
        input.existsOnDisk ? 1 : 0,
        input.matchStatus,
        timestamp,
        timestamp,
      ],
    );
  }

  const asset = queryOne<Parameters<typeof dataAssetFromRow>[0]>(
    db,
    `SELECT id, source_root_id, patient_id, subject_code, source_subject_code, subject_name, cohort, stage,
      asset_type, file_path, backup_path, file_size, file_hash, exists_on_disk, match_status, indexed_at,
      last_checked_at
     FROM data_assets
     WHERE id = ?`,
    [id],
  );

  if (!asset) {
    throw new Error('Failed to upsert data asset.');
  }

  return dataAssetFromRow(asset);
}

export function upsertClinicalMetrics(db: Database, input: UpsertClinicalMetricsInput): ClinicalMetrics {
  const timestamp = nowIso();
  run(
    db,
    `INSERT INTO clinical_metrics (
      patient_id, source_workbook, disease_course, affected_side_raw, fma_before, fma_after, mbi_before, mbi_after,
      bbt_before, bbt_after, mmse, missing_data, dropout_reason, mri_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(patient_id, source_workbook) DO UPDATE SET
      disease_course = excluded.disease_course,
      affected_side_raw = excluded.affected_side_raw,
      fma_before = excluded.fma_before,
      fma_after = excluded.fma_after,
      mbi_before = excluded.mbi_before,
      mbi_after = excluded.mbi_after,
      bbt_before = excluded.bbt_before,
      bbt_after = excluded.bbt_after,
      mmse = excluded.mmse,
      missing_data = excluded.missing_data,
      dropout_reason = excluded.dropout_reason,
      mri_count = excluded.mri_count,
      updated_at = excluded.updated_at`,
    [
      input.patientId,
      input.sourceWorkbook,
      input.diseaseCourse,
      input.affectedSideRaw,
      input.fmaBefore,
      input.fmaAfter,
      input.mbiBefore,
      input.mbiAfter,
      input.bbtBefore,
      input.bbtAfter,
      input.mmse,
      input.missingData,
      input.dropoutReason,
      input.mriCount,
      timestamp,
    ],
  );

  const metrics = queryOne<Parameters<typeof clinicalMetricsFromRow>[0]>(
    db,
    `SELECT patient_id, source_workbook, disease_course, affected_side_raw, fma_before, fma_after, mbi_before,
      mbi_after, bbt_before, bbt_after, mmse, missing_data, dropout_reason, mri_count, updated_at
     FROM clinical_metrics
     WHERE patient_id = ? AND source_workbook = ?`,
    [input.patientId, input.sourceWorkbook],
  );

  if (!metrics) {
    throw new Error('Failed to upsert clinical metrics.');
  }

  return clinicalMetricsFromRow(metrics);
}

export function upsertDataCompleteness(db: Database, input: UpsertDataCompletenessInput): DataCompleteness {
  const timestamp = nowIso();
  run(
    db,
    `INSERT INTO data_completeness (
      patient_id, subject_code, stage, task, raw_cnt_count, processed_set_count, processed_fdt_count,
      set_fdt_pair_status, workbook_status, computed_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(subject_code, stage, task) DO UPDATE SET
      patient_id = excluded.patient_id,
      raw_cnt_count = excluded.raw_cnt_count,
      processed_set_count = excluded.processed_set_count,
      processed_fdt_count = excluded.processed_fdt_count,
      set_fdt_pair_status = excluded.set_fdt_pair_status,
      workbook_status = excluded.workbook_status,
      computed_status = excluded.computed_status,
      updated_at = excluded.updated_at`,
    [
      input.patientId,
      input.subjectCode,
      input.stage,
      input.task,
      input.rawCntCount,
      input.processedSetCount,
      input.processedFdtCount,
      input.setFdtPairStatus,
      input.workbookStatus,
      input.computedStatus,
      timestamp,
    ],
  );

  const completeness = queryOne<Parameters<typeof dataCompletenessFromRow>[0]>(
    db,
    `SELECT patient_id, subject_code, stage, task, raw_cnt_count, processed_set_count, processed_fdt_count,
      set_fdt_pair_status, workbook_status, computed_status, updated_at
     FROM data_completeness
     WHERE subject_code = ? AND stage = ? AND task = ?`,
    [input.subjectCode, input.stage, input.task],
  );

  if (!completeness) {
    throw new Error('Failed to upsert data completeness.');
  }

  return dataCompletenessFromRow(completeness);
}

export function listDataAssets(
  db: Database,
  filter: { patientId?: string; sourceRootId?: string; matchStatus?: DataAssetMatchStatus } = {},
): DataAsset[] {
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (filter.patientId) {
    where.push('patient_id = ?');
    params.push(filter.patientId);
  }

  if (filter.sourceRootId) {
    where.push('source_root_id = ?');
    params.push(filter.sourceRootId);
  }

  if (filter.matchStatus) {
    where.push('match_status = ?');
    params.push(filter.matchStatus);
  }

  const rows = queryAll<Parameters<typeof dataAssetFromRow>[0]>(
    db,
    `SELECT id, source_root_id, patient_id, subject_code, source_subject_code, subject_name, cohort, stage,
      asset_type, file_path, backup_path, file_size, file_hash, exists_on_disk, match_status, indexed_at,
      last_checked_at
     FROM data_assets
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY subject_code, stage, asset_type, file_path`,
    params,
  );

  return rows.map(dataAssetFromRow);
}

export function resolveManualAssetMatch(
  db: Database,
  assetId: string,
  patientId: string,
): ResolveManualAssetMatchResult {
  const asset = queryOne<Parameters<typeof dataAssetFromRow>[0]>(
    db,
    `SELECT id, source_root_id, patient_id, subject_code, source_subject_code, subject_name, cohort, stage,
      asset_type, file_path, backup_path, file_size, file_hash, exists_on_disk, match_status, indexed_at,
      last_checked_at
     FROM data_assets
     WHERE id = ?`,
    [assetId],
  );

  if (!asset) {
    return { ok: false, message: '未找到需要匹配的资产。', asset: null };
  }

  const patient = queryOne<Parameters<typeof patientFromRow>[0]>(
    db,
    `SELECT id, subject_code, name, age, sex, diagnosis, affected_hand, notes, created_at, updated_at
     FROM patients
     WHERE id = ?`,
    [patientId],
  );

  if (!patient) {
    return { ok: false, message: '未找到目标患者。', asset: null };
  }

  const timestamp = nowIso();
  run(
    db,
    `UPDATE data_assets
     SET patient_id = ?, subject_code = ?, subject_name = ?, cohort = 'patient',
      match_status = 'matched', last_checked_at = ?
     WHERE id = ?`,
    [patient.id, patient.subject_code, patient.name, timestamp, assetId],
  );

  const resolved = queryOne<Parameters<typeof dataAssetFromRow>[0]>(
    db,
    `SELECT id, source_root_id, patient_id, subject_code, source_subject_code, subject_name, cohort, stage,
      asset_type, file_path, backup_path, file_size, file_hash, exists_on_disk, match_status, indexed_at,
      last_checked_at
     FROM data_assets
     WHERE id = ?`,
    [assetId],
  );

  return {
    ok: true,
    message: `已将资产匹配到患者 ${patient.subject_code}。`,
    asset: resolved ? dataAssetFromRow(resolved) : null,
  };
}

export function listPatientAssetSummary(db: Database): DataLibrarySummaryRow[] {
  const rows = queryAll<{
    patient_id: string | null;
    subject_code: string;
    subject_name: string;
    cohort: DataAsset['cohort'];
    has_clinical_info: number;
    has_record_pdf: number;
    baseline_raw_count: number;
    baseline_set_count: number;
    baseline_fdt_count: number;
    immediate_set_count: number;
    immediate_fdt_count: number;
    phase_set_count: number;
    phase_fdt_count: number;
    final_set_count: number;
    final_fdt_count: number;
    missing_count: number;
    review_count: number;
    unmatched_count: number;
  }>(
    db,
    `WITH clinical AS (
      SELECT patient_id, 1 AS has_clinical_info
      FROM clinical_metrics
      GROUP BY patient_id
     )
     SELECT
      p.id AS patient_id,
      p.subject_code AS subject_code,
      p.name AS subject_name,
      'patient' AS cohort,
      MAX(CASE WHEN cm.patient_id IS NOT NULL THEN 1 ELSE 0 END) AS has_clinical_info,
      MAX(CASE WHEN da.asset_type = 'record_pdf' THEN 1 ELSE 0 END) AS has_record_pdf,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '基线' AND da.asset_type = 'raw_eeg_cnt' THEN 1 ELSE 0 END) AS baseline_raw_count,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '基线' AND da.asset_type = 'processed_eeg_set' THEN 1 ELSE 0 END) AS baseline_set_count,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '基线' AND da.asset_type = 'processed_eeg_fdt' THEN 1 ELSE 0 END) AS baseline_fdt_count,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '即时' AND da.asset_type = 'processed_eeg_set' THEN 1 ELSE 0 END) AS immediate_set_count,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '即时' AND da.asset_type = 'processed_eeg_fdt' THEN 1 ELSE 0 END) AS immediate_fdt_count,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '阶段' AND da.asset_type = 'processed_eeg_set' THEN 1 ELSE 0 END) AS phase_set_count,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '阶段' AND da.asset_type = 'processed_eeg_fdt' THEN 1 ELSE 0 END) AS phase_fdt_count,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '最终' AND da.asset_type = 'processed_eeg_set' THEN 1 ELSE 0 END) AS final_set_count,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '最终' AND da.asset_type = 'processed_eeg_fdt' THEN 1 ELSE 0 END) AS final_fdt_count,
      SUM(CASE WHEN da.exists_on_disk = 0 THEN 1 ELSE 0 END) AS missing_count,
      SUM(CASE WHEN da.match_status = 'needs_review' THEN 1 ELSE 0 END) AS review_count,
      SUM(CASE WHEN da.match_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched_count
     FROM patients p
     LEFT JOIN data_assets da ON da.patient_id = p.id
     LEFT JOIN clinical cm ON cm.patient_id = p.id
     GROUP BY p.id, p.subject_code, p.name
     UNION ALL
     SELECT
      da.patient_id,
      da.subject_code,
      COALESCE(NULLIF(MAX(da.subject_name), ''), MAX(p.name), '') AS subject_name,
      da.cohort AS cohort,
      MAX(CASE WHEN cm.patient_id IS NOT NULL THEN 1 ELSE 0 END) AS has_clinical_info,
      MAX(CASE WHEN da.asset_type = 'record_pdf' THEN 1 ELSE 0 END) AS has_record_pdf,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '基线' AND da.asset_type = 'raw_eeg_cnt' THEN 1 ELSE 0 END) AS baseline_raw_count,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '基线' AND da.asset_type = 'processed_eeg_set' THEN 1 ELSE 0 END) AS baseline_set_count,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '基线' AND da.asset_type = 'processed_eeg_fdt' THEN 1 ELSE 0 END) AS baseline_fdt_count,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '即时' AND da.asset_type = 'processed_eeg_set' THEN 1 ELSE 0 END) AS immediate_set_count,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '即时' AND da.asset_type = 'processed_eeg_fdt' THEN 1 ELSE 0 END) AS immediate_fdt_count,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '阶段' AND da.asset_type = 'processed_eeg_set' THEN 1 ELSE 0 END) AS phase_set_count,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '阶段' AND da.asset_type = 'processed_eeg_fdt' THEN 1 ELSE 0 END) AS phase_fdt_count,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '最终' AND da.asset_type = 'processed_eeg_set' THEN 1 ELSE 0 END) AS final_set_count,
      SUM(CASE WHEN da.exists_on_disk = 1 AND da.stage = '最终' AND da.asset_type = 'processed_eeg_fdt' THEN 1 ELSE 0 END) AS final_fdt_count,
      SUM(CASE WHEN da.exists_on_disk = 0 THEN 1 ELSE 0 END) AS missing_count,
      SUM(CASE WHEN da.match_status = 'needs_review' THEN 1 ELSE 0 END) AS review_count,
      SUM(CASE WHEN da.match_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched_count
     FROM data_assets da
     LEFT JOIN patients p ON p.id = da.patient_id
     LEFT JOIN clinical cm ON cm.patient_id = da.patient_id
     WHERE da.cohort <> 'patient'
      OR (
        da.cohort = 'patient'
        AND da.patient_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM patients p2
          WHERE p2.subject_code = da.subject_code
        )
      )
     GROUP BY COALESCE(da.patient_id, ''), da.subject_code, da.cohort
     ORDER BY subject_code, cohort`,
  );

  return rows.map((row) => {
    const issueCount = Number(row.missing_count) + Number(row.review_count) + Number(row.unmatched_count);
    const matchStatus: DataAssetMatchStatus =
      Number(row.review_count) > 0 ? 'needs_review' : Number(row.unmatched_count) > 0 ? 'unmatched' : 'matched';

    return {
      patientId: row.patient_id,
      subjectCode: row.subject_code,
      subjectName: row.subject_name,
      cohort: row.cohort,
      hasClinicalInfo: row.has_clinical_info === 1,
      hasRecordPdf: row.has_record_pdf === 1,
      baselineRawCount: Number(row.baseline_raw_count),
      baselineProcessedPairs: Math.min(Number(row.baseline_set_count), Number(row.baseline_fdt_count)),
      immediateProcessedPairs: Math.min(Number(row.immediate_set_count), Number(row.immediate_fdt_count)),
      phaseProcessedPairs: Math.min(Number(row.phase_set_count), Number(row.phase_fdt_count)),
      finalProcessedPairs: Math.min(Number(row.final_set_count), Number(row.final_fdt_count)),
      completenessScore: issueCount === 0 ? '完整' : '需复核',
      issueCount,
      matchStatus,
    };
  });
}

export function getPatientDocumentDetail(db: Database, patientId: string): PatientDocumentDetail {
  const patientRow = queryOne<Parameters<typeof patientFromRow>[0]>(
    db,
    `SELECT id, subject_code, name, age, sex, diagnosis, affected_hand, notes, created_at, updated_at
     FROM patients
     WHERE id = ?`,
    [patientId],
  );
  const clinicalRow = queryOne<Parameters<typeof clinicalMetricsFromRow>[0]>(
    db,
    `SELECT patient_id, source_workbook, disease_course, affected_side_raw, fma_before, fma_after, mbi_before,
      mbi_after, bbt_before, bbt_after, mmse, missing_data, dropout_reason, mri_count, updated_at
     FROM clinical_metrics
     WHERE patient_id = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [patientId],
  );
  const assets = listDataAssets(db, { patientId });
  const completeness = queryAll<Parameters<typeof dataCompletenessFromRow>[0]>(
    db,
    `SELECT patient_id, subject_code, stage, task, raw_cnt_count, processed_set_count, processed_fdt_count,
      set_fdt_pair_status, workbook_status, computed_status, updated_at
     FROM data_completeness
     WHERE patient_id = ?
     ORDER BY stage, task`,
    [patientId],
  ).map(dataCompletenessFromRow);
  const warnings: string[] = [];

  for (const asset of assets) {
    if (!asset.existsOnDisk) {
      warnings.push(`文件缺失: ${asset.filePath}`);
    }
    if (asset.matchStatus !== 'matched') {
      warnings.push(`资产需要复核: ${asset.filePath}`);
    }
  }

  for (const item of completeness) {
    if (item.computedStatus !== 'complete') {
      warnings.push(`${item.subjectCode} ${item.stage} ${item.task} 完整性为 ${item.computedStatus}`);
    } else if (item.setFdtPairStatus !== 'complete' && item.setFdtPairStatus !== 'not_applicable') {
      warnings.push(`${item.subjectCode} ${item.stage} ${item.task} 配对状态为 ${item.setFdtPairStatus}`);
    }
  }

  return {
    patient: patientRow ? patientFromRow(patientRow) : null,
    clinicalMetrics: clinicalRow ? clinicalMetricsFromRow(clinicalRow) : null,
    assets,
    completeness,
    warnings,
  };
}
