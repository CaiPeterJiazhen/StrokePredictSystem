# Stroke Predict System Design

## Purpose

Build a Windows local research application for batch management and prediction of post-tACS upper-limb recovery outcomes in stroke patients. The system uses baseline EEG data, optional baseline clinical data, and pre-trained model versions to predict whether each patient belongs to the proportional recovery group or the poor recovery group.

The first version is a local workflow application, not a model-training platform. Gemini's `tacs_eeg.tsx` is treated as the visual React prototype. Codex will turn it into a maintainable Electron + React app and later connect it to Python/FastAPI, MATLAB/EEGLAB, feature generation, model inference, and explainability backends.

## Selected Product Approach

The app uses a patient workbench model.

- The patient is the core object.
- One table row represents one patient, not one EEG file.
- Module pages are available through the sidebar, but their outputs write back to patient-level status columns.
- A right-side task queue and log panel aggregates MATLAB, Python, manual EEGLAB, failed, and retryable tasks.

## Technology Direction

- Frontend: React + TypeScript, based on Gemini's TSX design.
- Desktop shell: Electron.
- Local backend: Python/FastAPI.
- EEG preprocessing engine: existing MATLAB/EEGLAB scripts.
- Feature and prediction engine: existing Python EEG recovery project.
- First implementation stage: frontend prototype with mock data and backend interface placeholders.

## First-Version Pages

1. Patient Workbench
   - Default landing page.
   - Shows patient-level status for EO/EC data, preprocessing, features, prediction task, prediction result, explainability, and report status.
   - Supports filtering, sorting, batch actions, and navigation to patient detail.

2. Patient Detail
   - Shows files, clinical baseline information, preprocessing history, feature previews, prediction result, local explanations, and report actions for a single patient.

3. Batch And Import
   - Imports patient metadata from Excel/CSV.
   - Scans EEG folders.
   - Matches subject IDs and EO/EC files.
   - Reports missing or ambiguous files.

4. EEG Preprocessing Wizard
   - Frontend runs inside the app.
   - Actual processing is delegated to MATLAB/EEGLAB.
   - Includes automatic, manual, and semi-automatic steps.

5. Feature Generation And Viewing
   - Generates or previews PSD and FC features.
   - Shows PSD channel-band heatmaps, FC matrices or network previews, and EO/EC comparisons.

6. Feature Archive
   - Automatically archives feature files, generation parameters, logs, preview plots, and feature summary report assets by patient and batch.

7. Model Library
   - Shows model versions, label definitions, input feature requirements, validation protocol, metrics, and availability.
   - Does not expose model training in version 1.

8. Batch Prediction
   - Selects prediction task and label definition.
   - Automatically filters compatible trained models.
   - Outputs class, probability, model version, and explanation status per patient.

9. Model Explainability
   - Shows global feature importance and patient-level prediction explanations.
   - Includes PSD, FC, clinical feature tables, EO/EC contribution summaries, and export actions.

10. Report Export And Environment Settings
   - Exports patient PDF/HTML reports.
   - Exports batch CSV/Excel summaries.
   - Configures MATLAB path, EEGLAB path, Python/FastAPI backend path, data root, output directory, and model library directory.

## Preprocessing Workflow

The preprocessing wizard contains these steps:

1. Import raw EEG files such as CNT or SET.
2. Import electrode location file. The default electrode location file is for 64 EEG channels.
3. Remove empty electrodes and auxiliary channels.
4. Downsample.
5. Filter: high-pass, low-pass, and notch.
6. Manual bad-segment rejection in an independent EEGLAB window.
7. ICA path:
   - Direct ICA, or
   - User selects bad channels, the app calls MATLAB/EEGLAB to interpolate selected bad channels, then runs ICA.
8. Manual artifact component rejection in an independent EEGLAB window.
9. Re-reference and save.

Important channel rules:

- Raw import should present 68 channels: 64 EEG channels plus `HEO`, `VEO`, `EKG`, and `EMG`.
- `HEO`, `VEO`, `EKG`, and `EMG` are auxiliary channels. They should be visually separated from EEG channels and normally removed or excluded from downstream EEG feature computation.
- Empty electrode removal is semi-automatic: the user selects channels to remove, then MATLAB/EEGLAB performs batch removal.
- `M1` and `M2` can be common default removal selections, but the user must be able to modify them.
- Re-reference selection must support `M1/M2 reference` and `average reference`.
- If the user removes `M1/M2` in step 3 but later chooses `M1/M2 reference` in step 9, the UI must show a conflict and require the user to either preserve `M1/M2` until re-reference or choose average reference.
- Bad-channel interpolation should list only currently valid EEG channels after step 3. Auxiliary channels should not be included by default.

Manual EEGLAB handling:

- Version 1 opens EEGLAB/MATLAB as an independent window.
- The app records "waiting for manual operation".
- After completing manual bad-segment or artifact handling, the user returns to the app and clicks "completed, continue".
- Embedding the EEGLAB graphical window inside Electron is out of scope for version 1.

## Prediction And Label Definition

The prediction module treats label definition as a prediction task selector.

- Version 1 supports selecting a task such as proportional recovery vs poor recovery.
- Example label definition: `Residual <= 1.5`.
- Each label definition must map to compatible trained model versions.
- If no model exists for a selected label definition, the UI must show that no compatible model is available.
- The UI must not imply that an arbitrary label definition can be used with an unrelated trained model.

## Clinical Data

Baseline clinical data is optional in the first version.

- If clinical data is available, EEG + clinical models can be used.
- If clinical data is missing, EEG-only models can be used when available.
- Fields needed for feature generation, such as affected hand or lesion-side-related alignment inputs, must be treated as required workflow fields rather than ordinary optional clinical metadata.

## Feature Viewing

The first version shows summary-level feature views rather than a complete interactive feature browser.

- PSD channel-band heatmap.
- FC matrix or network preview.
- EO/EC comparison.
- Feature generation status.
- Feature file paths and parameters.

## Explainability

The first version supports global and patient-level explanations.

- Global explanation: overall important PSD, FC, and clinical features for a selected model.
- Patient-level explanation: important features driving one patient's prediction.
- Exportable explanation plots and tables.
- Full paper-level statistical validation and clinical correlation analysis are out of scope for version 1.

## Outputs

Version 1 exports both:

- Patient-level PDF/HTML report containing preprocessing summary, feature summary, prediction result, and explanation plots.
- Batch-level CSV/Excel summary containing all patient statuses, predicted classes, probabilities, model versions, and report states.

## Gemini Prototype Handling

The provided file `C:/Users/HPGZZ/Downloads/tacs_eeg.tsx` is a single-file React prototype. It should be used as a visual and interaction reference, then refactored.

Planned refactor:

- Split data mocks from components.
- Create an app shell with sidebar, title bar, content area, and task/log panel.
- Create feature modules for workbench, preprocessing, prediction, explainability, model library, feature viewing, archive, and settings.
- Replace prototype-only alerts with local UI state.
- Preserve the professional medical research workbench style.
- Keep mock data until backend interfaces are added.

Known prototype corrections to preserve during refactor:

- Channel import/removal must use 68 raw channels, not only 64.
- `HEO/VEO/EKG/EMG` must be represented as auxiliary channels.
- Empty electrode removal and bad-channel interpolation both require user selection.
- M1/M2 reference conflict handling must be explicit.
- Model library values in the prototype are placeholders and should later be aligned to actual project model metrics and feature names.

## Implementation Status

Frontend implementation is now present in the React/Vite/Electron scaffold under `src/`.
The first implementation stage uses mock data and API placeholders only.

Implemented frontend surfaces:

- Patient workbench with patient-level tracking and right-side task/log panel.
- EEG preprocessing wizard with 68-channel removal, auxiliary-channel handling, bad-channel interpolation selection, ICA path selection, manual EEGLAB checkpoints, M1/M2 reference conflict handling, and re-reference/save summary.
- Batch prediction page with label-definition task selection, compatible model filtering, EEG-only vs EEG+Clinical readiness logic, and separated current-model vs historical prediction results.
- Model library, explainability, feature preview, feature archive, and settings pages.
