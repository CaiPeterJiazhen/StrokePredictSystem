# StrokePredictSystem

Windows local research software for EEG preprocessing workflow management and post-tACS stroke recovery prediction.

## Current Stage

This repository now contains the React/Electron desktop app with a local SQLite backend for patient/workflow state, data-library indexing, task queues, logs, settings, MATLAB/EEGLAB preprocessing task packages, feature/prediction/explainability execution bridges, and local report generation.

Browser preview still uses safe mock/fallback data because normal browsers cannot open local Windows paths or access the Electron IPC bridge. Use the Electron shell for real local filesystem and backend operations.

## Run Frontend

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173/` for browser-only preview.

## Run Checks

```powershell
npm run test
npm run build
npm run electron:build
```

## Desktop Shell

```powershell
npm run electron:dev
```

Use this mode for selecting local folders, scanning `F:\CJZFile\EEG_M1`, indexing EEG files, backing up clinical documents, and running local task queues.

## Design Rules To Preserve

- Patient is the core object.
- Raw import presents 68 channels: 64 EEG channels plus `HEO`, `VEO`, `EKG`, and `EMG`.
- Empty electrode removal requires user selection.
- Bad-channel interpolation requires user selection.
- `M1/M2` reference must conflict with removing `M1/M2` before re-reference.
- Prediction tasks bind label definitions, such as `Residual <= 1.5`, to compatible model versions.
- Version 1 manages model versions but does not train models.
