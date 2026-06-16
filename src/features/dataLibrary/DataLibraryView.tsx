import React from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Database,
  FolderOpen,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import type {
  ClinicalMetrics,
  DataAsset,
  DataCompleteness,
  DataLibraryStatus,
  DataLibrarySummaryRow,
  PatientDocumentDetail,
} from '../../domain/backendTypes';

interface DataLibraryViewProps {
  status: DataLibraryStatus | null;
  summaries: DataLibrarySummaryRow[];
  selectedDetail: PatientDocumentDetail | null;
  rootPath: string;
  message: string;
  busyAction: 'scan' | 'index' | 'backup' | 'existing' | null;
  onRootPathChange: (rootPath: string) => void;
  onSelectRootDirectory: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onScanAndImport: (rootPath: string) => Promise<void>;
  onUpdateIndex: (rootPath: string) => Promise<void>;
  onBackupDocuments: (rootPath: string) => Promise<void>;
  onOpenBackupDirectory: () => Promise<void>;
  onSelectPatient: (patientId: string | null) => Promise<void>;
  onDeletePatient?: (patientId: string) => Promise<void>;
  onClearWorkspaceData?: () => Promise<void>;
}

const emptyCounts = {
  indexedFiles: 0,
  missingFiles: 0,
  backedUpDocuments: 0,
  manualReviewItems: 0,
};

const orderedStages = ['基线', '即时', '阶段', '最终'] as const;
type OrderedStage = (typeof orderedStages)[number];
type StageFilter = OrderedStage | 'all';

const detailPanelDefaultWidth = 360;
const detailPanelMinWidth = 260;
const detailPanelMaxWidth = 640;
const detailPanelResizeStep = 24;
type ResizeInputMode = 'mouse' | 'pointer';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function booleanLabel(value: boolean): string {
  return value ? 'Y' : 'N';
}

function formatMetric(name: string, before: number | string | null, after?: number | string | null): string | null {
  if (before === null || before === '') return null;
  if (after === undefined || after === null || after === '') return `${name} ${before}`;
  return `${name} ${before} -> ${after}`;
}

function maskPatientName(name: string | null | undefined): string {
  const chars = Array.from(String(name ?? '').trim());
  return chars.length > 0 ? `${chars[0]}${'*'.repeat(Math.max(0, chars.length - 1))}` : '';
}

function formatAssetType(assetType: DataAsset['assetType']): string {
  const labels: Record<DataAsset['assetType'], string> = {
    raw_eeg_cnt: '原始 CNT',
    processed_eeg_set: 'SET',
    processed_eeg_fdt: 'FDT',
    clinical_excel: '临床表',
    record_pdf: '记录 PDF',
    completeness_workbook: '完整性表',
    electrode_location: '电极坐标',
    channel_file: '通道文件',
    archive: '归档包',
  };
  return labels[assetType] ?? assetType;
}

function cohortLabel(cohort: DataLibrarySummaryRow['cohort']): string {
  if (cohort === 'patient') return '患者';
  if (cohort === 'health') return '健康人';
  return '项目';
}

function matchStatusLabel(matchStatus: DataLibrarySummaryRow['matchStatus']): string {
  if (matchStatus === 'matched') return '已匹配';
  if (matchStatus === 'needs_review') return '需复核';
  return '未匹配';
}

function matchStatusClass(matchStatus: DataLibrarySummaryRow['matchStatus']): string {
  if (matchStatus === 'matched') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (matchStatus === 'needs_review') return 'bg-yellow-50 text-yellow-700 border-yellow-200';
  return 'bg-rose-50 text-rose-700 border-rose-200';
}

function stageRank(stage: string): number {
  const index = orderedStages.findIndex((item) => item === stage);
  return index >= 0 ? index : orderedStages.length;
}

function summaryHasStageData(row: DataLibrarySummaryRow, stage: OrderedStage): boolean {
  if (stage === '基线') return row.baselineRawCount > 0 || row.baselineProcessedPairs > 0;
  if (stage === '即时') return row.immediateProcessedPairs > 0;
  if (stage === '阶段') return row.phaseProcessedPairs > 0;
  return row.finalProcessedPairs > 0;
}

function summaryFirstStageRank(row: DataLibrarySummaryRow): number {
  const firstStage = orderedStages.find((stage) => summaryHasStageData(row, stage));
  return firstStage ? stageRank(firstStage) : orderedStages.length;
}

function compareSummaryRows(left: DataLibrarySummaryRow, right: DataLibrarySummaryRow): number {
  return (
    summaryFirstStageRank(left) - summaryFirstStageRank(right) ||
    left.subjectCode.localeCompare(right.subjectCode, 'zh-CN') ||
    (left.patientId ?? '').localeCompare(right.patientId ?? '', 'zh-CN')
  );
}

function compareAssetsByStage(left: DataAsset, right: DataAsset): number {
  return (
    stageRank(left.stage) - stageRank(right.stage) ||
    formatAssetType(left.assetType).localeCompare(formatAssetType(right.assetType), 'zh-CN') ||
    left.filePath.localeCompare(right.filePath, 'zh-CN')
  );
}

function compareCompletenessByStage(left: DataCompleteness, right: DataCompleteness): number {
  return (
    stageRank(left.stage) - stageRank(right.stage) ||
    left.task.localeCompare(right.task, 'zh-CN') ||
    left.subjectCode.localeCompare(right.subjectCode, 'zh-CN')
  );
}

function stageMatchesFilter(stage: string, stageFilter: StageFilter): boolean {
  return stageFilter === 'all' || stage === stageFilter;
}

function DataLibraryMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border border-slate-200 rounded px-3 py-2">
      <div className="text-[10px] text-slate-500 uppercase">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function DataLibraryStatusPill({ status }: { status: DataLibrarySummaryRow['matchStatus'] }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium ${matchStatusClass(status)}`}>
      {matchStatusLabel(status)}
    </span>
  );
}

function DetailClinicalMetrics({ metrics }: { metrics: ClinicalMetrics | null }) {
  const metricItems = metrics
    ? [
        formatMetric('FMA', metrics.fmaBefore, metrics.fmaAfter),
        formatMetric('MBI', metrics.mbiBefore, metrics.mbiAfter),
        formatMetric('BBT', metrics.bbtBefore, metrics.bbtAfter),
        formatMetric('MMSE', metrics.mmse),
      ].filter(Boolean)
    : [];

  if (!metrics || metricItems.length === 0) {
    return <div className="text-xs text-slate-500">未发现可用临床量表。</div>;
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {metricItems.map((item) => (
        <div key={item} className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs font-medium text-slate-800">
          {item}
        </div>
      ))}
    </div>
  );
}

function DetailWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5">暂无警告。</div>;
  }

  return (
    <ul className="space-y-1">
      {warnings.map((warning) => (
        <li key={warning} className="flex items-start gap-2 text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded px-2 py-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{warning}</span>
        </li>
      ))}
    </ul>
  );
}

function DetailAssets({ assets, stageFilter }: { assets: DataAsset[]; stageFilter: StageFilter }) {
  const visibleAssets = assets
    .filter((asset) => stageMatchesFilter(asset.stage, stageFilter))
    .sort(compareAssetsByStage);

  if (visibleAssets.length === 0) {
    return <div className="text-xs text-slate-500">暂无资产记录。</div>;
  }

  return (
    <ul className="space-y-1">
      {visibleAssets.map((asset) => (
        <li
          key={asset.id}
          data-testid="detail-asset-row"
          className="flex items-center justify-between gap-3 text-xs border border-slate-200 rounded px-2 py-1.5 bg-white"
        >
          <span className="font-medium text-slate-700">{formatAssetType(asset.assetType)}</span>
          <span data-testid="detail-asset-stage" className="text-slate-500 truncate">{asset.stage}</span>
          <span className={asset.existsOnDisk ? 'text-emerald-700' : 'text-rose-700'}>
            {asset.existsOnDisk ? '存在' : '缺失'}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DetailCompleteness({ completeness, stageFilter }: { completeness: DataCompleteness[]; stageFilter: StageFilter }) {
  const visibleCompleteness = completeness
    .filter((item) => stageMatchesFilter(item.stage, stageFilter))
    .sort(compareCompletenessByStage);

  if (visibleCompleteness.length === 0) {
    return <div className="text-xs text-slate-500">暂无完整性记录。</div>;
  }

  return (
    <ul className="space-y-1">
      {visibleCompleteness.map((item) => (
        <li
          key={`${item.subjectCode}-${item.stage}-${item.task}`}
          data-testid="detail-completeness-row"
          className="grid grid-cols-[1fr_auto] gap-2 text-xs border border-slate-200 rounded px-2 py-1.5 bg-white"
        >
          <span data-testid="detail-completeness-stage" className="text-slate-700">
            {item.stage} / {item.task}
          </span>
          <span className="font-mono text-slate-500">
            CNT {item.rawCntCount} SET {item.processedSetCount} FDT {item.processedFdtCount}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DetailPanel({ detail, width, stageFilter }: { detail: PatientDocumentDetail | null; width: number; stageFilter: StageFilter }) {
  if (!detail) {
    return (
      <aside
        data-testid="data-library-detail-panel"
        className="bg-slate-50 border-l border-slate-200 p-4 overflow-y-auto shrink-0"
        style={{ width }}
      >
        <div className="h-full flex items-center justify-center text-center text-sm text-slate-500">
          选择患者行后查看临床量表、文档资产与完整性检查。
        </div>
      </aside>
    );
  }

  const title = detail.patient?.subjectCode ?? detail.clinicalMetrics?.patientId ?? '患者详情';
  const subtitle = maskPatientName(detail.patient?.name) || '已匹配资料';

  return (
    <aside
      data-testid="data-library-detail-panel"
      className="bg-slate-50 border-l border-slate-200 overflow-y-auto shrink-0"
      style={{ width }}
    >
      <div className="bg-white border-b border-slate-200 px-4 py-3">
        <div className="text-xs text-slate-500">详情面板</div>
        <div className="text-base font-semibold text-slate-900">{title}</div>
        <div className="text-xs text-slate-500">{subtitle}</div>
      </div>

      <div className="p-4 space-y-4">
        <section>
          <h2 className="text-xs font-semibold text-slate-700 mb-2">Clinical Metrics</h2>
          <DetailClinicalMetrics metrics={detail.clinicalMetrics} />
        </section>

        <section>
          <h2 className="text-xs font-semibold text-slate-700 mb-2">Warnings</h2>
          <DetailWarnings warnings={detail.warnings} />
        </section>

        <section>
          <h2 className="text-xs font-semibold text-slate-700 mb-2">Assets</h2>
          <DetailAssets assets={detail.assets} stageFilter={stageFilter} />
        </section>

        <section>
          <h2 className="text-xs font-semibold text-slate-700 mb-2">Completeness</h2>
          <DetailCompleteness completeness={detail.completeness} stageFilter={stageFilter} />
        </section>
      </div>
    </aside>
  );
}

export function DataLibraryView({
  status,
  summaries,
  selectedDetail,
  rootPath,
  message,
  busyAction,
  onRootPathChange,
  onSelectRootDirectory,
  onRefresh,
  onScanAndImport,
  onUpdateIndex,
  onBackupDocuments,
  onOpenBackupDirectory,
  onSelectPatient,
  onDeletePatient,
  onClearWorkspaceData,
}: DataLibraryViewProps) {
  const counts = status ?? emptyCounts;
  const displayMessage = status?.lastScanMessage || '';
  const isLongActionBusy = Boolean(busyAction);
  const [detailPanelWidth, setDetailPanelWidth] = React.useState(detailPanelDefaultWidth);
  const [stageFilter, setStageFilter] = React.useState<StageFilter>('all');
  const detailResizeRef = React.useRef<{ startX: number; startWidth: number; mode: ResizeInputMode } | null>(null);
  const visibleSummaries = React.useMemo(
    () =>
      summaries
        .filter((row) => stageFilter === 'all' || summaryHasStageData(row, stageFilter))
        .sort(compareSummaryRows),
    [stageFilter, summaries],
  );

  React.useEffect(() => {
    const applyResize = (clientX: number) => {
      const resizeState = detailResizeRef.current;

      if (!resizeState) return;

      setDetailPanelWidth(
        clamp(
          resizeState.startWidth + resizeState.startX - clientX,
          detailPanelMinWidth,
          detailPanelMaxWidth,
        ),
      );
    };

    const endResize = () => {
      detailResizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (detailResizeRef.current?.mode !== 'mouse') return;
      applyResize(event.clientX);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (detailResizeRef.current?.mode !== 'pointer') return;
      applyResize(event.clientX);
    };
    const handleMouseUp = () => {
      if (detailResizeRef.current?.mode === 'mouse') endResize();
    };
    const handlePointerUp = () => {
      if (detailResizeRef.current?.mode === 'pointer') endResize();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  const startDetailResize = (
    event: React.MouseEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>,
    mode: ResizeInputMode,
  ) => {
    event.preventDefault();
    if (mode === 'pointer' && typeof (event as React.PointerEvent<HTMLDivElement>).pointerId !== 'number') return;
    if (mode === 'mouse' && detailResizeRef.current?.mode === 'pointer') return;
    detailResizeRef.current = {
      startX: event.clientX,
      startWidth: detailPanelWidth,
      mode,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleDetailResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setDetailPanelWidth((current) => clamp(current + detailPanelResizeStep, detailPanelMinWidth, detailPanelMaxWidth));
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setDetailPanelWidth((current) => clamp(current - detailPanelResizeStep, detailPanelMinWidth, detailPanelMaxWidth));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setDetailPanelWidth(detailPanelMinWidth);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setDetailPanelWidth(detailPanelMaxWidth);
    }
  };

  return (
    <div className="flex-1 flex h-full bg-slate-50 overflow-hidden">
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="bg-white px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
                <Database className="text-blue-600" size={24} />
                <span>数据与文档库</span>
              </h1>
              <p className="text-sm text-slate-500 mt-1">统一检查患者、健康人和项目级 EEG 文件与临床文档。</p>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw size={15} />
              刷新
            </button>
            <button
              type="button"
              onClick={onClearWorkspaceData}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-rose-200 rounded text-sm font-medium text-rose-700 hover:bg-rose-50"
            >
              <XCircle size={15} />
              清空数据与文档库
            </button>
          </div>
        </div>

        <div className="bg-white px-6 py-3 border-b border-slate-200 shrink-0 overflow-x-auto">
          <div className="flex items-center gap-2 min-w-max">
            <button
              type="button"
              onClick={onSelectRootDirectory}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <FolderOpen size={15} />
              选择数据根目录
            </button>
            <input
              value={rootPath}
              onChange={(event) => onRootPathChange(event.target.value)}
              className="w-72 px-2.5 py-1.5 border border-slate-300 rounded text-xs font-mono text-slate-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              aria-label="数据根目录"
            />
            <button
              type="button"
              onClick={() => onScanAndImport(rootPath)}
              disabled={isLongActionBusy}
              className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Database size={15} />
              {busyAction === 'scan' ? '扫描中...' : '扫描并批量导入'}
            </button>
            <button
              type="button"
              onClick={() => onUpdateIndex(rootPath)}
              disabled={isLongActionBusy}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCw size={15} />
              {busyAction === 'index' ? '更新中...' : '仅更新索引'}
            </button>
            <button
              type="button"
              onClick={() => onBackupDocuments(rootPath)}
              disabled={isLongActionBusy}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Archive size={15} />
              {busyAction === 'backup' ? '备份中...' : '备份患者资料'}
            </button>
            <button
              type="button"
              onClick={onOpenBackupDirectory}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <FolderOpen size={15} />
              打开备份目录
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 px-6 py-3 shrink-0">
          <DataLibraryMetric label="Indexed" value={counts.indexedFiles} />
          <DataLibraryMetric label="Missing" value={counts.missingFiles} />
          <DataLibraryMetric label="Backed Up" value={counts.backedUpDocuments} />
          <DataLibraryMetric label="Manual Review" value={counts.manualReviewItems} />
        </div>

        <div className="mx-6 mb-3 min-h-7 shrink-0">
          {displayMessage ? (
            <div className="text-xs text-slate-700 bg-white border border-slate-200 rounded px-3 py-1.5">{displayMessage}</div>
          ) : (
            <div className="text-xs text-slate-400 bg-white border border-slate-200 rounded px-3 py-1.5">等待数据与文档库操作。</div>
          )}
        </div>

        <div className="mx-6 mb-3 flex flex-wrap items-center gap-2 shrink-0">
          <span className="text-xs font-medium text-slate-500">阶段筛选</span>
          {(['all', ...orderedStages] as StageFilter[]).map((stage) => {
            const active = stageFilter === stage;
            const label = stage === 'all' ? '全部' : stage;
            const ariaLabel = stage === 'all'
              ? '显示全部阶段数据'
              : stage === '阶段'
                ? '筛选阶段数据'
                : `筛选${stage}阶段数据`;

            return (
              <button
                key={stage}
                type="button"
                aria-label={ariaLabel}
                onClick={() => setStageFilter(stage)}
                className={`rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-auto px-6 pb-6">
          <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
            <table className="w-full text-left text-xs text-slate-600 whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2">Subject</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Cohort</th>
                  <th className="px-3 py-2">Clinical</th>
                  <th className="px-3 py-2">Record PDF</th>
                  <th className="px-3 py-2">Baseline Raw</th>
                  <th className="px-3 py-2">Baseline Pairs</th>
                  <th className="px-3 py-2">Immediate</th>
                  <th className="px-3 py-2">Phase</th>
                  <th className="px-3 py-2">Final</th>
                  <th className="px-3 py-2">Issues</th>
                  <th className="px-3 py-2">Match</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {visibleSummaries.map((row) => {
                  const canSelect = Boolean(row.patientId);
                  return (
                    <tr
                      key={`${row.cohort}-${row.subjectCode}-${row.patientId ?? 'project'}`}
                      className={canSelect ? 'hover:bg-blue-50/40 transition-colors' : 'hover:bg-slate-50/60 transition-colors'}
                      onClick={() => onSelectPatient(row.patientId)}
                    >
                      <td className="px-3 py-2 font-medium text-slate-900">{row.subjectCode}</td>
                      <td className="px-3 py-2">{maskPatientName(row.subjectName) || '-'}</td>
                      <td className="px-3 py-2">{cohortLabel(row.cohort)}</td>
                      <td className="px-3 py-2">{booleanLabel(row.hasClinicalInfo)}</td>
                      <td className="px-3 py-2">{booleanLabel(row.hasRecordPdf)}</td>
                      <td className="px-3 py-2 font-mono">{row.baselineRawCount}</td>
                      <td className="px-3 py-2 font-mono">{row.baselineProcessedPairs}</td>
                      <td className="px-3 py-2 font-mono">{row.immediateProcessedPairs}</td>
                      <td className="px-3 py-2 font-mono">{row.phaseProcessedPairs}</td>
                      <td className="px-3 py-2 font-mono">{row.finalProcessedPairs}</td>
                      <td className={row.issueCount > 0 ? 'px-3 py-2 font-mono text-yellow-700' : 'px-3 py-2 font-mono text-slate-500'}>
                        {row.issueCount}
                      </td>
                      <td className="px-3 py-2">
                        <DataLibraryStatusPill status={row.matchStatus} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canSelect ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onSelectPatient(row.patientId);
                              }}
                              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium"
                            >
                              <CheckCircle2 size={13} />
                              查看 {row.subjectCode} 详情
                            </button>
                            <button
                              type="button"
                              aria-label={`删除患者 ${row.subjectCode}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (row.patientId) {
                                  onDeletePatient?.(row.patientId);
                                }
                              }}
                              className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-800 font-medium"
                            >
                              <XCircle size={13} />
                              删除
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visibleSummaries.length === 0 && (
                  <tr>
                    <td className="px-3 py-8 text-center text-slate-500" colSpan={13}>
                      {stageFilter === 'all' ? '暂无索引记录。选择数据根目录后执行扫描。' : '当前阶段暂无索引记录。'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      <div
        role="separator"
        aria-label="调整患者详情面板宽度"
        aria-orientation="vertical"
        aria-valuemin={detailPanelMinWidth}
        aria-valuemax={detailPanelMaxWidth}
        aria-valuenow={detailPanelWidth}
        tabIndex={0}
        onPointerDown={(event) => startDetailResize(event, 'pointer')}
        onMouseDown={(event) => startDetailResize(event, 'mouse')}
        onKeyDown={handleDetailResizeKeyDown}
        onDoubleClick={() => setDetailPanelWidth(detailPanelDefaultWidth)}
        className="group relative w-3 shrink-0 cursor-col-resize bg-slate-100/80 transition-colors hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
      >
        <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-slate-300 transition-colors group-hover:bg-blue-500 group-focus:bg-blue-500" />
        <span className="absolute left-1/2 top-1/2 h-12 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300/70 transition-colors group-hover:bg-blue-500 group-focus:bg-blue-500" />
      </div>
      <DetailPanel detail={selectedDetail} width={detailPanelWidth} stageFilter={stageFilter} />
    </div>
  );
}
