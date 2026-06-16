import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App';
import type { BackendSettings } from '../../src/domain/backendTypes';

const oldSettings: BackendSettings = {
  dataRoot: 'D:\\Stroke\\raw',
  outputRoot: 'D:\\Stroke\\derivatives',
  matlabExecutable: 'old-matlab.exe',
  eeglabPath: 'D:\\Tools\\eeglab',
  defaultElectrodeLocationFile: 'D:\\Tools\\standard-10-5-cap385.elp',
  pythonExecutable: 'D:\\Python311\\python.exe',
  featureGeneratorScript: 'D:\\StrokePredict\\engines\\generate_features.py',
  predictionScript: 'D:\\StrokePredict\\engines\\predict_recovery.py',
  explainabilityScript: 'D:\\StrokePredict\\engines\\explain_recovery.py',
  modelLibraryRoot: 'D:\\StrokePredict\\models',
  defaultDownsampleRate: '500',
  defaultHighPassHz: '1',
  defaultLowPassHz: '45',
  defaultNotchHz: '50',
};

const installBridge = ({ getSettings = vi.fn().mockResolvedValue(oldSettings), updateSettings = vi.fn().mockResolvedValue(oldSettings) } = {}) => {
  window.neuroPredict = {
    platform: 'win32',
    database: {
      getWorkbenchData: vi.fn().mockResolvedValue({
        patients: [],
        tasks: { running: [], manual: [], failed: [] },
        logs: [],
        dataRoot: oldSettings.dataRoot,
      }),
      listPatients: vi.fn(),
      createPatient: vi.fn(),
      updatePatient: vi.fn(),
      deletePatient: vi.fn(),
      registerEegFile: vi.fn(),
      scanRegisteredEegFiles: vi.fn(),
      importPatientsCsv: vi.fn(),
      scanEegFolder: vi.fn(),
    },
    settings: {
      getSettings,
      updateSettings,
    },
    tasks: {
      listTasks: vi.fn(),
      listTaskLogs: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
      startNextQueuedTask: vi.fn(),
      createPreprocessBatch: vi.fn(),
      completePreprocessManualStep: vi.fn(),
      markManualStepCompleted: vi.fn(),
      getPreprocessOutputs: vi.fn(),
      launchPreprocessManualStep: vi.fn(),
      preparePreprocessMatlabExecution: vi.fn(),
      runPreprocessMatlabExecution: vi.fn(),
      startMatlabSession: vi.fn(),
      getMatlabSessionStatus: vi.fn(),
    },
  };

  return window.neuroPredict!;
};

describe('settings persistence in the active app', () => {
  afterEach(() => {
    delete window.neuroPredict;
  });

  it('loads existing MATLAB settings and saves the edited value through the bridge', async () => {
    const user = userEvent.setup();
    const bridge = installBridge({
      updateSettings: vi.fn().mockImplementation(async (input) => ({ ...oldSettings, ...input })),
    });

    render(<App />);

    await user.click(screen.getByRole('button', { name: '环境设置' }));

    const matlabInput = await screen.findByLabelText('MATLAB 可执行文件路径 (matlab.exe)');
    const pythonInput = await screen.findByLabelText('Python 可执行文件路径 (python.exe)');
    const predictionScriptInput = await screen.findByLabelText('预测脚本路径');
    expect(matlabInput).toHaveValue('old-matlab.exe');
    expect(pythonInput).toHaveValue('D:\\Python311\\python.exe');
    expect(predictionScriptInput).toHaveValue('D:\\StrokePredict\\engines\\predict_recovery.py');

    await user.clear(matlabInput);
    await user.type(matlabInput, 'new-matlab.exe');
    await user.clear(pythonInput);
    await user.type(pythonInput, 'D:\\Python312\\python.exe');
    await user.click(screen.getByRole('button', { name: '保存所有设置' }));

    await waitFor(() => {
      expect(bridge.settings.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          matlabExecutable: 'new-matlab.exe',
          pythonExecutable: 'D:\\Python312\\python.exe',
          predictionScript: 'D:\\StrokePredict\\engines\\predict_recovery.py',
        }),
      );
    });
    expect(await screen.findByText('环境设置已保存到本地数据库。')).toBeInTheDocument();
  });

  it('shows a visible message when settings loading fails without breaking render', async () => {
    const user = userEvent.setup();
    installBridge({
      getSettings: vi.fn().mockRejectedValue(new Error('settings database locked')),
    });

    render(<App />);

    await user.click(screen.getByRole('button', { name: '环境设置' }));

    expect(await screen.findByText('加载环境设置失败：settings database locked')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '环境与依赖设置' })).toBeInTheDocument();
  });
});
