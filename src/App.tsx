// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import { 
  Users, Database, Activity, Brain, Archive, Box, PlayCircle, 
  BarChart2, FileText, Settings, Terminal, CheckCircle2, Clock, 
  AlertCircle, Search, Filter, MoreHorizontal, Download, 
  Minus, Square, X, FolderOpen, HardDrive, Cpu, AlertTriangle,
  Play, FilePlus, XCircle, RefreshCw, FileCheck, PanelRight,
  ChevronRight, Pause, Settings2, MonitorPlay, Lock, Link, 
  Check, FileLineChart, TrendingUp, Info, Award
} from 'lucide-react';
import { DataLibraryView } from './features/dataLibrary/DataLibraryView';
import {
  backupClinicalDocuments,
  clearWorkspaceData,
  createBatchSummaryReport,
  completePreprocessManualStep,
  createExplainabilityBatch,
  createFeatureGenerationBatch,
  createPatientReport,
  getDataLibraryStatus,
  getPatientDocumentDetail,
  getSettings,
  getWorkbenchData,
  importPatientsCsv,
  deletePatient,
  indexExistingExplanationResults,
  indexExistingFeatureResults,
  listExplanationArtifacts,
  listExplanationOverview,
  listFeatureArtifacts,
  listPatientReports,
  listPatientAssetSummary,
  listFeatureOverview,
  listPredictionModels,
  listPredictionQueue,
  launchPreprocessManualStep,
  openBackupDirectory,
  deleteExplanationArtifact,
  openExplanationArtifact,
  openFeatureArtifact,
  openPatientReport,
  preparePreprocessMatlabExecution,
  retryTask,
  runExplainabilityExecution,
  runBatchPrediction,
  runFeatureGenerationExecution,
  runPredictionExecution,
  runPreprocessMatlabExecution,
  saveExistingPredictionResult,
  scanAndImportDataLibrary,
  scanEegFolder,
  selectDataLibraryRoot,
  startPreprocessing,
  updateDataAssetIndex,
  updateSettings,
} from './services/apiClient';

// --- Mock Data ---
// 统一将“右侧”和“左侧”更新为更精准的临床描述：“右肢不利”与“左肢不利”
const MOCK_PATIENTS = [
  { id: 'sub01', hand: '右肢不利 (LH)', eo: true, ec: true, preStatus: '已完成', featStatus: 'PSD/FC 已完成', task: 'tACS_Outcome', predict: '比例恢复', prob: 0.88, report: '已生成' },
  { id: 'sub02', hand: '左肢不利 (RH)', eo: true, ec: true, preStatus: '已完成', featStatus: 'PSD/FC 已完成', task: 'tACS_Outcome', predict: '恢复不良', prob: 0.92, report: '已生成' },
  { id: 'sub03', hand: '右肢不利 (LH)', eo: true, ec: true, preStatus: '已完成', featStatus: 'PSD/FC 已完成', task: 'tACS_Outcome', predict: '比例恢复', prob: 0.75, report: '已生成' },
  { id: 'sub04', hand: '左肢不利 (RH)', eo: true, ec: true, preStatus: '等待坏段检查', featStatus: '未开始', task: 'tACS_Outcome', predict: '-', prob: null, report: '-' },
  { id: 'sub05', hand: '左肢不利 (RH)', eo: true, ec: true, preStatus: '等待坏段检查', featStatus: '未开始', task: 'tACS_Outcome', predict: '-', prob: null, report: '-' },
  { id: 'sub06', hand: '右肢不利 (LH)', eo: true, ec: true, preStatus: '已完成', featStatus: 'PSD/FC 已完成', task: 'tACS_Outcome', predict: '比例恢复', prob: 0.81, report: '未生成' },
  { id: 'sub07', hand: '右肢不利 (LH)', eo: true, ec: true, preStatus: '已完成', featStatus: 'FC 失败', task: 'tACS_Outcome', predict: '-', prob: null, report: '-' },
  { id: 'sub08', hand: '左肢不利 (RH)', eo: true, ec: false, preStatus: '暂停 (缺数据)', featStatus: '-', task: '-', predict: '-', prob: null, report: '-' },
  { id: 'sub09', hand: '右肢不利 (LH)', eo: true, ec: true, preStatus: '已完成', featStatus: '提取中...', task: 'tACS_Outcome', predict: '-', prob: null, report: '-' },
  { id: 'sub10', hand: '左肢不利 (RH)', eo: true, ec: true, preStatus: '已完成', featStatus: 'PSD/FC 已完成', task: 'tACS_Outcome', predict: '恢复不良', prob: 0.85, report: '未生成' },
  { id: 'sub11', hand: '右肢不利 (LH)', eo: false, ec: true, preStatus: '暂停 (缺数据)', featStatus: '-', task: '-', predict: '-', prob: null, report: '-' },
  { id: 'sub12', hand: '左肢不利 (RH)', eo: true, ec: true, preStatus: '预处理中...', featStatus: '未开始', task: 'tACS_Outcome', predict: '-', prob: null, report: '-' },
  { id: 'sub13', hand: '右肢不利 (LH)', eo: true, ec: true, preStatus: '已完成', featStatus: 'PSD/FC 已完成', task: 'tACS_Outcome', predict: '比例恢复', prob: 0.94, report: '已生成' },
  { id: 'sub14', hand: '左肢不利 (RH)', eo: true, ec: true, preStatus: '等待坏段检查', featStatus: '未开始', task: 'tACS_Outcome', predict: '-', prob: null, report: '-' },
  { id: 'sub15', hand: '右肢不利 (LH)', eo: true, ec: true, preStatus: '已完成', featStatus: 'PSD/FC 已完成', task: 'tACS_Outcome', predict: '比例恢复', prob: 0.68, report: '未生成' },
  { id: 'sub16', hand: '左肢不利 (RH)', eo: true, ec: true, preStatus: '已完成', featStatus: 'PSD/FC 已完成', task: 'tACS_Outcome', predict: '恢复不良', prob: 0.79, report: '已生成' },
];

const MOCK_TASKS = {
  queued: [],
  running: [
    { id: 1, patient: 'sub01', name: 'LIME 解释性图表生成', progress: 85, time: '01:12' }
  ],
  manual: [
    { id: 2, patient: 'sub05', name: 'EEGLAB 坏段手动剔除', action: '打开 EEGLAB' }
  ],
  failed: [
    { id: 3, patient: 'sub07', name: 'wPLI 矩阵计算异常 (OOM)', action: '降低内存重试' }
  ]
};

const MOCK_LOGS = [
  "[INFO] 10:00:15 - 初始化环境: Project='2026_tACS_MultiCenter'",
  "[INFO] 10:00:18 - 加载预训练模型: SVM_RBF_v2_optimal.mdl",
  "[WARN] 10:01:05 - sub08 扫描目录未发现 EC (Eyes Closed) 数据.",
  "[INFO] 10:02:10 - sub01 预处理完成, 开始提取 PSD/FC 特征...",
  "[INFO] 10:05:33 - sub05 预处理暂停, 已启动 EEGLAB 等待人工剔除坏段.",
  "[ERR]  10:08:12 - sub07 FC 计算失败: Out of memory during wPLI tensor allocation.",
  "[INFO] 10:10:00 - sub01 预测完成, 结局: 比例恢复 (Prob=0.88)."
];

const DEFAULT_SETTINGS = {
  dataRoot: '',
  outputRoot: 'F:\\NeuroPredict\\outputs',
  matlabExecutable: '',
  eeglabPath: '',
  defaultElectrodeLocationFile: '',
  pythonExecutable: '',
  featureGeneratorScript: '',
  predictionScript: '',
  explainabilityScript: '',
  modelLibraryRoot: '',
  defaultDownsampleRate: '500',
  defaultHighPassHz: '1',
  defaultLowPassHz: '45',
  defaultNotchHz: '50',
};

const RIGHT_PANEL_DEFAULT_WIDTH = 320;
const RIGHT_PANEL_MIN_WIDTH = 280;
const RIGHT_PANEL_MAX_WIDTH = 680;
const RIGHT_PANEL_RESIZE_STEP = 24;

function clampPanelWidth(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const NAV_ITEMS = [
  { id: 'workbench', label: '患者工作台', icon: Users },
  { id: 'dataLibrary', label: '数据与文档库', icon: Database },
  { id: 'preprocess', label: 'EEG 预处理向导', icon: Activity },
  { id: 'feature', label: '特征生成与查看', icon: Brain },
  { id: 'archive', label: '特征档案库', icon: Archive },
  { id: 'models', label: '模型库', icon: Box },
  { id: 'predict', label: '批量预测', icon: PlayCircle },
  { id: 'interpret', label: '模型解释性', icon: BarChart2 },
  { id: 'report', label: '报告导出', icon: FileText },
  { id: 'settings', label: '环境设置', icon: Settings },
];

// --- Sub-components ---

const TitleBar = ({ isRightPanelOpen, setIsRightPanelOpen }) => (
  <div className="h-8 bg-slate-900 flex items-center justify-between px-3 select-none text-slate-400 border-b border-slate-800 shrink-0">
    <div className="flex items-center space-x-2">
      <Brain size={14} className="text-blue-400" />
      <span className="text-xs font-medium text-slate-300">NeuroPredict: tACS EEG 康复结局预测系统 v1.2.0</span>
    </div>
    <div className="flex items-center space-x-3 text-slate-400">
      <button 
        onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
        className={`hover:text-white transition-colors flex items-center ${isRightPanelOpen ? 'text-blue-400' : ''}`}
        title={isRightPanelOpen ? "收起侧边面板" : "展开侧边面板"}
      >
        <PanelRight size={14} />
      </button>
      <div className="w-px h-3 bg-slate-700 mx-1"></div>
      <Minus size={14} className="hover:text-white cursor-pointer" />
      <Square size={12} className="hover:text-white cursor-pointer" />
      <X size={14} className="hover:text-red-400 cursor-pointer" />
    </div>
  </div>
);

const DATA_LIBRARY_EMPTY_COUNTS = {
  indexedFiles: 0,
  missingFiles: 0,
  backedUpDocuments: 0,
  manualReviewItems: 0,
};

const DataLibraryTopStatusBar = ({ rootPath, status }) => {
  const counts = status ?? DATA_LIBRARY_EMPTY_COUNTS;

  return (
    <div
      data-testid="data-library-top-status-bar"
      className="bg-slate-800 px-6 py-2 text-xs text-slate-200 border-b border-slate-700 shrink-0"
    >
      <div className="flex items-center gap-5 overflow-x-auto">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <FolderOpen size={14} className="text-blue-400" />
          <span className="text-slate-400">源目录</span>
          <span className="font-mono text-white">{rootPath}</span>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <FileCheck size={14} className="text-emerald-400" />
          <span className="text-slate-400">索引/缺失/备份/复核</span>
          <span className="font-mono text-white">
            {counts.indexedFiles} / {counts.missingFiles} / {counts.backedUpDocuments} / {counts.manualReviewItems}
          </span>
        </div>
      </div>
    </div>
  );
};

const Sidebar = ({ activeTab, setActiveTab }) => (
  <div className="w-56 bg-slate-800 text-slate-300 flex flex-col h-full border-r border-slate-700 shrink-0">
    <div className="p-4">
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">核心工作流</div>
      <div className="space-y-1">
        {NAV_ITEMS.slice(0, 7).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center space-x-3 px-3 py-2 text-sm rounded-md transition-colors ${
                activeTab === item.id ? 'bg-blue-600 text-white shadow-sm' : 'hover:bg-slate-700 hover:text-white'
              }`}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
    
    <div className="p-4 mt-auto">
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">分析与设置</div>
      <div className="space-y-1">
        {NAV_ITEMS.slice(7).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center space-x-3 px-3 py-2 text-sm rounded-md transition-colors ${
                activeTab === item.id ? 'bg-blue-600 text-white shadow-sm' : 'hover:bg-slate-700 hover:text-white'
              }`}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  </div>
);

const RightPanel = ({
  onClose,
  tasks = MOCK_TASKS,
  logs = MOCK_LOGS,
  width = RIGHT_PANEL_DEFAULT_WIDTH,
  onCompleteManualTask,
  onLaunchManualTask,
}) => {
  const [tab, setTab] = useState('tasks');
  const manualTasks = tasks.manual ?? [];
  const taskCount = manualTasks.length;
  const manualCompletionLabel = (task) => {
    const taskText = `${task?.name ?? ''} ${task?.action ?? ''}`;
    if (taskText.includes('ICA') || taskText.includes('伪迹')) {
      return '完成伪迹并自动保存';
    }
    return '完成坏段并自动保存';
  };
  const manualFileBadgeClass = (condition) => {
    if (condition === 'EO') return 'border-blue-200 bg-blue-50 text-blue-700';
    if (condition === 'EC') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    return 'border-slate-200 bg-slate-50 text-slate-600';
  };
  const getLogLevel = (log) => {
    if (typeof log === 'string') {
      if (log.includes('[WARN]')) return 'warning';
      if (log.includes('[ERR]')) return 'error';
      return 'info';
    }
    if (!log || typeof log !== 'object') return 'info';
    if (log.level === 'warning' || log.level === 'warn') return 'warning';
    if (log.level === 'error') return 'error';
    return 'info';
  };
  const getLogText = (log) => {
    if (typeof log === 'string') return log;
    const level = getLogLevel(log);
    const fallback = level === 'error' ? '[ERR] 日志内容不可用' : level === 'warning' ? '[WARN] 日志内容不可用' : '[INFO] 日志内容不可用';
    if (!log || typeof log !== 'object') return fallback;
    return typeof log.text === 'string' && log.text.length > 0 ? log.text : fallback;
  };
  const getLogClass = (log) => {
    const level = getLogLevel(log);
    if (level === 'warning') return 'text-yellow-400';
    if (level === 'error') return 'text-red-400';
    return 'text-slate-300';
  };

  return (
    <div
      data-testid="right-task-panel"
      className="bg-slate-50 border-l border-slate-200 flex flex-col h-full shrink-0 transition-all duration-300 ease-in-out"
      style={{ width }}
    >
      <div className="flex border-b border-slate-200 bg-white items-center">
        <button 
          onClick={() => setTab('tasks')}
          className={`flex-1 py-2 text-sm font-medium flex items-center justify-center space-x-2 ${tab === 'tasks' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:bg-slate-50'}`}
        >
          <Activity size={14} />
          <span>人工任务 ({taskCount})</span>
        </button>
        <button 
          onClick={() => setTab('logs')}
          className={`flex-1 py-2 text-sm font-medium flex items-center justify-center space-x-2 ${tab === 'logs' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:bg-slate-50'}`}
        >
          <Terminal size={14} />
          <span>引擎日志</span>
        </button>
        <button 
          onClick={onClose}
          className="px-3 py-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 border-l border-slate-200"
          title="收起"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col bg-slate-50/50">
        {tab === 'tasks' ? (
          <div className="p-3 space-y-4 overflow-y-auto h-full">
            <div>
              <div className="text-xs font-semibold text-yellow-600 mb-2 flex items-center"><AlertTriangle size={12} className="mr-1"/> 等待人工处理患者 ({manualTasks.length})</div>
              {manualTasks.map(task => (
                <div key={task.id} className="bg-yellow-50 p-3 border border-yellow-200 rounded shadow-sm">
                  <div className="text-sm font-medium text-slate-800 mb-2">
                    <span className="text-yellow-700 mr-1">[{task.patient}]</span>
                    {task.name}
                  </div>
                  <div className="mb-2 rounded border border-yellow-200 bg-white/70 px-2 py-1.5 text-xs text-yellow-800">
                    {task.action}
                  </div>
                  {Array.isArray(task.manualFiles) && task.manualFiles.length > 0 && (
                    <div className="mb-2 space-y-1">
                      {task.manualFiles.map((file) => (
                        <div
                          key={`${file.condition}-${file.stageFileName}`}
                          className="flex min-w-0 items-center gap-1.5 text-[11px]"
                        >
                          <span className={`shrink-0 rounded border px-1.5 py-0.5 font-medium ${manualFileBadgeClass(file.condition)}`}>
                            {file.label} {file.condition}
                          </span>
                          <span className="min-w-0 truncate font-mono text-slate-700" title={file.stageFileName}>
                            {file.stageFileName}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => onLaunchManualTask?.(task.id)}
                    className="mb-2 w-full inline-flex justify-center items-center gap-1 py-1.5 bg-yellow-500 border border-yellow-500 text-white rounded text-xs font-medium hover:bg-yellow-600 transition-colors"
                  >
                    <MonitorPlay size={12} />
                    打开 EEGLAB
                  </button>
                  <button
                    onClick={() => onCompleteManualTask?.(task.id)}
                    className="w-full inline-flex justify-center items-center gap-1 py-1.5 bg-white border border-yellow-300 text-yellow-700 rounded text-xs font-medium hover:bg-yellow-100 transition-colors"
                  >
                    <Check size={12} />
                    {manualCompletionLabel(task)}
                  </button>
                </div>
              ))}
              {manualTasks.length === 0 && (
                <div className="rounded border border-dashed border-slate-300 bg-white px-3 py-8 text-center text-xs text-slate-500">
                  暂无待人工处理的患者。
                </div>
              )}
            </div>

          </div>
        ) : (
          <div className="flex-1 bg-slate-900 p-2 overflow-y-auto font-mono text-xs">
            <div className="space-y-1">
              {logs.map((log, idx) => (
                <div key={log?.id ?? idx} className={`leading-relaxed ${getLogClass(log)}`}>
                  {getLogText(log)}
                </div>
              ))}
              <div className="text-blue-400 animate-pulse mt-2">_</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Advanced Status Badge Component
const StatusBadge = ({ text }) => {
  if (text === '-') return <span className="text-slate-400">-</span>;
  
  let styleClass = 'bg-slate-100 text-slate-600 border-slate-200';
  let icon = null;

  if (text.includes('完成') || text.includes('生成')) {
    styleClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    icon = <CheckCircle2 size={12} className="mr-1" />;
  } else if (text.includes('等待') || text.includes('人工') || text.includes('未跑模型')) {
    styleClass = 'bg-yellow-50 text-yellow-700 border-yellow-200';
    icon = <AlertTriangle size={12} className="mr-1" />;
  } else if (text.includes('失败') || text.includes('缺少') || text.includes('缺数据')) {
    styleClass = 'bg-rose-50 text-rose-700 border-rose-200';
    icon = <XCircle size={12} className="mr-1" />;
  } else if (text.includes('比例恢复')) {
    styleClass = 'bg-blue-50 text-blue-700 border-blue-200';
  } else if (text.includes('恢复不良')) {
    styleClass = 'bg-indigo-50 text-indigo-700 border-indigo-200';
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium border rounded ${styleClass}`}>
      {icon}
      {text}
    </span>
  );
};

const FileStatus = ({ status, label }) => (
  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono border mr-1 ${status ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
    {status ? <CheckCircle2 size={10} className="mr-1"/> : <X size={10} className="mr-1"/>}
    {label}
  </span>
);

const PatientWorkbench = ({
  patients = MOCK_PATIENTS,
  dataRoot = 'D:\\Research\\Stroke_tACS_EEG_Data',
  onImportPatients,
  onScanEegFolder,
  onExportBatchSummary,
  onDeletePatient,
  onClearWorkspaceData,
  backendMessage,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(patients.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const currentPatients = patients.slice((safeCurrentPage - 1) * pageSize, safeCurrentPage * pageSize);
  const startIndex = patients.length === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const endIndex = Math.min(safeCurrentPage * pageSize, patients.length);

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden">
      <div className="bg-slate-800 px-6 py-2 flex items-center space-x-6 text-xs text-slate-300 shrink-0 border-b border-slate-700">
        <div className="flex items-center space-x-2 whitespace-nowrap">
          <FolderOpen size={14} className="text-blue-400 shrink-0" />
          <span>当前项目: <strong className="text-white">脑卒中基线 EEG-tACS 康复预测队列</strong></span>
        </div>
        <div className="flex items-center space-x-2 whitespace-nowrap">
          <HardDrive size={14} className="text-slate-400 shrink-0" />
          <span>数据目录: {dataRoot}</span>
        </div>
      </div>

      <div className="bg-white px-6 py-3 border-b border-slate-200 flex justify-between items-center shrink-0 overflow-x-auto">
        <div className="flex space-x-2">
          <button onClick={onImportPatients} className="flex items-center space-x-2 px-3 py-1.5 bg-white border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
            <FilePlus size={16} /><span>导入患者表</span>
          </button>
          <button onClick={onScanEegFolder} className="flex items-center space-x-2 px-3 py-1.5 bg-white border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
            <FolderOpen size={16} /><span>添加基线 EEG 文件夹</span>
          </button>
          <button
            onClick={onClearWorkspaceData}
            className="flex items-center space-x-2 px-3 py-1.5 bg-white border border-rose-200 rounded text-sm font-medium text-rose-700 hover:bg-rose-50 transition-colors"
          >
            <XCircle size={16} /><span>清空患者工作台</span>
          </button>
          {backendMessage && (
            <div className="flex items-center text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2">
              {backendMessage}
            </div>
          )}
        </div>
        <div className="flex space-x-3">
          <button onClick={onExportBatchSummary} className="flex items-center space-x-2 px-3 py-1.5 bg-white border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
            <Download size={16} /><span>导出批次汇总</span>
          </button>
          <button className="flex items-center space-x-2 px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm">
            <Play size={16} /><span>批量运行队列</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3 px-6 py-3 shrink-0">
        {[
          { label: '患者总数', value: patients.length.toString(), icon: Users, color: 'text-slate-600', bg: 'bg-slate-100' },
          { label: '预处理完成', value: patients.filter(p => p.preStatus === '已完成').length.toString(), icon: Activity, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: '特征已生成', value: patients.filter(p => p.featStatus?.includes('完成')).length.toString(), icon: Brain, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: '预测完成', value: patients.filter(p => p.predict !== '-').length.toString(), icon: FileCheck, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: '等待人工确认', value: patients.filter(p => p.preStatus?.includes('等待')).length.toString(), icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-50' },
        ].map((stat, idx) => {
          const IconComponent = stat.icon;
          return (
            <div key={idx} className="bg-white px-3 py-2.5 border border-slate-200 rounded shadow-sm flex items-center space-x-3">
              <div className={`p-2 rounded-md ${stat.bg} ${stat.color}`}>
                <IconComponent size={18} />
              </div>
              <div>
                <div className="text-slate-600 text-xs font-medium mb-0.5">{stat.label}</div>
                <div className="text-base font-bold text-slate-800 leading-none">{stat.value}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex-1 px-6 pb-5 overflow-hidden flex flex-col">
        <div className="bg-white border border-slate-200 rounded shadow-sm flex-1 flex flex-col overflow-hidden">
          <div className="p-2 border-b border-slate-200 flex justify-between items-center bg-slate-50/50 shrink-0">
            <div className="flex items-center space-x-2 px-1">
              <span className="text-sm font-medium text-slate-700">患者队列</span>
              <span className="text-[10px] text-slate-400">基线 EEG → 预处理 → 特征 → 比例恢复预测</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1.5 text-slate-400" />
                <input type="text" placeholder="搜索 sub01..." className="pl-8 pr-3 py-1 border border-slate-300 rounded text-xs w-48 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
              </div>
              <button className="p-1 border border-slate-300 rounded text-slate-600 hover:bg-slate-100" title="筛选"><Filter size={14} /></button>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left text-sm text-slate-600 whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-4 py-2 w-10"><input type="checkbox" className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" /></th>
                  <th className="px-4 py-2">患者 ID</th>
                  <th className="px-4 py-2">不利侧</th>
                  <th className="px-4 py-2">EEG 文件</th>
                  <th className="px-4 py-2">预处理状态</th>
                  <th className="px-4 py-2">特征状态</th>
                  <th className="px-4 py-2">标签任务</th>
                  <th className="px-4 py-2">预测类别</th>
                  <th className="px-4 py-2">解释/报告</th>
                  <th className="px-4 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {currentPatients.map((patient) => (
                  <tr key={patient.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-2.5"><input type="checkbox" className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" /></td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{patient.id}</td>
                    <td className="px-4 py-2.5 text-xs">{patient.hand}</td>
                    <td className="px-4 py-2.5">
                      <FileStatus status={patient.eo} label="EO" />
                      <FileStatus status={patient.ec} label="EC" />
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge text={patient.preStatus} /></td>
                    <td className="px-4 py-2.5"><StatusBadge text={patient.featStatus} /></td>
                    <td className="px-4 py-2.5 text-xs font-mono text-slate-500">{patient.task}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center space-x-1">
                        <StatusBadge text={patient.predict} />
                        {patient.prob && <span className="text-[10px] text-slate-400 font-mono">{(patient.prob * 100).toFixed(0)}%</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge text={patient.report} /></td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        aria-label={`删除患者 ${patient.id}`}
                        onClick={() => onDeletePatient?.(patient.patientId ?? patient.id)}
                        className="inline-flex items-center space-x-1 px-2 py-1 text-xs font-medium text-rose-600 border border-rose-100 rounded hover:bg-rose-50 transition-colors"
                      >
                        <XCircle size={13} />
                        <span>删除</span>
                      </button>
                    </td>
                  </tr>
                ))}
                {currentPatients.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-400">
                      暂无患者数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-200 p-3 bg-white flex items-center justify-between text-xs text-slate-500 shrink-0 z-20">
            <span>显示 {startIndex} 到 {endIndex} 条，共 {patients.length} 条记录</span>
            <div className="flex space-x-2">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safeCurrentPage === 1} className="px-3 py-1.5 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">上一页</button>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safeCurrentPage === totalPages} className="px-3 py-1.5 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">下一页</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// 只包含“比例恢复”的核心任务定义
const PREDICT_TASKS = [
  { id: 'pr', name: '比例恢复 (PR) vs 恢复不良', desc: '基于静息态 EEG 的 PSD 与 WPLI 特征预测患者是否达到比例恢复。' }
];

const PREDICT_MODELS = [
  {
    id: 'm2',
    taskId: 'pr',
    name: 'ResidualAware_SSL_CNN',
    version: 'locked_10seed_final',
    inputType: 'EEG-only',
    inputs: 'PSD, WPLI, EO, EC',
    loso: 'Acc 84.7% · ROC-AUC 0.887',
    status: '当前版本',
    accuracy: 0.8474,
    rocAuc: 0.8867,
  },
];

const PREDICT_QUEUE_MOCK = [
  { id: 'sub01', hasEEG: true, hasClinical: true, predict: '比例恢复', prob: 0.88, modelUsed: 'ResidualAware_SSL_CNN locked_10seed_final', expStatus: '已生成' },
  { id: 'sub02', hasEEG: true, hasClinical: true, predict: '恢复不良', prob: 0.92, modelUsed: 'ResidualAware_SSL_CNN locked_10seed_final', expStatus: '已生成' },
  { id: 'sub03', hasEEG: true, hasClinical: false, predict: '未跑模型', prob: null, modelUsed: '-', expStatus: '-' },
  { id: 'sub04', hasEEG: false, hasClinical: true, predict: '-', prob: null, modelUsed: '-', expStatus: '-' }, // No features
  { id: 'sub06', hasEEG: true, hasClinical: true, predict: '比例恢复', prob: 0.81, modelUsed: 'ResidualAware_SSL_CNN locked_10seed_final', expStatus: '未生成' },
];

const maskPatientName = (name) => {
  const normalized = String(name ?? '').trim();
  const chars = Array.from(normalized);
  return chars.length > 0 ? `${chars[0]}${'*'.repeat(Math.max(0, chars.length - 1))}` : '';
};

const isFinalPredictionModel = (model) =>
  model?.taskId === 'pr' && (model?.name === 'ResidualAware_SSL_CNN' || model?.id === 'm2');

const formatPredictionModelSummary = (model) => {
  if (typeof model?.accuracy === 'number' && typeof model?.rocAuc === 'number') {
    return `Acc ${(model.accuracy * 100).toFixed(1)}% · ROC-AUC ${model.rocAuc.toFixed(3)}`;
  }

  return model?.loso || model?.validation || '最终锁定模型';
};

const BatchPredictView = ({
  models = [],
  queueRows = [],
  onRunBatchPrediction,
  busy = false,
}) => {
  const [selectedTask, setSelectedTask] = useState('pr');
  const [selectedModel, setSelectedModel] = useState('m2');

  const rawModelRows = models.length > 0
    ? models.map((model) => ({
        ...model,
        inputs: Array.isArray(model.inputs) ? model.inputs.join(', ') : model.inputs,
        loso: formatPredictionModelSummary(model),
      }))
    : PREDICT_MODELS;
  const modelRows = rawModelRows.filter(isFinalPredictionModel);
  const predictionRows = queueRows.length > 0
    ? queueRows.map((row) => ({
        id: row.subjectCode,
        backendPatientId: row.patientId,
        patientName: maskPatientName(row.patientName),
        hasEEG: row.hasEegFeatures,
        hasClinical: row.hasClinical,
        predict: row.prediction ?? '未跑模型',
        prob: row.probability,
        modelUsed: row.modelUsed,
        expStatus: row.explanationStatus,
      }))
    : PREDICT_QUEUE_MOCK;
  const availableModels = modelRows.filter(m => m.taskId === selectedTask);
  const currentModelData = availableModels.find(m => m.id === selectedModel);
  const canPredictPatient = (patient) => {
    const isMissingClinical = currentModelData?.inputType === 'EEG+Clinical' && !patient.hasClinical;
    return patient.hasEEG && !isMissingClinical && availableModels.length > 0;
  };
  const readyPatients = predictionRows.filter(canPredictPatient);

  // If task changes and no models available, reset model selection
  React.useEffect(() => {
    if (availableModels.length > 0 && !availableModels.find(m => m.id === selectedModel)) {
      setSelectedModel(availableModels[0].id);
    }
  }, [availableModels, selectedModel]);

  const handleStartBatchPrediction = async () => {
    if (!onRunBatchPrediction || readyPatients.length === 0 || !selectedModel) return;

    await onRunBatchPrediction({
      taskId: selectedTask,
      modelId: selectedModel,
      patientIds: readyPatients.map((patient) => patient.backendPatientId ?? patient.id),
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden relative">
      
      {/* Top Banner */}
      <div className="bg-white px-6 py-4 border-b border-slate-200 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 flex items-center space-x-2">
            <PlayCircle className="text-blue-600" size={24} />
            <span>批量预测控制台</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">选择预测任务，系统将强制匹配相兼容的模型进行推理。</p>
        </div>
        <div className="flex items-center space-x-3 text-sm text-slate-600">
          <div className="flex items-center space-x-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-md border border-emerald-200 font-medium">
            <Cpu size={16} />
            <span>推理引擎就绪</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col space-y-6">
        
        {/* Task & Model Binding Section */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          
          <div className="bg-slate-800 px-4 py-2.5 flex items-center justify-between text-white">
            <div className="flex items-center space-x-2">
              <Lock size={14} className="text-slate-400" />
              <span className="text-sm font-medium">标签定义与模型选择</span>
            </div>
            <span className="text-xs text-slate-400">第一版暂不开放重新训练模型</span>
          </div>
          
          <div className="p-6 grid grid-cols-[1fr_80px_1fr] items-center gap-4 relative">

            {/* Left: Task Selection (Only Single Task Remaining) */}
            <div>
              <div className="text-sm font-semibold text-slate-700 mb-3 flex items-center space-x-2">
                <span className="bg-blue-100 text-blue-700 w-5 h-5 rounded-full flex items-center justify-center text-xs">1</span>
                <span>目标标签定义 (Task/Label)</span>
              </div>
              <div className="space-y-3">
                {PREDICT_TASKS.map(task => (
                  <div 
                    key={task.id} 
                    className="flex items-start p-4 border rounded-lg bg-blue-50/40 border-blue-300 ring-1 ring-blue-100 shadow-sm"
                  >
                    <div className="mt-1 flex items-center justify-center shrink-0 w-4 h-4 rounded-full bg-blue-600 text-white shadow-sm">
                      <Check size={10} strokeWidth={3} />
                    </div>
                    <div className="ml-3">
                      <div className="text-sm font-semibold text-blue-950">{task.name}</div>
                      <div className="text-xs text-slate-500 mt-1 leading-relaxed">{task.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Center: Neural Connection Bridge */}
            <div className="flex flex-col items-center justify-center h-full relative select-none">
              {/* Glowing connecting lines inside an SVG */}
              <svg className="w-full h-16 absolute top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 80 60" preserveAspectRatio="none">
                {/* Upper curve */}
                <path d="M 0 30 Q 40 5, 80 30" fill="none" stroke="url(#connectGrad)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />
                {/* Center curve */}
                <path d="M 0 30 L 80 30" fill="none" stroke="url(#connectGrad)" strokeWidth="2.5" />
                {/* Lower curve */}
                <path d="M 0 30 Q 40 55, 80 30" fill="none" stroke="url(#connectGrad)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />
                
                <defs>
                  <linearGradient id="connectGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#3b82f6" />
                    <stop offset="50%" stopColor="#6366f1" />
                    <stop offset="100%" stopColor="#4f46e5" />
                  </linearGradient>
                </defs>
              </svg>

              {/* Locked Indicator Badge */}
              <div className="z-10 flex flex-col items-center justify-center bg-gradient-to-b from-white to-slate-50 border border-slate-200 rounded-full w-12 h-12 shadow-[0_4px_10px_rgba(0,0,0,0.06)] hover:scale-105 hover:border-indigo-400 transition-all duration-300 ring-4 ring-slate-100/80">
                <Lock size={15} className="text-indigo-600 animate-pulse" />
                <span className="text-[8px] font-bold text-indigo-500 mt-0.5 tracking-wider uppercase">Strict</span>
              </div>
            </div>

            {/* Right: Model Selection */}
            <div>
              <div className="text-sm font-semibold text-slate-700 mb-3 flex items-center space-x-2">
                <span className="bg-blue-100 text-blue-700 w-5 h-5 rounded-full flex items-center justify-center text-xs">2</span>
                <span>匹配可用模型 (Available Models)</span>
              </div>
              
              {availableModels.length === 0 ? (
                <div className="h-[120px] bg-rose-50 border border-rose-200 rounded-lg flex flex-col items-center justify-center text-rose-600 p-4 text-center">
                  <AlertCircle size={24} className="mb-2 opacity-80" />
                  <span className="text-sm font-medium">该标签定义暂无可用模型</span>
                  <span className="text-xs mt-1 opacity-80">无法在未提供匹配模型的情况下执行预测。</span>
                </div>
              ) : (
                <div className="space-y-3">
                  {availableModels.map(model => (
                    <label 
                      key={model.id} 
                      className={`block p-3.5 border rounded-lg cursor-pointer transition-all ${selectedModel === model.id ? 'bg-indigo-50/50 border-indigo-400 ring-1 ring-indigo-400 shadow-sm' : 'bg-white border-slate-200 hover:border-indigo-300'}`}
                    >
                      <div className="flex items-start">
                        <input 
                          type="radio" 
                          name="model" 
                          className="mt-1 text-indigo-600 focus:ring-indigo-500" 
                          checked={selectedModel === model.id}
                          onChange={() => setSelectedModel(model.id)}
                        />
                        <div className="ml-3 flex-1">
                          <div className="flex justify-between items-center mb-1">
                            <div className={`text-sm font-semibold ${selectedModel === model.id ? 'text-indigo-800' : 'text-slate-700'}`}>{model.name}</div>
                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-mono border border-slate-200">{model.version}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 mt-2 text-[11px] text-slate-500">
                            <div>
                              <span className="text-slate-400 block mb-0.5">要求输入:</span>
                              <span className={`font-medium ${model.inputType === 'EEG+Clinical' ? 'text-emerald-600' : 'text-blue-600'}`}>{model.inputType}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 block mb-0.5">特征详情:</span>
                              <span className="truncate block" title={model.inputs}>{model.inputs}</span>
                            </div>
                            <div className="col-span-2 mt-1">
                              <span className="text-slate-400 mr-1">模型摘要:</span>
                              <span className="font-mono text-slate-600">{model.loso}</span>
                            </div>
                            <div className="col-span-2">
                              <span className="inline-flex items-center rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 border border-indigo-100">
                                最终锁定模型
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Prediction Queue & Results Table */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col flex-1 overflow-hidden min-h-[300px]">
          <div className="p-3 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
            <h3 className="text-sm font-semibold text-slate-700">患者预测队列</h3>
            <div className="flex space-x-2">
              <button className="flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                <FileLineChart size={14} />
                <span>生成报告 (PDF)</span>
              </button>
              <button className="flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                <Download size={14} />
                <span>导出 CSV</span>
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left text-sm text-slate-600 whitespace-nowrap">
              <thead className="bg-white text-slate-500 font-medium border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-4 py-3">患者 ID</th>
                  <th className="px-4 py-3">数据就绪度</th>
                  <th className="px-4 py-3">当前标签任务</th>
                  <th className="px-4 py-3">预测类别</th>
                  <th className="px-4 py-3">PR 概率 (Prob)</th>
                  <th className="px-4 py-3">执行模型版本</th>
                  <th className="px-4 py-3">解释性报告</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {predictionRows.map((patient) => {
                  const isMissingClinical = currentModelData?.inputType === 'EEG+Clinical' && !patient.hasClinical;
                  const canPredict = canPredictPatient(patient);

                  return (
                    <tr key={patient.id} className={`hover:bg-slate-50/50 transition-colors ${!canPredict ? 'bg-slate-50/30' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{patient.id}</div>
                        {patient.patientName && <div className="mt-1 text-xs text-slate-500">{patient.patientName}</div>}
                      </td>
                      <td className="px-4 py-3 flex space-x-1">
                        <FileStatus status={patient.hasEEG} label="EEG 特征" />
                        <FileStatus status={patient.hasClinical} label="临床基线" />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 font-mono">
                        {PREDICT_TASKS.find(t=>t.id===selectedTask)?.name || '-'}
                      </td>
                      <td className="px-4 py-3">
                        {!canPredict ? (
                           <span className="text-xs text-rose-500 flex items-center"><XCircle size={12} className="mr-1"/> 缺数据, 跳过</span>
                        ) : (
                          <StatusBadge text={patient.predict} />
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {patient.prob ? (patient.prob * 100).toFixed(1) + '%' : '-'}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-500">
                        {patient.modelUsed}
                      </td>
                      <td className="px-4 py-3">
                        {patient.expStatus === '已生成' ? (
                          <span className="flex items-center text-emerald-600 text-xs font-medium"><Check size={14} className="mr-1"/> 就绪</span>
                        ) : (
                          <span className="text-slate-400 text-xs">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="p-1 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors" disabled={!canPredict}>
                          <MoreHorizontal size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Footer Actions */}
      <div className="bg-white border-t border-slate-200 p-4 shrink-0 flex items-center justify-between shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
        <div className="text-sm text-slate-500">
          即将对队列中 <span className="font-semibold text-slate-800">{readyPatients.length}</span> 名就绪患者执行批量预测。
        </div>
        <button 
          disabled={availableModels.length === 0 || readyPatients.length === 0 || busy}
          onClick={handleStartBatchPrediction}
          className="px-8 py-2.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 shadow-sm flex items-center space-x-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Play size={16} />
          <span>{busy ? '创建预测任务中...' : '开始批量预测'}</span>
        </button>
      </div>

    </div>
  );
};

// --- EEG Constants ---
const EEG_CHANNELS = [
  'Fp1', 'Fp2', 'F3', 'F4', 'C3', 'C4', 'P3', 'P4', 'O1', 'O2', 'F7', 'F8', 'T7', 'T8', 'P7', 'P8', 
  'Fz', 'Cz', 'Pz', 'Oz', 'FC1', 'FC2', 'CP1', 'CP2', 'FC5', 'FC6', 'CP5', 'CP6', 'TP9', 'TP10', 'POz', 
  'F1', 'F2', 'C1', 'C2', 'P1', 'P2', 'AF3', 'AF4', 'FC3', 'FC4', 'CP3', 'CP4', 'PO3', 'PO4', 'F5', 'F6', 
  'C5', 'C6', 'P5', 'P6', 'AF7', 'AF8', 'FT7', 'FT8', 'TP7', 'TP8', 'PO7', 'PO8', 'Fpz', 'CPz', 'Nd', 'M1', 'M2'
];
const AUX_CHANNELS = ['HEO', 'VEO', 'EKG', 'EMG'];

const PREPROCESS_STEPS = [
  { id: 1, title: '导入原始数据 (cnt/set)', type: 'auto', desc: '读取批量原始脑电文件' },
  { id: 2, title: '导入电极定位', type: 'auto', desc: '匹配 64 导国际 10-20 系统标准定位' },
  { id: 3, title: '移除空电极/辅助通道', type: 'semi-auto', desc: '选择并丢弃无需分析的非脑电通道' },
  { id: 4, title: '降采样率', type: 'auto', desc: '统一降低采样率以减少计算量' },
  { id: 5, title: '滤波 (Filter)', type: 'auto', desc: '高低通与陷波去工频干扰' },
  { id: 6, title: '人工去除坏段', type: 'manual', desc: '肉眼排查并剔除大面积运动伪影' },
  { id: 7, title: '独立成分分析 (ICA)', type: 'semi-auto', desc: '插值坏导并分解独立成分' },
  { id: 8, title: '人工去除伪迹 (ICA)', type: 'manual', desc: '依据地貌图剔除眼电/肌电成分' },
  { id: 9, title: '重参考与保存', type: 'auto', desc: '平均参考或双侧乳突参考' },
];

const normalizePreprocessChannel = (channel) => {
  const value = String(channel).trim();
  const canonical = ['M1', 'M2', 'HEO', 'VEO', 'EKG', 'EMG'].find(
    (name) => name.toLowerCase() === value.toLowerCase(),
  );
  return canonical ?? value;
};

const toPreprocessNumber = (value, fallback) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const PreprocessWizard = ({
  patientIds,
  patients,
  manualTasks = [],
  queuedTasks = [],
  outputRoot = '',
  onCreatePreprocessTasks,
  onLaunchManualTask,
  onCompleteManualTask,
  onRunMatlabTask,
}) => {
  const [currentStep, setCurrentStep] = useState(3); // 默认展示第3步，方便演示
  const [validationMessage, setValidationMessage] = useState('');
  const [manualStepBusy, setManualStepBusy] = useState('');
  const [selectedPatientIds, setSelectedPatientIds] = useState([]);
  const [config, setConfig] = useState({
    removedChannels: ['HEO', 'VEO', 'EKG', 'EMG'], // 默认移除辅助通道
    downsample: 500,
    highpass: 1,
    lowpass: 45,
    notch: 50,
    icaStrategy: 'interpolate', // 'direct' or 'interpolate'
    badChannels: [],
    reference: 'average', // 'average' or 'm1m2'
  });
  const preprocessPatients = (Array.isArray(patients) && patients.length > 0
    ? patients
    : (patientIds ?? []).map((id) => ({ id, patientId: id, hand: '-', eo: false, ec: false, preStatus: '-' }))
  ).map((patient) => ({
    subjectCode: String(patient.id ?? patient.subjectCode ?? patient.patientId ?? ''),
    backendPatientId: String(patient.patientId ?? patient.id ?? ''),
    hand: patient.hand ?? '-',
    eo: Boolean(patient.eo),
    ec: Boolean(patient.ec),
    preStatus: patient.preStatus ?? '-',
  })).filter((patient) => patient.backendPatientId);
  const selectablePatientIds = preprocessPatients.map((patient) => patient.backendPatientId);
  const patientSelectionKey = selectablePatientIds.join('|');
  const selectedPreprocessPatients = preprocessPatients.filter((patient) =>
    selectedPatientIds.includes(patient.backendPatientId),
  );
  const allPreprocessPatientsSelected =
    selectablePatientIds.length > 0 && selectablePatientIds.every((patientId) => selectedPatientIds.includes(patientId));
  const selectedPatientLabels = new Set(
    selectedPreprocessPatients.flatMap((patient) => [patient.subjectCode, patient.backendPatientId]),
  );
  const currentManualTask = (currentStep === 6 || currentStep === 8)
    ? (manualTasks ?? []).find((task) => {
      const taskType = task?.type ?? 'preprocess';
      const taskPatient = String(task?.patient ?? '');
      const taskText = `${task?.name ?? ''} ${task?.action ?? ''}`;
      const matchesPatient = selectedPatientLabels.size === 0 || selectedPatientLabels.has(taskPatient);
      const matchesStep = currentStep === 6
        ? taskText.includes('坏段')
        : taskText.includes('ICA') || taskText.includes('伪迹');

      return taskType === 'preprocess' && matchesPatient && matchesStep;
    }) ?? null
    : null;
  const currentQueuedPreprocessTask = (currentStep === 7 || currentStep === 9)
    ? (queuedTasks ?? []).find((task) => {
      const taskType = task?.type ?? 'preprocess';
      const taskPatient = String(task?.patient ?? '');
      const taskText = `${task?.name ?? ''} ${task?.action ?? ''}`;
      const matchesPatient = selectedPatientLabels.size === 0 || selectedPatientLabels.has(taskPatient);
      const matchesStep = currentStep === 7
        ? taskText.includes('ICA') || taskText.includes('坏导插值')
        : taskText.includes('重参考') || taskText.includes('最终保存');

      return taskType === 'preprocess' && matchesPatient && matchesStep;
    }) ?? null
    : null;
  const outputPathLabel = outputRoot?.trim() || '软件输出目录\\preprocess';

  useEffect(() => {
    setSelectedPatientIds((current) => {
      const stillAvailable = current.filter((patientId) => selectablePatientIds.includes(patientId));

      if (stillAvailable.length > 0) {
        return stillAvailable;
      }

      return selectablePatientIds;
    });
  }, [patientSelectionKey]);

  const handleToggleChannel = (channel, type) => {
    setValidationMessage('');
    let list = type === 'remove' ? config.removedChannels : config.badChannels;
    if (list.includes(channel)) {
      list = list.filter(c => c !== channel);
    } else {
      list = [...list, channel];
    }
    setConfig({ ...config, [type === 'remove' ? 'removedChannels' : 'badChannels']: list });
  };

  const handleTogglePatient = (patientId) => {
    setSelectedPatientIds((current) =>
      current.includes(patientId)
        ? current.filter((item) => item !== patientId)
        : [...current, patientId],
    );
  };

  const handleSelectAllPatients = () => {
    setSelectedPatientIds(allPreprocessPatientsSelected ? [] : selectablePatientIds);
  };

  const isM1M2Removed = config.removedChannels.includes('M1') || config.removedChannels.includes('M2');

  const buildPreprocessBatchRequest = () => {
    const selectedEmptyChannels = config.removedChannels.map(normalizePreprocessChannel);
    const selectedBadChannels = config.badChannels.map(normalizePreprocessChannel);
    if (config.reference === 'm1m2' && (selectedEmptyChannels.includes('M1') || selectedEmptyChannels.includes('M2'))) {
      setValidationMessage('M1/M2 参考与已移除电极冲突：请返回第 3 步保留 M1/M2，或改用平均参考。');
      return null;
    }

    return {
      patientIds: selectedPatientIds,
      selectedEmptyChannels,
      selectedBadChannels,
      referenceMode: config.reference,
      downsampleRate: toPreprocessNumber(config.downsample, 500),
      highPassHz: toPreprocessNumber(config.highpass, 1),
      lowPassHz: toPreprocessNumber(config.lowpass, 45),
      notchHz: toPreprocessNumber(config.notch, 50),
    };
  };

  const missingManualTaskMessage = () =>
    currentStep === 6
      ? '未找到当前患者正在等待的正式“人工去除坏段”任务。请确认已选择患者且数据与文档库已索引该患者的基线 CNT 原始 EEG；系统会先生成 stage01 文件再唤起 EEGLAB。正式流程只写入软件输出目录，不会写回原始 EEG 目录或 afterProcess 目录。'
      : '未找到当前患者正在等待的正式“人工去除 ICA 伪迹”任务。请先完成坏段人工节点并再次运行 MATLAB 预处理；生成 stage03 文件后再唤起 EEGLAB。正式流程只写入软件输出目录，不会写回原始 EEG 目录或 afterProcess 目录。';

  const missingQueuedMatlabTaskMessage = () =>
    currentStep === 7
      ? '未找到当前患者正在排队的 ICA 预处理任务。请先在人工去除坏段节点点击“我已完成”，等待系统自动保存 EO/EC 的 stage02 文件后再继续。'
      : '未找到当前患者正在排队的重参考保存任务。请先完成人工去除 ICA 伪迹节点，等待系统自动保存 stage04 文件后再继续。';

  const needsMatlabRunBeforeManualLaunch = (message) =>
    String(message ?? '').includes('请先运行 MATLAB 预处理生成人工节点输入文件');

  const createManualBadSegmentTask = async () => {
    if (![5, 6].includes(currentStep) || !onCreatePreprocessTasks) {
      return null;
    }

    const request = buildPreprocessBatchRequest();
    if (!request) {
      return null;
    }

    setManualStepBusy('create-manual-bad-segment');
    const result = await onCreatePreprocessTasks(request);

    if (!result?.ok) {
      setValidationMessage(result?.message ?? missingManualTaskMessage());
      setManualStepBusy('');
      return null;
    }

    const taskId = Array.isArray(result.taskIds) ? result.taskIds[0] : '';
    if (!taskId) {
      setValidationMessage('已创建预处理任务，但未收到任务 ID。请刷新工作台后重新唤起 EEGLAB。');
      setManualStepBusy('');
      return null;
    }

    return taskId;
  };

  const prepareBadSegmentManualCheckpoint = async () => {
    const manualTaskId = currentManualTask?.id ?? await createManualBadSegmentTask();

    if (!manualTaskId || !onRunMatlabTask) {
      return null;
    }

    setManualStepBusy(`run-${manualTaskId}`);

    try {
      const result = await onRunMatlabTask(manualTaskId);

      if (result && !result.ok) {
        setValidationMessage(result.message);
      }

      return result;
    } finally {
      setManualStepBusy('');
    }
  };

  const handleLaunchPreprocessManualStep = async () => {
    let manualTaskId = currentManualTask?.id ?? '';

    if (!manualTaskId) {
      const createdTaskId = await createManualBadSegmentTask();
      manualTaskId = createdTaskId ?? '';
    }

    if (!manualTaskId || !onLaunchManualTask) {
      const message = missingManualTaskMessage();
      setValidationMessage(message);
      return { ok: false, message };
    }

    setValidationMessage('');
    setManualStepBusy(`launch-${manualTaskId}`);

    try {
      let result = await onLaunchManualTask(manualTaskId);

      if (!result?.ok && needsMatlabRunBeforeManualLaunch(result?.message) && onRunMatlabTask) {
        setManualStepBusy(`run-${manualTaskId}`);
        const matlabResult = await onRunMatlabTask(manualTaskId);

        if (!matlabResult?.ok) {
          const message = matlabResult?.message ?? result.message;
          setValidationMessage(message);
          return matlabResult ?? result;
        }

        setManualStepBusy(`launch-${manualTaskId}`);
        result = await onLaunchManualTask(manualTaskId);
      }

      if (result && !result.ok) {
        setValidationMessage(result.message);
      }

      return result;
    } finally {
      setManualStepBusy('');
    }
  };

  const handleCompletePreprocessManualStep = async () => {
    if (!currentManualTask?.id || !onCompleteManualTask) {
      const message = missingManualTaskMessage();
      setValidationMessage(message);
      return { ok: false, message };
    }

    setValidationMessage('');
    setManualStepBusy(`complete-${currentManualTask.id}`);

    try {
      const result = await onCompleteManualTask(currentManualTask.id);

      if (result?.ok) {
        setCurrentStep(currentStep === 6 ? 7 : 9);
      } else if (result) {
        setValidationMessage(result.message);
      }

      return result;
    } finally {
      setManualStepBusy('');
    }
  };

  const runQueuedPreprocessMatlabTask = async (nextStep) => {
    if (!currentQueuedPreprocessTask?.id || !onRunMatlabTask) {
      const message = missingQueuedMatlabTaskMessage();
      setValidationMessage(message);
      return { ok: false, message };
    }

    setValidationMessage('');
    setManualStepBusy(`run-${currentQueuedPreprocessTask.id}`);

    try {
      const result = await onRunMatlabTask(currentQueuedPreprocessTask.id);

      if (result?.ok) {
        setCurrentStep(nextStep);
      } else if (result) {
        setValidationMessage(result.message);
      }

      return result;
    } finally {
      setManualStepBusy('');
    }
  };

  const handleRunPreprocessQueue = async () => {
    setValidationMessage('');
    if (currentStep === 5) {
      setCurrentStep(6);
      return prepareBadSegmentManualCheckpoint();
    }

    if (currentStep === 7) {
      return runQueuedPreprocessMatlabTask(8);
    }

    if (currentStep === 9 && currentQueuedPreprocessTask) {
      return runQueuedPreprocessMatlabTask(9);
    }

    if (currentStep !== PREPROCESS_STEPS.length) {
      setCurrentStep(Math.min(PREPROCESS_STEPS.length, currentStep + 1));
      return;
    }

    const request = buildPreprocessBatchRequest();
    if (!request) {
      return;
    }

    return onCreatePreprocessTasks?.(request);
  };

  const renderStepContent = () => {
    switch(currentStep) {
      case 3:
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 mb-1">移除空电极 / 辅助通道</h3>
              <p className="text-xs text-slate-500 mb-4">请勾选需要在此阶段丢弃的通道。默认已勾选非脑电辅助通道。注意：若后续计划使用 M1/M2 作为参考电极，此处请勿移除它们。</p>
            </div>
            
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-2 border-b border-slate-200 pb-1">辅助通道 (Auxiliary)</div>
              <div className="flex flex-wrap gap-2">
                {AUX_CHANNELS.map(ch => (
                  <button 
                    key={ch} 
                    onClick={() => handleToggleChannel(ch, 'remove')}
                    className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors ${config.removedChannels.includes(ch) ? 'bg-rose-50 border-rose-300 text-rose-700' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-700 mb-2 border-b border-slate-200 pb-1 mt-4 flex justify-between">
                <span>EEG 导联 (64 Channels)</span>
                <span className="text-slate-400 font-normal">已选 {config.removedChannels.filter(c => EEG_CHANNELS.includes(c)).length} 个空电极</span>
              </div>
              <div className="grid grid-cols-8 gap-2">
                {EEG_CHANNELS.map(ch => (
                  <button 
                    key={ch} 
                    onClick={() => handleToggleChannel(ch, 'remove')}
                    className={`py-1 text-xs font-mono rounded border transition-colors ${config.removedChannels.includes(ch) ? 'bg-rose-50 border-rose-300 text-rose-700 shadow-inner' : 'bg-white border-slate-200 text-slate-600 hover:border-blue-400 hover:text-blue-600'}`}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      case 4:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 mb-1">降采样率 (Downsampling)</h3>
              <p className="text-xs text-slate-500 mb-4">降低采样率可显著提升 ICA 及特征计算速度。</p>
            </div>
            <div className="flex items-center space-x-4 bg-white p-4 border border-slate-200 rounded">
              <label className="text-sm font-medium text-slate-700 w-24">目标采样率:</label>
              <input 
                type="number" 
                value={config.downsample} 
                onChange={(e) => setConfig({...config, downsample: e.target.value})}
                className="w-24 px-3 py-1.5 border border-slate-300 rounded bg-white text-sm text-slate-900 focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono"
              />
              <span className="text-sm text-slate-500">Hz</span>
            </div>
          </div>
        );
      case 5:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 mb-1">带通滤波与陷波</h3>
              <p className="text-xs text-slate-500 mb-4">推荐使用 1-45Hz带通，以消除慢漂移并满足多数脑卒中频段特征提取需求。</p>
            </div>
            <div className="space-y-4 bg-white p-4 border border-slate-200 rounded">
              <div className="flex items-center space-x-4">
                <label className="text-sm font-medium text-slate-700 w-24">高通 (High-pass):</label>
                <input type="number" value={config.highpass} onChange={e=>setConfig({...config, highpass: e.target.value})} className="w-20 px-3 py-1.5 border border-slate-300 rounded bg-white text-sm text-slate-900 focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono" />
                <span className="text-sm text-slate-500">Hz</span>
              </div>
              <div className="flex items-center space-x-4">
                <label className="text-sm font-medium text-slate-700 w-24">低通 (Low-pass):</label>
                <input type="number" value={config.lowpass} onChange={e=>setConfig({...config, lowpass: e.target.value})} className="w-20 px-3 py-1.5 border border-slate-300 rounded bg-white text-sm text-slate-900 focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono" />
                <span className="text-sm text-slate-500">Hz</span>
              </div>
              <div className="flex items-center space-x-4">
                <label className="text-sm font-medium text-slate-700 w-24">陷波 (Notch):</label>
                <input type="number" value={config.notch} onChange={e=>setConfig({...config, notch: e.target.value})} className="w-20 px-3 py-1.5 border border-slate-300 rounded bg-white text-sm text-slate-900 focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono" />
                <span className="text-sm text-slate-500">Hz (市电干扰)</span>
              </div>
            </div>
          </div>
        );
      case 6:
      case 8:
        return (
          <div className="space-y-6 flex flex-col items-center justify-center py-10">
            <div className="bg-yellow-50 border border-yellow-200 p-6 rounded-lg max-w-md w-full text-center shadow-sm">
              <MonitorPlay size={48} className="text-yellow-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-800 mb-2">等待人工处理</h3>
              <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                批处理已在此节点暂停。<br/>
                请唤起 MATLAB EEGLAB 界面，手动完成{currentStep === 6 ? '大段运动伪影的拒绝 (Reject Data by Eye)' : '异常独立成分的剔除 (Reject Components)'}，完成后由系统自动保存到软件输出目录。
              </p>
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleLaunchPreprocessManualStep}
                  disabled={manualStepBusy !== ''}
                  className="w-full py-2.5 bg-white border-2 border-blue-600 text-blue-700 font-medium rounded hover:bg-blue-50 transition-colors flex items-center justify-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Settings2 size={18} />
                  <span>
                    {manualStepBusy.startsWith('create-')
                      ? '正在创建预处理任务...'
                      : manualStepBusy.startsWith('run-')
                      ? '正在运行 MATLAB 预处理...'
                      : manualStepBusy.startsWith('launch-')
                        ? '正在唤起 EEGLAB...'
                        : '唤起 EEGLAB 独立窗口'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleCompletePreprocessManualStep}
                  disabled={manualStepBusy !== ''}
                  className="w-full py-2.5 bg-emerald-600 text-white font-medium rounded hover:bg-emerald-700 transition-colors flex items-center justify-center space-x-2 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <CheckCircle2 size={18} />
                  <span>{manualStepBusy.startsWith('complete-') ? '正在自动保存并推进队列...' : '我已完成，自动保存并继续队列'}</span>
                </button>
              </div>
            </div>
          </div>
        );
      case 7:
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 mb-1">独立成分分析 (ICA)</h3>
              <p className="text-xs text-slate-500 mb-4">建议在执行 ICA 分解前，先挑选出噪声极大的坏导并使用周围电极进行球面插值。</p>
            </div>
            
            <div className="space-y-3 bg-white p-4 border border-slate-200 rounded">
              <label className="flex items-start space-x-3 cursor-pointer">
                <input type="radio" checked={config.icaStrategy === 'direct'} onChange={() => setConfig({...config, icaStrategy: 'direct'})} className="mt-1 text-blue-600 focus:ring-blue-500" />
                <div>
                  <div className="text-sm font-medium text-slate-700">直接运行 ICA</div>
                  <div className="text-xs text-slate-500">不插值坏导，适用于数据质量极高的批次</div>
                </div>
              </label>
              <label className="flex items-start space-x-3 cursor-pointer">
                <input type="radio" checked={config.icaStrategy === 'interpolate'} onChange={() => setConfig({...config, icaStrategy: 'interpolate'})} className="mt-1 text-blue-600 focus:ring-blue-500" />
                <div>
                  <div className="text-sm font-medium text-slate-700">插值坏导后运行 ICA</div>
                  <div className="text-xs text-slate-500">人工挑选坏导 → 自动执行插值 (Spherical) → 自动执行 RunICA</div>
                </div>
              </label>
            </div>

            {config.icaStrategy === 'interpolate' && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="text-xs font-semibold text-slate-700 mb-2 flex justify-between">
                  <span>挑选坏导 (仅显示第 3 步保留的有效 EEG 导联)</span>
                  <span className="text-blue-600 font-medium">已标记 {config.badChannels.length} 个坏导</span>
                </div>
                <div className="grid grid-cols-8 gap-2 bg-slate-50 p-3 rounded border border-slate-200">
                  {EEG_CHANNELS.filter(ch => !config.removedChannels.includes(ch)).map(ch => (
                    <button 
                      key={ch} 
                      onClick={() => handleToggleChannel(ch, 'bad')}
                      className={`py-1 text-xs font-mono rounded border transition-colors ${config.badChannels.includes(ch) ? 'bg-indigo-100 border-indigo-400 text-indigo-700 font-bold shadow-inner' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600'}`}
                    >
                      {ch}
                    </button>
                  ))}
                  {EEG_CHANNELS.filter(ch => !config.removedChannels.includes(ch)).length === 0 && (
                    <div className="col-span-8 text-center text-xs text-slate-400 py-4">无可用 EEG 导联，请检查第 3 步设置。</div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      case 9:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 mb-1">重参考与最终保存</h3>
              <p className="text-xs text-slate-500 mb-4">设定数据清理完毕后的参考标准电极。此步骤完成后将自动生成 .set/.fdt 预处理文件。</p>
            </div>
            
            <div className="space-y-4 bg-white p-4 border border-slate-200 rounded">
              <label className="flex items-start space-x-3 cursor-pointer">
                <input type="radio" checked={config.reference === 'average'} onChange={() => setConfig({...config, reference: 'average'})} className="mt-1 text-blue-600 focus:ring-blue-500" />
                <div>
                  <div className="text-sm font-medium text-slate-700">平均参考 (Average Reference)</div>
                  <div className="text-xs text-slate-500">将所有可用头皮电极的均值作为参考（推荐用于 FC / 脑网路分析）</div>
                </div>
              </label>
              
              <label className={`flex items-start space-x-3 ${isM1M2Removed ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                <input 
                  type="radio" 
                  disabled={isM1M2Removed}
                  checked={config.reference === 'm1m2'} 
                  onChange={() => setConfig({...config, reference: 'm1m2'})} 
                  className="mt-1 text-blue-600 focus:ring-blue-500 disabled:text-slate-300" 
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-700">双侧乳突参考 (M1 / M2)</div>
                  <div className="text-xs text-slate-500">将 M1 和 M2 的平均值作为参考</div>
                  {isM1M2Removed && (
                    <div className="mt-2 flex items-center space-x-1.5 text-xs text-amber-600 bg-amber-50 px-2 py-1.5 rounded border border-amber-200">
                      <AlertTriangle size={14} />
                      <span>不可用：您在第 3 步中移除了 M1 或 M2 电极。请返回调整或使用平均参考。</span>
                    </div>
                  )}
                </div>
              </label>
            </div>
          </div>
        );
      default:
        return (
          <div className="flex items-center justify-center h-48 text-slate-400">
            <p>步骤 {currentStep} 的参数配置区域 (Auto)</p>
          </div>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden relative">
      {/* Top Banner */}
      <div className="bg-white px-6 py-4 border-b border-slate-200 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 flex items-center space-x-2">
            <Activity className="text-blue-600" size={24} />
            <span>EEG 预处理向导</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">配置 EEGLAB 批处理管道参数，系统将自动挂起人工处理节点。</p>
          {validationMessage && (
            <div className="mt-2 inline-flex items-center space-x-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded">
              <AlertTriangle size={14} />
              <span>{validationMessage}</span>
            </div>
          )}
        </div>
        <div className="flex items-center space-x-3 text-sm text-slate-600">
          <span className="flex items-center space-x-1"><div className="w-2.5 h-2.5 rounded-full bg-blue-500"></div><span>全自动节点</span></span>
          <span className="flex items-center space-x-1"><div className="w-2.5 h-2.5 rounded-full bg-indigo-500"></div><span>半自动节点</span></span>
          <span className="flex items-center space-x-1"><div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div><span>纯人工节点</span></span>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Step Navigator */}
        <div className="w-72 bg-white border-r border-slate-200 overflow-y-auto p-4 shrink-0">
          <div className="space-y-2">
            {PREPROCESS_STEPS.map((step) => {
              const isActive = currentStep === step.id;
              const isPast = currentStep > step.id;
              
              let badgeStyle = "bg-slate-100 text-slate-500";
              let badgeText = "Auto";
              if (step.type === 'auto') { badgeStyle = "bg-blue-50 text-blue-600 border-blue-200"; badgeText = "Auto"; }
              if (step.type === 'semi-auto') { badgeStyle = "bg-indigo-50 text-indigo-600 border-indigo-200"; badgeText = "Semi"; }
              if (step.type === 'manual') { badgeStyle = "bg-yellow-50 text-yellow-700 border-yellow-200"; badgeText = "Manual"; }

              return (
                <div 
                  key={step.id} 
                  onClick={() => setCurrentStep(step.id)}
                  className={`relative p-3 rounded-lg border cursor-pointer transition-all duration-200 ${
                    isActive 
                      ? 'bg-blue-50/50 border-blue-400 shadow-sm' 
                      : isPast 
                        ? 'bg-white border-slate-200 hover:bg-slate-50' 
                        : 'bg-slate-50/50 border-slate-100 opacity-70 hover:opacity-100'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center space-x-2">
                      <div className={`flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${isActive ? 'bg-blue-600 text-white' : isPast ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                        {isPast ? <CheckCircle2 size={12} /> : step.id}
                      </div>
                      <span className={`text-sm font-medium ${isActive ? 'text-blue-800' : isPast ? 'text-slate-700' : 'text-slate-500'}`}>
                        {step.title}
                      </span>
                    </div>
                  </div>
                  <div className="pl-7 pr-2 text-xs text-slate-500 flex justify-between items-center">
                    <span className="truncate pr-2">{step.desc}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${badgeStyle}`}>
                      {badgeText}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center: Step Config Form */}
        <div className="flex-1 bg-slate-50 overflow-y-auto flex flex-col">
          <div className="p-8 max-w-4xl flex-1 space-y-4">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">预处理数据选择</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    选择需要进入本次 EEGLAB 预处理队列的患者。实际原始 EEG 文件来自数据与文档库索引。
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 shrink-0">
                  <span>已选 {selectedPatientIds.length} / {preprocessPatients.length}</span>
                  <button
                    type="button"
                    onClick={handleSelectAllPatients}
                    className="px-2 py-1 border border-slate-300 rounded text-slate-700 hover:bg-slate-50"
                  >
                    全选
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 max-h-36 overflow-auto pr-1">
                {preprocessPatients.map((patient) => (
                  <label
                    key={patient.backendPatientId}
                    className={`flex items-center justify-between gap-3 rounded border px-3 py-2 text-xs transition-colors ${
                      selectedPatientIds.includes(patient.backendPatientId)
                        ? 'border-blue-200 bg-blue-50 text-slate-800'
                        : 'border-slate-200 bg-white text-slate-500'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label={`选择预处理患者 ${patient.subjectCode}`}
                        checked={selectedPatientIds.includes(patient.backendPatientId)}
                        onChange={() => handleTogglePatient(patient.backendPatientId)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800">{patient.subjectCode}</div>
                        <div className="truncate text-slate-500">{patient.hand}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <FileStatus status={patient.eo} label="EO" />
                      <FileStatus status={patient.ec} label="EC" />
                      <StatusBadge text={patient.preStatus} />
                    </div>
                  </label>
                ))}
                {preprocessPatients.length === 0 && (
                  <div className="col-span-full rounded border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">
                    暂无可选患者。请先在数据与文档库导入患者和 EEG 索引。
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 min-h-[400px]">
              {renderStepContent()}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Footer Action Bar */}
      <div className="bg-white border-t border-slate-200 p-4 shrink-0 flex items-center justify-between shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
        <div className="flex flex-col text-xs space-y-1">
          <div className="flex items-center space-x-2 text-slate-500">
            <FolderOpen size={14} className="text-blue-500" />
            <span>输出路径:</span>
            <span className="font-mono text-slate-700 select-all">{outputPathLabel}</span>
          </div>
          <div className="flex items-center space-x-2 text-slate-400">
            <Terminal size={14} />
            <span>MATLAB Engine 状态: 就绪 (EEGLAB v2023.1)</span>
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
          <button 
            disabled={currentStep === 1}
            onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
            className="px-4 py-2 border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            上一步
          </button>
          
          <button className="px-3 py-2 border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors flex items-center space-x-1" title="暂停/中止当前队列">
            <Pause size={16} className="text-amber-600" />
          </button>
          <button className="px-3 py-2 border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors flex items-center space-x-1" title="失败重试">
            <RefreshCw size={16} className="text-blue-600" />
          </button>

          <button 
            onClick={handleRunPreprocessQueue}
            disabled={manualStepBusy !== ''}
            className="px-6 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 shadow-sm flex items-center space-x-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {manualStepBusy.startsWith('run-') ? (
              <><span>正在运行 MATLAB 预处理...</span> <Play size={16} /></>
            ) : currentStep === PREPROCESS_STEPS.length ? (
              <><span>保存配置并执行队列</span> <Play size={16} /></>
            ) : (
              <><span>下一步</span> <ChevronRight size={16} /></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- ✨ NEW Model Interpretation Component Data ✨ ---

const MOCK_GLOBAL_FEATURES = [
  { name: 'EC WPLI Beta High F8-CP1', score: 0.1353, type: 'fc' },
  { name: 'EC WPLI Beta High F8-P1', score: 0.1287, type: 'fc' },
  { name: 'EC WPLI Beta High F8-FC4', score: 0.1211, type: 'fc' },
  { name: 'EO PSD Beta High F5', score: 0.098, type: 'psd' },
  { name: 'EC PSD Alpha Oz', score: 0.082, type: 'psd' },
];

const MOCK_PSD_HEATMAP = {
  bands: ['Delta (δ)', 'Theta (θ)', 'Alpha (α)', 'Beta (β)'],
  channels: [
    { name: 'Fz (额极中线)', values: [0.12, 0.15, 0.35, 0.21] },
    { name: 'Cz (中央中线)', values: [0.08, 0.11, 0.42, 0.33] },
    { name: 'Pz (顶叶中线)', values: [0.05, 0.09, 0.58, 0.18] },
    { name: 'Oz (枕叶中线)', values: [0.04, 0.06, 0.72, 0.15] }
  ]
};

const MOCK_FC_CONNECTIONS = [
  { source: 'F3', target: 'F4', metric: 'wPLI', weight: 0.65, imp: '高重要性' },
  { source: 'C3', target: 'C4', metric: 'wPLI', weight: 0.48, imp: '中等重要性' },
  { source: 'Cz', target: 'Pz', metric: 'wPLI', weight: 0.72, imp: '高重要性' },
  { source: 'O1', target: 'O2', metric: 'PLV', weight: 0.31, imp: '低重要性' }
];

const MOCK_PATIENT_SHAP = {
  'sub01': {
    predict: '比例恢复',
    prob: 0.88,
    baseValue: 0.52,
    forces: [
      { name: 'EC WPLI Beta High F8-CP1', val: 0.14, positive: true },
      { name: 'EC WPLI Beta High F8-P1', val: 0.13, positive: true },
      { name: 'EO PSD Beta High F5', val: 0.10, positive: true },
      { name: 'EC PSD Alpha Oz', val: -0.04, positive: false }
    ],
    eo_contrib: 65,
    ec_contrib: 35
  },
  'sub02': {
    predict: '恢复不良',
    prob: 0.92,
    baseValue: 0.52,
    forces: [
      { name: 'EC WPLI Beta High F8-CP1', val: -0.18, positive: false },
      { name: 'EO PSD Beta High F5', val: -0.14, positive: false },
      { name: 'EC PSD Alpha Oz', val: -0.09, positive: false },
      { name: 'EC WPLI Beta High F8-FC4', val: 0.06, positive: true }
    ],
    eo_contrib: 42,
    ec_contrib: 58
  },
  'sub03': {
    predict: '比例恢复',
    prob: 0.75,
    baseValue: 0.52,
    forces: [
      { name: 'EC WPLI Beta High F8-P1', val: 0.18, positive: true },
      { name: 'EO PSD Beta High F5', val: 0.07, positive: true },
      { name: 'EC PSD Alpha Oz', val: -0.02, positive: false },
      { name: 'EC WPLI Beta High F8-FC4', val: -0.04, positive: false }
    ],
    eo_contrib: 50,
    ec_contrib: 50
  },
  'sub06': {
    predict: '比例恢复',
    prob: 0.81,
    baseValue: 0.52,
    forces: [
      { name: 'EC WPLI Beta High F8-CP1', val: 0.11, positive: true },
      { name: 'EO PSD Beta High F5', val: 0.14, positive: true },
      { name: 'EC WPLI Beta High F8-P1', val: 0.09, positive: true },
      { name: 'EC PSD Alpha Oz', val: -0.05, positive: false }
    ],
    eo_contrib: 60,
    ec_contrib: 40
  }
};

const EXPLANATION_ARTIFACT_TYPES = ['global_importance', 'patient_shap', 'psd_heatmap', 'fc_network'];

const formatExplanationArtifactType = (type) => ({
  global_importance: '全局重要性',
  patient_shap: '患者 SHAP',
  psd_heatmap: 'PSD 热图',
  fc_network: 'FC 网络',
  method_manifest: '方法清单',
}[type] ?? type);

const ModelInterpretationView = ({
  models = [],
  queueRows = [],
  explanationOverviewRows = [],
  explanationArtifacts = [],
  onCreateExplainabilityBatch,
  onOpenExplanationArtifact,
  onDeleteExplanationArtifact,
  busy = false,
}) => {
  const [selectedTask, setSelectedTask] = useState('pr');
  const [selectedModel, setSelectedModel] = useState('m2');
  const [selectedPatientId, setSelectedPatientId] = useState('sub01');

  const rawModelRows = models.length > 0
    ? models.map((model) => ({
        ...model,
        inputs: Array.isArray(model.inputs) ? model.inputs.join(', ') : model.inputs,
        loso: formatPredictionModelSummary(model),
      }))
    : PREDICT_MODELS;
  const modelRows = rawModelRows.filter(isFinalPredictionModel);
  const availableModels = modelRows.filter((model) => model.taskId === selectedTask);
  const availablePatients = queueRows.length > 0
    ? queueRows
        .filter((row) => row.prediction)
        .map((row) => ({
          id: row.subjectCode,
          backendPatientId: row.patientId,
          patientName: maskPatientName(row.patientName),
          predict: row.prediction ?? '-',
          prob: row.probability,
          modelUsed: row.modelUsed,
          expStatus: row.explanationStatus,
        }))
    : PREDICT_QUEUE_MOCK.filter(p => p.predict !== '未跑模型' && p.predict !== '-');
  const selectedPatient =
    availablePatients.find((patient) => patient.id === selectedPatientId) ?? availablePatients[0] ?? null;
  const selectedPatientArtifacts = explanationArtifacts.filter((artifact) => (
    selectedPatient &&
    (artifact.patientId === selectedPatient.backendPatientId || artifact.subjectCode === selectedPatient.id)
  ));
  const selectedOverview = explanationOverviewRows.find((row) => (
    selectedPatient &&
    (row.patientId === selectedPatient.backendPatientId || row.subjectCode === selectedPatient.id)
  ));
  const primaryArtifact = selectedPatientArtifacts[0] ?? null;
  const artifactTopFeatures = primaryArtifact?.topFeatures ?? [];
  const globalFeatures = artifactTopFeatures.length > 0
    ? artifactTopFeatures.map((feature) => ({
        name: feature.name,
        score: feature.score,
        type: String(feature.modality ?? '').toLowerCase(),
      }))
    : MOCK_GLOBAL_FEATURES;
  const patientShap = MOCK_PATIENT_SHAP[selectedPatientId] || MOCK_PATIENT_SHAP['sub01'];
  const patientPrediction = selectedPatient?.predict ?? patientShap.predict;
  const patientProbability = selectedPatient?.prob ?? patientShap.prob;
  
  // 动态读取选中患者的完整信息（包含 hand / 不利侧等属性）
  const patientInfo = MOCK_PATIENTS.find(p => p.id === selectedPatientId) || MOCK_PATIENTS[0];

  React.useEffect(() => {
    if (availableModels.length > 0 && !availableModels.find((model) => model.id === selectedModel)) {
      setSelectedModel(availableModels[0].id);
    }
  }, [availableModels, selectedModel]);

  React.useEffect(() => {
    if (availablePatients.length > 0 && !availablePatients.find((patient) => patient.id === selectedPatientId)) {
      setSelectedPatientId(availablePatients[0].id);
    }
  }, [availablePatients, selectedPatientId]);

  const handleCreateExplainability = () => {
    if (!selectedPatient?.backendPatientId || !selectedModel) return;

    return onCreateExplainabilityBatch?.({
      taskId: selectedTask,
      modelId: selectedModel,
      patientIds: [selectedPatient.backendPatientId],
      artifactTypes: EXPLANATION_ARTIFACT_TYPES,
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden relative">
      
      {/* Top Selector Bar */}
      <div className="bg-white px-6 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between shrink-0 gap-3">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2">
            <TrendingUp size={18} className="text-indigo-600" />
            <span className="text-sm font-semibold text-slate-800">可解释性分析</span>
          </div>
          
          <div className="h-4 w-px bg-slate-200"></div>

          {/* Predict Task Selector */}
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-500 font-medium">任务标签:</span>
            <select 
              value={selectedTask}
              onChange={(e) => setSelectedTask(e.target.value)}
              className="text-xs border border-slate-300 rounded px-2.5 py-1.5 bg-slate-50 text-slate-700 font-medium focus:outline-none focus:border-indigo-500"
            >
              <option value="pr">比例恢复 (PR) vs 恢复不良</option>
            </select>
          </div>

          {/* Model Version Selector */}
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-500 font-medium">评估模型:</span>
            <select 
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="text-xs border border-slate-300 rounded px-2.5 py-1.5 bg-slate-50 text-slate-700 font-mono focus:outline-none focus:border-indigo-500"
            >
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>{model.name} ({model.version})</option>
              ))}
            </select>
          </div>

          {/* Patient Selector */}
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-500 font-medium">患者个案:</span>
            <select 
              value={selectedPatientId}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="text-xs border border-indigo-300 rounded px-3 py-1.5 bg-indigo-50/50 text-indigo-900 font-semibold focus:outline-none focus:border-indigo-500"
            >
              {availablePatients.map(p => (
                <option key={p.id} value={p.id}>{p.id} ({p.predict})</option>
              ))}
            </select>
          </div>
        </div>

        {/* Global Action Export Panel */}
        <div className="flex items-center space-x-2">
          <button 
            onClick={() => primaryArtifact && onOpenExplanationArtifact?.(primaryArtifact.id)}
            disabled={!primaryArtifact}
            className="flex items-center space-x-1 px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FolderOpen size={14} />
            <span>打开解释文件</span>
          </button>
          <button 
            onClick={handleCreateExplainability}
            disabled={busy || !selectedPatient?.backendPatientId || !selectedModel}
            className="flex items-center space-x-1 px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 transition-colors shadow-sm disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            <FileText size={14} />
            <span>{busy ? '创建中...' : '生成解释性任务'}</span>
          </button>
        </div>
      </div>

      <div className="bg-white border-b border-slate-200 px-6 py-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">解释性产物库</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {selectedOverview
                ? `${selectedOverview.artifactCount} 个解释性文件，Top feature: ${selectedOverview.topFeatureName || '-'}`
                : '当前患者暂无后端解释性产物。'}
            </p>
          </div>
          <span className="text-xs text-slate-500">{selectedPatientArtifacts.length} 个文件</span>
        </div>
        <div className="overflow-x-auto border border-slate-200 rounded">
          <table className="w-full text-left text-xs text-slate-600 whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 font-semibold">Subject</th>
                <th className="px-3 py-2 font-semibold">Artifact</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Top Feature</th>
                <th className="px-3 py-2 font-semibold">Method</th>
                <th className="px-3 py-2 font-semibold text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {selectedPatientArtifacts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-slate-400">
                    暂无解释性文件。可先创建解释性任务，待分析引擎生成后登记到这里。
                  </td>
                </tr>
              ) : (
                selectedPatientArtifacts.map((artifact) => (
                  <tr key={artifact.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-slate-800">{artifact.subjectCode}</td>
                    <td className="px-3 py-2 text-slate-800 font-medium">{artifact.title}</td>
                    <td className="px-3 py-2">{formatExplanationArtifactType(artifact.artifactType)}</td>
                    <td className="px-3 py-2">{artifact.topFeatures?.[0]?.name ?? '-'}</td>
                    <td className="px-3 py-2">{artifact.method || '-'}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        aria-label={`打开解释文件 ${artifact.title}`}
                        onClick={() => onOpenExplanationArtifact?.(artifact.id)}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 border border-slate-300 rounded text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <FolderOpen size={13} />
                        <span>打开</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`删除解释文件 ${artifact.title}`}
                        onClick={() => onDeleteExplanationArtifact?.(artifact.id)}
                        className="ml-2 inline-flex items-center space-x-1 px-2.5 py-1 border border-rose-200 rounded text-xs font-medium text-rose-600 hover:bg-rose-50"
                      >
                        <XCircle size={13} />
                        <span>删除</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Main Double-Column Layout */}
      <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
        
        {/* ================= LEFT COLUMN: GLOBAL INTERPRETATION ================= */}
        <div className="space-y-5 flex flex-col">
          
          {/* Card 1: Top Global Feature Importance */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
              <div className="flex items-center space-x-1.5">
                <BarChart2 size={16} className="text-blue-600" />
                <h3 className="text-sm font-semibold text-slate-800">全局特征重要性评分 (Top Features)</h3>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">Permutation Feature Importance</span>
            </div>
            
            <div className="space-y-3.5 flex-1 justify-center">
              {globalFeatures.map((feat, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium text-slate-700">{feat.name}</span>
                    <span className="font-mono text-slate-500">{(feat.score * 100).toFixed(0)}%</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div 
                      className={`h-2 rounded-full ${
                        feat.type === 'clinical' 
                          ? 'bg-blue-500' 
                          : feat.type === 'psd' 
                            ? 'bg-indigo-500' 
                            : 'bg-emerald-500'
                      }`} 
                      style={{ width: `${feat.score * 100}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Card 2: PSD Band-Channel Heatmap */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
              <div className="flex items-center space-x-1.5">
                <Brain size={16} className="text-indigo-600" />
                <h3 className="text-sm font-semibold text-slate-800">PSD 通道 - 频段重要性权重热图</h3>
              </div>
              <span className="text-[10px] text-slate-400">电极相对能量重要性权重</span>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[400px]">
                {/* Heatmap Header */}
                <div className="grid grid-cols-5 text-center text-xs font-semibold text-slate-500 mb-2">
                  <div className="text-left pl-2">脑电导联</div>
                  {MOCK_PSD_HEATMAP.bands.map(b => (
                    <div key={b}>{b}</div>
                  ))}
                </div>

                {/* Heatmap Rows */}
                <div className="space-y-1.5">
                  {MOCK_PSD_HEATMAP.channels.map((chan, cIdx) => (
                    <div key={cIdx} className="grid grid-cols-5 items-center text-center">
                      <div className="text-left text-xs font-medium text-slate-700 pl-2 font-mono">{chan.name}</div>
                      {chan.values.map((val, vIdx) => {
                        // Color depth calculation
                        let bgClass = "bg-indigo-50 text-indigo-700";
                        if (val > 0.6) bgClass = "bg-indigo-700 text-white font-bold";
                        else if (val > 0.4) bgClass = "bg-indigo-500 text-white";
                        else if (val > 0.2) bgClass = "bg-indigo-300 text-slate-900";
                        else if (val > 0.1) bgClass = "bg-indigo-100 text-indigo-900";

                        return (
                          <div 
                            key={vIdx} 
                            className={`py-2 rounded text-xs font-mono transition-all ${bgClass} m-0.5 border border-slate-100`}
                          >
                            {val.toFixed(2)}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Top FC Connections */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex-1">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
              <div className="flex items-center space-x-1.5">
                <Award size={16} className="text-emerald-600" />
                <h3 className="text-sm font-semibold text-slate-800">关键功能连接 (FC) 拓扑评估</h3>
              </div>
              <span className="text-[10px] text-slate-400">基于 wPLI 重心相关特征</span>
            </div>

            <div className="space-y-2">
              {MOCK_FC_CONNECTIONS.map((fc, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 rounded border border-slate-100 text-xs">
                  <div className="flex items-center space-x-2">
                    <div className="flex items-center -space-x-1 bg-white border border-slate-200 rounded px-1.5 py-1 text-[10px] font-bold font-mono text-slate-700 shadow-sm">
                      <span>{fc.source}</span>
                      <span className="text-indigo-400 px-1">↔</span>
                      <span>{fc.target}</span>
                    </div>
                    <span className="text-slate-400">度量类型: <strong className="text-slate-600">{fc.metric}</strong></span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="font-mono text-slate-600">权重: {fc.weight.toFixed(2)}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      fc.imp === '高重要性' ? 'bg-rose-50 text-rose-700 border border-rose-100' : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}>
                      {fc.imp}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* ================= RIGHT COLUMN: PATIENT-LEVEL EXPLANATION ================= */}
        <div className="space-y-5 flex flex-col">
          
          {/* Card 1: Selected Patient Case Outcome Details */}
          <div className="bg-gradient-to-r from-indigo-900 to-slate-900 text-white rounded-xl shadow-sm p-5 flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs text-indigo-200 font-semibold tracking-wider uppercase">脑电解释诊断个案</div>
              <h2 className="text-2xl font-bold tracking-tight">{selectedPatientId} <span className="text-sm font-normal text-slate-300">| {patientInfo.hand}</span></h2>
              <p className="text-xs text-slate-300 leading-relaxed mt-2 max-w-sm">
                当前模型计算出的 tACS 康复结局概率分布如下。通过局部 SHAP 归因模型拆解每个生物学标记物的具体方向贡献力。
              </p>
            </div>
            
            <div className="text-right shrink-0 bg-white/5 p-4 rounded-xl border border-white/10 shadow-inner flex flex-col items-center justify-center">
              <span className="text-xs text-indigo-200 font-medium mb-1">预测预后</span>
              <div className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                patientPrediction === '比例恢复' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
              }`}>
                {patientPrediction}
              </div>
              <div className="text-3xl font-extrabold font-mono mt-2 tracking-tighter text-indigo-100">
                {patientProbability ? (patientProbability * 100).toFixed(0) : '-'}%
              </div>
              <span className="text-[9px] text-slate-400 mt-1">置信概率</span>
            </div>
          </div>

          {/* Card 2: SHAP Waterfall / Force Plot */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 flex flex-col flex-1">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-4">
              <div className="flex items-center space-x-1.5">
                <Activity size={16} className="text-indigo-600" />
                <h3 className="text-sm font-semibold text-slate-800">SHAP 局部解释归因图 (Patient SHAP Force)</h3>
              </div>
              <div className="flex items-center space-x-1 text-slate-400 text-[10px]">
                <Info size={12} />
                <span>绿色促成比例恢复，红色阻碍比例恢复</span>
              </div>
            </div>

            {/* Custom SVG SHAP Force Plot */}
            <div className="space-y-5 flex-1 flex flex-col justify-center">
              
              <div className="relative pt-6 pb-2 px-1">
                {/* Baseline & Output Markers */}
                <div className="flex justify-between text-[10px] text-slate-400 font-mono mb-2">
                  <span>模型先验基准概率 (Base Value): {patientShap.baseValue}</span>
                  <span className="text-slate-800 font-bold">最终推理输出: {patientShap.prob}</span>
                </div>

                {/* Simulated force bar */}
                <div className="w-full h-8 bg-slate-100 rounded-md overflow-hidden flex relative shadow-inner border border-slate-200">
                  {/* Positive forces (green) */}
                  {patientShap.forces.filter(f=>f.positive).map((force, fIdx) => (
                    <div 
                      key={`pos-${fIdx}`}
                      className="h-full bg-emerald-500 border-r border-emerald-600/30 flex items-center justify-center text-[10px] text-white font-bold transition-all"
                      style={{ width: `${Math.abs(force.val) * 100}%` }}
                      title={`${force.name}: +${force.val}`}
                    >
                      +
                    </div>
                  ))}
                  
                  {/* Dynamic spacer */}
                  <div className="flex-1 bg-slate-200/40"></div>

                  {/* Negative forces (red) */}
                  {patientShap.forces.filter(f=>!f.positive).map((force, fIdx) => (
                    <div 
                      key={`neg-${fIdx}`}
                      className="h-full bg-rose-500 border-l border-rose-600/30 flex items-center justify-center text-[10px] text-white font-bold transition-all"
                      style={{ width: `${Math.abs(force.val) * 100}%` }}
                      title={`${force.name}: ${force.val}`}
                    >
                      -
                    </div>
                  ))}
                </div>
              </div>

              {/* Detailed forces rows list */}
              <div className="space-y-2 border-t border-slate-100 pt-4 flex-1">
                <div className="text-xs font-semibold text-slate-500 mb-1">各标志性特征对结局的具体贡献极性：</div>
                {patientShap.forces.map((force, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs p-2 rounded bg-slate-50 hover:bg-slate-100 transition-colors">
                    <span className="font-medium text-slate-700">{force.name}</span>
                    <div className="flex items-center space-x-2">
                      <span className={`font-mono font-bold ${force.positive ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {force.positive ? `+${force.val.toFixed(2)}` : force.val.toFixed(2)}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        force.positive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                      }`}>
                        {force.positive ? '促进康复' : '降低预期'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

            </div>
          </div>

          {/* Card 3: EO / EC contrast */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
              <div className="flex items-center space-x-1.5">
                <FileLineChart size={16} className="text-blue-500" />
                <h3 className="text-sm font-semibold text-slate-800">静息态脑电状态相对贡献度 (EO vs EC)</h3>
              </div>
              <span className="text-[10px] text-slate-400">睁闭眼状态在特征集中的总权重</span>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-xs text-slate-500">
                <span>睁眼状态 (Eyes Open, EO)</span>
                <span>闭眼状态 (Eyes Closed, EC)</span>
              </div>
              <div className="w-full bg-slate-100 h-4 rounded-full overflow-hidden flex shadow-inner">
                <div className="bg-blue-500 h-full flex items-center justify-center text-[9px] text-white font-bold" style={{ width: `${patientShap.eo_contrib}%` }}>
                  {patientShap.eo_contrib}%
                </div>
                <div className="bg-indigo-500 h-full flex items-center justify-center text-[9px] text-white font-bold" style={{ width: `${patientShap.ec_contrib}%` }}>
                  {patientShap.ec_contrib}%
                </div>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed text-center">
                诊断：该模型更倾向于提取 <strong className="text-slate-600">{patientShap.eo_contrib > patientShap.ec_contrib ? '睁眼静息态' : '闭眼静息态'}</strong> 的枕叶 Alpha/Beta 功率偏侧化参数。
              </p>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};

// --- ✨ NEW Components: Settings, Model Library, Feature Gen, Archive ✨ ---

const buildSettingsForm = (settings) => ({
  ...DEFAULT_SETTINGS,
  ...(settings ?? {}),
});

const buildPythonExecutorFromSettings = (settings, scriptField) => {
  const executablePath = String(settings?.pythonExecutable ?? '').trim();
  const scriptPath = String(settings?.[scriptField] ?? '').trim();

  if (!executablePath || !scriptPath) return null;

  return {
    executablePath,
    scriptPath,
    extraArgs: [],
  };
};

const SettingsView = ({ settings, onSaveSettings }) => {
  const [form, setForm] = useState(() => buildSettingsForm(settings));

  useEffect(() => {
    setForm(buildSettingsForm(settings));
  }, [settings]);

  const updateField = (field) => (event) => {
    setForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSaveSettings(form);
  };

  const pathField = (id, label, field) => (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      <div className="flex space-x-2">
        <input
          id={id}
          type="text"
          value={form[field]}
          onChange={updateField(field)}
          className="flex-1 px-3 py-2 bg-slate-50 border border-slate-300 rounded text-sm text-slate-600 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        />
        <button type="button" className="px-4 py-2 bg-white border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">浏览...</button>
      </div>
    </div>
  );

  const numericField = (id, label, field, unit) => (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      <div className="flex items-center">
        <input
          id={id}
          type="text"
          value={form[field]}
          onChange={updateField(field)}
          className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-l text-sm text-slate-700 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        />
        <span className="px-2 py-2 bg-slate-100 border border-l-0 border-slate-300 rounded-r text-xs text-slate-500">{unit}</span>
      </div>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="flex-1 flex flex-col h-full bg-slate-50 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 flex items-center space-x-2">
            <Settings className="text-blue-600" size={24} />
            <span>环境与依赖设置</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">配置本地分析引擎路径与核心数据目录。</p>
        </div>

        {/* Engine Settings */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center border-b border-slate-100 pb-2">
            <Terminal size={16} className="text-indigo-600 mr-2" />
            执行引擎路径配置
          </h3>
          <div className="space-y-4">
            {pathField('settings-matlab-executable', 'MATLAB 可执行文件路径 (matlab.exe)', 'matlabExecutable')}
            {pathField('settings-eeglab-path', 'EEGLAB 工具箱根目录', 'eeglabPath')}
            {pathField('settings-electrode-file', '默认电极定位文件', 'defaultElectrodeLocationFile')}
            {pathField('settings-python-executable', 'Python 可执行文件路径 (python.exe)', 'pythonExecutable')}
            {pathField('settings-feature-script', '特征生成脚本路径', 'featureGeneratorScript')}
            {pathField('settings-prediction-script', '预测脚本路径', 'predictionScript')}
            {pathField('settings-explainability-script', '解释性脚本路径', 'explainabilityScript')}
          </div>
        </div>

        {/* Directory Settings */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center border-b border-slate-100 pb-2">
            <Database size={16} className="text-blue-600 mr-2" />
            数据目录存储
          </h3>
          <div className="space-y-4">
            {pathField('settings-data-root', '原始数据根目录 (Raw Data)', 'dataRoot')}
            {pathField('settings-output-root', '预处理与特征输出目录 (Derivatives)', 'outputRoot')}
            {pathField('settings-model-library-root', '模型库目录', 'modelLibraryRoot')}
          </div>
        </div>

        {/* Preprocessing Defaults */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center border-b border-slate-100 pb-2">
            <Settings2 size={16} className="text-emerald-600 mr-2" />
            默认预处理参数
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {numericField('settings-downsample-rate', '降采样率', 'defaultDownsampleRate', 'Hz')}
            {numericField('settings-high-pass', '高通滤波', 'defaultHighPassHz', 'Hz')}
            {numericField('settings-low-pass', '低通滤波', 'defaultLowPassHz', 'Hz')}
            {numericField('settings-notch', '陷波频率', 'defaultNotchHz', 'Hz')}
          </div>
        </div>

        <div className="flex justify-end">
          <button type="submit" className="px-6 py-2.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 shadow-sm flex items-center transition-colors">
            <Check size={16} className="mr-2" />
            保存所有设置
          </button>
        </div>
      </div>
    </form>
  );
};

const formatModelTask = (taskId) => {
  const labels = {
    pr: '比例恢复 (PR) vs 恢复不良',
  };

  return labels[taskId] ?? taskId ?? '-';
};

const formatModelMetric = (value, mode = 'percent') => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return mode === 'percent' ? `${(value * 100).toFixed(1)}%` : value.toFixed(3);
};

const formatModelValidationMethod = (model) => {
  const raw = String(model?.validation ?? '').trim();

  if (isFinalPredictionModel(model) || /final locked main model/i.test(raw)) {
    return '10-seed patient-level LOSO cross-validation';
  }

  if (/loso/i.test(raw)) {
    return 'Patient-level LOSO cross-validation';
  }

  const firstClause = raw.split(';')[0]?.trim();
  return firstClause || '-';
};

const isRunnableModel = (status) => status === '当前版本' || status === '候选版本';

const ModelLibraryView = ({ models = [] }) => {
  const modelRows = models.map((model) => ({
    id: model.id,
    name: model.name,
    version: model.version,
    task: formatModelTask(model.taskId),
    inputType: model.inputType,
    inputs: model.inputs?.join(', ') || '-',
    validation: formatModelValidationMethod(model),
    acc: formatModelMetric(model.accuracy),
    bAcc: formatModelMetric(model.balancedAccuracy),
    roc: formatModelMetric(model.rocAuc, 'score'),
    pr: formatModelMetric(model.prAuc, 'score'),
    status: model.status,
    artifactPath: model.artifactPath,
    runnable: isRunnableModel(model.status),
  }));

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden">
      <div className="bg-white px-6 py-4 border-b border-slate-200 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 flex items-center space-x-2">
            <Box className="text-indigo-600" size={24} />
            <span>预测模型库</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">管理和查看系统中已注册的机器学习预后模型。</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg flex items-start space-x-3 text-amber-800 shadow-sm">
          <AlertTriangle size={20} className="shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-bold">第一版架构限制</h4>
            <p className="text-xs mt-1 leading-relaxed opacity-90">系统当前版本（v1.0）暂不提供面向用户的模型重新训练（Training）入口。目前仅支持加载经实验室验证并固化参数的预置模型进行前向推理（Inference）。自定义训练和参数寻优模块将在后续更新中开放。</p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {modelRows.length === 0 ? (
            <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl shadow-sm px-6 py-12 text-center text-sm text-slate-500">
              暂无已注册模型。请先在后端模型库登记与当前标签定义兼容的模型版本。
            </div>
          ) : modelRows.map(model => (
            <article key={model.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
              <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${model.runnable ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                    <Cpu size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-800">{model.name}</h3>
                    <div className="text-xs text-slate-500 mt-0.5 font-mono">{model.version}</div>
                    <div className="text-xs text-slate-500 mt-1">{model.task}</div>
                  </div>
                </div>
                <div className={`px-2.5 py-1 rounded text-xs font-medium border ${model.runnable ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                  {model.status}
                </div>
              </div>
              
              <div className="p-5 flex-1 space-y-4">
                <div className="space-y-2">
                  <div className="text-xs text-slate-500 flex items-start">
                    <span className="w-20 shrink-0 font-medium">输入类型:</span>
                    <span className="text-slate-800 font-mono bg-indigo-50 px-1.5 py-0.5 rounded">{model.inputType}</span>
                  </div>
                  <div className="text-xs text-slate-500 flex items-start">
                    <span className="w-20 shrink-0 font-medium">输入特征:</span>
                    <span className="text-slate-800 font-mono bg-slate-100 px-1.5 py-0.5 rounded">{model.inputs}</span>
                  </div>
                  <div className="text-xs text-slate-500 flex items-start">
                    <span className="w-20 shrink-0 font-medium">验证方法:</span>
                    <span className="text-slate-800">{model.validation}</span>
                  </div>
                </div>
                
                <div className="pt-3 border-t border-slate-100">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">性能指标 (Metrics)</div>
                  <div className="grid grid-cols-4 gap-3">
                    <div className="bg-slate-50 p-2 rounded border border-slate-100 text-center">
                      <div className="text-[10px] text-slate-500 mb-1">Accuracy</div>
                      <div className={`font-mono font-bold ${model.runnable ? 'text-indigo-600' : 'text-slate-400'}`}>{model.acc}</div>
                    </div>
                    <div className="bg-slate-50 p-2 rounded border border-slate-100 text-center">
                      <div className="text-[10px] text-slate-500 mb-1">Bal. Acc</div>
                      <div className={`font-mono font-bold ${model.runnable ? 'text-indigo-600' : 'text-slate-400'}`}>{model.bAcc}</div>
                    </div>
                    <div className="bg-slate-50 p-2 rounded border border-slate-100 text-center">
                      <div className="text-[10px] text-slate-500 mb-1">ROC-AUC</div>
                      <div className={`font-mono font-bold ${model.runnable ? 'text-blue-600' : 'text-slate-400'}`}>{model.roc}</div>
                    </div>
                    <div className="bg-slate-50 p-2 rounded border border-slate-100 text-center">
                      <div className="text-[10px] text-slate-500 mb-1">PR-AUC</div>
                      <div className={`font-mono font-bold ${model.runnable ? 'text-blue-600' : 'text-slate-400'}`}>{model.pr}</div>
                    </div>
                  </div>
                  {model.artifactPath ? (
                    <div className="mt-3 text-[10px] text-slate-400 font-mono truncate" title={model.artifactPath}>
                      {model.artifactPath}
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
};

const FeatureGenerationView = ({
  overviewRows = [],
  selectedPatientId = '',
  onSelectPatient,
  onCreateFeatureTask,
  busy = false,
}) => {
  const fallbackRows = MOCK_PATIENTS.map((patient) => ({
    patientId: patient.id,
    subjectCode: patient.id,
    patientName: '',
    featureStatus: patient.featStatus === 'PSD/FC 已完成' ? '已完成' : patient.featStatus,
    psdCount: patient.featStatus === 'PSD/FC 已完成' ? 1 : 0,
    fcCount: patient.featStatus === 'PSD/FC 已完成' ? 1 : 0,
    summaryCount: 0,
    previewCount: patient.featStatus === 'PSD/FC 已完成' ? 2 : 0,
    latestFeatureAt: null,
    hasEegFeatures: patient.featStatus === 'PSD/FC 已完成',
  }));
  const featureRows = overviewRows.length > 0 ? overviewRows : fallbackRows;
  const selectedRow = featureRows.find((row) => row.patientId === selectedPatientId) ?? featureRows[0];

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden relative">
      <div className="bg-white px-6 py-4 border-b border-slate-200 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 flex items-center space-x-2">
            <Brain className="text-blue-600" size={24} />
            <span>特征生成与查看 (Feature Matrix)</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">查看自预处理脑电信号中提取的 PSD 与 FC 定量特征矩阵。</p>
        </div>
        <div className="flex items-center space-x-3">
           <select
             value={selectedRow?.patientId ?? ''}
             onChange={(event) => onSelectPatient?.(event.target.value)}
             className="text-sm border border-indigo-300 rounded px-3 py-1.5 bg-indigo-50/50 text-indigo-900 font-semibold focus:outline-none focus:border-indigo-500"
           >
              {featureRows.map((row) => (
                <option key={row.patientId} value={row.patientId}>
                  {row.subjectCode}{row.patientName ? ` (${maskPatientName(row.patientName)})` : ''}
                </option>
              ))}
           </select>
           <button
             type="button"
             disabled={busy || !selectedRow}
             onClick={() => onCreateFeatureTask?.()}
             className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 shadow-sm flex items-center transition-colors"
           >
             {busy ? '创建中...' : '为当前患者创建任务'}
           </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center">
              <Database size={16} className="text-blue-600 mr-2" />
              本地特征索引
            </h3>
            <span className="text-xs text-slate-500">来自本地数据库 feature_artifacts</span>
          </div>
          <table className="w-full text-left text-sm text-slate-600 whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
              <tr>
                <th className="px-5 py-3">Subject</th>
                <th className="px-5 py-3">姓名</th>
                <th className="px-5 py-3">PSD</th>
                <th className="px-5 py-3">FC</th>
                <th className="px-5 py-3">摘要/预览</th>
                <th className="px-5 py-3">状态</th>
                <th className="px-5 py-3">更新时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {featureRows.map((row) => (
                <tr
                  key={row.patientId}
                  onClick={() => onSelectPatient?.(row.patientId)}
                  className={`cursor-pointer hover:bg-slate-50/80 transition-colors ${
                    selectedRow?.patientId === row.patientId ? 'bg-blue-50/60' : ''
                  }`}
                >
                  <td className="px-5 py-4 font-semibold text-slate-900">{row.subjectCode}</td>
                  <td className="px-5 py-4 text-slate-700">{maskPatientName(row.patientName) || '-'}</td>
                  <td className="px-5 py-4"><span className="text-blue-700 bg-blue-50 border border-blue-100 px-2 py-1 rounded font-mono text-xs">PSD {row.psdCount}</span></td>
                  <td className="px-5 py-4"><span className="text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded font-mono text-xs">FC {row.fcCount}</span></td>
                  <td className="px-5 py-4 text-xs text-slate-500">{row.summaryCount} / {row.previewCount}</td>
                  <td className="px-5 py-4"><StatusBadge text={row.featureStatus} /></td>
                  <td className="px-5 py-4 text-xs font-mono text-slate-500">{row.latestFeatureAt ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Status & Paths */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
             <h3 className="text-sm font-semibold text-slate-800 flex items-center"><CheckCircle2 size={16} className="text-emerald-500 mr-2"/> 生成状态与来源</h3>
             <div className="flex space-x-2 text-xs">
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-medium">PSD 已生成</span>
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-medium">FC (wPLI) 已生成</span>
             </div>
          </div>
          <div className="space-y-3 text-xs text-slate-600 font-mono">
            <div className="flex items-center">
              <span className="w-24 text-slate-400">预处理来源:</span>
              <span className="bg-slate-50 px-2 py-1 border border-slate-200 rounded text-slate-700 flex-1 truncate">D:\Research\tACS_EEG_Data\derivatives\preprocessed\sub01_task-rest_eeg_ica_avg.set</span>
            </div>
            <div className="flex items-center">
              <span className="w-24 text-slate-400">PSD 矩阵路径:</span>
              <span className="bg-slate-50 px-2 py-1 border border-slate-200 rounded text-slate-700 flex-1 truncate">D:\Research\tACS_EEG_Data\derivatives\features\sub01_psd_matrix.mat</span>
            </div>
            <div className="flex items-center">
              <span className="w-24 text-slate-400">生成参数:</span>
              <span className="text-slate-700">Welch's Method (Window: 2s, Overlap: 50%), FC wPLI (Epochs: 2s)</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* PSD Viewer */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 flex flex-col">
            <h3 className="text-sm font-semibold text-slate-800 mb-4 border-b border-slate-100 pb-2 flex justify-between">
              <span>通道-频段功率热图 (PSD Heatmap)</span>
              <span className="text-xs text-slate-400 font-normal">dB/Hz (Normalized)</span>
            </h3>
            <div className="flex-1 flex items-center justify-center bg-slate-50/50 rounded-lg border border-slate-100 p-4">
              <div className="w-full text-xs font-mono text-center text-slate-500">
                <div className="grid grid-cols-5 gap-1 mb-1 font-semibold text-slate-600">
                  <div></div><div>Delta</div><div>Theta</div><div>Alpha</div><div>Beta</div>
                </div>
                {['F3', 'F4', 'C3', 'C4', 'O1', 'O2'].map((ch, i) => (
                  <div key={ch} className="grid grid-cols-5 gap-1 mb-1">
                    <div className="py-1 font-semibold text-slate-700">{ch}</div>
                    {[1,2,3,4].map(val => (
                       <div key={val} className="py-1 bg-blue-100 text-blue-800 rounded opacity-[0.8]" style={{ opacity: 0.3 + Math.random() * 0.7 }}>
                         {(Math.random() * 10).toFixed(1)}
                       </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* FC Viewer & EO/EC */}
          <div className="space-y-6 flex flex-col">
             <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
                <h3 className="text-sm font-semibold text-slate-800 mb-4 border-b border-slate-100 pb-2">功能连接矩阵预览 (FC wPLI)</h3>
                <div className="flex items-center justify-center bg-slate-50/50 rounded-lg border border-slate-100 p-4 min-h-[140px]">
                   {/* Mock a 4x4 symmetrical matrix */}
                   <div className="grid grid-cols-5 gap-1 text-[10px] font-mono text-center w-full max-w-[250px]">
                      <div className="text-transparent">X</div><div className="font-bold text-slate-600">F3</div><div className="font-bold text-slate-600">F4</div><div className="font-bold text-slate-600">C3</div><div className="font-bold text-slate-600">C4</div>
                      <div className="font-bold text-slate-600 py-1">F3</div><div className="bg-slate-200 py-1">1.00</div><div className="bg-indigo-100 py-1 text-indigo-700">0.45</div><div className="bg-indigo-300 py-1 text-indigo-900">0.62</div><div className="bg-indigo-50 py-1 text-indigo-500">0.21</div>
                      <div className="font-bold text-slate-600 py-1">F4</div><div className="bg-indigo-100 py-1 text-indigo-700">0.45</div><div className="bg-slate-200 py-1">1.00</div><div className="bg-indigo-50 py-1 text-indigo-500">0.31</div><div className="bg-indigo-200 py-1 text-indigo-800">0.58</div>
                      <div className="font-bold text-slate-600 py-1">C3</div><div className="bg-indigo-300 py-1 text-indigo-900">0.62</div><div className="bg-indigo-50 py-1 text-indigo-500">0.31</div><div className="bg-slate-200 py-1">1.00</div><div className="bg-indigo-400 py-1 text-white font-bold">0.71</div>
                      <div className="font-bold text-slate-600 py-1">C4</div><div className="bg-indigo-50 py-1 text-indigo-500">0.21</div><div className="bg-indigo-200 py-1 text-indigo-800">0.58</div><div className="bg-indigo-400 py-1 text-white font-bold">0.71</div><div className="bg-slate-200 py-1">1.00</div>
                   </div>
                </div>
             </div>

             <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 flex-1">
                <h3 className="text-sm font-semibold text-slate-800 mb-4 border-b border-slate-100 pb-2">绝对能量状态分布 (EO / EC)</h3>
                <div className="space-y-4">
                  <div className="text-xs text-slate-500">全局 Alpha 频段均值功率对比：</div>
                  <div className="w-full bg-slate-100 h-6 rounded overflow-hidden flex shadow-inner text-[10px] text-white font-bold text-center">
                    <div className="bg-sky-500 h-full flex items-center justify-center" style={{ width: `38%` }}>EO (38%)</div>
                    <div className="bg-blue-700 h-full flex items-center justify-center" style={{ width: `62%` }}>EC (62%)</div>
                  </div>
                  <p className="text-[10px] text-slate-400 text-center">
                    提示：由于 Alpha 阻滞现象，闭眼 (EC) 状态下的枕叶 Alpha 能量通常显著高于睁眼 (EO) 状态。
                  </p>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const formatFeatureArtifactKind = (kind) => {
  const labels = {
    PSD: 'PSD',
    FC: 'FC',
    SUMMARY: 'SUMMARY',
    PREVIEW: 'PREVIEW',
  };

  return labels[kind] ?? kind ?? '-';
};

const featureFileName = (filePath = '') => {
  const parts = String(filePath).split(/[\\/]/);
  return parts[parts.length - 1] || filePath || '-';
};

const formatFeatureParams = (params = {}) => {
  const entries = Object.entries(params);

  if (!entries.length) return '-';

  return entries
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join('/') : String(value)}`)
    .join('; ');
};

const formatFeatureFileSize = (bytes) => {
  const size = Number(bytes ?? 0);

  if (!Number.isFinite(size) || size <= 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

const FeatureArchiveView = ({ artifacts = [], onOpenFeatureArtifact, onRefreshArtifacts, busy = false }) => {
  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden">
      <div className="bg-white px-6 py-4 border-b border-slate-200 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 flex items-center space-x-2">
            <Archive className="text-blue-600" size={24} />
            <span>特征档案库</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">按患者结构化归档 PSD、FC、汇总文件、生成参数和可视化预览。</p>
        </div>
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 shadow-sm flex items-center transition-colors disabled:opacity-50"
          onClick={onRefreshArtifacts}
          disabled={busy}
        >
          <RefreshCw size={16} className="mr-2" />
          {busy ? '刷新中...' : '刷新档案库'}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
            <div className="text-xs uppercase text-slate-400 font-semibold">FEATURE FILES</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{artifacts.length}</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
            <div className="text-xs uppercase text-slate-400 font-semibold">PSD</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{artifacts.filter((item) => item.kind === 'PSD').length}</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
            <div className="text-xs uppercase text-slate-400 font-semibold">FC</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{artifacts.filter((item) => item.kind === 'FC').length}</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
            <div className="text-xs uppercase text-slate-400 font-semibold">MISSING</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{artifacts.filter((item) => !item.existsOnDisk).length}</div>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm text-slate-600 whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0">
              <tr>
                <th className="px-5 py-3">患者 / 文件</th>
                <th className="px-5 py-3">类型</th>
                <th className="px-5 py-3">状态</th>
                <th className="px-5 py-3">特征数</th>
                <th className="px-5 py-3">文件信息</th>
                <th className="px-5 py-3">参数 / 预览</th>
                <th className="px-5 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {artifacts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-500">
                    暂无特征档案。先在“特征生成与查看”中创建任务，待特征引擎生成文件后会归档到这里。
                  </td>
                </tr>
              ) : (
                artifacts.map((artifact) => {
                  const name = featureFileName(artifact.filePath);

                  return (
                    <tr key={artifact.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="font-medium text-slate-900 flex items-center">
                          <FolderOpen size={14} className="text-blue-500 mr-2" />
                          {artifact.subjectCode}
                        </div>
                        <div className="mt-1 text-xs font-mono text-slate-500">{name}</div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-blue-700 text-xs bg-blue-50 px-2 py-1 rounded font-mono border border-blue-100">
                          {formatFeatureArtifactKind(artifact.kind)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-700 text-xs bg-slate-100 px-2 py-1 rounded font-mono border border-slate-200">
                            {artifact.state}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded border ${artifact.existsOnDisk ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-rose-700 bg-rose-50 border-rose-100'}`}>
                            {artifact.existsOnDisk ? '文件存在' : '文件丢失'}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 font-mono text-slate-800">{artifact.featureCount || 0}</td>
                      <td className="px-5 py-4 text-xs text-slate-500">
                        <div className="font-mono">{artifact.fileFormat || '-'}</div>
                        <div className="mt-1">{formatFeatureFileSize(artifact.fileSize)}</div>
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500 max-w-[280px]">
                        <div className="truncate">{formatFeatureParams(artifact.params)}</div>
                        <div className="mt-1 text-slate-400">
                          预览资产 {Object.keys(artifact.preview ?? {}).length} 项
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium disabled:text-slate-300"
                          disabled={!artifact.existsOnDisk || busy}
                          aria-label={`打开特征文件 ${name}`}
                          onClick={() => onOpenFeatureArtifact?.(artifact.id)}
                        >
                          打开
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const PlaceholderView = ({ activeTab }) => {
  const item = NAV_ITEMS.find(i => i.id === activeTab);
  const IconComponent = item?.icon || Brain;
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 h-full text-slate-500">
      <IconComponent size={48} className="text-slate-300 mb-4" />
      <h2 className="text-lg font-medium text-slate-700">{item?.label} 视图</h2>
      <p className="text-sm mt-2">（该页面开发中，请点击左侧"患者工作台"）</p>
    </div>
  );
};

const ReportExportView = ({
  patients = MOCK_PATIENTS,
  reports = [],
  onCreateReport,
  onOpenReport,
  onRefreshReports,
  busy = false,
}) => {
  const patientOptions = patients.map((patient) => ({
    patientId: patient.patientId ?? patient.id,
    subjectCode: patient.id ?? patient.subjectCode ?? patient.patientId,
    name: maskPatientName(patient.name ?? patient.patientName ?? ''),
    prediction: patient.predict ?? '-',
    probability: patient.prob,
    report: patient.report ?? '-',
  }));
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const selectedPatient =
    patientOptions.find((patient) => patient.patientId === selectedPatientId) ?? patientOptions[0] ?? null;

  useEffect(() => {
    if (!patientOptions.length) {
      setSelectedPatientId('');
      return;
    }

    if (!selectedPatientId || !patientOptions.some((patient) => patient.patientId === selectedPatientId)) {
      setSelectedPatientId(patientOptions[0].patientId);
    }
  }, [patients, selectedPatientId]);

  const formatProbability = (value) => {
    if (typeof value !== 'number') return '-';
    return `${(value * 100).toFixed(1)}%`;
  };

  const handleGenerate = () => {
    if (!selectedPatient) return;
    onCreateReport?.(selectedPatient.patientId);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden">
      <div className="bg-white px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 flex items-center space-x-2">
            <FileText className="text-blue-600" size={24} />
            <span>报告导出中心</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">生成患者级 HTML 报告，并打开本地报告文件用于复核。</p>
        </div>
        <button
          type="button"
          onClick={onRefreshReports}
          className="px-3 py-2 border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors flex items-center space-x-2"
        >
          <RefreshCw size={16} />
          <span>刷新报告</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
              <div>
                <label htmlFor="report-patient-select" className="block text-xs font-medium text-slate-500 mb-1">
                  报告患者
                </label>
                <select
                  id="report-patient-select"
                  aria-label="报告患者"
                  value={selectedPatient?.patientId ?? ''}
                  onChange={(event) => setSelectedPatientId(event.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                >
                  {patientOptions.map((patient) => (
                    <option key={patient.patientId} value={patient.patientId}>
                      {patient.subjectCode}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="border border-slate-200 rounded p-3 bg-slate-50">
                  <div className="text-[10px] uppercase text-slate-400 font-semibold">预测结论</div>
                  <div className="text-sm font-semibold text-slate-800 mt-1">{selectedPatient?.prediction ?? '-'}</div>
                </div>
                <div className="border border-slate-200 rounded p-3 bg-slate-50">
                  <div className="text-[10px] uppercase text-slate-400 font-semibold">概率</div>
                  <div className="text-sm font-semibold text-slate-800 mt-1">
                    {formatProbability(selectedPatient?.probability)}
                  </div>
                </div>
                <div className="border border-slate-200 rounded p-3 bg-slate-50">
                  <div className="text-[10px] uppercase text-slate-400 font-semibold">报告状态</div>
                  <div className="text-sm font-semibold text-slate-800 mt-1">{selectedPatient?.report ?? '-'}</div>
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={!selectedPatient || busy}
              onClick={handleGenerate}
              className="shrink-0 px-5 py-2.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed shadow-sm flex items-center space-x-2"
            >
              <FilePlus size={16} />
              <span>生成患者报告</span>
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">报告记录</h2>
              <p className="text-xs text-slate-500 mt-0.5">按生成时间倒序展示本地报告文件。</p>
            </div>
            <span className="text-xs text-slate-500">{reports.length} 份报告</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 font-semibold">Subject</th>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Format</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Generated</th>
                  <th className="px-4 py-3 font-semibold text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reports.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                      暂无报告记录。选择患者后生成第一份报告。
                    </td>
                  </tr>
                ) : (
                  reports.map((report) => (
                    <tr key={report.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-slate-800">{report.subjectCode}</td>
                      <td className="px-4 py-3 text-slate-700">{maskPatientName(report.patientName) || '-'}</td>
                      <td className="px-4 py-3 text-slate-600 uppercase">{report.format}</td>
                      <td className="px-4 py-3">
                        <StatusBadge text={report.status} />
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-xs">{report.generatedAt}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          aria-label={`打开报告 ${report.subjectCode}`}
                          onClick={() => onOpenReport?.(report.id)}
                          className="inline-flex items-center space-x-1 px-3 py-1.5 border border-slate-300 rounded text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <FolderOpen size={14} />
                          <span>打开</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState('workbench');
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [workbenchData, setWorkbenchData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [dataLibraryStatus, setDataLibraryStatus] = useState(null);
  const [dataLibrarySummaries, setDataLibrarySummaries] = useState([]);
  const [selectedDocumentDetail, setSelectedDocumentDetail] = useState(null);
  const [dataLibraryBusyAction, setDataLibraryBusyAction] = useState(null);
  const [dataLibraryRootPath, setDataLibraryRootPath] = useState('F:\\CJZFile\\EEG_M1');
  const [featureOverviewRows, setFeatureOverviewRows] = useState([]);
  const [featureArtifacts, setFeatureArtifacts] = useState([]);
  const [selectedFeaturePatientId, setSelectedFeaturePatientId] = useState('');
  const [featureBusy, setFeatureBusy] = useState(false);
  const [predictionModels, setPredictionModels] = useState([]);
  const [predictionQueueRows, setPredictionQueueRows] = useState([]);
  const [predictionBusy, setPredictionBusy] = useState(false);
  const [explanationOverviewRows, setExplanationOverviewRows] = useState([]);
  const [explanationArtifacts, setExplanationArtifacts] = useState([]);
  const [explanationBusy, setExplanationBusy] = useState(false);
  const [reportRows, setReportRows] = useState([]);
  const [reportBusy, setReportBusy] = useState(false);
  const [backendMessage, setBackendMessage] = useState('');
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH);
  const isMountedRef = useRef(false);
  const selectedDetailRequestRef = useRef(0);
  const dataLibraryBusyActionRef = useRef(null);
  const rightPanelResizeRef = useRef(null);
  const hasElectronBridge = Boolean(window.neuroPredict);
  const defaultDataLibraryRootPath = dataLibraryStatus?.sourceRoot?.rootPath ?? 'F:\\CJZFile\\EEG_M1';

  const getErrorMessage = (error) => error?.message || String(error || '未知错误');
  const needsMatlabRunBeforeManualLaunch = (message) =>
    String(message ?? '').includes('请先运行 MATLAB 预处理生成人工节点输入文件');
  const shouldRunMatlabAfterManualCompletion = (message) =>
    String(message ?? '').includes('下一步请运行 MATLAB');

  useEffect(() => {
    const applyResize = (clientX) => {
      const resizeState = rightPanelResizeRef.current;

      if (!resizeState) return;

      setRightPanelWidth(
        clampPanelWidth(
          resizeState.startWidth + resizeState.startX - clientX,
          RIGHT_PANEL_MIN_WIDTH,
          RIGHT_PANEL_MAX_WIDTH,
        ),
      );
    };

    const endResize = () => {
      rightPanelResizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    const handleMouseMove = (event) => {
      if (rightPanelResizeRef.current?.mode !== 'mouse') return;
      applyResize(event.clientX);
    };
    const handlePointerMove = (event) => {
      if (rightPanelResizeRef.current?.mode !== 'pointer') return;
      applyResize(event.clientX);
    };
    const handleMouseUp = () => {
      if (rightPanelResizeRef.current?.mode === 'mouse') endResize();
    };
    const handlePointerUp = () => {
      if (rightPanelResizeRef.current?.mode === 'pointer') endResize();
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

  const startRightPanelResize = (event, mode = 'mouse') => {
    event.preventDefault();
    if (mode === 'pointer' && typeof event.pointerId !== 'number') return;
    if (mode === 'mouse' && rightPanelResizeRef.current?.mode === 'pointer') return;
    rightPanelResizeRef.current = {
      startX: event.clientX,
      startWidth: rightPanelWidth,
      mode,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleRightPanelResizeKeyDown = (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setRightPanelWidth((current) => clampPanelWidth(current + RIGHT_PANEL_RESIZE_STEP, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH));
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setRightPanelWidth((current) => clampPanelWidth(current - RIGHT_PANEL_RESIZE_STEP, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setRightPanelWidth(RIGHT_PANEL_MIN_WIDTH);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setRightPanelWidth(RIGHT_PANEL_MAX_WIDTH);
    }
  };

  const refreshWorkbench = async ({ silent = false } = {}) => {
    try {
      const data = await getWorkbenchData();
      if (!isMountedRef.current) return null;
      setWorkbenchData(data);
      return data;
    } catch (error) {
      if (!silent && isMountedRef.current) {
        setBackendMessage(`加载工作台数据失败：${getErrorMessage(error)}`);
      }
      return null;
    }
  };

  const refreshSettings = async () => {
    try {
      const nextSettings = await getSettings();
      if (!isMountedRef.current) return null;
      if (nextSettings) {
        setSettings(nextSettings);
      }
      return nextSettings;
    } catch (error) {
      if (isMountedRef.current) {
        setBackendMessage(`加载环境设置失败：${getErrorMessage(error)}`);
      }
      return null;
    }
  };

  const refreshDataLibrary = async ({ silent = false } = {}) => {
    try {
      const [nextStatus, nextSummaries] = await Promise.all([
        getDataLibraryStatus(),
        listPatientAssetSummary(),
      ]);
      if (!isMountedRef.current) return null;
      setDataLibraryStatus(nextStatus);
      setDataLibrarySummaries(nextSummaries);
      return { status: nextStatus, summaries: nextSummaries };
    } catch (error) {
      if (!silent && isMountedRef.current) {
        setBackendMessage(`加载数据与文档库失败：${getErrorMessage(error)}`);
      }
      return null;
    }
  };

  const refreshFeatureOverview = async ({ silent = false } = {}) => {
    try {
      const rows = await listFeatureOverview();
      if (!isMountedRef.current) return [];
      setFeatureOverviewRows(rows);
      setSelectedFeaturePatientId((current) => {
        if (current && rows.some((row) => row.patientId === current)) {
          return current;
        }

        return rows[0]?.patientId ?? '';
      });
      return rows;
    } catch (error) {
      if (!silent && isMountedRef.current) {
        setBackendMessage(`加载特征索引失败：${getErrorMessage(error)}`);
      }
      return [];
    }
  };

  const refreshFeatureArtifacts = async ({ silent = false } = {}) => {
    try {
      const rows = await listFeatureArtifacts();
      if (!isMountedRef.current) return [];
      setFeatureArtifacts(rows);
      return rows;
    } catch (error) {
      if (!silent && isMountedRef.current) {
        setBackendMessage(`加载特征档案失败：${getErrorMessage(error)}`);
      }
      return [];
    }
  };

  const refreshPredictionData = async ({ silent = false } = {}) => {
    try {
      const [models, queue] = await Promise.all([
        listPredictionModels('pr'),
        listPredictionQueue({ taskId: 'pr' }),
      ]);
      if (!isMountedRef.current) return { models: [], queue: [] };
      setPredictionModels(models);
      setPredictionQueueRows(queue);
      return { models, queue };
    } catch (error) {
      if (!silent && isMountedRef.current) {
        setBackendMessage(`加载预测队列失败：${getErrorMessage(error)}`);
      }
      return { models: [], queue: [] };
    }
  };

  const refreshExplanationData = async ({ silent = false } = {}) => {
    try {
      const [overview, artifacts] = await Promise.all([
        listExplanationOverview({ taskId: 'pr' }),
        listExplanationArtifacts({ taskId: 'pr' }),
      ]);
      if (!isMountedRef.current) return { overview: [], artifacts: [] };
      setExplanationOverviewRows(overview);
      setExplanationArtifacts(artifacts);
      return { overview, artifacts };
    } catch (error) {
      if (!silent && isMountedRef.current) {
        setBackendMessage(`加载解释性结果失败：${getErrorMessage(error)}`);
      }
      return { overview: [], artifacts: [] };
    }
  };

  const refreshReports = async ({ silent = false } = {}) => {
    try {
      const rows = await listPatientReports();
      if (!isMountedRef.current) return [];
      setReportRows(rows);
      return rows;
    } catch (error) {
      if (!silent && isMountedRef.current) {
        setBackendMessage(`加载报告列表失败：${getErrorMessage(error)}`);
      }
      return [];
    }
  };

  const refreshWorkspaceViews = async () =>
    Promise.all([
      refreshWorkbench({ silent: true }),
      refreshDataLibrary({ silent: true }),
      refreshFeatureOverview({ silent: true }),
      refreshFeatureArtifacts({ silent: true }),
      refreshPredictionData({ silent: true }),
      refreshExplanationData({ silent: true }),
      refreshReports({ silent: true }),
    ]);

  useEffect(() => {
    isMountedRef.current = true;
    Promise.all([
      refreshWorkbench(),
      refreshSettings(),
      refreshDataLibrary(),
      refreshFeatureOverview(),
      refreshFeatureArtifacts(),
      refreshPredictionData(),
      refreshExplanationData(),
      refreshReports(),
    ]);
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setDataLibraryRootPath(defaultDataLibraryRootPath);
  }, [defaultDataLibraryRootPath]);

  const handleImportPatients = async () => {
    try {
      const result = await importPatientsCsv();
      if (!isMountedRef.current) return;
      setBackendMessage(`患者导入完成：${result.created} 行，跳过 ${result.skipped} 行`);
      await refreshWorkbench({ silent: true });
    } catch (error) {
      if (isMountedRef.current) {
        setBackendMessage(`患者导入失败：${getErrorMessage(error)}`);
      }
    }
  };

  const handleScanEegFolder = async () => {
    try {
      const result = await scanEegFolder();
      if (!isMountedRef.current) return;
      setBackendMessage(`EEG 扫描完成：扫描 ${result.scannedFiles} 个文件，登记 ${result.registeredFiles} 个文件`);
      await refreshWorkbench({ silent: true });
    } catch (error) {
      if (isMountedRef.current) {
        setBackendMessage(`EEG 扫描失败：${getErrorMessage(error)}`);
      }
    }
  };

  const handleDeletePatient = async (patientId) => {
    if (!patientId) return;

    try {
      const result = await deletePatient(patientId);
      if (!isMountedRef.current) return;
      setBackendMessage(result.message);
      setSelectedDocumentDetail((current) => (current?.patient?.id === patientId ? null : current));
      await refreshWorkspaceViews();
    } catch (error) {
      if (isMountedRef.current) {
        setBackendMessage(`删除患者失败：${getErrorMessage(error)}`);
      }
    }
  };

  const handleClearWorkspaceData = async () => {
    try {
      const result = await clearWorkspaceData();
      if (!isMountedRef.current) return;
      setBackendMessage(result.message);
      setSelectedDocumentDetail(null);
      setSelectedFeaturePatientId('');
      await refreshWorkspaceViews();
    } catch (error) {
      if (isMountedRef.current) {
        setBackendMessage(`清空患者工作区失败：${getErrorMessage(error)}`);
      }
    }
  };

  const handleSaveSettings = async (nextSettings) => {
    try {
      const savedSettings = await updateSettings(nextSettings);
      if (!isMountedRef.current) return;
      setSettings(savedSettings ?? nextSettings);
      setBackendMessage('环境设置已保存到本地数据库。');
    } catch (error) {
      if (isMountedRef.current) {
        setBackendMessage(`保存环境设置失败：${getErrorMessage(error)}`);
      }
    }
  };

  const handleCreatePreprocessTasks = async (request) => {
    try {
      const result = await startPreprocessing(request);
      if (!isMountedRef.current) return result;
      setBackendMessage(result.message);
      await refreshWorkbench({ silent: true });
      return result;
    } catch (error) {
      const message = `预处理任务创建失败：${getErrorMessage(error)}`;
      if (isMountedRef.current) {
        setBackendMessage(message);
      }
      return { ok: false, message };
    }
  };

  const handleCompleteManualTask = async (taskId) => {
    try {
      const result = await completePreprocessManualStep(taskId);
      if (!isMountedRef.current) return result;
      if (!result?.ok) {
        setBackendMessage(result.message);
        await refreshWorkbench({ silent: true });
        return result;
      }

      if (!shouldRunMatlabAfterManualCompletion(result.message)) {
        setBackendMessage(result.message);
        await refreshWorkbench({ silent: true });
        return result;
      }

      const matlabResult = await runPreprocessMatlabExecution(taskId);
      if (!isMountedRef.current) return matlabResult ?? result;
      setBackendMessage(matlabResult?.message ?? result.message);
      await refreshWorkbench({ silent: true });
      return matlabResult ?? result;
    } catch (error) {
      const message = `更新人工任务失败：${getErrorMessage(error)}`;
      if (isMountedRef.current) {
        setBackendMessage(message);
      }
      return { ok: false, message };
    }
  };

  const handleLaunchManualTask = async (taskId) => {
    try {
      let result = await launchPreprocessManualStep(taskId);
      if (!isMountedRef.current) return result;

      if (!result?.ok && needsMatlabRunBeforeManualLaunch(result?.message)) {
        const matlabResult = await runPreprocessMatlabExecution(taskId);
        if (!isMountedRef.current) return matlabResult;

        if (!matlabResult?.ok) {
          setBackendMessage(matlabResult.message);
          await refreshWorkbench({ silent: true });
          return matlabResult;
        }

        result = await launchPreprocessManualStep(taskId);
        if (!isMountedRef.current) return result;
      }

      setBackendMessage(result.message);
      await refreshWorkbench({ silent: true });
      return result;
    } catch (error) {
      const message = `打开 MATLAB/EEGLAB 失败：${getErrorMessage(error)}`;
      if (isMountedRef.current) {
        setBackendMessage(message);
      }
      return { ok: false, message };
    }
  };

  const handlePrepareMatlabTask = async (taskId) => {
    try {
      const result = await preparePreprocessMatlabExecution(taskId);
      if (!isMountedRef.current) return;
      setBackendMessage(result.message);
      await refreshWorkbench({ silent: true });
    } catch (error) {
      if (isMountedRef.current) {
        setBackendMessage(`准备 MATLAB 执行失败：${getErrorMessage(error)}`);
      }
    }
  };

  const handleRunMatlabTask = async (taskId) => {
    try {
      const result = await runPreprocessMatlabExecution(taskId);
      if (!isMountedRef.current) return result;
      setBackendMessage(result.message);
      await refreshWorkbench({ silent: true });
      return result;
    } catch (error) {
      const message = `运行 MATLAB 预处理失败：${getErrorMessage(error)}`;
      if (isMountedRef.current) {
        setBackendMessage(message);
      }
      return { ok: false, message };
    }
  };

  const handleRunQueuedTask = async (task) => {
    try {
      let result;

      if (task.type === 'preprocess') {
        result = await runPreprocessMatlabExecution(task.id);
        if (!isMountedRef.current) return;
        setBackendMessage(result.message);
        await refreshWorkbench({ silent: true });
        return;
      }

      if (task.type === 'feature_generation') {
        result = await runFeatureGenerationExecution(task.id);
        if (!isMountedRef.current) return;
        setBackendMessage(result.message);
        await Promise.all([
          refreshFeatureOverview({ silent: true }),
          refreshFeatureArtifacts({ silent: true }),
          refreshWorkbench({ silent: true }),
        ]);
        return;
      }

      if (task.type === 'prediction') {
        result = await runPredictionExecution(task.id);
        if (!isMountedRef.current) return;
        setBackendMessage(result.message);
        await Promise.all([
          refreshPredictionData({ silent: true }),
          refreshWorkbench({ silent: true }),
        ]);
        return;
      }

      if (task.type === 'explainability') {
        result = await runExplainabilityExecution(task.id);
        if (!isMountedRef.current) return;
        setBackendMessage(result.message);
        await Promise.all([
          refreshExplanationData({ silent: true }),
          refreshPredictionData({ silent: true }),
          refreshWorkbench({ silent: true }),
        ]);
        return;
      }

      setBackendMessage(`暂不支持从任务队列直接运行 ${task.name}。`);
    } catch (error) {
      if (isMountedRef.current) {
        setBackendMessage(`运行队列任务失败：${getErrorMessage(error)}`);
      }
    }
  };

  const handleRetryTask = async (taskId) => {
    try {
      const result = await retryTask(taskId);
      if (!isMountedRef.current) return;
      setBackendMessage(result.message);
      await refreshWorkbench({ silent: true });
    } catch (error) {
      if (isMountedRef.current) {
        setBackendMessage(`重试任务失败：${getErrorMessage(error)}`);
      }
    }
  };

  const handleScanAndImportDataLibrary = async (rootPath) => {
    if (dataLibraryBusyActionRef.current) return;
    dataLibraryBusyActionRef.current = 'scan';
    setDataLibraryBusyAction('scan');
    try {
      const result = await scanAndImportDataLibrary(rootPath);
      if (!isMountedRef.current) return;
      setBackendMessage(`数据与文档库导入完成：索引 ${result.indexedAssets} 个文件，备份 ${result.backedUpDocuments} 份资料，需复核 ${result.manualReviewItems} 项`);
      await Promise.all([
        refreshDataLibrary({ silent: true }),
        refreshWorkbench({ silent: true }),
      ]);
    } catch (error) {
      if (isMountedRef.current) {
        setBackendMessage(`数据与文档库导入失败：${getErrorMessage(error)}`);
      }
    } finally {
      dataLibraryBusyActionRef.current = null;
      if (isMountedRef.current) {
        setDataLibraryBusyAction(null);
      }
    }
  };

  const handleUpdateDataAssetIndex = async (rootPath) => {
    if (dataLibraryBusyActionRef.current) return;
    dataLibraryBusyActionRef.current = 'index';
    setDataLibraryBusyAction('index');
    try {
      const result = await updateDataAssetIndex(rootPath);
      if (!isMountedRef.current) return;
      setBackendMessage(`数据索引已更新：索引 ${result.indexedAssets} 个文件，缺失 ${result.missingFiles} 个文件`);
      await Promise.all([
        refreshDataLibrary({ silent: true }),
        refreshWorkbench({ silent: true }),
      ]);
    } catch (error) {
      if (isMountedRef.current) {
        setBackendMessage(`更新数据索引失败：${getErrorMessage(error)}`);
      }
    } finally {
      dataLibraryBusyActionRef.current = null;
      if (isMountedRef.current) {
        setDataLibraryBusyAction(null);
      }
    }
  };

  const handleBackupClinicalDocuments = async (rootPath) => {
    if (dataLibraryBusyActionRef.current) return;
    dataLibraryBusyActionRef.current = 'backup';
    setDataLibraryBusyAction('backup');
    try {
      const result = await backupClinicalDocuments(rootPath);
      if (!isMountedRef.current) return;
      setBackendMessage(`患者资料备份完成：备份 ${result.backedUpDocuments} 份，需复核 ${result.manualReviewItems} 项`);
      await Promise.all([
        refreshDataLibrary({ silent: true }),
        refreshWorkbench({ silent: true }),
      ]);
    } catch (error) {
      if (isMountedRef.current) {
        setBackendMessage(`备份患者资料失败：${getErrorMessage(error)}`);
      }
    } finally {
      dataLibraryBusyActionRef.current = null;
      if (isMountedRef.current) {
        setDataLibraryBusyAction(null);
      }
    }
  };

  const handleSelectDataLibraryRoot = async () => {
    if (!window.neuroPredict?.database.selectDataLibraryRoot) {
      setBackendMessage('浏览器预览模式不支持选择本地目录，请在 Electron 软件窗口中使用。');
      return;
    }

    try {
      const selectedRoot = await selectDataLibraryRoot();
      if (!isMountedRef.current) return;
      if (!selectedRoot) {
        setBackendMessage('已取消选择数据根目录。');
        return;
      }

      setDataLibraryRootPath(selectedRoot);
      setBackendMessage(`已选择数据根目录：${selectedRoot}`);
    } catch (error) {
      if (isMountedRef.current) {
        setBackendMessage(`选择数据根目录失败：${getErrorMessage(error)}`);
      }
    }
  };

  const handleOpenBackupDirectory = async () => {
    try {
      const result = await openBackupDirectory();
      if (!isMountedRef.current) return;
      setBackendMessage(result.message || (result.ok ? '已打开备份目录。' : '无法打开备份目录。'));
    } catch (error) {
      if (isMountedRef.current) {
        setBackendMessage(`打开备份目录失败：${getErrorMessage(error)}`);
      }
    }
  };

  const handleSelectDataLibraryPatient = async (patientId) => {
    const requestId = selectedDetailRequestRef.current + 1;
    selectedDetailRequestRef.current = requestId;

    if (!patientId) {
      setSelectedDocumentDetail(null);
      return;
    }

    try {
      const detail = await getPatientDocumentDetail(patientId);
      if (!isMountedRef.current || selectedDetailRequestRef.current !== requestId) return;
      setSelectedDocumentDetail(detail);
    } catch (error) {
      if (isMountedRef.current && selectedDetailRequestRef.current === requestId) {
        setBackendMessage(`加载患者文档详情失败：${getErrorMessage(error)}`);
      }
    }
  };

  const handleCreateFeatureTask = async () => {
    const patientId = selectedFeaturePatientId || featureOverviewRows[0]?.patientId;

    if (!patientId) {
      setBackendMessage('没有可创建特征任务的患者。');
      return;
    }

    setFeatureBusy(true);
    try {
      const executor = buildPythonExecutorFromSettings(settings, 'featureGeneratorScript');
      if (!executor) {
        const result = await indexExistingFeatureResults({
          patientIds: [patientId],
        });
        if (!isMountedRef.current) return;
        setBackendMessage(result.message);
        await Promise.all([
          refreshFeatureOverview({ silent: true }),
          refreshFeatureArtifacts({ silent: true }),
          refreshPredictionData({ silent: true }),
          refreshWorkbench({ silent: true }),
        ]);
        return;
      }

      const result = await createFeatureGenerationBatch({
        patientIds: [patientId],
        featureKinds: ['PSD', 'FC'],
        states: ['EO', 'EC'],
        overwrite: false,
        params: {
          bands: ['delta', 'theta', 'alpha', 'beta', 'gamma'],
          ...(executor ? { executor } : {}),
        },
      });
      if (!isMountedRef.current) return;
      setBackendMessage(result.message);
      await Promise.all([
        refreshFeatureOverview({ silent: true }),
        refreshFeatureArtifacts({ silent: true }),
        refreshWorkbench({ silent: true }),
      ]);
    } catch (error) {
      if (isMountedRef.current) {
        setBackendMessage(`创建特征生成任务失败：${getErrorMessage(error)}`);
      }
    } finally {
      if (isMountedRef.current) {
        setFeatureBusy(false);
      }
    }
  };

  const handleOpenFeatureArtifact = async (artifactId) => {
    setFeatureBusy(true);
    try {
      const result = await openFeatureArtifact(artifactId);
      if (!isMountedRef.current) return;
      setBackendMessage(result.message);
    } catch (error) {
      if (isMountedRef.current) {
        setBackendMessage(`打开特征文件失败：${getErrorMessage(error)}`);
      }
    } finally {
      if (isMountedRef.current) {
        setFeatureBusy(false);
      }
    }
  };

  const handleRunBatchPrediction = async (request) => {
    setPredictionBusy(true);
    try {
      const executor = request.executor ?? buildPythonExecutorFromSettings(settings, 'predictionScript');
      if (!executor) {
        const result = await saveExistingPredictionResult({
          patientIds: request.patientIds,
          taskId: request.taskId,
          modelId: request.modelId,
        });
        if (!isMountedRef.current) return result;
        setBackendMessage(result.message);
        await Promise.all([
          refreshPredictionData({ silent: true }),
          refreshWorkbench({ silent: true }),
        ]);
        return result;
      }

      const result = await runBatchPrediction({
        ...request,
        ...(executor ? { executor } : {}),
      });
      if (!isMountedRef.current) return result;
      setBackendMessage(result.message);
      await Promise.all([
        refreshPredictionData({ silent: true }),
        refreshWorkbench({ silent: true }),
      ]);
      return result;
    } catch (error) {
      const message = `创建预测任务失败：${getErrorMessage(error)}`;
      if (isMountedRef.current) {
        setBackendMessage(message);
      }
      return { ok: false, message };
    } finally {
      if (isMountedRef.current) {
        setPredictionBusy(false);
      }
    }
  };

  const handleCreateExplainabilityBatch = async (request) => {
    setExplanationBusy(true);
    try {
      const executor = request.executor ?? buildPythonExecutorFromSettings(settings, 'explainabilityScript');
      if (!executor) {
        const result = await indexExistingExplanationResults({
          patientIds: request.patientIds,
          taskId: request.taskId,
          modelId: request.modelId,
        });
        if (!isMountedRef.current) return result;
        setBackendMessage(result.message);
        await Promise.all([
          refreshExplanationData({ silent: true }),
          refreshPredictionData({ silent: true }),
          refreshWorkbench({ silent: true }),
        ]);
        return result;
      }

      const result = await createExplainabilityBatch({
        ...request,
        ...(executor ? { executor } : {}),
      });
      if (!isMountedRef.current) return result;
      setBackendMessage(result.message);
      await Promise.all([
        refreshExplanationData({ silent: true }),
        refreshPredictionData({ silent: true }),
        refreshWorkbench({ silent: true }),
      ]);
      return result;
    } catch (error) {
      const message = `创建解释性任务失败：${getErrorMessage(error)}`;
      if (isMountedRef.current) {
        setBackendMessage(message);
      }
      return { ok: false, message, batchId: '', queuedTasks: 0, skippedPatients: [] };
    } finally {
      if (isMountedRef.current) {
        setExplanationBusy(false);
      }
    }
  };

  const handleOpenExplanationArtifact = async (artifactId) => {
    try {
      const result = await openExplanationArtifact(artifactId);
      if (!isMountedRef.current) return result;
      setBackendMessage(result.message);
      return result;
    } catch (error) {
      const message = `打开解释性文件失败：${getErrorMessage(error)}`;
      if (isMountedRef.current) {
        setBackendMessage(message);
      }
      return { ok: false, message };
    }
  };

  const handleDeleteExplanationArtifact = async (artifactId) => {
    try {
      const result = await deleteExplanationArtifact(artifactId);
      if (!isMountedRef.current) return result;
      setBackendMessage(result.message);
      await Promise.all([
        refreshExplanationData({ silent: true }),
        refreshPredictionData({ silent: true }),
        refreshWorkbench({ silent: true }),
      ]);
      return result;
    } catch (error) {
      const message = `删除解释性文件失败：${getErrorMessage(error)}`;
      if (isMountedRef.current) {
        setBackendMessage(message);
      }
      return { ok: false, message };
    }
  };

  const handleCreatePatientReport = async (patientId) => {
    if (!patientId) {
      setBackendMessage('没有可生成报告的患者。');
      return { ok: false, message: '没有可生成报告的患者。', report: null };
    }

    setReportBusy(true);
    try {
      const result = await createPatientReport({
        patientId,
        title: 'tACS EEG 康复结局预测报告',
      });
      if (!isMountedRef.current) return result;
      setBackendMessage(result.message);
      await Promise.all([
        refreshReports({ silent: true }),
        refreshWorkbench({ silent: true }),
      ]);
      return result;
    } catch (error) {
      const message = `生成患者报告失败：${getErrorMessage(error)}`;
      if (isMountedRef.current) {
        setBackendMessage(message);
      }
      return { ok: false, message, report: null };
    } finally {
      if (isMountedRef.current) {
        setReportBusy(false);
      }
    }
  };

  const handleOpenPatientReport = async (reportId) => {
    try {
      const result = await openPatientReport(reportId);
      if (!isMountedRef.current) return result;
      setBackendMessage(result.message);
      return result;
    } catch (error) {
      const message = `打开患者报告失败：${getErrorMessage(error)}`;
      if (isMountedRef.current) {
        setBackendMessage(message);
      }
      return { ok: false, message };
    }
  };

  const handleCreateBatchSummaryReport = async () => {
    setReportBusy(true);
    try {
      const result = await createBatchSummaryReport({
        title: 'tACS EEG 康复结局批次汇总',
      });
      if (!isMountedRef.current) return result;
      setBackendMessage(result.message);
      await refreshWorkbench({ silent: true });
      return result;
    } catch (error) {
      const message = `生成批次汇总失败：${getErrorMessage(error)}`;
      if (isMountedRef.current) {
        setBackendMessage(message);
      }
      return { ok: false, message, report: null };
    } finally {
      if (isMountedRef.current) {
        setReportBusy(false);
      }
    }
  };

  return (
    <div className="h-screen w-full flex flex-col bg-slate-900 font-sans overflow-hidden">
      <TitleBar isRightPanelOpen={isRightPanelOpen} setIsRightPanelOpen={setIsRightPanelOpen} />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
        
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeTab === 'dataLibrary' && (
            <DataLibraryTopStatusBar rootPath={dataLibraryRootPath} status={dataLibraryStatus} />
          )}

          {activeTab !== 'workbench' && backendMessage && (
            <div
              data-testid="backend-message-banner"
              className="bg-emerald-50 border-b border-emerald-200 px-6 py-2 text-xs text-emerald-700 shrink-0"
            >
              {backendMessage}
            </div>
          )}

          {/* Main Content Router */}
          {activeTab === 'workbench' ? (
            <PatientWorkbench
              patients={workbenchData?.patients ?? MOCK_PATIENTS}
              dataRoot={workbenchData?.dataRoot ?? 'D:\\Research\\Stroke_tACS_EEG_Data'}
              onImportPatients={handleImportPatients}
              onScanEegFolder={handleScanEegFolder}
              onExportBatchSummary={handleCreateBatchSummaryReport}
              onDeletePatient={handleDeletePatient}
              onClearWorkspaceData={handleClearWorkspaceData}
              backendMessage={backendMessage}
            />
          ) : activeTab === 'dataLibrary' ? (
            <DataLibraryView
              status={dataLibraryStatus}
              summaries={dataLibrarySummaries}
              selectedDetail={selectedDocumentDetail}
              rootPath={dataLibraryRootPath}
              message={backendMessage}
              busyAction={dataLibraryBusyAction}
              onRootPathChange={setDataLibraryRootPath}
              onSelectRootDirectory={handleSelectDataLibraryRoot}
              onRefresh={refreshDataLibrary}
              onScanAndImport={handleScanAndImportDataLibrary}
              onUpdateIndex={handleUpdateDataAssetIndex}
              onBackupDocuments={handleBackupClinicalDocuments}
              onOpenBackupDirectory={handleOpenBackupDirectory}
              onSelectPatient={handleSelectDataLibraryPatient}
              onDeletePatient={handleDeletePatient}
              onClearWorkspaceData={handleClearWorkspaceData}
            />
          ) : activeTab === 'preprocess' ? (
            <PreprocessWizard
              patients={
                hasElectronBridge
                  ? workbenchData?.patients ?? []
                  : MOCK_PATIENTS
              }
              patientIds={
                hasElectronBridge
                  ? workbenchData?.patients.map((patient) => patient.patientId ?? patient.id) ?? []
                  : MOCK_PATIENTS.map((patient) => patient.id)
              }
              manualTasks={workbenchData?.tasks?.manual ?? []}
              queuedTasks={workbenchData?.tasks?.queued ?? []}
              outputRoot={settings?.outputRoot ?? ''}
              onCreatePreprocessTasks={handleCreatePreprocessTasks}
              onLaunchManualTask={handleLaunchManualTask}
              onCompleteManualTask={handleCompleteManualTask}
              onRunMatlabTask={handleRunMatlabTask}
            />
          ) : activeTab === 'predict' ? (
            <BatchPredictView
              models={predictionModels}
              queueRows={predictionQueueRows}
              onRunBatchPrediction={handleRunBatchPrediction}
              busy={predictionBusy}
            />
          ) : activeTab === 'interpret' ? (
            <ModelInterpretationView
              models={predictionModels}
              queueRows={predictionQueueRows}
              explanationOverviewRows={explanationOverviewRows}
              explanationArtifacts={explanationArtifacts}
              onCreateExplainabilityBatch={handleCreateExplainabilityBatch}
              onOpenExplanationArtifact={handleOpenExplanationArtifact}
              onDeleteExplanationArtifact={handleDeleteExplanationArtifact}
              busy={explanationBusy}
            />
          ) : activeTab === 'models' ? (
            <ModelLibraryView models={predictionModels} />
          ) : activeTab === 'feature' ? (
            <FeatureGenerationView
              overviewRows={featureOverviewRows}
              selectedPatientId={selectedFeaturePatientId}
              onSelectPatient={setSelectedFeaturePatientId}
              onCreateFeatureTask={handleCreateFeatureTask}
              busy={featureBusy}
            />
          ) : activeTab === 'archive' ? (
            <FeatureArchiveView
              artifacts={featureArtifacts}
              onOpenFeatureArtifact={handleOpenFeatureArtifact}
              onRefreshArtifacts={() => refreshFeatureArtifacts()}
              busy={featureBusy}
            />
          ) : activeTab === 'report' ? (
            <ReportExportView
              patients={workbenchData?.patients ?? MOCK_PATIENTS}
              reports={reportRows}
              onCreateReport={handleCreatePatientReport}
              onOpenReport={handleOpenPatientReport}
              onRefreshReports={() => refreshReports()}
              busy={reportBusy}
            />
          ) : activeTab === 'settings' ? (
            <SettingsView settings={settings} onSaveSettings={handleSaveSettings} />
          ) : (
            <PlaceholderView activeTab={activeTab} />
          )}
        </div>
        
        {isRightPanelOpen && (
          <>
            <div
              role="separator"
              aria-label="调整任务队列面板宽度"
              aria-orientation="vertical"
              aria-valuemin={RIGHT_PANEL_MIN_WIDTH}
              aria-valuemax={RIGHT_PANEL_MAX_WIDTH}
              aria-valuenow={rightPanelWidth}
              tabIndex={0}
              onPointerDown={(event) => startRightPanelResize(event, 'pointer')}
              onMouseDown={(event) => startRightPanelResize(event, 'mouse')}
              onKeyDown={handleRightPanelResizeKeyDown}
              onDoubleClick={() => setRightPanelWidth(RIGHT_PANEL_DEFAULT_WIDTH)}
              className="group relative w-3 shrink-0 cursor-col-resize bg-slate-100/80 transition-colors hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
            >
              <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-slate-300 transition-colors group-hover:bg-blue-500 group-focus:bg-blue-500" />
              <span className="absolute left-1/2 top-1/2 h-12 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300/70 transition-colors group-hover:bg-blue-500 group-focus:bg-blue-500" />
            </div>
            <RightPanel
              onClose={() => setIsRightPanelOpen(false)}
              width={rightPanelWidth}
              tasks={workbenchData?.tasks ?? MOCK_TASKS}
              logs={workbenchData?.logs ?? MOCK_LOGS}
              onRunQueuedTask={handleRunQueuedTask}
              onRetryTask={handleRetryTask}
              onCompleteManualTask={handleCompleteManualTask}
              onLaunchManualTask={handleLaunchManualTask}
              onPrepareMatlabTask={handlePrepareMatlabTask}
              onRunMatlabTask={handleRunMatlabTask}
            />
          </>
        )}
      </div>
    </div>
  );
}
