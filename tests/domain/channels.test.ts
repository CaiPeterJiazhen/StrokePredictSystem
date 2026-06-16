import {
  AUXILIARY_CHANNELS,
  EEG_CHANNELS_64,
  RAW_CHANNELS_68,
  getInterpolationCandidates,
  getReferenceConflict,
  isAuxiliaryChannel,
} from '../../src/domain/channels';
import {
  modelVersions,
  mockPatients,
  navItems,
  predictionQueue,
  predictionTasks,
} from '../../src/domain/mockData';

describe('domain channel utilities', () => {
  it('exposes 64 EEG channels plus 4 auxiliary channels for raw import', () => {
    expect(EEG_CHANNELS_64).toHaveLength(64);
    expect(AUXILIARY_CHANNELS).toEqual(['HEO', 'VEO', 'EKG', 'EMG']);
    expect(RAW_CHANNELS_68).toHaveLength(68);
    expect(RAW_CHANNELS_68).toEqual([...EEG_CHANNELS_64, ...AUXILIARY_CHANNELS]);
    expect(new Set(RAW_CHANNELS_68)).toHaveLength(68);
  });

  it('identifies HEO, VEO, EKG, and EMG as auxiliary channels', () => {
    expect(AUXILIARY_CHANNELS.every(isAuxiliaryChannel)).toBe(true);
    expect(isAuxiliaryChannel(' heo ')).toBe(true);
    expect(isAuxiliaryChannel('Fz')).toBe(false);
    expect(isAuxiliaryChannel('M1')).toBe(false);
    expect(isAuxiliaryChannel(' m1 ')).toBe(false);
  });

  it('warns when M1/M2 reference channels were removed using removed list first', () => {
    expect(getReferenceConflict(['M1', 'M2'], 'average')).toBeNull();
    expect(getReferenceConflict([], 'm1m2')).toBeNull();
    expect(getReferenceConflict(['M1'], 'm1m2')).toContain('M1');
    expect(getReferenceConflict([' m1 '], 'm1m2')).toContain('M1');
    expect(getReferenceConflict(['M2'], 'm1m2')).toContain('M2');
    expect(getReferenceConflict(['M1', 'M2'], 'm1m2')).toContain('M1\u3001M2');
  });

  it('returns interpolation candidates excluding auxiliary and removed channels', () => {
    const candidates = getInterpolationCandidates(['M1', 'Fz', 'HEO']);

    expect(candidates).toHaveLength(62);
    expect(candidates).toContain('Fp1');
    expect(candidates).not.toContain('M1');
    expect(candidates).not.toContain('Fz');
    expect(candidates).not.toContain('HEO');
    expect(candidates).not.toContain('VEO');
    expect(candidates.every((channel) => !isAuxiliaryChannel(channel))).toBe(true);
  });
});

describe('domain mock data contracts', () => {
  it('provides the planned navigation pages in order', () => {
    expect(navItems.map((item) => item.id)).toEqual([
      'workbench',
      'batch',
      'preprocess',
      'feature',
      'archive',
      'models',
      'predict',
      'interpret',
      'report',
      'settings',
    ]);
  });

  it('defines prediction tasks using the Residual <= 1.5 label', () => {
    expect(
      predictionTasks.every((task) => task.labelDefinition === 'Residual <= 1.5'),
    ).toBe(true);
  });

  it('separates EEG-only and EEG+Clinical model versions with validation metrics', () => {
    expect(modelVersions.map((model) => model.inputType)).toEqual(
      expect.arrayContaining(['EEG-only', 'EEG+Clinical']),
    );
    expect(
      modelVersions.every(
        (model) =>
          model.inputs.length > 0 &&
          model.validation.length > 0 &&
          model.accuracy > 0 &&
          model.balancedAccuracy > 0 &&
          model.rocAuc > 0 &&
          model.prAuc > 0,
      ),
    ).toBe(true);
  });

  it('exposes patient rows with a positive-class probability label', () => {
    expect(
      mockPatients.every(
        (patient) => patient.probabilityLabel === 'Residual <= 1.5',
      ),
    ).toBe(true);
    expect(
      mockPatients
        .filter((patient) => patient.prediction === null)
        .every((patient) => patient.probability === null),
    ).toBe(true);
  });

  it('keeps the P-2026-003 queue row aligned to the 4-week patient task', () => {
    const patient = mockPatients.find((item) => item.id === 'P-2026-003');
    const queueRow = predictionQueue.find((item) => item.patientId === 'P-2026-003');

    expect(patient?.task).toContain('4 周');
    expect(queueRow?.taskId).toBe('residual-4w');
    expect(queueRow?.modelUsed).toBe('stroke-tacs-eeg v2.3.0');
  });

  it('exposes queue rows with nullable prediction results before inference completes', () => {
    expect(
      predictionQueue.every(
        (row) =>
          typeof row.hasEegFeatures === 'boolean' &&
          typeof row.hasClinical === 'boolean' &&
          row.probabilityLabel === 'Residual <= 1.5' &&
          (row.probability === null || typeof row.probability === 'number') &&
          (row.prediction === null || row.prediction.length > 0) &&
          row.modelUsed.length > 0 &&
          row.explanationStatus.length > 0,
      ),
    ).toBe(true);

    expect(
      predictionQueue
        .filter((row) => row.status === '已完成')
        .every((row) => row.prediction !== null && row.probability !== null),
    ).toBe(true);
    expect(
      predictionQueue
        .filter((row) => row.status !== '已完成')
        .every((row) => row.prediction === null && row.probability === null),
    ).toBe(true);
  });
});
