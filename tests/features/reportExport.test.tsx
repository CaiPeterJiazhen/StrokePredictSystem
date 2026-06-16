import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import App from '../../src/App';
import type { NeuroPredictBridge } from '../../src/electron/preload';

describe('patient report export view', () => {
  afterEach(() => {
    delete window.neuroPredict;
    vi.restoreAllMocks();
  });

  it('generates and opens a backend patient report from the active app', async () => {
    const user = userEvent.setup();
    const report = {
      id: 'report-1',
      patientId: 'patient-1',
      subjectCode: 'sub01',
      patientName: '穆祥贵',
      format: 'html',
      status: '已生成',
      filePath: 'F:\\reports\\sub01_recovery-report.html',
      generatedAt: '2026-06-14T00:00:00.000Z',
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
    };
    const createPatientReport = vi.fn().mockResolvedValue({
      ok: true,
      message: '已生成患者报告：F:\\reports\\sub01_recovery-report.html',
      report,
    });
    const listPatientReports = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([report]);
    const openPatientReport = vi.fn().mockResolvedValue({ ok: true, message: '已打开患者报告。' });

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
        listPredictionModels: vi.fn().mockResolvedValue([]),
        listPredictionQueue: vi.fn().mockResolvedValue([]),
        createPatientReport,
        listPatientReports,
        openPatientReport,
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

    render(<App />);

    await user.click(screen.getByRole('button', { name: '报告导出' }));
    expect(await screen.findByRole('heading', { name: '报告导出中心' })).toBeInTheDocument();
    expect(screen.getByText('sub01')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '生成患者报告' }));

    await waitFor(() => {
      expect(createPatientReport).toHaveBeenCalledWith({
        patientId: 'patient-1',
        title: 'tACS EEG 康复结局预测报告',
      });
    });
    expect(await screen.findByText('已生成患者报告：F:\\reports\\sub01_recovery-report.html')).toBeInTheDocument();

    const reportRow = await screen.findByRole('row', { name: /sub01/ });
    expect(within(reportRow).getByText('穆**')).toBeInTheDocument();
    expect(within(reportRow).queryByText('穆')).not.toBeInTheDocument();
    expect(within(reportRow).queryByText('穆祥贵')).not.toBeInTheDocument();

    await user.click(within(reportRow).getByRole('button', { name: '打开报告 sub01' }));

    expect(openPatientReport).toHaveBeenCalledWith('report-1');
    expect(await screen.findByText('已打开患者报告。')).toBeInTheDocument();
  });
});
