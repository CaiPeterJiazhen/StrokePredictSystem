import { Activity, Network } from 'lucide-react';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { mockPatients } from '../../domain/mockData';

const featureJobs = [
  {
    id: 'PSD-EO',
    title: 'PSD 频域特征',
    description: 'delta/theta/alpha/beta/gamma 频带功率与患侧运动区汇总。',
    status: '已完成',
    icon: Activity,
    preview: ['M1 beta 0.72', 'Fz theta 0.44', 'C3 alpha 0.58'],
  },
  {
    id: 'FC-COH',
    title: 'FC 功能连接特征',
    description: '半球间 coherence、相位同步和运动网络连接强度。',
    status: '生成中',
    icon: Network,
    preview: ['C3-C4 0.63', 'F3-F4 0.41', 'P3-P4 0.52'],
  },
];

export function FeatureGenerationView() {
  return (
    <section className="min-h-full bg-slate-100 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-cyan-700">特征工程</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
            特征提取
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            展示 PSD 和 FC 特征生成状态，并提供 mock 可视化预览。
          </p>
        </div>
        <span className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800">
          {mockPatients.length} 位患者待同步
        </span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {featureJobs.map((job) => {
          const Icon = job.icon;

          return (
            <article
              key={job.id}
              className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-cyan-50 text-cyan-700">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-slate-950">{job.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      {job.description}
                    </p>
                  </div>
                </div>
                <StatusBadge value={job.status} />
              </div>
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                <h3 className="text-sm font-semibold text-slate-950">可视化预览</h3>
                <div className="mt-3 grid h-36 grid-cols-3 items-end gap-2">
                  {job.preview.map((item, index) => (
                    <div key={item} className="flex h-full flex-col justify-end gap-2">
                      <div
                        className="rounded-t-md bg-cyan-500"
                        style={{ height: `${48 + index * 22}px` }}
                      />
                      <span className="text-xs text-slate-600">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <section className="mt-6 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">患者特征状态</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {mockPatients.map((patient) => (
            <article
              key={patient.id}
              className="rounded-md border border-slate-200 bg-slate-50 p-3"
            >
              <div className="font-semibold text-slate-950">{patient.id}</div>
              <p className="mt-1 text-xs text-slate-500">{patient.name}</p>
              <div className="mt-3">
                <StatusBadge value={patient.featureStatus} />
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
