# Real EEG Model Data Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align StrokePredictSystem demo data, model metadata, prediction output, explainability metadata, and report text with the real locked results in `F:\CJZProjectFile\EEG_PredictStokeDLModel`.

**Architecture:** Keep the manual demo workflow unchanged, but replace placeholder model/prediction/explainability metadata with read-only real-project constants and CSV-derived values. Backend APIs continue to own persistence, while reports render richer provenance from existing `prediction_models` and `explanation_artifacts`.

**Tech Stack:** TypeScript, Electron backend, sql.js, Vitest.

---

### Task 1: Lock Backend Tests To Real Model And Existing-Result Values

**Files:**
- Modify: `tests/electron/backend/repositories.test.ts`
- Modify: `tests/electron/backend/existingResultsWorkflow.test.ts`
- Modify: `tests/electron/backend/reports.test.ts`

- [ ] **Step 1: Write failing default-model tests**

Add an assertion that `listPredictionModels(local.db, 'pr')` includes these model names and metrics: `Logistic_L1_PSD_WPLI`, `No_SSL_CNN`, `Barlow_CNN`, `ResidualAware_CNN`, `ResidualAware_SSL_CNN`, with final-model accuracy `0.8474`, balanced accuracy `0.8411`, ROC AUC `0.8867`, and PR AUC `0.8910`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/electron/backend/repositories.test.ts`

Expected: failure because default model list still contains placeholder `SVM_RBF_Optimized` and `RandomForest_Baseline`.

- [ ] **Step 3: Write failing existing-result tests**

Change the existing-result fixture prediction CSV to mimic `final_Residual_ssl_cnn_10seed_patient_predictions.csv` with 10 `sub01` rows and assert probability `0.96091451048851`. Assert explanation method includes `classification_logit`, `IG 64`, `SmoothGrad 8`, `noise std 0.02`, and `fold-local standardized zero`.

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test -- tests/electron/backend/existingResultsWorkflow.test.ts`

Expected: failure because existing-result prediction still reads a single old `paper_locked_model_predictions.csv` style row and explanation method is generic.

### Task 2: Implement Real Model Registry And Existing Prediction Reader

**Files:**
- Modify: `src/electron/backend/predictions.ts`
- Modify: `src/electron/backend/existingResultsWorkflow.ts`

- [ ] **Step 1: Replace default prediction models**

Use five real models from `docs/eeg_feature_prediction_explainability_software_pipeline_zh.md`: Logistic L1, No-SSL CNN, Barlow CNN, Residual-aware CNN, and Residual-aware SSL-CNN. Use `m-final-residual-aware-ssl-cnn` as the final current model id.

- [ ] **Step 2: Read seed-mean existing predictions**

Update existing-result prediction parsing to average all matching `subject_id=sub01` `y_score` rows and classify with threshold `0.5`. Keep fallback for legacy single-row CSV.

- [ ] **Step 3: Register final model with real metrics**

Register `ResidualAware_SSL_CNN locked_10seed_final` with model family `residual_aware_ssl_cnn`, checkpoint mode `fold_checkpoint_ensemble`, inputs `PSD`, `WPLI`, `EO`, `EC`, and metrics accuracy `0.8474`, balanced accuracy `0.8411`, ROC AUC `0.8867`, PR AUC `0.8910`.

- [ ] **Step 4: Run focused tests**

Run: `npm run test -- tests/electron/backend/repositories.test.ts tests/electron/backend/existingResultsWorkflow.test.ts`

Expected: both pass.

### Task 3: Embed Real Explainability Provenance In Reports

**Files:**
- Modify: `src/electron/backend/reports.ts`
- Modify: `tests/electron/backend/reports.test.ts`

- [ ] **Step 1: Add report assertions**

Assert patient report HTML includes `classification_logit`, `Integrated Gradients: 64 steps`, `SmoothGrad: 8 samples`, `noise std 0.02`, `fold-local standardized zero`, and real script names `31_explain_residual_aware_ssl_cnn.py`, `45_make_mne_explainability_topomaps.py`, `46_make_mne_wpli_connectivity.py`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/electron/backend/reports.test.ts`

Expected: failure because report currently embeds figures but not real method provenance.

- [ ] **Step 3: Render provenance block**

Use `ExplanationArtifact.method` and `preview` fields to render target, IG/SmoothGrad settings, baseline, and generation script names in report HTML.

- [ ] **Step 4: Run report test**

Run: `npm run test -- tests/electron/backend/reports.test.ts`

Expected: pass.

### Task 4: Verify The App

**Files:**
- No production edits unless failures expose a needed fix.

- [ ] **Step 1: Run all tests**

Run: `npm run test`

Expected: 31 files and 191 tests pass, or updated total with zero failures.

- [ ] **Step 2: Run builds**

Run: `npm run build`

Expected: TypeScript and Vite build complete with exit code 0.

Run: `npm run electron:compile`

Expected: Electron TypeScript compile and preload CJS build complete with exit code 0.

- [ ] **Step 3: Restart dev app**

Stop existing project-local `node.exe` and `electron.exe` processes, then run `npm run electron:dev` from `F:\CJZProjectFile\StrokePredictSystem`.

Expected: `http://127.0.0.1:5173` is listening.
