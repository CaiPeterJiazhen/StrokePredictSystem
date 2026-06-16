import { useEffect, useMemo, useState } from 'react';
import { FileText, PlayCircle } from 'lucide-react';
import { FileStatus } from '../../components/ui/FileStatus';
import { StatusBadge } from '../../components/ui/StatusBadge';
import {
  modelVersions,
  predictionQueue,
  predictionTasks,
} from '../../domain/mockData';
import type { ModelVersion, PredictionQueueRow } from '../../domain/types';

type RunStatus = 'ready' | 'missing-eeg' | 'missing-clinical' | 'no-model';

interface RunState {
  status: RunStatus;
  label: string;
}

function formatPercent(value: number | null) {
  if (value === null) {
    return '待预测';
  }

  return `${Math.round(value * 100)}%`;
}

function modelLabel(model: ModelVersion) {
  return `${model.name} ${model.version} (${model.inputType})`;
}

function modelHistoryKey(model: ModelVersion) {
  return `${model.name} ${model.version}`;
}

function getRowRunState(
  row: PredictionQueueRow,
  model: ModelVersion | undefined,
): RunState {
  if (!model) {
    return { status: 'no-model', label: '未选择模型' };
  }

  if (!row.hasEegFeatures) {
    return { status: 'missing-eeg', label: '缺 EEG 特征' };
  }

  if (model.inputType === 'EEG+Clinical' && !row.hasClinical) {
    return { status: 'missing-clinical', label: '缺临床数据' };
  }

  return { status: 'ready', label: '可预测' };
}

function getRunStateClass(status: RunStatus) {
  if (status === 'ready') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }

  if (status === 'no-model') {
    return 'border-slate-200 bg-slate-100 text-slate-700';
  }

  return 'border-amber-200 bg-amber-50 text-amber-700';
}

export function BatchPredictView() {
  const [selectedTaskId, setSelectedTaskId] = useState(predictionTasks[0]?.taskId ?? '');
  const compatibleModels = useMemo(
    () => modelVersions.filter((model) => model.taskId === selectedTaskId),
    [selectedTaskId],
  );
  const [selectedModelId, setSelectedModelId] = useState(
    compatibleModels[0]?.id ?? '',
  );

  useEffect(() => {
    if (!compatibleModels.some((model) => model.id === selectedModelId)) {
      setSelectedModelId(compatibleModels[0]?.id ?? '');
    }
  }, [compatibleModels, selectedModelId]);

  const selectedTask = predictionTasks.find((task) => task.taskId === selectedTaskId);
  const selectedModel = compatibleModels.find((model) => model.id === selectedModelId);
  const queueRows = predictionQueue.filter((row) => row.taskId === selectedTaskId);

  return (
    <section className="min-h-full bg-slate-100 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-cyan-700">批量预测</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
            预测队列
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            先选择标签定义对应的预测任务，再从兼容模型版本中发起队列推理。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-cyan-600 bg-cyan-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-cyan-700"
          >
            <PlayCircle aria-hidden="true" className="h-4 w-4" />
            运行批量预测
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-cyan-400 hover:text-cyan-700"
          >
            <FileText aria-hidden="true" className="h-4 w-4" />
            导出队列摘要
          </button>
        </div>
      </div>

      <section
        aria-label="标签定义与模型选择"
        className="mt-6 rounded-md border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              标签定义与模型选择
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              当前任务阳性标签定义为{' '}
              <span className="font-semibold text-cyan-700">Residual &lt;= 1.5</span>
              ，模型列表只显示 taskId 兼容版本。
            </p>
          </div>
          <StatusBadge value={selectedTask?.labelDefinition ?? null} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700" htmlFor="prediction-task">
            预测任务
            <select
              id="prediction-task"
              value={selectedTaskId}
              onChange={(event) => setSelectedTaskId(event.target.value)}
              className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
            >
              {predictionTasks.map((task) => (
                <option key={task.id} value={task.taskId}>
                  {task.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-700" htmlFor="model-version">
            模型版本
            <select
              id="model-version"
              value={selectedModelId}
              onChange={(event) => setSelectedModelId(event.target.value)}
              className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
            >
              {compatibleModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {modelLabel(model)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selectedTask ? (
          <dl className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs font-medium text-slate-500">taskId</dt>
              <dd className="mt-1 font-semibold text-slate-950">{selectedTask.taskId}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">预测窗口</dt>
              <dd className="mt-1 font-semibold text-slate-950">{selectedTask.horizon}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">标签定义</dt>
              <dd className="mt-1 font-semibold text-slate-950">
                {selectedTask.labelDefinition}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">兼容模型</dt>
              <dd className="mt-1 font-semibold text-slate-950">
                {compatibleModels.length} 个版本
              </dd>
            </div>
          </dl>
        ) : null}
      </section>

      <section className="mt-6 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">批量预测队列</h2>
          <p className="mt-1 text-sm text-slate-500">
            队列区分当前选择模型的执行判定、当前结果和上次历史结果。
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1320px] border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-4 py-3">患者</th>
                <th className="px-4 py-3">数据</th>
                <th className="px-4 py-3">当前模型</th>
                <th className="px-4 py-3">当前模型结果</th>
                <th className="px-4 py-3">历史结果</th>
                <th className="px-4 py-3">解释状态</th>
                <th className="px-4 py-3">队列状态</th>
                <th className="px-4 py-3">执行判定</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {queueRows.map((row) => {
                const runState = getRowRunState(row, selectedModel);
                const isReady = runState.status === 'ready';
                const isSelectedModelHistoricalResult =
                  selectedModel !== undefined &&
                  row.modelUsed === modelHistoryKey(selectedModel);
                const canShowCurrentResult =
                  isReady && isSelectedModelHistoricalResult && row.probability !== null;

                return (
                  <tr key={row.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <div className="font-semibold text-slate-950">{row.patientId}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.patientName} · {row.priority}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-2">
                        <FileStatus label="EEG" available={row.hasEegFeatures} />
                        <FileStatus label="临床数据" available={row.hasClinical} />
                      </div>
                    </td>
                    <td className="max-w-64 px-4 py-4 text-slate-700">
                      {selectedModel ? modelLabel(selectedModel) : '未选择模型'}
                    </td>
                    <td
                      aria-label={`${row.patientId} 当前模型结果`}
                      className="px-4 py-4"
                    >
                      {canShowCurrentResult ? (
                        <div className="space-y-2">
                          <StatusBadge value={row.prediction} />
                          <div>
                            <span className="font-semibold text-slate-950">
                              {formatPercent(row.probability)}
                            </span>
                            <span className="mt-1 block text-xs text-slate-500">
                              {row.probabilityLabel}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <span className="font-semibold text-slate-950">
                            {isReady || runState.status === 'no-model'
                              ? '待运行'
                              : '不适用'}
                          </span>
                          <span className="mt-1 block text-xs text-slate-500">
                            {runState.label}
                          </span>
                        </div>
                      )}
                    </td>
                    <td
                      aria-label={`${row.patientId} 历史结果`}
                      className="max-w-72 px-4 py-4"
                    >
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-500">
                          历史结果
                        </div>
                        <StatusBadge value={row.prediction} />
                        <div>
                          <span className="font-semibold text-slate-950">
                            {formatPercent(row.probability)}
                          </span>
                          <span className="mt-1 block text-xs text-slate-500">
                            {row.modelUsed}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge value={canShowCurrentResult ? row.explanationStatus : '未生成'} />
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge value={canShowCurrentResult ? row.status : '待处理'} />
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={[
                          'inline-flex rounded-full border px-2 py-0.5 text-xs font-medium',
                          getRunStateClass(runState.status),
                        ].join(' ')}
                      >
                        {runState.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {queueRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-sm text-slate-500" colSpan={8}>
                    当前任务暂无待预测患者。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
