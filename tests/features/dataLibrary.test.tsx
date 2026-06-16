import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App';
import type {
  DataAsset,
  DataCompleteness,
  DataLibraryStatus,
  DataLibrarySummaryRow,
  PatientDocumentDetail,
  ScanAndImportDataLibraryResult,
} from '../../src/domain/backendTypes';

const sourceRootPath = 'F:\\CJZFile\\EEG_M1';

function installPointerEventMock() {
  const originalPointerEvent = window.PointerEvent;

  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }

  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: TestPointerEvent,
  });

  return () => {
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      writable: true,
      value: originalPointerEvent,
    });
  };
}

const dataLibraryStatus: DataLibraryStatus = {
  sourceRoot: {
    id: 'root-1',
    projectName: 'M1 EEG',
    rootPath: sourceRootPath,
    status: 'active',
    lastScannedAt: '2026-06-14T08:00:00.000Z',
    createdAt: '2026-06-14T08:00:00.000Z',
    updatedAt: '2026-06-14T08:00:00.000Z',
  },
  indexedFiles: 18,
  missingFiles: 1,
  backedUpDocuments: 3,
  manualReviewItems: 2,
  lastScanMessage: '索引已更新',
};

const summaryRows: DataLibrarySummaryRow[] = [
  {
    patientId: 'patient-sub01',
    subjectCode: 'sub01',
    subjectName: '穆祥贵',
    cohort: 'patient',
    hasClinicalInfo: true,
    hasRecordPdf: true,
    baselineRawCount: 2,
    baselineProcessedPairs: 1,
    immediateProcessedPairs: 1,
    phaseProcessedPairs: 0,
    finalProcessedPairs: 1,
    completenessScore: '5/6',
    issueCount: 1,
    matchStatus: 'matched',
  },
  {
    patientId: null,
    subjectCode: 'sub001',
    subjectName: '朱卫清',
    cohort: 'health',
    hasClinicalInfo: false,
    hasRecordPdf: true,
    baselineRawCount: 1,
    baselineProcessedPairs: 0,
    immediateProcessedPairs: 0,
    phaseProcessedPairs: 0,
    finalProcessedPairs: 0,
    completenessScore: '1/2',
    issueCount: 0,
    matchStatus: 'needs_review',
  },
];

const patientAssets: DataAsset[] = [
  {
    id: 'asset-record-pdf',
    sourceRootId: 'root-1',
    patientId: 'patient-sub01',
    subjectCode: 'sub01',
    sourceSubjectCode: 'sub01',
    subjectName: '穆祥贵',
    cohort: 'patient',
    stage: '不适用',
    assetType: 'record_pdf',
    filePath: 'F:\\CJZFile\\EEG_M1\\患者记录本\\sub01穆祥贵.pdf',
    backupPath: 'F:\\CJZFile\\EEG_M1\\.backup\\sub01穆祥贵.pdf',
    fileSize: 2048,
    fileHash: 'hash-1',
    existsOnDisk: true,
    matchStatus: 'matched',
    indexedAt: '2026-06-14T08:00:00.000Z',
    lastCheckedAt: '2026-06-14T08:00:00.000Z',
  },
];

function assetForStage(stage: DataAsset['stage'], id = `asset-${stage}`): DataAsset {
  return {
    ...patientAssets[0],
    id,
    stage,
    assetType: stage === '基线' ? 'raw_eeg_cnt' : 'processed_eeg_set',
    filePath: `F:\\CJZFile\\EEG_M1\\Patient_tACS_M1_EEG\\${stage}\\sub01\\${id}.set`,
  };
}

function completenessForStage(stage: DataCompleteness['stage'], task: DataCompleteness['task'] = '睁眼'): DataCompleteness {
  return {
    patientId: 'patient-sub01',
    subjectCode: 'sub01',
    stage,
    task,
    rawCntCount: stage === '基线' ? 1 : 0,
    processedSetCount: 1,
    processedFdtCount: 1,
    setFdtPairStatus: 'complete',
    workbookStatus: 'Y',
    computedStatus: 'complete',
    updatedAt: '2026-06-14T08:00:00.000Z',
  };
}

const completenessRows: DataCompleteness[] = [
  {
    patientId: 'patient-sub01',
    subjectCode: 'sub01',
    stage: '基线',
    task: '睁眼',
    rawCntCount: 1,
    processedSetCount: 1,
    processedFdtCount: 1,
    setFdtPairStatus: 'complete',
    workbookStatus: 'Y',
    computedStatus: 'complete',
    updatedAt: '2026-06-14T08:00:00.000Z',
  },
];

const documentDetail: PatientDocumentDetail = {
  patient: {
    id: 'patient-sub01',
    subjectCode: 'sub01',
    name: '穆祥贵',
    age: 63,
    sex: '男',
    diagnosis: 'stroke',
    affectedHand: '右手',
    notes: '',
    createdAt: '2026-06-14T08:00:00.000Z',
    updatedAt: '2026-06-14T08:00:00.000Z',
  },
  clinicalMetrics: {
    patientId: 'patient-sub01',
    sourceWorkbook: '脑卒中患者信息记录表.xlsx',
    diseaseCourse: '2月',
    affectedSideRaw: '左',
    fmaBefore: 63,
    fmaAfter: 65,
    mbiBefore: 70,
    mbiAfter: 80,
    bbtBefore: '12',
    bbtAfter: '16',
    mmse: 27,
    missingData: '',
    dropoutReason: '',
    mriCount: 1,
    updatedAt: '2026-06-14T08:00:00.000Z',
  },
  assets: patientAssets,
  completeness: completenessRows,
  warnings: ['阶段数据缺少 1 对 set/fdt'],
};

const sub02Detail: PatientDocumentDetail = {
  ...documentDetail,
  patient: {
    ...documentDetail.patient!,
    id: 'patient-sub02',
    subjectCode: 'sub02',
    name: '王测试',
  },
  clinicalMetrics: {
    ...documentDetail.clinicalMetrics!,
    patientId: 'patient-sub02',
    fmaBefore: 70,
    fmaAfter: 75,
    mmse: 29,
  },
  warnings: [],
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

const buildWorkbenchData = () => ({
  patients: [],
  tasks: { running: [], manual: [], failed: [] },
  logs: [],
  dataRoot: 'D:\\Research\\Stroke_tACS_EEG_Data',
});

const installBridge = (databaseOverrides = {}) => {
  window.neuroPredict = {
    platform: 'win32',
    database: {
      getWorkbenchData: vi.fn().mockResolvedValue(buildWorkbenchData()),
      listPatients: vi.fn(),
      createPatient: vi.fn(),
      updatePatient: vi.fn(),
      deletePatient: vi.fn(),
      clearWorkspaceData: vi.fn(),
      registerEegFile: vi.fn(),
      scanRegisteredEegFiles: vi.fn(),
      importPatientsCsv: vi.fn(),
      scanEegFolder: vi.fn(),
      getDataLibraryStatus: vi.fn().mockResolvedValue(dataLibraryStatus),
      upsertSourceRoot: vi.fn(),
      scanAndImportDataLibrary: vi.fn().mockResolvedValue({
        sourceRootId: 'root-1',
        createdPatients: 0,
        updatedPatients: 1,
        indexedAssets: 18,
        backedUpDocuments: 0,
        missingFiles: 1,
        pairIssues: 1,
        unmatchedFiles: 0,
        manualReviewItems: 2,
        errors: [],
      }),
      updateDataAssetIndex: vi.fn().mockResolvedValue({
        sourceRootId: 'root-1',
        createdPatients: 0,
        updatedPatients: 0,
        indexedAssets: 18,
        backedUpDocuments: 0,
        missingFiles: 1,
        pairIssues: 1,
        unmatchedFiles: 0,
        manualReviewItems: 2,
        errors: [],
      }),
      backupClinicalDocuments: vi.fn().mockResolvedValue({
        sourceRootId: 'root-1',
        createdPatients: 0,
        updatedPatients: 0,
        indexedAssets: 0,
        backedUpDocuments: 3,
        missingFiles: 0,
        pairIssues: 0,
        unmatchedFiles: 0,
        manualReviewItems: 0,
        errors: [],
      }),
      selectDataLibraryRoot: vi.fn().mockResolvedValue('D:\\Selected\\EEG_M1'),
      listDataAssets: vi.fn(),
      listPatientAssetSummary: vi.fn().mockResolvedValue(summaryRows),
      getPatientDocumentDetail: vi.fn().mockResolvedValue(documentDetail),
      openAssetLocation: vi.fn(),
      openBackupDirectory: vi.fn().mockResolvedValue({ ok: true, message: 'opened' }),
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

describe('data library navigation and bridge actions', () => {
  afterEach(() => {
    delete window.neuroPredict;
  });

  it('replaces the old batch navigation with the data library page and scans the default root', async () => {
    const user = userEvent.setup();
    const bridge = installBridge();

    render(<App />);

    expect(screen.getByRole('button', { name: '数据与文档库' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '批次与导入' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '数据与文档库' }));

    expect(await screen.findByRole('heading', { name: '数据与文档库' })).toBeInTheDocument();
    expect(screen.getByText(sourceRootPath)).toBeInTheDocument();
    expect(screen.getByText('18 / 1 / 3 / 2')).toBeInTheDocument();
    expect(screen.getByText('sub01')).toBeInTheDocument();
    expect(screen.getByText('穆**')).toBeInTheDocument();
    expect(screen.queryByText('穆祥贵')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '扫描并批量导入' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '接入 sub01 既有结果' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '扫描并批量导入' }));

    await waitFor(() => {
      expect(bridge.database.scanAndImportDataLibrary).toHaveBeenCalledWith(sourceRootPath);
    });
  });

  it('places the source status bar between the title bar and backend message', async () => {
    const user = userEvent.setup();
    installBridge();

    render(<App />);

    await user.click(screen.getByRole('button', { name: '数据与文档库' }));
    await screen.findByRole('heading', { name: '数据与文档库' });
    await user.click(screen.getByRole('button', { name: '打开备份目录' }));

    const titleBarText = screen.getByText('NeuroPredict: tACS EEG 康复结局预测系统 v1.2.0');
    const sourceStatusBar = screen.getByTestId('data-library-top-status-bar');
    const backendMessage = await screen.findByTestId('backend-message-banner');

    expect(Boolean(titleBarText.compareDocumentPosition(sourceStatusBar) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(sourceStatusBar.compareDocumentPosition(backendMessage) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('selects a data root directory and updates the root path field', async () => {
    const user = userEvent.setup();
    const bridge = installBridge();

    render(<App />);

    await user.click(screen.getByRole('button', { name: '数据与文档库' }));
    await user.click(await screen.findByRole('button', { name: '选择数据根目录' }));

    await waitFor(() => {
      expect(bridge.database.selectDataLibraryRoot).toHaveBeenCalledOnce();
    });
    expect(screen.getByRole('textbox', { name: '数据根目录' })).toHaveValue('D:\\Selected\\EEG_M1');
    expect(screen.getByTestId('data-library-top-status-bar')).toHaveTextContent('D:\\Selected\\EEG_M1');
  });

  it('checks the Electron bridge at click time when selecting a data root directory', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: '数据与文档库' }));
    await screen.findByRole('button', { name: '选择数据根目录' });
    const bridge = installBridge();

    await user.click(await screen.findByRole('button', { name: '选择数据根目录' }));

    await waitFor(() => {
      expect(bridge.database.selectDataLibraryRoot).toHaveBeenCalledOnce();
    });
    expect(screen.getByRole('textbox', { name: '数据根目录' })).toHaveValue('D:\\Selected\\EEG_M1');
  });

  it('loads patient document detail when a patient row is selected', async () => {
    const user = userEvent.setup();
    const bridge = installBridge();

    render(<App />);

    await user.click(screen.getByRole('button', { name: '数据与文档库' }));
    const patientRow = await screen.findByRole('row', { name: /sub01/ });

    await user.click(within(patientRow).getByRole('button', { name: '查看 sub01 详情' }));

    await waitFor(() => {
      expect(bridge.database.getPatientDocumentDetail).toHaveBeenCalledWith('patient-sub01');
    });
    expect(await screen.findByText('FMA 63 -> 65')).toBeInTheDocument();
    expect(screen.getByText('MMSE 27')).toBeInTheDocument();
  });

  it('orders stage controls and filters data library rows by selected stage', async () => {
    const user = userEvent.setup();
    installBridge({
      listPatientAssetSummary: vi.fn().mockResolvedValue([
        {
          ...summaryRows[0],
          patientId: 'patient-baseline',
          subjectCode: 'sub-baseline',
          baselineRawCount: 2,
          baselineProcessedPairs: 1,
          immediateProcessedPairs: 0,
          phaseProcessedPairs: 0,
          finalProcessedPairs: 0,
        },
        {
          ...summaryRows[0],
          patientId: 'patient-immediate',
          subjectCode: 'sub-immediate',
          baselineRawCount: 0,
          baselineProcessedPairs: 0,
          immediateProcessedPairs: 1,
          phaseProcessedPairs: 0,
          finalProcessedPairs: 0,
        },
        {
          ...summaryRows[0],
          patientId: 'patient-phase',
          subjectCode: 'sub-phase',
          baselineRawCount: 0,
          baselineProcessedPairs: 0,
          immediateProcessedPairs: 0,
          phaseProcessedPairs: 1,
          finalProcessedPairs: 0,
        },
        {
          ...summaryRows[0],
          patientId: 'patient-final',
          subjectCode: 'sub-final',
          baselineRawCount: 0,
          baselineProcessedPairs: 0,
          immediateProcessedPairs: 0,
          phaseProcessedPairs: 0,
          finalProcessedPairs: 1,
        },
      ]),
    });

    render(<App />);

    await user.click(screen.getByRole('button', { name: '数据与文档库' }));
    await screen.findByText('sub-baseline');

    const baselineFilter = screen.getByRole('button', { name: '筛选基线阶段数据' });
    const immediateFilter = screen.getByRole('button', { name: '筛选即时阶段数据' });
    const phaseFilter = screen.getByRole('button', { name: '筛选阶段数据' });
    const finalFilter = screen.getByRole('button', { name: '筛选最终阶段数据' });

    expect(Boolean(baselineFilter.compareDocumentPosition(immediateFilter) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(immediateFilter.compareDocumentPosition(phaseFilter) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(phaseFilter.compareDocumentPosition(finalFilter) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    await user.click(finalFilter);
    expect(screen.getByText('sub-final')).toBeInTheDocument();
    expect(screen.queryByText('sub-baseline')).not.toBeInTheDocument();

    await user.click(baselineFilter);
    expect(screen.getByText('sub-baseline')).toBeInTheDocument();
    expect(screen.queryByText('sub-final')).not.toBeInTheDocument();
  });

  it('orders detail assets and completeness by baseline, immediate, phase, and final stage', async () => {
    const user = userEvent.setup();
    installBridge({
      getPatientDocumentDetail: vi.fn().mockResolvedValue({
        ...documentDetail,
        assets: [
          assetForStage('最终', 'asset-final'),
          assetForStage('即时', 'asset-immediate'),
          assetForStage('基线', 'asset-baseline'),
          assetForStage('阶段', 'asset-phase'),
        ],
        completeness: [
          completenessForStage('最终'),
          completenessForStage('即时'),
          completenessForStage('基线'),
          completenessForStage('阶段'),
        ],
      }),
    });

    render(<App />);

    await user.click(screen.getByRole('button', { name: '数据与文档库' }));
    const patientRow = await screen.findByRole('row', { name: /sub01/ });
    await user.click(within(patientRow).getByRole('button', { name: '查看 sub01 详情' }));

    const assetStages = (await screen.findAllByTestId('detail-asset-stage')).map((node) => node.textContent);
    const completenessStages = (await screen.findAllByTestId('detail-completeness-stage')).map((node) => node.textContent);

    expect(assetStages).toEqual(['基线', '即时', '阶段', '最终']);
    expect(completenessStages).toEqual(['基线 / 睁眼', '即时 / 睁眼', '阶段 / 睁眼', '最终 / 睁眼']);

    await user.click(screen.getByRole('button', { name: '筛选最终阶段数据' }));
    expect(screen.getAllByTestId('detail-asset-stage').map((node) => node.textContent)).toEqual(['最终']);
    expect(screen.getAllByTestId('detail-completeness-stage').map((node) => node.textContent)).toEqual(['最终 / 睁眼']);
  });

  it('deletes a patient and clears the data library from visible controls', async () => {
    const user = userEvent.setup();
    const deletePatient = vi.fn().mockResolvedValue({ ok: true, message: '已删除患者 sub01。' });
    const clearWorkspaceData = vi.fn().mockResolvedValue({
      ok: true,
      message: '已清空患者工作台与数据文档库记录。',
    });
    const listPatientAssetSummary = vi
      .fn()
      .mockResolvedValueOnce(summaryRows)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const bridge = installBridge({
      deletePatient,
      clearWorkspaceData,
      listPatientAssetSummary,
    });

    render(<App />);

    await user.click(screen.getByRole('button', { name: '数据与文档库' }));
    const patientRow = await screen.findByRole('row', { name: /sub01/ });

    await user.click(within(patientRow).getByRole('button', { name: '删除患者 sub01' }));

    await waitFor(() => {
      expect(deletePatient).toHaveBeenCalledWith('patient-sub01');
    });
    expect(await screen.findByText('已删除患者 sub01。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '清空数据与文档库' }));

    await waitFor(() => {
      expect(clearWorkspaceData).toHaveBeenCalledOnce();
    });
    expect(await screen.findByText('已清空患者工作台与数据文档库记录。')).toBeInTheDocument();
    expect(bridge.database.listPatientAssetSummary).toHaveBeenCalledTimes(3);
  });

  it('resizes the patient detail panel with the vertical splitter', async () => {
    const user = userEvent.setup();
    installBridge();

    render(<App />);

    await user.click(screen.getByRole('button', { name: '数据与文档库' }));
    await screen.findByRole('heading', { name: '数据与文档库' });

    const splitter = screen.getByRole('separator', { name: '调整患者详情面板宽度' });
    const detailPanel = screen.getByTestId('data-library-detail-panel');

    expect(detailPanel).toHaveStyle({ width: '360px' });

    fireEvent.mouseDown(splitter, { clientX: 1000 });
    fireEvent.mouseMove(window, { clientX: 900 });
    fireEvent.mouseUp(window);

    expect(detailPanel).toHaveStyle({ width: '460px' });
  });

  it('resizes the data library detail and right task panels with pointer dragging', async () => {
    const restorePointerEvent = installPointerEventMock();
    const user = userEvent.setup();
    installBridge();

    try {
      render(<App />);

      await user.click(screen.getByRole('button', { name: '数据与文档库' }));
      await screen.findByRole('heading', { name: '数据与文档库' });

      const detailSplitter = screen.getByRole('separator', { name: '调整患者详情面板宽度' });
      const rightPanelSplitter = screen.getByRole('separator', { name: '调整任务队列面板宽度' });
      const detailPanel = screen.getByTestId('data-library-detail-panel');
      const rightPanel = screen.getByTestId('right-task-panel');

      expect(detailPanel).toHaveStyle({ width: '360px' });
      expect(rightPanel).toHaveStyle({ width: '320px' });

      fireEvent.pointerDown(detailSplitter, { clientX: 1000, pointerId: 1, pointerType: 'mouse' });
      fireEvent.pointerMove(window, { clientX: 880, pointerId: 1, pointerType: 'mouse' });
      fireEvent.pointerUp(window);

      fireEvent.pointerDown(rightPanelSplitter, { clientX: 1500, pointerId: 2, pointerType: 'mouse' });
      fireEvent.pointerMove(window, { clientX: 1380, pointerId: 2, pointerType: 'mouse' });
      fireEvent.pointerUp(window);

      expect(detailPanel).toHaveStyle({ width: '480px' });
      expect(rightPanel).toHaveStyle({ width: '440px' });
    } finally {
      restorePointerEvent();
    }
  });

  it('supports keyboard resizing and double-click reset for both vertical splitters', async () => {
    const user = userEvent.setup();
    installBridge();

    render(<App />);

    await user.click(screen.getByRole('button', { name: '数据与文档库' }));
    await screen.findByRole('heading', { name: '数据与文档库' });

    const detailSplitter = screen.getByRole('separator', { name: '调整患者详情面板宽度' });
    const rightPanelSplitter = screen.getByRole('separator', { name: '调整任务队列面板宽度' });
    const detailPanel = screen.getByTestId('data-library-detail-panel');
    const rightPanel = screen.getByTestId('right-task-panel');

    detailSplitter.focus();
    fireEvent.keyDown(detailSplitter, { key: 'ArrowLeft' });
    expect(detailPanel).toHaveStyle({ width: '384px' });
    expect(detailSplitter).toHaveAttribute('aria-valuenow', '384');

    fireEvent.keyDown(detailSplitter, { key: 'ArrowRight' });
    expect(detailPanel).toHaveStyle({ width: '360px' });

    fireEvent.keyDown(detailSplitter, { key: 'End' });
    expect(detailPanel).toHaveStyle({ width: '640px' });
    fireEvent.doubleClick(detailSplitter);
    expect(detailPanel).toHaveStyle({ width: '360px' });

    rightPanelSplitter.focus();
    fireEvent.keyDown(rightPanelSplitter, { key: 'ArrowLeft' });
    expect(rightPanel).toHaveStyle({ width: '344px' });
    expect(rightPanelSplitter).toHaveAttribute('aria-valuenow', '344');

    fireEvent.keyDown(rightPanelSplitter, { key: 'ArrowRight' });
    expect(rightPanel).toHaveStyle({ width: '320px' });

    fireEvent.keyDown(rightPanelSplitter, { key: 'End' });
    expect(rightPanel).toHaveStyle({ width: '680px' });
    fireEvent.doubleClick(rightPanelSplitter);
    expect(rightPanel).toHaveStyle({ width: '320px' });
  });

  it('clears the selected detail when a health row without patient id is selected', async () => {
    const user = userEvent.setup();
    const bridge = installBridge();

    render(<App />);

    await user.click(screen.getByRole('button', { name: '数据与文档库' }));
    const patientRow = await screen.findByRole('row', { name: /sub01/ });

    await user.click(within(patientRow).getByRole('button', { name: '查看 sub01 详情' }));
    expect(await screen.findByText('FMA 63 -> 65')).toBeInTheDocument();

    await user.click(screen.getByRole('row', { name: /sub001/ }));

    expect(screen.getByText('选择患者行后查看临床量表、文档资产与完整性检查。')).toBeInTheDocument();
    expect(screen.queryByText('FMA 63 -> 65')).not.toBeInTheDocument();
    expect(bridge.database.getPatientDocumentDetail).not.toHaveBeenCalledWith(null);
  });

  it('keeps the latest selected patient detail when an older request resolves last', async () => {
    const user = userEvent.setup();
    const delayedSub01 = createDeferred<PatientDocumentDetail>();
    const bridge = installBridge({
      listPatientAssetSummary: vi.fn().mockResolvedValue([
        summaryRows[0],
        {
          ...summaryRows[0],
          patientId: 'patient-sub02',
          subjectCode: 'sub02',
          subjectName: '王测试',
        },
      ]),
      getPatientDocumentDetail: vi.fn().mockImplementation((patientId: string) => {
        if (patientId === 'patient-sub01') return delayedSub01.promise;
        return Promise.resolve(sub02Detail);
      }),
    });

    render(<App />);

    await user.click(screen.getByRole('button', { name: '数据与文档库' }));
    const firstPatientRow = await screen.findByRole('row', { name: /sub01/ });
    const secondPatientRow = await screen.findByRole('row', { name: /sub02/ });

    await user.click(within(firstPatientRow).getByRole('button', { name: '查看 sub01 详情' }));
    await user.click(within(secondPatientRow).getByRole('button', { name: '查看 sub02 详情' }));

    expect(await screen.findByText('FMA 70 -> 75')).toBeInTheDocument();

    await act(async () => {
      delayedSub01.resolve(documentDetail);
      await delayedSub01.promise;
    });

    expect(bridge.database.getPatientDocumentDetail).toHaveBeenCalledWith('patient-sub01');
    expect(bridge.database.getPatientDocumentDetail).toHaveBeenCalledWith('patient-sub02');
    expect(screen.getByText('FMA 70 -> 75')).toBeInTheDocument();
    expect(screen.queryByText('FMA 63 -> 65')).not.toBeInTheDocument();
  });

  it('prevents duplicate scan requests while a scan is still running', async () => {
    const user = userEvent.setup();
    const pendingScan = createDeferred<ScanAndImportDataLibraryResult>();
    const bridge = installBridge({
      scanAndImportDataLibrary: vi.fn().mockReturnValue(pendingScan.promise),
    });

    render(<App />);

    await user.click(screen.getByRole('button', { name: '数据与文档库' }));
    const scanButton = await screen.findByRole('button', { name: '扫描并批量导入' });

    await user.click(scanButton);
    await user.click(scanButton);

    expect(bridge.database.scanAndImportDataLibrary).toHaveBeenCalledTimes(1);
    expect(scanButton).toBeDisabled();
    expect(screen.getByRole('button', { name: '扫描中...' })).toBeDisabled();
  });
});
