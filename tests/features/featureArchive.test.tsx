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
  const listFeatureArtifacts = vi.fn().mockResolvedValue([
    {
      id: 'feature-1',
      patientId: 'patient-1',
      subjectCode: 'sub01',
      kind: 'PSD',
      state: 'EO',
      filePath: 'F:\\features\\sub01_psd_eo.npz',
      fileFormat: 'npz',
      fileSize: 2048,
      featureCount: 5580,
      params: { method: 'welch', bands: 'delta/theta/alpha/beta/gamma' },
      preview: { plotCount: 2 },
      existsOnDisk: true,
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
    },
  ]);
  const openFeatureArtifact = vi.fn().mockResolvedValue({ ok: true, message: '已打开特征文件。' });

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
      listFeatureOverview: vi.fn().mockResolvedValue([]),
      listFeatureArtifacts,
      openFeatureArtifact,
      listPredictionModels: vi.fn().mockResolvedValue([]),
      listPredictionQueue: vi.fn().mockResolvedValue([]),
      listExplanationOverview: vi.fn().mockResolvedValue([]),
      listExplanationArtifacts: vi.fn().mockResolvedValue([]),
      listPatientReports: vi.fn().mockResolvedValue([]),
    },
    tasks: {
      listTasks: vi.fn().mockResolvedValue([]),
      listTaskLogs: vi.fn().mockResolvedValue([]),
    },
    settings: {
      getSettings: vi.fn().mockResolvedValue(null),
      updateSettings: vi.fn(),
    },
  } as unknown as NeuroPredictBridge;

  return { listFeatureArtifacts, openFeatureArtifact };
}

afterEach(() => {
  delete window.neuroPredict;
  vi.restoreAllMocks();
});

describe('Feature archive view', () => {
  it('loads backend feature artifacts and opens a selected feature file', async () => {
    const user = userEvent.setup();
    const bridge = installBridge();

    render(<App />);

    await user.click(screen.getByRole('button', { name: '特征档案库' }));

    const artifactRow = await screen.findByRole('row', { name: /sub01_psd_eo\.npz/ });
    expect(within(artifactRow).getByText('sub01')).toBeInTheDocument();
    expect(within(artifactRow).getByText('PSD')).toBeInTheDocument();
    expect(within(artifactRow).getByText('EO')).toBeInTheDocument();
    expect(within(artifactRow).getByText('5580')).toBeInTheDocument();
    expect(within(artifactRow).getByText(/welch/)).toBeInTheDocument();

    await user.click(within(artifactRow).getByRole('button', { name: '打开特征文件 sub01_psd_eo.npz' }));

    expect(bridge.listFeatureArtifacts).toHaveBeenCalledWith(undefined);
    expect(bridge.openFeatureArtifact).toHaveBeenCalledWith('feature-1');
    expect(await screen.findByText('已打开特征文件。')).toBeInTheDocument();
  });
});
