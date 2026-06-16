import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import App from '../../src/App';
import type { NeuroPredictBridge } from '../../src/electron/preload';

describe('Gemini batch prediction view', () => {
  const openPredictView = async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '批量预测' }));

    return user;
  };

  const getPatientRow = (patientId: string) =>
    screen.getByRole('row', { name: new RegExp(patientId) });

  it('shows the locked label definition and model selection layout', async () => {
    await openPredictView();

    expect(screen.getByText('批量预测控制台')).toBeInTheDocument();
    expect(screen.getByText('标签定义与模型选择')).toBeInTheDocument();
    expect(screen.getAllByText('比例恢复 (PR) vs 恢复不良').length).toBeGreaterThan(0);
    expect(screen.getByText('ResidualAware_SSL_CNN')).toBeInTheDocument();
    expect(screen.getByText('最终锁定模型')).toBeInTheDocument();
    expect(screen.getByText('Acc 84.7% · ROC-AUC 0.887')).toBeInTheDocument();
    expect(screen.queryByText('SVM_RBF_Optimized')).not.toBeInTheDocument();
    expect(screen.queryByText('RandomForest_Baseline')).not.toBeInTheDocument();
    expect(screen.queryByText(/Sens|Spec|Brier|scripts\//)).not.toBeInTheDocument();
  });

  it('does not skip patients only because clinical data are missing for the final EEG-only model', async () => {
    await openPredictView();

    const missingClinicalRow = getPatientRow('sub03');

    expect(within(missingClinicalRow).getByText('临床基线')).toHaveClass(
      'bg-rose-50',
    );
    expect(within(missingClinicalRow).queryByText('缺数据, 跳过')).not.toBeInTheDocument();
    expect(within(missingClinicalRow).getByText('未跑模型')).toBeInTheDocument();
  });

  it('keeps the final EEG-only model selected without showing the clinical skip state', async () => {
    await openPredictView();

    const missingClinicalRow = getPatientRow('sub03');

    expect(
      within(missingClinicalRow).queryByText('缺数据, 跳过'),
    ).not.toBeInTheDocument();
    expect(within(missingClinicalRow).getByText('未跑模型')).toBeInTheDocument();
  });

  it('loads backend prediction models and queues backend batch prediction from the active app', async () => {
    const user = userEvent.setup();
    const runBatchPrediction = vi.fn().mockResolvedValue({
      ok: true,
      message: '已创建 1 个预测任务。',
      batchId: 'prediction-batch-1',
      queuedTasks: 1,
      skippedPatients: [],
    });
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
              predict: '-',
              prob: null,
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
            id: 'm1',
            taskId: 'pr',
            name: 'Logistic_L1_PSD_WPLI',
            version: 'paper_loso_baseline',
            inputType: 'EEG-only',
            inputs: ['PSD', 'WPLI'],
            validation: 'scripts/04_train_ml_baselines.py; Acc 0.7368; BAcc 0.7333; Sens 0.8000',
            accuracy: 0.7368,
            balancedAccuracy: 0.7333,
            rocAuc: 0.7111,
            prAuc: 0.7754,
            status: '归档版本',
            artifactPath: '',
            createdAt: '2026-06-14T00:00:00.000Z',
            updatedAt: '2026-06-14T00:00:00.000Z',
          },
          {
            id: 'm2',
            taskId: 'pr',
            name: 'ResidualAware_SSL_CNN',
            version: 'locked_10seed_final',
            inputType: 'EEG-only',
            inputs: ['PSD', 'WPLI', 'EO', 'EC'],
            validation: 'Final locked main model; Acc 0.8474; BAcc 0.8411; Sens 0.9600; Spec 0.7223; Brier 0.1324',
            accuracy: 0.8474,
            balancedAccuracy: 0.8411,
            rocAuc: 0.8867,
            prAuc: 0.891,
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
            hasClinical: false,
            prediction: null,
            probability: null,
            modelUsed: '-',
            status: '待处理',
            explanationStatus: '未生成',
            submittedAt: '',
          },
        ]),
        runBatchPrediction,
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
          predictionScript: 'F:\\engines\\predict_recovery.py',
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

    render(<App />);

    await user.click(screen.getByRole('button', { name: '批量预测' }));
    expect(await screen.findByText('ResidualAware_SSL_CNN')).toBeInTheDocument();
    expect(screen.queryByText('Logistic_L1_PSD_WPLI')).not.toBeInTheDocument();
    const patientRow = await screen.findByRole('row', { name: /sub01/ });
    expect(within(patientRow).getByText('穆**')).toBeInTheDocument();
    expect(within(patientRow).queryByText('穆')).not.toBeInTheDocument();
    expect(within(patientRow).queryByText('穆祥贵')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '开始批量预测' }));

    expect(runBatchPrediction).toHaveBeenCalledWith({
      taskId: 'pr',
      modelId: 'm2',
      patientIds: ['patient-1'],
      executor: {
        executablePath: 'F:\\tools\\python.exe',
        scriptPath: 'F:\\engines\\predict_recovery.py',
        extraArgs: [],
      },
    });
    expect(await screen.findByText('已创建 1 个预测任务。')).toBeInTheDocument();
  });
});

afterEach(() => {
  delete window.neuroPredict;
  vi.restoreAllMocks();
});
