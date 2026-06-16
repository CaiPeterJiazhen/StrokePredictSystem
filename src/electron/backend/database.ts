import fs from 'node:fs';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { ensureAppPaths, type AppPaths } from './appPaths.js';

export interface LocalDatabase {
  db: Database;
  paths: AppPaths;
  save: () => void;
  close: () => void;
}

let sqlModule: SqlJsStatic | null = null;

async function getSqlModule(): Promise<SqlJsStatic> {
  if (!sqlModule) {
    sqlModule = await initSqlJs();
  }

  return sqlModule;
}

const migrations = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    subject_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    age INTEGER,
    sex TEXT NOT NULL DEFAULT '',
    diagnosis TEXT NOT NULL DEFAULT '',
    affected_hand TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS eeg_files (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    condition TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_format TEXT NOT NULL,
    exists_on_disk INTEGER NOT NULL,
    registered_at TEXT NOT NULL,
    last_checked_at TEXT NOT NULL,
    UNIQUE(patient_id, condition, file_path),
    FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_status (
    patient_id TEXT PRIMARY KEY,
    preprocess_status TEXT NOT NULL,
    feature_status TEXT NOT NULL,
    prediction_status TEXT NOT NULL,
    explanation_status TEXT NOT NULL,
    report_status TEXT NOT NULL,
    last_error TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    patient_id TEXT,
    batch_id TEXT,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    input_json TEXT NOT NULL DEFAULT '{}',
    output_json TEXT NOT NULL DEFAULT '{}',
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS task_logs (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    patient_id TEXT,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL,
    FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
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
  `CREATE TABLE IF NOT EXISTS feature_artifacts (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_format TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    feature_count INTEGER NOT NULL DEFAULT 0,
    params_json TEXT NOT NULL DEFAULT '{}',
    preview_json TEXT NOT NULL DEFAULT '{}',
    exists_on_disk INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(patient_id, kind, state, file_path),
    FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS prediction_models (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    model_family TEXT NOT NULL DEFAULT 'traditional_ml',
    checkpoint_mode TEXT NOT NULL DEFAULT 'external_script',
    input_type TEXT NOT NULL,
    inputs_json TEXT NOT NULL DEFAULT '[]',
    validation TEXT NOT NULL DEFAULT '',
    accuracy REAL,
    balanced_accuracy REAL,
    roc_auc REAL,
    pr_auc REAL,
    status TEXT NOT NULL,
    artifact_path TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS prediction_results (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    predicted_class TEXT NOT NULL,
    probability REAL NOT NULL,
    threshold REAL NOT NULL,
    label_definition TEXT NOT NULL,
    feature_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
    explanation_status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY(model_id) REFERENCES prediction_models(id) ON DELETE RESTRICT
  )`,
  `CREATE TABLE IF NOT EXISTS explanation_artifacts (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    artifact_type TEXT NOT NULL,
    title TEXT NOT NULL,
    method TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_format TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    top_features_json TEXT NOT NULL DEFAULT '[]',
    preview_json TEXT NOT NULL DEFAULT '{}',
    exists_on_disk INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(patient_id, task_id, model_id, artifact_type, file_path),
    FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY(model_id) REFERENCES prediction_models(id) ON DELETE RESTRICT
  )`,
  `CREATE TABLE IF NOT EXISTS patient_reports (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    task_id TEXT,
    format TEXT NOT NULL,
    status TEXT NOT NULL,
    file_path TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS batch_reports (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    format TEXT NOT NULL,
    status TEXT NOT NULL,
    file_path TEXT NOT NULL,
    patient_count INTEGER NOT NULL,
    generated_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_eeg_files_patient ON eeg_files(patient_id)',
  'CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_task_logs_created ON task_logs(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_data_assets_subject ON data_assets(subject_code, cohort, stage)',
  'CREATE INDEX IF NOT EXISTS idx_data_assets_patient ON data_assets(patient_id)',
  'CREATE INDEX IF NOT EXISTS idx_data_assets_match ON data_assets(match_status)',
  'CREATE INDEX IF NOT EXISTS idx_data_completeness_patient ON data_completeness(patient_id)',
  'CREATE INDEX IF NOT EXISTS idx_feature_artifacts_patient ON feature_artifacts(patient_id, kind, state)',
  'CREATE INDEX IF NOT EXISTS idx_prediction_models_task ON prediction_models(task_id)',
  'CREATE INDEX IF NOT EXISTS idx_prediction_results_patient ON prediction_results(patient_id, task_id, updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_explanation_artifacts_patient ON explanation_artifacts(patient_id, task_id, model_id)',
  'CREATE INDEX IF NOT EXISTS idx_patient_reports_patient ON patient_reports(patient_id, generated_at)',
  'CREATE INDEX IF NOT EXISTS idx_batch_reports_generated ON batch_reports(generated_at)',
] as const;

const schemaBackfills = [
  `ALTER TABLE prediction_models ADD COLUMN model_family TEXT NOT NULL DEFAULT 'traditional_ml'`,
  `ALTER TABLE prediction_models ADD COLUMN checkpoint_mode TEXT NOT NULL DEFAULT 'external_script'`,
  `ALTER TABLE prediction_results ADD COLUMN feature_artifact_ids_json TEXT NOT NULL DEFAULT '[]'`,
] as const;

export function nowIso(): string {
  return new Date().toISOString();
}

function enableForeignKeys(db: Database): void {
  db.run('PRAGMA foreign_keys = ON');
}

function runMigrations(db: Database): void {
  enableForeignKeys(db);

  for (const migration of migrations) {
    db.run(migration);
  }

  for (const migration of schemaBackfills) {
    try {
      db.run(migration);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

      if (!message.includes('duplicate column name')) {
        throw error;
      }
    }
  }

  enableForeignKeys(db);
}

export async function openLocalDatabase(dataRoot?: string): Promise<LocalDatabase> {
  const paths = ensureAppPaths(dataRoot);
  const SQL = await getSqlModule();
  const db = fs.existsSync(paths.databasePath)
    ? new SQL.Database(fs.readFileSync(paths.databasePath))
    : new SQL.Database();

  runMigrations(db);

  const save = () => {
    fs.writeFileSync(paths.databasePath, Buffer.from(db.export()));
    enableForeignKeys(db);
  };

  save();

  return {
    db,
    paths,
    save,
    close: () => {
      save();
      db.close();
    },
  };
}
