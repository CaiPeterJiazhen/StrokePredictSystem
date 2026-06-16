import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App';

const buildWorkbenchData = (overrides = {}) => ({
  patients: [
    {
      id: 'sub01',
      patientId: 'patient-sub01',
      hand: '右肢不利 (LH)',
      eo: true,
      ec: true,
      preStatus: '已完成',
      featStatus: 'PSD/FC 已完成',
      task: 'tACS_Outcome',
      predict: '比例恢复',
      prob: 0.88,
      report: '已生成',
    },
  ],
  tasks: {
    queued: [],
    running: [
      { id: 1, patient: 'sub01', name: 'LIME 解释性图表生成', progress: 85, time: '01:12' },
    ],
    manual: [
      { id: 2, patient: 'sub05', name: 'EEGLAB 坏段手动剔除', action: '打开 EEGLAB' },
    ],
    failed: [
      { id: 3, patient: 'sub07', name: 'wPLI 矩阵计算异常 (OOM)', action: '降低内存重试' },
    ],
  },
  logs: [
    "[INFO] 10:00:15 - 初始化环境: Project='2026_tACS_MultiCenter'",
    '[WARN] 10:01:05 - sub08 扫描目录未发现 EC (Eyes Closed) 数据.',
  ],
  dataRoot: 'D:\\Research\\Stroke_tACS_EEG_Data',
  ...overrides,
});

const installBridge = (databaseOverrides = {}) => {
  window.neuroPredict = {
    platform: 'win32',
    database: {
      getWorkbenchData: vi.fn().mockResolvedValue(buildWorkbenchData()),
      runFeatureGenerationExecution: vi.fn(),
      runPredictionExecution: vi.fn(),
      runExplainabilityExecution: vi.fn(),
      listPatients: vi.fn(),
      createPatient: vi.fn(),
      updatePatient: vi.fn(),
      deletePatient: vi.fn(),
      clearWorkspaceData: vi.fn(),
      registerEegFile: vi.fn(),
      scanRegisteredEegFiles: vi.fn(),
      importPatientsCsv: vi.fn().mockResolvedValue({
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [],
      }),
      scanEegFolder: vi.fn().mockResolvedValue({
        scannedFiles: 0,
        registeredFiles: 0,
        unmatchedFiles: [],
      }),
      createBatchSummaryReport: vi.fn().mockResolvedValue({
        ok: true,
        message: '已生成批次汇总：F:\\out\\reports\\batch\\batch-summary.csv',
        report: {
          id: 'batch-report-1',
          format: 'csv',
          status: '已生成',
          filePath: 'F:\\out\\reports\\batch\\batch-summary.csv',
          patientCount: 1,
          generatedAt: '2026-06-15T00:00:00.000Z',
          createdAt: '2026-06-15T00:00:00.000Z',
          updatedAt: '2026-06-15T00:00:00.000Z',
        },
      }),
      ...databaseOverrides,
    },
    settings: {
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
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
    },
  };
  return window.neuroPredict!;
};

describe('Gemini patient workbench shell', () => {
  afterEach(() => {
    delete window.neuroPredict;
  });

  it('renders the Gemini desktop shell and patient workbench by default', async () => {
    render(<App />);

    expect(
      screen.getByText('NeuroPredict: tACS EEG 康复结局预测系统 v1.2.0'),
    ).toBeInTheDocument();
    expect(screen.getByText('当前项目:')).toBeInTheDocument();
    expect(
      screen.getByText('脑卒中基线 EEG-tACS 康复预测队列'),
    ).toBeInTheDocument();
    expect(screen.getByText('患者队列')).toBeInTheDocument();
    expect(await screen.findByText('P-2026-001')).toBeInTheDocument();
    expect(screen.getAllByText('EO').length).toBeGreaterThan(0);
    expect(screen.getAllByText('EC').length).toBeGreaterThan(0);
  });

  it('keeps the right task panel and log panel interactions from the design', async () => {
    const user = userEvent.setup();
    installBridge();

    render(<App />);

    expect(await screen.findByRole('button', { name: '人工任务 (1)' })).toHaveClass(
      'text-blue-600',
    );

    await user.click(screen.getByRole('button', { name: '引擎日志' }));

    expect(
      screen.getByText(
        "[INFO] 10:00:15 - 初始化环境: Project='2026_tACS_MultiCenter'",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '[WARN] 10:01:05 - sub08 扫描目录未发现 EC (Eyes Closed) 数据.',
      ),
    ).toHaveClass('text-yellow-400');
  });

  it('deletes a patient and clears the patient workspace from visible controls', async () => {
    const user = userEvent.setup();
    const deletePatient = vi.fn().mockResolvedValue({ ok: true, message: '已删除患者 sub01。' });
    const clearWorkspaceData = vi.fn().mockResolvedValue({
      ok: true,
      message: '已清空患者工作台与数据文档库记录。',
    });
    const getWorkbenchData = vi
      .fn()
      .mockResolvedValueOnce(buildWorkbenchData())
      .mockResolvedValueOnce(buildWorkbenchData({ patients: [] }))
      .mockResolvedValueOnce(buildWorkbenchData({ patients: [] }));
    const bridge = installBridge({
      getWorkbenchData,
      deletePatient,
      clearWorkspaceData,
      getDataLibraryStatus: vi.fn().mockResolvedValue({
        sourceRoot: null,
        indexedFiles: 0,
        missingFiles: 0,
        backedUpDocuments: 0,
        manualReviewItems: 0,
        lastScanMessage: '',
      }),
      listPatientAssetSummary: vi.fn().mockResolvedValue([]),
    });

    render(<App />);

    const patientRow = await screen.findByRole('row', { name: /sub01/ });
    await user.click(within(patientRow).getByRole('button', { name: '删除患者 sub01' }));

    await waitFor(() => {
      expect(deletePatient).toHaveBeenCalledWith('patient-sub01');
    });
    expect(await screen.findByText('已删除患者 sub01。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '清空患者工作台' }));

    await waitFor(() => {
      expect(clearWorkspaceData).toHaveBeenCalledOnce();
    });
    expect(await screen.findByText('已清空患者工作台与数据文档库记录。')).toBeInTheDocument();
    expect(bridge.database.getWorkbenchData).toHaveBeenCalledTimes(3);
  });

  it('resizes the right task panel with the vertical splitter', async () => {
    installBridge();

    render(<App />);

    expect(await screen.findByRole('button', { name: '人工任务 (1)' })).toBeInTheDocument();

    const splitter = screen.getByRole('separator', { name: '调整任务队列面板宽度' });
    const rightPanel = screen.getByTestId('right-task-panel');

    expect(rightPanel).toHaveStyle({ width: '320px' });

    fireEvent.mouseDown(splitter, { clientX: 1500 });
    fireEvent.mouseMove(window, { clientX: 1400 });
    fireEvent.mouseUp(window);

    expect(rightPanel).toHaveStyle({ width: '420px' });
  });

  it('only lists manual preprocessing patients in the right task panel', async () => {
    installBridge({
      getWorkbenchData: vi.fn().mockResolvedValue(
        buildWorkbenchData({
          tasks: {
            queued: [
              {
                id: 'feature-task-1',
                type: 'feature_generation',
                patient: 'sub01',
                name: 'PSD/FC 特征生成',
                action: '等待运行',
              },
            ],
            running: [
              {
                id: 'running-task-1',
                type: 'prediction',
                patient: 'sub02',
                name: '批量预测',
                progress: 40,
                time: '00:20',
              },
            ],
            manual: [
              {
                id: 'manual-task-1',
                type: 'preprocess',
                patient: 'sub03',
                name: '静息态 EEG 预处理',
                action: '打开 EEGLAB 完成人工去除坏段',
                manualFiles: [
                  {
                    condition: 'EO',
                    label: '睁眼',
                    sourceFileName: 'mxg1.cnt',
                    stageFileName: 'mxg1_stage01_before_bad_segment.set',
                  },
                  {
                    condition: 'EC',
                    label: '闭眼',
                    sourceFileName: 'mxg2.cnt',
                    stageFileName: 'mxg2_stage01_before_bad_segment.set',
                  },
                ],
              },
              {
                id: 'manual-task-2',
                type: 'preprocess',
                patient: 'sub04',
                name: '静息态 EEG 预处理',
                action: '打开 EEGLAB 完成人工去除 ICA 伪迹',
              },
            ],
            failed: [
              {
                id: 'failed-task-1',
                type: 'feature_generation',
                patient: 'sub05',
                name: 'PSD/FC 特征生成失败',
                action: '失败可重试',
              },
            ],
          },
        }),
      ),
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: '人工任务 (2)' })).toBeInTheDocument();
    expect(screen.getByText('等待人工处理患者 (2)')).toBeInTheDocument();
    expect(screen.getByText('打开 EEGLAB 完成人工去除坏段')).toBeInTheDocument();
    expect(screen.getByText('打开 EEGLAB 完成人工去除 ICA 伪迹')).toBeInTheDocument();
    expect(screen.getByText('睁眼 EO')).toBeInTheDocument();
    expect(screen.getByText('闭眼 EC')).toBeInTheDocument();
    expect(screen.getByText('mxg1_stage01_before_bad_segment.set')).toBeInTheDocument();
    expect(screen.getByText('mxg2_stage01_before_bad_segment.set')).toBeInTheDocument();
    expect(screen.queryByText('待执行 (1)')).not.toBeInTheDocument();
    expect(screen.queryByText('正在运行 (1)')).not.toBeInTheDocument();
    expect(screen.queryByText('失败可重试 (1)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '准备 MATLAB 执行' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '运行 MATLAB 预处理' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '打开 EEGLAB' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: '完成坏段并自动保存' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完成伪迹并自动保存' })).toBeInTheDocument();
  });

  it('completes a manual preprocessing checkpoint from the right task panel', async () => {
    const user = userEvent.setup();
    const firstWorkbench = buildWorkbenchData({
      tasks: {
        running: [],
        manual: [
          {
            id: 'preprocess-task-1',
            patient: 'sub05',
            name: '静息态 EEG 预处理',
            action: '打开 EEGLAB 完成人工去除坏段',
          },
        ],
        failed: [],
      },
    });
    const refreshedWorkbench = buildWorkbenchData({
      patients: [
        {
          id: 'sub05',
          patientId: 'patient-sub05',
          hand: '左肢不利 (RH)',
          eo: true,
          ec: true,
          preStatus: '等待人工处理',
          featStatus: '未开始',
          task: 'tACS_Outcome',
          predict: '-',
          prob: null,
          report: '-',
        },
      ],
      tasks: {
        running: [],
        manual: [
          {
            id: 'preprocess-task-1',
            patient: 'sub05',
            name: '静息态 EEG 预处理',
            action: '打开 EEGLAB 完成人工去除 ICA 伪迹',
          },
        ],
        failed: [],
      },
    });
    const bridge = installBridge({
      getWorkbenchData: vi
        .fn()
        .mockResolvedValueOnce(firstWorkbench)
        .mockResolvedValueOnce(refreshedWorkbench),
    });
    vi.mocked(bridge.tasks.completePreprocessManualStep).mockResolvedValue({
      ok: true,
      message: '人工节点已完成：人工去除坏段。下一步请运行 MATLAB 完成坏导插值和 ICA。',
    });
    vi.mocked(bridge.tasks.runPreprocessMatlabExecution).mockResolvedValue({
      ok: true,
      message: 'MATLAB 预处理已执行，已生成 ICA 人工处理文件。请继续人工去除 ICA 伪迹。',
      exitCode: 0,
      stdout: 'stage03 saved',
      stderr: '',
    });

    render(<App />);

    expect(await screen.findByText('静息态 EEG 预处理')).toBeInTheDocument();
    expect(screen.getByText('打开 EEGLAB 完成人工去除坏段')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '完成坏段并自动保存' }));

    await waitFor(() => {
      expect(bridge.tasks.completePreprocessManualStep).toHaveBeenCalledWith('preprocess-task-1');
      expect(bridge.tasks.runPreprocessMatlabExecution).toHaveBeenCalledWith('preprocess-task-1');
    });
    expect(await screen.findByText('MATLAB 预处理已执行，已生成 ICA 人工处理文件。请继续人工去除 ICA 伪迹。')).toBeInTheDocument();
    expect(await screen.findByText('打开 EEGLAB 完成人工去除 ICA 伪迹')).toBeInTheDocument();
  });

  it('does not run MATLAB after completing only one split manual preprocessing file', async () => {
    const user = userEvent.setup();
    const bridge = installBridge({
      getWorkbenchData: vi.fn().mockResolvedValue(buildWorkbenchData({
        tasks: {
          running: [],
          manual: [
            {
              id: 'preprocess-task-1::manual-file::EO',
              patient: 'sub05',
              name: '静息态 EEG 预处理 · 睁眼',
              action: '打开 EEGLAB 完成人工去除坏段（睁眼 EO）',
              manualFiles: [
                {
                  condition: 'EO',
                  label: '睁眼',
                  sourceFileName: 'mxg1.cnt',
                  stageFileName: 'mxg1_stage01_before_bad_segment.set',
                },
              ],
            },
          ],
          failed: [],
        },
      })),
    });
    vi.mocked(bridge.tasks.completePreprocessManualStep).mockResolvedValue({
      ok: true,
      message: '人工节点已完成：人工去除坏段（睁眼 EO）。请继续处理剩余静息态文件。',
    });

    render(<App />);

    expect(await screen.findByText('静息态 EEG 预处理 · 睁眼')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '完成坏段并自动保存' }));

    await waitFor(() => {
      expect(bridge.tasks.completePreprocessManualStep).toHaveBeenCalledWith('preprocess-task-1::manual-file::EO');
    });
    expect(bridge.tasks.runPreprocessMatlabExecution).not.toHaveBeenCalled();
    expect(await screen.findByText('人工节点已完成：人工去除坏段（睁眼 EO）。请继续处理剩余静息态文件。')).toBeInTheDocument();
  });

  it('opens MATLAB or EEGLAB for a manual preprocessing checkpoint from the right task panel', async () => {
    const user = userEvent.setup();
    const bridge = installBridge({
      getWorkbenchData: vi.fn().mockResolvedValue(buildWorkbenchData({
        tasks: {
          queued: [],
          running: [],
          manual: [
            {
              id: 'preprocess-task-1',
              patient: 'sub05',
              name: '静息态 EEG 预处理',
              action: '打开 EEGLAB 完成人工去除坏段',
            },
          ],
          failed: [],
        },
      })),
    });
    vi.mocked(bridge.tasks.launchPreprocessManualStep).mockResolvedValue({
      ok: true,
      message: '已导出预处理任务包并打开 MATLAB/EEGLAB。任务包：C:\\out\\task.json',
      packagePath: 'C:\\out\\task.json',
      launchTargetPath: 'C:\\MATLAB\\matlab.exe',
    });

    render(<App />);

    expect(await screen.findByText('静息态 EEG 预处理')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '打开 EEGLAB' }));

    expect(bridge.tasks.launchPreprocessManualStep).toHaveBeenCalledWith('preprocess-task-1');
    expect(
      await screen.findByText('已导出预处理任务包并打开 MATLAB/EEGLAB。任务包：C:\\out\\task.json'),
    ).toBeInTheDocument();
  });

  it('runs MATLAB automatically before opening EEGLAB when the manual input file is missing', async () => {
    const user = userEvent.setup();
    const bridge = installBridge({
      getWorkbenchData: vi.fn().mockResolvedValue(buildWorkbenchData({
      tasks: {
        queued: [],
        running: [],
        manual: [
            {
              id: 'preprocess-task-1',
              patient: 'sub05',
              name: '静息态 EEG 预处理',
              action: '打开 EEGLAB 完成人工去除坏段',
            },
          ],
          failed: [],
        },
      })),
    });
    vi.mocked(bridge.tasks.launchPreprocessManualStep)
      .mockResolvedValueOnce({
        ok: false,
        message: '请先运行 MATLAB 预处理生成人工节点输入文件 (stage01_before_bad_segment)，再唤起 EEGLAB。',
      })
      .mockResolvedValueOnce({
        ok: true,
        message: '已导出预处理任务包并打开 MATLAB/EEGLAB。任务包：C:\\out\\task.json',
        packagePath: 'C:\\out\\task.json',
        launchTargetPath: 'C:\\out\\launch-eeglab.cmd',
      });
    vi.mocked(bridge.tasks.runPreprocessMatlabExecution).mockResolvedValue({
      ok: true,
      message: 'MATLAB 预处理已执行，已生成坏段人工处理文件。请继续人工去除坏段。',
      exitCode: 0,
      stdout: 'stage01 saved',
      stderr: '',
    });

    render(<App />);

    expect(await screen.findByText('静息态 EEG 预处理')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '打开 EEGLAB' }));

    await waitFor(() => {
      expect(bridge.tasks.launchPreprocessManualStep).toHaveBeenCalledTimes(2);
      expect(bridge.tasks.runPreprocessMatlabExecution).toHaveBeenCalledWith('preprocess-task-1');
    });
    expect(await screen.findByText('已导出预处理任务包并打开 MATLAB/EEGLAB。任务包：C:\\out\\task.json')).toBeInTheDocument();
  });

  it('runs queued feature, prediction, and explainability tasks from the right task panel', async () => {
    const user = userEvent.setup();
    const bridge = installBridge({
      getWorkbenchData: vi.fn().mockResolvedValue(buildWorkbenchData({
        tasks: {
          queued: [
            {
              id: 'feature-task-1',
              type: 'feature_generation',
              status: 'queued',
              patient: 'sub01',
              name: 'PSD/FC 特征生成',
              action: '等待运行',
            },
            {
              id: 'prediction-task-1',
              type: 'prediction',
              status: 'queued',
              patient: 'sub01',
              name: '批量预测',
              action: '等待运行',
            },
            {
              id: 'explainability-task-1',
              type: 'explainability',
              status: 'queued',
              patient: 'sub01',
              name: '模型解释性生成',
              action: '等待运行',
            },
          ],
          running: [],
          manual: [],
          failed: [],
        },
      })),
      runFeatureGenerationExecution: vi.fn().mockResolvedValue({
        ok: true,
        message: '特征生成已执行。',
        exitCode: 0,
        stdout: '',
        stderr: '',
        indexedArtifacts: 2,
        artifactIds: ['feature-artifact-1', 'feature-artifact-2'],
      }),
      runPredictionExecution: vi.fn().mockResolvedValue({
        ok: true,
        message: '预测已执行。',
        predictionId: 'prediction-result-1',
        exitCode: 0,
        stdout: '',
        stderr: '',
      }),
      runExplainabilityExecution: vi.fn().mockResolvedValue({
        ok: true,
        message: '解释性任务已执行。',
        exitCode: 0,
        stdout: '',
        stderr: '',
        indexedArtifacts: 1,
        artifactIds: ['explainability-artifact-1'],
      }),
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: '人工任务 (0)' })).toBeInTheDocument();
    expect(screen.getByText('暂无待人工处理的患者。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '运行特征生成' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '运行批量预测' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '运行模型解释性' })).not.toBeInTheDocument();
  });

  it('does not show failed non-manual tasks in the right manual panel', async () => {
    installBridge({
      getWorkbenchData: vi.fn().mockResolvedValue(buildWorkbenchData({
        tasks: {
          queued: [],
          running: [],
          manual: [],
          failed: [
            {
              id: 'failed-feature-task-1',
              type: 'feature_generation',
              status: 'failed',
              patient: 'sub01',
              name: 'PSD/FC 特征生成',
              action: 'feature engine crashed',
            },
          ],
        },
      })),
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: '人工任务 (0)' })).toBeInTheDocument();
    expect(screen.getByText('暂无待人工处理的患者。')).toBeInTheDocument();
    expect(screen.queryByText('PSD/FC 特征生成')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试任务' })).not.toBeInTheDocument();
  });

  it('renders backend workbench patients and data root from the Electron bridge', async () => {
    installBridge({
      getWorkbenchData: vi.fn().mockResolvedValue(buildWorkbenchData({
        patients: [
          {
            id: 'sub99',
            hand: '右肢不利 (LH)',
            eo: true,
            ec: false,
            preStatus: '已完成',
            featStatus: 'PSD/FC 已完成',
            task: 'tACS_Outcome',
            predict: '比例恢复',
            prob: 0.91,
            report: '已生成',
          },
        ],
        tasks: {
          queued: [],
          running: [],
          manual: [],
          failed: [],
        },
        logs: [],
        dataRoot: 'E:\\Backend\\StrokeData',
      })),
    });

    render(<App />);

    expect(await screen.findByText('sub99')).toBeInTheDocument();
    expect(screen.queryByText('sub01')).not.toBeInTheDocument();
    expect(screen.getByText('数据目录: E:\\Backend\\StrokeData')).toBeInTheDocument();
  });

  it('shows a backend message when initial workbench loading fails', async () => {
    installBridge({
      getWorkbenchData: vi.fn().mockRejectedValue(new Error('database unavailable')),
    });

    render(<App />);

    expect(await screen.findByText('加载工作台数据失败：database unavailable')).toBeInTheDocument();
    expect(screen.getByText('sub01')).toBeInTheDocument();
  });

  it('shows a backend message when patient import fails without breaking render', async () => {
    const user = userEvent.setup();
    installBridge({
      importPatientsCsv: vi.fn().mockRejectedValue(new Error('csv locked')),
    });

    render(<App />);
    expect(await screen.findByText('sub01')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '导入患者表' }));

    expect(await screen.findByText('患者导入失败：csv locked')).toBeInTheDocument();
    expect(screen.getByText('患者队列')).toBeInTheDocument();
  });

  it('shows a backend message when EEG folder scan fails without breaking render', async () => {
    const user = userEvent.setup();
    installBridge({
      scanEegFolder: vi.fn().mockRejectedValue(new Error('folder missing')),
    });

    render(<App />);
    expect(await screen.findByText('sub01')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '添加基线 EEG 文件夹' }));

    expect(await screen.findByText('EEG 扫描失败：folder missing')).toBeInTheDocument();
    expect(screen.getByText('患者队列')).toBeInTheDocument();
  });

  it('creates a batch summary report from the workbench toolbar', async () => {
    const user = userEvent.setup();
    const bridge = installBridge();

    render(<App />);
    expect(await screen.findByText('sub01')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '导出批次汇总' }));

    expect(bridge.database.createBatchSummaryReport).toHaveBeenCalledWith({
      title: 'tACS EEG 康复结局批次汇总',
    });
    expect(await screen.findByText('已生成批次汇总：F:\\out\\reports\\batch\\batch-summary.csv')).toBeInTheDocument();
  });

  it('renders malformed backend log entries with defensive fallback text and levels', async () => {
    const user = userEvent.setup();
    installBridge({
      getWorkbenchData: vi.fn().mockResolvedValue(buildWorkbenchData({
        logs: [
          null,
          {},
          { id: 'warn-log', text: 'backend warning', level: 'warning' },
          { id: 'err-log', text: null, level: 'error' },
        ],
      })),
    });

    render(<App />);
    expect(await screen.findByText('sub01')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '引擎日志' }));

    expect(screen.getAllByText('[INFO] 日志内容不可用')).toHaveLength(2);
    expect(screen.getByText('backend warning')).toHaveClass('text-yellow-400');
    expect(screen.getByText('[ERR] 日志内容不可用')).toHaveClass('text-red-400');
  });

  it('switches from the workbench to the Gemini preprocessing page', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'EEG 预处理向导' }));

    expect(
      screen.getByRole('heading', { name: 'EEG 预处理向导' }),
    ).toBeInTheDocument();
    expect(screen.getByText('移除空电极 / 辅助通道')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'HEO' })).toHaveClass(
      'bg-rose-50',
    );
  });
});
