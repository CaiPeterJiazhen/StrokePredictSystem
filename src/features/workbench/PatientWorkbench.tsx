import { FileText, PlayCircle, UploadCloud } from 'lucide-react';
import { mockPatients } from '../../domain/mockData';
import { FileStatus } from '../../components/ui/FileStatus';
import { StatusBadge } from '../../components/ui/StatusBadge';

function formatProbability(probability: number | null) {
  if (probability === null) {
    return '待预测';
  }

  return `${Math.round(probability * 100)}%`;
}

export function PatientWorkbench() {
  return (
    <section className="min-h-full bg-slate-100 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-cyan-700">患者级追踪</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
            患者工作台
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            汇总患者导入、EO/EC 数据、预处理、特征、标签任务、预测结果与报告状态。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-cyan-400 hover:text-cyan-700"
          >
            <UploadCloud aria-hidden="true" className="h-4 w-4" />
            批量导入
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-cyan-600 bg-cyan-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-cyan-700"
          >
            <PlayCircle aria-hidden="true" className="h-4 w-4" />
            批量预测
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-cyan-400 hover:text-cyan-700"
          >
            <FileText aria-hidden="true" className="h-4 w-4" />
            生成报告
          </button>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">
              患者预测清单
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              以患者为中心追踪每个批处理节点。
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
            {mockPatients.length} 位患者
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-4 py-3">患者 ID</th>
                <th className="px-4 py-3">患侧手</th>
                <th className="px-4 py-3">EO/EC</th>
                <th className="px-4 py-3">预处理</th>
                <th className="px-4 py-3">特征</th>
                <th className="px-4 py-3">标签任务</th>
                <th className="px-4 py-3">预测结果</th>
                <th className="px-4 py-3">阳性概率</th>
                <th className="px-4 py-3">报告状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mockPatients.map((patient) => (
                <tr key={patient.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-4">
                    <div className="font-semibold text-slate-950">
                      {patient.id}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {patient.name} · {patient.age} 岁
                    </div>
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {patient.affectedHand}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col gap-2">
                      <FileStatus label="EO" available={patient.eo} />
                      <FileStatus label="EC" available={patient.ec} />
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge value={patient.preprocessStatus} />
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge value={patient.featureStatus} />
                  </td>
                  <td className="max-w-56 px-4 py-4 text-slate-700">
                    {patient.task}
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge value={patient.prediction} />
                  </td>
                  <td className="px-4 py-4">
                    <span className="font-semibold text-slate-950">
                      {formatProbability(patient.probability)}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {patient.probabilityLabel}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge value={patient.reportStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
