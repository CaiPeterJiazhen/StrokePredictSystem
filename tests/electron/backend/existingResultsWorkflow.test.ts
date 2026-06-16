import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLocalDatabase, type LocalDatabase } from '../../../src/electron/backend/database.js';
import {
  completeExistingPreprocessRun,
  importExistingPatientRun,
  indexExistingExplanationResults,
  indexExistingFeatureResults,
  launchExistingPreprocessManualStep,
  saveExistingPredictionResult,
} from '../../../src/electron/backend/existingResultsWorkflow.js';
import { listExplanationArtifacts, listExplanationOverview } from '../../../src/electron/backend/explainability.js';
import { listFeatureOverview } from '../../../src/electron/backend/featureArtifacts.js';
import { listPredictionQueue } from '../../../src/electron/backend/predictions.js';
import { createPatientReport } from '../../../src/electron/backend/reports.js';
import { getWorkbenchData, updateSettings } from '../../../src/electron/backend/repositories.js';

const roots: string[] = [];
const locals: LocalDatabase[] = [];

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-existing-results-'));
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
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeFixture(root: string) {
  const preprocessedPatientRoot = path.join(root, 'Patient_tACS_M1_RestingStateEEG_afterProcess', '基线', 'sub01穆祥贵');
  const featureRoot = path.join(root, 'features');
  const predictionCsvPath = path.join(root, 'results', 'predictions', 'final_Residual_ssl_cnn_10seed_patient_predictions.csv');
  const explainabilityRoot = path.join(root, 'results', 'figures', 'revised_initial');
  const topFeatureTablePath = path.join(root, 'results', 'tables', 'table4_explainability_top_features_for_paper.csv');

  for (const stem of ['mxg1', 'mxg2']) {
    writeFile(path.join(preprocessedPatientRoot, `${stem}.set`), 'set');
    writeFile(path.join(preprocessedPatientRoot, `${stem}.fdt`), 'fdt');
  }

  for (const state of ['EO', 'EC']) {
    writeFile(path.join(featureRoot, 'psd', `sub01_${state}_psd.npz`), 'psd');
    writeFile(path.join(featureRoot, 'fc', `sub01_${state}_fc.npz`), 'fc');
  }

  writeFile(
    predictionCsvPath,
    [
      'model_label,source_model,seed,fold_index,subject_id,test_subject_id,y_true,y_score,y_prob,y_pred,classification_y_score,residual_y_score,residual_score_z,uses_ssl,uses_residual_aware_heads,uses_swa,lambda_reg,lambda_rank,lambda_soft,rank_margin,residual_alpha,swa_start_epoch,swa_lr,selected_alpha',
      'Residual_ssl_cnn,ResidualAware_SSL_CNN,0,1,sub01,sub01,1,0.9903783798217772,0.9903783798217772,1,0.9903783798217772,0.12,0.4,true,true,true,0.1,0.1,0.1,0.2,1,40,0.0001,1',
      'Residual_ssl_cnn,ResidualAware_SSL_CNN,1,1,sub01,sub01,1,0.978174924850464,0.978174924850464,1,0.978174924850464,0.12,0.4,true,true,true,0.1,0.1,0.1,0.2,1,40,0.0001,1',
      'Residual_ssl_cnn,ResidualAware_SSL_CNN,2,1,sub01,sub01,1,0.9671857357025146,0.9671857357025146,1,0.9671857357025146,0.12,0.4,true,true,true,0.1,0.1,0.1,0.2,1,40,0.0001,1',
      'Residual_ssl_cnn,ResidualAware_SSL_CNN,3,1,sub01,sub01,1,0.9433931112289428,0.9433931112289428,1,0.9433931112289428,0.12,0.4,true,true,true,0.1,0.1,0.1,0.2,1,40,0.0001,1',
      'Residual_ssl_cnn,ResidualAware_SSL_CNN,4,1,sub01,sub01,1,0.919159471988678,0.919159471988678,1,0.919159471988678,0.12,0.4,true,true,true,0.1,0.1,0.1,0.2,1,40,0.0001,1',
      'Residual_ssl_cnn,ResidualAware_SSL_CNN,5,1,sub01,sub01,1,0.98194420337677,0.98194420337677,1,0.98194420337677,0.12,0.4,true,true,true,0.1,0.1,0.1,0.2,1,40,0.0001,1',
      'Residual_ssl_cnn,ResidualAware_SSL_CNN,7,1,sub01,sub01,1,0.9086994528770448,0.9086994528770448,1,0.9086994528770448,0.12,0.4,true,true,true,0.1,0.1,0.1,0.2,1,40,0.0001,1',
      'Residual_ssl_cnn,ResidualAware_SSL_CNN,13,1,sub01,sub01,1,0.979569971561432,0.979569971561432,1,0.979569971561432,0.12,0.4,true,true,true,0.1,0.1,0.1,0.2,1,40,0.0001,1',
      'Residual_ssl_cnn,ResidualAware_SSL_CNN,21,1,sub01,sub01,1,0.9769063591957092,0.9769063591957092,1,0.9769063591957092,0.12,0.4,true,true,true,0.1,0.1,0.1,0.2,1,40,0.0001,1',
      'Residual_ssl_cnn,ResidualAware_SSL_CNN,42,1,sub01,sub01,1,0.9637334942817688,0.9637334942817688,1,0.9637334942817688,0.12,0.4,true,true,true,0.1,0.1,0.1,0.2,1,40,0.0001,1',
    ].join('\n'),
  );
  writeFile(
    topFeatureTablePath,
    [
      'rank,feature_type,state,band,channel,edge,node1,node2,network,mean_abs_attribution,mean_signed_attribution',
      '1,WPLI,EC,Beta High,,F8-CP1,F8,CP1,central|frontal,0.1353,0.006605938',
      '2,WPLI,EC,Beta High,,F8-P1,F8,P1,frontal|parietal,0.1287,-0.0042',
      '3,WPLI,EC,Beta High,,F8-FC4,F8,FC4,frontal|central,0.1211,0.0038',
    ].join('\n'),
  );

  writeFile(path.join(explainabilityRoot, 'figure6_eeg_explainability.png'), 'png');
  writeFile(path.join(explainabilityRoot, 'figure6a_psd_topomap_bands.png'), 'png');
  writeFile(path.join(explainabilityRoot, 'figure6b_wpli_connectivity_bands.png'), 'png');

  return {
    preprocessedPatientRoot,
    featureRoot,
    predictionCsvPath,
    explainabilityRoot,
  };
}

afterEach(() => {
  for (const local of locals.splice(0)) {
    local.close();
  }

  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('existing single-patient result workflow', () => {
  it('connects sub01 existing EEG, feature, prediction, and explanation results stage by stage', async () => {
    const local = await openTempDatabase();
    const fixture = writeFixture(createTempRoot());
    const matlabPath = path.join(local.paths.dataRoot, 'MATLAB', 'bin', 'matlab.exe');
    const eeglabPath = path.join(local.paths.dataRoot, 'tools', 'eeglab');

    writeFile(matlabPath, 'matlab');
    fs.mkdirSync(eeglabPath, { recursive: true });
    updateSettings(local.db, {
      matlabExecutable: matlabPath,
      eeglabPath,
    });

    const imported = importExistingPatientRun(local.db, local.paths, fixture);
    expect(imported.ok).toBe(true);
    expect(imported.subjectCode).toBe('sub01');
    expect(imported.patientId).toBeTruthy();

    const openPath = vi.fn().mockResolvedValue('');
    const launched = await launchExistingPreprocessManualStep(
      local.db,
      local.paths,
      { patientIds: [imported.patientId!], step: 'bad_segments', ...fixture },
      openPath,
    );
    expect(launched.ok).toBe(true);
    expect(launched.launchTargetPath).toContain('launch-eeglab');
    expect(openPath).toHaveBeenCalledWith(launched.launchTargetPath);
    expect(fs.existsSync(launched.scriptPath!)).toBe(true);
    expect(fs.readFileSync(launched.scriptPath!, 'utf8')).toContain('pop_loadset');
    expect(fs.readFileSync(launched.launchTargetPath!, 'utf8')).toContain(matlabPath);

    const preprocessed = completeExistingPreprocessRun(local.db, local.paths, {
      patientIds: [imported.patientId!],
      ...fixture,
    });
    expect(preprocessed.ok).toBe(true);
    expect(getWorkbenchData(local.db, local.paths.dataRoot).patients[0]).toMatchObject({
      id: 'sub01',
      eo: true,
      ec: true,
      preStatus: '已完成',
    });

    const features = indexExistingFeatureResults(local.db, local.paths, {
      patientIds: [imported.patientId!],
      ...fixture,
    });
    expect(features.ok).toBe(true);
    expect(features.indexedArtifacts).toBe(4);
    expect(listFeatureOverview(local.db)[0]).toMatchObject({
      subjectCode: 'sub01',
      psdCount: 2,
      fcCount: 2,
      featureStatus: '已完成',
    });

    const prediction = saveExistingPredictionResult(local.db, local.paths, {
      patientIds: [imported.patientId!],
      ...fixture,
    });
    expect(prediction.ok).toBe(true);
    expect(prediction.predictionId).toBeTruthy();
    expect(listPredictionQueue(local.db)[0]).toMatchObject({
      subjectCode: 'sub01',
      prediction: '比例恢复',
      probability: 0.96091451048851,
    });

    const explanation = indexExistingExplanationResults(local.db, local.paths, {
      patientIds: [imported.patientId!],
      ...fixture,
    });
    expect(explanation.ok).toBe(true);
    expect(explanation.indexedArtifacts).toBe(3);
    expect(listExplanationOverview(local.db)[0]).toMatchObject({
      subjectCode: 'sub01',
      explanationStatus: '已生成',
      artifactCount: 3,
    });
    expect(listExplanationArtifacts(local.db, { patientId: imported.patientId! })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: expect.stringContaining('classification_logit'),
          preview: expect.objectContaining({
            target: 'classification_logit',
            integratedGradientsSteps: 64,
            smoothGradSamples: 8,
            smoothGradNoiseStd: 0.02,
            baseline: 'fold-local standardized zero',
          }),
          topFeatures: expect.arrayContaining([
            expect.objectContaining({ name: 'EC WPLI Beta High F8-CP1', score: 0.1353, modality: 'FC' }),
          ]),
        }),
      ]),
    );

    const report = createPatientReport(local.db, local.paths, {
      patientId: imported.patientId!,
      format: 'html',
      title: '既有单患者演示报告',
    });
    expect(report.ok).toBe(true);
    expect(report.report?.filePath).toBeTruthy();

    const html = fs.readFileSync(report.report!.filePath, 'utf8');
    expect(html).toEqual(expect.stringContaining('figure6a_psd_topomap_bands.png'));
    expect(html).toEqual(expect.stringContaining('figure6b_wpli_connectivity_bands.png'));
    expect(html.match(/src="data:image\/png;base64,/g)).toHaveLength(2);
    expect(html).toEqual(expect.stringContaining('Name: <strong>穆**</strong>'));
    expect(html).not.toEqual(expect.stringContaining('Name: <strong>穆祥贵</strong>'));
  });
});
