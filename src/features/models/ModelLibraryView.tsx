import { Database } from 'lucide-react';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { modelVersions, predictionTasks } from '../../domain/mockData';

function formatMetric(value: number) {
  return value.toFixed(2);
}

export function ModelLibraryView() {
  return (
    <section className="min-h-full bg-slate-100 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-cyan-700">版本管理</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
            模型库
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            仅展示已验证模型版本、输入类型和验证指标；第一版不提供模型训练入口。
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800">
          <Database aria-hidden="true" className="h-4 w-4" />
          只读模型仓库
        </div>
      </div>

      <section className="mt-6 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">模型版本与验证指标</h2>
          <p className="mt-1 text-sm text-slate-500">
            每个版本绑定唯一 taskId，用于预测页的兼容模型过滤。
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1040px] border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-4 py-3">模型</th>
                <th className="px-4 py-3">任务</th>
                <th className="px-4 py-3">输入</th>
                <th className="px-4 py-3">验证集</th>
                <th className="px-4 py-3">Accuracy</th>
                <th className="px-4 py-3">Balanced Acc.</th>
                <th className="px-4 py-3">ROC AUC</th>
                <th className="px-4 py-3">PR AUC</th>
                <th className="px-4 py-3">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {modelVersions.map((model) => {
                const task = predictionTasks.find((item) => item.taskId === model.taskId);

                return (
                  <tr key={model.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <div className="font-semibold text-slate-950">{model.name}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {model.version} · {model.releasedAt}
                      </div>
                    </td>
                    <td className="max-w-56 px-4 py-4 text-slate-700">
                      <span className="font-medium text-slate-950">{model.taskId}</span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {task?.labelDefinition}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-700">{model.inputType}</td>
                    <td className="max-w-56 px-4 py-4 text-slate-700">{model.validation}</td>
                    <td className="px-4 py-4 font-semibold text-slate-950">
                      {formatMetric(model.accuracy)}
                    </td>
                    <td className="px-4 py-4 font-semibold text-slate-950">
                      {formatMetric(model.balancedAccuracy)}
                    </td>
                    <td className="px-4 py-4 font-semibold text-slate-950">
                      {formatMetric(model.rocAuc)}
                    </td>
                    <td className="px-4 py-4 font-semibold text-slate-950">
                      {formatMetric(model.prAuc)}
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge value={model.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <h2 className="font-semibold">训练入口状态</h2>
        <p className="mt-1 leading-6">
          第一版不提供模型训练入口。模型训练、调参和注册由离线流程完成，本系统只读取版本清单和验证指标。
        </p>
      </section>
    </section>
  );
}
