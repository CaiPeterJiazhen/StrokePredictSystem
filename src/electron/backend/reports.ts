import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { Database } from 'sql.js';
import type {
  BatchSummaryExportInput,
  BatchSummaryExportResult,
  BatchSummaryReport,
  BatchSummaryReportFormat,
  BackendReportStatus,
  ExplanationArtifact,
  ListBatchSummaryReportsFilter,
  ListPatientReportsFilter,
  PatientReport,
  PatientReportFormat,
  ReportExportInput,
  ReportExportResult,
} from '../../domain/backendTypes.js';
import type { AppPaths } from './appPaths.js';
import { nowIso } from './database.js';
import { listExplanationArtifacts } from './explainability.js';
import { addTask, addTaskLog, completeTask } from './repositories.js';

type SqlParam = string | number | null;
type SqlRow = Record<string, unknown>;

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

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNullableMetric(name: string, before: number | null, after?: number | null): string {
  if (before === null && (after === undefined || after === null)) return `${name} -`;
  if (after === undefined || after === null) return `${name} ${before ?? '-'}`;
  return `${name} ${before ?? '-'} -> ${after}`;
}

function percent(value: number | null): string {
  return value === null ? '-' : `${(value * 100).toFixed(1)}%`;
}

function csvPercent(value: number | null): string {
  return value === null ? '-' : `${(value * 100).toFixed(1)}%`;
}

function timestampForFilename(timestamp: string): string {
  return timestamp.replace(/[:.]/g, '-');
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? '');

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function fileUrl(filePath: string): string {
  return pathToFileURL(filePath).href;
}

function imageMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
  return 'image/png';
}

function imageSource(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return fileUrl(filePath);
  }

  return `data:${imageMimeType(filePath)};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function maskPatientName(name: string): string {
  const normalized = String(name ?? '').trim();
  const chars = Array.from(normalized);
  return chars.length > 0 ? `${chars[0]}${'*'.repeat(Math.max(0, chars.length - 1))}` : '';
}

function latestExplanationArtifact(
  artifacts: ExplanationArtifact[],
  artifactType: ExplanationArtifact['artifactType'],
): ExplanationArtifact | null {
  return artifacts.find((artifact) => artifact.artifactType === artifactType && artifact.existsOnDisk) ?? null;
}

function uniqueTopFeatures(artifacts: ExplanationArtifact[]): ExplanationArtifact['topFeatures'] {
  const seen = new Set<string>();
  const features: ExplanationArtifact['topFeatures'] = [];

  for (const artifact of artifacts) {
    for (const feature of artifact.topFeatures) {
      const key = `${feature.name}|${feature.modality}`;
      if (seen.has(key)) continue;
      seen.add(key);
      features.push(feature);
      if (features.length >= 5) return features;
    }
  }

  return features;
}

function previewText(preview: Record<string, unknown>, key: string): string {
  const value = preview[key];
  return value === undefined || value === null || value === '' ? '-' : String(value);
}

function reportFromRow(row: {
  id: string;
  patient_id: string;
  subject_code: string;
  patient_name: string;
  format: PatientReportFormat;
  status: BackendReportStatus;
  file_path: string;
  generated_at: string;
  created_at: string;
  updated_at: string;
}): PatientReport {
  return {
    id: row.id,
    patientId: row.patient_id,
    subjectCode: row.subject_code,
    patientName: row.patient_name,
    format: row.format,
    status: row.status,
    filePath: row.file_path,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function batchReportFromRow(row: {
  id: string;
  format: BatchSummaryReportFormat;
  status: BackendReportStatus;
  file_path: string;
  patient_count: number;
  generated_at: string;
  created_at: string;
  updated_at: string;
}): BatchSummaryReport {
  return {
    id: row.id,
    format: row.format,
    status: row.status,
    filePath: row.file_path,
    patientCount: Number(row.patient_count ?? 0),
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function updateReportWorkflowStatus(db: Database, patientId: string, status: BackendReportStatus): void {
  const timestamp = nowIso();

  run(
    db,
    `INSERT OR IGNORE INTO workflow_status (
      patient_id, preprocess_status, feature_status, prediction_status, explanation_status, report_status, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [patientId, '未开始', '未开始', '未开始', '未生成', status, '', timestamp],
  );
  run(
    db,
    `UPDATE workflow_status
     SET report_status = ?, updated_at = ?
     WHERE patient_id = ?`,
    [status, timestamp, patientId],
  );
}

function buildReportHtml(input: {
  title: string;
  generatedAt: string;
  patient: { subject_code: string; name: string; age: number | null; sex: string; affected_hand: string; diagnosis: string };
  clinical: {
    disease_course: string;
    affected_side_raw: string;
    fma_before: number | null;
    fma_after: number | null;
    mbi_before: number | null;
    mbi_after: number | null;
    mmse: number | null;
  } | null;
  featureCounts: { psd_count: number; fc_count: number; summary_count: number };
  prediction: {
    predicted_class: string;
    probability: number;
    label_definition: string;
    model_name: string;
    model_version: string;
  } | null;
  explanation: {
    topomap: ExplanationArtifact | null;
    connectivity: ExplanationArtifact | null;
    overview: ExplanationArtifact | null;
    topFeatures: ExplanationArtifact['topFeatures'];
  };
}): string {
  const clinicalItems = input.clinical
    ? [
        formatNullableMetric('FMA', input.clinical.fma_before, input.clinical.fma_after),
        formatNullableMetric('MBI', input.clinical.mbi_before, input.clinical.mbi_after),
        formatNullableMetric('MMSE', input.clinical.mmse),
      ]
    : ['未发现临床量表记录'];
  const predictionClass = input.prediction?.predicted_class ?? '未生成预测';
  const predictionProbability = percent(input.prediction?.probability ?? null);
  const modelName = input.prediction
    ? `${input.prediction.model_name} ${input.prediction.model_version}`
    : '-';
  const probabilityValue = input.prediction?.probability ?? null;
  const probabilityWidth = probabilityValue === null ? 0 : Math.max(0, Math.min(100, probabilityValue * 100));
  const clinicalSummary = clinicalItems.map(escapeHtml).join('； ').replace(/-&gt;/g, '->');
  const topFeatureRows = input.explanation.topFeatures.length > 0
    ? input.explanation.topFeatures
        .map(
          (feature, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(feature.name)}</td>
            <td>${escapeHtml(feature.modality || '-')}</td>
            <td>${escapeHtml(Number(feature.score).toFixed(3))}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="empty">解释性特征尚未生成。</td></tr>';
  const figureCard = (artifact: ExplanationArtifact | null, label: string, description: string): string => {
    if (!artifact) {
      return `
        <article class="figure-card empty-figure">
          <div class="figure-label">${escapeHtml(label)}</div>
          <div class="figure-placeholder">待生成</div>
          <p>${escapeHtml(description)}</p>
        </article>`;
    }

    return `
      <article class="figure-card">
        <div class="figure-label">${escapeHtml(label)}</div>
        <img src="${escapeHtml(imageSource(artifact.filePath))}" alt="${escapeHtml(artifact.title)}" />
        <h3>${escapeHtml(artifact.title)}</h3>
        <div class="figure-source">${escapeHtml(path.basename(artifact.filePath))}</div>
        <p>${escapeHtml(description)}</p>
      </article>`;
  };
  const provenanceArtifact = input.explanation.topomap ?? input.explanation.connectivity ?? input.explanation.overview;
  const provenancePreview = provenanceArtifact?.preview ?? {};
  const provenanceBlock = provenanceArtifact
    ? `
      <div class="method-panel">
        <h3>方法与图件来源</h3>
        <p>${escapeHtml(provenanceArtifact.method || '解释性方法信息未记录。')}</p>
        <table class="method-table">
          <tr><th>Target</th><td>${escapeHtml(previewText(provenancePreview, 'target'))}</td></tr>
          <tr><th>Attribution</th><td>Integrated Gradients: ${escapeHtml(previewText(provenancePreview, 'integratedGradientsSteps'))} steps；SmoothGrad: ${escapeHtml(previewText(provenancePreview, 'smoothGradSamples'))} samples；noise std ${escapeHtml(previewText(provenancePreview, 'smoothGradNoiseStd'))}</td></tr>
          <tr><th>Baseline</th><td>${escapeHtml(previewText(provenancePreview, 'baseline'))}</td></tr>
          <tr><th>Scripts</th><td>${escapeHtml(
            [
              previewText(provenancePreview, 'attributionScript'),
              previewText(provenancePreview, 'topomapScript'),
              previewText(provenancePreview, 'connectivityScript'),
            ]
              .filter((item) => item !== '-')
              .join('； ') || '-',
          )}</td></tr>
        </table>
      </div>`
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #172033;
      --muted: #64748b;
      --line: #d8e0ea;
      --panel: #ffffff;
      --soft: #f5f7fb;
      --accent: #0f766e;
      --accent-dark: #115e59;
      --warn: #b45309;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 28px;
      background: #e9eef5;
      color: var(--ink);
      font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
      line-height: 1.58;
    }
    .report-shell {
      max-width: 1120px;
      margin: 0 auto;
      background: var(--panel);
      border: 1px solid #cfd8e5;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.13);
    }
    .cover {
      padding: 30px 34px 28px;
      border-bottom: 1px solid var(--line);
      background: #f8fafc;
    }
    .eyebrow {
      margin: 0 0 8px;
      color: var(--accent-dark);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    h1 { margin: 0; font-size: 28px; line-height: 1.22; }
    h2 {
      margin: 0 0 14px;
      font-size: 18px;
      line-height: 1.3;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line);
    }
    h3 { margin: 10px 0 4px; font-size: 14px; }
    p { margin: 0; }
    .muted { color: var(--muted); font-size: 12px; }
    .cover-grid {
      display: grid;
      grid-template-columns: 1.45fr 0.55fr;
      gap: 24px;
      align-items: end;
      margin-top: 18px;
    }
    .patient-line {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 18px;
      margin-top: 12px;
      color: #334155;
      font-size: 13px;
    }
    .result-card {
      border: 1px solid #b7d7d1;
      background: #f0fdfa;
      padding: 16px;
      min-height: 122px;
    }
    .result-card .label { color: var(--accent-dark); font-size: 12px; font-weight: 700; }
    .result-card .class { margin-top: 6px; font-size: 24px; font-weight: 800; color: #0f513f; }
    .probability-bar {
      height: 9px;
      margin-top: 12px;
      background: #ccfbf1;
      border-radius: 999px;
      overflow: hidden;
    }
    .probability-bar span { display: block; height: 100%; background: var(--accent); }
    .section { padding: 26px 34px; border-bottom: 1px solid var(--line); }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .stat {
      border: 1px solid var(--line);
      background: var(--soft);
      padding: 14px;
      min-height: 86px;
    }
    .stat .value { margin-top: 6px; font-size: 20px; font-weight: 800; }
    table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 13px; }
    th, td { border: 1px solid var(--line); padding: 9px 10px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; width: 184px; color: #334155; }
    .badge {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 999px;
      background: #dcfce7;
      color: #166534;
      font-weight: 700;
    }
    .figure-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .figure-card {
      border: 1px solid var(--line);
      background: #ffffff;
      padding: 12px;
      min-height: 260px;
    }
    .figure-label {
      display: inline-block;
      margin-bottom: 10px;
      padding: 3px 8px;
      background: #e6fffb;
      color: var(--accent-dark);
      font-size: 12px;
      font-weight: 700;
    }
    .figure-card img {
      display: block;
      width: 100%;
      max-height: 390px;
      object-fit: contain;
      border: 1px solid #edf2f7;
      background: #ffffff;
    }
    .figure-card p { color: var(--muted); font-size: 12px; }
    .figure-source {
      margin: 4px 0 8px;
      color: var(--muted);
      font-size: 11px;
      font-family: Consolas, "Courier New", monospace;
      overflow-wrap: anywhere;
    }
    .method-panel {
      margin-top: 16px;
      border: 1px solid var(--line);
      background: #f8fafc;
      padding: 14px;
    }
    .method-panel h3 { margin-top: 0; }
    .method-panel p {
      margin-bottom: 10px;
      color: #334155;
      font-size: 13px;
    }
    .method-table th { width: 132px; }
    .figure-placeholder {
      display: grid;
      place-items: center;
      min-height: 214px;
      border: 1px dashed #cbd5e1;
      background: #f8fafc;
      color: var(--muted);
      font-weight: 700;
    }
    .empty { color: var(--muted); text-align: center; }
    .footer {
      padding: 16px 34px 22px;
      color: var(--muted);
      font-size: 12px;
      background: #f8fafc;
    }
    @media print {
      body { padding: 0; background: #ffffff; }
      .report-shell { max-width: none; border: 0; box-shadow: none; }
      .section { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main class="report-shell">
    <section class="cover">
      <p class="eyebrow">NeuroPredict Clinical EEG Report</p>
      <h1>${escapeHtml(input.title)}</h1>
      <div class="cover-grid">
        <div>
          <div class="muted">生成时间：${escapeHtml(input.generatedAt)}</div>
          <div class="patient-line">
            <span>Subject: <strong>${escapeHtml(input.patient.subject_code)}</strong></span>
            <span>Name: <strong>${escapeHtml(maskPatientName(input.patient.name) || '-')}</strong></span>
            <span>Age/Sex: <strong>${escapeHtml(input.patient.age ?? '-')} / ${escapeHtml(input.patient.sex || '-')}</strong></span>
            <span>Affected: <strong>${escapeHtml(input.patient.affected_hand || '-')}</strong></span>
          </div>
        </div>
        <aside class="result-card">
          <div class="label">预测结论</div>
          <div class="class">${escapeHtml(predictionClass)}</div>
          <div class="muted">PR 概率：${escapeHtml(predictionProbability)}</div>
          <div class="probability-bar"><span style="width: ${probabilityWidth.toFixed(1)}%"></span></div>
        </aside>
      </div>
    </section>

    <section class="section">
      <h2>患者与临床量表</h2>
      <table>
        <tr><th>Diagnosis</th><td>${escapeHtml(input.patient.diagnosis || '-')}</td></tr>
        <tr><th>病程</th><td>${escapeHtml(input.clinical?.disease_course || '-')}</td></tr>
        <tr><th>受累侧</th><td>${escapeHtml(input.clinical?.affected_side_raw || '-')}</td></tr>
        <tr><th>量表</th><td>${clinicalSummary}</td></tr>
      </table>
    </section>

    <section class="section">
      <h2>数据处理与模型输出</h2>
      <div class="stats-grid">
        <div class="stat"><div class="muted">PSD 特征文件</div><div class="value">${input.featureCounts.psd_count}</div></div>
        <div class="stat"><div class="muted">Connectivity 特征文件</div><div class="value">${input.featureCounts.fc_count}</div></div>
        <div class="stat"><div class="muted">模型版本</div><div class="value">${escapeHtml(modelName)}</div></div>
      </div>
      <table>
        <tr><th>特征文件</th><td>PSD: ${input.featureCounts.psd_count}；FC: ${input.featureCounts.fc_count}；Summary: ${input.featureCounts.summary_count}</td></tr>
        <tr><th>标签定义</th><td>${escapeHtml(input.prediction?.label_definition || '比例恢复 (PR) vs 恢复不良')}</td></tr>
        <tr><th>预测类别</th><td><span class="badge">${escapeHtml(predictionClass)}</span></td></tr>
        <tr><th>PR 概率</th><td>${escapeHtml(predictionProbability)}</td></tr>
      </table>
    </section>

    <section class="section">
      <h2>可解释性分析图</h2>
      <div class="figure-grid">
        ${figureCard(input.explanation.topomap, 'EEG Topomap', 'PSD 频段/导联贡献图，用于展示空间分布和关键频段贡献。')}
        ${figureCard(input.explanation.connectivity, 'Connectivity', 'WPLI 功能连接贡献图，用于展示关键脑区连接模式。')}
      </div>
      ${provenanceBlock}
    </section>

    <section class="section">
      <h2>Top Features</h2>
      <table>
        <tr><th style="width: 72px;">Rank</th><th>Feature</th><th>Modality</th><th>Score</th></tr>
        ${topFeatureRows}
      </table>
    </section>

    <footer class="footer">
      本报告用于科研演示与辅助分析，预测结果需结合临床评估、原始 EEG 质量和模型适用范围综合解释。
    </footer>
  </main>
</body>
</html>`;
}

function buildBatchSummaryCsv(input: {
  generatedAt: string;
  title: string;
  rows: Array<{
    patient_id: string;
    subject_code: string;
    name: string;
    affected_hand: string;
    eo_available: number;
    ec_available: number;
    preprocess_status: string;
    feature_status: string;
    prediction_status: string;
    explanation_status: string;
    report_status: string;
    updated_at: string;
    predicted_class: string | null;
    probability: number | null;
    label_definition: string | null;
    model_name: string | null;
    model_version: string | null;
    prediction_updated_at: string | null;
  }>;
}): string {
  const header = [
    'Subject',
    'Name',
    'Affected Hand',
    'EO',
    'EC',
    'Preprocess Status',
    'Feature Status',
    'Prediction Status',
    'Explanation Status',
    'Report Status',
    'Prediction Class',
    'Probability',
    'Model',
    'Label Definition',
    'Updated At',
  ];
  const lines = [
    header.map(escapeCsv).join(','),
    ...input.rows.map((row) => {
      const model = row.model_name ? `${row.model_name} ${row.model_version ?? ''}`.trim() : '-';
      return [
        row.subject_code,
        row.name,
        row.affected_hand,
        row.eo_available === 1 ? 'Y' : 'N',
        row.ec_available === 1 ? 'Y' : 'N',
        row.preprocess_status,
        row.feature_status,
        row.prediction_status,
        row.explanation_status,
        row.report_status,
        row.predicted_class ?? '-',
        csvPercent(row.probability),
        model,
        row.label_definition ?? '-',
        row.prediction_updated_at ?? row.updated_at,
      ].map(escapeCsv).join(',');
    }),
  ];

  return lines.join('\r\n');
}

export function createPatientReport(
  db: Database,
  paths: AppPaths,
  input: ReportExportInput,
): ReportExportResult {
  const patient = queryOne<{
    id: string;
    subject_code: string;
    name: string;
    age: number | null;
    sex: string;
    affected_hand: string;
    diagnosis: string;
  }>(
    db,
    'SELECT id, subject_code, name, age, sex, affected_hand, diagnosis FROM patients WHERE id = ?',
    [input.patientId],
  );

  if (!patient) {
    return { ok: false, message: '无法生成报告：患者不存在。', report: null };
  }

  const generatedAt = nowIso();
  const reportId = randomUUID();
  const format: PatientReportFormat = input.format ?? 'html';
  const title = input.title || 'tACS EEG 康复结局预测报告';
  const fileName = `${patient.subject_code}_${timestampForFilename(generatedAt)}_recovery-report.${format}`;
  const reportDir = path.join(paths.outputsRoot, 'reports', patient.subject_code);
  const filePath = path.join(reportDir, fileName);
  const clinical = queryOne<{
    disease_course: string;
    affected_side_raw: string;
    fma_before: number | null;
    fma_after: number | null;
    mbi_before: number | null;
    mbi_after: number | null;
    mmse: number | null;
  }>(
    db,
    `SELECT disease_course, affected_side_raw, fma_before, fma_after, mbi_before, mbi_after, mmse
     FROM clinical_metrics
     WHERE patient_id = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [input.patientId],
  );
  const featureCounts = queryOne<{ psd_count: number; fc_count: number; summary_count: number }>(
    db,
    `SELECT
      COUNT(CASE WHEN kind = 'PSD' AND exists_on_disk = 1 THEN 1 END) AS psd_count,
      COUNT(CASE WHEN kind = 'FC' AND exists_on_disk = 1 THEN 1 END) AS fc_count,
      COUNT(CASE WHEN kind = 'SUMMARY' AND exists_on_disk = 1 THEN 1 END) AS summary_count
     FROM feature_artifacts
     WHERE patient_id = ?`,
    [input.patientId],
  ) ?? { psd_count: 0, fc_count: 0, summary_count: 0 };
  const prediction = queryOne<{
    predicted_class: string;
    probability: number;
    label_definition: string;
    model_name: string;
    model_version: string;
  }>(
    db,
    `SELECT pr.predicted_class, pr.probability, pr.label_definition, pm.name AS model_name, pm.version AS model_version
     FROM prediction_results pr
     INNER JOIN prediction_models pm ON pm.id = pr.model_id
     WHERE pr.patient_id = ?
     ORDER BY pr.updated_at DESC
     LIMIT 1`,
    [input.patientId],
  );
  const explanationArtifacts = listExplanationArtifacts(db, {
    patientId: input.patientId,
    existsOnDisk: true,
  });
  const taskId = addTask(db, {
    type: 'report_export',
    patientId: input.patientId,
    status: 'running',
    inputJson: JSON.stringify({ displayName: '患者报告导出', format, title }),
  });
  const html = buildReportHtml({
    title,
    generatedAt,
    patient,
    clinical,
    featureCounts,
    prediction,
    explanation: {
      topomap: latestExplanationArtifact(explanationArtifacts, 'psd_heatmap'),
      connectivity: latestExplanationArtifact(explanationArtifacts, 'fc_network'),
      overview: latestExplanationArtifact(explanationArtifacts, 'global_importance'),
      topFeatures: uniqueTopFeatures(explanationArtifacts),
    },
  });

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(filePath, html, 'utf8');
  run(
    db,
    `INSERT INTO patient_reports (
      id, patient_id, task_id, format, status, file_path, generated_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [reportId, input.patientId, taskId, format, '已生成', filePath, generatedAt, generatedAt, generatedAt],
  );
  completeTask(db, taskId, JSON.stringify({ reportId, filePath, format }));
  updateReportWorkflowStatus(db, input.patientId, '已生成');
  addTaskLog(db, {
    taskId,
    patientId: input.patientId,
    level: 'info',
    source: 'report',
    message: `Patient report generated: ${patient.subject_code} ${filePath}`,
  });

  const report = getPatientReport(db, reportId);

  return {
    ok: true,
    message: `已生成患者报告：${filePath}`,
    report,
  };
}

export function listPatientReports(
  db: Database,
  filter: ListPatientReportsFilter = {},
): PatientReport[] {
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (filter.patientId) {
    where.push('r.patient_id = ?');
    params.push(filter.patientId);
  }

  if (filter.status) {
    where.push('r.status = ?');
    params.push(filter.status);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = queryAll<{
    id: string;
    patient_id: string;
    subject_code: string;
    patient_name: string;
    format: PatientReportFormat;
    status: BackendReportStatus;
    file_path: string;
    generated_at: string;
    created_at: string;
    updated_at: string;
  }>(
    db,
    `SELECT r.id, r.patient_id, p.subject_code, p.name AS patient_name, r.format, r.status,
      r.file_path, r.generated_at, r.created_at, r.updated_at
     FROM patient_reports r
     INNER JOIN patients p ON p.id = r.patient_id
     ${whereSql}
     ORDER BY r.generated_at DESC`,
    params,
  );

  return rows.map(reportFromRow);
}

export function getPatientReport(db: Database, reportId: string): PatientReport | null {
  return listPatientReports(db).find((report) => report.id === reportId) ?? null;
}

export function createBatchSummaryReport(
  db: Database,
  paths: AppPaths,
  input: BatchSummaryExportInput = {},
): BatchSummaryExportResult {
  const generatedAt = nowIso();
  const reportId = randomUUID();
  const format: BatchSummaryReportFormat = input.format ?? 'csv';
  const title = input.title || 'tACS EEG 康复结局批次汇总';
  const reportDir = path.join(paths.outputsRoot, 'reports', 'batch');
  const filePath = path.join(reportDir, `batch-summary-${timestampForFilename(generatedAt)}.${format}`);
  const rows = queryAll<{
    patient_id: string;
    subject_code: string;
    name: string;
    affected_hand: string;
    eo_available: number;
    ec_available: number;
    preprocess_status: string;
    feature_status: string;
    prediction_status: string;
    explanation_status: string;
    report_status: string;
    updated_at: string;
    predicted_class: string | null;
    probability: number | null;
    label_definition: string | null;
    model_name: string | null;
    model_version: string | null;
    prediction_updated_at: string | null;
  }>(
    db,
    `SELECT
      p.id AS patient_id,
      p.subject_code,
      p.name,
      p.affected_hand,
      COALESCE(MAX(CASE WHEN ef.condition = 'EO' AND ef.exists_on_disk = 1 THEN 1 ELSE 0 END), 0) AS eo_available,
      COALESCE(MAX(CASE WHEN ef.condition = 'EC' AND ef.exists_on_disk = 1 THEN 1 ELSE 0 END), 0) AS ec_available,
      COALESCE(ws.preprocess_status, '未开始') AS preprocess_status,
      COALESCE(ws.feature_status, '未开始') AS feature_status,
      COALESCE(ws.prediction_status, '未开始') AS prediction_status,
      COALESCE(ws.explanation_status, '未生成') AS explanation_status,
      COALESCE(ws.report_status, '未生成') AS report_status,
      COALESCE(ws.updated_at, p.updated_at) AS updated_at,
      (
        SELECT pr.predicted_class
        FROM prediction_results pr
        WHERE pr.patient_id = p.id
        ORDER BY pr.updated_at DESC
        LIMIT 1
      ) AS predicted_class,
      (
        SELECT pr.probability
        FROM prediction_results pr
        WHERE pr.patient_id = p.id
        ORDER BY pr.updated_at DESC
        LIMIT 1
      ) AS probability,
      (
        SELECT pr.label_definition
        FROM prediction_results pr
        WHERE pr.patient_id = p.id
        ORDER BY pr.updated_at DESC
        LIMIT 1
      ) AS label_definition,
      (
        SELECT pm.name
        FROM prediction_results pr
        INNER JOIN prediction_models pm ON pm.id = pr.model_id
        WHERE pr.patient_id = p.id
        ORDER BY pr.updated_at DESC
        LIMIT 1
      ) AS model_name,
      (
        SELECT pm.version
        FROM prediction_results pr
        INNER JOIN prediction_models pm ON pm.id = pr.model_id
        WHERE pr.patient_id = p.id
        ORDER BY pr.updated_at DESC
        LIMIT 1
      ) AS model_version,
      (
        SELECT pr.updated_at
        FROM prediction_results pr
        WHERE pr.patient_id = p.id
        ORDER BY pr.updated_at DESC
        LIMIT 1
      ) AS prediction_updated_at
     FROM patients p
     LEFT JOIN workflow_status ws ON ws.patient_id = p.id
     LEFT JOIN eeg_files ef ON ef.patient_id = p.id
     GROUP BY p.id, p.subject_code, p.name, p.affected_hand, ws.preprocess_status, ws.feature_status,
      ws.prediction_status, ws.explanation_status, ws.report_status, ws.updated_at, p.updated_at
     ORDER BY p.subject_code`,
  );
  const taskId = addTask(db, {
    type: 'report_export',
    status: 'running',
    inputJson: JSON.stringify({ displayName: '批次汇总导出', format, title }),
  });
  const csv = buildBatchSummaryCsv({ generatedAt, title, rows });

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
  run(
    db,
    `INSERT INTO batch_reports (
      id, task_id, format, status, file_path, patient_count, generated_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [reportId, taskId, format, '已生成', filePath, rows.length, generatedAt, generatedAt, generatedAt],
  );
  completeTask(db, taskId, JSON.stringify({ reportId, filePath, format, patientCount: rows.length }));
  addTaskLog(db, {
    taskId,
    level: 'info',
    source: 'report',
    message: `Batch summary generated: ${rows.length} patients ${filePath}`,
  });

  return {
    ok: true,
    message: `已生成批次汇总：${filePath}`,
    report: getBatchSummaryReport(db, reportId),
  };
}

export function listBatchSummaryReports(
  db: Database,
  filter: ListBatchSummaryReportsFilter = {},
): BatchSummaryReport[] {
  const params: SqlParam[] = [];
  const where = filter.status ? 'WHERE status = ?' : '';

  if (filter.status) {
    params.push(filter.status);
  }

  const rows = queryAll<{
    id: string;
    format: BatchSummaryReportFormat;
    status: BackendReportStatus;
    file_path: string;
    patient_count: number;
    generated_at: string;
    created_at: string;
    updated_at: string;
  }>(
    db,
    `SELECT id, format, status, file_path, patient_count, generated_at, created_at, updated_at
     FROM batch_reports
     ${where}
     ORDER BY generated_at DESC`,
    params,
  );

  return rows.map(batchReportFromRow);
}

export function getBatchSummaryReport(db: Database, reportId: string): BatchSummaryReport | null {
  return listBatchSummaryReports(db).find((report) => report.id === reportId) ?? null;
}
