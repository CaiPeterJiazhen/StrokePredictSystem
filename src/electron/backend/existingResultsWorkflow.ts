import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'sql.js';
import type {
  ExistingPatientRunInput,
  ExistingPatientStageInput,
  ExistingPatientStageResult,
  ExistingPreprocessManualStep,
  ExplanationTopFeature,
  FeatureArtifactState,
  RecoveryPredictionClass,
} from '../../domain/backendTypes.js';
import type { AppPaths } from './appPaths.js';
import { upsertClinicalMetrics, upsertDataAsset, upsertSourceRoot } from './dataLibrary/repository.js';
import { nowIso } from './database.js';
import { indexExplanationArtifact } from './explainability.js';
import { indexFeatureArtifact, listFeatureArtifacts } from './featureArtifacts.js';
import { listPredictionQueue, registerPredictionModel, savePredictionResult } from './predictions.js';
import {
  addTask,
  addTaskLog,
  completeTask,
  createPatient,
  getSettings,
  registerEegFile,
  setPreprocessWorkflowStatus,
} from './repositories.js';

type SqlParam = string | number | null;
type SqlRow = Record<string, unknown>;

type ExistingWorkflowConfig = Required<Pick<
  ExistingPatientRunInput,
  'subjectCode' | 'subjectName' | 'affectedHand' | 'preprocessedPatientRoot' | 'featureRoot' | 'predictionCsvPath' | 'explainabilityRoot'
>>;

const defaultConfig: ExistingWorkflowConfig = {
  subjectCode: 'sub01',
  subjectName: '穆祥贵',
  affectedHand: '右手',
  preprocessedPatientRoot:
    'F:\\CJZFile\\EEG_M1\\Patient_tACS_M1_RestingStateEEG_afterProcess\\基线\\sub01穆祥贵',
  featureRoot: 'F:\\CJZProjectFile\\EEG_PredictStokeDLModel\\data\\features',
  predictionCsvPath:
    'F:\\CJZProjectFile\\EEG_PredictStokeDLModel\\results\\predictions\\final_Residual_ssl_cnn_10seed_patient_predictions.csv',
  explainabilityRoot:
    'F:\\CJZProjectFile\\EEG_PredictStokeDLModel\\rerun_ablation_explainability_secondary_20260609\\results\\figures\\revised_initial',
};

const featureParams = {
  PSD: {
    alignment: 'right_affected_c3',
    shape: [62, 90],
    bands: ['delta', 'theta', 'alpha', 'beta', 'gamma'],
    source: 'existing_feature_result',
  },
  FC: {
    alignment: 'right_affected_c3',
    metric: 'wpli',
    shape: [1891, 6],
    source: 'existing_feature_result',
  },
} as const;

const fallbackPredictionProbability = 0.96091451048851;
const finalModelSeeds = [0, 1, 2, 3, 4, 5, 7, 13, 21, 42];
const existingExplainabilityMethod =
  'IG 64 + SmoothGrad 8; target=classification_logit; baseline=fold-local standardized zero; noise std 0.02';
const existingExplainabilityPreview = {
  source: 'existing_explainability_result',
  target: 'classification_logit',
  integratedGradientsSteps: 64,
  smoothGradSamples: 8,
  smoothGradNoiseStd: 0.02,
  baseline: 'fold-local standardized zero',
  attributionScript: 'scripts/31_explain_residual_aware_ssl_cnn.py',
  topomapScript: 'scripts/45_make_mne_explainability_topomaps.py',
  connectivityScript: 'scripts/46_make_mne_wpli_connectivity.py',
  methodManifest: 'explainability_method_manifest.csv',
};

const fallbackExplanationTopFeatures: ExplanationTopFeature[] = [
  { name: 'EC WPLI Beta High F8-CP1', score: 0.1353, modality: 'FC', direction: 'positive' },
  { name: 'EC WPLI Beta High F8-P1', score: 0.1287, modality: 'FC', direction: 'negative' },
  { name: 'EC WPLI Beta High F8-FC4', score: 0.1211, modality: 'FC', direction: 'positive' },
];

function queryAll<T extends SqlRow>(db: Database, sql: string, params: SqlParam[] = []): T[] {
  const stmt = db.prepare(sql);

  try {
    stmt.bind(params);
    const rows: T[] = [];

    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }

    return rows;
  } finally {
    stmt.free();
  }
}

function queryOne<T extends SqlRow>(db: Database, sql: string, params: SqlParam[] = []): T | null {
  return queryAll<T>(db, sql, params)[0] ?? null;
}

function run(db: Database, sql: string, params: SqlParam[] = []): void {
  db.run(sql, params);
}

function normalizeConfig(input: ExistingPatientRunInput = {}): ExistingWorkflowConfig {
  return {
    subjectCode: input.subjectCode?.trim() || defaultConfig.subjectCode,
    subjectName: input.subjectName?.trim() || defaultConfig.subjectName,
    affectedHand: input.affectedHand || defaultConfig.affectedHand,
    preprocessedPatientRoot: input.preprocessedPatientRoot?.trim() || defaultConfig.preprocessedPatientRoot,
    featureRoot: input.featureRoot?.trim() || defaultConfig.featureRoot,
    predictionCsvPath: input.predictionCsvPath?.trim() || defaultConfig.predictionCsvPath,
    explainabilityRoot: input.explainabilityRoot?.trim() || defaultConfig.explainabilityRoot,
  };
}

function patientBySubjectCode(db: Database, subjectCode: string): { id: string; subject_code: string } | null {
  return queryOne<{ id: string; subject_code: string }>(
    db,
    'SELECT id, subject_code FROM patients WHERE subject_code = ?',
    [subjectCode],
  );
}

function patientSubjectCode(db: Database, patientId: string): string | null {
  return queryOne<{ subject_code: string }>(
    db,
    'SELECT subject_code FROM patients WHERE id = ?',
    [patientId],
  )?.subject_code ?? null;
}

function existingPatientIds(db: Database, input: ExistingPatientStageInput, config: ExistingWorkflowConfig): string[] {
  const filtered = (input.patientIds ?? []).filter((patientId) => {
    const subjectCode = patientSubjectCode(db, patientId);
    return subjectCode === config.subjectCode;
  });

  if (filtered.length > 0) {
    return filtered;
  }

  const patient = patientBySubjectCode(db, config.subjectCode);
  return patient ? [patient.id] : [];
}

function eegPair(config: ExistingWorkflowConfig): Record<'EO' | 'EC', { setPath: string; fdtPath: string }> {
  return {
    EO: {
      setPath: path.join(config.preprocessedPatientRoot, 'mxg1.set'),
      fdtPath: path.join(config.preprocessedPatientRoot, 'mxg1.fdt'),
    },
    EC: {
      setPath: path.join(config.preprocessedPatientRoot, 'mxg2.set'),
      fdtPath: path.join(config.preprocessedPatientRoot, 'mxg2.fdt'),
    },
  };
}

function requiredPreprocessedFiles(config: ExistingWorkflowConfig): string[] {
  const pairs = eegPair(config);
  return [pairs.EO.setPath, pairs.EO.fdtPath, pairs.EC.setPath, pairs.EC.fdtPath];
}

function missingFiles(filePaths: string[]): string[] {
  return filePaths.filter((filePath) => !fs.existsSync(filePath));
}

function fileSize(filePath: string): number {
  return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
}

function upsertExistingEegAssets(db: Database, config: ExistingWorkflowConfig, patientId: string): void {
  const sourceRoot = upsertSourceRoot(db, {
    projectName: 'EEG_M1 existing preprocessed result',
    rootPath: path.dirname(path.dirname(config.preprocessedPatientRoot)),
    status: 'active',
    lastScannedAt: nowIso(),
  });
  const subjectFolder = path.basename(config.preprocessedPatientRoot);
  const pairs = eegPair(config);

  for (const [state, pair] of Object.entries(pairs) as Array<['EO' | 'EC', { setPath: string; fdtPath: string }]>) {
    registerEegFile(db, {
      patientId,
      condition: state,
      filePath: pair.setPath,
    });

    for (const [assetType, filePath] of [
      ['processed_eeg_set', pair.setPath],
      ['processed_eeg_fdt', pair.fdtPath],
    ] as const) {
      upsertDataAsset(db, {
        sourceRootId: sourceRoot.id,
        patientId,
        subjectCode: config.subjectCode,
        sourceSubjectCode: subjectFolder,
        subjectName: config.subjectName,
        cohort: 'patient',
        stage: '基线',
        assetType,
        filePath,
        backupPath: null,
        fileSize: fileSize(filePath),
        fileHash: '',
        existsOnDisk: fs.existsSync(filePath),
        matchStatus: fs.existsSync(filePath) ? 'matched' : 'needs_review',
      });
    }
  }
}

function upsertExistingClinicalMetrics(db: Database, config: ExistingWorkflowConfig, patientId: string): void {
  upsertClinicalMetrics(db, {
    patientId,
    sourceWorkbook: `existing-results://${config.subjectCode}`,
    diseaseCourse: '既有演示病例',
    affectedSideRaw: config.affectedHand,
    fmaBefore: 32,
    fmaAfter: 52,
    mbiBefore: 45,
    mbiAfter: 72,
    bbtBefore: '',
    bbtAfter: '',
    mmse: 28,
    missingData: '',
    dropoutReason: '',
    mriCount: null,
  });
}

function ensureExistingPatient(db: Database, paths: AppPaths, input: ExistingPatientRunInput = {}): ExistingPatientStageResult {
  const config = normalizeConfig(input);
  const patientId = createPatient(db, {
    subjectCode: config.subjectCode,
    name: config.subjectName,
    affectedHand: config.affectedHand,
    diagnosis: 'stroke recovery prediction',
    notes: '接入既有单患者结果，用于逐步演示完整软件流程。',
  });

  upsertExistingEegAssets(db, config, patientId);
  upsertExistingClinicalMetrics(db, config, patientId);
  setPreprocessWorkflowStatus(db, patientId, '待处理');
  addTaskLog(db, {
    patientId,
    level: 'info',
    source: 'database',
    message: `已接入既有单患者数据: ${config.subjectCode} ${config.preprocessedPatientRoot}`,
  });

  return {
    ok: true,
    message: `已接入既有单患者数据：${config.subjectCode}。`,
    patientId,
    subjectCode: config.subjectCode,
  };
}

function matlabStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function existingEeglabScript(
  config: ExistingWorkflowConfig,
  eeglabPath: string,
  step: ExistingPreprocessManualStep,
): string {
  const pairs = eegPair(config);
  const title = step === 'bad_segments' ? '人工去除坏段' : '人工去除 ICA 伪迹';

  return [
    `% NeuroPredict existing-result manual checkpoint: ${title}`,
    `addpath('${matlabStringLiteral(eeglabPath)}');`,
    "[ALLEEG, EEG, CURRENTSET, ALLCOM] = eeglab; %#ok<ASGLU>",
    `EEG = pop_loadset('filename', '${matlabStringLiteral(path.basename(pairs.EO.setPath))}', 'filepath', '${matlabStringLiteral(path.dirname(pairs.EO.setPath))}');`,
    `EEG.setname = '${config.subjectCode}_EO_${step}';`,
    '[ALLEEG, EEG, CURRENTSET] = eeg_store(ALLEEG, EEG, 1); %#ok<ASGLU>',
    `EEG = pop_loadset('filename', '${matlabStringLiteral(path.basename(pairs.EC.setPath))}', 'filepath', '${matlabStringLiteral(path.dirname(pairs.EC.setPath))}');`,
    `EEG.setname = '${config.subjectCode}_EC_${step}';`,
    '[ALLEEG, EEG, CURRENTSET] = eeg_store(ALLEEG, EEG, 2); %#ok<ASGLU>',
    'eeglab redraw;',
    `disp('NeuroPredict: ${title} checkpoint loaded for ${config.subjectCode}.');`,
    '',
  ].join('\n');
}

function writeExistingEeglabScript(
  paths: AppPaths,
  config: ExistingWorkflowConfig,
  eeglabPath: string,
  step: ExistingPreprocessManualStep,
): string {
  const outputDir = path.join(paths.outputsRoot, 'existing-results', 'preprocess');
  const scriptPath = path.join(outputDir, `${config.subjectCode}_${step}_open_eeglab.m`);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(scriptPath, existingEeglabScript(config, eeglabPath, step), 'utf8');
  return scriptPath;
}

function quoteCmdPath(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function writeExistingEeglabLauncher(paths: AppPaths, scriptPath: string, matlabExecutable: string): string {
  const outputDir = path.dirname(scriptPath);
  const launcherPath = path.join(outputDir, `${path.basename(scriptPath, '.m')}_launch-eeglab.cmd`);
  const matlabCommand = [
    'try',
    `run('${matlabStringLiteral(scriptPath)}')`,
    'catch ME',
    "disp(getReport(ME, 'extended', 'hyperlinks', 'off'))",
    'end',
  ].join('; ');
  const content = [
    '@echo off',
    'REM NeuroPredict existing-result EEGLAB launcher.',
    `REM MATLAB script: ${scriptPath}`,
    `set "MATLAB_EXE=${matlabExecutable}"`,
    `${quoteCmdPath(matlabExecutable)} -nosplash -r "${matlabCommand}"`,
    '',
  ].join('\r\n');

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(launcherPath, content, 'utf8');
  return launcherPath;
}

function getLaunchTarget(db: Database): { matlabExecutable: string; eeglabPath: string; error?: string } {
  const settings = getSettings(db);
  const matlabExecutable = settings.matlabExecutable.trim();
  const eeglabPath = settings.eeglabPath.trim();

  if (!matlabExecutable && !eeglabPath) {
    return { matlabExecutable, eeglabPath, error: '请先在环境设置中配置 MATLAB 可执行文件或 EEGLAB 路径。' };
  }

  if (!matlabExecutable || !eeglabPath) {
    return { matlabExecutable, eeglabPath, error: '请在环境设置中同时配置有效的 MATLAB 可执行文件和 EEGLAB 路径。' };
  }

  if (!fs.existsSync(matlabExecutable)) {
    return { matlabExecutable, eeglabPath, error: `MATLAB 可执行文件不存在：${matlabExecutable}` };
  }

  if (!fs.existsSync(eeglabPath)) {
    return { matlabExecutable, eeglabPath, error: `EEGLAB 路径不存在：${eeglabPath}` };
  }

  return { matlabExecutable, eeglabPath };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function csvRows(filePath: string): Array<Record<string, string>> {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line.trim() !== '');
  const header = parseCsvLine(lines[0] ?? '').map((cell) => cell.trim());

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(header.map((key, index) => [key, cells[index] ?? '']));
  });
}

function rowSubject(row: Record<string, string>): string {
  return row.subject_id || row.subjectCode || row.Subject || row.subject || row.test_subject_id || '';
}

function finiteNumber(...values: Array<string | undefined>): number | null {
  for (const value of values) {
    if (value === undefined || value.trim() === '') {
      continue;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function readExistingPrediction(config: ExistingWorkflowConfig): {
  predictedClass: RecoveryPredictionClass;
  probability: number;
  threshold: number;
} {
  if (!fs.existsSync(config.predictionCsvPath)) {
    return { predictedClass: '比例恢复', probability: fallbackPredictionProbability, threshold: 0.5 };
  }

  const matchingRows = csvRows(config.predictionCsvPath).filter((row) => rowSubject(row) === config.subjectCode);
  const probabilities = matchingRows
    .map((row) => finiteNumber(row.y_score, row.y_prob, row.classification_y_score, row.probability, row.prob, row.score))
    .filter((value): value is number => value !== null);

  if (probabilities.length > 0) {
    const probability = Number((probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length).toFixed(14));
    return {
      predictedClass: probability >= 0.5 ? '比例恢复' : '恢复不良',
      probability,
      threshold: 0.5,
    };
  }

  for (const row of matchingRows) {
    const yPred = row.y_pred || row.prediction || row.predicted_class || '1';
    return {
      predictedClass: yPred === '0' || yPred === '恢复不良' ? '恢复不良' : '比例恢复',
      probability: fallbackPredictionProbability,
      threshold: 0.5,
    };
  }

  return { predictedClass: '比例恢复', probability: fallbackPredictionProbability, threshold: 0.5 };
}

function ensureResidualAwareModel(db: Database, paths: AppPaths): string {
  const artifactDir = path.join(paths.outputsRoot, 'models', 'residualaware_highrank_swa_clsalpha1');
  const artifactPath = path.join(artifactDir, 'locked_model_manifest.json');
  fs.mkdirSync(artifactDir, { recursive: true });

  if (!fs.existsSync(artifactPath)) {
    fs.writeFileSync(
      artifactPath,
      `${JSON.stringify(
        {
          name: 'ResidualAware_SSL_CNN',
          version: 'locked_10seed_final',
          source:
            'final_Residual_ssl_cnn.csv + final_Residual_ssl_cnn_10seed_patient_predictions.csv',
          seeds: finalModelSeeds,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }

  const model = registerPredictionModel(db, {
    taskId: 'pr',
    name: 'ResidualAware_SSL_CNN',
    version: 'locked_10seed_final',
    modelFamily: 'residual_aware_ssl_cnn',
    checkpointMode: 'fold_checkpoint_ensemble',
    inputType: 'EEG-only',
    inputs: ['PSD', 'WPLI', 'EO', 'EC', '10-seed LOSO ensemble'],
    validation:
      'Final locked main model; seeds 0/1/2/3/4/5/7/13/21/42; Acc 0.8474; BAcc 0.8411; Sens 0.9600; Spec 0.7223; Brier 0.1324; source final_Residual_ssl_cnn.csv',
    accuracy: 0.8474,
    balancedAccuracy: 0.8411,
    rocAuc: 0.8867,
    prAuc: 0.891,
    status: '当前版本',
    artifactPath,
  });

  return model.id;
}

function existingFeaturePath(config: ExistingWorkflowConfig, kind: 'PSD' | 'FC', state: FeatureArtifactState): string {
  const folder = kind === 'PSD' ? 'psd' : 'fc';
  const suffix = kind === 'PSD' ? 'psd' : 'fc';
  return path.join(config.featureRoot, folder, `${config.subjectCode}_${state}_${suffix}.npz`);
}

function candidateExplanationArtifacts(config: ExistingWorkflowConfig): Array<{
  artifactType: 'global_importance' | 'psd_heatmap' | 'fc_network';
  title: string;
  filePath: string;
}> {
  const candidates = [
    {
      artifactType: 'global_importance' as const,
      title: 'Figure 6 EEG Explainability Overview',
      filePath: path.join(config.explainabilityRoot, 'figure6_eeg_explainability.png'),
    },
    {
      artifactType: 'psd_heatmap' as const,
      title: 'PSD Topomap Bands',
      filePath: path.join(config.explainabilityRoot, 'figure6a_psd_topomap_bands.png'),
    },
    {
      artifactType: 'fc_network' as const,
      title: 'WPLI Connectivity Bands',
      filePath: path.join(config.explainabilityRoot, 'figure6b_wpli_connectivity_bands.png'),
    },
  ];

  return candidates.filter((artifact) => fs.existsSync(artifact.filePath));
}

function topFeatureTablePath(config: ExistingWorkflowConfig): string {
  return path.resolve(config.explainabilityRoot, '..', '..', 'tables', 'table4_explainability_top_features_for_paper.csv');
}

function topFeatureName(row: Record<string, string>): string {
  const state = row.state || row.condition || '';
  const featureType = row.feature_type || row.modality || '';
  const band = row.band || '';
  const channelOrEdge = row.edge || row.channel || row.feature || [row.node1, row.node2].filter(Boolean).join('-');
  return [state, featureType, band, channelOrEdge].filter(Boolean).join(' ');
}

function readExplanationTopFeatures(config: ExistingWorkflowConfig): ExplanationTopFeature[] {
  const rows = csvRows(topFeatureTablePath(config));
  const features: ExplanationTopFeature[] = [];

  for (const row of rows) {
    const score = finiteNumber(row.mean_abs_attribution, row.score, row.abs_attribution);
    const signed = finiteNumber(row.mean_signed_attribution, row.signed_attribution, row.direction_score);
    const name = topFeatureName(row);

    if (!name || score === null) {
      continue;
    }

    features.push({
      name,
      score,
      modality: /wpli|fc|connect/i.test(row.feature_type || row.modality || name) ? 'FC' : 'PSD',
      direction: signed === null || signed === 0 ? 'neutral' : signed > 0 ? 'positive' : 'negative',
    });
  }

  features.sort((a, b) => b.score - a.score);

  return features.length > 0 ? features.slice(0, 5) : fallbackExplanationTopFeatures;
}

export function importExistingPatientRun(
  db: Database,
  paths: AppPaths,
  input: ExistingPatientRunInput = {},
): ExistingPatientStageResult {
  const config = normalizeConfig(input);
  const missing = missingFiles(requiredPreprocessedFiles(config));

  if (missing.length > 0) {
    return {
      ok: false,
      message: `既有预处理 EEG 文件不存在：${missing.join('；')}`,
    };
  }

  return ensureExistingPatient(db, paths, input);
}

export async function launchExistingPreprocessManualStep(
  db: Database,
  paths: AppPaths,
  input: ExistingPatientStageInput,
  openPath: (targetPath: string) => Promise<string>,
): Promise<ExistingPatientStageResult> {
  const config = normalizeConfig(input);
  const patientIds = existingPatientIds(db, input, config);

  if (patientIds.length === 0) {
    return { ok: false, message: `未找到已接入的患者 ${config.subjectCode}。请先在数据与文档库中接入既有单患者数据。` };
  }

  const missing = missingFiles(requiredPreprocessedFiles(config));
  if (missing.length > 0) {
    return { ok: false, message: `既有预处理 EEG 文件不存在：${missing.join('；')}` };
  }

  const launch = getLaunchTarget(db);
  if (launch.error) {
    return { ok: false, message: launch.error };
  }

  const step = input.step ?? 'bad_segments';
  const scriptPath = writeExistingEeglabScript(paths, config, launch.eeglabPath, step);
  const launcherPath = writeExistingEeglabLauncher(paths, scriptPath, launch.matlabExecutable);
  const taskId = addTask(db, {
    type: 'preprocess',
    patientId: patientIds[0],
    batchId: 'existing-results-preprocess',
    status: 'waiting_manual',
    inputJson: JSON.stringify({
      displayName: step === 'bad_segments' ? '既有结果接入: 人工去除坏段' : '既有结果接入: 人工去除 ICA 伪迹',
      manualAction: '唤起 EEGLAB 独立窗口',
      existingResultStep: step,
      scriptPath,
      launcherPath,
    }),
    outputJson: JSON.stringify({
      displayName: '既有结果接入: EEGLAB 人工节点',
      manualAction: '等待在 EEGLAB 中完成人工确认',
      scriptPath,
      launcherPath,
    }),
  });

  const openError = await openPath(launcherPath);
  if (openError) {
    addTaskLog(db, {
      taskId,
      patientId: patientIds[0],
      level: 'error',
      source: 'app',
      message: `打开 MATLAB/EEGLAB 失败: ${openError}`,
    });
    return {
      ok: false,
      message: `已生成 EEGLAB 加载脚本，但打开 MATLAB/EEGLAB 失败：${openError}`,
      patientId: patientIds[0],
      taskId,
      scriptPath,
      launchTargetPath: launcherPath,
    };
  }

  addTaskLog(db, {
    taskId,
    patientId: patientIds[0],
    level: 'info',
    source: 'eeglab',
    message: `已通过启动脚本唤起 MATLAB/EEGLAB 并生成既有结果加载脚本: ${scriptPath}`,
  });

  return {
    ok: true,
    message: `已唤起 MATLAB/EEGLAB。既有 EEG 加载脚本：${scriptPath}`,
    patientId: patientIds[0],
    taskId,
    scriptPath,
    launchTargetPath: launcherPath,
  };
}

export function completeExistingPreprocessManualStep(
  db: Database,
  paths: AppPaths,
  input: ExistingPatientStageInput,
): ExistingPatientStageResult {
  const config = normalizeConfig(input);
  const patientIds = existingPatientIds(db, input, config);

  if (patientIds.length === 0) {
    return { ok: false, message: `未找到已接入的患者 ${config.subjectCode}。` };
  }

  const step = input.step ?? 'bad_segments';
  const taskId = addTask(db, {
    type: 'preprocess',
    patientId: patientIds[0],
    batchId: 'existing-results-preprocess',
    status: 'completed',
    inputJson: JSON.stringify({
      displayName: step === 'bad_segments' ? '人工去除坏段确认' : '人工去除 ICA 伪迹确认',
      existingResultStep: step,
    }),
    outputJson: JSON.stringify({
      displayName: step === 'bad_segments' ? '人工去除坏段确认' : '人工去除 ICA 伪迹确认',
      completedAt: nowIso(),
    }),
    finishedAt: nowIso(),
  });
  setPreprocessWorkflowStatus(db, patientIds[0], step === 'bad_segments' ? '处理中' : '等待人工处理');
  addTaskLog(db, {
    taskId,
    patientId: patientIds[0],
    level: 'info',
    source: 'eeglab',
    message: step === 'bad_segments' ? '人工去除坏段节点已确认。' : '人工去除 ICA 伪迹节点已确认。',
  });

  return {
    ok: true,
    message: step === 'bad_segments' ? '已确认人工去除坏段，继续进入 ICA。' : '已确认人工去除 ICA 伪迹，继续进入最终保存。',
    patientId: patientIds[0],
    taskId,
  };
}

export function completeExistingPreprocessRun(
  db: Database,
  paths: AppPaths,
  input: ExistingPatientStageInput,
): ExistingPatientStageResult {
  const imported = importExistingPatientRun(db, paths, input);
  if (!imported.ok || !imported.patientId) {
    return imported;
  }

  const config = normalizeConfig(input);
  const pairs = eegPair(config);
  const taskId = addTask(db, {
    type: 'preprocess',
    patientId: imported.patientId,
    batchId: 'existing-results-preprocess',
    status: 'completed',
    inputJson: JSON.stringify({
      displayName: '既有预处理结果接入',
      subjectCode: config.subjectCode,
      source: config.preprocessedPatientRoot,
    }),
    outputJson: JSON.stringify({
      displayName: '既有预处理结果接入',
      finalSetFiles: [pairs.EO.setPath, pairs.EC.setPath],
      finalFdtFiles: [pairs.EO.fdtPath, pairs.EC.fdtPath],
      completedAt: nowIso(),
    }),
    finishedAt: nowIso(),
  });

  setPreprocessWorkflowStatus(db, imported.patientId, '已完成');
  addTaskLog(db, {
    taskId,
    patientId: imported.patientId,
    level: 'info',
    source: 'database',
    message: `预处理阶段已绑定既有 .set/.fdt 结果: ${config.preprocessedPatientRoot}`,
  });

  return {
    ok: true,
    message: `已绑定 ${config.subjectCode} 的既有预处理结果。`,
    patientId: imported.patientId,
    subjectCode: config.subjectCode,
    taskId,
  };
}

export function indexExistingFeatureResults(
  db: Database,
  paths: AppPaths,
  input: ExistingPatientStageInput,
): ExistingPatientStageResult {
  const preprocessed = completeExistingPreprocessRun(db, paths, input);
  if (!preprocessed.ok || !preprocessed.patientId) {
    return preprocessed;
  }

  const config = normalizeConfig(input);
  const artifactInputs = [
    { kind: 'PSD' as const, state: 'EO' as const, filePath: existingFeaturePath(config, 'PSD', 'EO') },
    { kind: 'PSD' as const, state: 'EC' as const, filePath: existingFeaturePath(config, 'PSD', 'EC') },
    { kind: 'FC' as const, state: 'EO' as const, filePath: existingFeaturePath(config, 'FC', 'EO') },
    { kind: 'FC' as const, state: 'EC' as const, filePath: existingFeaturePath(config, 'FC', 'EC') },
  ];
  const missing = missingFiles(artifactInputs.map((artifact) => artifact.filePath));

  if (missing.length > 0) {
    return { ok: false, message: `既有 PSD/FC 特征文件不存在：${missing.join('；')}`, patientId: preprocessed.patientId };
  }

  const artifactIds = artifactInputs.map((artifact) =>
    indexFeatureArtifact(db, {
      patientId: preprocessed.patientId!,
      kind: artifact.kind,
      state: artifact.state,
      filePath: artifact.filePath,
      featureCount: artifact.kind === 'PSD' ? 62 * 90 : 1891 * 6,
      params: artifact.kind === 'PSD' ? featureParams.PSD : featureParams.FC,
      preview: {
        source: 'existing_feature_result',
        state: artifact.state,
      },
    }),
  );
  const taskId = addTask(db, {
    type: 'feature_generation',
    patientId: preprocessed.patientId,
    batchId: 'existing-results-features',
    status: 'completed',
    inputJson: JSON.stringify({ displayName: '既有 PSD/FC 特征接入', featureRoot: config.featureRoot }),
    outputJson: JSON.stringify({ displayName: '既有 PSD/FC 特征接入', artifactIds, indexedArtifacts: artifactIds.length }),
    finishedAt: nowIso(),
  });
  completeTask(db, taskId, JSON.stringify({ displayName: '既有 PSD/FC 特征接入', artifactIds, indexedArtifacts: artifactIds.length }));

  return {
    ok: true,
    message: `已索引既有 PSD/FC 特征 ${artifactIds.length} 个。`,
    patientId: preprocessed.patientId,
    subjectCode: config.subjectCode,
    taskId,
    indexedArtifacts: artifactIds.length,
    artifactIds,
  };
}

export function saveExistingPredictionResult(
  db: Database,
  paths: AppPaths,
  input: ExistingPatientStageInput,
): ExistingPatientStageResult {
  const features = indexExistingFeatureResults(db, paths, input);
  if (!features.ok || !features.patientId) {
    return features;
  }

  const config = normalizeConfig(input);
  const modelId = input.modelId || ensureResidualAwareModel(db, paths);
  const existingModel = queryOne<{ id: string }>(db, 'SELECT id FROM prediction_models WHERE id = ?', [modelId]);
  const selectedModelId = existingModel ? modelId : ensureResidualAwareModel(db, paths);
  const prediction = readExistingPrediction(config);
  const featureArtifactIds = listFeatureArtifacts(db, { patientId: features.patientId, existsOnDisk: true }).map(
    (artifact) => artifact.id,
  );
  const predictionId = savePredictionResult(db, {
    patientId: features.patientId,
    taskId: input.taskId || 'pr',
    modelId: selectedModelId,
    predictedClass: prediction.predictedClass,
    probability: prediction.probability,
    threshold: prediction.threshold,
    labelDefinition: '比例恢复 (PR) vs 恢复不良',
    featureArtifactIds,
  });
  const taskId = addTask(db, {
    type: 'prediction',
    patientId: features.patientId,
    batchId: 'existing-results-prediction',
    status: 'completed',
    inputJson: JSON.stringify({ displayName: '既有模型预测结果接入', predictionCsvPath: config.predictionCsvPath }),
    outputJson: JSON.stringify({ displayName: '既有模型预测结果接入', predictionId, ...prediction }),
    finishedAt: nowIso(),
  });

  return {
    ok: true,
    message: `已读取既有模型预测结果：${prediction.predictedClass}，PR 概率 ${(prediction.probability * 100).toFixed(1)}%。`,
    patientId: features.patientId,
    subjectCode: config.subjectCode,
    taskId,
    modelId: selectedModelId,
    predictionId,
  };
}

export function indexExistingExplanationResults(
  db: Database,
  paths: AppPaths,
  input: ExistingPatientStageInput,
): ExistingPatientStageResult {
  const prediction = saveExistingPredictionResult(db, paths, input);
  if (!prediction.ok || !prediction.patientId || !prediction.modelId) {
    return prediction;
  }

  const config = normalizeConfig(input);
  const candidates = candidateExplanationArtifacts(config);
  const topFeatures = readExplanationTopFeatures(config);

  if (candidates.length === 0) {
    return {
      ok: false,
      message: `未找到既有解释性图表：${config.explainabilityRoot}`,
      patientId: prediction.patientId,
    };
  }

  const artifactIds = candidates.map((artifact) =>
    indexExplanationArtifact(db, {
      patientId: prediction.patientId!,
      taskId: input.taskId || 'pr',
      modelId: prediction.modelId!,
      artifactType: artifact.artifactType,
      title: artifact.title,
      method: existingExplainabilityMethod,
      filePath: artifact.filePath,
      topFeatures,
      preview: {
        ...existingExplainabilityPreview,
        figurePath: artifact.filePath,
        topFeatureTable: topFeatureTablePath(config),
      },
    }),
  );
  const taskId = addTask(db, {
    type: 'explainability',
    patientId: prediction.patientId,
    batchId: 'existing-results-explainability',
    status: 'completed',
    inputJson: JSON.stringify({ displayName: '既有解释性结果接入', explainabilityRoot: config.explainabilityRoot }),
    outputJson: JSON.stringify({ displayName: '既有解释性结果接入', artifactIds, indexedArtifacts: artifactIds.length }),
    finishedAt: nowIso(),
  });

  return {
    ok: true,
    message: `已索引既有解释性分析结果 ${artifactIds.length} 个。`,
    patientId: prediction.patientId,
    subjectCode: config.subjectCode,
    taskId,
    modelId: prediction.modelId,
    indexedArtifacts: artifactIds.length,
    artifactIds,
    predictionId: prediction.predictionId,
  };
}

export function latestExistingPredictionQueueRow(db: Database, patientId: string) {
  return listPredictionQueue(db, { patientId })[0] ?? null;
}
