import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLocalDatabase, type LocalDatabase } from '../../../src/electron/backend/database.js';
import { upsertDataAsset, upsertSourceRoot } from '../../../src/electron/backend/dataLibrary/repository.js';
import {
  completePreprocessManualStep,
  createPreprocessBatch,
  getPreprocessOutputs,
  launchPreprocessManualStep,
  preparePreprocessMatlabExecution,
  runPreprocessMatlabExecution,
} from '../../../src/electron/backend/preprocessTasks.js';
import { createPatient, getWorkbenchData, listRecentTasks, updateSettings } from '../../../src/electron/backend/repositories.js';
import type { PreprocessBatchInput } from '../../../src/domain/backendTypes.js';

const roots: string[] = [];
const locals: LocalDatabase[] = [];

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-preprocess-'));
  roots.push(root);
  return root;
}

async function openTempDatabase(): Promise<LocalDatabase> {
  const local = await openLocalDatabase(createTempRoot());
  locals.push(local);
  return local;
}

function preprocessInput(overrides: Partial<PreprocessBatchInput> = {}): PreprocessBatchInput {
  return {
    patientIds: [],
    selectedEmptyChannels: [],
    selectedBadChannels: [],
    referenceMode: 'average',
    downsampleRate: 500,
    highPassHz: 1,
    lowPassHz: 45,
    notchHz: 50,
    ...overrides,
  };
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function indexBaselineCnt(
  local: LocalDatabase,
  patientId: string,
  subjectCode: string,
  fileName = 'mxg1.cnt',
): string {
  const sourceRootPath = path.join(local.paths.dataRoot, 'source-library');
  const sourceRoot = upsertSourceRoot(local.db, {
    projectName: 'M1',
    rootPath: sourceRootPath,
    status: 'active',
  });
  const filePath = path.join(sourceRootPath, 'Patient_tACS_M1_EEG', '基线', subjectCode, fileName);
  writeFile(filePath, 'raw cnt');

  upsertDataAsset(local.db, {
    sourceRootId: sourceRoot.id,
    patientId,
    subjectCode,
    sourceSubjectCode: subjectCode,
    subjectName: '',
    cohort: 'patient',
    stage: '基线',
    assetType: 'raw_eeg_cnt',
    filePath,
    backupPath: null,
    fileSize: fs.statSync(filePath).size,
    fileHash: '',
    existsOnDisk: true,
    matchStatus: 'matched',
  });

  return filePath;
}

function configureMatlabToolchain(local: LocalDatabase) {
  const matlabPath = path.join(local.paths.dataRoot, 'MATLAB', 'bin', 'matlab.exe');
  const eeglabPath = path.join(local.paths.dataRoot, 'tools', 'eeglab');
  const electrodeLocationFile = path.join(local.paths.dataRoot, 'tools', 'standard-10-5-cap385.elp');

  writeFile(matlabPath, 'matlab stub');
  fs.mkdirSync(eeglabPath, { recursive: true });
  writeFile(electrodeLocationFile, 'electrode locations');
  updateSettings(local.db, {
    matlabExecutable: matlabPath,
    eeglabPath,
    defaultElectrodeLocationFile: electrodeLocationFile,
  });

  return { matlabPath, eeglabPath, electrodeLocationFile };
}

function manualOutputPath(
  local: LocalDatabase,
  taskId: string,
  suffix: 'stage02_after_bad_segment' | 'stage04_after_ica_artifact',
): string {
  return processedOutputPath(local, taskId, suffix);
}

function processedOutputPath(local: LocalDatabase, taskId: string, suffix: string): string {
  const task = listRecentTasks(local.db).find((item) => item.id === taskId);
  const manifest = JSON.parse(task?.inputJson ?? '{}');
  const rawFile = manifest.baselineRawCntFiles?.[0] ?? `${manifest.patientId}.cnt`;
  const rawBaseName = path.basename(rawFile, path.extname(rawFile));

  return path.join(
    local.paths.outputsRoot,
    'preprocess',
    task?.batchId ?? 'manual',
    'processed',
    manifest.patientId,
    `${rawBaseName}_${suffix}.set`,
  );
}

function processedOutputPathForRawBase(local: LocalDatabase, taskId: string, rawBaseName: string, suffix: string): string {
  const task = listRecentTasks(local.db).find((item) => item.id === taskId);
  const manifest = JSON.parse(task?.inputJson ?? '{}');

  return path.join(
    local.paths.outputsRoot,
    'preprocess',
    task?.batchId ?? 'manual',
    'processed',
    manifest.patientId,
    `${rawBaseName}_${suffix}.set`,
  );
}

function manualFileTaskId(taskId: string, condition: 'EO' | 'EC'): string {
  return `${taskId}::manual-file::${condition}`;
}

function generatedMatlabLauncherScript(launchTargetPath: string, condition?: 'EO' | 'EC'): string {
  const launcherDir = path.dirname(launchTargetPath);
  const candidates = fs
    .readdirSync(launcherDir)
    .filter((name) => name.endsWith('_launch_eeglab.m'))
    .sort();
  const selected = condition
    ? candidates.find((name) => name.includes(`_${condition}_launch_eeglab.m`))
    : candidates.find((name) => !name.includes('_EO_launch_eeglab.m') && !name.includes('_EC_launch_eeglab.m')) ??
      candidates[0];

  if (!selected) {
    throw new Error(`No generated MATLAB EEGLAB launcher script found in ${launcherDir}`);
  }

  return path.join(launcherDir, selected);
}

afterEach(() => {
  for (const local of locals.splice(0)) {
    local.close();
  }

  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('preprocess task batch creation', () => {
  it('blocks M1/M2 rereference when M1 or M2 is selected as an empty channel without creating tasks or logs', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    const baselineTasks = listRecentTasks(local.db).length;
    const baselineLogs = getWorkbenchData(local.db, local.paths.dataRoot).logs.length;

    const result = createPreprocessBatch(
      local.db,
      preprocessInput({
        patientIds: [patientId],
        selectedEmptyChannels: ['fp1', 'm2'],
        referenceMode: 'm1m2',
      }),
    );

    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining('不能再选择 M1/M2 重参考'),
    });
    expect(listRecentTasks(local.db)).toHaveLength(baselineTasks);
    expect(getWorkbenchData(local.db, local.paths.dataRoot).logs).toHaveLength(baselineLogs);
  });

  it('creates preprocessing task packages and exposes the first manual checkpoint in workbench data', async () => {
    const local = await openTempDatabase();
    const patientOne = createPatient(local.db, { subjectCode: 'sub01' });
    const patientTwo = createPatient(local.db, { subjectCode: 'sub02' });
    const baselineEoCnt = indexBaselineCnt(local, patientOne, 'sub01', 'mxg1.cnt');
    const baselineEcCnt = indexBaselineCnt(local, patientOne, 'sub01', 'mxg2.cnt');
    indexBaselineCnt(local, patientOne, 'sub01', 'mxg3.cnt');
    indexBaselineCnt(local, patientOne, 'sub01', 'mxg4.cnt');
    const input = preprocessInput({
      patientIds: [patientOne, patientTwo],
      selectedEmptyChannels: ['Fp1'],
      selectedBadChannels: ['Oz'],
      referenceMode: 'average',
    });

    const result = createPreprocessBatch(local.db, input);

    expect(result).toEqual({
      ok: true,
      message: '已创建 2 个预处理任务。',
      batchId: expect.stringMatching(/^preprocess-/),
      taskIds: [expect.any(String), expect.any(String)],
    });

    const tasks = listRecentTasks(local.db).filter((task) => task.type === 'preprocess');
    expect(tasks).toHaveLength(2);
    expect(new Set(tasks.map((task) => task.batchId)).size).toBe(1);
    expect(new Set(result.taskIds)).toEqual(new Set(tasks.map((task) => task.id)));
    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patientId: patientOne,
          status: 'waiting_manual',
        }),
        expect.objectContaining({
          patientId: patientTwo,
          status: 'waiting_manual',
        }),
      ]),
    );

    const manifest = JSON.parse(tasks.find((task) => task.patientId === patientOne)?.inputJson ?? '{}');
    expect(manifest.baselineRawCntFiles).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('mxg3.cnt'),
        expect.stringContaining('mxg4.cnt'),
      ]),
    );
    expect(manifest).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        type: 'eeg_preprocess_task_package',
        displayName: '静息态 EEG 预处理',
        manualAction: '打开 EEGLAB 完成人工去除坏段',
        patientId: patientOne,
        batchId: tasks[0].batchId,
        baselineRawCntFiles: [baselineEoCnt, baselineEcCnt],
        parameters: expect.objectContaining({
          selectedEmptyChannels: ['Fp1'],
          selectedBadChannels: ['Oz'],
          referenceMode: 'average',
          downsampleRate: 500,
          highPassHz: 1,
          lowPassHz: 45,
          notchHz: 50,
        }),
        steps: expect.arrayContaining([
          expect.objectContaining({
            id: 'remove_empty_channels',
            status: 'planned',
            mode: 'matlab_batch',
          }),
          expect.objectContaining({
            id: 'manual_bad_segment_rejection',
            status: 'waiting_manual',
            mode: 'manual_eeglab',
          }),
          expect.objectContaining({
            id: 'manual_ica_artifact_rejection',
            status: 'blocked',
            mode: 'manual_eeglab',
          }),
          expect.objectContaining({
            id: 'rereference_and_save',
            status: 'blocked',
            mode: 'matlab_batch',
          }),
        ]),
        manualCheckpoints: [
          expect.objectContaining({
            stepId: 'manual_bad_segment_rejection',
            label: '人工去除坏段',
            status: 'waiting_manual',
          }),
          expect.objectContaining({
            stepId: 'manual_ica_artifact_rejection',
            label: '人工去除 ICA 伪迹',
            status: 'blocked',
          }),
        ],
      }),
    );

    const workbench = getWorkbenchData(local.db, local.paths.dataRoot);
    expect(JSON.stringify(workbench.tasks.manual)).not.toContain('UNKNOWN');
    expect(JSON.stringify(workbench.tasks.manual)).not.toContain('mxg3_stage01_before_bad_segment.set');
    expect(JSON.stringify(workbench.tasks.manual)).not.toContain('mxg4_stage01_before_bad_segment.set');
    expect(workbench.patients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patientId: patientOne,
          preStatus: '等待人工处理',
        }),
      ]),
    );
    expect(workbench.tasks.manual).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: manualFileTaskId(tasks.find((task) => task.patientId === patientOne)?.id ?? '', 'EO'),
          patient: 'sub01',
          name: '静息态 EEG 预处理 · 睁眼',
          action: '打开 EEGLAB 完成人工去除坏段（睁眼 EO）',
          manualFiles: [
            expect.objectContaining({
              condition: 'EO',
              label: '睁眼',
              sourceFileName: 'mxg1.cnt',
              stageFileName: 'mxg1_stage01_before_bad_segment.set',
            }),
          ],
        }),
        expect.objectContaining({
          id: manualFileTaskId(tasks.find((task) => task.patientId === patientOne)?.id ?? '', 'EC'),
          patient: 'sub01',
          name: '静息态 EEG 预处理 · 闭眼',
          action: '打开 EEGLAB 完成人工去除坏段（闭眼 EC）',
          manualFiles: [
            expect.objectContaining({
              condition: 'EC',
              label: '闭眼',
              sourceFileName: 'mxg2.cnt',
              stageFileName: 'mxg2_stage01_before_bad_segment.set',
            }),
          ],
        }),
      ]),
    );
    expect(workbench.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'info',
          text: expect.stringContaining('已生成预处理任务包'),
        }),
        expect.objectContaining({
          level: 'info',
          text: expect.stringContaining('等待人工节点: 人工去除坏段'),
        }),
      ]),
    );
  });

  it('requires MATLAB runs between manual checkpoints before marking preprocessing complete', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01');
    configureMatlabToolchain(local);
    createPreprocessBatch(
      local.db,
      preprocessInput({
        patientIds: [patientId],
        selectedBadChannels: ['Oz'],
      }),
    );
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';
    writeFile(manualOutputPath(local, taskId, 'stage02_after_bad_segment'), 'bad segment reviewed set');

    const firstResult = await completePreprocessManualStep(local.db, local.paths, taskId);

    expect(firstResult).toEqual({
      ok: true,
      message: '人工节点已完成：人工去除坏段。下一步请运行 MATLAB 完成坏导插值和 ICA。',
    });
    const taskAfterFirstStep = listRecentTasks(local.db).find((task) => task.id === taskId);
    const manifestAfterFirstStep = JSON.parse(taskAfterFirstStep?.inputJson ?? '{}');
    expect(taskAfterFirstStep).toEqual(
      expect.objectContaining({
        status: 'queued',
      }),
    );
    expect(manifestAfterFirstStep).toEqual(
      expect.objectContaining({
        manualAction: '运行 MATLAB 完成坏导插值和 ICA',
        steps: expect.arrayContaining([
          expect.objectContaining({ id: 'manual_bad_segment_rejection', status: 'completed' }),
          expect.objectContaining({ id: 'interpolate_bad_channels', status: 'planned' }),
          expect.objectContaining({ id: 'run_ica', status: 'planned' }),
          expect.objectContaining({ id: 'manual_ica_artifact_rejection', status: 'blocked' }),
          expect.objectContaining({ id: 'rereference_and_save', status: 'blocked' }),
        ]),
        manualCheckpoints: [
          expect.objectContaining({ stepId: 'manual_bad_segment_rejection', status: 'completed' }),
          expect.objectContaining({ stepId: 'manual_ica_artifact_rejection', status: 'blocked' }),
        ],
      }),
    );
    expect(getWorkbenchData(local.db, local.paths.dataRoot).tasks.manual).toEqual([]);
    expect(getWorkbenchData(local.db, local.paths.dataRoot).tasks.queued).toEqual([
      expect.objectContaining({
        id: taskId,
        action: '运行 MATLAB 完成坏导插值和 ICA',
      }),
    ]);

    const launchBeforeIca = await launchPreprocessManualStep(local.db, local.paths, taskId, vi.fn());
    expect(launchBeforeIca).toEqual({
      ok: false,
      message: '当前没有等待打开的人工节点。',
    });

    writeFile(processedOutputPath(local, taskId, 'stage03_before_ica_artifact'), 'ica ready set');
    const icaMatlabRun = await runPreprocessMatlabExecution(local.db, local.paths, taskId, vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'stage03 saved',
      stderr: '',
    }));

    expect(icaMatlabRun).toEqual(expect.objectContaining({ ok: true, exitCode: 0 }));
    expect(listRecentTasks(local.db).find((task) => task.id === taskId)).toEqual(
      expect.objectContaining({
        status: 'waiting_manual',
      }),
    );
    const manifestAfterIcaRun = JSON.parse(listRecentTasks(local.db).find((task) => task.id === taskId)?.inputJson ?? '{}');
    expect(manifestAfterIcaRun).toEqual(
      expect.objectContaining({
        manualAction: '打开 EEGLAB 完成人工去除 ICA 伪迹',
        steps: expect.arrayContaining([
          expect.objectContaining({ id: 'interpolate_bad_channels', status: 'completed' }),
          expect.objectContaining({ id: 'run_ica', status: 'completed' }),
          expect.objectContaining({ id: 'manual_ica_artifact_rejection', status: 'waiting_manual' }),
        ]),
        manualCheckpoints: [
          expect.objectContaining({ stepId: 'manual_bad_segment_rejection', status: 'completed' }),
          expect.objectContaining({ stepId: 'manual_ica_artifact_rejection', status: 'waiting_manual' }),
        ],
      }),
    );
    expect(getWorkbenchData(local.db, local.paths.dataRoot).tasks.manual).toEqual([
      expect.objectContaining({
        id: manualFileTaskId(taskId, 'EO'),
        action: '打开 EEGLAB 完成人工去除 ICA 伪迹（睁眼 EO）',
      }),
    ]);

    writeFile(manualOutputPath(local, taskId, 'stage04_after_ica_artifact'), 'ica artifact reviewed set');

    const secondResult = await completePreprocessManualStep(local.db, local.paths, taskId);

    expect(secondResult).toEqual({
      ok: true,
      message: '人工节点已完成：人工去除 ICA 伪迹。下一步请运行 MATLAB 完成重参考和最终保存。',
    });
    const taskAfterSecondStep = listRecentTasks(local.db).find((task) => task.id === taskId);
    const manifestAfterSecondStep = JSON.parse(taskAfterSecondStep?.inputJson ?? '{}');
    expect(taskAfterSecondStep).toEqual(
      expect.objectContaining({
        status: 'queued',
      }),
    );
    expect(manifestAfterSecondStep).toEqual(
      expect.objectContaining({
        manualAction: '运行 MATLAB 完成重参考和最终保存',
        steps: expect.arrayContaining([
          expect.objectContaining({ id: 'manual_ica_artifact_rejection', status: 'completed' }),
          expect.objectContaining({ id: 'rereference_and_save', status: 'planned' }),
        ]),
        manualCheckpoints: [
          expect.objectContaining({ stepId: 'manual_bad_segment_rejection', status: 'completed' }),
          expect.objectContaining({ stepId: 'manual_ica_artifact_rejection', status: 'completed' }),
        ],
      }),
    );
    expect(getWorkbenchData(local.db, local.paths.dataRoot).tasks.queued).toEqual([
      expect.objectContaining({
        id: taskId,
        action: '运行 MATLAB 完成重参考和最终保存',
      }),
    ]);

    writeFile(processedOutputPath(local, taskId, 'preprocessed_final'), 'final rereferenced set');
    const finalMatlabRun = await runPreprocessMatlabExecution(local.db, local.paths, taskId, vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'final saved',
      stderr: '',
    }));

    expect(finalMatlabRun).toEqual(expect.objectContaining({ ok: true, exitCode: 0 }));
    const completedTask = listRecentTasks(local.db).find((task) => task.id === taskId);
    expect(completedTask).toEqual(
      expect.objectContaining({
        status: 'completed',
        finishedAt: expect.any(String),
      }),
    );
    const completedManifest = JSON.parse(completedTask?.inputJson ?? '{}');
    expect(completedManifest).toEqual(
      expect.objectContaining({
        manualAction: '预处理已完成',
        steps: expect.arrayContaining([
          expect.objectContaining({ id: 'rereference_and_save', status: 'completed' }),
        ]),
      }),
    );
    const workbenchAfterCompletion = getWorkbenchData(local.db, local.paths.dataRoot);
    expect(workbenchAfterCompletion.tasks.manual).toEqual([]);
    expect(workbenchAfterCompletion.tasks.queued).toEqual([]);
    expect(workbenchAfterCompletion.patients).toEqual([
      expect.objectContaining({
        patientId,
        preStatus: '已完成',
      }),
    ]);
    expect(workbenchAfterCompletion.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining('人工节点已完成: 人工去除坏段') }),
        expect.objectContaining({ text: expect.stringContaining('预处理任务已完成') }),
      ]),
    );
  });

  it('lists preprocessing output files for a patient without copying EEG data', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '测试患者' });
    indexBaselineCnt(local, patientId, 'sub01');

    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const task = listRecentTasks(local.db).find((item) => item.type === 'preprocess');
    expect(task).toBeDefined();

    const outputDir = path.join(local.paths.outputsRoot, 'preprocess', task!.batchId!, 'processed', patientId);
    const packagePath = path.join(local.paths.outputsRoot, 'preprocess', task!.batchId!, `${task!.id}-matlab-execution.json`);
    const finalSetPath = path.join(outputDir, 'mxg1_preprocessed_final.set');
    const finalFdtPath = path.join(outputDir, 'mxg1_preprocessed_final.fdt');
    const instructionPath = path.join(outputDir, 'manual_preprocess_instructions.txt');
    writeFile(finalSetPath, 'final set');
    writeFile(finalFdtPath, 'final fdt');
    writeFile(instructionPath, 'manual instructions');
    writeFile(packagePath, '{}');

    const outputs = getPreprocessOutputs(local.db, local.paths, patientId);

    expect(outputs).toEqual(
      expect.objectContaining({
        patientId,
        subjectCode: 'sub01',
        latestTaskId: task!.id,
        taskStatus: 'waiting_manual',
        outputDirectories: expect.arrayContaining([outputDir]),
        warnings: [],
      }),
    );
    expect(outputs.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: finalSetPath,
          fileName: 'mxg1_preprocessed_final.set',
          kind: 'final_set',
          existsOnDisk: true,
        }),
        expect.objectContaining({
          filePath: finalFdtPath,
          fileName: 'mxg1_preprocessed_final.fdt',
          kind: 'final_fdt',
          existsOnDisk: true,
        }),
        expect.objectContaining({ filePath: instructionPath, kind: 'manual_instructions', existsOnDisk: true }),
        expect.objectContaining({ filePath: packagePath, kind: 'matlab_package', existsOnDisk: true }),
      ]),
    );
  });

  it('keeps a manual checkpoint waiting when the expected EEGLAB output file is missing', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01');
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';

    const result = await completePreprocessManualStep(local.db, local.paths, taskId);

    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining('未检测到 EEGLAB 保存的人工去除坏段结果文件'),
    });
    const taskAfterAttempt = listRecentTasks(local.db).find((task) => task.id === taskId);
    const manifestAfterAttempt = JSON.parse(taskAfterAttempt?.inputJson ?? '{}');
    expect(taskAfterAttempt).toEqual(expect.objectContaining({ status: 'waiting_manual' }));
    expect(manifestAfterAttempt).toEqual(
      expect.objectContaining({
        manualAction: '打开 EEGLAB 完成人工去除坏段',
        manualCheckpoints: [
          expect.objectContaining({ stepId: 'manual_bad_segment_rejection', status: 'waiting_manual' }),
          expect.objectContaining({ stepId: 'manual_ica_artifact_rejection', status: 'blocked' }),
        ],
      }),
    );
    expect(getWorkbenchData(local.db, local.paths.dataRoot).logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warning',
          text: expect.stringContaining('未检测到 EEGLAB 保存的人工去除坏段结果文件'),
        }),
      ]),
    );
  });

  it('exports the current task package and opens the configured MATLAB executable for a manual checkpoint', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01');
    const { matlabPath, eeglabPath } = configureMatlabToolchain(local);
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';
    writeFile(processedOutputPath(local, taskId, 'stage01_before_bad_segment'), 'bad segment candidate set');
    const openPath = vi.fn().mockResolvedValue('');

    const result = await launchPreprocessManualStep(local.db, local.paths, taskId, openPath);

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.stringContaining('已导出预处理任务包并打开 MATLAB/EEGLAB'),
        packagePath: expect.stringContaining(path.join('outputs', 'preprocess')),
        launchTargetPath: expect.stringContaining('launch-eeglab'),
      }),
    );
    expect(openPath).toHaveBeenCalledWith(result.launchTargetPath);

    const exported = JSON.parse(fs.readFileSync(result.packagePath ?? '', 'utf8'));
    const launcher = fs.readFileSync(result.launchTargetPath ?? '', 'utf8');
    const launcherScript = fs.readFileSync((result.launchTargetPath ?? '').replace(/\.cmd$/i, '.ps1'), 'utf8');
    const matlabLauncherScript = fs.readFileSync(
      generatedMatlabLauncherScript(result.launchTargetPath ?? ''),
      'utf8',
    );
    expect(path.basename(generatedMatlabLauncherScript(result.launchTargetPath ?? ''), '.m').length).toBeLessThanOrEqual(63);
    expect(exported).toEqual(
      expect.objectContaining({
        taskId,
        patientId,
        currentManualCheckpoint: expect.objectContaining({
          stepId: 'manual_bad_segment_rejection',
          label: '人工去除坏段',
        }),
        taskPackage: expect.objectContaining({
          type: 'eeg_preprocess_task_package',
          manualAction: '打开 EEGLAB 完成人工去除坏段',
        }),
      }),
    );
    expect(launcher).toContain(matlabPath);
    expect(launcher).toContain(eeglabPath);
    expect(launcher).toContain('eeglab');
    expect(launcher).toContain('powershell.exe');
    expect(launcherScript).toContain("run('");
    expect(launcherScript).not.toContain('pop_loadset');
    expect(matlabLauncherScript).toContain('try');
    expect(matlabLauncherScript).toContain('pop_loadset');
    expect(matlabLauncherScript).toContain('stage01_before_bad_segment.set');
    expect(matlabLauncherScript).toContain('neuro_predict_manual_save_poll');
    expect(matlabLauncherScript).toContain('stage02_after_bad_segment.set');
    expect(getWorkbenchData(local.db, local.paths.dataRoot).logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining('已导出预处理任务包') }),
        expect.objectContaining({ text: expect.stringContaining('已请求打开 MATLAB/EEGLAB') }),
      ]),
    );
  });

  it('writes an EEGLAB launcher that reuses an already running MATLAB instance when possible', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01');
    configureMatlabToolchain(local);
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';
    writeFile(processedOutputPath(local, taskId, 'stage01_before_bad_segment'), 'bad segment candidate set');

    const result = await launchPreprocessManualStep(local.db, local.paths, taskId, vi.fn().mockResolvedValue(''));

    expect(result).toEqual(expect.objectContaining({ ok: true, launchTargetPath: expect.stringContaining('launch-eeglab.cmd') }));
    const launcher = fs.readFileSync(result.launchTargetPath ?? '', 'utf8');
    const launcherScriptPath = path.join(path.dirname(result.launchTargetPath ?? ''), `${taskId}-launch-eeglab.ps1`);
    expect(launcher).toContain('powershell');
    expect(launcher).toContain('-Sta');
    expect(launcher).toContain(launcherScriptPath);
    expect(fs.existsSync(launcherScriptPath)).toBe(true);
    const launcherScript = fs.readFileSync(launcherScriptPath, 'utf8');
    expect(launcherScript).toContain("GetActiveObject('Matlab.Application')");
    expect(launcherScript).toContain('$matlab.Execute($matlabCommands)');
    expect(launcherScript).toContain('Get-Process -Name MATLAB');
    expect(launcherScript).toContain('ShowWindowAsync');
    expect(launcherScript).toContain('SetForegroundWindow');
    expect(launcherScript).toContain('$shell.AppActivate($matlabProcess.MainWindowTitle)');
    expect(launcherScript).toContain('function Set-NeuroPredictClipboardText');
    expect(launcherScript).toContain('[System.Windows.Forms.Clipboard]::SetText($text)');
    expect(launcherScript).toContain("[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')");
    expect(launcherScript).toContain('Start-Process');
    expect(launcherScript).toContain('$hasAnyMatlabProcess');
    expect(launcherScript).toContain('MATLAB is already running, but NeuroPredict could not activate it');
    expect(launcherScript).not.toContain("$matlabCommands = @'");
    const commandAssignment = launcherScript
      .split(/\r?\n/)
      .find((line) => line.startsWith('$matlabCommands = '));
    expect(commandAssignment).toBeDefined();
    expect(commandAssignment).toContain("run('");
    expect(commandAssignment).not.toContain('try;');
    expect(commandAssignment).not.toContain('pop_loadset');
    const matlabLauncherScript = fs.readFileSync(generatedMatlabLauncherScript(result.launchTargetPath ?? ''), 'utf8');
    expect(path.basename(generatedMatlabLauncherScript(result.launchTargetPath ?? ''), '.m').length).toBeLessThanOrEqual(63);
    expect(matlabLauncherScript).toContain('try');
    expect(matlabLauncherScript).toContain('eeglab');
    expect(matlabLauncherScript).toContain('pop_loadset');
    expect(matlabLauncherScript).toContain('stage01_before_bad_segment.set');
  });

  it('opens only one resting-state condition in EEGLAB when a split manual file task is launched', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01', 'mxg1.cnt');
    indexBaselineCnt(local, patientId, 'sub01', 'mxg2.cnt');
    configureMatlabToolchain(local);
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';
    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg1', 'stage01_before_bad_segment'), 'eo candidate set');
    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg2', 'stage01_before_bad_segment'), 'ec candidate set');
    const openPath = vi.fn().mockResolvedValue('');

    const result = await launchPreprocessManualStep(local.db, local.paths, manualFileTaskId(taskId, 'EO'), openPath);

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        manualSaveOutputPaths: [expect.stringContaining('mxg1_stage02_after_bad_segment.set')],
      }),
    );
    expect(result.manualSaveOutputPaths).not.toEqual(
      expect.arrayContaining([expect.stringContaining('mxg2_stage02_after_bad_segment.set')]),
    );
    const packageJson = JSON.parse(fs.readFileSync(result.packagePath ?? '', 'utf8'));
    expect(packageJson.manualSave.inputPaths).toEqual([expect.stringContaining('mxg1_stage01_before_bad_segment.set')]);
    expect(packageJson.manualSave.outputPaths).toEqual([expect.stringContaining('mxg1_stage02_after_bad_segment.set')]);
    expect(packageJson.taskPackage.baselineRawCntFiles).toEqual([expect.stringContaining('mxg1.cnt')]);
    const launcherScript = fs.readFileSync((result.launchTargetPath ?? '').replace(/\.cmd$/i, '.ps1'), 'utf8');
    expect(launcherScript).toContain("run('");
    expect(launcherScript).not.toContain('mxg1_stage01_before_bad_segment.set');
    const matlabLauncherScript = fs.readFileSync(
      generatedMatlabLauncherScript(result.launchTargetPath ?? '', 'EO'),
      'utf8',
    );
    expect(
      path.basename(generatedMatlabLauncherScript(result.launchTargetPath ?? '', 'EO'), '.m').length,
    ).toBeLessThanOrEqual(63);
    expect(matlabLauncherScript).toContain('mxg1_stage01_before_bad_segment.set');
    expect(matlabLauncherScript).toContain('NeuroPredictManualDatasetIndices');
    expect(launcherScript).not.toContain('mxg2_stage01_before_bad_segment.set');
    expect(matlabLauncherScript).not.toContain('mxg2_stage01_before_bad_segment.set');
  });

  it('requests EEGLAB to save the open bad-segment dataset before completing the manual checkpoint', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01');
    configureMatlabToolchain(local);
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';
    writeFile(processedOutputPath(local, taskId, 'stage01_before_bad_segment'), 'bad segment candidate set');

    await launchPreprocessManualStep(local.db, local.paths, taskId, vi.fn().mockResolvedValue(''));
    const launchedTask = listRecentTasks(local.db).find((task) => task.id === taskId);
    const launchOutput = JSON.parse(launchedTask?.outputJson ?? '{}');
    const requestPath = launchOutput.manualSaveRequestPath;
    const expectedOutputPath = manualOutputPath(local, taskId, 'stage02_after_bad_segment');
    const packageJson = JSON.parse(fs.readFileSync(launchOutput.manualPackagePath, 'utf8'));
    const saveHelper = fs.readFileSync(packageJson.manualSave.helperPath, 'utf8');
    expect(saveHelper).toContain("CURRENTSET = evalin('base', 'CURRENTSET')");
    expect(saveHelper).toContain("datasetIndices = evalin('base', 'NeuroPredictManualDatasetIndices')");

    const completionPromise = completePreprocessManualStep(local.db, local.paths, taskId, {
      saveTimeoutMs: 1000,
      savePollIntervalMs: 10,
    } as never);

    await waitUntil(() => fs.existsSync(requestPath));
    writeFile(expectedOutputPath, 'automatically saved bad segment review');

    await expect(completionPromise).resolves.toEqual({
      ok: true,
      message: '人工节点已完成：人工去除坏段。下一步请运行 MATLAB 完成坏导插值和 ICA。',
    });
    expect(fs.existsSync(expectedOutputPath)).toBe(true);
    expect(getWorkbenchData(local.db, local.paths.dataRoot).tasks.queued).toEqual([
      expect.objectContaining({
        id: taskId,
        action: '运行 MATLAB 完成坏导插值和 ICA',
      }),
    ]);
  });

  it('keeps the preprocessing task waiting until both split bad-segment files are completed', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01', 'mxg1.cnt');
    indexBaselineCnt(local, patientId, 'sub01', 'mxg2.cnt');
    configureMatlabToolchain(local);
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';
    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg1', 'stage02_after_bad_segment'), 'eo reviewed set');

    const eoResult = await completePreprocessManualStep(local.db, local.paths, manualFileTaskId(taskId, 'EO'));

    expect(eoResult).toEqual({
      ok: true,
      message: '人工节点已完成：人工去除坏段（睁眼 EO）。请继续处理剩余静息态文件。',
    });
    expect(listRecentTasks(local.db).find((task) => task.id === taskId)).toEqual(
      expect.objectContaining({ status: 'waiting_manual' }),
    );
    expect(getWorkbenchData(local.db, local.paths.dataRoot).tasks.manual).toEqual([
      expect.objectContaining({
        id: manualFileTaskId(taskId, 'EC'),
        manualFiles: [expect.objectContaining({ condition: 'EC' })],
      }),
    ]);

    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg2', 'stage02_after_bad_segment'), 'ec reviewed set');
    const ecResult = await completePreprocessManualStep(local.db, local.paths, manualFileTaskId(taskId, 'EC'));

    expect(ecResult).toEqual({
      ok: true,
      message: '人工节点已完成：人工去除坏段。下一步请运行 MATLAB 完成坏导插值和 ICA。',
    });
    expect(getWorkbenchData(local.db, local.paths.dataRoot).tasks.queued).toEqual([
      expect.objectContaining({
        id: taskId,
        action: '运行 MATLAB 完成坏导插值和 ICA',
      }),
    ]);
  });

  it('keeps the task on final rereference when a split final output is still missing', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01', 'mxg1.cnt');
    indexBaselineCnt(local, patientId, 'sub01', 'mxg2.cnt');
    configureMatlabToolchain(local);
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';

    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg1', 'stage02_after_bad_segment'), 'eo reviewed set');
    await completePreprocessManualStep(local.db, local.paths, manualFileTaskId(taskId, 'EO'));
    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg2', 'stage02_after_bad_segment'), 'ec reviewed set');
    await completePreprocessManualStep(local.db, local.paths, manualFileTaskId(taskId, 'EC'));

    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg1', 'stage03_before_ica_artifact'), 'eo ica ready set');
    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg2', 'stage03_before_ica_artifact'), 'ec ica ready set');
    await runPreprocessMatlabExecution(local.db, local.paths, taskId, vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'stage03 saved',
      stderr: '',
    }));

    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg1', 'stage04_after_ica_artifact'), 'eo ica reviewed set');
    await completePreprocessManualStep(local.db, local.paths, manualFileTaskId(taskId, 'EO'));
    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg2', 'stage04_after_ica_artifact'), 'ec ica reviewed set');
    await completePreprocessManualStep(local.db, local.paths, manualFileTaskId(taskId, 'EC'));

    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg1', 'preprocessed_final'), 'eo final set');
    const result = await runPreprocessMatlabExecution(local.db, local.paths, taskId, vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'one final saved',
      stderr: '',
    }));

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.stringContaining('尚未检测到全部最终预处理文件'),
      }),
    );
    const taskAfterFinalAttempt = listRecentTasks(local.db).find((task) => task.id === taskId);
    expect(taskAfterFinalAttempt).toEqual(expect.objectContaining({ status: 'queued' }));
    const manifest = JSON.parse(taskAfterFinalAttempt?.inputJson ?? '{}');
    expect(manifest).toEqual(
      expect.objectContaining({
        manualAction: '运行 MATLAB 完成重参考和最终保存',
        manualCheckpoints: [
          expect.objectContaining({ stepId: 'manual_bad_segment_rejection', status: 'completed' }),
          expect.objectContaining({ stepId: 'manual_ica_artifact_rejection', status: 'completed' }),
        ],
      }),
    );
    expect(getWorkbenchData(local.db, local.paths.dataRoot).tasks.manual).toEqual([]);
    expect(getWorkbenchData(local.db, local.paths.dataRoot).tasks.queued).toEqual([
      expect.objectContaining({
        id: taskId,
        action: '运行 MATLAB 完成重参考和最终保存',
      }),
    ]);
  });

  it('marks EO and EC available from completed preprocessing final outputs', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01', 'mxg1.cnt');
    indexBaselineCnt(local, patientId, 'sub01', 'mxg2.cnt');
    configureMatlabToolchain(local);
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';
    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg1', 'preprocessed_final'), 'eo final set');
    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg2', 'preprocessed_final'), 'ec final set');

    await runPreprocessMatlabExecution(local.db, local.paths, taskId, vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'final saved',
      stderr: '',
    }));

    expect(getWorkbenchData(local.db, local.paths.dataRoot).patients).toEqual([
      expect.objectContaining({
        patientId,
        eo: true,
        ec: true,
        preStatus: '已完成',
      }),
    ]);
  });

  it('does not launch a manual checkpoint before MATLAB has generated the expected stage SET file', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01');
    configureMatlabToolchain(local);
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';
    const openPath = vi.fn().mockResolvedValue('');

    const result = await launchPreprocessManualStep(local.db, local.paths, taskId, openPath);

    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining('请先运行 MATLAB 预处理生成人工节点输入文件'),
    });
    expect(result.message).toContain('stage01_before_bad_segment');
    expect(openPath).not.toHaveBeenCalled();
    expect(getWorkbenchData(local.db, local.paths.dataRoot).logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warning',
          text: expect.stringContaining('人工节点输入文件尚未生成'),
        }),
      ]),
    );
  });

  it('does not launch a manual checkpoint when MATLAB and EEGLAB paths are invalid', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01');
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    updateSettings(local.db, {
      matlabExecutable: path.join(local.paths.dataRoot, 'missing', 'matlab.exe'),
      eeglabPath: path.join(local.paths.dataRoot, 'missing', 'eeglab'),
    });
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';
    writeFile(processedOutputPath(local, taskId, 'stage01_before_bad_segment'), 'bad segment candidate set');
    const openPath = vi.fn();

    const result = await launchPreprocessManualStep(local.db, local.paths, taskId, openPath);

    expect(result).toEqual({
      ok: false,
      message: '请在环境设置中同时配置有效的 MATLAB 可执行文件和 EEGLAB 路径。',
    });
    expect(openPath).not.toHaveBeenCalled();
    expect(getWorkbenchData(local.db, local.paths.dataRoot).logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warning',
          text: expect.stringContaining('已配置的 MATLAB 可执行文件或 EEGLAB 路径不存在'),
        }),
      ]),
    );
  });

  it('uses installed MATLAB 2020a and EEGLAB 2021.1 defaults when manual launch settings are empty', async () => {
    const defaultMatlabPath = 'F:\\Matlab2020a\\bin\\matlab.exe';
    const defaultEeglabPath = 'F:\\Matlab2020a\\toolbox\\eeglab2021.1';
    if (!fs.existsSync(defaultMatlabPath) || !fs.existsSync(defaultEeglabPath)) {
      return;
    }

    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01');
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';
    writeFile(processedOutputPath(local, taskId, 'stage01_before_bad_segment'), 'bad segment candidate set');
    const openPath = vi.fn().mockResolvedValue('');

    const result = await launchPreprocessManualStep(local.db, local.paths, taskId, openPath);

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.stringContaining('已导出预处理任务包并打开 MATLAB/EEGLAB'),
        launchTargetPath: expect.stringContaining('launch-eeglab'),
      }),
    );
    expect(openPath).toHaveBeenCalledWith(result.launchTargetPath);

    const launcher = fs.readFileSync(result.launchTargetPath ?? '', 'utf8');
    expect(launcher).toContain(defaultMatlabPath);
    expect(launcher).toContain(defaultEeglabPath);
  });

  it('prepares a MATLAB GUI-reuse entry script, task package, and command preview for a preprocessing task', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    const baselineCnt = indexBaselineCnt(local, patientId, 'sub01');
    const { matlabPath, electrodeLocationFile } = configureMatlabToolchain(local);
    createPreprocessBatch(
      local.db,
      preprocessInput({
        patientIds: [patientId],
        selectedEmptyChannels: ['HEO', 'VEO'],
        selectedBadChannels: ['Oz'],
        referenceMode: 'average',
      }),
    );
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';

    const result = preparePreprocessMatlabExecution(local.db, local.paths, taskId);

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.stringContaining('MATLAB 执行入口已准备'),
        scriptPath: path.join(local.paths.outputsRoot, 'preprocess', 'matlab', 'run_preprocess_task.m'),
        packagePath: expect.stringContaining(`${taskId}-matlab-execution.json`),
        command: expect.not.stringContaining('-batch'),
        launcherScriptPath: expect.stringContaining('_run_preprocess.m'),
        powershellLauncherPath: expect.stringContaining('-run-matlab.ps1'),
        donePath: expect.stringContaining('-done.txt'),
        errorPath: expect.stringContaining('-error.txt'),
        logPath: expect.stringContaining('-matlab.log'),
      }),
    );
    expect(result.command).toContain('run(');
    expect(result.command).toContain(result.packagePath);
    expect(result.command).toContain((result as any).launcherScriptPath);

    const script = fs.readFileSync(result.scriptPath ?? '', 'utf8');
    expect(script).toContain('function run_preprocess_task(taskPackagePath)');
    expect(script).toContain('jsondecode');
    expect(script).toContain('pop_loadcnt');
    expect(script).toContain('pop_chanedit');
    expect(script).toContain('pop_select');
    expect(script).toContain('pop_resample');
    expect(script).toContain('pop_eegfiltnew');
    expect(script).toContain('runica');
    expect(script).toContain('pop_reref');
    expect(script).not.toContain('EEGLAB preprocessing implementation goes here');

    const launcherScript = fs.readFileSync((result as any).launcherScriptPath ?? '', 'utf8');
    expect(path.basename((result as any).launcherScriptPath ?? '', '.m').length).toBeLessThanOrEqual(63);
    expect(launcherScript).toContain('run_preprocess_task');
    expect(launcherScript).toContain(result.packagePath);
    expect(launcherScript).toContain((result as any).donePath);
    expect(launcherScript).toContain((result as any).errorPath);
    expect(launcherScript).toContain((result as any).logPath);

    expect(launcherScript).toContain('exit(0);');
    expect(launcherScript).toContain('exit(1);');

    const powershellLauncher = fs.readFileSync((result as any).powershellLauncherPath ?? '', 'utf8');
    expect(powershellLauncher).toContain('Start-Process -FilePath $matlabExe');
    expect(powershellLauncher).toContain("'-wait'");
    expect(powershellLauncher).toContain('$startupTimeoutAt');
    expect(powershellLauncher).toContain('MATLAB did not start executing the NeuroPredict script');
    expect(powershellLauncher).not.toContain('Get-Process -Name MATLAB');
    expect(powershellLauncher).not.toContain('AppActivate');
    expect(powershellLauncher).not.toContain('SetForegroundWindow');
    expect(powershellLauncher).not.toContain('Set-NeuroPredictClipboardText');
    expect(powershellLauncher).toContain((result as any).launcherScriptPath);

    const taskPackage = JSON.parse(fs.readFileSync(result.packagePath ?? '', 'utf8'));
    const sourceLibraryRoot = path.join(local.paths.dataRoot, 'source-library');
    const runtimeOutputDir = path.join(path.dirname(result.packagePath ?? ''), 'processed', patientId);

    expect(taskPackage).toEqual(
      expect.objectContaining({
        taskId,
        patientId,
        matlab: expect.objectContaining({
          matlabExecutable: matlabPath,
          entryScriptPath: result.scriptPath,
          launcherScriptPath: (result as any).launcherScriptPath,
          donePath: (result as any).donePath,
          errorPath: (result as any).errorPath,
          logPath: (result as any).logPath,
          electrodeLocationFile,
        }),
        taskPackage: expect.objectContaining({
          baselineRawCntFiles: [baselineCnt],
          parameters: expect.objectContaining({
            selectedEmptyChannels: ['HEO', 'VEO'],
            selectedBadChannels: ['Oz'],
          }),
        }),
      }),
    );
    expect(runtimeOutputDir.startsWith(local.paths.outputsRoot)).toBe(true);
    expect(runtimeOutputDir.startsWith(sourceLibraryRoot)).toBe(false);
    expect(runtimeOutputDir).not.toContain('Patient_tACS_M1_EEG');
    expect(runtimeOutputDir).not.toContain('Patient_tACS_M1_RestingStateEEG_afterProcess');
    expect(getWorkbenchData(local.db, local.paths.dataRoot).logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining('MATLAB 执行入口已准备') }),
      ]),
    );
  });

  it('short-circuits generated MATLAB preprocessing from existing stage files before loading raw EEG', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01', 'mxg1.cnt');
    configureMatlabToolchain(local);
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';

    const result = preparePreprocessMatlabExecution(local.db, local.paths, taskId);

    const script = fs.readFileSync(result.scriptPath ?? '', 'utf8');
    const firstRawLoad = script.indexOf('[EEG, baseName] = np_load_eeg(rawFile);');
    const finalAlreadyExistsCheck = script.indexOf("if exist(finalPath, 'file') == 2");
    const finalResumeCheck = script.indexOf("if exist(stage04Path, 'file') == 2");
    const icaResumeCheck = script.indexOf("if exist(stage02Path, 'file') == 2");
    const waitingArtifactCheck = script.indexOf("if exist(stage03Path, 'file') == 2");
    const waitingBadSegmentCheck = script.indexOf("if exist(stage01Path, 'file') == 2");

    expect(firstRawLoad).toBeGreaterThan(-1);
    expect(finalAlreadyExistsCheck).toBeGreaterThan(-1);
    expect(finalResumeCheck).toBeGreaterThan(-1);
    expect(icaResumeCheck).toBeGreaterThan(-1);
    expect(waitingArtifactCheck).toBeGreaterThan(-1);
    expect(waitingBadSegmentCheck).toBeGreaterThan(-1);
    expect(finalAlreadyExistsCheck).toBeLessThan(firstRawLoad);
    expect(finalResumeCheck).toBeLessThan(firstRawLoad);
    expect(icaResumeCheck).toBeLessThan(firstRawLoad);
    expect(waitingArtifactCheck).toBeLessThan(firstRawLoad);
    expect(waitingBadSegmentCheck).toBeLessThan(firstRawLoad);
    expect(script).toContain("fprintf('Final preprocessed EEG already exists: %s\\n', finalPath);");
    expect(script).toContain("fprintf('Resuming final rereference from ICA artifact file: %s\\n', stage04Path);");
  });

  it('does not prepare a MATLAB command when the patient has no indexed baseline CNT file', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    configureMatlabToolchain(local);
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';

    const result = preparePreprocessMatlabExecution(local.db, local.paths, taskId);

    expect(result).toEqual({
      ok: false,
      message: '未找到该患者的基线睁眼/闭眼静息态 CNT 原始 EEG 文件，请先在数据与文档库中完成索引。',
    });
    expect(getWorkbenchData(local.db, local.paths.dataRoot).logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warning',
          text: expect.stringContaining('未找到该患者的基线睁眼/闭眼静息态 CNT 原始 EEG 文件'),
        }),
      ]),
    );
  });

  it('does not prepare a MATLAB command when EEGLAB or electrode location paths are missing', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01');
    const matlabPath = path.join(local.paths.dataRoot, 'MATLAB', 'bin', 'matlab.exe');
    writeFile(matlabPath, 'matlab stub');
    updateSettings(local.db, {
      matlabExecutable: matlabPath,
      eeglabPath: path.join(local.paths.dataRoot, 'missing', 'eeglab'),
      defaultElectrodeLocationFile: path.join(local.paths.dataRoot, 'missing', 'standard-10-5-cap385.elp'),
    });
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';

    const result = preparePreprocessMatlabExecution(local.db, local.paths, taskId);

    expect(result).toEqual({
      ok: false,
      message: 'EEGLAB 路径不存在，请检查环境设置。',
    });
    expect(getWorkbenchData(local.db, local.paths.dataRoot).logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warning',
          text: expect.stringContaining('EEGLAB 路径不存在'),
        }),
      ]),
    );
  });

  it('does not prepare a MATLAB command when the MATLAB executable path is invalid', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    updateSettings(local.db, {
      matlabExecutable: path.join(local.paths.dataRoot, 'missing', 'matlab.exe'),
    });
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';

    const result = preparePreprocessMatlabExecution(local.db, local.paths, taskId);

    expect(result).toEqual({
      ok: false,
      message: 'MATLAB 可执行文件路径不存在，请检查环境设置。',
    });
    expect(fs.existsSync(path.join(local.paths.outputsRoot, 'preprocess', 'matlab', 'run_preprocess_task.m'))).toBe(
      false,
    );
    expect(getWorkbenchData(local.db, local.paths.dataRoot).logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warning',
          text: expect.stringContaining('MATLAB 可执行文件路径不存在'),
        }),
      ]),
    );
  });

  it('runs the prepared MATLAB preprocessing command and stores execution output', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01');
    const { matlabPath } = configureMatlabToolchain(local);
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';
    const executeMatlab = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'stage01 saved',
      stderr: '',
    });

    const result = await runPreprocessMatlabExecution(local.db, local.paths, taskId, executeMatlab);

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.stringContaining('MATLAB 预处理已执行'),
        exitCode: 0,
        stdout: 'stage01 saved',
      }),
    );
    expect(executeMatlab).toHaveBeenCalledWith(
      matlabPath,
      expect.arrayContaining(['-nosplash', '-r', expect.stringContaining('run(')]),
      expect.objectContaining({
        launcherScriptPath: expect.stringContaining('_run_preprocess.m'),
        powershellLauncherPath: expect.stringContaining('-run-matlab.ps1'),
      }),
    );
    const updatedTask = listRecentTasks(local.db).find((task) => task.id === taskId);
    expect(JSON.parse(updatedTask?.outputJson ?? '{}')).toEqual(
      expect.objectContaining({
        matlabExitCode: 0,
        matlabStdout: 'stage01 saved',
      }),
    );
    expect(getWorkbenchData(local.db, local.paths.dataRoot).logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining('MATLAB 预处理执行完成') }),
      ]),
    );
  });

  it('runs MATLAB preprocessing when called with a split manual file task id', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01', 'mxg1.cnt');
    indexBaselineCnt(local, patientId, 'sub01', 'mxg2.cnt');
    const { matlabPath } = configureMatlabToolchain(local);
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';
    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg1', 'stage02_after_bad_segment'), 'eo reviewed set');
    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg2', 'stage02_after_bad_segment'), 'ec reviewed set');
    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg1', 'stage03_before_ica_artifact'), 'eo ica ready set');
    writeFile(processedOutputPathForRawBase(local, taskId, 'mxg2', 'stage03_before_ica_artifact'), 'ec ica ready set');
    const executeMatlab = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'stage03 saved',
      stderr: '',
    });

    const result = await runPreprocessMatlabExecution(local.db, local.paths, manualFileTaskId(taskId, 'EC'), executeMatlab);

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        exitCode: 0,
        message: 'MATLAB 预处理已执行，已生成 ICA 人工处理文件。请继续人工去除 ICA 伪迹。',
      }),
    );
    expect(executeMatlab).toHaveBeenCalledWith(
      matlabPath,
      expect.arrayContaining(['-nosplash', '-r', expect.stringContaining('run(')]),
      expect.objectContaining({
        launcherScriptPath: expect.stringContaining('_EC_run_preprocess.m'),
      }),
    );
    const updatedTask = listRecentTasks(local.db).find((task) => task.id === taskId);
    const output = JSON.parse(updatedTask?.outputJson ?? '{}');
    const executionPackage = JSON.parse(fs.readFileSync(output.matlabPackagePath, 'utf8'));
    expect(executionPackage.taskPackage.baselineRawCntFiles).toEqual([
      expect.stringContaining('mxg2.cnt'),
    ]);
    expect(executionPackage.taskPackage.baselineRawCntFiles).not.toEqual([
      expect.stringContaining('mxg1.cnt'),
    ]);
    expect(getWorkbenchData(local.db, local.paths.dataRoot).tasks.manual).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: manualFileTaskId(taskId, 'EO'),
          action: '打开 EEGLAB 完成人工去除 ICA 伪迹（睁眼 EO）',
        }),
        expect.objectContaining({
          id: manualFileTaskId(taskId, 'EC'),
          action: '打开 EEGLAB 完成人工去除 ICA 伪迹（闭眼 EC）',
        }),
      ]),
    );
  });

  it('records MATLAB preprocessing execution failures without marking the task complete', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01' });
    indexBaselineCnt(local, patientId, 'sub01');
    const { matlabPath } = configureMatlabToolchain(local);
    createPreprocessBatch(local.db, preprocessInput({ patientIds: [patientId] }));
    const taskId = listRecentTasks(local.db).find((task) => task.type === 'preprocess')?.id ?? '';
    const executeMatlab = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'EEGLAB missing pop_loadcnt',
    });

    const result = await runPreprocessMatlabExecution(local.db, local.paths, taskId, executeMatlab);

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining('MATLAB 预处理执行失败'),
        exitCode: 1,
        stderr: 'EEGLAB missing pop_loadcnt',
      }),
    );
    expect(listRecentTasks(local.db).find((task) => task.id === taskId)).toEqual(
      expect.objectContaining({
        status: 'waiting_manual',
      }),
    );
    expect(getWorkbenchData(local.db, local.paths.dataRoot).logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          text: expect.stringContaining('MATLAB 预处理执行失败'),
        }),
      ]),
    );
  });
});
