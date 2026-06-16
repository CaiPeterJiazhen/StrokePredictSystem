import { Download, FileArchive, Image } from 'lucide-react';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { mockLogs, mockPatients } from '../../domain/mockData';

const archivedFiles = [
  {
    id: 'F-001',
    patientId: 'P-2026-001',
    file: 'P-2026-001_features_psd_fc.parquet',
    params: 'PSD: Welch 2s; FC: coherence; reference: average',
    preview: 'PSD/FC 热力图 mock',
    status: '已完成',
  },
  {
    id: 'F-002',
    patientId: 'P-2026-003',
    file: 'P-2026-003_features_eeg_only.parquet',
    params: 'PSD: EO+EC; FC: motor network; clinical: none',
    preview: 'EEG-only 特征条形图 mock',
    status: '需复核',
  },
];

export function FeatureArchiveView() {
  return (
    <section className="min-h-full bg-slate-100 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-cyan-700">归档与追溯</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
            病例库
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            展示特征文件、参数、处理日志、预览图和报告导出能力，当前为 mock 数据。
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-cyan-600 bg-cyan-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-cyan-700"
        >
          <Download aria-hidden="true" className="h-4 w-4" />
          导出报告包
        </button>
      </div>

      <section className="mt-6 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">特征文件归档</h2>
          <p className="mt-1 text-sm text-slate-500">
            参数与预览图随特征文件保存，便于报告复核。
          </p>
        </div>
        <div className="grid gap-4 p-4 xl:grid-cols-2">
          {archivedFiles.map((item) => {
            const patient = mockPatients.find((entry) => entry.id === item.patientId);

            return (
              <article
                key={item.id}
                className="rounded-md border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-cyan-50 text-cyan-700">
                      <FileArchive aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="font-semibold text-slate-950">{item.file}</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.patientId} · {patient?.name}
                      </p>
                    </div>
                  </div>
                  <StatusBadge value={item.status} />
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="text-xs font-medium text-slate-500">参数</dt>
                    <dd className="mt-1 text-slate-700">{item.params}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">预览图</dt>
                    <dd className="mt-2 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-700">
                      <Image aria-hidden="true" className="h-4 w-4 text-cyan-700" />
                      {item.preview}
                    </dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mt-6 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">处理日志</h2>
        <div className="mt-4 space-y-3">
          {mockLogs.map((log) => (
            <article
              key={log.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3"
            >
              <div>
                <p className="text-sm font-semibold text-slate-950">
                  {log.source} · {log.time}
                </p>
                <p className="mt-1 text-sm text-slate-600">{log.message}</p>
              </div>
              <StatusBadge value={log.level} />
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
