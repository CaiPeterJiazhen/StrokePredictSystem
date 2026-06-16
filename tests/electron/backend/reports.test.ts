import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase, type LocalDatabase } from '../../../src/electron/backend/database.js';
import { upsertClinicalMetrics } from '../../../src/electron/backend/dataLibrary/repository.js';
import { indexExplanationArtifact } from '../../../src/electron/backend/explainability.js';
import { indexFeatureArtifact } from '../../../src/electron/backend/featureArtifacts.js';
import { savePredictionResult } from '../../../src/electron/backend/predictions.js';
import { createPatient, getWorkbenchData, listTaskLogs, listTasks } from '../../../src/electron/backend/repositories.js';
import {
  createBatchSummaryReport,
  createPatientReport,
  listBatchSummaryReports,
  listPatientReports,
} from '../../../src/electron/backend/reports.js';

const roots: string[] = [];
const locals: LocalDatabase[] = [];

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-report-'));
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

describe('patient report export backend', () => {
  it('generates a local HTML report from patient, clinical, feature, and prediction data', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '左手' });
    const featurePath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_psd_eo.npz');
    const topomapPath = path.join(local.paths.outputsRoot, 'explainability', 'sub01', 'figure6a_psd_topomap_bands.png');
    const connectivityPath = path.join(
      local.paths.outputsRoot,
      'explainability',
      'sub01',
      'figure6b_wpli_connectivity_bands.png',
    );
    writeFile(featurePath, 'psd features');
    writeFile(topomapPath, 'topomap image');
    writeFile(connectivityPath, 'connectivity image');
    upsertClinicalMetrics(local.db, {
      patientId,
      sourceWorkbook: '脑卒中患者信息记录表.xlsx',
      diseaseCourse: '2月',
      affectedSideRaw: '左',
      fmaBefore: 63,
      fmaAfter: 65,
      mbiBefore: 70,
      mbiAfter: 80,
      bbtBefore: '12',
      bbtAfter: '16',
      mmse: 27,
      missingData: '',
      dropoutReason: '',
      mriCount: 1,
    });
    indexFeatureArtifact(local.db, {
      patientId,
      kind: 'PSD',
      state: 'EO',
      filePath: featurePath,
      featureCount: 5580,
      params: { method: 'welch' },
    });
    savePredictionResult(local.db, {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      predictedClass: '比例恢复',
      probability: 0.87,
      threshold: 0.5,
      labelDefinition: '比例恢复 (PR) vs 恢复不良',
    });
    indexExplanationArtifact(local.db, {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      artifactType: 'psd_heatmap',
      title: 'PSD Topomap Bands',
      method:
        'IG 64 + SmoothGrad 8; target=classification_logit; baseline=fold-local standardized zero; noise std 0.02',
      filePath: topomapPath,
      preview: {
        target: 'classification_logit',
        integratedGradientsSteps: 64,
        smoothGradSamples: 8,
        smoothGradNoiseStd: 0.02,
        baseline: 'fold-local standardized zero',
        attributionScript: 'scripts/31_explain_residual_aware_ssl_cnn.py',
        topomapScript: 'scripts/45_make_mne_explainability_topomaps.py',
        connectivityScript: 'scripts/46_make_mne_wpli_connectivity.py',
      },
      topFeatures: [{ name: 'EO PSD Beta High F5', score: 0.24, modality: 'PSD' }],
    });
    indexExplanationArtifact(local.db, {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      artifactType: 'fc_network',
      title: 'WPLI Connectivity Bands',
      method:
        'IG 64 + SmoothGrad 8; target=classification_logit; baseline=fold-local standardized zero; noise std 0.02',
      filePath: connectivityPath,
      preview: {
        target: 'classification_logit',
        integratedGradientsSteps: 64,
        smoothGradSamples: 8,
        smoothGradNoiseStd: 0.02,
        baseline: 'fold-local standardized zero',
        attributionScript: 'scripts/31_explain_residual_aware_ssl_cnn.py',
        topomapScript: 'scripts/45_make_mne_explainability_topomaps.py',
        connectivityScript: 'scripts/46_make_mne_wpli_connectivity.py',
      },
      topFeatures: [{ name: 'EC WPLI Beta High F8-CP1', score: 0.31, modality: 'FC' }],
    });

    const result = createPatientReport(local.db, local.paths, {
      patientId,
      title: 'tACS EEG 康复结局预测报告',
    });
    const reports = listPatientReports(local.db, { patientId });
    const tasks = listTasks(local.db, { type: 'report_export' });
    const logs = listTaskLogs(local.db, { level: 'info' });
    const workbench = getWorkbenchData(local.db, local.paths.dataRoot);

    expect(result).toEqual({
      ok: true,
      message: expect.stringContaining('已生成患者报告'),
      report: expect.objectContaining({
        patientId,
        subjectCode: 'sub01',
        patientName: '穆祥贵',
        format: 'html',
        status: '已生成',
        filePath: expect.stringMatching(/sub01.+recovery-report\.html$/),
      }),
    });
    expect(fs.existsSync(result.report!.filePath)).toBe(true);
    expect(fs.readFileSync(result.report!.filePath, 'utf8')).toEqual(expect.stringContaining('tACS EEG 康复结局预测报告'));
    expect(fs.readFileSync(result.report!.filePath, 'utf8')).toEqual(expect.stringContaining('FMA 63 -> 65'));
    expect(fs.readFileSync(result.report!.filePath, 'utf8')).toEqual(expect.stringContaining('比例恢复'));
    expect(fs.readFileSync(result.report!.filePath, 'utf8')).toEqual(expect.stringContaining('87.0%'));
    expect(fs.readFileSync(result.report!.filePath, 'utf8')).toEqual(expect.stringContaining('PSD: 1'));
    const html = fs.readFileSync(result.report!.filePath, 'utf8');
    expect(html).toEqual(expect.stringContaining('class="report-shell"'));
    expect(html).toEqual(expect.stringContaining('EEG Topomap'));
    expect(html).toEqual(expect.stringContaining('Connectivity'));
    expect(html).toEqual(expect.stringContaining('figure6a_psd_topomap_bands.png'));
    expect(html).toEqual(expect.stringContaining('figure6b_wpli_connectivity_bands.png'));
    expect(html).toEqual(expect.stringContaining('src="data:image/png;base64,'));
    expect(html.match(/src="data:image\/png;base64,/g)?.length).toBe(2);
    expect(html).toEqual(expect.stringContaining('classification_logit'));
    expect(html).toEqual(expect.stringContaining('Integrated Gradients: 64 steps'));
    expect(html).toEqual(expect.stringContaining('SmoothGrad: 8 samples'));
    expect(html).toEqual(expect.stringContaining('noise std 0.02'));
    expect(html).toEqual(expect.stringContaining('fold-local standardized zero'));
    expect(html).toEqual(expect.stringContaining('31_explain_residual_aware_ssl_cnn.py'));
    expect(html).toEqual(expect.stringContaining('45_make_mne_explainability_topomaps.py'));
    expect(html).toEqual(expect.stringContaining('46_make_mne_wpli_connectivity.py'));
    expect(html).toEqual(expect.stringContaining('EC WPLI Beta High F8-CP1'));
    expect(reports).toEqual([expect.objectContaining({ id: result.report!.id, patientId, status: '已生成' })]);
    expect(tasks).toEqual([
      expect.objectContaining({
        type: 'report_export',
        patientId,
        status: 'completed',
      }),
    ]);
    expect(JSON.parse(tasks[0].outputJson)).toEqual(
      expect.objectContaining({ reportId: result.report!.id, filePath: result.report!.filePath }),
    );
    expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'report' })]));
    expect(workbench.patients[0]).toEqual(expect.objectContaining({ id: 'sub01', report: '已生成' }));
  });

  it('generates a CSV batch summary covering workflow, prediction, and report status for all patients', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '左手' });
    createPatient(local.db, { subjectCode: 'sub02', name: '张三', affectedHand: '右手' });
    const featurePath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_psd_eo.npz');
    writeFile(featurePath, 'psd features');
    indexFeatureArtifact(local.db, {
      patientId,
      kind: 'PSD',
      state: 'EO',
      filePath: featurePath,
      featureCount: 5580,
    });
    savePredictionResult(local.db, {
      patientId,
      taskId: 'pr',
      modelId: 'm2',
      predictedClass: '比例恢复',
      probability: 0.87,
      threshold: 0.5,
      labelDefinition: '比例恢复 (PR) vs 恢复不良',
    });
    createPatientReport(local.db, local.paths, { patientId });

    const result = createBatchSummaryReport(local.db, local.paths, {
      title: 'tACS EEG 康复结局批次汇总',
    });
    const reports = listBatchSummaryReports(local.db);
    const tasks = listTasks(local.db, { type: 'report_export' });
    const logs = listTaskLogs(local.db, { level: 'info' });

    expect(result).toEqual({
      ok: true,
      message: expect.stringContaining('已生成批次汇总'),
      report: expect.objectContaining({
        format: 'csv',
        status: '已生成',
        patientCount: 2,
        filePath: expect.stringMatching(/batch-summary.+\.csv$/),
      }),
    });
    expect(reports).toEqual([expect.objectContaining({ id: result.report!.id, patientCount: 2 })]);
    expect(fs.existsSync(result.report!.filePath)).toBe(true);
    const csv = fs.readFileSync(result.report!.filePath, 'utf8');
    expect(csv).toEqual(expect.stringContaining('Subject,Name,Affected Hand,EO,EC,Preprocess Status'));
    expect(csv).toEqual(expect.stringContaining('sub01,穆祥贵,左手'));
    expect(csv).toEqual(expect.stringContaining('比例恢复'));
    expect(csv).toEqual(expect.stringContaining('87.0%'));
    expect(csv).toEqual(expect.stringContaining('ResidualAware_SSL_CNN locked_10seed_final'));
    expect(csv).toEqual(expect.stringContaining('比例恢复 (PR) vs 恢复不良'));
    expect(csv).toEqual(expect.stringContaining('sub02,张三,右手'));
    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'report_export',
          patientId: null,
          status: 'completed',
        }),
      ]),
    );
    expect(JSON.parse(tasks[0].outputJson)).toEqual(
      expect.objectContaining({ reportId: result.report!.id, filePath: result.report!.filePath, format: 'csv' }),
    );
    expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'report' })]));
  });

  it('returns a readable failure when the selected patient does not exist', async () => {
    const local = await openTempDatabase();

    expect(createPatientReport(local.db, local.paths, { patientId: 'missing-patient' })).toEqual({
      ok: false,
      message: '无法生成报告：患者不存在。',
      report: null,
    });
    expect(listPatientReports(local.db)).toEqual([]);
  });
});
