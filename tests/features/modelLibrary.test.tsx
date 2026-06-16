import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import type { NeuroPredictBridge } from '../../src/electron/preload';

function installBridge() {
  const listPredictionModels = vi.fn().mockResolvedValue([
    {
      id: 'locked-swa',
      taskId: 'pr',
      name: 'ResidualAware_SSL_CNN',
      version: 'swa_clsalpha1',
      inputType: 'EEG-only',
      inputs: ['PSD', 'wPLI', 'EO/EC state'],
      validation:
        'Final locked main model; seeds 0/1/2/3/4/5/7/13/21/42; Acc 0.8474; BAcc 0.8411; Sens 0.9600; Spec 0.7223; Brier 0.1324; source final_Residual_ssl_cnn.csv',
      accuracy: 0.842105,
      balancedAccuracy: 0.833333,
      rocAuc: 0.844444,
      prAuc: 0.836025,
      status: '当前版本',
      artifactPath: 'F:\\models\\residualaware_highrank_swa_clsalpha1.pt',
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
    },
  ]);

  window.neuroPredict = {
    platform: 'win32',
    database: {
      getWorkbenchData: vi.fn().mockResolvedValue({
        patients: [],
        tasks: { running: [], manual: [], failed: [] },
        logs: [],
        dataRoot: 'F:\\data',
      }),
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
      listFeatureArtifacts: vi.fn().mockResolvedValue([]),
      listPredictionModels,
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

  return { listPredictionModels };
}

afterEach(() => {
  delete window.neuroPredict;
  vi.restoreAllMocks();
});

describe('Model library view', () => {
  it('renders backend prediction models instead of static prototype models', async () => {
    const user = userEvent.setup();
    const bridge = installBridge();

    render(<App />);

    await user.click(screen.getByRole('button', { name: '模型库' }));

    const modelCard = await screen.findByText('ResidualAware_SSL_CNN');
    const card = modelCard.closest('article') ?? modelCard.closest('div')?.parentElement?.parentElement;

    expect(modelCard).toBeInTheDocument();
    expect(screen.getByText('swa_clsalpha1')).toBeInTheDocument();
    expect(screen.getByText('EEG-only')).toBeInTheDocument();
    expect(screen.getByText(/PSD, wPLI, EO\/EC state/)).toBeInTheDocument();
    expect(screen.getByText('10-seed patient-level LOSO cross-validation')).toBeInTheDocument();
    expect(screen.queryByText(/seeds 0\/1\/2\/3\/4\/5\/7\/13\/21\/42/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sens 0\.9600|Brier 0\.1324|source final_Residual_ssl_cnn\.csv/)).not.toBeInTheDocument();
    expect(screen.getByText('84.2%')).toBeInTheDocument();
    expect(screen.queryByText('SVM_RBF_Optimized')).not.toBeInTheDocument();

    if (card) {
      expect(within(card).getByText('当前版本')).toBeInTheDocument();
    }
    expect(bridge.listPredictionModels).toHaveBeenCalledWith('pr');
  });
});
