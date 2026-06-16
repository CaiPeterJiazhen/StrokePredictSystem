import { useState } from 'react';
import { mockLogs, mockTasks } from '../domain/mockData';
import { StatusBadge } from './ui/StatusBadge';

type RightPanelTab = 'queue' | 'logs';

const queueTabId = 'right-panel-tab-queue';
const queuePanelId = 'right-panel-panel-queue';
const logsTabId = 'right-panel-tab-logs';
const logsPanelId = 'right-panel-panel-logs';

export function RightPanel() {
  const [activeTab, setActiveTab] = useState<RightPanelTab>('queue');

  return (
    <aside className="w-80 shrink-0 border-l border-slate-800 bg-slate-950">
      <div className="border-b border-slate-800 p-4">
        <p className="text-xs text-slate-400">批处理监控</p>
        <h2 className="mt-1 text-base font-semibold text-slate-50">
          任务与日志
        </h2>
      </div>
      <div
        role="tablist"
        aria-label="右侧面板"
        className="grid grid-cols-2 border-b border-slate-800 p-2"
      >
        <button
          id={queueTabId}
          type="button"
          role="tab"
          aria-selected={activeTab === 'queue'}
          aria-controls={queuePanelId}
          onClick={() => setActiveTab('queue')}
          className={[
            'rounded-md px-3 py-2 text-sm font-medium transition',
            activeTab === 'queue'
              ? 'bg-cyan-500 text-slate-950'
              : 'text-slate-300 hover:bg-slate-800 hover:text-slate-50',
          ].join(' ')}
        >
          任务队列
        </button>
        <button
          id={logsTabId}
          type="button"
          role="tab"
          aria-selected={activeTab === 'logs'}
          aria-controls={logsPanelId}
          onClick={() => setActiveTab('logs')}
          className={[
            'rounded-md px-3 py-2 text-sm font-medium transition',
            activeTab === 'logs'
              ? 'bg-cyan-500 text-slate-950'
              : 'text-slate-300 hover:bg-slate-800 hover:text-slate-50',
          ].join(' ')}
        >
          引擎日志
        </button>
      </div>
      <div className="max-h-[calc(100vh-161px)] overflow-y-auto p-4">
        {activeTab === 'queue' ? (
          <div
            id={queuePanelId}
            role="tabpanel"
            aria-labelledby={queueTabId}
            className="space-y-3"
          >
            {mockTasks.map((task) => (
              <article
                key={task.id}
                className="rounded-md border border-slate-800 bg-slate-900 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">
                      {task.task}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {task.patientId} · {task.patientName}
                    </p>
                  </div>
                  <StatusBadge value={task.status} />
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-300">
                  {task.stage}
                </p>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <span>{task.assignee}</span>
                  <span>{task.updatedAt}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div
            id={logsPanelId}
            role="tabpanel"
            aria-labelledby={logsTabId}
            className="space-y-3"
          >
            {mockLogs.map((log) => (
              <article
                key={log.id}
                className="rounded-md border border-slate-800 bg-slate-900 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-slate-200">
                    {log.source}
                  </p>
                  <StatusBadge value={log.level} />
                </div>
                <p className="mt-2 text-sm leading-5 text-slate-300">
                  {log.message}
                </p>
                <p className="mt-3 text-xs text-slate-500">{log.time}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
