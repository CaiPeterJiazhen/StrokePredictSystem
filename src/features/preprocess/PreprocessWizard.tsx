import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, SlidersHorizontal } from 'lucide-react';
import { ChannelSelector } from '../../components/ui/ChannelSelector';
import {
  RAW_CHANNELS_68,
  getInterpolationCandidates,
  getReferenceConflict,
  isAuxiliaryChannel,
} from '../../domain/channels';
import type { ReferenceMode } from '../../domain/types';

const DEFAULT_REMOVED_CHANNELS = ['HEO', 'VEO', 'EKG', 'EMG', 'M1', 'M2'];

type IcaPath = 'direct' | 'interpolate-first';

const icaPathLabels: Record<IcaPath, string> = {
  direct: '直接运行 ICA',
  'interpolate-first': '先插值坏导再运行 ICA',
};

const pipelineSteps = [
  '导入 CNT/EEG',
  '导入默认 64 导定位',
  '移除空电极/辅助通道',
  '降采样',
  '滤波',
  '人工坏段 EEGLAB',
  'ICA 或先插值坏导再 ICA',
  '人工去伪迹 EEGLAB',
  '重参考与保存',
];

const manualEeglabSteps = [
  {
    id: 'bad-segments',
    title: '人工坏段 EEGLAB',
    description: '打开独立 EEGLAB 窗口完成坏段标记；窗口不嵌入本系统。',
  },
  {
    id: 'artifact-review',
    title: '人工去伪迹 EEGLAB',
    description: '打开独立 EEGLAB 窗口检查 ICA/插值后的伪迹；窗口不嵌入本系统。',
  },
];

function toggleChannel(channels: string[], channel: string) {
  if (channels.includes(channel)) {
    return channels.filter((item) => item !== channel);
  }

  return [...channels, channel];
}

export function PreprocessWizard() {
  const [badChannels, setBadChannels] = useState<string[]>([]);
  const [completedManualSteps, setCompletedManualSteps] = useState<string[]>([]);
  const [icaPath, setIcaPath] = useState<IcaPath>('interpolate-first');
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>('m1m2');
  const [removedChannels, setRemovedChannels] = useState<string[]>(
    DEFAULT_REMOVED_CHANNELS,
  );

  const interpolationCandidates = useMemo(
    () => getInterpolationCandidates(removedChannels),
    [removedChannels],
  );
  const referenceConflict = getReferenceConflict(removedChannels, referenceMode);

  useEffect(() => {
    setBadChannels((current) => {
      const next = current.filter((channel) =>
        interpolationCandidates.includes(channel),
      );

      if (
        next.length === current.length &&
        next.every((channel, index) => channel === current[index])
      ) {
        return current;
      }

      return next;
    });
  }, [interpolationCandidates]);

  return (
    <section className="min-h-full bg-slate-100 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-cyan-700">预处理</h2>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
            EEG 预处理向导
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            当前只配置前端流程和人工确认点；实际预处理步骤未来在 MATLAB/EEGLAB
            中执行。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
            模块正在接入
          </span>
          <span className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800">
            {interpolationCandidates.length} 个有效 EEG 通道
          </span>
        </div>
      </div>

      <div className="mt-6 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <SlidersHorizontal aria-hidden="true" className="h-4 w-4 text-cyan-700" />
          <h2 className="text-sm font-semibold text-slate-950">流程步骤</h2>
        </div>
        <ol className="mt-4 grid gap-2 md:grid-cols-3">
          {pipelineSteps.map((step, index) => (
            <li
              key={step}
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
            >
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-6 space-y-6">
        <ChannelSelector
          actionLabel="移除"
          auxiliaryPredicate={isAuxiliaryChannel}
          channels={RAW_CHANNELS_68}
          description="呈现原始 68 通道：64 个 EEG 通道加 HEO、VEO、EKG、EMG 辅助通道。默认将辅助通道与 M1/M2 作为移除候选，用户可取消。"
          onToggle={(channel) =>
            setRemovedChannels((current) => toggleChannel(current, channel))
          }
          selected={removedChannels}
          title="移除空电极/辅助通道"
        />

        <ChannelSelector
          actionLabel="插值"
          channels={interpolationCandidates}
          description="候选只来自当前有效 EEG 通道，不包含辅助通道，也不包含已移除通道。"
          onToggle={(channel) =>
            setBadChannels((current) => toggleChannel(current, channel))
          }
          selected={badChannels}
          title="坏导插值候选"
        />

        <fieldset className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <legend className="px-1 text-sm font-semibold text-slate-950">
            ICA 路径选择
          </legend>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            根据坏导确认结果选择直接运行 ICA，或先插值坏导再运行 ICA。默认建议先插值坏导再运行 ICA。
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <input
                aria-label="先插值坏导再运行 ICA"
                checked={icaPath === 'interpolate-first'}
                className="h-4 w-4 border-slate-300 text-cyan-600 focus:ring-cyan-500"
                name="ica-path"
                onChange={() => setIcaPath('interpolate-first')}
                type="radio"
              />
              先插值坏导再运行 ICA
            </label>
            <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <input
                aria-label="直接运行 ICA"
                checked={icaPath === 'direct'}
                className="h-4 w-4 border-slate-300 text-cyan-600 focus:ring-cyan-500"
                name="ica-path"
                onChange={() => setIcaPath('direct')}
                type="radio"
              />
              直接运行 ICA
            </label>
          </div>
          <p className="mt-3 text-sm font-medium text-slate-700">
            当前选择：{icaPathLabels[icaPath]}
          </p>
        </fieldset>

        <fieldset className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <legend className="px-1 text-sm font-semibold text-slate-950">
            重参考方式
          </legend>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            可选择 M1/M2 参考或平均参考。若参考电极已移除，需调整移除列表或改用平均参考。
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <input
                aria-label="M1/M2 参考"
                checked={referenceMode === 'm1m2'}
                className="h-4 w-4 border-slate-300 text-cyan-600 focus:ring-cyan-500"
                name="reference-mode"
                onChange={() => setReferenceMode('m1m2')}
                type="radio"
              />
              M1/M2 参考
            </label>
            <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <input
                aria-label="平均参考"
                checked={referenceMode === 'average'}
                className="h-4 w-4 border-slate-300 text-cyan-600 focus:ring-cyan-500"
                name="reference-mode"
                onChange={() => setReferenceMode('average')}
                type="radio"
              />
              平均参考
            </label>
          </div>
          {referenceConflict ? (
            <div
              className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
              role="alert"
            >
              {referenceConflict}
            </div>
          ) : null}
        </fieldset>

        <section
          aria-labelledby="save-output-summary-title"
          className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2
            id="save-output-summary-title"
            className="text-sm font-semibold text-slate-950"
          >
            重参考与保存
          </h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              输出格式：.set/.fdt
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              保存预处理参数
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              保存处理日志
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          {manualEeglabSteps.map((step) => {
            const isCompleted = completedManualSteps.includes(step.id);

            return (
              <article
                key={step.id}
                className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
              >
                <h2 className="text-sm font-semibold text-slate-950">
                  {step.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {step.description}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-cyan-400 hover:text-cyan-700"
                  >
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                    打开 EEGLAB 窗口
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCompletedManualSteps((current) =>
                        current.includes(step.id)
                          ? current
                          : [...current, step.id],
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-md border border-cyan-600 bg-cyan-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-cyan-700"
                  >
                    <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                    我已在 EEGLAB 完成，继续
                  </button>
                </div>
                {isCompleted ? (
                  <p className="mt-3 text-xs font-medium text-emerald-700">
                    已标记完成人工确认。
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
