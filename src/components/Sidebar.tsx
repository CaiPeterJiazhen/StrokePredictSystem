import {
  Activity,
  Archive,
  Database,
  FileText,
  LayoutDashboard,
  LineChart,
  PlayCircle,
  Search,
  Settings,
  SlidersHorizontal,
  UploadCloud,
  type LucideIcon,
} from 'lucide-react';
import { navItems } from '../domain/mockData';
import type { AppPage } from '../domain/types';

interface SidebarProps {
  activePage: AppPage;
  onPageChange: (page: AppPage) => void;
}

export const pageLabels: Record<AppPage, string> = {
  workbench: '患者工作台',
  batch: '批量导入',
  preprocess: '预处理',
  feature: '特征提取',
  archive: '病例库',
  models: '模型库',
  predict: '预测队列',
  interpret: '解释分析',
  report: '报告中心',
  settings: '系统设置',
};

const pageDescriptions: Record<AppPage, string> = {
  workbench: '患者追踪与预测概览',
  batch: '导入患者、EO/EC EEG 与临床表',
  preprocess: '坏导、重参考与插值流程',
  feature: 'EEG 频域、连接与复杂度特征',
  archive: '原始数据、处理状态与报告归档',
  models: '模型版本、指标与验证记录',
  predict: '批量推理任务与解释生成',
  interpret: '个体解释与全局特征重要性',
  report: '报告生成、复核与签发',
  settings: '通道模板、阈值与权限',
};

const pageIcons: Record<AppPage, LucideIcon> = {
  workbench: LayoutDashboard,
  batch: UploadCloud,
  preprocess: SlidersHorizontal,
  feature: Activity,
  archive: Archive,
  models: Database,
  predict: PlayCircle,
  interpret: LineChart,
  report: FileText,
  settings: Settings,
};

const workflowPages: AppPage[] = [
  'workbench',
  'batch',
  'preprocess',
  'feature',
  'predict',
  'report',
];
const analysisPages: AppPage[] = ['archive', 'models', 'interpret', 'settings'];

function SidebarGroup({
  activePage,
  ids,
  onPageChange,
  title,
}: {
  activePage: AppPage;
  ids: AppPage[];
  onPageChange: (page: AppPage) => void;
  title: string;
}) {
  const items = navItems.filter((item) => ids.includes(item.id));

  return (
    <section className="space-y-2">
      <h2 className="px-3 text-xs font-semibold tracking-normal text-slate-400">
        {title}
      </h2>
      <div className="space-y-1">
        {items.map((item) => {
          const Icon = pageIcons[item.id] ?? Search;
          const isActive = item.id === activePage;

          return (
            <button
              key={item.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onPageChange(item.id)}
              className={[
                'flex w-full items-start gap-3 rounded-md px-3 py-3 text-left transition',
                isActive
                  ? 'bg-cyan-500/15 text-cyan-100 ring-1 ring-cyan-400/40'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-slate-50',
              ].join(' ')}
            >
              <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {pageLabels[item.id]}
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-400">
                  {pageDescriptions[item.id]}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function Sidebar({ activePage, onPageChange }: SidebarProps) {
  return (
    <aside className="w-72 shrink-0 border-r border-slate-800 bg-slate-950 p-4">
      <nav aria-label="主导航" className="space-y-6">
        <SidebarGroup
          activePage={activePage}
          ids={workflowPages}
          onPageChange={onPageChange}
          title="核心工作流"
        />
        <SidebarGroup
          activePage={activePage}
          ids={analysisPages}
          onPageChange={onPageChange}
          title="分析与设置"
        />
      </nav>
    </aside>
  );
}
