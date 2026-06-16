import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App';

describe('Gemini EEG preprocessing wizard', () => {
  afterEach(() => {
    delete window.neuroPredict;
  });

  const installPreprocessBridge = (overrides = {}) => {
    window.neuroPredict = {
      platform: 'win32',
      database: {
        getWorkbenchData: vi.fn().mockResolvedValue({
          patients: [
            {
              id: 'sub99',
              patientId: 'uuid-sub99',
              hand: '右肢不利 (LH)',
              eo: true,
              ec: true,
              preStatus: '未开始',
              featStatus: '未开始',
              task: 'tACS_Outcome',
              predict: '-',
              prob: null,
              report: '-',
            },
          ],
          tasks: {
            running: [],
            manual: [],
            failed: [],
          },
          logs: [],
          dataRoot: 'E:\\Backend\\StrokeData',
        }),
        listPatients: vi.fn(),
        createPatient: vi.fn(),
        updatePatient: vi.fn(),
        deletePatient: vi.fn(),
        registerEegFile: vi.fn(),
        scanRegisteredEegFiles: vi.fn(),
        importPatientsCsv: vi.fn(),
        scanEegFolder: vi.fn(),
        ...(overrides as any).database,
      },
      settings: {
        getSettings: vi.fn(),
        updateSettings: vi.fn(),
        ...(overrides as any).settings,
      },
      tasks: {
        listTasks: vi.fn(),
        listTaskLogs: vi.fn(),
        createPreprocessBatch: vi.fn().mockResolvedValue({
          ok: true,
          message: '已创建 1 个预处理任务。',
        }),
        ...(overrides as any).tasks,
      },
    };

    return window.neuroPredict;
  };

  const openPreprocessWizard = async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'EEG 预处理向导' }));

    return user;
  };

  it('renders the 9-step wizard with the channel removal step active', async () => {
    await openPreprocessWizard();

    for (const step of [
      '导入原始数据 (cnt/set)',
      '导入电极定位',
      '移除空电极/辅助通道',
      '降采样率',
      '滤波 (Filter)',
      '人工去除坏段',
      '独立成分分析 (ICA)',
      '人工去除伪迹 (ICA)',
      '重参考与保存',
    ]) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }

    expect(screen.getByText('辅助通道 (Auxiliary)')).toBeInTheDocument();
    expect(screen.getByText('EEG 导联 (64 Channels)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'HEO' })).toHaveClass(
      'bg-rose-50',
    );
    expect(screen.getByRole('button', { name: 'M1' })).toHaveClass('bg-white');
  });

  it('lets users mark removed channels and then blocks M1/M2 reference', async () => {
    const user = await openPreprocessWizard();

    await user.click(screen.getByRole('button', { name: 'M1' }));
    await user.click(screen.getByText('重参考与保存'));

    expect(
      screen.getByRole('radio', { name: /双侧乳突参考/ }),
    ).toBeDisabled();
    expect(screen.getByText(/不可用：您在第 3 步中移除了 M1 或 M2 电极/)).toBeInTheDocument();
  });

  it('supports direct ICA or interpolate-before-ICA modes', async () => {
    const user = await openPreprocessWizard();

    await user.click(screen.getByText('独立成分分析 (ICA)'));

    const directIca = screen.getByRole('radio', { name: /直接运行 ICA/ });
    const interpolateIca = screen.getByRole('radio', {
      name: /插值坏导后运行 ICA/,
    });

    expect(interpolateIca).toBeChecked();
    expect(screen.getAllByText(/挑选坏导/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Fz' }));
    expect(screen.getByRole('button', { name: 'Fz' })).toHaveClass(
      'bg-indigo-100',
    );

    await user.click(directIca);
    expect(directIca).toBeChecked();
    expect(interpolateIca).not.toBeChecked();
  });

  it('renders the target sampling rate input with readable dark text', async () => {
    const user = await openPreprocessWizard();

    await user.click(screen.getByText('降采样率'));

    expect(screen.getByDisplayValue('500')).toHaveClass('text-slate-900');
  });

  it('renders filter frequency inputs with readable dark text', async () => {
    const user = await openPreprocessWizard();

    await user.click(screen.getByText('滤波 (Filter)'));

    for (const value of ['1', '45', '50']) {
      expect(screen.getByDisplayValue(value)).toHaveClass('text-slate-900');
    }
  });

  it('shows the manual EEGLAB checkpoint controls on manual steps', async () => {
    const user = await openPreprocessWizard();

    await user.click(screen.getByText('人工去除坏段'));

    const checkpoint = screen.getByText('等待人工处理').closest('div');
    expect(checkpoint).not.toBeNull();
    expect(
      within(checkpoint as HTMLElement).getByRole('button', {
        name: '唤起 EEGLAB 独立窗口',
      }),
    ).toBeInTheDocument();
    expect(
      within(checkpoint as HTMLElement).getByRole('button', {
        name: '我已完成，自动保存并继续队列',
      }),
    ).toBeInTheDocument();
  });

  it('wires manual checkpoint buttons to real preprocessing tasks instead of existing-result EEG data', async () => {
    const bridge = installPreprocessBridge({
      database: {
        getWorkbenchData: vi.fn().mockResolvedValue({
          patients: [
            {
              id: 'sub99',
              patientId: 'uuid-sub99',
              hand: '右肢不利 (LH)',
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
                id: 'preprocess-task-sub99',
                type: 'preprocess',
                status: 'waiting_manual',
                patient: 'sub99',
                name: '静息态 EEG 预处理',
                action: '打开 EEGLAB 完成人工去除坏段',
              },
            ],
            failed: [],
          },
          logs: [],
          dataRoot: 'E:\\Backend\\StrokeData',
        }),
        launchExistingPreprocessManualStep: vi.fn().mockResolvedValue({
          ok: true,
          message: '不应该调用既有结果流程',
        }),
        completeExistingPreprocessManualStep: vi.fn().mockResolvedValue({
          ok: true,
          message: '不应该确认既有结果流程',
        }),
      },
      tasks: {
        launchPreprocessManualStep: vi.fn().mockResolvedValue({
          ok: true,
          message: '已打开正式预处理任务的 EEGLAB 窗口。',
        }),
        completePreprocessManualStep: vi.fn().mockResolvedValue({
          ok: true,
          message: '人工节点已完成：人工去除坏段。下一步请运行 MATLAB 完成坏导插值和 ICA。',
        }),
        runPreprocessMatlabExecution: vi.fn().mockResolvedValue({
          ok: true,
          message: 'MATLAB 预处理已执行，已生成 ICA 人工处理文件。请继续人工去除 ICA 伪迹。',
          exitCode: 0,
          stdout: 'stage03 saved',
          stderr: '',
        }),
      },
    });
    const user = await openPreprocessWizard();

    await user.click(screen.getByText('人工去除坏段'));
    await user.click(screen.getByRole('button', { name: '唤起 EEGLAB 独立窗口' }));

    await waitFor(() => {
      expect(bridge?.tasks.launchPreprocessManualStep).toHaveBeenCalledWith('preprocess-task-sub99');
    });
    expect(bridge?.database.launchExistingPreprocessManualStep).not.toHaveBeenCalled();
    expect(await screen.findByText('已打开正式预处理任务的 EEGLAB 窗口。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '我已完成，自动保存并继续队列' }));

    await waitFor(() => {
      expect(bridge?.tasks.completePreprocessManualStep).toHaveBeenCalledWith('preprocess-task-sub99');
    });
    expect(bridge?.tasks.runPreprocessMatlabExecution).toHaveBeenCalledWith('preprocess-task-sub99');
    expect(bridge?.database.completeExistingPreprocessManualStep).not.toHaveBeenCalled();
    expect(
      await screen.findByRole('radio', { name: /插值坏导后运行 ICA/ }),
    ).toBeInTheDocument();
  });

  it('runs MATLAB once and relaunches EEGLAB when the manual bad-segment SET file is missing', async () => {
    const bridge = installPreprocessBridge({
      database: {
        getWorkbenchData: vi.fn().mockResolvedValue({
          patients: [
            {
              id: 'sub99',
              patientId: 'uuid-sub99',
              hand: '右肢不利 (LH)',
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
                id: 'preprocess-task-sub99',
                type: 'preprocess',
                status: 'waiting_manual',
                patient: 'sub99',
                name: '静息态 EEG 预处理',
                action: '打开 EEGLAB 完成人工去除坏段',
              },
            ],
            failed: [],
          },
          logs: [],
          dataRoot: 'E:\\Backend\\StrokeData',
        }),
      },
      tasks: {
        launchPreprocessManualStep: vi
          .fn()
          .mockResolvedValueOnce({
            ok: false,
            message: '请先运行 MATLAB 预处理生成人工节点输入文件 (stage01_before_bad_segment)，再唤起 EEGLAB。',
          })
          .mockResolvedValueOnce({
            ok: true,
            message: '已导出预处理任务包并打开 MATLAB/EEGLAB。',
          }),
        runPreprocessMatlabExecution: vi.fn().mockResolvedValue({
          ok: true,
          message: 'MATLAB 预处理已执行，已生成坏段人工处理文件。请继续人工去除坏段。',
          exitCode: 0,
          stdout: 'stage01 saved',
          stderr: '',
        }),
      },
    });
    const user = await openPreprocessWizard();

    await user.click(screen.getByText('人工去除坏段'));
    await user.click(screen.getByRole('button', { name: '唤起 EEGLAB 独立窗口' }));

    await waitFor(() => {
      expect(bridge?.tasks.runPreprocessMatlabExecution).toHaveBeenCalledWith('preprocess-task-sub99');
      expect(bridge?.tasks.launchPreprocessManualStep).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('已导出预处理任务包并打开 MATLAB/EEGLAB。')).toBeInTheDocument();
  });

  it('starts the bad-segment manual checkpoint after filter settings without requiring rereference first', async () => {
    const initialWorkbench = {
      patients: [
        {
          id: 'sub99',
          patientId: 'uuid-sub99',
          hand: '右肢不利 (LH)',
          eo: true,
          ec: true,
          preStatus: '未开始',
          featStatus: '未开始',
          task: 'tACS_Outcome',
          predict: '-',
          prob: null,
          report: '-',
        },
      ],
      tasks: {
        running: [],
        manual: [],
        failed: [],
      },
      logs: [],
      dataRoot: 'E:\\Backend\\StrokeData',
    };
    const manualWorkbench = {
      ...initialWorkbench,
      patients: [
        {
          ...initialWorkbench.patients[0],
          preStatus: '等待人工处理',
        },
      ],
      tasks: {
        running: [],
        manual: [
          {
            id: 'preprocess-task-sub99',
            type: 'preprocess',
            status: 'waiting_manual',
            patient: 'sub99',
            name: '静息态 EEG 预处理',
            action: '打开 EEGLAB 完成人工去除坏段',
          },
        ],
        failed: [],
      },
    };
    const bridge = installPreprocessBridge({
      database: {
        getWorkbenchData: vi
          .fn()
          .mockResolvedValueOnce(initialWorkbench)
          .mockResolvedValue(manualWorkbench),
      },
      tasks: {
        createPreprocessBatch: vi.fn().mockResolvedValue({
          ok: true,
          message: '已创建 1 个预处理任务。',
          batchId: 'preprocess-test',
          taskIds: ['preprocess-task-sub99'],
        }),
        launchPreprocessManualStep: vi.fn().mockResolvedValue({
          ok: true,
          message: '已导出预处理任务包并打开 MATLAB/EEGLAB。',
        }),
        runPreprocessMatlabExecution: vi.fn().mockResolvedValue({
          ok: true,
          message: 'MATLAB 预处理已执行，已生成坏段人工处理文件。请继续人工去除坏段。',
          exitCode: 0,
          stdout: 'stage01 saved',
          stderr: '',
        }),
      },
    });
    const user = await openPreprocessWizard();

    await user.click(screen.getByText('滤波 (Filter)'));
    const highPassInput = screen.getByDisplayValue('1');
    await user.clear(highPassInput);
    await user.type(highPassInput, '0.5');
    await user.click(screen.getByRole('button', { name: /下一步/ }));

    await waitFor(() => {
      expect(bridge?.tasks.createPreprocessBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          patientIds: ['uuid-sub99'],
          highPassHz: 0.5,
          lowPassHz: 45,
          notchHz: 50,
          referenceMode: 'average',
        }),
      );
      expect(bridge?.tasks.runPreprocessMatlabExecution).toHaveBeenCalledWith('preprocess-task-sub99');
    });
    expect(bridge?.tasks.launchPreprocessManualStep).not.toHaveBeenCalled();
    expect(await screen.findByText('打开 EEGLAB 完成人工去除坏段')).toBeInTheDocument();
    expect(await screen.findByText('MATLAB 预处理已执行，已生成坏段人工处理文件。请继续人工去除坏段。')).toBeInTheDocument();
    expect(screen.queryByText(/请先在第 9 步保存配置并执行队列/)).not.toBeInTheDocument();
  });

  it('creates backend preprocessing tasks from the final queue button', async () => {
    const bridge = installPreprocessBridge();
    const user = await openPreprocessWizard();

    await user.click(screen.getByText('重参考与保存'));
    await user.click(screen.getByRole('button', { name: /保存配置并执行队列/ }));

    await waitFor(() => {
      expect(bridge?.tasks.createPreprocessBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          patientIds: ['uuid-sub99'],
          selectedEmptyChannels: ['HEO', 'VEO', 'EKG', 'EMG'],
          selectedBadChannels: [],
          referenceMode: 'average',
          downsampleRate: 500,
          highPassHz: 1,
          lowPassHz: 45,
          notchHz: 50,
        }),
      );
    });
  });

  it('uses database patient IDs instead of displayed subject codes in Electron mode', async () => {
    const bridge = installPreprocessBridge();
    const user = await openPreprocessWizard();

    await user.click(screen.getByText('重参考与保存'));
    await user.click(screen.getByRole('button', { name: /保存配置并执行队列/ }));

    await waitFor(() => {
      expect(bridge?.tasks.createPreprocessBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          patientIds: ['uuid-sub99'],
        }),
      );
    });

    expect(bridge?.tasks.createPreprocessBatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        patientIds: ['sub99'],
      }),
    );
  });

  it('lets users choose which backend patients enter the preprocessing queue', async () => {
    const bridge = installPreprocessBridge({
      database: {
        getWorkbenchData: vi.fn().mockResolvedValue({
          patients: [
            {
              id: 'sub99',
              patientId: 'uuid-sub99',
              hand: '右肢不利 (LH)',
              eo: true,
              ec: true,
              preStatus: '未开始',
              featStatus: '未开始',
              task: 'tACS_Outcome',
              predict: '-',
              prob: null,
              report: '-',
            },
            {
              id: 'sub100',
              patientId: 'uuid-sub100',
              hand: '左肢不利 (RH)',
              eo: true,
              ec: false,
              preStatus: '未开始',
              featStatus: '未开始',
              task: 'tACS_Outcome',
              predict: '-',
              prob: null,
              report: '-',
            },
          ],
          tasks: {
            running: [],
            manual: [],
            failed: [],
          },
          logs: [],
          dataRoot: 'E:\\Backend\\StrokeData',
        }),
      },
    });
    const user = await openPreprocessWizard();

    expect(await screen.findByText('预处理数据选择')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: '选择预处理患者 sub100' }));
    await user.click(screen.getByText('重参考与保存'));
    await user.click(screen.getByRole('button', { name: /保存配置并执行队列/ }));

    await waitFor(() => {
      expect(bridge?.tasks.createPreprocessBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          patientIds: ['uuid-sub99'],
        }),
      );
    });
    expect(bridge?.tasks.createPreprocessBatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        patientIds: expect.arrayContaining(['uuid-sub100']),
      }),
    );
  });

  it('toggles the preprocessing select-all button between selecting and clearing all patients', async () => {
    const bridge = installPreprocessBridge({
      database: {
        getWorkbenchData: vi.fn().mockResolvedValue({
          patients: [
            {
              id: 'sub99',
              patientId: 'uuid-sub99',
              hand: '右肢不利 (LH)',
              eo: true,
              ec: true,
              preStatus: '未开始',
              featStatus: '未开始',
              task: 'tACS_Outcome',
              predict: '-',
              prob: null,
              report: '-',
            },
            {
              id: 'sub100',
              patientId: 'uuid-sub100',
              hand: '左肢不利 (RH)',
              eo: true,
              ec: true,
              preStatus: '未开始',
              featStatus: '未开始',
              task: 'tACS_Outcome',
              predict: '-',
              prob: null,
              report: '-',
            },
          ],
          tasks: {
            running: [],
            manual: [],
            failed: [],
          },
          logs: [],
          dataRoot: 'E:\\Backend\\StrokeData',
        }),
      },
    });
    const user = await openPreprocessWizard();

    const selectAllButton = await screen.findByRole('button', { name: '全选' });
    expect(screen.getByText('已选 2 / 2')).toBeInTheDocument();

    await user.click(selectAllButton);
    expect(screen.getByText('已选 0 / 2')).toBeInTheDocument();

    await user.click(screen.getByText('重参考与保存'));
    await user.click(screen.getByRole('button', { name: /保存配置并执行队列/ }));

    await waitFor(() => {
      expect(bridge?.tasks.createPreprocessBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          patientIds: [],
        }),
      );
    });
  });

  it('does not send mock patient IDs while bridge workbench data is still loading', async () => {
    const bridge = installPreprocessBridge({
      database: {
        getWorkbenchData: vi.fn(() => new Promise(() => {})),
      },
    });
    const user = await openPreprocessWizard();

    await user.click(screen.getByText('重参考与保存'));
    await user.click(screen.getByRole('button', { name: /保存配置并执行队列/ }));

    await waitFor(() => {
      expect(bridge?.tasks.createPreprocessBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          patientIds: [],
        }),
      );
    });

    expect(bridge?.tasks.createPreprocessBatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        patientIds: expect.arrayContaining(['sub01', 'sub16']),
      }),
    );
  });

  it('blocks backend task creation when M1/M2 reference conflicts with removed channels', async () => {
    const bridge = installPreprocessBridge();
    const user = await openPreprocessWizard();

    await user.click(screen.getByText('重参考与保存'));
    await user.click(screen.getByRole('radio', { name: /双侧乳突参考/ }));
    await user.click(screen.getByText('移除空电极/辅助通道'));
    await user.click(screen.getByRole('button', { name: 'M1' }));
    await user.click(screen.getByText('重参考与保存'));
    await user.click(screen.getByRole('button', { name: /保存配置并执行队列/ }));

    expect(bridge?.tasks.createPreprocessBatch).not.toHaveBeenCalled();
    expect(screen.getByText(/M1\/M2 参考与已移除电极冲突/)).toBeInTheDocument();
  });
});
