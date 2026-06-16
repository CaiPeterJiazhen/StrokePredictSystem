import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import App from '../../src/App';
import type { NeuroPredictBridge } from '../../src/electron/preload';

describe('model interpretation backend integration', () => {
  afterEach(() => {
    delete window.neuroPredict;
    vi.restoreAllMocks();
  });

  it('keeps patient contribution rows limited to EEG PSD and WPLI features', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '模型解释性' }));

    expect(await screen.findByText('各标志性特征对结局的具体贡献极性：')).toBeInTheDocument();
    expect(screen.getAllByText(/PSD|WPLI|wPLI/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/基线 FM-UE|患者年龄|Clinical|量表/)).not.toBeInTheDocument();
  });

  it('loads explanation artifacts, queues explanation tasks, and opens artifact files', async () => {
    const user = userEvent.setup();
    const createExplainabilityBatch = vi.fn().mockResolvedValue({
      ok: true,
      message: '已创建 1 个解释性任务。',
      batchId: 'explainability-batch-1',
      queuedTasks: 1,
      skippedPatients: [],
    });
    const openExplanationArtifact = vi.fn().mockResolvedValue({
      ok: true,
      message: '已打开解释性文件。',
    });
    const deleteExplanationArtifact = vi.fn().mockResolvedValue({
      ok: true,
      message: '已删除解释性产物 sub01 SHAP force plot。',
    });
    const explanationArtifact = {
      id: 'explanation-1',
      patientId: 'patient-1',
      subjectCode: 'sub01',
      patientName: '穆祥贵',
      taskId: 'pr',
      modelId: 'm2',
      modelName: 'RandomForest_Baseline',
      modelVersion: 'v1.5.2',
      artifactType: 'patient_shap',
      title: 'sub01 SHAP force plot',
      method: 'SHAP',
      filePath: 'F:\\explainability\\sub01_shap.svg',
      fileFormat: 'svg',
      fileSize: 12,
      topFeatures: [{ name: 'Oz Alpha PSD', score: 0.22, modality: 'PSD', direction: 'positive' }],
      preview: { baseValue: 0.52, outputValue: 0.87 },
      existsOnDisk: true,
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
    };

    window.neuroPredict = {
      platform: 'win32',
      database: {
        getWorkbenchData: vi.fn().mockResolvedValue({
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
              predict: '比例恢复',
              prob: 0.87,
              report: '未生成',
            },
          ],
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
        listPredictionModels: vi.fn().mockResolvedValue([
          {
            id: 'm2',
            taskId: 'pr',
            name: 'RandomForest_Baseline',
            version: 'v1.5.2',
            inputType: 'EEG-only',
            inputs: ['PSD', 'FC'],
            validation: 'LOSO',
            accuracy: 0.782,
            balancedAccuracy: 0.75,
            rocAuc: 0.83,
            prAuc: 0.8,
            status: '当前版本',
            artifactPath: '',
            createdAt: '2026-06-14T00:00:00.000Z',
            updatedAt: '2026-06-14T00:00:00.000Z',
          },
        ]),
        listPredictionQueue: vi.fn().mockResolvedValue([
          {
            patientId: 'patient-1',
            subjectCode: 'sub01',
            patientName: '穆祥贵',
            taskId: 'pr',
            hasEegFeatures: true,
            hasClinical: true,
            prediction: '比例恢复',
            probability: 0.87,
            modelUsed: 'RandomForest_Baseline v1.5.2',
            status: '已完成',
            explanationStatus: '已生成',
            submittedAt: '2026-06-14T00:00:00.000Z',
          },
        ]),
        listExplanationArtifacts: vi.fn().mockResolvedValue([explanationArtifact]),
        listExplanationOverview: vi.fn().mockResolvedValue([
          {
            patientId: 'patient-1',
            subjectCode: 'sub01',
            patientName: '穆祥贵',
            taskId: 'pr',
            prediction: '比例恢复',
            probability: 0.87,
            modelUsed: 'RandomForest_Baseline v1.5.2',
            explanationStatus: '已生成',
            artifactCount: 1,
            topFeatureName: 'Oz Alpha PSD',
            latestExplanationAt: '2026-06-14T00:00:00.000Z',
          },
        ]),
        createExplainabilityBatch,
        openExplanationArtifact,
        deleteExplanationArtifact,
        listPatientReports: vi.fn().mockResolvedValue([]),
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
          featureGeneratorScript: '',
          predictionScript: '',
          explainabilityScript: 'F:\\engines\\explain_recovery.py',
          modelLibraryRoot: 'F:\\models',
          defaultDownsampleRate: '500',
          defaultHighPassHz: '1',
          defaultLowPassHz: '45',
          defaultNotchHz: '50',
        }),
        updateSettings: vi.fn(),
      },
    } as unknown as NeuroPredictBridge;

    render(<App />);

    await user.click(screen.getByRole('button', { name: '模型解释性' }));
    expect(await screen.findByText('sub01 SHAP force plot')).toBeInTheDocument();
    expect(screen.getAllByText('Oz Alpha PSD').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '生成解释性任务' }));

    await waitFor(() => {
      expect(createExplainabilityBatch).toHaveBeenCalledWith({
        taskId: 'pr',
        modelId: 'm2',
        patientIds: ['patient-1'],
        artifactTypes: ['global_importance', 'patient_shap', 'psd_heatmap', 'fc_network'],
        executor: {
          executablePath: 'F:\\tools\\python.exe',
          scriptPath: 'F:\\engines\\explain_recovery.py',
          extraArgs: [],
        },
      });
    });
    expect(await screen.findByText('已创建 1 个解释性任务。')).toBeInTheDocument();

    const artifactRow = screen.getByRole('row', { name: /sub01 SHAP force plot/ });
    await user.click(within(artifactRow).getByRole('button', { name: '打开解释文件 sub01 SHAP force plot' }));

    expect(openExplanationArtifact).toHaveBeenCalledWith('explanation-1');
    expect(await screen.findByText('已打开解释性文件。')).toBeInTheDocument();

    await user.click(within(artifactRow).getByRole('button', { name: '删除解释文件 sub01 SHAP force plot' }));

    expect(deleteExplanationArtifact).toHaveBeenCalledWith('explanation-1');
    expect(await screen.findByText('已删除解释性产物 sub01 SHAP force plot。')).toBeInTheDocument();
  });
});
