import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLocalDatabase, type LocalDatabase } from '../../../src/electron/backend/database.js';
import {
  completeExplainabilityTask,
  createExplainabilityBatch,
  deleteExplanationArtifact,
  indexExplanationArtifact,
  listExplanationArtifacts,
  listExplanationOverview,
  prepareExplainabilityExecution,
  runExplainabilityExecution,
} from '../../../src/electron/backend/explainability.js';
import { savePredictionResult } from '../../../src/electron/backend/predictions.js';
import { createPatient, getWorkbenchData, listTaskLogs, listTasks } from '../../../src/electron/backend/repositories.js';
import { listPredictionQueue } from '../../../src/electron/backend/predictions.js';

const roots: string[] = [];
const locals: LocalDatabase[] = [];

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-explainability-'));
  roots.push(root);
  return root;
}

async function openTempDatabase(): Promise<LocalDatabase> {
  const local = await openLocalDatabase(createTempRoot());
  locals.push(local);
  return local;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

afterEach(() => {
  for (const local of locals.splice(0)) {
    local.close();
  }

  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('model explainability backend', () => {
  it('deletes an indexed explanation artifact and resets the patient explanation status when none remain', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });
    const artifactPath = path.join(local.paths.outputsRoot, 'explainability', 'sub01', 'sub01_shap.svg');
    writeFile(artifactPath, '<svg>shap</svg>');
    savePredictionResult(local.db, {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      predictedClass: '比例恢复',
      probability: 0.87,
      threshold: 0.5,
      labelDefinition: '比例恢复 (PR) vs 恢复不良',
    });
    const artifactId = indexExplanationArtifact(local.db, {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      artifactType: 'patient_shap',
      title: 'sub01 SHAP force plot',
      method: 'SHAP',
      filePath: artifactPath,
    });

    const result = deleteExplanationArtifact(local.db, artifactId);

    expect(result).toEqual({ ok: true, message: '已删除解释性产物 sub01 SHAP force plot。' });
    expect(listExplanationArtifacts(local.db, { patientId })).toEqual([]);
    expect(listExplanationOverview(local.db, { taskId: 'pr' })).toEqual([
      expect.objectContaining({
        patientId,
        artifactCount: 0,
        explanationStatus: '未生成',
        topFeatureName: '',
      }),
    ]);
    expect(listPredictionQueue(local.db, { taskId: 'pr' })).toEqual([
      expect.objectContaining({ patientId, explanationStatus: '未生成' }),
    ]);
    expect(getWorkbenchData(local.db, local.paths.dataRoot).patients[0]).toEqual(
      expect.objectContaining({ id: 'sub01' }),
    );
  });

  it('indexes explanation artifacts and exposes patient-level overview rows', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });
    const artifactPath = path.join(local.paths.outputsRoot, 'explainability', 'sub01', 'sub01_shap.svg');
    writeFile(artifactPath, '<svg>shap</svg>');
    savePredictionResult(local.db, {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      predictedClass: '比例恢复',
      probability: 0.87,
      threshold: 0.5,
      labelDefinition: '比例恢复 (PR) vs 恢复不良',
    });

    const artifactId = indexExplanationArtifact(local.db, {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      artifactType: 'patient_shap',
      title: 'sub01 SHAP force plot',
      method: 'SHAP',
      filePath: artifactPath,
      topFeatures: [
        { name: 'Oz Alpha PSD', score: 0.22, modality: 'PSD', direction: 'positive' },
        { name: 'Cz-Pz wPLI', score: 0.17, modality: 'FC', direction: 'positive' },
      ],
      preview: { baseValue: 0.52, outputValue: 0.87 },
    });
    const artifacts = listExplanationArtifacts(local.db, { patientId });
    const overview = listExplanationOverview(local.db, { taskId: 'pr' });
    const queue = listPredictionQueue(local.db, { taskId: 'pr' });
    const logs = listTaskLogs(local.db, { level: 'info' });
    const workbench = getWorkbenchData(local.db, local.paths.dataRoot);

    expect(artifactId).toEqual(expect.any(String));
    expect(artifacts).toEqual([
      expect.objectContaining({
        id: artifactId,
        patientId,
        subjectCode: 'sub01',
        patientName: '穆祥贵',
        taskId: 'pr',
        modelId: 'm2',
        modelName: 'ResidualAware_SSL_CNN',
        artifactType: 'patient_shap',
        title: 'sub01 SHAP force plot',
        filePath: artifactPath,
        fileFormat: 'svg',
        existsOnDisk: true,
        topFeatures: [
          { name: 'Oz Alpha PSD', score: 0.22, modality: 'PSD', direction: 'positive' },
          { name: 'Cz-Pz wPLI', score: 0.17, modality: 'FC', direction: 'positive' },
        ],
        preview: { baseValue: 0.52, outputValue: 0.87 },
      }),
    ]);
    expect(overview).toEqual([
      expect.objectContaining({
        patientId,
        subjectCode: 'sub01',
        patientName: '穆祥贵',
        prediction: '比例恢复',
        probability: 0.87,
        modelUsed: 'ResidualAware_SSL_CNN locked_10seed_final',
        explanationStatus: '已生成',
        artifactCount: 1,
        topFeatureName: 'Oz Alpha PSD',
      }),
    ]);
    expect(queue).toEqual([expect.objectContaining({ patientId, explanationStatus: '已生成' })]);
    expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'explainability' })]));
    expect(workbench.patients[0]).toEqual(expect.objectContaining({ id: 'sub01', predict: '比例恢复' }));
  });

  it('queues explainability tasks for patients with prediction results', async () => {
    const local = await openTempDatabase();
    const readyPatientId = createPatient(local.db, { subjectCode: 'sub01' });
    const noPredictionPatientId = createPatient(local.db, { subjectCode: 'sub02' });
    savePredictionResult(local.db, {
      patientId: readyPatientId,
      taskId: 'pr',
      modelId: 'm2',
      predictedClass: '比例恢复',
      probability: 0.87,
      threshold: 0.5,
      labelDefinition: '比例恢复 (PR) vs 恢复不良',
    });

    const result = createExplainabilityBatch(local.db, {
      taskId: 'pr',
      modelId: 'm2',
      patientIds: [readyPatientId, noPredictionPatientId, 'missing-patient'],
      artifactTypes: ['global_importance', 'patient_shap', 'psd_heatmap', 'fc_network'],
    });
    const tasks = listTasks(local.db, { type: 'explainability' });
    const queue = listPredictionQueue(local.db, { taskId: 'pr' });

    expect(result).toEqual({
      ok: true,
      message: '已创建 1 个解释性任务，跳过 2 位患者。',
      batchId: expect.any(String),
      queuedTasks: 1,
      skippedPatients: expect.arrayContaining([
        expect.objectContaining({ patientId: noPredictionPatientId, reason: '没有预测结果' }),
        expect.objectContaining({ patientId: 'missing-patient', reason: '患者不存在' }),
      ]),
    });
    expect(tasks).toEqual([expect.objectContaining({ patientId: readyPatientId, type: 'explainability', status: 'queued' })]);
    expect(JSON.parse(tasks[0].inputJson)).toEqual(
      expect.objectContaining({
        displayName: '模型解释性分析',
        taskId: 'pr',
        modelId: 'm2',
        artifactTypes: ['global_importance', 'patient_shap', 'psd_heatmap', 'fc_network'],
      }),
    );
    expect(queue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ patientId: readyPatientId, explanationStatus: '生成中' }),
        expect.objectContaining({ patientId: noPredictionPatientId, explanationStatus: '未生成' }),
      ]),
    );
  });

  it('imports an explainability manifest, indexes artifacts, and completes the queued task', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });
    const shapPath = path.join(local.paths.outputsRoot, 'explainability', 'sub01', 'sub01_shap.svg');
    const heatmapPath = path.join(local.paths.outputsRoot, 'explainability', 'sub01', 'sub01_psd_heatmap.png');
    const manifestPath = path.join(local.paths.outputsRoot, 'explainability', 'sub01', 'explainability_manifest.json');
    writeFile(shapPath, '<svg>shap</svg>');
    writeFile(heatmapPath, 'png heatmap');
    writeFile(
      manifestPath,
      JSON.stringify({
        artifacts: [
          {
            artifactType: 'patient_shap',
            title: 'sub01 SHAP force plot',
            method: 'SHAP',
            filePath: shapPath,
            topFeatures: [{ name: 'Oz Alpha PSD', score: 0.22, modality: 'PSD', direction: 'positive' }],
            preview: { baseValue: 0.52, outputValue: 0.87 },
          },
          {
            artifactType: 'psd_heatmap',
            title: 'sub01 PSD topography',
            method: 'Integrated Gradients',
            filePath: heatmapPath,
            topFeatures: [{ name: 'C3 Beta PSD', score: 0.18, modality: 'PSD', direction: 'positive' }],
            preview: { band: 'Beta' },
          },
        ],
      }),
    );
    savePredictionResult(local.db, {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      predictedClass: '比例恢复',
      probability: 0.87,
      threshold: 0.5,
      labelDefinition: '比例恢复 (PR) vs 恢复不良',
    });
    createExplainabilityBatch(local.db, {
      taskId: 'pr',
      modelId: 'm2',
      patientIds: [patientId],
      artifactTypes: ['patient_shap', 'psd_heatmap'],
    });
    const task = listTasks(local.db, { type: 'explainability' })[0];

    const result = completeExplainabilityTask(local.db, task.id, manifestPath);
    const completedTask = listTasks(local.db, { status: 'completed' })[0];
    const artifacts = listExplanationArtifacts(local.db, { patientId });
    const overview = listExplanationOverview(local.db, { taskId: 'pr' });

    expect(result).toEqual({
      ok: true,
      message: '解释性任务已完成，已索引 2 个解释性文件。',
      indexedArtifacts: 2,
      artifactIds: [expect.any(String), expect.any(String)],
    });
    expect(JSON.parse(completedTask.outputJson)).toEqual(
      expect.objectContaining({
        manifestPath,
        artifactIds: result.artifactIds,
        indexedArtifacts: 2,
      }),
    );
    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactType: 'patient_shap',
          title: 'sub01 SHAP force plot',
          filePath: shapPath,
          existsOnDisk: true,
          topFeatures: [{ name: 'Oz Alpha PSD', score: 0.22, modality: 'PSD', direction: 'positive' }],
        }),
        expect.objectContaining({
          artifactType: 'psd_heatmap',
          title: 'sub01 PSD topography',
          filePath: heatmapPath,
          existsOnDisk: true,
          topFeatures: [{ name: 'C3 Beta PSD', score: 0.18, modality: 'PSD', direction: 'positive' }],
        }),
      ]),
    );
    expect(overview).toEqual([
      expect.objectContaining({
        patientId,
        explanationStatus: '已生成',
        artifactCount: 2,
      }),
    ]);
  });

  it('fails the queued explainability task when the manifest is missing', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    const missingManifestPath = path.join(local.paths.outputsRoot, 'explainability', 'missing_manifest.json');
    savePredictionResult(local.db, {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      predictedClass: '恢复不良',
      probability: 0.33,
      threshold: 0.5,
      labelDefinition: '比例恢复 (PR) vs 恢复不良',
    });
    createExplainabilityBatch(local.db, {
      taskId: 'pr',
      modelId: 'm2',
      patientIds: [patientId],
      artifactTypes: ['patient_shap'],
    });
    const task = listTasks(local.db, { type: 'explainability' })[0];

    const result = completeExplainabilityTask(local.db, task.id, missingManifestPath);
    const failedTask = listTasks(local.db, { status: 'failed' })[0];
    const queue = listPredictionQueue(local.db, { taskId: 'pr' });
    const logs = listTaskLogs(local.db, { taskId: task.id });

    expect(result).toEqual({
      ok: false,
      message: `解释性结果清单不存在：${missingManifestPath}`,
      indexedArtifacts: 0,
      artifactIds: [],
    });
    expect(failedTask).toEqual(
      expect.objectContaining({
        id: task.id,
        errorMessage: `解释性结果清单不存在：${missingManifestPath}`,
      }),
    );
    expect(queue).toEqual([expect.objectContaining({ patientId, explanationStatus: '需复核' })]);
    expect(logs).toEqual([
      expect.objectContaining({
        level: 'error',
        source: 'explainability',
        message: `解释性结果清单不存在：${missingManifestPath}`,
      }),
    ]);
  });

  it('prepares and runs an external explainability executor, then imports its manifest', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });
    const featurePath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_psd_eo.npz');
    const executablePath = path.join(local.paths.dataRoot, 'tools', 'python.exe');
    const scriptPath = path.join(local.paths.dataRoot, 'scripts', 'explain_recovery.py');
    writeFile(featurePath, 'psd features');
    writeFile(executablePath, 'python stub');
    writeFile(scriptPath, 'explainability script stub');
    savePredictionResult(local.db, {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      predictedClass: '比例恢复',
      probability: 0.87,
      threshold: 0.5,
      labelDefinition: '比例恢复 (PR) vs 恢复不良',
    });
    createExplainabilityBatch(local.db, {
      taskId: 'pr',
      modelId: 'm2',
      patientIds: [patientId],
      artifactTypes: ['patient_shap', 'psd_heatmap'],
      executor: {
        executablePath,
        scriptPath,
        extraArgs: ['--target', 'classification_logit'],
      },
    });
    const task = listTasks(local.db, { type: 'explainability' })[0];

    const prepared = prepareExplainabilityExecution(local.db, local.paths, task.id);

    expect(prepared).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.stringContaining('解释性任务包已准备'),
        executablePath,
        packagePath: expect.stringContaining(`${task.id}-explainability.json`),
        manifestPath: expect.stringContaining('explainability_manifest.json'),
      }),
    );
    expect(prepared.command).toContain(`"${executablePath}"`);
    expect(prepared.command).toContain(`"${scriptPath}"`);
    expect(prepared.command).toContain('--target classification_logit');

    const executeExplainability = vi.fn().mockImplementation(async (_executable: string, args: string[]) => {
      const packagePath = args[args.length - 1];
      const taskPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      const shapPath = path.join(taskPackage.outputs.outputDirectory, 'sub01_shap.svg');
      const heatmapPath = path.join(taskPackage.outputs.outputDirectory, 'sub01_psd_heatmap.png');
      writeFile(shapPath, '<svg>shap</svg>');
      writeFile(heatmapPath, 'heatmap');
      writeFile(
        taskPackage.outputs.manifestPath,
        JSON.stringify({
          artifacts: [
            {
              artifactType: 'patient_shap',
              title: 'sub01 SHAP force plot',
              method: 'SHAP',
              filePath: shapPath,
              topFeatures: [{ name: 'Oz Alpha PSD', score: 0.22, modality: 'PSD', direction: 'positive' }],
            },
            {
              artifactType: 'psd_heatmap',
              title: 'sub01 PSD heatmap',
              method: 'Integrated Gradients',
              filePath: heatmapPath,
              topFeatures: [{ name: 'C3 Beta PSD', score: 0.18, modality: 'PSD', direction: 'positive' }],
            },
          ],
        }),
      );
      return { exitCode: 0, stdout: 'explainability generated', stderr: '' };
    });

    const result = await runExplainabilityExecution(local.db, local.paths, task.id, executeExplainability);
    const artifacts = listExplanationArtifacts(local.db, { patientId });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: '解释性任务已完成，已索引 2 个解释性文件。',
        exitCode: 0,
        stdout: 'explainability generated',
        indexedArtifacts: 2,
        artifactIds: [expect.any(String), expect.any(String)],
      }),
    );
    expect(executeExplainability).toHaveBeenCalledWith(
      executablePath,
      expect.arrayContaining([
        scriptPath,
        '--target',
        'classification_logit',
        expect.stringContaining(`${task.id}-explainability.json`),
      ]),
    );
    expect(listTasks(local.db, { status: 'completed' })[0]).toEqual(
      expect.objectContaining({ id: task.id, type: 'explainability' }),
    );
    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifactType: 'patient_shap', existsOnDisk: true }),
        expect.objectContaining({ artifactType: 'psd_heatmap', existsOnDisk: true }),
      ]),
    );
    expect(listPredictionQueue(local.db, { taskId: 'pr' })[0]).toEqual(
      expect.objectContaining({ patientId, explanationStatus: '已生成' }),
    );
  });

  it('records external explainability executor failures without indexing artifacts', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });
    const executablePath = path.join(local.paths.dataRoot, 'tools', 'python.exe');
    const scriptPath = path.join(local.paths.dataRoot, 'scripts', 'explain_recovery.py');
    writeFile(executablePath, 'python stub');
    writeFile(scriptPath, 'explainability script stub');
    savePredictionResult(local.db, {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      predictedClass: '恢复不良',
      probability: 0.33,
      threshold: 0.5,
      labelDefinition: '比例恢复 (PR) vs 恢复不良',
    });
    createExplainabilityBatch(local.db, {
      taskId: 'pr',
      modelId: 'm2',
      patientIds: [patientId],
      artifactTypes: ['patient_shap'],
      executor: { executablePath, scriptPath },
    });
    const task = listTasks(local.db, { type: 'explainability' })[0];
    const executeExplainability = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'missing attribution model',
    });

    const result = await runExplainabilityExecution(local.db, local.paths, task.id, executeExplainability);

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining('解释性执行失败'),
        exitCode: 1,
        stderr: 'missing attribution model',
        indexedArtifacts: 0,
        artifactIds: [],
      }),
    );
    expect(listTasks(local.db, { status: 'failed' })[0]).toEqual(
      expect.objectContaining({ id: task.id, errorMessage: expect.stringContaining('missing attribution model') }),
    );
    expect(listExplanationArtifacts(local.db, { patientId })).toEqual([]);
    expect(listPredictionQueue(local.db, { taskId: 'pr' })[0]).toEqual(
      expect.objectContaining({ patientId, explanationStatus: '需复核' }),
    );
  });
});
