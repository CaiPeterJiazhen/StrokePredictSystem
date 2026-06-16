# Local Backend And MATLAB Preprocessing Design

## Purpose

Build the first real backend layer for the StrokePredictSystem Windows desktop application. The first backend milestone has two phases:

1. Local database and patient/file management.
2. MATLAB/EEGLAB preprocessing task execution.

The goal is to move the current React/Electron frontend from mock data to persistent local project data while preserving the existing patient-workbench interface. Real prediction, feature generation, explainability computation, and model training are outside this milestone.

## Confirmed Build Order

Phase B comes first, then Phase A.

1. **Phase B: Local database backend**
   - Persist patients, EEG file registrations, workflow statuses, task queue entries, logs, and environment settings.
   - Replace patient workbench, right-side task queue, and log panel mock data with backend data.
   - Keep the frontend layout and Gemini-derived visual design unchanged.

2. **Phase A: MATLAB/EEGLAB preprocessing backend**
   - Use the persisted patients, EEG file paths, settings, and preprocessing parameters to create preprocessing jobs.
   - Run actual preprocessing through MATLAB/EEGLAB scripts.
   - Track automatic steps, manual EEGLAB checkpoints, output files, failures, and retry states.

## Architecture

The first implementation uses Electron IPC with SQLite inside the desktop app.

- React renderer: displays pages and calls typed frontend service functions.
- Electron preload: exposes a narrow, safe `window.neuroPredict` API to the renderer.
- Electron main process: owns filesystem access, SQLite access, task creation, log writing, and MATLAB process launching.
- SQLite database: stores durable local state.
- MATLAB/EEGLAB scripts: perform actual EEG preprocessing after Phase B is working.

This keeps version 1 simple enough to package as a Windows local application. The API boundary should still be shaped so a future Python/FastAPI process can be introduced for feature generation, model inference, and explainability without redesigning the UI.

## Local Data Directory

On first launch, the app creates a local data directory under the current Windows user profile:

```text
Documents/StrokePredictSystem/
```

Initial contents:

```text
Documents/StrokePredictSystem/
  app.db
  outputs/
    preprocess/
    features/
    predictions/
    reports/
  logs/
```

The app stores EEG source file paths in SQLite. It does not copy large raw EEG files by default. Copying files into a managed project directory is a future explicit import option, not part of this milestone.

## Database Design

SQLite stores metadata, workflow state, and task history. Large EEG files and generated artifacts remain on disk.

### `patients`

Stores one row per patient or subject.

Columns:

- `id`: internal UUID.
- `subject_code`: research subject ID shown in the UI, such as `sub-001`.
- `name`: optional display name or anonymized code.
- `age`: optional baseline age.
- `sex`: `男`, `女`, or empty.
- `affected_hand`: `左手`, `右手`, `双手`, or empty.
- `diagnosis`: optional diagnosis text.
- `notes`: optional notes.
- `created_at`: ISO timestamp.
- `updated_at`: ISO timestamp.

### `eeg_files`

Stores registered EEG files for each patient.

Columns:

- `id`: internal UUID.
- `patient_id`: foreign key to `patients.id`.
- `condition`: `EO`, `EC`, or `UNKNOWN`.
- `file_path`: absolute local file path.
- `file_format`: `cnt`, `set`, `edf`, `bdf`, or detected extension.
- `exists_on_disk`: boolean snapshot from last scan.
- `registered_at`: ISO timestamp.
- `last_checked_at`: ISO timestamp.

### `workflow_status`

Stores one compact current status row per patient.

Columns:

- `patient_id`: foreign key to `patients.id`.
- `preprocess_status`: `未开始`, `待处理`, `处理中`, `等待人工处理`, `已完成`, `需复核`, or `失败`.
- `feature_status`: `未开始`, `待处理`, `处理中`, `已完成`, `需复核`, or `失败`.
- `prediction_status`: `未开始`, `待处理`, `处理中`, `已完成`, `需复核`, or `失败`.
- `explanation_status`: `未生成`, `生成中`, `已生成`, or `需复核`.
- `report_status`: `未生成`, `草稿`, `已生成`, or `已签发`.
- `last_error`: latest human-readable error message.
- `updated_at`: ISO timestamp.

### `tasks`

Stores import, scan, preprocessing, feature, prediction, and export jobs.

Columns:

- `id`: internal UUID.
- `type`: `import_patients`, `scan_eeg_files`, `preprocess`, `feature_generation`, `prediction`, `report_export`.
- `patient_id`: nullable foreign key for patient-specific tasks.
- `batch_id`: nullable batch identifier for grouped tasks.
- `status`: `queued`, `running`, `waiting_manual`, `completed`, `failed`, `cancelled`, or `skipped`.
- `priority`: `normal` or `high`.
- `input_json`: serialized task inputs.
- `output_json`: serialized task outputs.
- `error_message`: latest error if failed.
- `created_at`: ISO timestamp.
- `started_at`: nullable ISO timestamp.
- `finished_at`: nullable ISO timestamp.

### `task_logs`

Stores structured logs shown in the right-side log panel.

Columns:

- `id`: internal UUID.
- `task_id`: nullable foreign key to `tasks.id`.
- `patient_id`: nullable foreign key to `patients.id`.
- `level`: `info`, `warning`, or `error`.
- `source`: `app`, `database`, `matlab`, `eeglab`, `prediction`, or `report`.
- `message`: concise log text.
- `created_at`: ISO timestamp.

### `settings`

Stores environment and path settings.

Columns:

- `key`: unique string.
- `value`: string value.
- `updated_at`: ISO timestamp.

Initial keys:

- `dataRoot`
- `outputRoot`
- `matlabExecutable`
- `eeglabPath`
- `defaultElectrodeLocationFile`
- `defaultDownsampleRate`
- `defaultHighPassHz`
- `defaultLowPassHz`
- `defaultNotchHz`

## Renderer API

The renderer should call `src/services/apiClient.ts`, not Electron directly. `apiClient` chooses the real Electron bridge when available and can keep a mock fallback for browser-only testing.

Required service functions for Phase B:

- `listPatients()`
- `createPatient(input)`
- `updatePatient(id, input)`
- `deletePatient(id)`
- `registerEegFile(input)`
- `scanRegisteredEegFiles()`
- `getWorkbenchData()`
- `listTasks(filter)`
- `listTaskLogs(filter)`
- `getSettings()`
- `updateSettings(input)`

Required service functions for Phase A:

- `createPreprocessBatch(input)`
- `startNextQueuedTask()`
- `markManualStepCompleted(taskId)`
- `retryTask(taskId)`
- `cancelTask(taskId)`
- `getPreprocessOutputs(patientId)`

## Preload API

`src/electron/preload.ts` exposes a narrow API:

```ts
window.neuroPredict = {
  platform,
  database: {
    getWorkbenchData,
    listPatients,
    createPatient,
    updatePatient,
    deletePatient,
    registerEegFile,
    scanRegisteredEegFiles,
  },
  tasks: {
    listTasks,
    listTaskLogs,
    createPreprocessBatch,
    markManualStepCompleted,
    retryTask,
    cancelTask,
  },
  settings: {
    getSettings,
    updateSettings,
  },
}
```

The renderer must not receive unrestricted filesystem or shell execution access.

## Phase B User Flows

### Import Or Create Patients

The first implementation can support manual patient creation and structured seed/import logic. Excel/CSV import can be added after the database tables and workbench are stable.

Success criteria:

- A patient created from the UI persists after app restart.
- The workbench row is loaded from SQLite.
- The patient appears in task/log filters where applicable.

### Register EEG Files

The user can associate EO/EC EEG files with a patient.

Success criteria:

- Absolute file paths are saved in `eeg_files`.
- The app can rescan whether each file still exists.
- The workbench shows file availability from the database instead of mock EO/EC values.

### Persist Workflow Status

Workflow columns in the patient workbench come from `workflow_status`.

Success criteria:

- New patients receive default `未开始` or `未生成` statuses.
- Status changes persist.
- Errors can be displayed per patient.

### Task Queue And Logs

The right-side task/log panel reads `tasks` and `task_logs`.

Success criteria:

- Creating an import, scan, or database-only preprocessing task writes a task row.
- Log entries appear in chronological order.
- Failed task messages are visible without opening developer tools.

## Phase A Preprocessing Workflow

The app runs preprocessing through MATLAB/EEGLAB but keeps UI control inside the Electron app.

### Job Creation

When the user starts preprocessing:

1. React collects selected patients and preprocessing settings.
2. Electron creates a `preprocess` task for each patient, plus an optional batch ID.
3. The task input is written to SQLite as `input_json`.
4. A per-patient parameter JSON file is written under:

```text
Documents/StrokePredictSystem/outputs/preprocess/{subject_code}/preprocess_params.json
```

Parameter JSON includes:

- patient ID and subject code.
- EO/EC raw EEG paths.
- electrode location file path.
- selected empty electrodes and auxiliary channels to remove.
- downsample rate.
- high-pass, low-pass, and notch filter settings.
- ICA mode: direct ICA or interpolate bad channels before ICA.
- selected bad channels for interpolation.
- re-reference mode: `M1/M2` or average reference.
- output directory.

### MATLAB Invocation

Electron main process launches MATLAB with a controlled command that calls a single entry script:

```text
run_preprocess_job.m
```

The MATLAB script reads the parameter JSON and writes progress files and logs into the patient output directory.

### Manual EEGLAB Checkpoints

The first version opens EEGLAB as an independent MATLAB window. It does not embed EEGLAB inside Electron.

Manual checkpoints:

1. Bad-segment rejection.
2. ICA artifact component rejection.

At each checkpoint:

- MATLAB saves an intermediate dataset.
- The task status becomes `waiting_manual`.
- The UI shows `等待人工处理`.
- The user completes the operation in EEGLAB.
- The user returns to the app and clicks `我已在 EEGLAB 中完成处理，继续队列`.
- Electron records the confirmation and resumes MATLAB processing.

The app validates that the expected intermediate or output file exists before moving to the next automatic stage.

### Output Files

Each patient output directory contains:

- final preprocessed EEG file, such as `.set/.fdt`.
- `preprocess_params.json`.
- `preprocess_status.json`.
- MATLAB log text.
- manual checkpoint summary.
- failure details if the task fails.

SQLite stores paths and summaries, not large EEG data.

## Validation Rules

The backend must enforce the same rules as the frontend:

- Raw import can include 68 channels: 64 EEG channels plus `HEO`, `VEO`, `EKG`, and `EMG`.
- Auxiliary channels are not offered as ordinary EEG interpolation targets.
- Empty electrode removal is user-selected.
- Bad-channel interpolation is user-selected.
- If `M1` or `M2` is removed before re-reference, `M1/M2` reference is invalid.
- Missing MATLAB executable, missing EEGLAB path, missing electrode location file, or missing EEG file must fail early with a readable error.

## Error Handling

Backend errors are converted into task status plus log entries.

Examples:

- Missing EEG file: task becomes `failed`, patient preprocess status becomes `失败`.
- Missing required setting: task is not started, log level is `error`.
- MATLAB non-zero exit: task becomes `failed`, MATLAB stderr or log summary is saved.
- Manual step timeout or incomplete output: task remains `waiting_manual` or becomes `需复核`.
- Reference conflict: task creation is blocked until the user changes the reference mode or preserves `M1/M2`.

## Testing Strategy

Phase B tests:

- Database initialization creates all required tables.
- Creating a patient also creates default workflow status.
- Registering an EEG file updates workbench availability.
- Task and log creation returns rows in expected order.
- Settings persist across service calls.
- Renderer service uses the Electron bridge when present and mock fallback only in browser tests.

Phase A tests:

- Preprocessing parameter JSON is generated with the selected channels and reference mode.
- Reference conflict blocks task creation.
- Missing MATLAB/EEGLAB settings produce readable task errors.
- Manual checkpoint completion changes a task from `waiting_manual` back to queued or running.
- MATLAB command builder quotes Windows paths safely.

End-to-end manual verification:

- Launch the Electron app.
- Create a patient.
- Register an EEG file path.
- Restart the app and verify the patient remains.
- Create a database-only preprocessing task before MATLAB launch is enabled.
- Verify task and log rows appear in the right-side panel.
- After MATLAB integration, run one test patient through automatic steps until the first manual EEGLAB checkpoint.

## Non-Goals For This Milestone

- Model training.
- Real feature generation.
- Real model prediction.
- Real SHAP or other explainability computation.
- Embedding EEGLAB windows inside Electron.
- Cloud sync.
- Multi-user collaboration.
- Database encryption.
- Full installer generation.

## Implementation Notes

The implementation should keep frontend visual design stable. The main user-visible change is that data persists and actions create real backend records.

Recommended incremental delivery:

1. Add SQLite dependency, database initialization, and backend repository functions.
2. Expose safe IPC through Electron preload.
3. Replace workbench/task/log mock data with backend calls.
4. Add patient creation and EEG file registration flows.
5. Add settings persistence for MATLAB/EEGLAB paths.
6. Add preprocessing task creation without launching MATLAB.
7. Add MATLAB command builder and parameter JSON writer.
8. Add real MATLAB launch and status/log synchronization.
9. Add manual EEGLAB checkpoint resume handling.
