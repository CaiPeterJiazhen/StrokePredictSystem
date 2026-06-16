import { FolderCog, Lock } from 'lucide-react';

const settings = [
  {
    label: 'MATLAB 路径',
    value: 'C:/Program Files/MATLAB/R2024b/bin/matlab.exe',
    note: '只读 mock，后续用于调用预处理脚本。',
  },
  {
    label: 'EEGLAB 路径',
    value: 'F:/Toolboxes/eeglab2024.0',
    note: '手动坏段与 ICA 复核通过独立 EEGLAB 窗口完成。',
  },
  {
    label: 'Python/FastAPI 环境',
    value: 'F:/StrokePredictSystem/.venv/Scripts/python.exe',
    note: '当前 API placeholder 不调用后端服务。',
  },
  {
    label: '模型库路径',
    value: 'F:/StrokePredictSystem/model-registry',
    note: '只读取模型版本、指标与解释产物。',
  },
];

export function SettingsView() {
  return (
    <section className="min-h-full bg-slate-100 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-cyan-700">系统配置</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
            系统设置
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            展示 MATLAB、EEGLAB、Python/FastAPI 和模型库路径配置，当前均为只读 mock。
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">
          <Lock aria-hidden="true" className="h-4 w-4" />
          只读
        </span>
      </div>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        {settings.map((item) => (
          <article
            key={item.label}
            className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-cyan-50 text-cyan-700">
                <FolderCog aria-hidden="true" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-950">{item.label}</h2>
                <p className="mt-2 break-all rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
                  {item.value}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.note}</p>
              </div>
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}
