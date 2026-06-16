# Model Pipeline Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the feature, prediction, and explainability backend task packages so model-pipeline inputs and outputs are explicit, validated, and reproducible.

**Architecture:** Keep the current Electron backend flow: create task, prepare JSON package, run an external executor, import result files, and update SQLite. Add a focused shared contract module used by feature, prediction, and explainability code; do not move PSD, WPLI, prediction, or attribution algorithms into TypeScript.

**Tech Stack:** TypeScript, Electron backend, sql.js, Vitest, Node `fs/path`, existing local database test helpers.

---

## Scope And File Structure

Create:

- `src/electron/backend/modelPipelineContract.ts`: constants and validation helpers for EO/EC pairing, affected-side requirements, PSD/WPLI shape checks, prediction result provenance, and explainability target checks.
- `tests/electron/backend/modelPipelineContract.test.ts`: unit tests for the shared contract helpers.

Modify:

- `src/domain/backendTypes.ts`: extend prediction model registration and saved-result input types with optional model contract and feature provenance fields.
- `src/electron/backend/featureArtifacts.ts`: prepare strict feature packages and validate feature manifests before indexing.
- `src/electron/backend/predictions.ts`: prepare strict prediction packages, enforce PSD/FC state requirements, add model family/checkpoint metadata, and validate result provenance.
- `src/electron/backend/explainability.ts`: bind queued explainability tasks to a concrete prediction result and validate explainability manifest provenance.
- `tests/electron/backend/featureArtifacts.test.ts`: add strict feature package and manifest validation tests.
- `tests/electron/backend/repositories.test.ts`: add prediction package/result provenance tests using the existing prediction backend coverage.
- `tests/electron/backend/explainability.test.ts`: add prediction-result binding and explainability target/provenance tests.

No changes are planned for `src/electron/preload.ts`, `src/electron/backend/ipcHandlers.ts`, or `src/services/apiClient.ts` unless TypeScript compilation shows the public API types need a mechanical update.

This checkout is not a Git repository. Replace commit steps with a short changed-file note in the final implementation summary.

---

### Task 1: Shared Model Pipeline Contract Module

**Files:**
- Create: `src/electron/backend/modelPipelineContract.ts`
- Create: `tests/electron/backend/modelPipelineContract.test.ts`

- [ ] **Step 1: Write failing contract-helper tests**

Create `tests/electron/backend/modelPipelineContract.test.ts` with these tests:

```ts
import { describe, expect, it } from 'vitest';
import {
  MODEL_PIPELINE_CONTRACT,
  assertAffectedSideForModelPipeline,
  assertFeatureArtifactContract,
  assertMatchingStringSets,
  buildFeatureGenerationContract,
  normalizeAffectedSide,
} from '../../../src/electron/backend/modelPipelineContract.js';

describe('model pipeline contract helpers', () => {
  it('exports the locked EEG feature contract', () => {
    expect(MODEL_PIPELINE_CONTRACT).toEqual({
      requiredStates: ['EO', 'EC'],
      alignment: 'right_affected_c3',
      psdShape: [62, 90],
      wpliShape: [1891, 6],
      wpliMetric: 'wpli',
      explainabilityTarget: 'classification_logit',
    });
  });

  it('normalizes affected-side text from patient records', () => {
    expect(normalizeAffectedSide('左手')).toBe('left');
    expect(normalizeAffectedSide('右手')).toBe('right');
    expect(normalizeAffectedSide('左肢不利 (RH)')).toBe('left');
    expect(normalizeAffectedSide('右肢不利 (LH)')).toBe('right');
    expect(normalizeAffectedSide('双手')).toBe('bilateral');
    expect(normalizeAffectedSide('')).toBeNull();
  });

  it('requires affected-side information before strict model packages are built', () => {
    expect(() => assertAffectedSideForModelPipeline('')).toThrow('最终模型需要患侧信息');
    expect(assertAffectedSideForModelPipeline('左手')).toBe('left');
  });

  it('builds the common feature generation contract', () => {
    expect(buildFeatureGenerationContract('右手')).toEqual({
      requiredStates: ['EO', 'EC'],
      affectedSide: 'right',
      alignment: 'right_affected_c3',
      features: {
        PSD: { shape: [62, 90] },
        FC: { metric: 'wpli', shape: [1891, 6] },
      },
    });
  });

  it('rejects feature artifacts with mismatched shape, metric, or alignment', () => {
    expect(() =>
      assertFeatureArtifactContract({
        kind: 'PSD',
        state: 'EO',
        params: { shape: [62, 89], alignment: 'right_affected_c3' },
      }),
    ).toThrow('PSD 特征形状必须是 [62,90]');

    expect(() =>
      assertFeatureArtifactContract({
        kind: 'FC',
        state: 'EC',
        params: { shape: [1891, 6], metric: 'plv', alignment: 'right_affected_c3' },
      }),
    ).toThrow('FC 特征必须声明 metric=wpli');

    expect(() =>
      assertFeatureArtifactContract({
        kind: 'FC',
        state: 'EC',
        params: { shape: [1891, 6], metric: 'wpli', alignment: 'native' },
      }),
    ).toThrow('特征必须声明 alignment=right_affected_c3');
  });

  it('compares provenance ID sets without depending on order', () => {
    expect(() => assertMatchingStringSets(['b', 'a'], ['a', 'b'], 'featureArtifactIds')).not.toThrow();
    expect(() => assertMatchingStringSets(['a'], ['a', 'b'], 'featureArtifactIds')).toThrow(
      'featureArtifactIds 不一致',
    );
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```powershell
npx vitest run tests/electron/backend/modelPipelineContract.test.ts
```

Expected: FAIL because `src/electron/backend/modelPipelineContract.ts` does not exist.

- [ ] **Step 3: Implement the shared contract module**

Create `src/electron/backend/modelPipelineContract.ts`:

```ts
import type { FeatureArtifactKind, FeatureArtifactState, WorkbenchHandText } from '../../domain/backendTypes.js';

export type NormalizedAffectedSide = 'left' | 'right' | 'bilateral';

export interface ModelPipelineFeatureContract {
  requiredStates: readonly ['EO', 'EC'];
  affectedSide: NormalizedAffectedSide;
  alignment: 'right_affected_c3';
  features: {
    PSD: { shape: readonly [62, 90] };
    FC: { metric: 'wpli'; shape: readonly [1891, 6] };
  };
}

export interface ManifestFeatureContractInput {
  kind: FeatureArtifactKind;
  state?: FeatureArtifactState;
  params?: Record<string, unknown>;
}

export const MODEL_PIPELINE_CONTRACT = {
  requiredStates: ['EO', 'EC'] as const,
  alignment: 'right_affected_c3' as const,
  psdShape: [62, 90] as const,
  wpliShape: [1891, 6] as const,
  wpliMetric: 'wpli' as const,
  explainabilityTarget: 'classification_logit' as const,
};

function numericTuple(value: unknown): number[] {
  return Array.isArray(value) ? value.map((item) => Number(item)) : [];
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function normalizeAffectedSide(value: unknown): NormalizedAffectedSide | null {
  if (value === '左手' || value === '左肢不利 (RH)') return 'left';
  if (value === '右手' || value === '右肢不利 (LH)') return 'right';
  if (value === '双手') return 'bilateral';
  return null;
}

export function assertAffectedSideForModelPipeline(value: WorkbenchHandText | string | null | undefined): NormalizedAffectedSide {
  const side = normalizeAffectedSide(value);

  if (!side) {
    throw new Error('最终模型需要患侧信息，当前患者未填写 affectedHand。');
  }

  return side;
}

export function buildFeatureGenerationContract(value: WorkbenchHandText | string | null | undefined): ModelPipelineFeatureContract {
  return {
    requiredStates: MODEL_PIPELINE_CONTRACT.requiredStates,
    affectedSide: assertAffectedSideForModelPipeline(value),
    alignment: MODEL_PIPELINE_CONTRACT.alignment,
    features: {
      PSD: { shape: MODEL_PIPELINE_CONTRACT.psdShape },
      FC: { metric: MODEL_PIPELINE_CONTRACT.wpliMetric, shape: MODEL_PIPELINE_CONTRACT.wpliShape },
    },
  };
}

export function assertFeatureArtifactContract(input: ManifestFeatureContractInput): void {
  if (input.kind !== 'PSD' && input.kind !== 'FC') return;

  const params = input.params ?? {};

  if (params.alignment !== MODEL_PIPELINE_CONTRACT.alignment) {
    throw new Error('特征必须声明 alignment=right_affected_c3。');
  }

  if (input.kind === 'PSD' && !sameNumbers(numericTuple(params.shape), MODEL_PIPELINE_CONTRACT.psdShape)) {
    throw new Error('PSD 特征形状必须是 [62,90]。');
  }

  if (input.kind === 'FC') {
    if (params.metric !== MODEL_PIPELINE_CONTRACT.wpliMetric) {
      throw new Error('FC 特征必须声明 metric=wpli。');
    }

    if (!sameNumbers(numericTuple(params.shape), MODEL_PIPELINE_CONTRACT.wpliShape)) {
      throw new Error('WPLI 特征形状必须是 [1891,6]。');
    }
  }
}

export function assertMatchingStringSets(actual: readonly string[], expected: readonly string[], label: string): void {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();

  if (
    actualSorted.length !== expectedSorted.length ||
    actualSorted.some((value, index) => value !== expectedSorted[index])
  ) {
    throw new Error(`${label} 不一致。`);
  }
}
```

- [ ] **Step 4: Run the contract-helper test and verify it passes**

Run:

```powershell
npx vitest run tests/electron/backend/modelPipelineContract.test.ts
```

Expected: PASS.

---

### Task 2: Feature Input Pairing And Strict Feature Packages

**Files:**
- Modify: `tests/electron/backend/featureArtifacts.test.ts`
- Modify: `src/electron/backend/featureArtifacts.ts`
- Use helper from: `src/electron/backend/modelPipelineContract.ts`

- [ ] **Step 1: Write failing feature package tests**

Extend `tests/electron/backend/featureArtifacts.test.ts` helper `seedPreprocessedEegInputs` so it writes distinct EO and EC pairs:

```ts
function seedPreprocessedEegInputs(local: LocalDatabase, patientId: string, subjectCode = 'sub01'): void {
  const sourceRoot = upsertSourceRoot(local.db, {
    projectName: 'EEG_M1',
    rootPath: path.join(local.paths.dataRoot, 'source-library'),
    status: 'active',
  });

  for (const stateSuffix of ['1', '2']) {
    const setPath = path.join(
      sourceRoot.rootPath,
      'Patient_tACS_M1_RestingStateEEG_afterProcess',
      '基线',
      subjectCode,
      `${subjectCode}${stateSuffix}.set`,
    );
    const fdtPath = path.join(
      sourceRoot.rootPath,
      'Patient_tACS_M1_RestingStateEEG_afterProcess',
      '基线',
      subjectCode,
      `${subjectCode}${stateSuffix}.fdt`,
    );

    writeFile(setPath, `preprocessed ${stateSuffix} set`);
    writeFile(fdtPath, `preprocessed ${stateSuffix} fdt`);

    for (const [assetType, filePath] of [
      ['processed_eeg_set', setPath],
      ['processed_eeg_fdt', fdtPath],
    ] as const) {
      upsertDataAsset(local.db, {
        sourceRootId: sourceRoot.id,
        patientId,
        subjectCode,
        sourceSubjectCode: subjectCode,
        subjectName: '',
        cohort: 'patient',
        stage: '基线',
        assetType,
        filePath,
        backupPath: null,
        fileSize: fs.statSync(filePath).size,
        fileHash: '',
        existsOnDisk: true,
        matchStatus: 'matched',
      });
    }
  }
}
```

Add this test:

```ts
it('prepares strict EO/EC feature package with affected-side and shape contract', async () => {
  const local = await openTempDatabase();
  const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '右手' });
  const executablePath = path.join(local.paths.dataRoot, 'tools', 'python.exe');
  const scriptPath = path.join(local.paths.dataRoot, 'scripts', 'generate_features.py');
  writeFile(executablePath, 'python stub');
  writeFile(scriptPath, 'feature script stub');
  seedPreprocessedEegInputs(local, patientId);
  createFeatureGenerationBatch(local.db, local.paths, {
    patientIds: [patientId],
    featureKinds: ['PSD', 'FC'],
    states: ['EO', 'EC'],
    overwrite: false,
    params: { executor: { executablePath, scriptPath } },
  });
  const task = listTasks(local.db, { type: 'feature_generation' })[0];

  const prepared = prepareFeatureGenerationExecution(local.db, local.paths, task.id);
  const taskPackage = JSON.parse(fs.readFileSync(prepared.packagePath ?? '', 'utf8'));

  expect(prepared).toEqual(expect.objectContaining({ ok: true }));
  expect(taskPackage.contract).toEqual({
    requiredStates: ['EO', 'EC'],
    affectedSide: 'right',
    alignment: 'right_affected_c3',
    features: {
      PSD: { shape: [62, 90] },
      FC: { metric: 'wpli', shape: [1891, 6] },
    },
  });
  expect(taskPackage.inputs.eegStatePairs).toEqual([
    expect.objectContaining({ state: 'EO', setPath: expect.stringContaining('sub011.set'), fdtPath: expect.stringContaining('sub011.fdt') }),
    expect.objectContaining({ state: 'EC', setPath: expect.stringContaining('sub012.set'), fdtPath: expect.stringContaining('sub012.fdt') }),
  ]);
});
```

Add this missing affected-side test:

```ts
it('skips feature tasks when affected-side information is missing', async () => {
  const local = await openTempDatabase();
  const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });
  seedPreprocessedEegInputs(local, patientId);

  const result = createFeatureGenerationBatch(local.db, local.paths, {
    patientIds: [patientId],
    featureKinds: ['PSD', 'FC'],
    states: ['EO', 'EC'],
    overwrite: false,
  });

  expect(result).toEqual({
    ok: false,
    message: '未创建特征生成任务，1 位患者缺少可用的预处理 EEG 输入。',
    batchId: expect.any(String),
    queuedTasks: 0,
    skippedPatients: [patientId],
  });
  expect(listTasks(local.db, { type: 'feature_generation' })).toEqual([]);
});
```

- [ ] **Step 2: Run the feature package tests and verify they fail**

Run:

```powershell
npx vitest run tests/electron/backend/featureArtifacts.test.ts
```

Expected: FAIL because packages do not yet include `contract` or `inputs.eegStatePairs`, and affected-side is not required.

- [ ] **Step 3: Implement feature input grouping and contract package output**

In `src/electron/backend/featureArtifacts.ts`, import the contract helper:

```ts
import { buildFeatureGenerationContract } from './modelPipelineContract.js';
```

Add row fields for patient affected hand:

```ts
function featurePatient(db: Database, patientId: string): { subjectCode: string; affectedHand: string } | null {
  const row = queryOne<{ subject_code: string; affected_hand: string }>(
    db,
    'SELECT subject_code, affected_hand FROM patients WHERE id = ?',
    [patientId],
  );

  return row ? { subjectCode: row.subject_code, affectedHand: row.affected_hand } : null;
}
```

Add a local state detector and strict pair builder near the existing feature input helpers:

```ts
function eegStateFromFilePath(filePath: string): FeatureArtifactState {
  const stem = path.basename(filePath, path.extname(filePath)).toLowerCase();
  if (/1$|_eo$|-eo$/.test(stem)) return 'EO';
  if (/2$|_ec$|-ec$/.test(stem)) return 'EC';
  return 'UNKNOWN';
}

function pairedEegStateInputs(assets: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return ['EO', 'EC'].map((state) => {
    const setAsset = assets.find(
      (asset) =>
        asset.assetType === 'processed_eeg_set' &&
        typeof asset.filePath === 'string' &&
        eegStateFromFilePath(asset.filePath) === state,
    );
    const fdtAsset = assets.find(
      (asset) =>
        asset.assetType === 'processed_eeg_fdt' &&
        typeof asset.filePath === 'string' &&
        eegStateFromFilePath(asset.filePath) === state,
    );

    if (!setAsset || typeof setAsset.filePath !== 'string') {
      throw new Error(`缺少 ${state} 的 .set 文件。`);
    }

    if (!fdtAsset || typeof fdtAsset.filePath !== 'string') {
      throw new Error(`缺少 ${state} 的 .fdt 文件。`);
    }

    if (!fs.existsSync(setAsset.filePath)) {
      throw new Error(`特征输入文件不存在：${setAsset.filePath}`);
    }

    if (!fs.existsSync(fdtAsset.filePath)) {
      throw new Error(`特征输入文件不存在：${fdtAsset.filePath}`);
    }

    return {
      state,
      setPath: setAsset.filePath,
      fdtPath: fdtAsset.filePath,
      source: setAsset.source,
      setAssetId: setAsset.id,
      fdtAssetId: fdtAsset.id,
    };
  });
}
```

Update `hasFeatureGenerationInputs` to require affected hand and both pairs:

```ts
function hasFeatureGenerationInputs(db: Database, paths: AppPaths, patientId: string): boolean {
  const patient = featurePatient(db, patientId);
  if (!patient?.affectedHand) return false;

  try {
    pairedEegStateInputs(featureInputAssets(db, paths, patientId));
    return true;
  } catch {
    return false;
  }
}
```

Update `prepareFeatureGenerationExecution` to use `featurePatient`, `buildFeatureGenerationContract`, and `pairedEegStateInputs`:

```ts
  const patient = featurePatient(db, task.patient_id);

  if (!patient) {
    return { ok: false, message: '特征生成任务关联的患者不存在。' };
  }

  let contract: ReturnType<typeof buildFeatureGenerationContract>;
  let eegStatePairs: Array<Record<string, unknown>>;

  try {
    contract = buildFeatureGenerationContract(patient.affectedHand);
    eegStatePairs = pairedEegStateInputs(featureInputAssets(db, paths, task.patient_id));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
```

Write `subjectCode: patient.subjectCode`, `contract`, and `inputs.eegStatePairs` into the JSON package:

```ts
        subjectCode: patient.subjectCode,
        contract,
        inputs: {
          eegStatePairs,
          eegAssets: featureInputAssets(db, paths, task.patient_id),
        },
```

- [ ] **Step 4: Run the feature package tests and verify they pass**

Run:

```powershell
npx vitest run tests/electron/backend/featureArtifacts.test.ts
```

Expected: PASS after existing tests are updated to seed affected hand and EO/EC pairs where they expect queued feature tasks.

---

### Task 3: Feature Manifest Contract Validation

**Files:**
- Modify: `tests/electron/backend/featureArtifacts.test.ts`
- Modify: `src/electron/backend/featureArtifacts.ts`
- Use helper from: `src/electron/backend/modelPipelineContract.ts`

- [ ] **Step 1: Write failing feature manifest validation tests**

Update existing manifest-writing tests so valid PSD and FC artifacts include `params.shape`, `params.metric`, and `params.alignment`.

Use this artifact shape for valid test manifests:

```ts
{
  kind: 'PSD',
  state: 'EO',
  filePath: psdPath,
  featureCount: 5580,
  params: { shape: [62, 90], alignment: 'right_affected_c3' },
}
```

```ts
{
  kind: 'FC',
  state: 'EC',
  filePath: fcPath,
  featureCount: 1891,
  params: { shape: [1891, 6], metric: 'wpli', alignment: 'right_affected_c3' },
}
```

Add this negative test:

```ts
it('fails the feature task when PSD or WPLI manifest contract is wrong', async () => {
  const local = await openTempDatabase();
  const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '右手' });
  seedPreprocessedEegInputs(local, patientId);
  createFeatureGenerationBatch(local.db, local.paths, {
    patientIds: [patientId],
    featureKinds: ['PSD', 'FC'],
    states: ['EO', 'EC'],
    overwrite: false,
  });
  const task = listTasks(local.db, { type: 'feature_generation' })[0];
  const psdPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_psd_eo.npz');
  const manifestPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'feature_manifest.json');
  writeFile(psdPath, 'psd features');
  writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      artifacts: [
        {
          kind: 'PSD',
          state: 'EO',
          filePath: psdPath,
          featureCount: 5580,
          params: { shape: [62, 89], alignment: 'right_affected_c3' },
        },
      ],
    }),
  );

  const result = completeFeatureGenerationTask(local.db, task.id, manifestPath);

  expect(result).toEqual({
    ok: false,
    message: 'PSD 特征形状必须是 [62,90]。',
    indexedArtifacts: 0,
    artifactIds: [],
  });
  expect(listTasks(local.db, { status: 'failed' })[0]).toEqual(
    expect.objectContaining({ id: task.id, errorMessage: 'PSD 特征形状必须是 [62,90]。' }),
  );
});
```

- [ ] **Step 2: Run feature tests and verify the new manifest test fails**

Run:

```powershell
npx vitest run tests/electron/backend/featureArtifacts.test.ts
```

Expected: FAIL because `completeFeatureGenerationTask` accepts malformed feature manifest params.

- [ ] **Step 3: Apply manifest validation before indexing artifacts**

In `src/electron/backend/featureArtifacts.ts`, import:

```ts
import { assertFeatureArtifactContract } from './modelPipelineContract.js';
```

In `completeFeatureGenerationTask`, after parsing artifacts and before checking missing files, validate:

```ts
  try {
    for (const artifact of artifacts) {
      assertFeatureArtifactContract({
        kind: artifact.kind,
        state: artifact.state,
        params: artifact.params,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failTask(db, task.id, message);
    ensureFeatureWorkflowStatus(db, task.patient_id, '失败', message);
    addTaskLog(db, {
      taskId: task.id,
      patientId: task.patient_id,
      level: 'error',
      source: 'app',
      message,
    });
    return { ok: false, message, indexedArtifacts: 0, artifactIds: [] };
  }
```

- [ ] **Step 4: Run feature tests and contract tests**

Run:

```powershell
npx vitest run tests/electron/backend/modelPipelineContract.test.ts tests/electron/backend/featureArtifacts.test.ts
```

Expected: PASS.

---

### Task 4: Prediction Package Contract And Model Metadata

**Files:**
- Modify: `src/domain/backendTypes.ts`
- Modify: `tests/electron/backend/repositories.test.ts`
- Modify: `src/electron/backend/predictions.ts`
- Use helper from: `src/electron/backend/modelPipelineContract.ts`

- [ ] **Step 1: Write failing prediction package tests**

Add optional model metadata types in the test input once TypeScript is ready in Step 3:

```ts
const model = registerPredictionModel(local.db, {
  taskId: 'pr',
  name: 'ResidualAware_SWA',
  version: 'v2026.06',
  inputType: 'EEG-only',
  inputs: ['PSD', 'FC(wPLI)'],
  validation: 'Locked LOSO Acc: 0.91',
  status: '当前版本',
  artifactPath: modelPath,
  modelFamily: 'residual_aware_ssl_cnn',
  checkpointMode: 'fold_checkpoint_ensemble',
});
```

Add a helper in `tests/electron/backend/repositories.test.ts` near existing test helpers:

```ts
function indexModelReadyFeatures(local: LocalDatabase, patientId: string): string[] {
  const psdEoPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_psd_eo.npz');
  const psdEcPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_psd_ec.npz');
  const fcEoPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_fc_eo.npz');
  const fcEcPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_fc_ec.npz');

  for (const featurePath of [psdEoPath, psdEcPath, fcEoPath, fcEcPath]) {
    fs.mkdirSync(path.dirname(featurePath), { recursive: true });
    fs.writeFileSync(featurePath, 'features');
  }

  return [
    indexFeatureArtifact(local.db, {
      patientId,
      kind: 'PSD',
      state: 'EO',
      filePath: psdEoPath,
      featureCount: 5580,
      params: { shape: [62, 90], alignment: 'right_affected_c3' },
    }),
    indexFeatureArtifact(local.db, {
      patientId,
      kind: 'PSD',
      state: 'EC',
      filePath: psdEcPath,
      featureCount: 5580,
      params: { shape: [62, 90], alignment: 'right_affected_c3' },
    }),
    indexFeatureArtifact(local.db, {
      patientId,
      kind: 'FC',
      state: 'EO',
      filePath: fcEoPath,
      featureCount: 1891,
      params: { shape: [1891, 6], metric: 'wpli', alignment: 'right_affected_c3' },
    }),
    indexFeatureArtifact(local.db, {
      patientId,
      kind: 'FC',
      state: 'EC',
      filePath: fcEcPath,
      featureCount: 1891,
      params: { shape: [1891, 6], metric: 'wpli', alignment: 'right_affected_c3' },
    }),
  ];
}
```

Add this test:

```ts
it('prepares strict prediction package with model family, checkpoint mode, and feature provenance', async () => {
  const local = await openTempDatabase();
  const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '右手' });
  const modelPath = path.join(local.paths.dataRoot, 'models', 'residualaware_swa.json');
  const executablePath = path.join(local.paths.dataRoot, 'tools', 'python.exe');
  const scriptPath = path.join(local.paths.dataRoot, 'scripts', 'predict_recovery.py');
  fs.mkdirSync(path.dirname(modelPath), { recursive: true });
  fs.mkdirSync(path.dirname(executablePath), { recursive: true });
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(modelPath, '{"model":"locked"}');
  fs.writeFileSync(executablePath, 'python stub');
  fs.writeFileSync(scriptPath, 'prediction script stub');
  const featureArtifactIds = indexModelReadyFeatures(local, patientId);
  const model = registerPredictionModel(local.db, {
    taskId: 'pr',
    name: 'ResidualAware_SWA',
    version: 'v2026.06',
    inputType: 'EEG-only',
    inputs: ['PSD', 'FC(wPLI)'],
    validation: 'Locked LOSO Acc: 0.91',
    status: '当前版本',
    artifactPath: modelPath,
    modelFamily: 'residual_aware_ssl_cnn',
    checkpointMode: 'fold_checkpoint_ensemble',
  });
  createPredictionBatch(local.db, {
    taskId: 'pr',
    modelId: model.id,
    patientIds: [patientId],
    executor: { executablePath, scriptPath },
  });
  const queuedTask = listTasks(local.db, { type: 'prediction' })[0];

  const prepared = preparePredictionExecution(local.db, local.paths, queuedTask.id);
  const taskPackage = JSON.parse(fs.readFileSync(prepared.packagePath ?? '', 'utf8'));

  expect(prepared).toEqual(expect.objectContaining({ ok: true }));
  expect(taskPackage.contract).toEqual({
    requiredStates: ['EO', 'EC'],
    requiredFeatureKinds: ['PSD', 'FC'],
    fcMetric: 'wpli',
    alignment: 'right_affected_c3',
    affectedSide: 'right',
  });
  expect(taskPackage.model).toEqual(
    expect.objectContaining({
      id: model.id,
      modelFamily: 'residual_aware_ssl_cnn',
      checkpointMode: 'fold_checkpoint_ensemble',
    }),
  );
  expect(taskPackage.inputs.featureArtifactIds.sort()).toEqual(featureArtifactIds.sort());
});
```

Add this skip test:

```ts
it('skips final-model prediction when FC/WPLI or affected-side inputs are incomplete', async () => {
  const local = await openTempDatabase();
  const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });
  const psdPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_psd_eo.npz');
  fs.mkdirSync(path.dirname(psdPath), { recursive: true });
  fs.writeFileSync(psdPath, 'psd features');
  indexFeatureArtifact(local.db, {
    patientId,
    kind: 'PSD',
    state: 'EO',
    filePath: psdPath,
    featureCount: 5580,
    params: { shape: [62, 90], alignment: 'right_affected_c3' },
  });

  const result = createPredictionBatch(local.db, {
    taskId: 'pr',
    modelId: 'm2',
    patientIds: [patientId],
  });

  expect(result).toEqual({
    ok: false,
    message: '已创建 0 个预测任务，跳过 1 位患者。',
    batchId: expect.any(String),
    queuedTasks: 0,
    skippedPatients: [{ patientId, reason: '缺 PSD/FC(wPLI) EO/EC 特征或患侧信息' }],
  });
});
```

- [ ] **Step 2: Run prediction backend tests and verify they fail**

Run:

```powershell
npx vitest run tests/electron/backend/repositories.test.ts
```

Expected: FAIL because prediction model types do not accept `modelFamily/checkpointMode`, and prediction packages do not include strict contract fields.

- [ ] **Step 3: Extend backend types for model metadata and saved provenance**

In `src/domain/backendTypes.ts`, add:

```ts
export type PredictionModelFamily = 'traditional_ml' | 'residual_aware_ssl_cnn';
export type PredictionCheckpointMode =
  | 'saved_deployment_model'
  | 'fold_checkpoint_ensemble'
  | 'deployment_checkpoint'
  | 'external_script';
```

Extend `PredictionModel`:

```ts
  modelFamily: PredictionModelFamily;
  checkpointMode: PredictionCheckpointMode;
```

Extend `RegisterPredictionModelInput`:

```ts
  modelFamily?: PredictionModelFamily;
  checkpointMode?: PredictionCheckpointMode;
```

Extend `SavePredictionResultInput`:

```ts
  featureArtifactIds?: string[];
```

- [ ] **Step 4: Implement prediction package contract and compatibility checks**

In `src/electron/backend/predictions.ts`, import:

```ts
import {
  MODEL_PIPELINE_CONTRACT,
  assertAffectedSideForModelPipeline,
  assertFeatureArtifactContract,
} from './modelPipelineContract.js';
```

Add local helpers:

```ts
function normalizeModelFamily(model: Pick<PredictionModel, 'name' | 'inputs'>): PredictionModel['modelFamily'] {
  return /residual|barlow|ssl|cnn/i.test(model.name) ? 'residual_aware_ssl_cnn' : 'traditional_ml';
}

function normalizeCheckpointMode(
  modelFamily: PredictionModel['modelFamily'],
  value: PredictionModel['checkpointMode'] | undefined,
): PredictionModel['checkpointMode'] {
  if (value) return value;
  return modelFamily === 'residual_aware_ssl_cnn' ? 'fold_checkpoint_ensemble' : 'external_script';
}

function patientAffectedHand(db: Database, patientId: string): string {
  return queryOne<{ affected_hand: string }>(db, 'SELECT affected_hand FROM patients WHERE id = ?', [patientId])
    ?.affected_hand ?? '';
}

function strictPredictionFeatureInputs(db: Database, patientId: string): Array<Record<string, unknown>> {
  const features = predictionFeatureInputs(db, patientId);
  const required = [
    ['PSD', 'EO'],
    ['PSD', 'EC'],
    ['FC', 'EO'],
    ['FC', 'EC'],
  ] as const;

  for (const [kind, state] of required) {
    const feature = features.find((item) => item.kind === kind && item.state === state);
    if (!feature) {
      throw new Error('缺 PSD/FC(wPLI) EO/EC 特征或患侧信息');
    }

    assertFeatureArtifactContract({
      kind,
      state,
      params:
        feature.params && typeof feature.params === 'object' && !Array.isArray(feature.params)
          ? (feature.params as Record<string, unknown>)
          : {},
    });
  }

  return features.filter((item) =>
    required.some(([kind, state]) => item.kind === kind && item.state === state),
  );
}
```

Update default models and registered models so `modelFromRow` returns metadata:

```ts
modelFamily: row.model_family as PredictionModel['modelFamily'],
checkpointMode: row.checkpoint_mode as PredictionModel['checkpointMode'],
```

Because the existing database table does not have columns, use `ALTER TABLE` migrations in `src/electron/backend/database.ts` in Task 8. Until then, implement repository SQL after Task 8 adds columns.

Update `createPredictionBatch` to skip patients when strict features or affected side fail:

```ts
    try {
      assertAffectedSideForModelPipeline(patientAffectedHand(db, patientId));
      strictPredictionFeatureInputs(db, patientId);
    } catch {
      skippedPatients.push({ patientId, reason: '缺 PSD/FC(wPLI) EO/EC 特征或患侧信息' });
      continue;
    }
```

Update `preparePredictionExecution` to include strict contract:

```ts
  const affectedSide = assertAffectedSideForModelPipeline(patientAffectedHand(db, task.patient_id));
  const featureArtifacts = strictPredictionFeatureInputs(db, task.patient_id);
  const featureArtifactIds = featureArtifacts.map((feature) => String(feature.id));
```

Write:

```ts
        contract: {
          requiredStates: MODEL_PIPELINE_CONTRACT.requiredStates,
          requiredFeatureKinds: ['PSD', 'FC'],
          fcMetric: MODEL_PIPELINE_CONTRACT.wpliMetric,
          alignment: MODEL_PIPELINE_CONTRACT.alignment,
          affectedSide,
        },
        model: {
          id: model.id,
          name: model.name,
          version: model.version,
          inputType: model.inputType,
          inputs: model.inputs,
          artifactPath: model.artifactPath,
          modelFamily: model.modelFamily,
          checkpointMode: model.checkpointMode,
        },
        inputs: {
          featureArtifacts,
          featureArtifactIds,
        },
```

- [ ] **Step 5: Run prediction backend tests**

Run:

```powershell
npx vitest run tests/electron/backend/repositories.test.ts
```

Expected: FAIL until Task 8 database columns are added, then PASS after Task 8.

---

### Task 5: Prediction Result Provenance Validation

**Files:**
- Modify: `tests/electron/backend/repositories.test.ts`
- Modify: `src/electron/backend/predictions.ts`
- Use helper from: `src/electron/backend/modelPipelineContract.ts`

- [ ] **Step 1: Write failing prediction result provenance tests**

Update external prediction executor test to write result provenance:

```ts
fs.writeFileSync(
  taskPackage.outputs.resultPath,
  JSON.stringify({
    prediction: {
      predictedClass: '恢复不良',
      probability: 0.82,
      threshold: 0.5,
      labelDefinition: taskPackage.request.labelDefinition,
      taskId: taskPackage.request.taskId,
      modelId: taskPackage.request.modelId,
      featureArtifactIds: taskPackage.inputs.featureArtifactIds,
    },
  }),
);
```

Add this negative test:

```ts
it('fails prediction completion when result feature provenance does not match the task package', async () => {
  const local = await openTempDatabase();
  const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '右手' });
  const featureArtifactIds = indexModelReadyFeatures(local, patientId);
  createPredictionBatch(local.db, {
    taskId: 'pr',
    modelId: 'm2',
    patientIds: [patientId],
  });
  const queuedTask = listTasks(local.db, { type: 'prediction' })[0];
  const prepared = preparePredictionExecution(local.db, local.paths, queuedTask.id);
  const resultPath = prepared.resultPath ?? path.join(local.paths.outputsRoot, 'predictions', 'bad_provenance.json');
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(
    resultPath,
    JSON.stringify({
      prediction: {
        predictedClass: '比例恢复',
        probability: 0.91,
        threshold: 0.5,
        labelDefinition: '比例恢复 (PR) vs 恢复不良',
        taskId: 'pr',
        modelId: 'm2',
        featureArtifactIds: [featureArtifactIds[0]],
      },
    }),
  );

  const result = completePredictionTask(local.db, queuedTask.id, resultPath);

  expect(result).toEqual({
    ok: false,
    message: 'featureArtifactIds 不一致。',
    predictionId: null,
  });
  expect(listTasks(local.db, { status: 'failed' })[0]).toEqual(
    expect.objectContaining({ id: queuedTask.id, errorMessage: 'featureArtifactIds 不一致。' }),
  );
});
```

- [ ] **Step 2: Run prediction tests and verify provenance test fails**

Run:

```powershell
npx vitest run tests/electron/backend/repositories.test.ts
```

Expected: FAIL because prediction result import does not yet compare `featureArtifactIds`.

- [ ] **Step 3: Implement result provenance parsing and comparison**

In `src/electron/backend/predictions.ts`, import:

```ts
import { assertMatchingStringSets } from './modelPipelineContract.js';
```

Extend parsed result:

```ts
type ParsedPredictionResult = {
  predictedClass: RecoveryPredictionClass;
  probability: number;
  threshold: number;
  labelDefinition: string;
  taskId: string;
  modelId: string;
  featureArtifactIds: string[];
};
```

Update `parsePredictionResult`:

```ts
  const taskId = payload.taskId;
  const modelId = payload.modelId;
  const featureArtifactIds = normalizeStringArray(payload.featureArtifactIds);

  if (typeof taskId !== 'string' || taskId.trim() === '') {
    throw new Error('预测结果缺少 taskId。');
  }

  if (typeof modelId !== 'string' || modelId.trim() === '') {
    throw new Error('预测结果缺少 modelId。');
  }

  if (featureArtifactIds.length === 0) {
    throw new Error('预测结果缺少 featureArtifactIds。');
  }
```

Return the new fields.

In `completePredictionTask`, after label comparison, compare model/task/provenance:

```ts
  if (prediction.taskId !== taskName) {
    return failPredictionTask(db, task, `预测结果任务不匹配：期望“${taskName}”，实际“${prediction.taskId}”。`);
  }

  if (prediction.modelId !== modelId) {
    return failPredictionTask(db, task, `预测结果模型不匹配：期望“${modelId}”，实际“${prediction.modelId}”。`);
  }

  const preparedOutput = parseJsonObject(task.output_json);
  const expectedFeatureArtifactIds = normalizeStringArray(preparedOutput.featureArtifactIds);

  try {
    assertMatchingStringSets(prediction.featureArtifactIds, expectedFeatureArtifactIds, 'featureArtifactIds');
  } catch (error) {
    return failPredictionTask(db, task, error instanceof Error ? error.message : String(error));
  }
```

When preparing prediction execution, store `featureArtifactIds` in task `output_json`:

```ts
        featureArtifactIds,
```

When saving and completing prediction, preserve provenance:

```ts
  const predictionId = savePredictionResult(db, {
    patientId: task.patient_id,
    taskId: taskName,
    modelId,
    predictedClass: prediction.predictedClass,
    probability: prediction.probability,
    threshold: prediction.threshold,
    labelDefinition: prediction.labelDefinition,
    featureArtifactIds: prediction.featureArtifactIds,
  });
```

Add to completed task output:

```ts
featureArtifactIds: prediction.featureArtifactIds,
```

- [ ] **Step 4: Run prediction backend tests**

Run:

```powershell
npx vitest run tests/electron/backend/repositories.test.ts
```

Expected: FAIL until database schema supports model metadata and prediction result provenance columns in Task 8, then PASS after Task 8.

---

### Task 6: Explainability Binding To Prediction Result Provenance

**Files:**
- Modify: `tests/electron/backend/explainability.test.ts`
- Modify: `src/electron/backend/explainability.ts`
- Modify: `src/electron/backend/predictions.ts`

- [ ] **Step 1: Write failing explainability binding test**

Add a helper in `tests/electron/backend/explainability.test.ts`:

```ts
function indexExplanationReadyFeatures(local: LocalDatabase, patientId: string): string[] {
  const psdPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_psd_eo.npz');
  const fcPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_fc_ec.npz');
  writeFile(psdPath, 'psd features');
  writeFile(fcPath, 'fc features');

  return [
    indexFeatureArtifact(local.db, {
      patientId,
      kind: 'PSD',
      state: 'EO',
      filePath: psdPath,
      featureCount: 5580,
      params: { shape: [62, 90], alignment: 'right_affected_c3' },
    }) ?? '',
    indexFeatureArtifact(local.db, {
      patientId,
      kind: 'FC',
      state: 'EC',
      filePath: fcPath,
      featureCount: 1891,
      params: { shape: [1891, 6], metric: 'wpli', alignment: 'right_affected_c3' },
    }) ?? '',
  ];
}
```

Add this test:

```ts
it('prepares explainability package bound to the queued prediction result and feature IDs', async () => {
  const local = await openTempDatabase();
  const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });
  const featureArtifactIds = indexExplanationReadyFeatures(local, patientId);
  const predictionId = savePredictionResult(local.db, {
    patientId,
    taskId: 'pr',
    modelId: 'm2',
    predictedClass: '比例恢复',
    probability: 0.87,
    threshold: 0.5,
    labelDefinition: '比例恢复 (PR) vs 恢复不良',
    featureArtifactIds,
  });
  createExplainabilityBatch(local.db, {
    taskId: 'pr',
    modelId: 'm2',
    patientIds: [patientId],
    artifactTypes: ['patient_shap', 'psd_heatmap'],
  });
  const task = listTasks(local.db, { type: 'explainability' })[0];

  const prepared = prepareExplainabilityExecution(local.db, local.paths, task.id);
  const taskPackage = JSON.parse(fs.readFileSync(prepared.packagePath ?? '', 'utf8'));

  expect(prepared).toEqual(expect.objectContaining({ ok: true }));
  expect(taskPackage.request).toEqual(
    expect.objectContaining({
      predictionResultId: predictionId,
      target: 'classification_logit',
      labelDefinition: '比例恢复 (PR) vs 恢复不良',
    }),
  );
  expect(taskPackage.contract).toEqual(
    expect.objectContaining({
      requiredStates: ['EO', 'EC'],
      requiredFeatureKinds: ['PSD', 'FC'],
      fcMetric: 'wpli',
      alignment: 'right_affected_c3',
      featureArtifactIds,
    }),
  );
});
```

- [ ] **Step 2: Run explainability tests and verify binding test fails**

Run:

```powershell
npx vitest run tests/electron/backend/explainability.test.ts
```

Expected: FAIL because prediction results do not yet persist feature artifact IDs and package contract fields are missing.

- [ ] **Step 3: Persist prediction feature IDs and expose them to explainability**

In `src/electron/backend/database.ts`, Task 8 will add `feature_artifact_ids_json` to `prediction_results`.

In `src/electron/backend/predictions.ts`, update `savePredictionResult` insert:

```ts
feature_artifact_ids_json
```

with:

```ts
JSON.stringify(input.featureArtifactIds ?? [])
```

In `src/electron/backend/explainability.ts`, extend `getLatestPredictionDetail` and `getPredictionDetailById` row selections:

```sql
feature_artifact_ids_json
```

and return object field:

```ts
feature_artifact_ids_json: string;
```

When `createExplainabilityBatch` queues a task, keep the concrete prediction result ID as it already does. In `prepareExplainabilityExecution`, parse feature IDs:

```ts
const featureArtifactIds = normalizeStringArray(JSON.parse(prediction.feature_artifact_ids_json || '[]'));
```

Use safer parsing:

```ts
function parseStringArrayJson(value: string): string[] {
  try {
    return normalizeStringArray(JSON.parse(value));
  } catch {
    return [];
  }
}
```

Write package fields:

```ts
        request: {
          taskId: predictionTaskId,
          modelId,
          predictionResultId: prediction.id,
          artifactTypes: normalizeStringArray(input.artifactTypes),
          target: 'classification_logit',
          labelDefinition: prediction.label_definition,
        },
        contract: {
          requiredStates: ['EO', 'EC'],
          requiredFeatureKinds: ['PSD', 'FC'],
          fcMetric: 'wpli',
          alignment: 'right_affected_c3',
          featureArtifactIds,
        },
```

Update `inputs.featureArtifacts` to include only the provenance IDs:

```ts
featureArtifacts: explanationFeatureInputs(db, task.patient_id).filter((feature) =>
  featureArtifactIds.includes(String(feature.id)),
),
```

- [ ] **Step 4: Run explainability tests**

Run:

```powershell
npx vitest run tests/electron/backend/explainability.test.ts
```

Expected: FAIL until Task 8 adds database schema support, then PASS after Task 8.

---

### Task 7: Explainability Manifest Target And Provenance Validation

**Files:**
- Modify: `tests/electron/backend/explainability.test.ts`
- Modify: `src/electron/backend/explainability.ts`
- Use helper from: `src/electron/backend/modelPipelineContract.ts`

- [ ] **Step 1: Write failing explainability manifest validation tests**

Update valid manifest writes to include:

```ts
{
  target: 'classification_logit',
  predictionResultId: taskPackage.request.predictionResultId,
  modelId: taskPackage.request.modelId,
  featureArtifactIds: taskPackage.contract.featureArtifactIds,
  artifacts: [
    {
      artifactType: 'patient_shap',
      title: 'sub01 SHAP force plot',
      method: 'Integrated Gradients',
      filePath: shapPath,
      topFeatures: [{ name: 'Oz Alpha PSD', score: 0.22, modality: 'PSD', direction: 'positive' }],
    },
  ],
}
```

Add this negative test:

```ts
it('fails explainability completion when manifest target is not classification_logit', async () => {
  const local = await openTempDatabase();
  const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });
  const featureArtifactIds = indexExplanationReadyFeatures(local, patientId);
  const predictionId = savePredictionResult(local.db, {
    patientId,
    taskId: 'pr',
    modelId: 'm2',
    predictedClass: '恢复不良',
    probability: 0.33,
    threshold: 0.5,
    labelDefinition: '比例恢复 (PR) vs 恢复不良',
    featureArtifactIds,
  });
  createExplainabilityBatch(local.db, {
    taskId: 'pr',
    modelId: 'm2',
    patientIds: [patientId],
    artifactTypes: ['patient_shap'],
  });
  const task = listTasks(local.db, { type: 'explainability' })[0];
  const prepared = prepareExplainabilityExecution(local.db, local.paths, task.id);
  const shapPath = path.join(prepared.outputDirectory ?? local.paths.outputsRoot, 'sub01_shap.svg');
  writeFile(shapPath, '<svg>shap</svg>');
  writeFile(
    prepared.manifestPath ?? path.join(local.paths.outputsRoot, 'bad_explainability_manifest.json'),
    JSON.stringify({
      target: 'predicted_label',
      predictionResultId: predictionId,
      modelId: 'm2',
      featureArtifactIds,
      artifacts: [
        {
          artifactType: 'patient_shap',
          title: 'sub01 SHAP force plot',
          method: 'Integrated Gradients',
          filePath: shapPath,
        },
      ],
    }),
  );

  const result = completeExplainabilityTask(local.db, task.id, prepared.manifestPath ?? '');

  expect(result).toEqual({
    ok: false,
    message: '解释性结果必须解释 classification_logit。',
    indexedArtifacts: 0,
    artifactIds: [],
  });
  expect(listPredictionQueue(local.db, { taskId: 'pr' })[0]).toEqual(
    expect.objectContaining({ patientId, explanationStatus: '需复核' }),
  );
});
```

- [ ] **Step 2: Run explainability tests and verify manifest target test fails**

Run:

```powershell
npx vitest run tests/electron/backend/explainability.test.ts
```

Expected: FAIL because explainability manifest target and provenance are not validated.

- [ ] **Step 3: Implement explainability manifest target and provenance validation**

In `src/electron/backend/explainability.ts`, import:

```ts
import { MODEL_PIPELINE_CONTRACT, assertMatchingStringSets } from './modelPipelineContract.js';
```

In `completeExplainabilityTask`, after parsing the input task JSON and before `manifestArtifacts`, parse the manifest once:

```ts
  let manifest: Record<string, unknown>;

  try {
    manifest = parseJsonFile(manifestPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failExplainabilityTask(db, task, message, predictionTaskId, modelId);
  }

  if (manifest.target !== MODEL_PIPELINE_CONTRACT.explainabilityTarget) {
    return failExplainabilityTask(
      db,
      task,
      '解释性结果必须解释 classification_logit。',
      predictionTaskId,
      modelId,
    );
  }

  if (manifest.predictionResultId !== input.predictionResultId) {
    return failExplainabilityTask(
      db,
      task,
      '解释性结果 predictionResultId 与任务不一致。',
      predictionTaskId,
      modelId,
    );
  }

  if (manifest.modelId !== modelId) {
    return failExplainabilityTask(db, task, '解释性结果 modelId 与任务不一致。', predictionTaskId, modelId);
  }

  try {
    assertMatchingStringSets(
      normalizeStringArray(manifest.featureArtifactIds),
      normalizeStringArray(input.featureArtifactIds),
      'featureArtifactIds',
    );
  } catch (error) {
    return failExplainabilityTask(db, task, error instanceof Error ? error.message : String(error), predictionTaskId, modelId);
  }
```

Then call:

```ts
artifacts = manifestArtifacts(manifest);
```

- [ ] **Step 4: Run explainability tests**

Run:

```powershell
npx vitest run tests/electron/backend/explainability.test.ts
```

Expected: PASS after Task 8 schema changes are complete.

---

### Task 8: Database Schema For Model Metadata And Prediction Provenance

**Files:**
- Modify: `src/electron/backend/database.ts`
- Modify: `src/electron/backend/predictions.ts`
- Modify: `tests/electron/backend/database.test.ts`

- [ ] **Step 1: Write failing database schema test**

In `tests/electron/backend/database.test.ts`, add:

```ts
it('creates model metadata and prediction provenance columns', async () => {
  const local = await openTempDatabase();

  const predictionModelColumns = local.db
    .exec("PRAGMA table_info(prediction_models)")
    .flatMap((result) => result.values.map((row) => row[1]));
  const predictionResultColumns = local.db
    .exec("PRAGMA table_info(prediction_results)")
    .flatMap((result) => result.values.map((row) => row[1]));

  expect(predictionModelColumns).toEqual(expect.arrayContaining(['model_family', 'checkpoint_mode']));
  expect(predictionResultColumns).toEqual(expect.arrayContaining(['feature_artifact_ids_json']));
});
```

- [ ] **Step 2: Run database test and verify it fails**

Run:

```powershell
npx vitest run tests/electron/backend/database.test.ts
```

Expected: FAIL because the columns do not exist.

- [ ] **Step 3: Add schema columns and migration backfill**

In `src/electron/backend/database.ts`, update `CREATE TABLE prediction_models` with:

```sql
    model_family TEXT NOT NULL DEFAULT 'traditional_ml',
    checkpoint_mode TEXT NOT NULL DEFAULT 'external_script',
```

Update `CREATE TABLE prediction_results` with:

```sql
    feature_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
```

Add migration statements after table creation entries:

```ts
  "ALTER TABLE prediction_models ADD COLUMN model_family TEXT NOT NULL DEFAULT 'traditional_ml'",
  "ALTER TABLE prediction_models ADD COLUMN checkpoint_mode TEXT NOT NULL DEFAULT 'external_script'",
  "ALTER TABLE prediction_results ADD COLUMN feature_artifact_ids_json TEXT NOT NULL DEFAULT '[]'",
```

Wrap migration execution so duplicate-column errors from existing databases are ignored:

```ts
function runMigrations(db: Database): void {
  enableForeignKeys(db);

  for (const migration of migrations) {
    try {
      db.run(migration);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column name/i.test(message)) {
        throw error;
      }
    }
  }

  enableForeignKeys(db);
}
```

- [ ] **Step 4: Update predictions SQL for new fields**

In `src/electron/backend/predictions.ts`, update `defaultPredictionModels`:

```ts
modelFamily: 'traditional_ml',
checkpointMode: 'external_script',
```

Use `residual_aware_ssl_cnn` and `fold_checkpoint_ensemble` only for registered residual-aware models or a future default entry.

Update `ensureDefaultPredictionModels` insert columns:

```sql
model_family, checkpoint_mode,
```

and values:

```ts
model.modelFamily,
model.checkpointMode,
```

Update `registerPredictionModel` insert/update columns:

```sql
model_family, checkpoint_mode,
```

and values:

```ts
const modelFamily = input.modelFamily ?? normalizeModelFamily({ name, inputs });
const checkpointMode = normalizeCheckpointMode(modelFamily, input.checkpointMode);
```

Update `modelFromRow` and all prediction model SELECTs to include:

```sql
model_family,
checkpoint_mode,
```

Update `savePredictionResult` insert columns and values:

```sql
feature_artifact_ids_json,
```

```ts
JSON.stringify(input.featureArtifactIds ?? []),
```

- [ ] **Step 5: Run database and prediction backend tests**

Run:

```powershell
npx vitest run tests/electron/backend/database.test.ts tests/electron/backend/repositories.test.ts
```

Expected: PASS.

---

### Task 9: Queue Integration And Full Verification

**Files:**
- Modify: `tests/electron/backend/taskQueue.test.ts`
- Verify: all modified backend files

- [ ] **Step 1: Add queue regression test for strict task packages**

In `tests/electron/backend/taskQueue.test.ts`, add a regression where a queued prediction task runs through `startNextQueuedTask` and the executor reads strict package fields:

```ts
it('runs strict prediction packages through the unified queue', async () => {
  const local = await openTempDatabase();
  const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '右手' });
  const featureArtifactIds = indexModelReadyFeatures(local, patientId);
  const executablePath = path.join(local.paths.dataRoot, 'tools', 'python.exe');
  const scriptPath = path.join(local.paths.dataRoot, 'scripts', 'predict_recovery.py');
  fs.mkdirSync(path.dirname(executablePath), { recursive: true });
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(executablePath, 'python stub');
  fs.writeFileSync(scriptPath, 'prediction script stub');
  createPredictionBatch(local.db, {
    taskId: 'pr',
    modelId: 'm2',
    patientIds: [patientId],
    executor: { executablePath, scriptPath },
  });
  const executePrediction = vi.fn().mockImplementation(async (_executable: string, args: string[]) => {
    const packagePath = args[args.length - 1];
    const taskPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    expect(taskPackage.contract.requiredStates).toEqual(['EO', 'EC']);
    expect(taskPackage.inputs.featureArtifactIds.sort()).toEqual(featureArtifactIds.sort());
    fs.writeFileSync(
      taskPackage.outputs.resultPath,
      JSON.stringify({
        prediction: {
          predictedClass: '比例恢复',
          probability: 0.76,
          threshold: 0.5,
          labelDefinition: taskPackage.request.labelDefinition,
          taskId: taskPackage.request.taskId,
          modelId: taskPackage.request.modelId,
          featureArtifactIds: taskPackage.inputs.featureArtifactIds,
        },
      }),
    );
    return { exitCode: 0, stdout: 'queued prediction generated', stderr: '' };
  });

  const result = await startNextQueuedTask(local.db, local.paths, { executePrediction });

  expect(result).toEqual(
    expect.objectContaining({
      ok: true,
      taskType: 'prediction',
      message: '预测任务已完成：比例恢复 0.76。',
    }),
  );
});
```

If `indexModelReadyFeatures` is not available in this file, copy the helper from `tests/electron/backend/repositories.test.ts` into `taskQueue.test.ts`. This is test-local duplication to keep tests independent.

- [ ] **Step 2: Run queue test and verify it fails if queue integration missed contract fields**

Run:

```powershell
npx vitest run tests/electron/backend/taskQueue.test.ts
```

Expected: PASS if Tasks 4, 5, and 8 are complete. If it fails, the failure identifies the missing contract or result provenance field in the queue path.

- [ ] **Step 3: Run backend test subset**

Run:

```powershell
npx vitest run tests/electron/backend/modelPipelineContract.test.ts tests/electron/backend/featureArtifacts.test.ts tests/electron/backend/repositories.test.ts tests/electron/backend/explainability.test.ts tests/electron/backend/taskQueue.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full project verification**

Run:

```powershell
npm run test
npm run build
npm run electron:compile
```

Expected:

- `npm run test`: PASS.
- `npm run build`: PASS with TypeScript and Vite build complete.
- `npm run electron:compile`: PASS with Electron main/preload compilation complete.

- [ ] **Step 5: Record changed files**

Because the checkout is not a Git repository, do not run `git add` or `git commit`. In the final implementation summary, list:

- New files.
- Modified files.
- Verification commands and outcomes.
- Any tests not run and the exact reason.

---

## Self-Review Checklist

Spec coverage:

- Shared contract constants and helpers are covered by Task 1.
- Feature EO/EC `.set/.fdt` pairing and affected-side package fields are covered by Task 2.
- Feature manifest PSD/WPLI shape, metric, and alignment validation are covered by Task 3.
- Prediction model family, checkpoint mode, feature artifact IDs, and strict feature inputs are covered by Task 4.
- Prediction result model/task/label/provenance validation is covered by Task 5.
- Explainability prediction-result binding and feature provenance are covered by Task 6.
- Explainability `classification_logit` target and manifest provenance validation are covered by Task 7.
- Database storage for model metadata and prediction feature IDs is covered by Task 8.
- Unified queue and full verification are covered by Task 9.

Completion-marker scan:

- No task contains unfinished markers or undefined behavior.
- Every new helper named in later tasks is introduced in an earlier task.

Type consistency:

- `featureArtifactIds` is the spelling used in packages, result JSON, completed task output, and saved prediction inputs.
- `modelFamily` and `checkpointMode` are TypeScript property names; database columns are `model_family` and `checkpoint_mode`.
- The strict alignment value is `right_affected_c3`.
- The strict explanation target is `classification_logit`.
