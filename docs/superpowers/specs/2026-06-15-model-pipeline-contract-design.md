# Model Pipeline Contract Design

## Purpose

This design hardens the backend contract for the model pipeline in StrokePredictSystem. The scope is the first backend pass for feature generation, prediction, and explainability after the MATLAB/EEGLAB preprocessing bridge.

The goal is to turn the modeling experience documented in `ProjectModelandPreProcess` into explicit backend task packages and validations, without moving EEG algorithms into the Electron/Node process.

## Confirmed Scope

This milestone implements option 1: strengthen the existing task package contract.

In scope:

- Add explicit backend contracts for PSD, WPLI, model prediction, and explainability tasks.
- Validate EO/EC state completeness, `.set/.fdt` pairing, affected side availability, feature shapes, model compatibility, and explanation target consistency.
- Keep the current task flow: create task, prepare JSON package, call external executor, import manifest or result, update database.
- Update tests around feature generation, prediction, explainability, and queue execution.

Out of scope:

- Implementing PSD or WPLI computation in TypeScript.
- Running the real Python EEG model repository from this milestone.
- Training a deployment model.
- Changing the patient-centered frontend structure.
- Replacing the current Electron IPC bridge.

## Architecture Boundary

The Electron backend remains the workflow and persistence layer. It owns:

- Task creation and status transitions.
- Input discovery and local file checks.
- JSON task package generation.
- External process invocation.
- Result manifest parsing.
- Database indexing and task logs.

The external Python side owns:

- Hemisphere alignment implementation.
- PSD and WPLI computation.
- Traditional ML or residual-aware SSL-CNN inference.
- Integrated Gradients, SmoothGrad, occlusion, MNE topomap, and WPLI connectivity exports.

The backend does not compute EEG features or model predictions itself. It verifies that inputs and outputs match the research contract before accepting generated artifacts into SQLite.

## Files

Primary backend files:

- `src/electron/backend/featureArtifacts.ts`
- `src/electron/backend/predictions.ts`
- `src/electron/backend/explainability.ts`

New shared contract file:

- `src/electron/backend/modelPipelineContract.ts`

Likely type updates:

- `src/domain/backendTypes.ts`

Existing bridge files should only change if public return types need to expose the stricter contract:

- `src/electron/backend/ipcHandlers.ts`
- `src/electron/preload.ts`
- `src/services/apiClient.ts`

## Shared Model Pipeline Contract

`modelPipelineContract.ts` will define constants and small validation helpers used by feature, prediction, and explainability backends.

Fixed contract values:

- Required states: `EO` and `EC`.
- Processed EEG input pair: one `.set` and its matching `.fdt` for each required state.
- Feature alignment: right affected side / C3 stimulation convention.
- PSD shape: channels `62`, frequency bins `90`.
- WPLI shape: edges `1891`, bands `6`.
- WPLI metric name: `wpli`.
- Explainability target: `classification_logit`.

The module should expose focused helpers rather than a broad framework:

- Validate that a patient has affected-side information before final-model feature or prediction tasks proceed.
- Group processed EEG inputs by state and require EO/EC `.set/.fdt` pairs.
- Validate feature manifest artifacts against expected kind, state, shape, metric, and alignment.
- Validate prediction results against the task package contract.
- Validate explainability manifests against the prediction result and expected target.

## Feature Task Package

Feature generation remains patient-based. The backend resolves processed EEG inputs from:

- Indexed data library assets.
- Completed preprocessing task outputs.

The package must include:

- `schemaVersion`
- `type: "feature_generation_task_package"`
- `taskId`
- `patientId`
- `subjectCode`
- `batchId`
- `contract`
  - `requiredStates: ["EO", "EC"]`
  - `affectedSide` or normalized affected hand value
  - `alignment: "right_affected_c3"`
  - `features`
    - PSD: `shape: [62, 90]`
    - WPLI: `shape: [1891, 6]`, `metric: "wpli"`
- `inputs`
  - `eegStatePairs`
    - `state`
    - `setPath`
    - `fdtPath`
    - `source`
    - optional source asset or task IDs
- `outputs`
  - `outputDirectory`
  - `manifestPath`
- `executor`

Feature task creation and preparation should fail when:

- The patient is missing.
- The patient lacks affected-side information.
- EO or EC is missing.
- A `.set` file has no matching `.fdt`.
- Required files do not exist on disk.

## Feature Manifest Import

The backend should keep accepting an external manifest, but the manifest must state enough information to prove it matches the contract.

Each artifact should include:

- `kind`: `PSD`, `FC`, `SUMMARY`, or `PREVIEW`.
- `state`: `EO`, `EC`, `EO_EC`, or `UNKNOWN`.
- `filePath`
- `featureCount`
- `params`
  - PSD: `shape: [62, 90]`, `alignment: "right_affected_c3"`
  - FC/WPLI: `shape: [1891, 6]`, `metric: "wpli"`, `alignment: "right_affected_c3"`
- `preview`

The backend should reject manifest import when:

- A feature file does not exist.
- PSD shape differs from `[62, 90]`.
- WPLI shape differs from `[1891, 6]`.
- FC artifacts do not declare metric `wpli`.
- EO/EC artifacts do not satisfy the task package request.

## Prediction Task Package

Prediction tasks should reference feature artifacts already accepted into the database. They should not infer feature files directly from directories.

The package must include:

- `schemaVersion`
- `type: "prediction_task_package"`
- `taskId`
- `patientId`
- `subjectCode`
- `batchId`
- `request`
  - `taskId`
  - `modelId`
  - `labelDefinition`
- `contract`
  - `requiredStates: ["EO", "EC"]`
  - `requiredFeatureKinds: ["PSD", "FC"]`
  - `fcMetric: "wpli"`
  - `alignment: "right_affected_c3"`
  - `affectedSide`
- `model`
  - `id`
  - `name`
  - `version`
  - `inputType`
  - `inputs`
  - `artifactPath`
  - `modelFamily`
  - `checkpointMode`
- `inputs`
  - `featureArtifacts`
  - `featureArtifactIds`
- `outputs`
  - `outputDirectory`
  - `resultPath`
- `executor`

Supported model metadata:

- `modelFamily`
  - `traditional_ml`
  - `residual_aware_ssl_cnn`
- `checkpointMode`
  - `saved_deployment_model`
  - `fold_checkpoint_ensemble`
  - `deployment_checkpoint`
  - `external_script`

The current final model should be represented as `modelFamily: "residual_aware_ssl_cnn"` and `checkpointMode: "fold_checkpoint_ensemble"` unless a future all-subject deployment checkpoint is registered.

Prediction task creation and preparation should fail or skip patients when:

- The model does not match the selected label definition.
- EEG-only models lack PSD or FC/WPLI artifacts.
- Final-model tasks lack EO or EC.
- Final-model tasks lack affected-side information.
- EEG+Clinical models lack clinical metrics.
- The model artifact path is configured but missing.

## Prediction Result Import

The external result JSON must include:

- `prediction`
  - `predictedClass`
  - `probability`
  - `threshold`
  - `labelDefinition`
  - `taskId`
  - `modelId`
  - `featureArtifactIds`

The backend should reject prediction import when:

- `predictedClass` is not `比例恢复` or `恢复不良`.
- `probability` or `threshold` is outside `[0, 1]`.
- `labelDefinition` differs from the task package.
- `modelId` differs from the task package.
- `featureArtifactIds` differ from the task package.

Accepted prediction results should store enough information in `output_json` for later explainability tasks to reuse the exact feature artifact set.

## Explainability Task Package

Explainability tasks must bind to a concrete prediction result. They should not silently use whichever result is newest at preparation time.

The package must include:

- `schemaVersion`
- `type: "explainability_task_package"`
- `taskId`
- `patientId`
- `subjectCode`
- `batchId`
- `request`
  - `taskId`
  - `modelId`
  - `predictionResultId`
  - `artifactTypes`
  - `target: "classification_logit"`
  - `labelDefinition`
- `contract`
  - `requiredStates: ["EO", "EC"]`
  - `requiredFeatureKinds: ["PSD", "FC"]`
  - `fcMetric: "wpli"`
  - `alignment: "right_affected_c3"`
  - `featureArtifactIds`
- `model`
- `prediction`
- `inputs`
  - `featureArtifacts`
- `outputs`
  - `outputDirectory`
  - `manifestPath`
- `executor`

Explainability task creation and preparation should fail or skip patients when:

- No prediction result exists for the selected model and label task.
- The queued `predictionResultId` no longer exists.
- The prediction result is for a different patient, task, or model.
- The prediction result does not expose feature artifact IDs.

## Explainability Manifest Import

The external explainability manifest must include:

- `target: "classification_logit"`
- `predictionResultId`
- `modelId`
- `featureArtifactIds`
- `artifacts`

Each artifact must include:

- `artifactType`
- `title`
- `method`
- `filePath`
- optional `topFeatures`
- optional `preview`

The backend should reject explainability import when:

- `target` differs from `classification_logit`.
- `predictionResultId` differs from the task package.
- `modelId` differs from the task package.
- `featureArtifactIds` differ from the prediction result.
- Any artifact file is missing.

## Error Handling

The backend should not guess or auto-repair contract mismatches. It should return readable task errors and log entries.

Examples:

- `缺少 EO 的 .fdt 文件。`
- `最终模型需要患侧信息，当前患者未填写 affectedHand。`
- `PSD 特征形状必须是 [62,90]。`
- `WPLI 特征形状必须是 [1891,6]。`
- `预测结果标签定义不匹配。`
- `解释性结果必须解释 classification_logit。`
- `解释性结果使用的 featureArtifactIds 与预测任务不一致。`

Status behavior:

- Feature and prediction contract failures mark the task as `failed`.
- Explainability contract failures mark explanation status as `需复核`.
- Skipped patients remain visible in batch result `skippedPatients`.
- Logs record the exact failing contract rule.

## Testing Strategy

Backend tests should cover these behaviors:

- Feature task creation skips or fails when EO/EC pairs are incomplete.
- Feature task preparation writes the strict contract into the JSON package.
- Feature manifest import accepts valid PSD/WPLI artifacts.
- Feature manifest import rejects wrong PSD shape, wrong WPLI shape, wrong metric, and missing files.
- Prediction batch creation skips patients without PSD or FC/WPLI.
- Final-model prediction tasks require EO/EC and affected-side information.
- Prediction package includes model family, checkpoint mode, label definition, and feature artifact IDs.
- Prediction result import rejects mismatched label definition, model ID, and feature artifact IDs.
- Explainability batch creation stores a concrete prediction result ID.
- Explainability package uses the same feature artifact IDs as the prediction result.
- Explainability manifest import rejects a target other than `classification_logit`.
- `startNextQueuedTask` still runs feature, prediction, and explainability tasks through prepare/run/import.

Verification commands:

```powershell
npm run test
npm run build
npm run electron:compile
```

## Delivery Notes

This repository checkout is not currently a Git repository, so the design file cannot be committed here. The implementation should still keep changes scoped and report all modified files and verification results.

The implementation plan should use test-first changes for backend behavior. No production code should be added before a failing Vitest test captures the contract rule being implemented.
