# Local Database Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current mock-only patient workbench, task queue, logs, and settings with a persistent local SQLite backend inside the Electron desktop app.

**Architecture:** Keep the Gemini-derived `src/App.tsx` visual design as the active UI. Add a narrow Electron IPC bridge, a `sql.js` SQLite-backed local database in the Electron main process, repository functions for patients/files/status/tasks/logs/settings, and a renderer `apiClient` that uses the bridge in Electron while keeping mock fallback for browser-only development.

**Tech Stack:** React, TypeScript, Vite, Electron, `sql.js`, Vitest, React Testing Library, Node filesystem APIs.

---

## Scope

This plan implements Phase B from:

`docs/superpowers/specs/2026-06-14-local-backend-and-preprocess-design.md`

Included:

- Local app data directory under the current user's Documents folder.
- SQLite database file at `Documents/StrokePredictSystem/app.db`.
- Database tables for patients, EEG files, workflow status, tasks, task logs, and settings.
- Safe Electron preload API exposed as `window.neuroPredict`.
- Renderer service functions in `src/services/apiClient.ts`.
- Patient workbench reads real backend data when running in Electron.
- Right-side task queue and log panel read real backend data when running in Electron.
- Environment settings are saved and loaded from the database.
- Database-only preprocessing task creation is added as a bridge to the next MATLAB phase.
- Browser development keeps the current mock data fallback, so `npm run dev` still displays the design at `http://127.0.0.1:5173/`.

Excluded:

- Real MATLAB process launch.
- Real EEGLAB manual checkpoint control.
- Real feature generation.
- Real model prediction.
- Installer generation.
- Excel `.xlsx` import. The first import format is UTF-8 CSV.

## File Structure

Create these files:

- `src/domain/backendTypes.ts`: shared renderer/main process DTOs for workbench data, settings, import results, and preprocessing task requests.
- `src/electron/backend/appPaths.ts`: resolves and creates the local app data directories.
- `src/electron/backend/database.ts`: initializes `sql.js`, opens/saves `app.db`, and runs migrations.
- `src/electron/backend/repositories.ts`: CRUD and query functions for patients, EEG files, statuses, tasks, logs, and settings.
- `src/electron/backend/importPatients.ts`: parses CSV patient lists and writes patient rows.
- `src/electron/backend/scanEegFiles.ts`: scans a selected EEG folder and registers matching EO/EC files.
- `src/electron/backend/preprocessTasks.ts`: validates preprocessing requests and creates database-only preprocessing tasks.
- `src/electron/backend/ipcHandlers.ts`: registers all `ipcMain.handle(...)` backend handlers.
- `tests/electron/backend/database.test.ts`: verifies migrations and persistence.
- `tests/electron/backend/repositories.test.ts`: verifies repository behavior.
- `tests/electron/backend/importPatients.test.ts`: verifies CSV import behavior.
- `tests/electron/backend/preprocessTasks.test.ts`: verifies preprocessing task validation and creation.

Modify these files:

- `package.json`: add dependencies and test/build scripts if needed.
- `tsconfig.node.json`: include `src/domain` types for Electron compile.
- `src/electron/main.ts`: initialize database and register IPC handlers.
- `src/electron/preload.ts`: expose the typed backend API.
- `src/services/apiClient.ts`: call `window.neuroPredict` when available and mock fallback otherwise.
- `src/App.tsx`: load workbench data from `apiClient`, pass backend rows to the Gemini workbench/right panel, and keep mock fallback.
- `src/features/settings/SettingsView.tsx` only if the active app starts using the split settings view again. The current active Gemini UI has an inline `SettingsView` in `src/App.tsx`, so implementation should modify `src/App.tsx` first.
- `tests/setup.ts`: add `window.neuroPredict` reset helpers only if React tests need them.
- `tests/features/workbench.test.tsx`: verify backend data replaces mock rows when the bridge exists.

## Task 1: Add Dependencies And Compile Configuration

**Files:**

- Modify: `package.json`
- Modify: `tsconfig.node.json`

- [ ] **Step 1: Add runtime dependencies**

Run:

```powershell
npm install sql.js papaparse
npm install -D @types/sql.js @types/papaparse
```

Expected:

- `package.json` contains `sql.js` and `papaparse`.
- `package-lock.json` is updated.
- No native module compilation is required.

- [ ] **Step 2: Update Electron TypeScript config**

Modify `tsconfig.node.json` so Electron code can import shared DTO types from `src/domain`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "skipLibCheck": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist-electron",
    "rootDir": "src",
    "strict": true,
    "types": ["node"]
  },
  "include": ["src/electron/**/*.ts", "src/domain/**/*.ts"]
}
```

- [ ] **Step 3: Run compile check**

Run:

```powershell
npm run electron:compile
```

Expected:

- PASS.
- Electron source files are emitted under `dist-electron/electron`.
- Shared DTO files are emitted under `dist-electron/domain`.
- Runtime path adjustment is handled in Task 7 and Task 8.

## Task 2: Define Shared Backend DTOs

**Files:**

- Create: `src/domain/backendTypes.ts`

- [ ] **Step 1: Create shared DTO definitions**

Create `src/domain/backendTypes.ts`:

```ts
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
    | 'report_export';
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

export interface BackendTaskLog {
  id: string;
  taskId: string | null;
  patientId: string | null;
  level: BackendLogLevel;
  source: 'app' | 'database' | 'matlab' | 'eeglab' | 'prediction' | 'report';
  message: string;
  createdAt: string;
}

export interface WorkbenchPatientRow {
  id: string;
  hand: string;
  eo: boolean;
  ec: boolean;
  preStatus: string;
  featStatus: string;
  task: string;
  predict: string;
  prob: number | null;
  report: string;
}

export interface RightPanelTaskRow {
  id: string;
  patient: string;
  name: string;
  progress?: number;
  time?: string;
  action?: string;
}

export interface RightPanelTasks {
  running: RightPanelTaskRow[];
  manual: RightPanelTaskRow[];
  failed: RightPanelTaskRow[];
}

export interface RightPanelLogLine {
  id: string;
  text: string;
  level: BackendLogLevel;
}

export interface WorkbenchData {
  patients: WorkbenchPatientRow[];
  tasks: RightPanelTasks;
  logs: RightPanelLogLine[];
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

export interface BackendSettings {
  dataRoot: string;
  outputRoot: string;
  matlabExecutable: string;
  eeglabPath: string;
  defaultElectrodeLocationFile: string;
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
```

- [ ] **Step 2: Run type check**

Run:

```powershell
npm run build
```

Expected:

- PASS.

## Task 3: Add App Paths And Database Initialization

**Files:**

- Create: `src/electron/backend/appPaths.ts`
- Create: `src/electron/backend/database.ts`
- Create: `tests/electron/backend/database.test.ts`

- [ ] **Step 1: Create path helpers**

Create `src/electron/backend/appPaths.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AppPaths {
  dataRoot: string;
  databasePath: string;
  outputsRoot: string;
  logsRoot: string;
}

export function resolveDefaultDataRoot(homeDir = os.homedir()): string {
  return path.join(homeDir, 'Documents', 'StrokePredictSystem');
}

export function ensureAppPaths(dataRoot = resolveDefaultDataRoot()): AppPaths {
  const outputsRoot = path.join(dataRoot, 'outputs');
  const logsRoot = path.join(dataRoot, 'logs');
  const requiredDirs = [
    dataRoot,
    outputsRoot,
    path.join(outputsRoot, 'preprocess'),
    path.join(outputsRoot, 'features'),
    path.join(outputsRoot, 'predictions'),
    path.join(outputsRoot, 'reports'),
    logsRoot,
  ];

  for (const dir of requiredDirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return {
    dataRoot,
    databasePath: path.join(dataRoot, 'app.db'),
    outputsRoot,
    logsRoot,
  };
}
```

- [ ] **Step 2: Create database module**

Create `src/electron/backend/database.ts`:

```ts
import fs from 'node:fs';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { ensureAppPaths, type AppPaths } from './appPaths.js';

export interface LocalDatabase {
  db: Database;
  paths: AppPaths;
  save: () => void;
  close: () => void;
}

let SQL: SqlJsStatic | null = null;

async function getSql(): Promise<SqlJsStatic> {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
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
  `CREATE INDEX IF NOT EXISTS idx_eeg_files_patient ON eeg_files(patient_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_task_logs_created ON task_logs(created_at)`,
];

export function nowIso(): string {
  return new Date().toISOString();
}

function runMigrations(db: Database): void {
  db.run('PRAGMA foreign_keys = ON');
  for (const sql of migrations) {
    db.run(sql);
  }
}

export async function openLocalDatabase(dataRoot?: string): Promise<LocalDatabase> {
  const paths = ensureAppPaths(dataRoot);
  const sql = await getSql();
  const db = fs.existsSync(paths.databasePath)
    ? new sql.Database(fs.readFileSync(paths.databasePath))
    : new sql.Database();

  runMigrations(db);

  const save = () => {
    const bytes = db.export();
    fs.writeFileSync(paths.databasePath, Buffer.from(bytes));
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
```

- [ ] **Step 3: Write database test**

Create `tests/electron/backend/database.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../../../src/electron/backend/database';

const roots: string[] = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-db-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('local database initialization', () => {
  it('creates app directories and required tables', async () => {
    const root = tempRoot();
    const local = await openLocalDatabase(root);

    const tables = local.db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )[0].values.flat();

    expect(fs.existsSync(path.join(root, 'app.db'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'outputs', 'preprocess'))).toBe(true);
    expect(tables).toContain('patients');
    expect(tables).toContain('eeg_files');
    expect(tables).toContain('workflow_status');
    expect(tables).toContain('tasks');
    expect(tables).toContain('task_logs');
    expect(tables).toContain('settings');

    local.close();
  });
});
```

- [ ] **Step 4: Run the database test**

Run:

```powershell
npm run test -- tests/electron/backend/database.test.ts
```

Expected:

- PASS.

## Task 4: Implement Repositories

**Files:**

- Create: `src/electron/backend/repositories.ts`
- Create: `tests/electron/backend/repositories.test.ts`

- [ ] **Step 1: Create repository functions**

Create `src/electron/backend/repositories.ts` with these exported functions:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Database } from 'sql.js';
import type {
  BackendSettings,
  CreatePatientInput,
  RegisterEegFileInput,
  WorkbenchData,
} from '../../domain/backendTypes.js';
import { nowIso } from './database.js';

const defaultSettings: BackendSettings = {
  dataRoot: '',
  outputRoot: '',
  matlabExecutable: '',
  eeglabPath: '',
  defaultElectrodeLocationFile: '',
  defaultDownsampleRate: '500',
  defaultHighPassHz: '1',
  defaultLowPassHz: '45',
  defaultNotchHz: '50',
};

function firstRow<T>(db: Database, sql: string, params: unknown[] = []): T | null {
  const stmt = db.prepare(sql, params);
  try {
    if (!stmt.step()) return null;
    return stmt.getAsObject() as T;
  } finally {
    stmt.free();
  }
}

function allRows<T>(db: Database, sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql, params);
  const rows: T[] = [];
  try {
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
    return rows;
  } finally {
    stmt.free();
  }
}

export function createPatient(db: Database, input: CreatePatientInput): string {
  const now = nowIso();
  const existing = firstRow<{ id: string }>(
    db,
    'SELECT id FROM patients WHERE subject_code = ?',
    [input.subjectCode],
  );
  const id = existing?.id ?? randomUUID();

  if (existing) {
    db.run(
      `UPDATE patients
       SET name = ?, age = ?, sex = ?, diagnosis = ?, affected_hand = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.name ?? '',
        input.age ?? null,
        input.sex ?? '',
        input.diagnosis ?? '',
        input.affectedHand ?? '',
        input.notes ?? '',
        now,
        id,
      ],
    );
    return id;
  }

  db.run(
    `INSERT INTO patients
     (id, subject_code, name, age, sex, diagnosis, affected_hand, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.subjectCode,
      input.name ?? '',
      input.age ?? null,
      input.sex ?? '',
      input.diagnosis ?? '',
      input.affectedHand ?? '',
      input.notes ?? '',
      now,
      now,
    ],
  );
  db.run(
    `INSERT INTO workflow_status
     (patient_id, preprocess_status, feature_status, prediction_status, explanation_status, report_status, last_error, updated_at)
     VALUES (?, '未开始', '未开始', '未开始', '未生成', '未生成', '', ?)`,
    [id, now],
  );
  addTaskLog(db, {
    taskId: null,
    patientId: id,
    level: 'info',
    source: 'database',
    message: `已创建患者 ${input.subjectCode}`,
  });
  return id;
}

export function registerEegFile(db: Database, input: RegisterEegFileInput): string {
  const now = nowIso();
  const id = randomUUID();
  const ext = path.extname(input.filePath).replace('.', '').toLowerCase() || 'unknown';
  db.run(
    `INSERT OR REPLACE INTO eeg_files
     (id, patient_id, condition, file_path, file_format, exists_on_disk, registered_at, last_checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.patientId,
      input.condition,
      input.filePath,
      ext,
      fs.existsSync(input.filePath) ? 1 : 0,
      now,
      now,
    ],
  );
  addTaskLog(db, {
    taskId: null,
    patientId: input.patientId,
    level: 'info',
    source: 'database',
    message: `已登记 ${input.condition} EEG 文件: ${input.filePath}`,
  });
  return id;
}

export function addTask(
  db: Database,
  input: {
    type: string;
    patientId?: string | null;
    batchId?: string | null;
    status?: string;
    priority?: 'normal' | 'high';
    inputJson?: string;
    outputJson?: string;
    errorMessage?: string;
  },
): string {
  const id = randomUUID();
  const now = nowIso();
  db.run(
    `INSERT INTO tasks
     (id, type, patient_id, batch_id, status, priority, input_json, output_json, error_message, created_at, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    [
      id,
      input.type,
      input.patientId ?? null,
      input.batchId ?? null,
      input.status ?? 'queued',
      input.priority ?? 'normal',
      input.inputJson ?? '{}',
      input.outputJson ?? '{}',
      input.errorMessage ?? '',
      now,
    ],
  );
  return id;
}

export function addTaskLog(
  db: Database,
  input: {
    taskId: string | null;
    patientId: string | null;
    level: 'info' | 'warning' | 'error';
    source: 'app' | 'database' | 'matlab' | 'eeglab' | 'prediction' | 'report';
    message: string;
  },
): string {
  const id = randomUUID();
  db.run(
    `INSERT INTO task_logs (id, task_id, patient_id, level, source, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.taskId, input.patientId, input.level, input.source, input.message, nowIso()],
  );
  return id;
}

export function getSettings(db: Database): BackendSettings {
  const settings = { ...defaultSettings };
  const rows = allRows<{ key: string; value: string }>(
    db,
    'SELECT key, value FROM settings',
  );
  for (const row of rows) {
    if (row.key in settings) {
      settings[row.key as keyof BackendSettings] = row.value;
    }
  }
  return settings;
}

export function updateSettings(db: Database, input: Partial<BackendSettings>): BackendSettings {
  const now = nowIso();
  for (const [key, value] of Object.entries(input)) {
    if (!(key in defaultSettings)) continue;
    db.run(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, String(value ?? ''), now],
    );
  }
  return getSettings(db);
}

export function getWorkbenchData(db: Database, dataRoot: string): WorkbenchData {
  const patients = allRows<{
    id: string;
    subject_code: string;
    affected_hand: string;
    preprocess_status: string;
    feature_status: string;
    prediction_status: string;
    report_status: string;
  }>(
    db,
    `SELECT p.id, p.subject_code, p.affected_hand,
            ws.preprocess_status, ws.feature_status, ws.prediction_status, ws.report_status
     FROM patients p
     JOIN workflow_status ws ON ws.patient_id = p.id
     ORDER BY p.subject_code`,
  );

  const rows = patients.map((patient) => {
    const files = allRows<{ condition: string; exists_on_disk: number }>(
      db,
      'SELECT condition, exists_on_disk FROM eeg_files WHERE patient_id = ?',
      [patient.id],
    );
    const has = (condition: string) =>
      files.some((file) => file.condition === condition && file.exists_on_disk === 1);

    return {
      id: patient.subject_code,
      hand: patient.affected_hand || '-',
      eo: has('EO'),
      ec: has('EC'),
      preStatus: patient.preprocess_status,
      featStatus: patient.feature_status,
      task: 'tACS_Outcome',
      predict: patient.prediction_status === '已完成' ? '待接入预测结果' : '-',
      prob: null,
      report: patient.report_status,
    };
  });

  const taskRows = allRows<{
    id: string;
    patient_id: string | null;
    type: string;
    status: string;
    error_message: string;
    created_at: string;
  }>(
    db,
    `SELECT id, patient_id, type, status, error_message, created_at
     FROM tasks ORDER BY created_at DESC LIMIT 30`,
  );

  const logs = allRows<{
    id: string;
    level: 'info' | 'warning' | 'error';
    source: string;
    message: string;
    created_at: string;
  }>(
    db,
    `SELECT id, level, source, message, created_at
     FROM task_logs ORDER BY created_at DESC LIMIT 80`,
  ).map((log) => ({
    id: log.id,
    level: log.level,
    text: `[${log.level.toUpperCase()}] ${log.created_at} - ${log.source}: ${log.message}`,
  }));

  const mapTask = (task: typeof taskRows[number]) => ({
    id: task.id,
    patient: task.patient_id ?? 'batch',
    name: task.type,
    action: task.status === 'failed' ? '查看错误并重试' : '继续',
  });

  return {
    patients: rows,
    tasks: {
      running: taskRows.filter((task) => task.status === 'running').map(mapTask),
      manual: taskRows.filter((task) => task.status === 'waiting_manual').map(mapTask),
      failed: taskRows.filter((task) => task.status === 'failed').map(mapTask),
    },
    logs,
    dataRoot,
  };
}
```

- [ ] **Step 2: Write repository tests**

Create `tests/electron/backend/repositories.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../../../src/electron/backend/database';
import {
  addTask,
  addTaskLog,
  createPatient,
  getSettings,
  getWorkbenchData,
  registerEegFile,
  updateSettings,
} from '../../../src/electron/backend/repositories';

const roots: string[] = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-repo-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('backend repositories', () => {
  it('creates a patient with default status and returns workbench data', async () => {
    const local = await openLocalDatabase(tempRoot());
    const patientId = createPatient(local.db, {
      subjectCode: 'sub01',
      affectedHand: '右手',
    });
    const eoPath = path.join(local.paths.dataRoot, 'sub01_EO.cnt');
    fs.writeFileSync(eoPath, 'test');
    registerEegFile(local.db, { patientId, condition: 'EO', filePath: eoPath });
    local.save();

    const data = getWorkbenchData(local.db, local.paths.dataRoot);

    expect(data.patients).toEqual([
      expect.objectContaining({
        id: 'sub01',
        hand: '右手',
        eo: true,
        ec: false,
        preStatus: '未开始',
        featStatus: '未开始',
      }),
    ]);
    local.close();
  });

  it('persists settings and task logs', async () => {
    const local = await openLocalDatabase(tempRoot());
    updateSettings(local.db, { matlabExecutable: 'C:\\Program Files\\MATLAB\\R2024b\\bin\\matlab.exe' });
    const taskId = addTask(local.db, { type: 'scan_eeg_files', status: 'running' });
    addTaskLog(local.db, {
      taskId,
      patientId: null,
      level: 'info',
      source: 'database',
      message: '扫描 EEG 文件夹',
    });
    local.save();

    expect(getSettings(local.db).matlabExecutable).toContain('MATLAB');
    expect(getWorkbenchData(local.db, local.paths.dataRoot).tasks.running).toHaveLength(1);
    expect(getWorkbenchData(local.db, local.paths.dataRoot).logs[0].text).toContain('扫描 EEG 文件夹');
    local.close();
  });
});
```

- [ ] **Step 3: Run repository tests**

Run:

```powershell
npm run test -- tests/electron/backend/repositories.test.ts
```

Expected:

- PASS.

## Task 5: Add CSV Patient Import And EEG Folder Scan

**Files:**

- Create: `src/electron/backend/importPatients.ts`
- Create: `src/electron/backend/scanEegFiles.ts`
- Create: `tests/electron/backend/importPatients.test.ts`

- [ ] **Step 1: Create CSV import**

Create `src/electron/backend/importPatients.ts`:

```ts
import fs from 'node:fs';
import Papa from 'papaparse';
import type { Database } from 'sql.js';
import type { ImportPatientsResult } from '../../domain/backendTypes.js';
import { addTask, addTaskLog, createPatient } from './repositories.js';

interface PatientCsvRow {
  subject_code?: string;
  subjectCode?: string;
  name?: string;
  age?: string;
  sex?: '男' | '女' | '';
  diagnosis?: string;
  affected_hand?: '左手' | '右手' | '双手' | '';
  affectedHand?: '左手' | '右手' | '双手' | '';
  notes?: string;
}

export function importPatientsFromCsv(db: Database, csvPath: string): ImportPatientsResult {
  const taskId = addTask(db, {
    type: 'import_patients',
    status: 'running',
    inputJson: JSON.stringify({ csvPath }),
  });

  const text = fs.readFileSync(csvPath, 'utf8');
  const parsed = Papa.parse<PatientCsvRow>(text, {
    header: true,
    skipEmptyLines: true,
  });
  const result: ImportPatientsResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  for (const row of parsed.data) {
    const subjectCode = (row.subject_code || row.subjectCode || '').trim();
    if (!subjectCode) {
      result.skipped += 1;
      result.errors.push('存在一行缺少 subject_code');
      continue;
    }

    createPatient(db, {
      subjectCode,
      name: row.name?.trim() ?? '',
      age: row.age ? Number(row.age) : null,
      sex: row.sex ?? '',
      diagnosis: row.diagnosis?.trim() ?? '',
      affectedHand: row.affected_hand ?? row.affectedHand ?? '',
      notes: row.notes?.trim() ?? '',
    });
    result.created += 1;
  }

  addTaskLog(db, {
    taskId,
    patientId: null,
    level: result.errors.length ? 'warning' : 'info',
    source: 'database',
    message: `患者 CSV 导入完成: 创建或更新 ${result.created} 行，跳过 ${result.skipped} 行`,
  });

  db.run(
    "UPDATE tasks SET status = 'completed', finished_at = datetime('now') WHERE id = ?",
    [taskId],
  );
  return result;
}
```

- [ ] **Step 2: Create EEG folder scanner**

Create `src/electron/backend/scanEegFiles.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'sql.js';
import type { EegCondition, ScanEegFolderResult } from '../../domain/backendTypes.js';
import { addTask, addTaskLog, registerEegFile } from './repositories.js';

const eegExtensions = new Set(['.cnt', '.set', '.edf', '.bdf']);

function walkFiles(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function detectCondition(filePath: string): EegCondition {
  const name = path.basename(filePath).toLowerCase();
  if (/(^|[_-])(eo|eyesopen|open)([_-]|\\.)/.test(name)) return 'EO';
  if (/(^|[_-])(ec|eyesclosed|closed)([_-]|\\.)/.test(name)) return 'EC';
  return 'UNKNOWN';
}

export function scanEegFolderForPatients(
  db: Database,
  folderPath: string,
): ScanEegFolderResult {
  const taskId = addTask(db, {
    type: 'scan_eeg_files',
    status: 'running',
    inputJson: JSON.stringify({ folderPath }),
  });
  const patients = db.exec('SELECT id, subject_code FROM patients ORDER BY subject_code')[0]?.values ?? [];
  const files = walkFiles(folderPath).filter((file) => eegExtensions.has(path.extname(file).toLowerCase()));
  const result: ScanEegFolderResult = {
    scannedFiles: files.length,
    registeredFiles: 0,
    unmatchedFiles: [],
  };

  for (const file of files) {
    const lower = path.basename(file).toLowerCase();
    const match = patients.find(([, subjectCode]) =>
      lower.includes(String(subjectCode).toLowerCase()),
    );
    if (!match) {
      result.unmatchedFiles.push(file);
      continue;
    }
    registerEegFile(db, {
      patientId: String(match[0]),
      condition: detectCondition(file),
      filePath: file,
    });
    result.registeredFiles += 1;
  }

  addTaskLog(db, {
    taskId,
    patientId: null,
    level: result.unmatchedFiles.length ? 'warning' : 'info',
    source: 'database',
    message: `EEG 文件夹扫描完成: 扫描 ${result.scannedFiles} 个文件，登记 ${result.registeredFiles} 个文件`,
  });
  db.run(
    "UPDATE tasks SET status = 'completed', output_json = ?, finished_at = datetime('now') WHERE id = ?",
    [JSON.stringify(result), taskId],
  );
  return result;
}
```

- [ ] **Step 3: Write import and scan tests**

Create `tests/electron/backend/importPatients.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../../../src/electron/backend/database';
import { importPatientsFromCsv } from '../../../src/electron/backend/importPatients';
import { scanEegFolderForPatients } from '../../../src/electron/backend/scanEegFiles';
import { getWorkbenchData } from '../../../src/electron/backend/repositories';

const roots: string[] = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-import-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('patient CSV import and EEG folder scan', () => {
  it('imports patients and registers matching EO/EC files', async () => {
    const root = tempRoot();
    const csvPath = path.join(root, 'patients.csv');
    fs.writeFileSync(
      csvPath,
      'subject_code,name,age,sex,affected_hand\\nsub01,测试一,61,女,右手\\nsub02,测试二,58,男,左手\\n',
      'utf8',
    );
    const eegRoot = path.join(root, 'eeg');
    fs.mkdirSync(eegRoot);
    fs.writeFileSync(path.join(eegRoot, 'sub01_EO.cnt'), 'eo');
    fs.writeFileSync(path.join(eegRoot, 'sub01_EC.cnt'), 'ec');
    fs.writeFileSync(path.join(eegRoot, 'unknown_EO.cnt'), 'unknown');

    const local = await openLocalDatabase(root);
    const imported = importPatientsFromCsv(local.db, csvPath);
    const scanned = scanEegFolderForPatients(local.db, eegRoot);
    const data = getWorkbenchData(local.db, local.paths.dataRoot);

    expect(imported.created).toBe(2);
    expect(scanned.scannedFiles).toBe(3);
    expect(scanned.registeredFiles).toBe(2);
    expect(scanned.unmatchedFiles).toHaveLength(1);
    expect(data.patients.find((row) => row.id === 'sub01')).toEqual(
      expect.objectContaining({ eo: true, ec: true }),
    );
    local.close();
  });
});
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm run test -- tests/electron/backend/importPatients.test.ts
```

Expected:

- PASS.

## Task 6: Add Database-Only Preprocessing Task Creation

**Files:**

- Create: `src/electron/backend/preprocessTasks.ts`
- Create: `tests/electron/backend/preprocessTasks.test.ts`

- [ ] **Step 1: Create preprocessing task service**

Create `src/electron/backend/preprocessTasks.ts`:

```ts
import type { Database } from 'sql.js';
import type { ApiResult, PreprocessBatchInput } from '../../domain/backendTypes.js';
import { addTask, addTaskLog } from './repositories.js';

function hasReferenceConflict(input: PreprocessBatchInput): boolean {
  const removed = new Set(input.selectedEmptyChannels.map((channel) => channel.toUpperCase()));
  return input.referenceMode === 'm1m2' && (removed.has('M1') || removed.has('M2'));
}

export function createPreprocessBatch(
  db: Database,
  input: PreprocessBatchInput,
): ApiResult {
  if (input.patientIds.length === 0) {
    return { ok: false, message: '请先选择至少一位患者。' };
  }
  if (hasReferenceConflict(input)) {
    return {
      ok: false,
      message: 'M1/M2 已在移除电极列表中，不能再选择 M1/M2 重参考。',
    };
  }

  const batchId = `preprocess-${Date.now()}`;
  for (const patientId of input.patientIds) {
    const taskId = addTask(db, {
      type: 'preprocess',
      patientId,
      batchId,
      status: 'queued',
      inputJson: JSON.stringify(input),
    });
    addTaskLog(db, {
      taskId,
      patientId,
      level: 'info',
      source: 'app',
      message: '已创建数据库预处理任务，等待 MATLAB 执行器接入。',
    });
  }

  return {
    ok: true,
    message: `已创建 ${input.patientIds.length} 个预处理任务。`,
  };
}
```

- [ ] **Step 2: Write preprocessing task tests**

Create `tests/electron/backend/preprocessTasks.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../../../src/electron/backend/database';
import { createPreprocessBatch } from '../../../src/electron/backend/preprocessTasks';
import { createPatient, getWorkbenchData } from '../../../src/electron/backend/repositories';

const roots: string[] = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-preprocess-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('database-only preprocessing tasks', () => {
  it('blocks M1/M2 reference when M1 is removed', async () => {
    const local = await openLocalDatabase(tempRoot());
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });

    const result = createPreprocessBatch(local.db, {
      patientIds: [patientId],
      selectedEmptyChannels: ['M1'],
      selectedBadChannels: [],
      referenceMode: 'm1m2',
      downsampleRate: 500,
      highPassHz: 1,
      lowPassHz: 45,
      notchHz: 50,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('不能再选择 M1/M2 重参考');
    local.close();
  });

  it('creates queued preprocess tasks for selected patients', async () => {
    const local = await openLocalDatabase(tempRoot());
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });

    const result = createPreprocessBatch(local.db, {
      patientIds: [patientId],
      selectedEmptyChannels: ['HEO', 'VEO', 'EKG', 'EMG'],
      selectedBadChannels: ['F3'],
      referenceMode: 'average',
      downsampleRate: 500,
      highPassHz: 1,
      lowPassHz: 45,
      notchHz: 50,
    });

    expect(result.ok).toBe(true);
    expect(getWorkbenchData(local.db, local.paths.dataRoot).logs[0].text).toContain(
      '已创建数据库预处理任务',
    );
    local.close();
  });
});
```

- [ ] **Step 3: Run preprocessing task tests**

Run:

```powershell
npm run test -- tests/electron/backend/preprocessTasks.test.ts
```

Expected:

- PASS.

## Task 7: Register Electron IPC Handlers

**Files:**

- Create: `src/electron/backend/ipcHandlers.ts`
- Modify: `src/electron/main.ts`

- [ ] **Step 1: Create IPC handler registration**

Create `src/electron/backend/ipcHandlers.ts`:

```ts
import { dialog, ipcMain } from 'electron';
import type { LocalDatabase } from './database.js';
import {
  createPatient,
  getSettings,
  getWorkbenchData,
  registerEegFile,
  updateSettings,
} from './repositories.js';
import { importPatientsFromCsv } from './importPatients.js';
import { scanEegFolderForPatients } from './scanEegFiles.js';
import { createPreprocessBatch } from './preprocessTasks.js';
import type {
  BackendSettings,
  CreatePatientInput,
  PreprocessBatchInput,
  RegisterEegFileInput,
} from '../../domain/backendTypes.js';

export function registerIpcHandlers(local: LocalDatabase): void {
  const persist = <T>(value: T): T => {
    local.save();
    return value;
  };

  ipcMain.handle('backend:getWorkbenchData', () =>
    getWorkbenchData(local.db, local.paths.dataRoot),
  );
  ipcMain.handle('backend:createPatient', (_event, input: CreatePatientInput) =>
    persist(createPatient(local.db, input)),
  );
  ipcMain.handle('backend:registerEegFile', (_event, input: RegisterEegFileInput) =>
    persist(registerEegFile(local.db, input)),
  );
  ipcMain.handle('backend:getSettings', () => getSettings(local.db));
  ipcMain.handle('backend:updateSettings', (_event, input: Partial<BackendSettings>) =>
    persist(updateSettings(local.db, input)),
  );
  ipcMain.handle('backend:createPreprocessBatch', (_event, input: PreprocessBatchInput) =>
    persist(createPreprocessBatch(local.db, input)),
  );
  ipcMain.handle('backend:importPatientsCsv', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择患者 CSV 文件',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { created: 0, updated: 0, skipped: 0, errors: ['用户取消选择'] };
    }
    return persist(importPatientsFromCsv(local.db, result.filePaths[0]));
  });
  ipcMain.handle('backend:scanEegFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择基线 EEG 文件夹',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { scannedFiles: 0, registeredFiles: 0, unmatchedFiles: [] };
    }
    return persist(scanEegFolderForPatients(local.db, result.filePaths[0]));
  });
}
```

- [ ] **Step 2: Initialize database in Electron main process**

Modify `src/electron/main.ts`:

```ts
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLocalDatabase, type LocalDatabase } from './backend/database.js';
import { registerIpcHandlers } from './backend/ipcHandlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let localDatabase: LocalDatabase | null = null;

function createWindow() {
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'NeuroPredict',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173';

  if (app.isPackaged) {
    void window.loadFile(path.join(__dirname, '../../dist/index.html'));
  } else {
    void window.loadURL(devServerUrl);
  }
}

app.whenReady().then(async () => {
  localDatabase = await openLocalDatabase();
  registerIpcHandlers(localDatabase);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  localDatabase?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

- [ ] **Step 3: Run Electron compile**

Run:

```powershell
npm run electron:compile
```

Expected:

- PASS.
- If `main` path now compiles to `dist-electron/electron/main.js`, update `package.json` in Task 8.

## Task 8: Expose The Preload Bridge

**Files:**

- Modify: `src/electron/preload.ts`
- Modify: `package.json` if Electron output path changed

- [ ] **Step 1: Replace preload bridge stub**

Modify `src/electron/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type {
  BackendSettings,
  CreatePatientInput,
  PreprocessBatchInput,
  RegisterEegFileInput,
} from '../domain/backendTypes.js';

const neuroPredict = {
  platform: process.platform,
  database: {
    getWorkbenchData: () => ipcRenderer.invoke('backend:getWorkbenchData'),
    createPatient: (input: CreatePatientInput) =>
      ipcRenderer.invoke('backend:createPatient', input),
    registerEegFile: (input: RegisterEegFileInput) =>
      ipcRenderer.invoke('backend:registerEegFile', input),
    importPatientsCsv: () => ipcRenderer.invoke('backend:importPatientsCsv'),
    scanEegFolder: () => ipcRenderer.invoke('backend:scanEegFolder'),
  },
  tasks: {
    createPreprocessBatch: (input: PreprocessBatchInput) =>
      ipcRenderer.invoke('backend:createPreprocessBatch', input),
  },
  settings: {
    getSettings: () => ipcRenderer.invoke('backend:getSettings'),
    updateSettings: (input: Partial<BackendSettings>) =>
      ipcRenderer.invoke('backend:updateSettings', input),
  },
};

contextBridge.exposeInMainWorld('neuroPredict', neuroPredict);

export type NeuroPredictBridge = typeof neuroPredict;
```

- [ ] **Step 2: Fix Electron main output path if needed**

If `npm run electron:compile` emits `dist-electron/electron/main.js`, modify `package.json`:

```json
{
  "main": "dist-electron/electron/main.js"
}
```

If compile still emits `dist-electron/main.js`, keep the current value.

- [ ] **Step 3: Run compile**

Run:

```powershell
npm run electron:compile
```

Expected:

- PASS.

## Task 9: Update Renderer API Client

**Files:**

- Modify: `src/services/apiClient.ts`
- Create or modify: `src/vite-env.d.ts`

- [ ] **Step 1: Add window bridge type**

Add to `src/vite-env.d.ts`, creating the file if it does not exist:

```ts
/// <reference types="vite/client" />

import type { NeuroPredictBridge } from './electron/preload';

declare global {
  interface Window {
    neuroPredict?: NeuroPredictBridge;
  }
}
```

- [ ] **Step 2: Replace mock-only API client**

Modify `src/services/apiClient.ts`:

```ts
import {
  mockLogs,
  mockPatients,
  mockTasks,
} from '../domain/mockData';
import type {
  ApiResult,
  BackendSettings,
  ImportPatientsResult,
  PreprocessBatchInput,
  ScanEegFolderResult,
  WorkbenchData,
} from '../domain/backendTypes';

function mockWorkbenchData(): WorkbenchData {
  return {
    patients: mockPatients.map((patient) => ({
      id: patient.id,
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
    tasks: {
      running: mockTasks
        .filter((task) => task.status === '处理中')
        .map((task) => ({
          id: task.id,
          patient: task.patientId,
          name: task.task,
          progress: 50,
          time: task.updatedAt,
        })),
      manual: mockTasks
        .filter((task) => task.status === '需复核')
        .map((task) => ({
          id: task.id,
          patient: task.patientId,
          name: task.task,
          action: task.stage,
        })),
      failed: mockTasks
        .filter((task) => task.status === '失败')
        .map((task) => ({
          id: task.id,
          patient: task.patientId,
          name: task.task,
          action: '重试',
        })),
    },
    logs: mockLogs.map((log) => ({
      id: log.id,
      level: log.level,
      text: `[${log.level.toUpperCase()}] ${log.time} - ${log.source}: ${log.message}`,
    })),
    dataRoot: 'D:\\Research\\Stroke_tACS_EEG_Data',
  };
}

export async function getWorkbenchData(): Promise<WorkbenchData> {
  if (window.neuroPredict) {
    return window.neuroPredict.database.getWorkbenchData();
  }
  return mockWorkbenchData();
}

export async function importPatientsCsv(): Promise<ImportPatientsResult> {
  if (!window.neuroPredict) {
    return { created: 0, updated: 0, skipped: 0, errors: ['浏览器预览模式不支持打开本地文件'] };
  }
  return window.neuroPredict.database.importPatientsCsv();
}

export async function scanEegFolder(): Promise<ScanEegFolderResult> {
  if (!window.neuroPredict) {
    return { scannedFiles: 0, registeredFiles: 0, unmatchedFiles: [] };
  }
  return window.neuroPredict.database.scanEegFolder();
}

export async function getSettings(): Promise<BackendSettings | null> {
  if (!window.neuroPredict) return null;
  return window.neuroPredict.settings.getSettings();
}

export async function updateSettings(
  input: Partial<BackendSettings>,
): Promise<BackendSettings | null> {
  if (!window.neuroPredict) return null;
  return window.neuroPredict.settings.updateSettings(input);
}

export async function startPreprocessing(
  request: PreprocessBatchInput,
): Promise<ApiResult> {
  if (window.neuroPredict) {
    return window.neuroPredict.tasks.createPreprocessBatch(request);
  }
  return {
    ok: true,
    message: 'mock ok: 预处理任务已进入浏览器预览队列，未调用后端。',
  };
}
```

- [ ] **Step 3: Run build**

Run:

```powershell
npm run build
```

Expected:

- PASS.

## Task 10: Connect The Active Gemini App To Backend Data

**Files:**

- Modify: `src/App.tsx`
- Modify: `tests/features/workbench.test.tsx`

- [ ] **Step 1: Import backend service and types**

At the top of `src/App.tsx`, add:

```ts
import { getWorkbenchData, importPatientsCsv, scanEegFolder } from './services/apiClient';
```

Keep `// @ts-nocheck` in place for this task because the active Gemini file is not yet fully typed.

- [ ] **Step 2: Make `PatientWorkbench` accept backend rows**

Change:

```tsx
const PatientWorkbench = () => {
```

to:

```tsx
const PatientWorkbench = ({ patients = MOCK_PATIENTS, dataRoot = 'D:\\Research\\Stroke_tACS_EEG_Data', onImportPatients, onScanEegFolder }) => {
```

Inside the component replace:

```ts
const totalPages = Math.ceil(MOCK_PATIENTS.length / pageSize);
const currentPatients = MOCK_PATIENTS.slice((currentPage - 1) * pageSize, currentPage * pageSize);
const endIndex = Math.min(currentPage * pageSize, MOCK_PATIENTS.length);
```

with:

```ts
const totalPages = Math.max(1, Math.ceil(patients.length / pageSize));
const currentPatients = patients.slice((currentPage - 1) * pageSize, currentPage * pageSize);
const endIndex = Math.min(currentPage * pageSize, patients.length);
```

Replace workbench stats that read `MOCK_PATIENTS` with `patients`.

Change the data directory line to:

```tsx
<span>数据目录: {dataRoot}</span>
```

Attach the two top buttons:

```tsx
<button onClick={onImportPatients} ...>
  <FilePlus size={16} /><span>导入患者表</span>
</button>
<button onClick={onScanEegFolder} ...>
  <FolderOpen size={16} /><span>添加基线 EEG 文件夹</span>
</button>
```

Add an empty state inside the table body before mapping rows:

```tsx
{currentPatients.length === 0 ? (
  <tr>
    <td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-500">
      当前数据库还没有患者。请点击“导入患者表”导入 CSV，或后续在患者管理中新增患者。
    </td>
  </tr>
) : null}
```

- [ ] **Step 3: Make `RightPanel` accept backend tasks/logs**

Change:

```tsx
const RightPanel = ({ onClose }) => {
```

to:

```tsx
const RightPanel = ({ onClose, tasks = MOCK_TASKS, logs = MOCK_LOGS }) => {
```

Replace `MOCK_TASKS.running`, `MOCK_TASKS.manual`, `MOCK_TASKS.failed`, and `MOCK_LOGS` with `tasks.running`, `tasks.manual`, `tasks.failed`, and `logs`.

For log rendering, support both old strings and backend objects:

```tsx
{logs.map((log, idx) => {
  const text = typeof log === 'string' ? log : log.text;
  const level = typeof log === 'string'
    ? (log.includes('[WARN]') ? 'warning' : log.includes('[ERR]') ? 'error' : 'info')
    : log.level;
  return (
    <div key={typeof log === 'string' ? idx : log.id} className={`leading-relaxed ${level === 'warning' ? 'text-yellow-400' : level === 'error' ? 'text-red-400' : 'text-slate-300'}`}>
      {text}
    </div>
  );
})}
```

- [ ] **Step 4: Load backend data in `App`**

Inside `App`, add state:

```tsx
const [workbenchData, setWorkbenchData] = useState(null);
const [backendMessage, setBackendMessage] = useState('');
```

Add a refresh function:

```tsx
const refreshWorkbench = async () => {
  const data = await getWorkbenchData();
  setWorkbenchData(data);
};
```

Add effect:

```tsx
React.useEffect(() => {
  void refreshWorkbench();
}, []);
```

Add handlers:

```tsx
const handleImportPatients = async () => {
  const result = await importPatientsCsv();
  setBackendMessage(`患者导入完成：${result.created} 行，跳过 ${result.skipped} 行`);
  await refreshWorkbench();
};

const handleScanEegFolder = async () => {
  const result = await scanEegFolder();
  setBackendMessage(`EEG 扫描完成：扫描 ${result.scannedFiles} 个文件，登记 ${result.registeredFiles} 个文件`);
  await refreshWorkbench();
};
```

Pass props:

```tsx
<PatientWorkbench
  patients={workbenchData?.patients ?? MOCK_PATIENTS}
  dataRoot={workbenchData?.dataRoot ?? 'D:\\Research\\Stroke_tACS_EEG_Data'}
  onImportPatients={handleImportPatients}
  onScanEegFolder={handleScanEegFolder}
/>
```

and:

```tsx
{isRightPanelOpen && (
  <RightPanel
    onClose={() => setIsRightPanelOpen(false)}
    tasks={workbenchData?.tasks ?? MOCK_TASKS}
    logs={workbenchData?.logs ?? MOCK_LOGS}
  />
)}
```

Show `backendMessage` in a small status line under the top workbench toolbar or in the dark project strip.

- [ ] **Step 5: Write workbench bridge test**

Modify `tests/features/workbench.test.tsx` with a new test:

```tsx
it('uses backend workbench rows when the Electron bridge is available', async () => {
  window.neuroPredict = {
    platform: 'win32',
    database: {
      getWorkbenchData: async () => ({
        patients: [
          {
            id: 'sub99',
            hand: '右肢不利 (LH)',
            eo: true,
            ec: false,
            preStatus: '未开始',
            featStatus: '未开始',
            task: 'tACS_Outcome',
            predict: '-',
            prob: null,
            report: '未生成',
          },
        ],
        tasks: { running: [], manual: [], failed: [] },
        logs: [{ id: 'log-1', level: 'info', text: '[INFO] backend row loaded' }],
        dataRoot: 'C:\\Users\\tester\\Documents\\StrokePredictSystem',
      }),
      createPatient: async () => 'id',
      registerEegFile: async () => 'file-id',
      importPatientsCsv: async () => ({ created: 0, updated: 0, skipped: 0, errors: [] }),
      scanEegFolder: async () => ({ scannedFiles: 0, registeredFiles: 0, unmatchedFiles: [] }),
    },
    tasks: {
      createPreprocessBatch: async () => ({ ok: true, message: 'ok' }),
    },
    settings: {
      getSettings: async () => null,
      updateSettings: async () => null,
    },
  } as never;

  render(<App />);

  expect(await screen.findByText('sub99')).toBeInTheDocument();
  expect(screen.queryByText('sub01')).not.toBeInTheDocument();
  expect(screen.getByText('C:\\Users\\tester\\Documents\\StrokePredictSystem')).toBeInTheDocument();
});
```

Add cleanup in `afterEach`:

```ts
afterEach(() => {
  delete window.neuroPredict;
});
```

- [ ] **Step 6: Run workbench tests**

Run:

```powershell
npm run test -- tests/features/workbench.test.tsx
```

Expected:

- PASS.

## Task 11: Connect Settings Persistence In The Active App

**Files:**

- Modify: `src/App.tsx`
- Modify: `tests/features/workbench.test.tsx` or create `tests/features/settings.test.tsx`

- [ ] **Step 1: Import settings services**

In `src/App.tsx`, extend the service import:

```ts
import {
  getSettings,
  getWorkbenchData,
  importPatientsCsv,
  scanEegFolder,
  updateSettings,
} from './services/apiClient';
```

- [ ] **Step 2: Add settings state in `App`**

Inside `App`, add:

```tsx
const [settings, setSettings] = useState(null);

const refreshSettings = async () => {
  const loaded = await getSettings();
  if (loaded) setSettings(loaded);
};

React.useEffect(() => {
  void refreshSettings();
}, []);

const handleSaveSettings = async (nextSettings) => {
  const saved = await updateSettings(nextSettings);
  if (saved) {
    setSettings(saved);
    setBackendMessage('环境设置已保存到本地数据库。');
  }
};
```

- [ ] **Step 3: Update the active `SettingsView`**

Find the inline `SettingsView` inside `src/App.tsx`. Change it to accept:

```tsx
const SettingsView = ({ settings, onSaveSettings }) => {
```

Use local form state:

```tsx
const [form, setForm] = useState(settings ?? {
  dataRoot: '',
  outputRoot: '',
  matlabExecutable: '',
  eeglabPath: '',
  defaultElectrodeLocationFile: '',
  defaultDownsampleRate: '500',
  defaultHighPassHz: '1',
  defaultLowPassHz: '45',
  defaultNotchHz: '50',
});

React.useEffect(() => {
  if (settings) setForm(settings);
}, [settings]);
```

Replace read-only hard-coded inputs with controlled inputs:

```tsx
<input
  type="text"
  value={form.matlabExecutable}
  onChange={(event) => setForm({ ...form, matlabExecutable: event.target.value })}
  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-300 rounded text-sm text-slate-600 font-mono focus:outline-none"
/>
```

Apply the same controlled pattern to:

- `dataRoot`
- `outputRoot`
- `eeglabPath`
- `defaultElectrodeLocationFile`
- `defaultDownsampleRate`
- `defaultHighPassHz`
- `defaultLowPassHz`
- `defaultNotchHz`

Change the save button to:

```tsx
<button onClick={() => onSaveSettings(form)} ...>
  <Check size={16} className="mr-2" />
  保存所有设置
</button>
```

Pass props in the app router:

```tsx
<SettingsView settings={settings} onSaveSettings={handleSaveSettings} />
```

- [ ] **Step 4: Write settings test**

Create `tests/features/settings.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App';

afterEach(() => {
  delete window.neuroPredict;
});

describe('settings persistence bridge', () => {
  it('loads and saves MATLAB settings through the bridge', async () => {
    const updateSettings = vi.fn(async (input) => ({
      dataRoot: '',
      outputRoot: '',
      matlabExecutable: input.matlabExecutable,
      eeglabPath: '',
      defaultElectrodeLocationFile: '',
      defaultDownsampleRate: '500',
      defaultHighPassHz: '1',
      defaultLowPassHz: '45',
      defaultNotchHz: '50',
    }));
    window.neuroPredict = {
      platform: 'win32',
      database: {
        getWorkbenchData: async () => ({ patients: [], tasks: { running: [], manual: [], failed: [] }, logs: [], dataRoot: '' }),
        createPatient: async () => 'id',
        registerEegFile: async () => 'file-id',
        importPatientsCsv: async () => ({ created: 0, updated: 0, skipped: 0, errors: [] }),
        scanEegFolder: async () => ({ scannedFiles: 0, registeredFiles: 0, unmatchedFiles: [] }),
      },
      tasks: { createPreprocessBatch: async () => ({ ok: true, message: 'ok' }) },
      settings: {
        getSettings: async () => ({
          dataRoot: '',
          outputRoot: '',
          matlabExecutable: 'old-matlab.exe',
          eeglabPath: '',
          defaultElectrodeLocationFile: '',
          defaultDownsampleRate: '500',
          defaultHighPassHz: '1',
          defaultLowPassHz: '45',
          defaultNotchHz: '50',
        }),
        updateSettings,
      },
    } as never;

    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '环境设置' }));
    const matlabInput = await screen.findByDisplayValue('old-matlab.exe');
    await user.clear(matlabInput);
    await user.type(matlabInput, 'new-matlab.exe');
    await user.click(screen.getByRole('button', { name: /保存所有设置/ }));

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ matlabExecutable: 'new-matlab.exe' }),
    );
  });
});
```

- [ ] **Step 5: Run settings test**

Run:

```powershell
npm run test -- tests/features/settings.test.tsx
```

Expected:

- PASS.

## Task 12: Wire Preprocessing Button To Database Task Creation

**Files:**

- Modify: `src/App.tsx`
- Modify: `tests/features/preprocess.test.tsx`

- [ ] **Step 1: Import `startPreprocessing`**

Extend the service import in `src/App.tsx`:

```ts
import {
  getSettings,
  getWorkbenchData,
  importPatientsCsv,
  scanEegFolder,
  startPreprocessing,
  updateSettings,
} from './services/apiClient';
```

- [ ] **Step 2: Add app-level handler**

Inside `App`, add:

```tsx
const handleCreatePreprocessTasks = async (request) => {
  const result = await startPreprocessing(request);
  setBackendMessage(result.message);
  await refreshWorkbench();
  return result;
};
```

Pass it to the preprocessing page:

```tsx
<PreprocessWizard onCreatePreprocessTasks={handleCreatePreprocessTasks} />
```

- [ ] **Step 3: Update active `PreprocessWizard`**

Find the inline `PreprocessWizard` in `src/App.tsx`. Change:

```tsx
const PreprocessWizard = () => {
```

to:

```tsx
const PreprocessWizard = ({ onCreatePreprocessTasks }) => {
```

Find the final/run button for the preprocessing queue. Replace its current no-op behavior with:

```tsx
onClick={() => onCreatePreprocessTasks?.({
  patientIds: MOCK_PATIENTS.map((patient) => patient.id),
  selectedEmptyChannels: removedChannels,
  selectedBadChannels: badChannels,
  referenceMode,
  downsampleRate: 500,
  highPassHz: 1,
  lowPassHz: 45,
  notchHz: 50,
})}
```

Use the actual local state names in the Gemini component:

- removed/empty channel selection state.
- bad-channel interpolation selection state.
- reference mode state.

If the current component stores channel names in Chinese labels, convert them to canonical channel names before sending.

- [ ] **Step 4: Add preprocessing bridge test**

Modify `tests/features/preprocess.test.tsx` with a new test:

```tsx
it('creates database preprocessing tasks from the wizard', async () => {
  const createPreprocessBatch = vi.fn(async () => ({
    ok: true,
    message: '已创建 1 个预处理任务。',
  }));
  window.neuroPredict = {
    platform: 'win32',
    database: {
      getWorkbenchData: async () => ({ patients: [], tasks: { running: [], manual: [], failed: [] }, logs: [], dataRoot: '' }),
      createPatient: async () => 'id',
      registerEegFile: async () => 'file-id',
      importPatientsCsv: async () => ({ created: 0, updated: 0, skipped: 0, errors: [] }),
      scanEegFolder: async () => ({ scannedFiles: 0, registeredFiles: 0, unmatchedFiles: [] }),
    },
    tasks: { createPreprocessBatch },
    settings: { getSettings: async () => null, updateSettings: async () => null },
  } as never;

  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'EEG 预处理向导' }));
  await user.click(screen.getByRole('button', { name: /批量运行|开始预处理|运行队列/ }));

  expect(createPreprocessBatch).toHaveBeenCalledWith(
    expect.objectContaining({
      referenceMode: expect.any(String),
      selectedEmptyChannels: expect.any(Array),
    }),
  );
});
```

- [ ] **Step 5: Run preprocessing tests**

Run:

```powershell
npm run test -- tests/features/preprocess.test.tsx
```

Expected:

- PASS.

## Task 13: Electron Runtime Smoke Test

**Files:**

- Modify only if compile/runtime errors identify a precise path issue.

- [ ] **Step 1: Run all automated checks**

Run:

```powershell
npm run test
npm run build
npm run electron:build
```

Expected:

- All commands PASS.

- [ ] **Step 2: Start the web preview**

Run:

```powershell
npm run dev
```

Expected:

- Vite reports `Local: http://127.0.0.1:5173/`.
- Browser preview still shows mock data because `window.neuroPredict` is unavailable in a normal browser.

- [ ] **Step 3: Start Electron app**

In another terminal:

```powershell
npm run electron:dev
```

Expected:

- Electron window opens.
- `Documents/StrokePredictSystem/app.db` is created.
- The patient table initially shows the empty database state.
- Importing a CSV through `导入患者表` creates patient rows.
- Scanning an EEG folder through `添加基线 EEG 文件夹` updates EO/EC file badges.
- Switching to `环境设置` and saving MATLAB path persists after restarting Electron.

## Task 14: Manual Verification Dataset

**Files:**

- No source files.

- [ ] **Step 1: Create a small CSV locally for manual verification**

Create a temporary CSV outside the repo, such as:

```csv
subject_code,name,age,sex,affected_hand,diagnosis
sub01,测试患者一,61,女,右手,缺血性卒中
sub02,测试患者二,58,男,左手,脑出血恢复期
```

- [ ] **Step 2: Create dummy EEG files**

Create a temporary folder containing:

```text
sub01_EO.cnt
sub01_EC.cnt
sub02_EO.cnt
```

- [ ] **Step 3: Verify in Electron**

Open Electron and perform:

1. Click `导入患者表`, choose the CSV.
2. Click `添加基线 EEG 文件夹`, choose the EEG folder.
3. Confirm `sub01` shows EO and EC.
4. Confirm `sub02` shows EO but missing EC.
5. Open `环境设置`, save a MATLAB path string.
6. Restart Electron.
7. Confirm imported rows and settings remain.

Expected:

- Data persists across app restarts.
- Right-side logs include patient import and EEG folder scan messages.

## Final Verification

Run these commands before claiming Phase B is complete:

```powershell
npm run test
npm run build
npm run electron:build
```

Expected:

- `npm run test`: all tests pass.
- `npm run build`: TypeScript and Vite production build pass.
- `npm run electron:build`: Electron TypeScript compile and Vite build pass.

Also manually verify:

- Browser preview still works at `http://127.0.0.1:5173/`.
- Electron creates `Documents/StrokePredictSystem/app.db`.
- CSV patient import persists after restart.
- EEG folder scan updates EO/EC state.
- Settings save persists after restart.
- Database-only preprocessing task creation writes task/log rows and does not launch MATLAB.

## Follow-Up Plan

After this plan is complete, write a separate Phase A implementation plan for MATLAB/EEGLAB execution. That plan should add:

- MATLAB command builder.
- Per-patient `preprocess_params.json`.
- MATLAB status/log file polling.
- Manual EEGLAB checkpoint waiting and resume.
- Output file validation.
