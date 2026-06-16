import { BarChart3 } from 'lucide-react';
import { StatusBadge } from '../../components/ui/StatusBadge';
import {
  globalFeatureImportance,
  modelVersions,
  predictionQueue,
} from '../../domain/mockData';

const patientExplanations = [
  {
    patientId: 'P-2026-001',
    patientName: '张敏',
    modelId: 'MV-CLIN-240',
    summary: '患侧 M1 beta 功率和基线 Residual 共同推高 Residual <= 1.5 概率。',
    topFeatures: ['affected_m1_beta_power', 'baseline_residual', 'interhemispheric_coherence'],
  },
  {
    patientId: 'P-2026-003',
    patientName: '陈芳',
    modelId: 'MV-EEG-230',
    summary: '闭眼 alpha 半球不对称性贡献较高，整体解释状态需要医生复核。',
    topFeatures: ['ec_alpha_asymmetry', 'frontal_theta_alpha_ratio'],
  },
];

export function ModelInterpretationView() {
  return (
    <section className="min-h-full bg-slate-100 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-cyan-700">解释性分析</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
            模型解释
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            展示全局特征重要性和患者级解释，当前数据为 mock 解释输出。
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800">
          <BarChart3 aria-hidden="true" className="h-4 w-4" />
          重要特征可见
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">全局特征重要性</h2>
          <p className="mt-1 text-sm text-slate-500">
            按模型验证解释结果排序，显示重要特征、类别、方向和贡献强度。
          </p>
          <div className="mt-4 space-y-3">
            {globalFeatureImportance.map((item) => {
              const model = modelVersions.find((entry) => entry.id === item.modelId);

              return (
                <article
                  key={item.id}
                  className="rounded-md border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-950">{item.label}</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.feature} · {item.category} · {model?.name} {model?.version}
                      </p>
                    </div>
                    <StatusBadge value={item.direction} />
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-slate-200">
                    <div
                      className="h-2 rounded-full bg-cyan-600"
                      style={{ width: `${Math.round(item.importance * 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs font-medium text-slate-600">
                    重要性 {item.importance.toFixed(2)}
                  </p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">患者级解释</h2>
          <p className="mt-1 text-sm text-slate-500">
            每位患者展示预测输出、解释状态和驱动该结论的重要特征。
          </p>
          <div className="mt-4 space-y-3">
            {patientExplanations.map((explanation) => {
              const queueRow = predictionQueue.find(
                (row) => row.patientId === explanation.patientId,
              );

              return (
                <article
                  key={explanation.patientId}
                  className="rounded-md border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-950">
                        {explanation.patientId} · {explanation.patientName}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {queueRow?.modelUsed ?? '待选择模型'}
                      </p>
                    </div>
                    <StatusBadge value={queueRow?.explanationStatus ?? null} />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-700">
                    {explanation.summary}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {explanation.topFeatures.map((feature) => (
                      <span
                        key={feature}
                        className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-medium text-cyan-800"
                      >
                        {feature}
                      </span>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}
