import type { FeatureArtifactKind, FeatureArtifactState, WorkbenchHandText } from '../../domain/backendTypes.js';

export type NormalizedAffectedSide = 'left' | 'right' | 'bilateral';

export interface ModelPipelineFeatureContract {
  requiredStates: readonly ['EO', 'EC'];
  affectedSide: NormalizedAffectedSide;
  alignment: 'right_affected_c3';
  features: {
    PSD: { shape: readonly [62, 90] };
    FC: { metric: 'wpli'; shape: readonly [1891, 6] };
  };
}

export interface ManifestFeatureContractInput {
  kind: FeatureArtifactKind;
  state?: FeatureArtifactState;
  params?: Record<string, unknown>;
}

export const MODEL_PIPELINE_CONTRACT = {
  requiredStates: ['EO', 'EC'] as const,
  alignment: 'right_affected_c3' as const,
  psdShape: [62, 90] as const,
  wpliShape: [1891, 6] as const,
  wpliMetric: 'wpli' as const,
  explainabilityTarget: 'classification_logit' as const,
};

function numericTuple(value: unknown): number[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    return [];
  }

  return value;
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function normalizeAffectedSide(value: unknown): NormalizedAffectedSide | null {
  if (value === '左手' || value === '左肢不利 (RH)') return 'left';
  if (value === '右手' || value === '右肢不利 (LH)') return 'right';
  if (value === '双手') return 'bilateral';
  return null;
}

export function assertAffectedSideForModelPipeline(
  value: WorkbenchHandText | string | null | undefined,
): NormalizedAffectedSide {
  const side = normalizeAffectedSide(value);

  if (!side) {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
      throw new Error('最终模型需要患侧信息，当前患者未填写 affectedHand。');
    }

    throw new Error(`不支持的患侧信息: ${String(value)}。`);
  }

  return side;
}

function assertFeatureArtifactState(state: FeatureArtifactState | undefined): void {
  if (state !== 'EO' && state !== 'EC') {
    throw new Error('特征状态必须是 EO 或 EC。');
  }
}

export function buildFeatureGenerationContract(
  value: WorkbenchHandText | string | null | undefined,
): ModelPipelineFeatureContract {
  return {
    requiredStates: MODEL_PIPELINE_CONTRACT.requiredStates,
    affectedSide: assertAffectedSideForModelPipeline(value),
    alignment: MODEL_PIPELINE_CONTRACT.alignment,
    features: {
      PSD: { shape: MODEL_PIPELINE_CONTRACT.psdShape },
      FC: { metric: MODEL_PIPELINE_CONTRACT.wpliMetric, shape: MODEL_PIPELINE_CONTRACT.wpliShape },
    },
  };
}

export function assertFeatureArtifactContract(input: ManifestFeatureContractInput): void {
  if (input.kind !== 'PSD' && input.kind !== 'FC') return;

  assertFeatureArtifactState(input.state);

  const params = input.params ?? {};

  if (params.alignment !== MODEL_PIPELINE_CONTRACT.alignment) {
    throw new Error('特征必须声明 alignment=right_affected_c3。');
  }

  if (input.kind === 'PSD' && !sameNumbers(numericTuple(params.shape), MODEL_PIPELINE_CONTRACT.psdShape)) {
    throw new Error('PSD 特征形状必须是 [62,90]。');
  }

  if (input.kind === 'FC') {
    if (params.metric !== MODEL_PIPELINE_CONTRACT.wpliMetric) {
      throw new Error('FC 特征必须声明 metric=wpli。');
    }

    if (!sameNumbers(numericTuple(params.shape), MODEL_PIPELINE_CONTRACT.wpliShape)) {
      throw new Error('WPLI 特征形状必须是 [1891,6]。');
    }
  }
}

export function assertMatchingStringSets(actual: readonly string[], expected: readonly string[], label: string): void {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();

  // Sorting preserves duplicate counts, so this comparison is intentionally multiset-sensitive.
  if (
    actualSorted.length !== expectedSorted.length ||
    actualSorted.some((value, index) => value !== expectedSorted[index])
  ) {
    throw new Error(`${label} 不一致。`);
  }
}
