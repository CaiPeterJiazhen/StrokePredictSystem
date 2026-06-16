import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLocalDatabase, type LocalDatabase } from '../../../src/electron/backend/database.js';
import {
  createFeatureGenerationBatch,
  indexFeatureArtifact,
  listFeatureArtifacts,
  listFeatureOverview,
} from '../../../src/electron/backend/featureArtifacts.js';
import {
  createExplainabilityBatch,
  prepareExplainabilityExecution,
} from '../../../src/electron/backend/explainability.js';
import {
  listPatientAssetSummary,
  upsertDataAsset,
  upsertSourceRoot,
} from '../../../src/electron/backend/dataLibrary/repository.js';
import {
  completePredictionTask,
  createPredictionBatch,
  listPredictionModels,
  listPredictionQueue,
  preparePredictionExecution,
  registerPredictionModel,
  runPredictionExecution,
  savePredictionResult,
} from '../../../src/electron/backend/predictions.js';
import {
  addTask,
  addTaskLog,
  createPatient,
  clearWorkspaceData,
  deletePatient,
  getSettings,
  getWorkbenchData,
  listTaskLogs,
  listTasks,
  registerEegFile,
  retryTask,
  cancelTask,
  updateSettings,
} from '../../../src/electron/backend/repositories.js';

const roots: string[] = [];
const locals: LocalDatabase[] = [];

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-repo-'));
  roots.push(root);
  return root;
}

async function openTempDatabase(): Promise<LocalDatabase> {
  const local = await openLocalDatabase(createTempRoot());
  locals.push(local);
  return local;
}

function seedPreprocessedEegInput(local: LocalDatabase, patientId: string, subjectCode: string): void {
  const sourceRoot = upsertSourceRoot(local.db, {
    projectName: 'EEG_M1',
    rootPath: path.join(local.paths.dataRoot, 'source-library'),
    status: 'active',
  });

  for (const stateSubjectCode of [`${subjectCode}1`, `${subjectCode}2`]) {
    const setPath = path.join(
      sourceRoot.rootPath,
      'Patient_tACS_M1_RestingStateEEG_afterProcess',
      '基线',
      stateSubjectCode,
      `${stateSubjectCode}.set`,
    );
    const fdtPath = path.join(
      sourceRoot.rootPath,
      'Patient_tACS_M1_RestingStateEEG_afterProcess',
      '基线',
      stateSubjectCode,
      `${stateSubjectCode}.fdt`,
    );

    fs.mkdirSync(path.dirname(setPath), { recursive: true });
    fs.writeFileSync(setPath, 'preprocessed set');
    fs.writeFileSync(fdtPath, 'preprocessed fdt');

    for (const [assetType, filePath] of [
      ['processed_eeg_set', setPath],
      ['processed_eeg_fdt', fdtPath],
    ] as const) {
      upsertDataAsset(local.db, {
        sourceRootId: sourceRoot.id,
        patientId,
        subjectCode: stateSubjectCode,
        sourceSubjectCode: stateSubjectCode,
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

function indexModelReadyFeatures(local: LocalDatabase, patientId: string): string[] {
  const specs = [
    {
      kind: 'PSD',
      state: 'EO',
      suffix: 'psd_eo',
      featureCount: 5580,
      params: { shape: [62, 90], alignment: 'right_affected_c3' },
    },
    {
      kind: 'PSD',
      state: 'EC',
      suffix: 'psd_ec',
      featureCount: 5580,
      params: { shape: [62, 90], alignment: 'right_affected_c3' },
    },
    {
      kind: 'FC',
      state: 'EO',
      suffix: 'fc_eo',
      featureCount: 11346,
      params: { shape: [1891, 6], metric: 'wpli', alignment: 'right_affected_c3' },
    },
    {
      kind: 'FC',
      state: 'EC',
      suffix: 'fc_ec',
      featureCount: 11346,
      params: { shape: [1891, 6], metric: 'wpli', alignment: 'right_affected_c3' },
    },
  ] as const;

  return specs.map((spec) => {
    const filePath = path.join(local.paths.outputsRoot, 'features', patientId, `${patientId}_${spec.suffix}.npz`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${spec.kind} ${spec.state} features`);

    return indexFeatureArtifact(local.db, {
      patientId,
      kind: spec.kind,
      state: spec.state,
      filePath,
      featureCount: spec.featureCount,
      params: spec.params,
    });
  });
}

function registerResidualAwareModel(local: LocalDatabase) {
  const modelPath = path.join(local.paths.dataRoot, 'models', `residualaware_swa_${Date.now()}.json`);
  fs.mkdirSync(path.dirname(modelPath), { recursive: true });
  fs.writeFileSync(modelPath, '{"model":"locked"}');

  return registerPredictionModel(local.db, {
    taskId: 'pr',
    name: 'ResidualAware_SWA',
    version: `v${Date.now()}`,
    modelFamily: 'residual_aware_ssl_cnn',
    checkpointMode: 'fold_checkpoint_ensemble',
    inputType: 'EEG-only',
    inputs: ['PSD', 'FC(wPLI)'],
    artifactPath: modelPath,
  });
}

afterEach(() => {
  for (const local of locals.splice(0)) {
    local.close();
  }

  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('backend repositories', () => {
  it('keeps patient workbench and data library summaries in sync for patients without indexed assets', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, {
      subjectCode: 'sub01',
      name: '穆祥贵',
      affectedHand: '左手',
    });

    expect(getWorkbenchData(local.db, local.paths.dataRoot).patients).toEqual([
      expect.objectContaining({ id: 'sub01', patientId }),
    ]);
    expect(listPatientAssetSummary(local.db)).toEqual([
      expect.objectContaining({
        patientId,
        subjectCode: 'sub01',
        subjectName: '穆祥贵',
        cohort: 'patient',
        baselineRawCount: 0,
        baselineProcessedPairs: 0,
      }),
    ]);
  });

  it('deletes a patient from both the workbench and data library without leaving orphan summaries', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, {
      subjectCode: 'sub01',
      name: '穆祥贵',
      affectedHand: '左手',
    });
    const sourceRoot = upsertSourceRoot(local.db, {
      projectName: 'EEG_M1',
      rootPath: path.join(local.paths.dataRoot, 'source-library'),
      status: 'active',
    });
    const cntPath = path.join(sourceRoot.rootPath, 'Patient_tACS_M1_EEG', '基线', 'sub01穆祥贵', 'mxg1.cnt');
    fs.mkdirSync(path.dirname(cntPath), { recursive: true });
    fs.writeFileSync(cntPath, 'cnt');
    upsertDataAsset(local.db, {
      sourceRootId: sourceRoot.id,
      patientId,
      subjectCode: 'sub01',
      sourceSubjectCode: 'sub01穆祥贵',
      subjectName: '穆祥贵',
      cohort: 'patient',
      stage: '基线',
      assetType: 'raw_eeg_cnt',
      filePath: cntPath,
      backupPath: null,
      fileSize: 3,
      fileHash: '',
      existsOnDisk: true,
      matchStatus: 'matched',
    });

    expect(listPatientAssetSummary(local.db)).toHaveLength(1);

    const result = deletePatient(local.db, patientId);

    expect(result).toEqual({ ok: true, message: '已删除患者 sub01。' });
    expect(getWorkbenchData(local.db, local.paths.dataRoot).patients).toEqual([]);
    expect(listPatientAssetSummary(local.db)).toEqual([]);
  });

  it('clears patient workspace data while preserving settings and seeded prediction models', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, {
      subjectCode: 'sub01',
      name: '穆祥贵',
      affectedHand: '左手',
    });
    const sourceRoot = upsertSourceRoot(local.db, {
      projectName: 'EEG_M1',
      rootPath: path.join(local.paths.dataRoot, 'source-library'),
      status: 'active',
    });
    updateSettings(local.db, { dataRoot: 'F:\\CJZFile\\EEG_M1' });
    upsertDataAsset(local.db, {
      sourceRootId: sourceRoot.id,
      patientId,
      subjectCode: 'sub01',
      sourceSubjectCode: 'sub01穆祥贵',
      subjectName: '穆祥贵',
      cohort: 'patient',
      stage: '基线',
      assetType: 'raw_eeg_cnt',
      filePath: path.join(sourceRoot.rootPath, 'mxg1.cnt'),
      backupPath: null,
      fileSize: 0,
      fileHash: '',
      existsOnDisk: false,
      matchStatus: 'needs_review',
    });

    const result = clearWorkspaceData(local.db);

    expect(result).toEqual({ ok: true, message: '已清空患者工作台与数据文档库记录。' });
    expect(getWorkbenchData(local.db, local.paths.dataRoot).patients).toEqual([]);
    expect(listPatientAssetSummary(local.db)).toEqual([]);
    expect(getSettings(local.db).dataRoot).toBe('F:\\CJZFile\\EEG_M1');
    expect(listPredictionModels(local.db, 'pr').map((model) => model.id)).toEqual(expect.arrayContaining(['m2']));
  });

  it('seeds the PR task with the real EEG model comparison and final locked model metrics', async () => {
    const local = await openTempDatabase();

    const models = listPredictionModels(local.db, 'pr');

    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Logistic_L1_PSD_WPLI',
          accuracy: 0.7368,
          balancedAccuracy: 0.7333,
          rocAuc: 0.7111,
          prAuc: 0.7754,
        }),
        expect.objectContaining({
          name: 'No_SSL_CNN',
          accuracy: 0.7632,
          balancedAccuracy: 0.7567,
          rocAuc: 0.7733,
          prAuc: 0.7535,
        }),
        expect.objectContaining({
          name: 'Barlow_CNN',
          accuracy: 0.7895,
          balancedAccuracy: 0.7822,
          rocAuc: 0.7767,
          prAuc: 0.7532,
        }),
        expect.objectContaining({
          name: 'ResidualAware_CNN',
          accuracy: 0.8158,
          balancedAccuracy: 0.8122,
          rocAuc: 0.8989,
          prAuc: 0.9084,
        }),
        expect.objectContaining({
          id: 'm2',
          name: 'ResidualAware_SSL_CNN',
          version: 'locked_10seed_final',
          modelFamily: 'residual_aware_ssl_cnn',
          checkpointMode: 'fold_checkpoint_ensemble',
          inputType: 'EEG-only',
          accuracy: 0.8474,
          balancedAccuracy: 0.8411,
          rocAuc: 0.8867,
          prAuc: 0.891,
          status: '当前版本',
        }),
      ]),
    );
  });

  it('refreshes legacy default model rows to the real final model metadata', async () => {
    const local = await openTempDatabase();
    const timestamp = '2026-06-15T00:00:00.000Z';

    local.db.run(
      `INSERT INTO prediction_models (
        id, task_id, name, version, model_family, checkpoint_mode, input_type, inputs_json, validation,
        accuracy, balanced_accuracy, roc_auc, pr_auc, status, artifact_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'm2',
        'pr',
        'RandomForest_Baseline',
        'v1.5.2',
        'traditional_ml',
        'external_script',
        'EEG-only',
        JSON.stringify(['PSD', 'FC(PLV)']),
        'legacy placeholder',
        0.782,
        0.75,
        0.83,
        0.8,
        '候选版本',
        '',
        timestamp,
        timestamp,
      ],
    );

    expect(listPredictionModels(local.db, 'pr')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'm2',
          name: 'ResidualAware_SSL_CNN',
          version: 'locked_10seed_final',
          accuracy: 0.8474,
          balancedAccuracy: 0.8411,
          status: '当前版本',
        }),
      ]),
    );
  });

  it('creates a patient, registers an existing EO file, and returns workbench patient data', async () => {
    const local = await openTempDatabase();
    const eegFilePath = path.join(local.paths.dataRoot, 'sub01_eo.set');
    fs.writeFileSync(eegFilePath, 'placeholder');

    const patientId = createPatient(local.db, {
      subjectCode: 'sub01',
      affectedHand: '左手',
    });
    registerEegFile(local.db, {
      patientId,
      condition: 'EO',
      filePath: eegFilePath,
    });

    const workbench = getWorkbenchData(local.db, local.paths.dataRoot);

    expect(workbench.patients).toEqual([
      expect.objectContaining({
        id: 'sub01',
        patientId,
        hand: '左手',
        eo: true,
        ec: false,
        preStatus: '未开始',
        featStatus: '未开始',
        task: 'tACS_Outcome',
        predict: '-',
        prob: null,
        report: '未生成',
      }),
    ]);
  });

  it('persists settings and exposes running tasks with newest logs', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub02' });

    const settings = updateSettings(local.db, {
      matlabExecutable: 'C:\\MATLAB\\bin\\matlab.exe',
      pythonExecutable: 'C:\\Python311\\python.exe',
      featureGeneratorScript: 'F:\\StrokePredictSystem\\engines\\generate_features.py',
      predictionScript: 'F:\\StrokePredictSystem\\engines\\predict_recovery.py',
      explainabilityScript: 'F:\\StrokePredictSystem\\engines\\explain_recovery.py',
      modelLibraryRoot: 'F:\\StrokePredictSystem\\models',
      ignored: 'value',
    });
    const taskId = addTask(local.db, {
      type: 'scan_eeg_files',
      patientId,
      status: 'running',
      priority: 'high',
    });
    addTaskLog(local.db, {
      taskId,
      patientId,
      level: 'info',
      source: 'app',
      message: 'scan started',
    });

    expect(settings.matlabExecutable).toBe('C:\\MATLAB\\bin\\matlab.exe');
    expect(settings.pythonExecutable).toBe('C:\\Python311\\python.exe');
    expect(settings.featureGeneratorScript).toBe('F:\\StrokePredictSystem\\engines\\generate_features.py');
    expect(settings.predictionScript).toBe('F:\\StrokePredictSystem\\engines\\predict_recovery.py');
    expect(settings.explainabilityScript).toBe('F:\\StrokePredictSystem\\engines\\explain_recovery.py');
    expect(settings.modelLibraryRoot).toBe('F:\\StrokePredictSystem\\models');
    expect(getSettings(local.db).matlabExecutable).toBe('C:\\MATLAB\\bin\\matlab.exe');
    expect(getSettings(local.db).pythonExecutable).toBe('C:\\Python311\\python.exe');
    expect(getSettings(local.db)).not.toHaveProperty('ignored');

    const workbench = getWorkbenchData(local.db, local.paths.dataRoot);
    expect(workbench.tasks.running).toEqual([
      expect.objectContaining({
        id: taskId,
        patient: 'sub02',
        name: 'scan_eeg_files',
      }),
    ]);
    expect(workbench.tasks.manual).toEqual([]);
    expect(workbench.tasks.failed).toEqual([]);
    expect(workbench.logs[0]).toEqual(
      expect.objectContaining({
        level: 'info',
        text: expect.stringMatching(/^\[INFO\] .+ - app: scan started$/),
      }),
    );
  });

  it('auto-detects local execution defaults for the real one-patient pipeline', async () => {
    const local = await openTempDatabase();
    const matlabPath = 'F:\\Matlab2020a\\bin\\matlab.exe';
    const eeglabPath = 'F:\\Matlab2020a\\toolbox\\eeglab2021.1';
    const pythonPath = 'D:\\anaconda\\python.exe';
    if (!fs.existsSync(matlabPath) || !fs.existsSync(eeglabPath) || !fs.existsSync(pythonPath)) {
      return;
    }

    const settings = getSettings(local.db);

    expect(settings.outputRoot).toBe('F:\\NeuroPredict\\outputs');
    expect(settings.matlabExecutable).toBe(matlabPath);
    expect(settings.eeglabPath).toBe(eeglabPath);
    expect(settings.defaultElectrodeLocationFile).toBe(
      'F:\\Matlab2020a\\toolbox\\eeglab2021.1\\plugins\\dipfit\\standard_BESA\\standard-10-5-cap385.elp',
    );
    expect(settings.pythonExecutable).toBe(pythonPath);
    expect(settings.featureGeneratorScript).toBe(path.resolve('engines', 'generate_features.py'));
    expect(settings.predictionScript).toBe(path.resolve('engines', 'predict_recovery.py'));
    expect(settings.explainabilityScript).toBe(path.resolve('engines', 'explain_recovery.py'));
    expect(fs.existsSync(settings.featureGeneratorScript)).toBe(true);
    expect(fs.existsSync(settings.predictionScript)).toBe(true);
    expect(fs.existsSync(settings.explainabilityScript)).toBe(true);
  });

  it('retries failed tasks and cancels queued tasks with task logs', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub03', affectedHand: '左手' });
    seedPreprocessedEegInput(local, patientId, 'sub03');
    const failedTaskId = addTask(local.db, {
      type: 'feature_generation',
      patientId,
      status: 'failed',
      errorMessage: 'feature engine crashed',
      finishedAt: '2026-06-15T01:00:00.000Z',
      inputJson: JSON.stringify({ displayName: 'PSD/FC 特征生成' }),
    });
    const queuedTaskId = addTask(local.db, {
      type: 'prediction',
      patientId,
      status: 'queued',
      inputJson: JSON.stringify({ displayName: '批量预测' }),
    });

    const retryResult = retryTask(local.db, failedTaskId);
    const cancelResult = cancelTask(local.db, queuedTaskId);
    const retriedTask = listTasks(local.db, { status: 'queued' }).find((task) => task.id === failedTaskId);
    const cancelledTask = listTasks(local.db, { status: 'cancelled' }).find((task) => task.id === queuedTaskId);
    const failedLogs = listTaskLogs(local.db, { taskId: failedTaskId });
    const cancelledLogs = listTaskLogs(local.db, { taskId: queuedTaskId });
    const workbench = getWorkbenchData(local.db, local.paths.dataRoot);

    expect(retryResult).toEqual({ ok: true, message: '任务已重新加入待执行队列。' });
    expect(cancelResult).toEqual({ ok: true, message: '任务已取消。' });
    expect(retriedTask).toEqual(
      expect.objectContaining({
        id: failedTaskId,
        status: 'queued',
        errorMessage: '',
        startedAt: null,
        finishedAt: null,
      }),
    );
    expect(cancelledTask).toEqual(expect.objectContaining({ id: queuedTaskId, status: 'cancelled' }));
    expect(failedLogs).toEqual([
      expect.objectContaining({ level: 'info', message: '任务已重新加入待执行队列。' }),
    ]);
    expect(cancelledLogs).toEqual([
      expect.objectContaining({ level: 'warning', message: '任务已取消。' }),
    ]);
    expect(workbench.tasks.queued).toEqual([
      expect.objectContaining({ id: failedTaskId, type: 'feature_generation', status: 'queued' }),
    ]);
    expect(workbench.tasks.failed).toEqual([]);
  });

  it('indexes generated feature files and updates patient feature readiness', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, {
      subjectCode: 'sub01',
      name: '穆祥贵',
      affectedHand: '左手',
    });
    const psdPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_psd_eo.npz');
    const fcPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_fc_ec.npz');
    fs.mkdirSync(path.dirname(psdPath), { recursive: true });
    fs.writeFileSync(psdPath, 'psd features');
    fs.writeFileSync(fcPath, 'fc features');

    const psdId = indexFeatureArtifact(local.db, {
      patientId,
      kind: 'PSD',
      state: 'EO',
      filePath: psdPath,
      featureCount: 5580,
      params: { method: 'welch', windowSeconds: 2 },
      preview: { topFeatures: ['C3 beta'] },
    });
    indexFeatureArtifact(local.db, {
      patientId,
      kind: 'FC',
      state: 'EC',
      filePath: fcPath,
      featureCount: 1891,
      params: { metric: 'wPLI' },
    });

    const artifacts = listFeatureArtifacts(local.db, { patientId });
    const overview = listFeatureOverview(local.db);
    const workbench = getWorkbenchData(local.db, local.paths.dataRoot);

    expect(psdId).toEqual(expect.any(String));
    expect(artifacts).toEqual([
      expect.objectContaining({
        kind: 'PSD',
        state: 'EO',
        filePath: psdPath,
        fileFormat: 'npz',
        fileSize: 12,
        featureCount: 5580,
        existsOnDisk: true,
        params: { method: 'welch', windowSeconds: 2 },
        preview: { topFeatures: ['C3 beta'] },
      }),
      expect.objectContaining({
        kind: 'FC',
        state: 'EC',
        filePath: fcPath,
        fileFormat: 'npz',
        fileSize: 11,
        featureCount: 1891,
        existsOnDisk: true,
      }),
    ]);
    expect(overview).toEqual([
      expect.objectContaining({
        patientId,
        subjectCode: 'sub01',
        patientName: '穆祥贵',
        featureStatus: '已完成',
        psdCount: 1,
        fcCount: 1,
        summaryCount: 0,
        previewCount: 0,
        hasEegFeatures: true,
      }),
    ]);
    expect(workbench.patients[0]).toEqual(expect.objectContaining({ id: 'sub01', featStatus: '已完成' }));
  });

  it('queues feature generation tasks for selected patients', async () => {
    const local = await openTempDatabase();
    const firstPatientId = createPatient(local.db, { subjectCode: 'sub01', affectedHand: '左手' });
    const secondPatientId = createPatient(local.db, { subjectCode: 'sub02', affectedHand: '右手' });
    seedPreprocessedEegInput(local, firstPatientId, 'sub01');
    seedPreprocessedEegInput(local, secondPatientId, 'sub02');

    const result = createFeatureGenerationBatch(local.db, local.paths, {
      patientIds: [firstPatientId, secondPatientId, 'missing-patient'],
      featureKinds: ['PSD', 'FC'],
      states: ['EO', 'EC'],
      overwrite: false,
      params: { bands: ['delta', 'theta', 'alpha', 'beta', 'gamma'] },
    });
    const tasks = listTasks(local.db, { type: 'feature_generation' });
    const workbench = getWorkbenchData(local.db, local.paths.dataRoot);

    expect(result).toEqual({
      ok: true,
      message: '已创建 2 个特征生成任务，跳过 1 位患者。',
      batchId: expect.any(String),
      queuedTasks: 2,
      skippedPatients: ['missing-patient'],
    });
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual(expect.objectContaining({ status: 'queued', type: 'feature_generation' }));
    expect(workbench.tasks.queued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patient: 'sub01',
          name: 'PSD/FC 特征生成',
          type: 'feature_generation',
          status: 'queued',
        }),
        expect.objectContaining({
          patient: 'sub02',
          name: 'PSD/FC 特征生成',
          type: 'feature_generation',
          status: 'queued',
        }),
      ]),
    );
    expect(JSON.parse(tasks[0].inputJson)).toEqual(
      expect.objectContaining({
        displayName: 'PSD/FC 特征生成',
        featureKinds: ['PSD', 'FC'],
        states: ['EO', 'EC'],
        overwrite: false,
      }),
    );
    expect(workbench.patients.map((patient) => patient.featStatus)).toEqual(['待处理', '待处理']);
  });

  it('queues prediction tasks for feature-ready patients and stores prediction results', async () => {
    const local = await openTempDatabase();
    const readyPatientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '右手' });
    const missingFeaturePatientId = createPatient(local.db, { subjectCode: 'sub02', name: '夏云玲' });
    indexModelReadyFeatures(local, readyPatientId);

    const models = listPredictionModels(local.db);
    const result = createPredictionBatch(local.db, {
      taskId: 'pr',
      modelId: 'm2',
      patientIds: [readyPatientId, missingFeaturePatientId, 'missing-patient'],
    });
    const tasks = listTasks(local.db, { type: 'prediction' });
    const queuedRows = listPredictionQueue(local.db, { taskId: 'pr' });
    const predictionId = savePredictionResult(local.db, {
      patientId: readyPatientId,
      taskId: 'pr',
      modelId: 'm2',
      predictedClass: '比例恢复',
      probability: 0.87,
      threshold: 0.5,
      labelDefinition: '比例恢复 (PR) vs 恢复不良',
    });
    const completedRows = listPredictionQueue(local.db, { taskId: 'pr' });
    const workbench = getWorkbenchData(local.db, local.paths.dataRoot);

    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'm1', taskId: 'pr', name: 'Logistic_L1_PSD_WPLI', inputType: 'EEG-only' }),
        expect.objectContaining({ id: 'm2', taskId: 'pr', name: 'ResidualAware_SSL_CNN', inputType: 'EEG-only' }),
      ]),
    );
    expect(result).toEqual({
      ok: true,
      message: '已创建 1 个预测任务，跳过 2 位患者。',
      batchId: expect.any(String),
      queuedTasks: 1,
      skippedPatients: expect.arrayContaining([
        expect.objectContaining({ patientId: missingFeaturePatientId, reason: '缺 PSD/FC(wPLI) EO/EC 特征或患侧信息' }),
        expect.objectContaining({ patientId: 'missing-patient', reason: '患者不存在' }),
      ]),
    });
    expect(tasks).toEqual([expect.objectContaining({ patientId: readyPatientId, type: 'prediction', status: 'queued' })]);
    expect(JSON.parse(tasks[0].inputJson)).toEqual(
      expect.objectContaining({
        displayName: '批量预测',
        taskId: 'pr',
        modelId: 'm2',
      }),
    );
    expect(queuedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patientId: readyPatientId,
          subjectCode: 'sub01',
          hasEegFeatures: true,
          hasClinical: false,
          status: '待处理',
          prediction: null,
        }),
        expect.objectContaining({
          patientId: missingFeaturePatientId,
          subjectCode: 'sub02',
          hasEegFeatures: false,
          status: '未开始',
        }),
      ]),
    );
    expect(predictionId).toEqual(expect.any(String));
    expect(completedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patientId: readyPatientId,
          subjectCode: 'sub01',
          prediction: '比例恢复',
          probability: 0.87,
          modelUsed: 'ResidualAware_SSL_CNN locked_10seed_final',
          status: '已完成',
        }),
      ]),
    );
    expect(workbench.patients[0]).toEqual(
      expect.objectContaining({
        id: 'sub01',
        predict: '比例恢复',
        prob: 0.87,
      }),
    );
  });

  it('skips prediction batches when final-model affected side or PSD/FC EO/EC inputs are incomplete', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });
    const featurePath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_psd_eo.npz');
    fs.mkdirSync(path.dirname(featurePath), { recursive: true });
    fs.writeFileSync(featurePath, 'psd features');
    indexFeatureArtifact(local.db, {
      patientId,
      kind: 'PSD',
      state: 'EO',
      filePath: featurePath,
      featureCount: 5580,
      params: { shape: [62, 90], alignment: 'right_affected_c3' },
    });
    const model = registerResidualAwareModel(local);

    const result = createPredictionBatch(local.db, {
      taskId: 'pr',
      modelId: model.id,
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

  it('selects a valid strict feature artifact when an invalid duplicate sorts first', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '右手' });
    const validFeatureArtifactIds = indexModelReadyFeatures(local, patientId);
    const invalidPsdEoPath = path.join(local.paths.outputsRoot, 'features', patientId, '000_invalid_psd_eo.npz');
    fs.writeFileSync(invalidPsdEoPath, 'invalid psd eo features');
    const invalidPsdEoId = indexFeatureArtifact(local.db, {
      patientId,
      kind: 'PSD',
      state: 'EO',
      filePath: invalidPsdEoPath,
      featureCount: 5580,
      params: { shape: [1, 1], alignment: 'right_affected_c3' },
    });
    const model = registerResidualAwareModel(local);

    const batch = createPredictionBatch(local.db, {
      taskId: 'pr',
      modelId: model.id,
      patientIds: [patientId],
    });
    const queuedTask = listTasks(local.db, { type: 'prediction' })[0];
    const prepared = preparePredictionExecution(local.db, local.paths, queuedTask?.id ?? '');

    expect(batch).toEqual(
      expect.objectContaining({
        ok: true,
        queuedTasks: 1,
        skippedPatients: [],
      }),
    );
    expect(prepared).toEqual(expect.objectContaining({ ok: true }));
    const taskPackage = JSON.parse(fs.readFileSync(prepared.packagePath ?? '', 'utf8'));
    expect(taskPackage.inputs.featureArtifactIds.sort()).toEqual([...validFeatureArtifactIds].sort());
    expect(taskPackage.inputs.featureArtifactIds).not.toContain(invalidPsdEoId);
  });

  it('infers residual-aware metadata for legacy backfilled prediction model rows', async () => {
    const local = await openTempDatabase();
    const timestamp = '2026-06-15T00:00:00.000Z';

    local.db.run(
      `INSERT INTO prediction_models (
        id, task_id, name, version, model_family, checkpoint_mode, input_type, inputs_json, validation,
        accuracy, balanced_accuracy, roc_auc, pr_auc, status, artifact_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'legacy-residual-aware',
        'pr',
        'ResidualAware_SWA',
        'legacy',
        'traditional_ml',
        'external_script',
        'EEG-only',
        JSON.stringify(['PSD', 'FC(wPLI)']),
        '',
        null,
        null,
        null,
        null,
        '当前版本',
        '',
        timestamp,
        timestamp,
      ],
    );

    expect(listPredictionModels(local.db, 'pr')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'legacy-residual-aware',
          modelFamily: 'residual_aware_ssl_cnn',
          checkpointMode: 'fold_checkpoint_ensemble',
        }),
      ]),
    );
  });

  it('returns concrete strict feature contract errors when preparing prediction execution', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '右手' });
    const specs = [
      {
        kind: 'PSD',
        state: 'EO',
        suffix: 'psd_eo_invalid',
        featureCount: 5580,
        params: { shape: [1, 1], alignment: 'right_affected_c3' },
      },
      {
        kind: 'PSD',
        state: 'EC',
        suffix: 'psd_ec',
        featureCount: 5580,
        params: { shape: [62, 90], alignment: 'right_affected_c3' },
      },
      {
        kind: 'FC',
        state: 'EO',
        suffix: 'fc_eo',
        featureCount: 11346,
        params: { shape: [1891, 6], metric: 'wpli', alignment: 'right_affected_c3' },
      },
      {
        kind: 'FC',
        state: 'EC',
        suffix: 'fc_ec',
        featureCount: 11346,
        params: { shape: [1891, 6], metric: 'wpli', alignment: 'right_affected_c3' },
      },
    ] as const;

    for (const spec of specs) {
      const filePath = path.join(local.paths.outputsRoot, 'features', patientId, `${spec.suffix}.npz`);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${spec.kind} ${spec.state} features`);
      indexFeatureArtifact(local.db, {
        patientId,
        kind: spec.kind,
        state: spec.state,
        filePath,
        featureCount: spec.featureCount,
        params: spec.params,
      });
    }

    const taskId = addTask(local.db, {
      type: 'prediction',
      patientId,
      status: 'queued',
      inputJson: JSON.stringify({
        displayName: '批量预测',
        taskId: 'pr',
        modelId: 'm2',
        labelDefinition: '比例恢复 (PR) vs 恢复不良',
      }),
    });

    const prepared = preparePredictionExecution(local.db, local.paths, taskId);

    expect(prepared).toEqual({
      ok: false,
      message: 'PSD 特征形状必须是 [62,90]。',
    });
  });

  it('registers a real prediction model artifact and exports it in prediction packages', async () => {
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
      modelFamily: 'residual_aware_ssl_cnn',
      checkpointMode: 'fold_checkpoint_ensemble',
      inputType: 'EEG-only',
      inputs: ['PSD', 'FC(wPLI)'],
      validation: 'Locked LOSO Acc: 0.91',
      accuracy: 0.91,
      balancedAccuracy: 0.89,
      rocAuc: 0.94,
      prAuc: 0.92,
      status: '当前版本',
      artifactPath: modelPath,
    });
    createPredictionBatch(local.db, {
      taskId: 'pr',
      modelId: model.id,
      patientIds: [patientId],
      executor: { executablePath, scriptPath },
    });
    const queuedTask = listTasks(local.db, { type: 'prediction' })[0];

    const prepared = preparePredictionExecution(local.db, local.paths, queuedTask.id);

    expect(listPredictionModels(local.db, 'pr')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: model.id,
          name: 'ResidualAware_SWA',
          version: 'v2026.06',
          modelFamily: 'residual_aware_ssl_cnn',
          checkpointMode: 'fold_checkpoint_ensemble',
          artifactPath: modelPath,
        }),
      ]),
    );
    expect(prepared).toEqual(expect.objectContaining({ ok: true }));
    const taskPackage = JSON.parse(fs.readFileSync(prepared.packagePath ?? '', 'utf8'));
    expect(taskPackage.model).toEqual(
      expect.objectContaining({
        id: model.id,
        name: 'ResidualAware_SWA',
        version: 'v2026.06',
        modelFamily: 'residual_aware_ssl_cnn',
        checkpointMode: 'fold_checkpoint_ensemble',
        artifactPath: modelPath,
      }),
    );
    expect(taskPackage.contract).toEqual({
      requiredStates: ['EO', 'EC'],
      requiredFeatureKinds: ['PSD', 'FC'],
      fcMetric: 'wpli',
      alignment: 'right_affected_c3',
      affectedSide: 'right',
    });
    expect(taskPackage.inputs.featureArtifactIds.sort()).toEqual([...featureArtifactIds].sort());
  });

  it('does not prepare prediction execution when the registered model artifact is missing', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '右手' });
    const modelPath = path.join(local.paths.dataRoot, 'models', 'missing_later_model.json');
    fs.mkdirSync(path.dirname(modelPath), { recursive: true });
    fs.writeFileSync(modelPath, '{"model":"temporary"}');
    indexModelReadyFeatures(local, patientId);
    const model = registerPredictionModel(local.db, {
      taskId: 'pr',
      name: 'MissingLaterModel',
      version: 'v1',
      inputType: 'EEG-only',
      inputs: ['PSD'],
      artifactPath: modelPath,
    });
    fs.rmSync(modelPath);
    createPredictionBatch(local.db, {
      taskId: 'pr',
      modelId: model.id,
      patientIds: [patientId],
    });
    const queuedTask = listTasks(local.db, { type: 'prediction' })[0];

    const prepared = preparePredictionExecution(local.db, local.paths, queuedTask.id);

    expect(prepared).toEqual({
      ok: false,
      message: `预测模型文件不存在：${modelPath}`,
    });
  });

  it('imports a generated prediction result file and completes the queued prediction task', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '右手' });
    const resultPath = path.join(local.paths.outputsRoot, 'predictions', 'sub01_prediction.json');
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        predictedClass: '比例恢复',
        probability: 0.91,
        threshold: 0.5,
        labelDefinition: '比例恢复 (PR) vs 恢复不良',
      }),
    );
    indexModelReadyFeatures(local, patientId);
    createPredictionBatch(local.db, {
      taskId: 'pr',
      modelId: 'm2',
      patientIds: [patientId],
    });
    const queuedTask = listTasks(local.db, { type: 'prediction' })[0];

    const result = completePredictionTask(local.db, queuedTask.id, resultPath);
    const completedTask = listTasks(local.db, { status: 'completed' })[0];
    const queueRows = listPredictionQueue(local.db, { taskId: 'pr' });

    expect(result).toEqual({
      ok: true,
      message: '预测任务已完成：比例恢复 0.91。',
      predictionId: expect.any(String),
    });
    expect(completedTask).toEqual(
      expect.objectContaining({
        id: queuedTask.id,
        type: 'prediction',
      }),
    );
    expect(JSON.parse(completedTask.outputJson)).toEqual(
      expect.objectContaining({
        resultPath,
        predictionId: result.predictionId,
        predictedClass: '比例恢复',
        probability: 0.91,
      }),
    );
    expect(queueRows).toEqual([
      expect.objectContaining({
        patientId,
        prediction: '比例恢复',
        probability: 0.91,
        status: '已完成',
      }),
    ]);
  });

  it('fails the prediction task when the generated label definition does not match the queued task', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '右手' });
    const resultPath = path.join(local.paths.outputsRoot, 'predictions', 'sub01_prediction_wrong_label.json');
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        predictedClass: '比例恢复',
        probability: 0.91,
        threshold: 0.5,
        labelDefinition: 'FMA 绝对改善二分类',
      }),
    );
    indexModelReadyFeatures(local, patientId);
    createPredictionBatch(local.db, {
      taskId: 'pr',
      modelId: 'm2',
      patientIds: [patientId],
    });
    const queuedTask = listTasks(local.db, { type: 'prediction' })[0];

    const result = completePredictionTask(local.db, queuedTask.id, resultPath);

    expect(result).toEqual({
      ok: false,
      message: '预测结果标签定义不匹配：期望“比例恢复 (PR) vs 恢复不良”，实际“FMA 绝对改善二分类”。',
      predictionId: null,
    });
    expect(listTasks(local.db, { status: 'failed' })[0]).toEqual(
      expect.objectContaining({ id: queuedTask.id, errorMessage: expect.stringContaining('预测结果标签定义不匹配') }),
    );
    expect(listPredictionQueue(local.db, { taskId: 'pr' })[0]).toEqual(
      expect.objectContaining({ patientId, prediction: null, status: '失败' }),
    );
  });

  it('prepares and runs an external prediction executor, then imports its result file', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '右手' });
    const executablePath = path.join(local.paths.dataRoot, 'tools', 'python.exe');
    const scriptPath = path.join(local.paths.dataRoot, 'scripts', 'predict_recovery.py');
    fs.mkdirSync(path.dirname(executablePath), { recursive: true });
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(executablePath, 'python stub');
    fs.writeFileSync(scriptPath, 'prediction script stub');
    indexModelReadyFeatures(local, patientId);
    createPredictionBatch(local.db, {
      taskId: 'pr',
      modelId: 'm2',
      patientIds: [patientId],
      executor: {
        executablePath,
        scriptPath,
        extraArgs: ['--fold', 'loso'],
      },
    });
    const queuedTask = listTasks(local.db, { type: 'prediction' })[0];

    const prepared = preparePredictionExecution(local.db, local.paths, queuedTask.id);

    expect(prepared).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.stringContaining('预测任务包已准备'),
        executablePath,
        packagePath: expect.stringContaining(`${queuedTask.id}-prediction.json`),
        resultPath: expect.stringContaining(`${queuedTask.id}-prediction-result.json`),
      }),
    );
    expect(prepared.command).toContain(`"${executablePath}"`);
    expect(prepared.command).toContain(`"${scriptPath}"`);
    expect(prepared.command).toContain('--fold loso');

    const executePrediction = vi.fn().mockImplementation(async (_executable: string, args: string[]) => {
      const packagePath = args[args.length - 1];
      const taskPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      fs.writeFileSync(
        taskPackage.outputs.resultPath,
        JSON.stringify({
          predictedClass: '恢复不良',
          probability: 0.82,
          threshold: 0.5,
          labelDefinition: taskPackage.request.labelDefinition,
        }),
      );
      return { exitCode: 0, stdout: 'prediction generated', stderr: '' };
    });

    const result = await runPredictionExecution(local.db, local.paths, queuedTask.id, executePrediction);

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: '预测任务已完成：恢复不良 0.82。',
        exitCode: 0,
        stdout: 'prediction generated',
        predictionId: expect.any(String),
      }),
    );
    expect(executePrediction).toHaveBeenCalledWith(
      executablePath,
      expect.arrayContaining([scriptPath, '--fold', 'loso', expect.stringContaining(`${queuedTask.id}-prediction.json`)]),
    );
    expect(listTasks(local.db, { status: 'completed' })[0]).toEqual(
      expect.objectContaining({ id: queuedTask.id, type: 'prediction' }),
    );
    expect(listPredictionQueue(local.db, { taskId: 'pr' })).toEqual([
      expect.objectContaining({
        patientId,
        prediction: '恢复不良',
        probability: 0.82,
        status: '已完成',
      }),
    ]);
  });

  it('records external prediction executor failures without saving a prediction result', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '右手' });
    const executablePath = path.join(local.paths.dataRoot, 'tools', 'python.exe');
    const scriptPath = path.join(local.paths.dataRoot, 'scripts', 'predict_recovery.py');
    fs.mkdirSync(path.dirname(executablePath), { recursive: true });
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(executablePath, 'python stub');
    fs.writeFileSync(scriptPath, 'prediction script stub');
    indexModelReadyFeatures(local, patientId);
    createPredictionBatch(local.db, {
      taskId: 'pr',
      modelId: 'm2',
      patientIds: [patientId],
      executor: { executablePath, scriptPath },
    });
    const queuedTask = listTasks(local.db, { type: 'prediction' })[0];
    const executePrediction = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'missing model pickle',
    });

    const result = await runPredictionExecution(local.db, local.paths, queuedTask.id, executePrediction);

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining('预测执行失败'),
        exitCode: 1,
        stderr: 'missing model pickle',
        predictionId: null,
      }),
    );
    expect(listTasks(local.db, { status: 'failed' })[0]).toEqual(
      expect.objectContaining({ id: queuedTask.id, errorMessage: expect.stringContaining('missing model pickle') }),
    );
    expect(listPredictionQueue(local.db, { taskId: 'pr' })[0]).toEqual(
      expect.objectContaining({ patientId, prediction: null, status: '失败' }),
    );
  });

  it('fails the prediction task when the generated prediction result file is missing', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', affectedHand: '右手' });
    const missingResultPath = path.join(local.paths.outputsRoot, 'predictions', 'missing_prediction.json');
    indexModelReadyFeatures(local, patientId);
    createPredictionBatch(local.db, {
      taskId: 'pr',
      modelId: 'm2',
      patientIds: [patientId],
    });
    const queuedTask = listTasks(local.db, { type: 'prediction' })[0];

    const result = completePredictionTask(local.db, queuedTask.id, missingResultPath);
    const failedTask = listTasks(local.db, { status: 'failed' })[0];
    const logs = listTaskLogs(local.db, { taskId: queuedTask.id });

    expect(result).toEqual({
      ok: false,
      message: `预测结果文件不存在：${missingResultPath}`,
      predictionId: null,
    });
    expect(failedTask).toEqual(
      expect.objectContaining({
        id: queuedTask.id,
        errorMessage: `预测结果文件不存在：${missingResultPath}`,
      }),
    );
    expect(logs).toEqual([
      expect.objectContaining({
        level: 'error',
        source: 'prediction',
        message: `预测结果文件不存在：${missingResultPath}`,
      }),
    ]);
  });

  it('prepares explainability against the prediction result captured when the task was queued', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });
    const featurePath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_psd_eo.npz');
    fs.mkdirSync(path.dirname(featurePath), { recursive: true });
    fs.writeFileSync(featurePath, 'psd features');
    indexFeatureArtifact(local.db, {
      patientId,
      kind: 'PSD',
      state: 'EO',
      filePath: featurePath,
      featureCount: 5580,
    });
    const firstPredictionId = savePredictionResult(local.db, {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      predictedClass: '比例恢复',
      probability: 0.61,
      threshold: 0.5,
      labelDefinition: '比例恢复 (PR) vs 恢复不良',
    });
    createExplainabilityBatch(local.db, {
      taskId: 'pr',
      modelId: 'm2',
      patientIds: [patientId],
      artifactTypes: ['patient_shap'],
    });
    const queuedTask = listTasks(local.db, { type: 'explainability' })[0];
    savePredictionResult(local.db, {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      predictedClass: '恢复不良',
      probability: 0.93,
      threshold: 0.5,
      labelDefinition: '比例恢复 (PR) vs 恢复不良',
    });

    const prepared = prepareExplainabilityExecution(local.db, local.paths, queuedTask.id);

    expect(prepared).toEqual(expect.objectContaining({ ok: true }));
    const taskPackage = JSON.parse(fs.readFileSync(prepared.packagePath ?? '', 'utf8'));
    expect(taskPackage.prediction).toEqual(
      expect.objectContaining({
        id: firstPredictionId,
        predictedClass: '比例恢复',
        probability: 0.61,
      }),
    );
  });
});
