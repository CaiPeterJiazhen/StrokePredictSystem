import { describe, expect, it } from 'vitest';
import {
  MODEL_PIPELINE_CONTRACT,
  assertAffectedSideForModelPipeline,
  assertFeatureArtifactContract,
  assertMatchingStringSets,
  buildFeatureGenerationContract,
  normalizeAffectedSide,
} from '../../../src/electron/backend/modelPipelineContract.js';

describe('model pipeline contract helpers', () => {
  it('exports the locked EEG feature contract', () => {
    expect(MODEL_PIPELINE_CONTRACT).toEqual({
      requiredStates: ['EO', 'EC'],
      alignment: 'right_affected_c3',
      psdShape: [62, 90],
      wpliShape: [1891, 6],
      wpliMetric: 'wpli',
      explainabilityTarget: 'classification_logit',
    });
  });

  it('normalizes affected-side text from patient records', () => {
    expect(normalizeAffectedSide('左手')).toBe('left');
    expect(normalizeAffectedSide('右手')).toBe('right');
    expect(normalizeAffectedSide('左肢不利 (RH)')).toBe('left');
    expect(normalizeAffectedSide('右肢不利 (LH)')).toBe('right');
    expect(normalizeAffectedSide('双手')).toBe('bilateral');
    expect(normalizeAffectedSide('')).toBeNull();
  });

  it('requires affected-side information before strict model packages are built', () => {
    expect(() => assertAffectedSideForModelPipeline('')).toThrow('最终模型需要患侧信息');
    expect(() => assertAffectedSideForModelPipeline('上肢')).toThrow('不支持的患侧信息: 上肢');
    expect(assertAffectedSideForModelPipeline('左手')).toBe('left');
  });

  it('builds the common feature generation contract', () => {
    expect(buildFeatureGenerationContract('右手')).toEqual({
      requiredStates: ['EO', 'EC'],
      affectedSide: 'right',
      alignment: 'right_affected_c3',
      features: {
        PSD: { shape: [62, 90] },
        FC: { metric: 'wpli', shape: [1891, 6] },
      },
    });
  });

  it('rejects feature artifacts with mismatched shape, metric, or alignment', () => {
    expect(() =>
      assertFeatureArtifactContract({
        kind: 'PSD',
        state: 'EO',
        params: { shape: [62, 89], alignment: 'right_affected_c3' },
      }),
    ).toThrow('PSD 特征形状必须是 [62,90]');

    expect(() =>
      assertFeatureArtifactContract({
        kind: 'PSD',
        state: 'EO',
        params: { shape: ['62', '90'], alignment: 'right_affected_c3' },
      }),
    ).toThrow('PSD 特征形状必须是 [62,90]');

    expect(() =>
      assertFeatureArtifactContract({
        kind: 'FC',
        state: 'EC',
        params: { shape: [1891, 6], metric: 'plv', alignment: 'right_affected_c3' },
      }),
    ).toThrow('FC 特征必须声明 metric=wpli');

    expect(() =>
      assertFeatureArtifactContract({
        kind: 'FC',
        state: 'EC',
        params: { shape: [1891, 6], metric: 'wpli', alignment: 'native' },
      }),
    ).toThrow('特征必须声明 alignment=right_affected_c3');
  });

  it('requires PSD and FC artifacts to use EO or EC states', () => {
    expect(() =>
      assertFeatureArtifactContract({
        kind: 'PSD',
        state: 'UNKNOWN',
        params: { shape: [62, 90], alignment: 'right_affected_c3' },
      }),
    ).toThrow('特征状态必须是 EO 或 EC');

    expect(() =>
      assertFeatureArtifactContract({
        kind: 'FC',
        state: 'EO_EC',
        params: { shape: [1891, 6], metric: 'wpli', alignment: 'right_affected_c3' },
      }),
    ).toThrow('特征状态必须是 EO 或 EC');
  });

  it('accepts valid strict PSD and FC feature artifacts', () => {
    expect(() =>
      assertFeatureArtifactContract({
        kind: 'PSD',
        state: 'EO',
        params: { shape: [62, 90], alignment: 'right_affected_c3' },
      }),
    ).not.toThrow();

    expect(() =>
      assertFeatureArtifactContract({
        kind: 'FC',
        state: 'EC',
        params: { shape: [1891, 6], metric: 'wpli', alignment: 'right_affected_c3' },
      }),
    ).not.toThrow();
  });

  it('compares provenance ID sets without depending on order', () => {
    expect(() => assertMatchingStringSets(['b', 'a'], ['a', 'b'], 'featureArtifactIds')).not.toThrow();
    expect(() => assertMatchingStringSets(['a'], ['a', 'b'], 'featureArtifactIds')).toThrow(
      'featureArtifactIds 不一致',
    );
  });
});
