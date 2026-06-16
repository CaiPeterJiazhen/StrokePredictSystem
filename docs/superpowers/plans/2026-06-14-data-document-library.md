# Data And Document Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old standalone batch-import entry with a `数据与文档库` module that imports patient information from `EEG_M1`, backs up small clinical documents, and indexes large EEG files by path.

**Architecture:** Keep the existing React/Electron/sql.js architecture. Add focused data-library backend modules under `src/electron/backend/dataLibrary`, expose them through the existing narrow preload bridge, and render a patient-centered `DataLibraryView` from `src/App.tsx` while keeping browser mock fallback.

**Tech Stack:** React, TypeScript, Vite, Electron, `sql.js`, `exceljs`, Node filesystem APIs, Vitest, React Testing Library.

---

## Scope

This plan implements:

- `数据与文档库` replacing the old `批次与导入` navigation entry.
- Batch import as an action inside `数据与文档库`.
- Excel `.xlsx` clinical import for the observed `EEG_M1` workbooks.
- Patient PDF/Excel backup into `Documents\StrokePredictSystem\backups\clinical_docs`.
- Large `.cnt/.set/.fdt` EEG files indexed by original path only.
- Patient-level document and EEG completeness summaries.
- Manual-review status for ambiguous or unmatched assets.

This plan does not implement:

- MATLAB/EEGLAB execution.
- Feature generation.
- Prediction.
- Editing Excel/PDF content.
- Copying large EEG data into the app data directory.

## File Structure

Create:

- `src/electron/backend/dataLibrary/subjectIds.ts`: subject-code extraction and normalization.
- `src/electron/backend/dataLibrary/pathClassifier.ts`: classify source paths into cohort, stage, asset type, subject, and name.
- `src/electron/backend/dataLibrary/excelParsers.ts`: parse `EEG_M1` clinical and completeness workbooks.
- `src/electron/backend/dataLibrary/documentBackup.ts`: copy small clinical files into the app backup directory and compute hashes.
- `src/electron/backend/dataLibrary/repository.ts`: source root, asset, clinical metrics, completeness, and summary queries.
- `src/electron/backend/dataLibrary/scanAndImport.ts`: orchestrate scanning, Excel import, document backup, EEG indexing, and task logging.
- `src/features/dataLibrary/DataLibraryView.tsx`: React view for the data and document library.
- `tests/electron/backend/dataLibrary/subjectIds.test.ts`
- `tests/electron/backend/dataLibrary/pathClassifier.test.ts`
- `tests/electron/backend/dataLibrary/excelParsers.test.ts`
- `tests/electron/backend/dataLibrary/documentBackup.test.ts`
- `tests/electron/backend/dataLibrary/scanAndImport.test.ts`
- `tests/features/dataLibrary.test.tsx`

Modify:

- `package.json`: add `exceljs`.
- `src/domain/backendTypes.ts`: add data-library DTOs and task type.
- `src/electron/backend/appPaths.ts`: add backup directory paths.
- `src/electron/backend/database.ts`: add migrations.
- `src/electron/backend/ipcHandlers.ts`: register data-library IPC handlers.
- `src/electron/preload.ts`: expose safe data-library functions.
- `src/services/apiClient.ts`: add renderer service functions and browser fallback.
- `src/App.tsx`: replace `batch` navigation with `dataLibrary`, route to `DataLibraryView`.
- `tests/electron/backend/database.test.ts`: assert new tables and backup paths.
- `tests/electron/backend/ipcHandlers.test.ts`: assert new IPC channels.
- `tests/electron/preload.test.ts`: assert new preload functions.
- `tests/services/apiClient.test.ts`: assert bridge forwarding and fallback.

## Task 1: Dependencies, Paths, And Shared DTOs

**Files:**

- Modify: `package.json`
- Modify: `src/electron/backend/appPaths.ts`
- Modify: `src/domain/backendTypes.ts`
- Modify: `tests/electron/backend/database.test.ts`
- Modify: `tests/services/apiClient.test.ts`

- [ ] **Step 1: Add Excel parser dependency**

Run:

```powershell
npm install exceljs
```

Expected:

- `package.json` includes `"exceljs"`.
- `package-lock.json` is updated.
- No native build step is required.

- [ ] **Step 2: Write failing app path test for clinical backup directories**

Add this assertion to `tests/electron/backend/database.test.ts` inside the database initialization test after existing directory assertions:

```ts
expect(fs.existsSync(path.join(root, 'backups', 'clinical_docs'))).toBe(true);
expect(fs.existsSync(path.join(root, 'backups', 'clinical_docs', 'pdf'))).toBe(true);
expect(fs.existsSync(path.join(root, 'backups', 'clinical_docs', 'excel'))).toBe(true);
```

Run:

```powershell
npm run test -- tests/electron/backend/database.test.ts
```

Expected before implementation:

- FAIL because backup directories are not created yet.

- [ ] **Step 3: Extend `AppPaths`**

Modify `src/electron/backend/appPaths.ts` so `AppPaths` includes:

```ts
export interface AppPaths {
  dataRoot: string;
  databasePath: string;
  outputsRoot: string;
  logsRoot: string;
  backupsRoot: string;
  clinicalDocsBackupRoot: string;
}
```

Update `ensureAppPaths` to define and create:

```ts
const backupsRoot = path.join(dataRoot, 'backups');
const clinicalDocsBackupRoot = path.join(backupsRoot, 'clinical_docs');
const requiredDirs = [
  dataRoot,
  outputsRoot,
  path.join(outputsRoot, 'preprocess'),
  path.join(outputsRoot, 'features'),
  path.join(outputsRoot, 'predictions'),
  path.join(outputsRoot, 'reports'),
  logsRoot,
  backupsRoot,
  clinicalDocsBackupRoot,
  path.join(clinicalDocsBackupRoot, 'pdf'),
  path.join(clinicalDocsBackupRoot, 'excel'),
];
```

Return the new paths:

```ts
return {
  dataRoot,
  databasePath: path.join(dataRoot, 'app.db'),
  outputsRoot,
  logsRoot,
  backupsRoot,
  clinicalDocsBackupRoot,
};
```

- [ ] **Step 4: Add data-library DTOs**

Append these definitions to `src/domain/backendTypes.ts`:

```ts
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
```

Update `BackendTask['type']` union to include:

```ts
| 'data_library_scan'
| 'data_library_backup'
```

- [ ] **Step 5: Verify Task 1**

Run:

```powershell
npm run test -- tests/electron/backend/database.test.ts
npm run build
```

Expected after implementation:

- `database.test.ts` passes.
- `npm run build` passes.

## Task 2: Database Tables And Repository Boundaries

**Files:**

- Modify: `src/electron/backend/database.ts`
- Create: `src/electron/backend/dataLibrary/repository.ts`
- Create: `tests/electron/backend/dataLibrary/repository.test.ts`
- Modify: `tests/electron/backend/database.test.ts`

- [ ] **Step 1: Write failing migration test**

In `tests/electron/backend/database.test.ts`, add table expectations to the existing `tables` assertions:

```ts
expect(tables).toContain('source_roots');
expect(tables).toContain('data_assets');
expect(tables).toContain('clinical_metrics');
expect(tables).toContain('data_completeness');
```

Run:

```powershell
npm run test -- tests/electron/backend/database.test.ts
```

Expected before implementation:

- FAIL because new tables do not exist.

- [ ] **Step 2: Add database migrations**

Append these migrations to the `migrations` array in `src/electron/backend/database.ts`:

```ts
`CREATE TABLE IF NOT EXISTS source_roots (
  id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  last_scanned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS data_assets (
  id TEXT PRIMARY KEY,
  source_root_id TEXT NOT NULL,
  patient_id TEXT,
  subject_code TEXT NOT NULL DEFAULT '',
  source_subject_code TEXT NOT NULL DEFAULT '',
  subject_name TEXT NOT NULL DEFAULT '',
  cohort TEXT NOT NULL,
  stage TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  backup_path TEXT,
  file_size INTEGER NOT NULL,
  file_hash TEXT NOT NULL DEFAULT '',
  exists_on_disk INTEGER NOT NULL,
  match_status TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  UNIQUE(source_root_id, file_path),
  FOREIGN KEY(source_root_id) REFERENCES source_roots(id) ON DELETE CASCADE,
  FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE SET NULL
)`,
`CREATE TABLE IF NOT EXISTS clinical_metrics (
  patient_id TEXT NOT NULL,
  source_workbook TEXT NOT NULL,
  disease_course TEXT NOT NULL DEFAULT '',
  affected_side_raw TEXT NOT NULL DEFAULT '',
  fma_before REAL,
  fma_after REAL,
  mbi_before REAL,
  mbi_after REAL,
  bbt_before TEXT NOT NULL DEFAULT '',
  bbt_after TEXT NOT NULL DEFAULT '',
  mmse REAL,
  missing_data TEXT NOT NULL DEFAULT '',
  dropout_reason TEXT NOT NULL DEFAULT '',
  mri_count REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(patient_id, source_workbook),
  FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
)`,
`CREATE TABLE IF NOT EXISTS data_completeness (
  patient_id TEXT,
  subject_code TEXT NOT NULL,
  stage TEXT NOT NULL,
  task TEXT NOT NULL,
  raw_cnt_count INTEGER NOT NULL,
  processed_set_count INTEGER NOT NULL,
  processed_fdt_count INTEGER NOT NULL,
  set_fdt_pair_status TEXT NOT NULL,
  workbook_status TEXT,
  computed_status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(subject_code, stage, task),
  FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE SET NULL
)`,
'CREATE INDEX IF NOT EXISTS idx_data_assets_subject ON data_assets(subject_code, cohort, stage)',
'CREATE INDEX IF NOT EXISTS idx_data_assets_patient ON data_assets(patient_id)',
'CREATE INDEX IF NOT EXISTS idx_data_assets_match ON data_assets(match_status)',
'CREATE INDEX IF NOT EXISTS idx_data_completeness_patient ON data_completeness(patient_id)'
```

- [ ] **Step 3: Write repository tests**

Create `tests/electron/backend/dataLibrary/repository.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase, type LocalDatabase } from '../../../../src/electron/backend/database.js';
import { createPatient } from '../../../../src/electron/backend/repositories.js';
import {
  getDataLibraryStatus,
  getPatientDocumentDetail,
  listPatientAssetSummary,
  upsertClinicalMetrics,
  upsertDataAsset,
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
  it('upserts a source root, assets, clinical metrics, and summary rows', async () => {
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

    const status = getDataLibraryStatus(local.db);
    const summary = listPatientAssetSummary(local.db);
    const detail = getPatientDocumentDetail(local.db, patientId);

    expect(status.sourceRoot?.rootPath).toBe('F:\\CJZFile\\EEG_M1');
    expect(status.indexedFiles).toBe(1);
    expect(summary).toEqual([
      expect.objectContaining({
        patientId,
        subjectCode: 'sub01',
        subjectName: '穆祥贵',
        cohort: 'patient',
        hasClinicalInfo: true,
        baselineRawCount: 1,
      }),
    ]);
    expect(detail.clinicalMetrics).toEqual(expect.objectContaining({ fmaBefore: 63, fmaAfter: 65 }));
    expect(detail.assets).toHaveLength(1);
  });
});
```

Run:

```powershell
npm run test -- tests/electron/backend/dataLibrary/repository.test.ts
```

Expected before implementation:

- FAIL because repository module does not exist.

- [ ] **Step 4: Implement repository functions**

Create `src/electron/backend/dataLibrary/repository.ts` with these exports:

```ts
export type UpsertSourceRootInput = {
  projectName: string;
  rootPath: string;
  status: SourceRoot['status'];
  lastScannedAt?: string | null;
};

export type UpsertDataAssetInput = Omit<DataAsset, 'id' | 'indexedAt' | 'lastCheckedAt'>;
export type UpsertClinicalMetricsInput = Omit<ClinicalMetrics, 'updatedAt'>;
export type UpsertDataCompletenessInput = Omit<DataCompleteness, 'updatedAt'>;

export function upsertSourceRoot(db: Database, input: UpsertSourceRootInput): SourceRoot;
export function getDataLibraryStatus(db: Database): DataLibraryStatus;
export function upsertDataAsset(db: Database, input: UpsertDataAssetInput): DataAsset;
export function upsertClinicalMetrics(db: Database, input: UpsertClinicalMetricsInput): ClinicalMetrics;
export function upsertDataCompleteness(db: Database, input: UpsertDataCompletenessInput): DataCompleteness;
export function listDataAssets(db: Database, filter?: { patientId?: string; sourceRootId?: string; matchStatus?: DataAssetMatchStatus }): DataAsset[];
export function listPatientAssetSummary(db: Database): DataLibrarySummaryRow[];
export function getPatientDocumentDetail(db: Database, patientId: string): PatientDocumentDetail;
export function markSourceRootScanned(db: Database, sourceRootId: string): void;
```

Implementation requirements:

- Use `randomUUID()` for new rows.
- Use `nowIso()` from `../database.js`.
- Upsert `source_roots` by `root_path`.
- Upsert `data_assets` by `(source_root_id, file_path)`.
- Convert `snake_case` database columns into camelCase DTOs.
- `listPatientAssetSummary` should group by subject and compute counts from `data_assets`.
- `getDataLibraryStatus` should return the most recently updated source root and aggregate counts.

- [ ] **Step 5: Verify Task 2**

Run:

```powershell
npm run test -- tests/electron/backend/database.test.ts tests/electron/backend/dataLibrary/repository.test.ts
npm run build
```

Expected:

- PASS.

## Task 3: Subject ID And Path Classification

**Files:**

- Create: `src/electron/backend/dataLibrary/subjectIds.ts`
- Create: `src/electron/backend/dataLibrary/pathClassifier.ts`
- Create: `tests/electron/backend/dataLibrary/subjectIds.test.ts`
- Create: `tests/electron/backend/dataLibrary/pathClassifier.test.ts`

- [ ] **Step 1: Write failing subject ID tests**

Create `tests/electron/backend/dataLibrary/subjectIds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extractSubjectFromText, normalizeSubjectCode } from '../../../../src/electron/backend/dataLibrary/subjectIds.js';

describe('EEG_M1 subject ids', () => {
  it.each([
    ['sub01穆祥贵', 'patient', 'sub01'],
    ['sub011单庆明', 'patient', 'sub11'],
    ['sub021王宇', 'patient', 'sub21'],
    ['sub001朱卫清', 'health', 'sub001'],
    ['sub0011齐巍', 'health', 'sub0011'],
  ] as const)('normalizes %s for %s cohort', (text, cohort, expected) => {
    expect(normalizeSubjectCode(text, cohort)).toBe(expected);
  });

  it('extracts subject code and Chinese name from mixed folder names', () => {
    expect(extractSubjectFromText('sub01穆祥贵', 'patient')).toEqual({
      subjectCode: 'sub01',
      sourceSubjectCode: 'sub01',
      subjectName: '穆祥贵',
    });
    expect(extractSubjectFromText('sub23李厚强.pdf', 'patient')).toEqual({
      subjectCode: 'sub23',
      sourceSubjectCode: 'sub23',
      subjectName: '李厚强',
    });
  });
});
```

Run:

```powershell
npm run test -- tests/electron/backend/dataLibrary/subjectIds.test.ts
```

Expected before implementation:

- FAIL because `subjectIds.ts` does not exist.

- [ ] **Step 2: Implement subject ID helpers**

Create `src/electron/backend/dataLibrary/subjectIds.ts`:

```ts
import type { CohortType } from '../../../domain/backendTypes.js';

export interface ExtractedSubject {
  subjectCode: string;
  sourceSubjectCode: string;
  subjectName: string;
}

export function normalizeSubjectCode(text: string, cohort: CohortType): string {
  const match = text.match(/sub0*(\d+)/i);
  if (!match) return '';
  const rawNumber = match[1];

  if (cohort === 'health') {
    const source = text.match(/sub\d+/i)?.[0] ?? `sub${rawNumber}`;
    return source.toLowerCase();
  }

  const numeric = Number(rawNumber);
  if (!Number.isFinite(numeric)) return '';
  return `sub${String(numeric).padStart(2, '0')}`;
}

export function extractSubjectFromText(text: string, cohort: CohortType): ExtractedSubject | null {
  const sourceMatch = text.match(/sub\d+/i);
  if (!sourceMatch) return null;
  const sourceSubjectCode = sourceMatch[0].toLowerCase();
  const subjectCode = normalizeSubjectCode(sourceSubjectCode, cohort);
  const withoutExtension = text.replace(/\.[^.]+$/, '');
  const subjectName = withoutExtension
    .slice(sourceMatch.index! + sourceSubjectCode.length)
    .replace(/[-_\s]+/g, '')
    .trim();

  return {
    subjectCode,
    sourceSubjectCode,
    subjectName,
  };
}
```

- [ ] **Step 3: Write failing path classifier tests**

Create `tests/electron/backend/dataLibrary/pathClassifier.test.ts`:

```ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyDataLibraryPath } from '../../../../src/electron/backend/dataLibrary/pathClassifier.js';

const root = 'F:\\CJZFile\\EEG_M1';
const join = (...parts: string[]) => path.join(root, ...parts);

describe('EEG_M1 path classifier', () => {
  it('classifies patient raw EEG from parent folder subject id', () => {
    expect(
      classifyDataLibraryPath(root, join('Patient_tACS_M1_EEG', '基线', 'sub01穆祥贵', 'mxg1.cnt')),
    ).toEqual(
      expect.objectContaining({
        cohort: 'patient',
        stage: '基线',
        assetType: 'raw_eeg_cnt',
        subjectCode: 'sub01',
        sourceSubjectCode: 'sub01',
        subjectName: '穆祥贵',
        matchStatus: 'matched',
      }),
    );
  });

  it('classifies processed set and fdt files', () => {
    expect(
      classifyDataLibraryPath(root, join('Patient_tACS_M1_RestingStateEEG_afterProcess', '阶段', 'sub011单庆明', 'sqm2.set')),
    ).toMatchObject({ cohort: 'patient', stage: '阶段', assetType: 'processed_eeg_set', subjectCode: 'sub11' });
    expect(
      classifyDataLibraryPath(root, join('Patient_tACS_M1_RestingStateEEG_afterProcess', '阶段', 'sub011单庆明', 'sqm2.fdt')),
    ).toMatchObject({ cohort: 'patient', stage: '阶段', assetType: 'processed_eeg_fdt', subjectCode: 'sub11' });
  });

  it('keeps healthy controls separate from patient ids', () => {
    expect(
      classifyDataLibraryPath(root, join('Health-tACS-M1-RestingStateEEG', 'sub001朱卫清', 'zwc1.cnt')),
    ).toMatchObject({ cohort: 'health', stage: '不适用', assetType: 'raw_eeg_cnt', subjectCode: 'sub001' });
  });

  it('classifies project-level clinical and electrode files', () => {
    expect(classifyDataLibraryPath(root, join('M1组病历记录表.xlsx'))).toMatchObject({
      cohort: 'project',
      stage: '不适用',
      assetType: 'clinical_excel',
    });
    expect(classifyDataLibraryPath(root, join('standard_1005.ced'))).toMatchObject({
      cohort: 'project',
      assetType: 'electrode_location',
    });
  });
});
```

- [ ] **Step 4: Implement path classifier**

Create `src/electron/backend/dataLibrary/pathClassifier.ts` with:

```ts
export interface ClassifiedPath {
  cohort: CohortType;
  stage: DataAssetStage;
  assetType: DataAssetType;
  subjectCode: string;
  sourceSubjectCode: string;
  subjectName: string;
  matchStatus: DataAssetMatchStatus;
}

export function classifyDataLibraryPath(rootPath: string, filePath: string): ClassifiedPath | null;
```

Classification rules:

- `.cnt` under `Patient_tACS_M1_EEG\<stage>\<subject-folder>` -> `patient`, stage from directory, `raw_eeg_cnt`.
- `.set` under `Patient_tACS_M1_RestingStateEEG_afterProcess\<stage>\<subject-folder>` -> `processed_eeg_set`.
- `.fdt` under the same processed tree -> `processed_eeg_fdt`.
- `.cnt` under `Health-tACS-M1-RestingStateEEG\<subject-folder>` -> `health`, stage `不适用`, `raw_eeg_cnt`.
- `.set/.fdt` under `Health_tACS_M1_RestingStateEEG_afterProcess\<subject-folder>` -> health processed assets.
- `.pdf` under `患者记录本` -> `record_pdf`, patient cohort.
- `.pdf` under `健康人记录本` -> `record_pdf`, health cohort.
- `脑卒中患者信息记录表.xlsx` and `M1组病历记录表.xlsx` -> `clinical_excel`.
- `19例患者脑电数据完整性检查.xlsx` -> `completeness_workbook`.
- `.ced` -> `electrode_location`.
- `.node` -> `channel_file`.
- `.zip` -> `archive`.
- Unknown files return `null`.

- [ ] **Step 5: Verify Task 3**

Run:

```powershell
npm run test -- tests/electron/backend/dataLibrary/subjectIds.test.ts tests/electron/backend/dataLibrary/pathClassifier.test.ts
npm run build
```

Expected:

- PASS.

## Task 4: Excel Workbook Parsing

**Files:**

- Create: `src/electron/backend/dataLibrary/excelParsers.ts`
- Create: `tests/electron/backend/dataLibrary/excelParsers.test.ts`

- [ ] **Step 1: Write failing workbook parser tests**

Create `tests/electron/backend/dataLibrary/excelParsers.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  parseClinicalWorkbook,
  parseCompletenessWorkbook,
} from '../../../../src/electron/backend/dataLibrary/excelParsers.js';

const roots: string[] = [];

async function tempWorkbook(name: string, rows: unknown[][]): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-xlsx-'));
  roots.push(root);
  const filePath = path.join(root, name);
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  rows.forEach((row) => worksheet.addRow(row));
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('EEG_M1 Excel parsers', () => {
  it('parses clinical workbook with row 1 headers', async () => {
    const filePath = await tempWorkbook('M1组病历记录表.xlsx', [
      ['编号', '姓名', '年龄', '病程', '性别', '患病侧', '治疗前FMA', '治疗后FMA', '治疗前MBI', '治疗后MBI', '治疗前BBT', '治疗后BBT', 'MMSE'],
      ['sub01', '穆祥贵', '69岁', '17天', '男', '左手', 63, 65, 80, 95, '左18右26', '左20右29', 27],
    ]);

    expect(parseClinicalWorkbook(filePath)).toEqual([
      expect.objectContaining({
        subjectCode: 'sub01',
        name: '穆祥贵',
        age: 69,
        sex: '男',
        affectedHand: '左手',
        diseaseCourse: '17天',
        fmaBefore: 63,
        fmaAfter: 65,
        bbtBefore: '左18右26',
        mmse: 27,
      }),
    ]);
  });

  it('parses clinical workbook with row 4 headers', async () => {
    const filePath = await tempWorkbook('脑卒中患者信息记录表.xlsx', [
      ['', '', ''],
      ['', '', ''],
      ['M1组', '', ''],
      ['编号', '姓名', '年龄', '病程', '性别', '患病侧（手）', '治疗前FMA', '治疗后FMA', '治疗前MBI', '治疗后MBI', '缺少数据', '脱落原因', '核磁次数'],
      ['sub02', '翟玉琴', 69, 92, '女', '右', 50, 62, 75, 90, '', '', 2],
    ]);

    expect(parseClinicalWorkbook(filePath)).toEqual([
      expect.objectContaining({
        subjectCode: 'sub02',
        name: '翟玉琴',
        age: 69,
        sex: '女',
        affectedHand: '右手',
        diseaseCourse: '92',
        fmaBefore: 50,
        fmaAfter: 62,
        mriCount: 2,
      }),
    ]);
  });

  it('parses EEG completeness workbook', async () => {
    const filePath = await tempWorkbook('19例患者脑电数据完整性检查.xlsx', [
      ['患者ID', '姓名', 'FMA变化量', '基线完整性', '四阶段整体完整性', '基线_睁眼', '基线_闭眼', '最终_抓握任务'],
      ['sub01', '穆祥贵', 2, '4/4', '16/16', 'Y', 'Y', 'X'],
    ]);

    expect(parseCompletenessWorkbook(filePath)).toEqual([
      expect.objectContaining({ subjectCode: 'sub01', subjectName: '穆祥贵', stage: '基线', task: '睁眼', workbookStatus: 'Y' }),
      expect.objectContaining({ subjectCode: 'sub01', subjectName: '穆祥贵', stage: '基线', task: '闭眼', workbookStatus: 'Y' }),
      expect.objectContaining({ subjectCode: 'sub01', subjectName: '穆祥贵', stage: '最终', task: '抓握任务', workbookStatus: 'X' }),
    ]);
  });
});
```

Run:

```powershell
npm run test -- tests/electron/backend/dataLibrary/excelParsers.test.ts
```

Expected before implementation:

- FAIL because parser module does not exist.

- [ ] **Step 2: Implement Excel parsers**

Create `src/electron/backend/dataLibrary/excelParsers.ts` with exports:

```ts
export interface ParsedClinicalRow {
  subjectCode: string;
  name: string;
  age: number | null;
  sex: '男' | '女' | '';
  affectedHand: '左手' | '右手' | '双手' | '';
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
  sourceWorkbook: string;
}

export interface ParsedCompletenessRow {
  subjectCode: string;
  subjectName: string;
  stage: DataAssetStage;
  task: '睁眼' | '闭眼' | '运动想象' | '抓握任务';
  workbookStatus: 'Y' | 'X' | '';
  sourceWorkbook: string;
}

export function parseClinicalWorkbook(filePath: string): ParsedClinicalRow[];
export function parseCompletenessWorkbook(filePath: string): ParsedCompletenessRow[];
```

Implementation rules:

- Use `import ExcelJS from 'exceljs';`.
- Load workbooks with `await workbook.xlsx.readFile(filePath)` and read the first worksheet rows into `unknown[][]`.
- Detect header row by counting labels from `编号`, `患者ID`, `姓名`, `年龄`, `性别`, `患病侧`, `患病侧（手）`.
- Normalize `编号` and `患者ID` with `normalizeSubjectCode(raw, 'patient')`.
- Parse ages like `69岁` to `69`.
- Convert affected side `左` to `左手`, `右` to `右手`, and preserve `左手`, `右手`, `双手`.
- Numeric fields return `null` when blank or non-numeric.
- Completeness parser should expand columns matching `/^(基线|即时|阶段|最终)_(睁眼|闭眼|运动想象|抓握任务)$/`.

- [ ] **Step 3: Verify Task 4**

Run:

```powershell
npm run test -- tests/electron/backend/dataLibrary/excelParsers.test.ts
npm run build
```

Expected:

- PASS.

## Task 5: Document Backup

**Files:**

- Create: `src/electron/backend/dataLibrary/documentBackup.ts`
- Create: `tests/electron/backend/dataLibrary/documentBackup.test.ts`

- [ ] **Step 1: Write failing backup tests**

Create `tests/electron/backend/dataLibrary/documentBackup.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupClinicalDocument, shouldBackupAssetType } from '../../../../src/electron/backend/dataLibrary/documentBackup.js';

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('clinical document backup', () => {
  it('backs up PDF and Excel documents but not large EEG files', () => {
    expect(shouldBackupAssetType('record_pdf')).toBe(true);
    expect(shouldBackupAssetType('clinical_excel')).toBe(true);
    expect(shouldBackupAssetType('completeness_workbook')).toBe(true);
    expect(shouldBackupAssetType('raw_eeg_cnt')).toBe(false);
    expect(shouldBackupAssetType('processed_eeg_set')).toBe(false);
    expect(shouldBackupAssetType('processed_eeg_fdt')).toBe(false);
  });

  it('copies a PDF into the clinical backup directory and returns hash metadata', () => {
    const sourceRoot = tempRoot('stroke-backup-source-');
    const backupRoot = tempRoot('stroke-backup-target-');
    const sourcePath = path.join(sourceRoot, 'sub01穆祥贵.pdf');
    fs.writeFileSync(sourcePath, 'pdf bytes');

    const result = backupClinicalDocument({
      sourcePath,
      clinicalDocsBackupRoot: backupRoot,
      assetType: 'record_pdf',
      subjectCode: 'sub01',
    });

    expect(result.backupPath).toContain(path.join('pdf', 'sub01'));
    expect(fs.existsSync(result.backupPath)).toBe(true);
    expect(fs.readFileSync(result.backupPath, 'utf8')).toBe('pdf bytes');
    expect(result.fileHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 2: Implement backup helpers**

Create `src/electron/backend/dataLibrary/documentBackup.ts`:

```ts
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DataAssetType } from '../../../domain/backendTypes.js';

export interface BackupClinicalDocumentInput {
  sourcePath: string;
  clinicalDocsBackupRoot: string;
  assetType: DataAssetType;
  subjectCode: string;
}

export interface BackupClinicalDocumentResult {
  backupPath: string;
  fileHash: string;
}

export function shouldBackupAssetType(assetType: DataAssetType): boolean {
  return assetType === 'record_pdf' || assetType === 'clinical_excel' || assetType === 'completeness_workbook';
}

export function backupClinicalDocument(input: BackupClinicalDocumentInput): BackupClinicalDocumentResult {
  const extension = path.extname(input.sourcePath).toLowerCase();
  const bucket = extension === '.pdf' ? 'pdf' : 'excel';
  const subjectBucket = input.subjectCode || 'project';
  const targetDir = path.join(input.clinicalDocsBackupRoot, bucket, subjectBucket);
  fs.mkdirSync(targetDir, { recursive: true });

  const targetPath = path.join(targetDir, path.basename(input.sourcePath));
  fs.copyFileSync(input.sourcePath, targetPath);
  const fileHash = createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex');

  return {
    backupPath: targetPath,
    fileHash,
  };
}
```

- [ ] **Step 3: Verify Task 5**

Run:

```powershell
npm run test -- tests/electron/backend/dataLibrary/documentBackup.test.ts
npm run build
```

Expected:

- PASS.

## Task 6: Scan And Import Orchestrator

**Files:**

- Create: `src/electron/backend/dataLibrary/scanAndImport.ts`
- Create: `tests/electron/backend/dataLibrary/scanAndImport.test.ts`

- [ ] **Step 1: Write failing end-to-end fixture test**

Create `tests/electron/backend/dataLibrary/scanAndImport.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { openLocalDatabase, type LocalDatabase } from '../../../../src/electron/backend/database.js';
import { listPatients } from '../../../../src/electron/backend/repositories.js';
import {
  getDataLibraryStatus,
  getPatientDocumentDetail,
  listDataAssets,
  listPatientAssetSummary,
} from '../../../../src/electron/backend/dataLibrary/repository.js';
import { scanAndImportDataLibrary } from '../../../../src/electron/backend/dataLibrary/scanAndImport.js';

const roots: string[] = [];
const locals: LocalDatabase[] = [];

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function openTempDatabase(): Promise<LocalDatabase> {
  const local = await openLocalDatabase(tempRoot('stroke-data-lib-db-'));
  locals.push(local);
  return local;
}

async function writeWorkbook(filePath: string, rows: unknown[][]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  rows.forEach((row) => worksheet.addRow(row));
  await workbook.xlsx.writeFile(filePath);
}

async function makeFixture(): Promise<string> {
  const root = tempRoot('stroke-eeg-m1-');
  fs.mkdirSync(path.join(root, 'Patient_tACS_M1_EEG', '基线', 'sub01穆祥贵'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Patient_tACS_M1_RestingStateEEG_afterProcess', '基线', 'sub01穆祥贵'), { recursive: true });
  fs.mkdirSync(path.join(root, '患者记录本'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Patient_tACS_M1_EEG', '基线', 'sub01穆祥贵', 'mxg1.cnt'), 'large raw eeg bytes');
  fs.writeFileSync(path.join(root, 'Patient_tACS_M1_RestingStateEEG_afterProcess', '基线', 'sub01穆祥贵', 'mxg1.set'), 'set bytes');
  fs.writeFileSync(path.join(root, 'Patient_tACS_M1_RestingStateEEG_afterProcess', '基线', 'sub01穆祥贵', 'mxg1.fdt'), 'fdt bytes');
  fs.writeFileSync(path.join(root, '患者记录本', 'sub01穆祥贵.pdf'), 'pdf bytes');
  await writeWorkbook(path.join(root, 'M1组病历记录表.xlsx'), [
    ['编号', '姓名', '年龄', '病程', '性别', '患病侧', '治疗前FMA', '治疗后FMA', '治疗前MBI', '治疗后MBI', '治疗前BBT', '治疗后BBT', 'MMSE'],
    ['sub01', '穆祥贵', '69岁', '17天', '男', '左手', 63, 65, 80, 95, '左18右26', '左20右29', 27],
  ]);
  return root;
}

afterEach(() => {
  for (const local of locals.splice(0)) local.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('scanAndImportDataLibrary', () => {
  it('imports clinical data, backs up documents, and indexes large EEG files without copying them', async () => {
    const local = await openTempDatabase();
    const sourceRoot = await makeFixture();

    const result = scanAndImportDataLibrary(local.db, local.paths, sourceRoot);
    const patients = listPatients(local.db);
    const assets = listDataAssets(local.db);
    const summary = listPatientAssetSummary(local.db);
    const status = getDataLibraryStatus(local.db);
    const patientDetail = getPatientDocumentDetail(local.db, patients[0].id);

    expect(result).toEqual(expect.objectContaining({
      createdPatients: 1,
      indexedAssets: 5,
      backedUpDocuments: 2,
      unmatchedFiles: 0,
    }));
    expect(patients).toEqual([expect.objectContaining({ subjectCode: 'sub01', name: '穆祥贵', sex: '男' })]);
    expect(assets.filter((asset) => asset.assetType === 'raw_eeg_cnt')[0]).toEqual(
      expect.objectContaining({ backupPath: null, subjectCode: 'sub01', stage: '基线' }),
    );
    expect(assets.filter((asset) => asset.assetType === 'record_pdf')[0].backupPath).toContain('clinical_docs');
    expect(summary[0]).toEqual(expect.objectContaining({ baselineRawCount: 1, baselineProcessedPairs: 1 }));
    expect(status.indexedFiles).toBe(5);
    expect(patientDetail.clinicalMetrics).toEqual(expect.objectContaining({ fmaBefore: 63, fmaAfter: 65 }));
  });
});
```

Run:

```powershell
npm run test -- tests/electron/backend/dataLibrary/scanAndImport.test.ts
```

Expected before implementation:

- FAIL because `scanAndImport.ts` does not exist.

- [ ] **Step 2: Implement orchestrator**

Create `src/electron/backend/dataLibrary/scanAndImport.ts` with:

```ts
export function scanAndImportDataLibrary(db: Database, paths: AppPaths, rootPath: string): ScanAndImportDataLibraryResult;
export function updateDataAssetIndex(db: Database, paths: AppPaths, rootPath: string): ScanAndImportDataLibraryResult;
export function backupClinicalDocuments(db: Database, paths: AppPaths, rootPath: string): ScanAndImportDataLibraryResult;
```

Implementation requirements:

- Use recursive `fs.readdirSync(rootPath, { withFileTypes: true })`.
- Classify files using `classifyDataLibraryPath`.
- Create a `data_library_scan` task with status `running`.
- Use `upsertSourceRoot` before asset writes.
- Parse clinical Excel files before matching EEG assets, so patient records exist.
- Use `createPatient` for patient rows.
- Count created vs updated using `patientExistsBySubjectCode` before `createPatient`.
- Use `upsertClinicalMetrics` after creating/updating patient rows.
- For PDF and Excel assets, call `backupClinicalDocument`.
- For `.cnt/.set/.fdt`, never call `backupClinicalDocument`.
- Upsert all classified files into `data_assets`.
- After processing assets, compute `.set/.fdt` pair counts per patient and stage into `data_completeness`.
- Complete the task with output JSON.
- On error, call `failTask` and write an error log.

The result counters must be:

```ts
const result: ScanAndImportDataLibraryResult = {
  sourceRootId: sourceRoot.id,
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
```

- [ ] **Step 3: Verify Task 6**

Run:

```powershell
npm run test -- tests/electron/backend/dataLibrary/scanAndImport.test.ts
npm run test -- tests/electron/backend/dataLibrary
npm run build
```

Expected:

- PASS.

## Task 7: IPC, Preload, And Renderer API

**Files:**

- Modify: `src/electron/backend/ipcHandlers.ts`
- Modify: `src/electron/preload.ts`
- Modify: `src/services/apiClient.ts`
- Modify: `src/vite-env.d.ts` if bridge type import changes.
- Modify: `tests/electron/backend/ipcHandlers.test.ts`
- Modify: `tests/electron/preload.test.ts`
- Modify: `tests/services/apiClient.test.ts`

- [ ] **Step 1: Write failing IPC/preload/API expectations**

In `tests/electron/preload.test.ts`, expect these database keys in addition to existing keys:

```ts
'backupClinicalDocuments',
'getDataLibraryStatus',
'getPatientDocumentDetail',
'listDataAssets',
'listPatientAssetSummary',
'openAssetLocation',
'openBackupDirectory',
'scanAndImportDataLibrary',
'updateDataAssetIndex',
'upsertSourceRoot'
```

In `tests/services/apiClient.test.ts`, import and call:

```ts
getDataLibraryStatus,
scanAndImportDataLibrary,
listPatientAssetSummary,
getPatientDocumentDetail,
```

Expected browser fallbacks:

```ts
await expect(getDataLibraryStatus()).resolves.toEqual({
  sourceRoot: null,
  indexedFiles: 0,
  missingFiles: 0,
  backedUpDocuments: 0,
  manualReviewItems: 0,
  lastScanMessage: '浏览器预览模式未连接本地数据与文档库',
});
await expect(scanAndImportDataLibrary('F:\\CJZFile\\EEG_M1')).resolves.toEqual(
  expect.objectContaining({ indexedAssets: 0, errors: ['浏览器预览模式不支持扫描本地数据目录'] }),
);
await expect(listPatientAssetSummary()).resolves.toEqual([]);
await expect(getPatientDocumentDetail('patient-1')).resolves.toEqual({
  patient: null,
  clinicalMetrics: null,
  assets: [],
  completeness: [],
  warnings: ['浏览器预览模式未连接本地数据与文档库'],
});
```

Run:

```powershell
npm run test -- tests/electron/preload.test.ts tests/services/apiClient.test.ts
```

Expected before implementation:

- FAIL because functions are missing.

- [ ] **Step 2: Register IPC handlers**

In `src/electron/backend/ipcHandlers.ts`, import repository and scanner functions and add:

```ts
ipcMain.handle('backend:getDataLibraryStatus', () => getDataLibraryStatus(local.db));

ipcMain.handle('backend:upsertSourceRoot', (_event, input) =>
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

ipcMain.handle('backend:listDataAssets', (_event, filter) => listDataAssets(local.db, filter));
ipcMain.handle('backend:listPatientAssetSummary', () => listPatientAssetSummary(local.db));
ipcMain.handle('backend:getPatientDocumentDetail', (_event, patientId: string) =>
  getPatientDocumentDetail(local.db, patientId),
);
ipcMain.handle('backend:openAssetLocation', async (_event, assetId: string) => openAssetLocation(local.db, assetId));
ipcMain.handle('backend:openBackupDirectory', async () => shell.openPath(local.paths.clinicalDocsBackupRoot));
```

For `openAssetLocation`, use Electron `shell.showItemInFolder(filePath)` after loading the asset by id. If the asset is missing, return `{ ok: false, message: '文件不存在或未找到资产记录。' }`.

- [ ] **Step 3: Extend preload**

In `src/electron/preload.ts`, add methods under `database`:

```ts
getDataLibraryStatus: () => ipcRenderer.invoke('backend:getDataLibraryStatus'),
upsertSourceRoot: (input) => ipcRenderer.invoke('backend:upsertSourceRoot', input),
scanAndImportDataLibrary: (rootPath: string) => ipcRenderer.invoke('backend:scanAndImportDataLibrary', rootPath),
updateDataAssetIndex: (rootPath: string) => ipcRenderer.invoke('backend:updateDataAssetIndex', rootPath),
backupClinicalDocuments: (rootPath: string) => ipcRenderer.invoke('backend:backupClinicalDocuments', rootPath),
listDataAssets: (filter) => ipcRenderer.invoke('backend:listDataAssets', filter),
listPatientAssetSummary: () => ipcRenderer.invoke('backend:listPatientAssetSummary'),
getPatientDocumentDetail: (patientId: string) => ipcRenderer.invoke('backend:getPatientDocumentDetail', patientId),
openAssetLocation: (assetId: string) => ipcRenderer.invoke('backend:openAssetLocation', assetId),
openBackupDirectory: () => ipcRenderer.invoke('backend:openBackupDirectory'),
```

- [ ] **Step 4: Extend renderer API**

In `src/services/apiClient.ts`, export:

```ts
export async function getDataLibraryStatus(): Promise<DataLibraryStatus>;
export async function scanAndImportDataLibrary(rootPath: string): Promise<ScanAndImportDataLibraryResult>;
export async function updateDataAssetIndex(rootPath: string): Promise<ScanAndImportDataLibraryResult>;
export async function backupClinicalDocuments(rootPath: string): Promise<ScanAndImportDataLibraryResult>;
export async function listPatientAssetSummary(): Promise<DataLibrarySummaryRow[]>;
export async function getPatientDocumentDetail(patientId: string): Promise<PatientDocumentDetail>;
export async function openAssetLocation(assetId: string): Promise<ApiResult>;
export async function openBackupDirectory(): Promise<ApiResult>;
```

Browser fallback must return safe mock values and never touch local files.

- [ ] **Step 5: Verify Task 7**

Run:

```powershell
npm run test -- tests/electron/backend/ipcHandlers.test.ts tests/electron/preload.test.ts tests/services/apiClient.test.ts
npm run build
```

Expected:

- PASS.

## Task 8: Data Library UI And Navigation Replacement

**Files:**

- Create: `src/features/dataLibrary/DataLibraryView.tsx`
- Create: `tests/features/dataLibrary.test.tsx`
- Modify: `src/App.tsx`
- Modify: `tests/features/workbench.test.tsx` only if navigation expectations are centralized there.

- [ ] **Step 1: Write failing renderer test**

Create `tests/features/dataLibrary.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App';

function installBridge() {
  window.neuroPredict = {
    platform: 'win32',
    database: {
      getWorkbenchData: vi.fn().mockResolvedValue({ patients: [], tasks: { running: [], manual: [], failed: [] }, logs: [], dataRoot: 'F:\\CJZFile\\EEG_M1' }),
      listPatients: vi.fn(),
      createPatient: vi.fn(),
      updatePatient: vi.fn(),
      deletePatient: vi.fn(),
      registerEegFile: vi.fn(),
      scanRegisteredEegFiles: vi.fn(),
      importPatientsCsv: vi.fn(),
      scanEegFolder: vi.fn(),
      getDataLibraryStatus: vi.fn().mockResolvedValue({
        sourceRoot: { id: 'root-1', projectName: 'EEG_M1', rootPath: 'F:\\CJZFile\\EEG_M1', status: 'active', lastScannedAt: null, createdAt: '', updatedAt: '' },
        indexedFiles: 863,
        missingFiles: 0,
        backedUpDocuments: 34,
        manualReviewItems: 2,
        lastScanMessage: 'ready',
      }),
      listPatientAssetSummary: vi.fn().mockResolvedValue([
        {
          patientId: 'patient-1',
          subjectCode: 'sub01',
          subjectName: '穆祥贵',
          cohort: 'patient',
          hasClinicalInfo: true,
          hasRecordPdf: true,
          baselineRawCount: 2,
          baselineProcessedPairs: 2,
          immediateProcessedPairs: 2,
          phaseProcessedPairs: 2,
          finalProcessedPairs: 2,
          completenessScore: '完整',
          issueCount: 0,
          matchStatus: 'matched',
        },
      ]),
      getPatientDocumentDetail: vi.fn().mockResolvedValue({
        patient: null,
        clinicalMetrics: { fmaBefore: 63, fmaAfter: 65, mbiBefore: 80, mbiAfter: 95, bbtBefore: '左18右26', bbtAfter: '左20右29', mmse: 27 },
        assets: [],
        completeness: [],
        warnings: [],
      }),
      scanAndImportDataLibrary: vi.fn().mockResolvedValue({ indexedAssets: 863, backedUpDocuments: 34, errors: [] }),
      updateDataAssetIndex: vi.fn(),
      backupClinicalDocuments: vi.fn(),
      listDataAssets: vi.fn(),
      openAssetLocation: vi.fn(),
      openBackupDirectory: vi.fn(),
      upsertSourceRoot: vi.fn(),
    },
    settings: { getSettings: vi.fn(), updateSettings: vi.fn() },
    tasks: { listTasks: vi.fn(), listTaskLogs: vi.fn(), createPreprocessBatch: vi.fn() },
  };
  return window.neuroPredict;
}

describe('data and document library page', () => {
  afterEach(() => {
    delete window.neuroPredict;
  });

  it('replaces batch import navigation with 数据与文档库 and shows patient asset summaries', async () => {
    installBridge();
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole('button', { name: '批次与导入' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '数据与文档库' }));

    expect(await screen.findByRole('heading', { name: '数据与文档库' })).toBeInTheDocument();
    expect(screen.getByText('F:\\CJZFile\\EEG_M1')).toBeInTheDocument();
    expect(screen.getByText('sub01')).toBeInTheDocument();
    expect(screen.getByText('穆祥贵')).toBeInTheDocument();
    expect(screen.getByText('扫描并批量导入')).toBeInTheDocument();
  });

  it('calls scanAndImportDataLibrary from the primary action', async () => {
    const bridge = installBridge();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '数据与文档库' }));
    await user.click(await screen.findByRole('button', { name: '扫描并批量导入' }));

    await waitFor(() => {
      expect(bridge.database.scanAndImportDataLibrary).toHaveBeenCalledWith('F:\\CJZFile\\EEG_M1');
    });
  });
});
```

Run:

```powershell
npm run test -- tests/features/dataLibrary.test.tsx
```

Expected before implementation:

- FAIL because the navigation and view do not exist.

- [ ] **Step 2: Create `DataLibraryView`**

Create `src/features/dataLibrary/DataLibraryView.tsx`.

The component props:

```ts
interface DataLibraryViewProps {
  status: DataLibraryStatus | null;
  summaries: DataLibrarySummaryRow[];
  selectedDetail: PatientDocumentDetail | null;
  defaultRootPath: string;
  message: string;
  onRefresh: () => Promise<void>;
  onScanAndImport: (rootPath: string) => Promise<void>;
  onUpdateIndex: (rootPath: string) => Promise<void>;
  onBackupDocuments: (rootPath: string) => Promise<void>;
  onOpenBackupDirectory: () => Promise<void>;
  onSelectPatient: (patientId: string | null) => Promise<void>;
}
```

Render:

- Heading `数据与文档库`.
- Top source bar with root path and counters.
- Buttons: `选择数据根目录`, `扫描并批量导入`, `仅更新索引`, `备份患者资料`, `打开备份目录`.
- Patient table with columns from the spec.
- Right detail panel with clinical metrics and warnings.
- Compact task log/message area.

Use existing Tailwind visual language from `src/App.tsx`: slate backgrounds, blue primary buttons, compact table, status badges.

- [ ] **Step 3: Replace nav item and route**

In `src/App.tsx`, change:

```ts
{ id: 'batch', label: '批次与导入', icon: Database },
```

to:

```ts
{ id: 'dataLibrary', label: '数据与文档库', icon: Database },
```

Import API functions:

```ts
import {
  backupClinicalDocuments,
  getDataLibraryStatus,
  getPatientDocumentDetail,
  listPatientAssetSummary,
  openBackupDirectory,
  scanAndImportDataLibrary,
  updateDataAssetIndex,
} from './services/apiClient';
import { DataLibraryView } from './features/dataLibrary/DataLibraryView';
```

Add state:

```ts
const [dataLibraryStatus, setDataLibraryStatus] = useState(null);
const [dataLibrarySummaries, setDataLibrarySummaries] = useState([]);
const [selectedDocumentDetail, setSelectedDocumentDetail] = useState(null);
```

Add refresh handlers:

```ts
const refreshDataLibrary = async () => {
  const [status, summaries] = await Promise.all([getDataLibraryStatus(), listPatientAssetSummary()]);
  if (!isMountedRef.current) return;
  setDataLibraryStatus(status);
  setDataLibrarySummaries(summaries);
};
```

Call `refreshDataLibrary()` in the initial `useEffect`.

Route:

```tsx
) : activeTab === 'dataLibrary' ? (
  <DataLibraryView
    status={dataLibraryStatus}
    summaries={dataLibrarySummaries}
    selectedDetail={selectedDocumentDetail}
    defaultRootPath={dataLibraryStatus?.sourceRoot?.rootPath ?? 'F:\\CJZFile\\EEG_M1'}
    message={backendMessage}
    onRefresh={refreshDataLibrary}
    onScanAndImport={handleScanAndImportDataLibrary}
    onUpdateIndex={handleUpdateDataAssetIndex}
    onBackupDocuments={handleBackupClinicalDocuments}
    onOpenBackupDirectory={handleOpenBackupDirectory}
    onSelectPatient={handleSelectDocumentPatient}
  />
```

- [ ] **Step 4: Verify Task 8**

Run:

```powershell
npm run test -- tests/features/dataLibrary.test.tsx tests/features/workbench.test.tsx
npm run build
```

Expected:

- PASS.

## Task 9: Final Verification And Real Folder Smoke

**Files:**

- No production file changes unless verification finds a defect.

- [ ] **Step 1: Run full automated verification**

Run:

```powershell
npm run test
npm run build
npm run electron:build
npm audit --omit=dev --audit-level=moderate
```

Expected:

- All tests pass.
- Build passes.
- Electron build passes.
- Audit reports `found 0 vulnerabilities` for moderate production dependencies.

- [ ] **Step 2: Run a read-only real folder classification smoke**

Run a Node script against `F:\CJZFile\EEG_M1` that imports `classifyDataLibraryPath` from compiled output and counts classified files by asset type. The script must not write to the real folder.

Expected:

- Counts are close to the observed snapshot:
  - `.cnt`: about 405.
  - `.set`: about 210.
  - `.fdt`: about 210.
  - `.pdf`: about 31.
  - `.xlsx`: 3.
- No large EEG copy is attempted.

- [ ] **Step 3: Run a temporary fixture scan smoke**

Use the test fixture pattern from `scanAndImport.test.ts` to create a temporary `EEG_M1`-like root, run `scanAndImportDataLibrary`, and print:

```json
{
  "createdPatients": 1,
  "indexedAssets": 5,
  "backedUpDocuments": 2,
  "largeEegBackupPath": null
}
```

Expected:

- The temporary root is deleted after the script.
- Backups are created only under the temporary app data root.

- [ ] **Step 4: Electron smoke**

Run:

```powershell
.\node_modules\.bin\electron.cmd --version
```

Expected:

- Prints Electron version.

Start Electron with:

```powershell
.\node_modules\.bin\electron.cmd .
```

Expected:

- The app opens.
- `Documents\StrokePredictSystem\app.db` exists.
- The left nav shows `数据与文档库`, not `批次与导入`.

- [ ] **Step 5: Check repository state**

Run:

```powershell
git status --short
```

Expected in the current workspace:

- This may fail with `fatal: not a git repository`; if so, report that no commit was made because the project is not a git repo.
- If a git repo is initialized later, review changed files and commit after verification.

## Implementation Notes

- Keep the data-library backend separate from the older `scanEegFiles.ts`. The older function can remain for current workbench compatibility, but the new data-library scanner should use full path context and should not rely on EEG file basenames containing subject IDs.
- Keep browser fallback safe. The browser preview must never read `F:\CJZFile\EEG_M1`.
- Avoid copying `.cnt`, `.set`, or `.fdt` files. Only `.pdf` and `.xlsx` project/clinical files are backed up.
- Store original source paths and original subject folder tokens even after normalization.
- Healthy controls stay out of patient prediction queues by default.

## Self-Review Checklist

- Spec requirement "old batch import becomes data library action": covered by Task 8.
- Spec requirement "large EEG index only": covered by Tasks 5, 6, and 9.
- Spec requirement "clinical docs backup": covered by Tasks 1, 5, and 6.
- Spec requirement "Excel row 1 and row 4 headers": covered by Task 4.
- Spec requirement "parent-folder subject matching": covered by Task 3.
- Spec requirement "database tables": covered by Task 2.
- Spec requirement "preload/API": covered by Task 7.
- Spec requirement "frontend patient asset table and detail panel": covered by Task 8.
- Spec requirement "tests": covered across Tasks 1-9.
