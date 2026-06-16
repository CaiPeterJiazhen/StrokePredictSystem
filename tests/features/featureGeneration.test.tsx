import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import type { NeuroPredictBridge } from '../../src/electron/preload';

const workbenchData = {
  patients: [
    {
      id: 'sub01',
      patientId: 'patient-1',
      hand: '左手',
      eo: true,
      ec: true,
      preStatus: '已完成',
      featStatus: '已完成',
      task: 'tACS_Outcome',
      predict: '-',
      prob: null,
      report: '未生成',
    },
  ],
  tasks: { running: [], manual: [], failed: [] },
  logs: [],
  dataRoot: 'F:\\data',
};

function installBridge() {
  const createFeatureGenerationBatch = vi.fn().mockResolvedValue({
    ok: true,
    message: '已创建 1 个特征生成任务。',
    batchId: 'feature-batch-1',
    queuedTasks: 1,
    skippedPatients: [],
  });
  const listFeatureOverview = vi.fn().mockResolvedValue([
    {
      patientId: 'patient-1',
      subjectCode: 'sub01',
      patientName: '穆祥贵',
      featureStatus: '已完成',
      psdCount: 1,
      fcCount: 1,
      summaryCount: 0,
      previewCount: 0,
      latestFeatureAt: '2026-06-14T00:00:00.000Z',
      hasEegFeatures: true,
    },
  ]);

  window.neuroPredict = {
    platform: 'win32',
    database: {
      getWorkbenchData: vi.fn().mockResolvedValue(workbenchData),
      getDataLibraryStatus: vi.fn().mockResolvedValue({
        sourceRoot: null,
        indexedFiles: 0,
        missingFiles: 0,
        backedUpDocuments: 0,
        manualReviewItems: 0,
        lastScanMessage: '',
      }),
      listPatientAssetSummary: vi.fn().mockResolvedValue([]),
      listFeatureOverview,
      createFeatureGenerationBatch,
    },
    tasks: {
      listTasks: vi.fn().mockResolvedValue([]),
      listTaskLogs: vi.fn().mockResolvedValue([]),
    },
      settings: {
      getSettings: vi.fn().mockResolvedValue({
        dataRoot: 'F:\\data',
        outputRoot: 'F:\\out',
        matlabExecutable: '',
        eeglabPath: '',
        defaultElectrodeLocationFile: '',
        pythonExecutable: 'F:\\tools\\python.exe',
        featureGeneratorScript: 'F:\\engines\\generate_features.py',
        predictionScript: '',
        explainabilityScript: '',
        modelLibraryRoot: 'F:\\models',
        defaultDownsampleRate: '500',
        defaultHighPassHz: '1',
        defaultLowPassHz: '45',
        defaultNotchHz: '50',
      }),
      updateSettings: vi.fn(),
    },
  } as unknown as NeuroPredictBridge;

  return { createFeatureGenerationBatch, listFeatureOverview };
}

afterEach(() => {
  delete window.neuroPredict;
  vi.restoreAllMocks();
});

describe('Feature generation view', () => {
  it('loads backend feature overview and queues a feature generation task', async () => {
    const user = userEvent.setup();
    const bridge = installBridge();

    render(<App />);

    await user.click(screen.getByRole('button', { name: '特征生成与查看' }));

    const patientRow = await screen.findByRole('row', { name: /sub01/ });
    expect(within(patientRow).getByText('穆**')).toBeInTheDocument();
    expect(within(patientRow).queryByText('穆')).not.toBeInTheDocument();
    expect(within(patientRow).queryByText('穆祥贵')).not.toBeInTheDocument();
    expect(within(patientRow).getByText('PSD 1')).toBeInTheDocument();
    expect(within(patientRow).getByText('FC 1')).toBeInTheDocument();
    expect(within(patientRow).getByText('已完成')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '为当前患者创建任务' }));

    expect(bridge.createFeatureGenerationBatch).toHaveBeenCalledWith({
      patientIds: ['patient-1'],
      featureKinds: ['PSD', 'FC'],
      states: ['EO', 'EC'],
      overwrite: false,
      params: {
        bands: ['delta', 'theta', 'alpha', 'beta', 'gamma'],
        executor: {
          executablePath: 'F:\\tools\\python.exe',
          scriptPath: 'F:\\engines\\generate_features.py',
          extraArgs: [],
        },
      },
    });
    expect(await screen.findByText('已创建 1 个特征生成任务。')).toBeInTheDocument();
  });
});
