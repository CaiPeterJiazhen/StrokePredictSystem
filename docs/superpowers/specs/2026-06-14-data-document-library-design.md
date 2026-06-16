# Data And Document Library Design

## Purpose

Replace the previous standalone batch-import concept with a single `数据与文档库` module. This module becomes the entry point for local research data management:

1. Batch-import patient information from the real `EEG_M1` project folder.
2. Back up small patient personal documents into the app data directory.
3. Index large EEG files by path without copying them.
4. Show patient-level data completeness for preprocessing, feature generation, and prediction.

This feature should work with the current local Windows dataset at:

```text
F:\CJZFile\EEG_M1
```

## Confirmed Storage Policy

Large EEG files are never copied in the first version. They are indexed by original path.

Personal and clinical documents are backed up into the software data directory:

```text
Documents\StrokePredictSystem\backups\clinical_docs\
```

The app also stores parsed structured patient data in SQLite. This gives the software durable patient records even if the original Excel files are later moved.

## Observed Source Data Layout

The `EEG_M1` directory is a mixed research data root, not a simple EEG-only folder.

Observed top-level content:

- `Patient_tACS_M1_EEG`: patient raw EEG files, mostly `.cnt`.
- `Patient_tACS_M1_RestingStateEEG_afterProcess`: patient processed EEGLAB files, `.set/.fdt`.
- `Health-tACS-M1-RestingStateEEG`: healthy-control raw EEG files.
- `Health_tACS_M1_RestingStateEEG_afterProcess`: healthy-control processed `.set/.fdt`.
- `患者记录本`: patient PDF record books.
- `健康人记录本`: healthy-control PDF record books.
- `脑卒中患者信息记录表.xlsx`: patient information workbook.
- `M1组病历记录表.xlsx`: clinical record workbook.
- `19例患者脑电数据完整性检查.xlsx`: EEG completeness workbook.
- `standard_1005.ced`, `EEG_62channel.node`, `EEG_64channel.node`: electrode/channel files.
- `EEG_M1.zip`: archive backup.

Observed file counts from the current folder snapshot:

- `.cnt`: 405 files.
- `.set`: 210 files.
- `.fdt`: 210 files.
- `.pdf`: 31 files.
- `.xlsx`: 3 files.
- `.node`: 2 files.
- `.ced`: 1 file.
- `.zip`: 1 file.
- Total: 863 files, about 45.47 GB.

Patient raw EEG stages:

- `基线`: 107 `.cnt` files across 28 subject folders.
- `即时`: 83 `.cnt` files across 23 subject folders.
- `阶段`: 78 `.cnt` files across 22 subject folders.
- `最终`: 79 `.cnt` files across 20 subject folders.
- `随访1`: 32 `.cnt` files across 6 subject folders.

Patient processed EEG stages:

- `基线`: 56 `.set` and 56 `.fdt` files across 28 subject folders.
- `即时`: 46 `.set` and 46 `.fdt` files across 23 subject folders.
- `阶段`: 42 `.set` and 42 `.fdt` files across 21 subject folders.
- `最终`: 40 `.set` and 40 `.fdt` files across 20 subject folders.

The source folder uses names such as `sub01穆祥贵`, `sub011单庆明`, and `sub001朱卫清`. EEG file names themselves often use initials such as `mxg1.set` rather than the subject code. The scanner must therefore identify subject codes from the full path and parent folder names, not only from file names.

## Excel Import Rules

The import flow must support Excel workbooks directly. CSV-only import is not enough for this dataset.

### `M1组病历记录表.xlsx`

The header starts at row 1.

Relevant columns:

- `编号`
- `姓名`
- `年龄`
- `病程`
- `性别`
- `患病侧`
- `治疗前FMA`
- `治疗后FMA`
- `治疗前MBI`
- `治疗后MBI`
- `治疗前BBT`
- `治疗后BBT`
- `MMSE`

### `脑卒中患者信息记录表.xlsx`

The real header starts at row 4, not row 1.

Relevant columns:

- `编号`
- `姓名`
- `年龄`
- `病程`
- `性别`
- `患病侧（手）`
- `治疗前FMA`
- `治疗后FMA`
- `治疗前MBI`
- `治疗后MBI`
- `缺少数据`
- `脱落原因`
- `核磁次数`

### `19例患者脑电数据完整性检查.xlsx`

The header starts at row 1.

Relevant columns:

- `患者ID`
- `姓名`
- `FMA变化量`
- `基线完整性`
- `四阶段整体完整性`
- Stage-by-task columns such as `基线_睁眼`, `基线_闭眼`, `即时_睁眼`, `阶段_闭眼`, and `最终_抓握任务`.

The importer should auto-detect the header row by looking for known header labels. It should not assume row 1 for all workbooks.

## Subject ID Normalization

The app should preserve original folder and file names, but use one normalized subject code for matching.

Rules:

- Patient IDs use display form `sub01`, `sub02`, ..., `sub29`.
- Numeric padding differences normalize to the same patient where appropriate:
  - `sub001` -> `sub01` for patient subjects.
  - `sub011` -> `sub11`.
  - `sub021` -> `sub21`.
- The original source token is still stored as `source_subject_code`.
- Healthy controls are stored separately from patient subjects, because health subjects such as `sub001` may overlap numerically with patient IDs.

The scanner should classify cohort before normalizing IDs:

- Paths under patient directories become `patient`.
- Paths under health directories become `health`.

## Database Additions

The existing local SQLite database remains the system of record. Add tables focused on source roots, document backups, and file assets.

### `source_roots`

Stores scanned data roots.

Columns:

- `id`: UUID.
- `project_name`: default `EEG_M1`.
- `root_path`: original root directory path.
- `status`: `active`, `missing`, or `archived`.
- `last_scanned_at`: ISO timestamp or null.
- `created_at`: ISO timestamp.
- `updated_at`: ISO timestamp.

### `data_assets`

Stores one row per discovered file or managed document.

Columns:

- `id`: UUID.
- `source_root_id`: foreign key to `source_roots`.
- `patient_id`: nullable foreign key to `patients`.
- `subject_code`: normalized code used in the app.
- `source_subject_code`: raw code found in the folder or file name.
- `subject_name`: name parsed from the folder, PDF, or Excel row.
- `cohort`: `patient`, `health`, or `project`.
- `stage`: `基线`, `即时`, `阶段`, `最终`, `随访1`, or `不适用`.
- `asset_type`: one of:
  - `raw_eeg_cnt`
  - `processed_eeg_set`
  - `processed_eeg_fdt`
  - `clinical_excel`
  - `record_pdf`
  - `completeness_workbook`
  - `electrode_location`
  - `channel_file`
  - `archive`
- `file_path`: original file path.
- `backup_path`: nullable backup path for copied small files.
- `file_size`: bytes.
- `file_hash`: optional for small backed-up files.
- `exists_on_disk`: boolean.
- `match_status`: `matched`, `unmatched`, or `needs_review`.
- `indexed_at`: ISO timestamp.
- `last_checked_at`: ISO timestamp.

### `clinical_metrics`

Stores structured patient clinical information parsed from Excel.

Columns:

- `patient_id`: foreign key to `patients`.
- `source_workbook`: workbook name.
- `disease_course`: text because source values include values such as `17天` and `十余年`.
- `affected_side_raw`: original affected-side text.
- `fma_before`: numeric or null.
- `fma_after`: numeric or null.
- `mbi_before`: numeric or null.
- `mbi_after`: numeric or null.
- `bbt_before`: text because source values may contain left/right combined values.
- `bbt_after`: text.
- `mmse`: numeric or null.
- `missing_data`: text.
- `dropout_reason`: text.
- `mri_count`: numeric or null.
- `updated_at`: ISO timestamp.

### `data_completeness`

Stores imported and computed completeness status.

Columns:

- `patient_id`: foreign key to `patients`.
- `subject_code`: normalized subject code.
- `stage`: `基线`, `即时`, `阶段`, `最终`, or `随访1`.
- `task`: `睁眼`, `闭眼`, `运动想象`, `抓握任务`, or `resting_unknown`.
- `raw_cnt_count`: number.
- `processed_set_count`: number.
- `processed_fdt_count`: number.
- `set_fdt_pair_status`: `complete`, `missing_set`, `missing_fdt`, or `not_applicable`.
- `workbook_status`: `Y`, `X`, empty, or null.
- `computed_status`: `complete`, `partial`, `missing`, or `needs_review`.
- `updated_at`: ISO timestamp.

## Batch Import Flow Inside `数据与文档库`

The old standalone `批次导入` page should be replaced by this page. Batch import becomes an action inside the data library.

Primary actions:

- `选择数据根目录`
- `扫描并批量导入`
- `仅更新索引`
- `备份患者资料`
- `打开备份目录`

`扫描并批量导入` runs this sequence:

1. Confirm or select the source root, defaulting to `F:\CJZFile\EEG_M1` if available.
2. Scan the folder tree and classify files.
3. Parse Excel workbooks with header-row detection.
4. Create or update patient records by normalized `subject_code`.
5. Parse and upsert clinical metrics.
6. Copy PDF and Excel personal/clinical documents into `backups\clinical_docs`.
7. Index EEG files by path without copying them.
8. Check `.set/.fdt` pairs.
9. Import workbook completeness values.
10. Produce an import summary and task log.

Import result summary should include:

- New patients created.
- Patients updated.
- EEG files indexed.
- Clinical documents backed up.
- Missing original paths.
- `.set/.fdt` pair issues.
- Unmatched files.
- Files requiring manual review.

## File Matching Rules

The scanner must use full path context.

For patient raw EEG:

```text
Patient_tACS_M1_EEG\<stage>\<subject-folder>\*.cnt
```

For patient processed EEG:

```text
Patient_tACS_M1_RestingStateEEG_afterProcess\<stage>\<subject-folder>\*.set
Patient_tACS_M1_RestingStateEEG_afterProcess\<stage>\<subject-folder>\*.fdt
```

For healthy controls:

```text
Health-tACS-M1-RestingStateEEG\<subject-folder>\*.cnt
Health_tACS_M1_RestingStateEEG_afterProcess\<subject-folder>\*.set
Health_tACS_M1_RestingStateEEG_afterProcess\<subject-folder>\*.fdt
```

For records:

```text
患者记录本\*.pdf
健康人记录本\*.pdf
```

Matching priority:

1. Subject code from parent folder name.
2. Subject code from file name.
3. Name match against Excel rows or PDF names.
4. Manual review if no reliable match exists.

The scanner should not reject files only because the EEG file basename lacks `subXX`.

## UI Design

The left navigation item formerly used for `批次导入` should be renamed or replaced with:

```text
数据与文档库
```

The page should be patient-centered, not a generic file explorer.

### Top Source Bar

Shows:

- Current data root.
- Last scan time.
- Total indexed files.
- Missing files.
- Backed-up clinical documents.
- Manual-review items.

Actions:

- `选择数据根目录`
- `扫描并批量导入`
- `仅更新索引`
- `备份患者资料`
- `打开备份目录`

### Main Patient Asset Table

Columns:

- `患者编号`
- `姓名`
- `队列`: patient or health.
- `信息表`
- `病历PDF`
- `基线原始EEG`
- `基线预处理EEG`
- `即时`
- `阶段`
- `最终`
- `完整性评分`
- `问题`
- `操作`

Status labels:

- `完整`
- `部分缺失`
- `未找到`
- `待人工确认`
- `路径失效`

### Patient Detail Panel

Shows selected subject details:

- Basic information: age, sex, disease course, affected side/hand.
- Clinical metrics: FMA, MBI, BBT, MMSE before and after treatment.
- Documents: original and backup paths for PDF/Excel assets.
- EEG files by stage: `.cnt`, `.set`, `.fdt`.
- Completeness warnings: missing EC, missing `.fdt`, unmatched folder, path missing.

### Task Log Area

Shows import and scanning log lines:

- Started scan.
- Parsed workbook.
- Created/updated patient.
- Backed up document.
- Indexed EEG file.
- Detected missing pair.
- Queued manual review.

## API Surface

Add backend service functions through the existing Electron preload boundary:

- `listSourceRoots()`
- `upsertSourceRoot(input)`
- `scanAndImportDataLibrary(rootId | rootPath)`
- `updateDataAssetIndex(rootId)`
- `backupClinicalDocuments(rootId)`
- `listDataAssets(filter)`
- `listPatientAssetSummary(filter)`
- `getPatientDocumentDetail(patientId)`
- `openAssetLocation(assetId)`
- `openBackupDirectory()`
- `resolveManualAssetMatch(assetId, patientId)`

The renderer must continue calling `src/services/apiClient.ts` rather than direct Electron APIs.

## Error Handling

Expected warnings should be visible but not fatal:

- Missing `.fdt` for a `.set`.
- Missing `.set` for a `.fdt`.
- EEG path no longer exists.
- PDF name cannot be matched to a patient.
- Excel row has missing patient ID.
- Duplicate patient rows disagree on name or clinical fields.
- Health subject code overlaps with patient subject code.

Fatal errors:

- Source root cannot be read.
- Backup directory cannot be created.
- SQLite write fails.
- Excel workbook cannot be opened.

Fatal errors should create failed task entries and preserve partial scan logs.

## Testing Requirements

Unit tests:

- Normalize subject IDs from folder names such as `sub01穆祥贵`, `sub011单庆明`, and `sub001朱卫清`.
- Distinguish patient and health cohorts before normalization.
- Detect Excel header rows at row 1 and row 4.
- Parse clinical metrics from `M1组病历记录表.xlsx`-style rows.
- Parse completeness workbook columns.
- Classify source paths into cohort, stage, asset type, and subject.
- Detect `.set/.fdt` pair completeness.

Integration tests:

- Build a temporary `EEG_M1`-like fixture and run `scanAndImportDataLibrary`.
- Assert that large EEG files are indexed but not copied.
- Assert that PDF/Excel files are copied into the backup directory.
- Assert that patient records and clinical metrics are created or updated.
- Assert that unmatched files produce manual-review records.
- Assert that repeated scans update existing rows without duplicating assets.

Renderer tests:

- `数据与文档库` replaces the old standalone `批次导入` entry.
- The page shows source root, import actions, patient asset table, detail panel, and task log.
- Clicking `扫描并批量导入` calls the backend service.
- Status labels render complete, partial, missing, and manual-review states.

## Out Of Scope For This Feature

- Copying large `.cnt`, `.set`, or `.fdt` files into app-managed storage.
- Running MATLAB/EEGLAB preprocessing.
- Generating PSD/WPLI features.
- Running prediction or explainability.
- Editing Excel/PDF contents from inside the app.
- Cloud sync or multi-user sharing.

## Gemini Prompt Update

Use this prompt when asking Gemini to adjust the frontend design:

```text
请将原来的“批次导入”功能整合进“数据与文档库”页面，不再单独做批次导入页面。

数据与文档库页面需要同时支持：
1. 数据根目录管理
2. 扫描本地 EEG_M1 项目目录
3. 批量导入患者信息
4. 备份患者 PDF/Excel 小文件
5. 建立大型 EEG 文件路径索引
6. 展示患者资料完整性
7. 展示扫描/导入任务日志

顶部主要操作按钮包括：
- 选择数据根目录
- 扫描并批量导入
- 仅更新索引
- 备份患者资料
- 打开备份目录

页面主体是患者资料完整性表，不是普通文件列表。请保持 NeuroPredict 深色科研工作台风格，信息密度高，适合批量患者管理。状态需要用颜色区分：完整、部分缺失、未找到、路径失效、待人工确认。右侧详情面板展示选中患者的临床信息、PDF/Excel 备份状态、按阶段分组的 EEG 文件清单和完整性问题。
```

