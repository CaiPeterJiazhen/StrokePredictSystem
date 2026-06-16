import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLocalDatabase, type LocalDatabase } from '../../../src/electron/backend/database.js';
import {
  completeFeatureGenerationTask,
  createFeatureGenerationBatch,
  listFeatureArtifacts,
  listFeatureOverview,
  prepareFeatureGenerationExecution,
  runFeatureGenerationExecution,
} from '../../../src/electron/backend/featureArtifacts.js';
import { upsertDataAsset, upsertSourceRoot } from '../../../src/electron/backend/dataLibrary/repository.js';
import { addTask, createPatient, getWorkbenchData, listTaskLogs, listTasks } from '../../../src/electron/backend/repositories.js';

const roots: string[] = [];
const locals: LocalDatabase[] = [];

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-feature-artifacts-'));
  roots.push(root);
  return root;
}

async function openTempDatabase(): Promise<LocalDatabase> {
  const local = await openLocalDatabase(createTempRoot());
  locals.push(local);
  return local;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function seedPreprocessedEegInputs(
  local: LocalDatabase,
  patientId: string,
  stateSubjectCodes: Record<'EO' | 'EC', string> = { EO: 'sub011', EC: 'sub012' },
): void {
  const sourceRoot = upsertSourceRoot(local.db, {
    projectName: 'EEG_M1',
    rootPath: path.join(local.paths.dataRoot, 'source-library'),
    status: 'active',
  });

  for (const subjectCode of Object.values(stateSubjectCodes)) {
    const setPath = path.join(
      sourceRoot.rootPath,
      'Patient_tACS_M1_RestingStateEEG_afterProcess',
      '基线',
      subjectCode,
      `${subjectCode}.set`,
    );
    const fdtPath = path.join(
      sourceRoot.rootPath,
      'Patient_tACS_M1_RestingStateEEG_afterProcess',
      '基线',
      subjectCode,
      `${subjectCode}.fdt`,
    );

    writeFile(setPath, 'preprocessed set');
    writeFile(fdtPath, 'preprocessed fdt');

    for (const [assetType, filePath] of [
      ['processed_eeg_set', setPath],
      ['processed_eeg_fdt', fdtPath],
    ] as const) {
      upsertDataAsset(local.db, {
        sourceRootId: sourceRoot.id,
        patientId,
        subjectCode,
        sourceSubjectCode: subjectCode,
        subjectName: '',
        cohort: 'patient',
        stage: '基线',
        assetType,
        filePath,
        backupPath: null,
        fileSize: fs.statSync(filePath).size,
        fileHash: '',
        existsOnDisk: true,
        matchStatus: 'matched',
      });
    }
  }
}

function seedParentFolderStateInputs(local: LocalDatabase, patientId: string): void {
  const sourceRoot = upsertSourceRoot(local.db, {
    projectName: 'EEG_M1',
    rootPath: path.join(local.paths.dataRoot, 'source-library'),
    status: 'active',
  });

  for (const subjectCode of ['sub021', 'sub022']) {
    const setPath = path.join(sourceRoot.rootPath, 'Patient_tACS_M1_RestingStateEEG_afterProcess', '基线', subjectCode, 'anything.set');
    const fdtPath = path.join(sourceRoot.rootPath, 'Patient_tACS_M1_RestingStateEEG_afterProcess', '基线', subjectCode, 'anything.fdt');

    writeFile(setPath, 'preprocessed set');
    writeFile(fdtPath, 'preprocessed fdt');

    for (const [assetType, filePath] of [
      ['processed_eeg_set', setPath],
      ['processed_eeg_fdt', fdtPath],
    ] as const) {
      upsertDataAsset(local.db, {
        sourceRootId: sourceRoot.id,
        patientId,
        subjectCode,
        sourceSubjectCode: subjectCode,
        subjectName: '',
        cohort: 'patient',
        stage: '基线',
        assetType,
        filePath,
        backupPath: null,
        fileSize: fs.statSync(filePath).size,
        fileHash: '',
        existsOnDisk: true,
        matchStatus: 'matched',
      });
    }
  }
}

function seedAmbiguousParentFolderInputs(local: LocalDatabase, patientId: string): void {
  const sourceRoot = upsertSourceRoot(local.db, {
    projectName: 'EEG_M1',
    rootPath: path.join(local.paths.dataRoot, 'source-library'),
    status: 'active',
  });

  for (const subjectCode of ['session1', 'sub022']) {
    const setPath = path.join(sourceRoot.rootPath, 'Patient_tACS_M1_RestingStateEEG_afterProcess', '基线', subjectCode, 'anything.set');
    const fdtPath = path.join(sourceRoot.rootPath, 'Patient_tACS_M1_RestingStateEEG_afterProcess', '基线', subjectCode, 'anything.fdt');

    writeFile(setPath, 'preprocessed set');
    writeFile(fdtPath, 'preprocessed fdt');

    for (const [assetType, filePath] of [
      ['processed_eeg_set', setPath],
      ['processed_eeg_fdt', fdtPath],
    ] as const) {
      upsertDataAsset(local.db, {
        sourceRootId: sourceRoot.id,
        patientId,
        subjectCode,
        sourceSubjectCode: subjectCode,
        subjectName: '',
        cohort: 'patient',
        stage: '基线',
        assetType,
        filePath,
        backupPath: null,
        fileSize: fs.statSync(filePath).size,
        fileHash: '',
        existsOnDisk: true,
        matchStatus: 'matched',
      });
    }
  }
}

afterEach(() => {
  for (const local of locals.splice(0)) {
    local.close();
  }

  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('feature generation task completion', () => {
  it('skips patients that do not have preprocessed EEG inputs', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });

    const result = createFeatureGenerationBatch(local.db, local.paths, {
      patientIds: [patientId],
      featureKinds: ['PSD', 'FC'],
      states: ['EO', 'EC'],
      overwrite: false,
    });

    expect(result).toEqual({
      ok: false,
      message: '未创建特征生成任务，1 位患者缺少可用的预处理 EEG 输入。',
      batchId: expect.any(String),
      queuedTasks: 0,
      skippedPatients: [patientId],
    });
    expect(listTasks(local.db, { type: 'feature_generation' })).toEqual([]);
  });

  it('prepares an external feature generation package and command preview', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '右手' });
    const executablePath = path.join(local.paths.dataRoot, 'tools', 'python.exe');
    const scriptPath = path.join(local.paths.dataRoot, 'scripts', 'generate_features.py');
    writeFile(executablePath, 'python stub');
    writeFile(scriptPath, 'feature script stub');
    seedPreprocessedEegInputs(local, patientId);
    createFeatureGenerationBatch(local.db, local.paths, {
      patientIds: [patientId],
      featureKinds: ['PSD', 'FC'],
      states: ['EO', 'EC'],
      overwrite: false,
      params: {
        bands: ['delta', 'theta', 'alpha', 'beta', 'gamma'],
        executor: {
          executablePath,
          scriptPath,
          extraArgs: ['--backend', 'codex'],
        },
      },
    });
    const task = listTasks(local.db, { type: 'feature_generation' })[0];

    const result = prepareFeatureGenerationExecution(local.db, local.paths, task.id);

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.stringContaining('特征生成任务包已准备'),
        executablePath,
        packagePath: expect.stringContaining(`${task.id}-feature-generation.json`),
        command: expect.stringContaining('generate_features.py'),
      }),
    );
    expect(result.command).toContain(`"${executablePath}"`);
    expect(result.command).toContain(`"${scriptPath}"`);
    expect(result.command).toContain('--backend codex');

    const taskPackage = JSON.parse(fs.readFileSync(result.packagePath ?? '', 'utf8'));
    expect(taskPackage).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        type: 'feature_generation_task_package',
        taskId: task.id,
        patientId,
        subjectCode: 'sub01',
        contract: {
          requiredStates: ['EO', 'EC'],
          affectedSide: 'right',
          alignment: 'right_affected_c3',
          features: {
            PSD: { shape: [62, 90] },
            FC: { metric: 'wpli', shape: [1891, 6] },
          },
        },
        request: expect.objectContaining({
          featureKinds: ['PSD', 'FC'],
          states: ['EO', 'EC'],
          overwrite: false,
          params: expect.objectContaining({
            bands: ['delta', 'theta', 'alpha', 'beta', 'gamma'],
          }),
        }),
        outputs: expect.objectContaining({
          outputDirectory: expect.stringContaining(path.join('features', task.batchId ?? 'feature_generation', 'sub01')),
          manifestPath: expect.stringContaining('feature_manifest.json'),
        }),
      }),
    );
    expect(taskPackage.inputs).toEqual(
      expect.objectContaining({
        eegAssets: expect.any(Array),
        eegStatePairs: [
          expect.objectContaining({
            state: 'EO',
            setPath: expect.stringContaining('sub011.set'),
            fdtPath: expect.stringContaining('sub011.fdt'),
          }),
          expect.objectContaining({
            state: 'EC',
            setPath: expect.stringContaining('sub012.set'),
            fdtPath: expect.stringContaining('sub012.fdt'),
          }),
        ],
      }),
    );
    expect(getWorkbenchData(local.db, local.paths.dataRoot).logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining('特征生成任务包已准备') }),
      ]),
    );
  });

  it('prepares a strict feature package from completed preprocess outputs with final suffix names', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '右手' });
    const preprocessBatchId = 'preprocess-batch';
    const rawCntFiles = [
      path.join(local.paths.dataRoot, 'raw', 'sub011.cnt'),
      path.join(local.paths.dataRoot, 'raw', 'sub012.cnt'),
    ];
    addTask(local.db, {
      type: 'preprocess',
      patientId,
      batchId: preprocessBatchId,
      status: 'completed',
      inputJson: JSON.stringify({ baselineRawCntFiles: rawCntFiles }),
    });
    const outputRoot = path.join(local.paths.outputsRoot, 'preprocess', preprocessBatchId, 'processed', patientId);

    for (const subjectCode of ['sub011', 'sub012']) {
      writeFile(path.join(outputRoot, `${subjectCode}_preprocessed_final.set`), 'preprocessed set');
      writeFile(path.join(outputRoot, `${subjectCode}_preprocessed_final.fdt`), 'preprocessed fdt');
    }

    const batch = createFeatureGenerationBatch(local.db, local.paths, {
      patientIds: [patientId],
      featureKinds: ['PSD', 'FC'],
      states: ['EO', 'EC'],
      overwrite: false,
    });
    const task = listTasks(local.db, { type: 'feature_generation' })[0];
    const result = prepareFeatureGenerationExecution(local.db, local.paths, task.id);

    expect(batch).toEqual(expect.objectContaining({ ok: true, queuedTasks: 1 }));
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    const taskPackage = JSON.parse(fs.readFileSync(result.packagePath ?? '', 'utf8'));
    expect(taskPackage.inputs.eegStatePairs).toEqual([
      expect.objectContaining({
        state: 'EO',
        setPath: expect.stringContaining('sub011_preprocessed_final.set'),
        fdtPath: expect.stringContaining('sub011_preprocessed_final.fdt'),
      }),
      expect.objectContaining({
        state: 'EC',
        setPath: expect.stringContaining('sub012_preprocessed_final.set'),
        fdtPath: expect.stringContaining('sub012_preprocessed_final.fdt'),
      }),
    ]);
  });

  it('prepares a strict feature package when EEG state is encoded in parent folders', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub02', name: '夏云玲', affectedHand: '左手' });
    seedParentFolderStateInputs(local, patientId);

    const batch = createFeatureGenerationBatch(local.db, local.paths, {
      patientIds: [patientId],
      featureKinds: ['PSD', 'FC'],
      states: ['EO', 'EC'],
      overwrite: false,
    });
    const task = listTasks(local.db, { type: 'feature_generation' })[0];
    const result = prepareFeatureGenerationExecution(local.db, local.paths, task.id);

    expect(batch).toEqual(expect.objectContaining({ ok: true, queuedTasks: 1 }));
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    const taskPackage = JSON.parse(fs.readFileSync(result.packagePath ?? '', 'utf8'));
    expect(taskPackage.inputs.eegStatePairs).toEqual([
      expect.objectContaining({
        state: 'EO',
        setPath: expect.stringContaining(path.join('sub021', 'anything.set')),
        fdtPath: expect.stringContaining(path.join('sub021', 'anything.fdt')),
      }),
      expect.objectContaining({
        state: 'EC',
        setPath: expect.stringContaining(path.join('sub022', 'anything.set')),
        fdtPath: expect.stringContaining(path.join('sub022', 'anything.fdt')),
      }),
    ]);
  });

  it('does not infer EEG state from ambiguous parent folders ending in 1 or 2', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub03', name: '张三', affectedHand: '左手' });
    seedAmbiguousParentFolderInputs(local, patientId);

    const batch = createFeatureGenerationBatch(local.db, local.paths, {
      patientIds: [patientId],
      featureKinds: ['PSD', 'FC'],
      states: ['EO', 'EC'],
      overwrite: false,
    });

    expect(batch).toEqual({
      ok: false,
      message: '未创建特征生成任务，1 位患者缺少可用的预处理 EEG 输入。',
      batchId: expect.any(String),
      queuedTasks: 0,
      skippedPatients: [patientId],
    });
    expect(listTasks(local.db, { type: 'feature_generation' })).toEqual([]);
  });

  it('skips patients with EO and EC inputs when affected side is missing', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵' });
    seedPreprocessedEegInputs(local, patientId);

    const result = createFeatureGenerationBatch(local.db, local.paths, {
      patientIds: [patientId],
      featureKinds: ['PSD', 'FC'],
      states: ['EO', 'EC'],
      overwrite: false,
    });

    expect(result).toEqual({
      ok: false,
      message: '未创建特征生成任务，1 位患者缺少可用的预处理 EEG 输入。',
      batchId: expect.any(String),
      queuedTasks: 0,
      skippedPatients: [patientId],
    });
    expect(listTasks(local.db, { type: 'feature_generation' })).toEqual([]);
  });

  it('runs the external feature generator, imports its manifest, and completes the queued task', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '左手' });
    const executablePath = path.join(local.paths.dataRoot, 'tools', 'python.exe');
    const scriptPath = path.join(local.paths.dataRoot, 'scripts', 'generate_features.py');
    writeFile(executablePath, 'python stub');
    writeFile(scriptPath, 'feature script stub');
    seedPreprocessedEegInputs(local, patientId);
    createFeatureGenerationBatch(local.db, local.paths, {
      patientIds: [patientId],
      featureKinds: ['PSD', 'FC'],
      states: ['EO', 'EC'],
      overwrite: false,
      params: {
        executor: { executablePath, scriptPath },
      },
    });
    const task = listTasks(local.db, { type: 'feature_generation' })[0];
    const executeFeatureGenerator = vi.fn().mockImplementation(async (_executable: string, args: string[]) => {
      const packagePath = args[args.length - 1];
      const taskPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      const psdPath = path.join(taskPackage.outputs.outputDirectory, 'sub01_psd_eo.npz');
      const fcPath = path.join(taskPackage.outputs.outputDirectory, 'sub01_fc_ec.npz');
      writeFile(psdPath, 'psd features');
      writeFile(fcPath, 'fc features');
      writeFile(
        taskPackage.outputs.manifestPath,
        JSON.stringify({
          schemaVersion: 1,
          artifacts: [
            {
              kind: 'PSD',
              state: 'EO',
              filePath: psdPath,
              featureCount: 5580,
              params: { shape: [62, 90], alignment: 'right_affected_c3' },
            },
            {
              kind: 'FC',
              state: 'EC',
              filePath: fcPath,
              featureCount: 1891,
              params: { shape: [1891, 6], metric: 'wpli', alignment: 'right_affected_c3' },
            },
          ],
        }),
      );
      return { exitCode: 0, stdout: 'features generated', stderr: '' };
    });

    const result = await runFeatureGenerationExecution(local.db, local.paths, task.id, executeFeatureGenerator);

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: '特征生成任务已完成，已索引 2 个特征文件。',
        exitCode: 0,
        stdout: 'features generated',
        indexedArtifacts: 2,
        artifactIds: [expect.any(String), expect.any(String)],
      }),
    );
    expect(executeFeatureGenerator).toHaveBeenCalledWith(
      executablePath,
      expect.arrayContaining([scriptPath, expect.stringContaining(`${task.id}-feature-generation.json`)]),
    );
    expect(listTasks(local.db, { type: 'feature_generation' })[0]).toEqual(
      expect.objectContaining({ id: task.id, status: 'completed' }),
    );
    expect(listFeatureArtifacts(local.db, { patientId })).toEqual([
      expect.objectContaining({ kind: 'PSD', state: 'EO', featureCount: 5580 }),
      expect.objectContaining({ kind: 'FC', state: 'EC', featureCount: 1891 }),
    ]);
  });

  it('records external feature generation failures without importing artifacts', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '左手' });
    const executablePath = path.join(local.paths.dataRoot, 'tools', 'python.exe');
    const scriptPath = path.join(local.paths.dataRoot, 'scripts', 'generate_features.py');
    writeFile(executablePath, 'python stub');
    writeFile(scriptPath, 'feature script stub');
    seedPreprocessedEegInputs(local, patientId);
    createFeatureGenerationBatch(local.db, local.paths, {
      patientIds: [patientId],
      featureKinds: ['PSD'],
      states: ['EO'],
      overwrite: false,
      params: {
        executor: { executablePath, scriptPath },
      },
    });
    const task = listTasks(local.db, { type: 'feature_generation' })[0];
    const executeFeatureGenerator = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'missing scipy',
    });

    const result = await runFeatureGenerationExecution(local.db, local.paths, task.id, executeFeatureGenerator);

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining('特征生成执行失败'),
        exitCode: 1,
        stderr: 'missing scipy',
      }),
    );
    expect(listTasks(local.db, { type: 'feature_generation' })[0]).toEqual(
      expect.objectContaining({ id: task.id, status: 'failed', errorMessage: expect.stringContaining('missing scipy') }),
    );
    expect(listFeatureArtifacts(local.db, { patientId })).toEqual([]);
    expect(listTaskLogs(local.db, { taskId: task.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'error', message: expect.stringContaining('特征生成执行失败') }),
      ]),
    );
  });

  it('imports a generated feature manifest, indexes artifacts, and completes the queued task', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '左手' });
    seedPreprocessedEegInputs(local, patientId);
    createFeatureGenerationBatch(local.db, local.paths, {
      patientIds: [patientId],
      featureKinds: ['PSD', 'FC'],
      states: ['EO', 'EC'],
      overwrite: false,
      params: { bands: ['delta', 'theta', 'alpha', 'beta', 'gamma'] },
    });
    const task = listTasks(local.db, { type: 'feature_generation' })[0];
    const psdPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_psd_eo.npz');
    const fcPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_fc_ec.npz');
    const manifestPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'feature_manifest.json');
    writeFile(psdPath, 'psd features');
    writeFile(fcPath, 'fc features');
    writeFile(
      manifestPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          patientId,
          artifacts: [
            {
              kind: 'PSD',
              state: 'EO',
              filePath: psdPath,
              featureCount: 5580,
              params: { shape: [62, 90], alignment: 'right_affected_c3' },
              preview: { matrixShape: [62, 90] },
            },
            {
              kind: 'FC',
              state: 'EC',
              filePath: fcPath,
              featureCount: 1891,
              params: { shape: [1891, 6], metric: 'wpli', alignment: 'right_affected_c3' },
              preview: { matrixShape: [1891, 6] },
            },
          ],
        },
        null,
        2,
      ),
    );

    const result = completeFeatureGenerationTask(local.db, task.id, manifestPath);

    expect(result).toEqual({
      ok: true,
      message: '特征生成任务已完成，已索引 2 个特征文件。',
      indexedArtifacts: 2,
      artifactIds: [expect.any(String), expect.any(String)],
    });
    const completedTask = listTasks(local.db, { type: 'feature_generation' })[0];
    expect(completedTask).toEqual(expect.objectContaining({ id: task.id, status: 'completed' }));
    expect(JSON.parse(completedTask.outputJson)).toEqual(
      expect.objectContaining({
        manifestPath,
        indexedArtifacts: 2,
        artifactIds: [expect.any(String), expect.any(String)],
      }),
    );
    expect(listFeatureArtifacts(local.db, { patientId })).toEqual([
      expect.objectContaining({ kind: 'PSD', state: 'EO', filePath: psdPath, featureCount: 5580 }),
      expect.objectContaining({ kind: 'FC', state: 'EC', filePath: fcPath, featureCount: 1891 }),
    ]);
    expect(listFeatureOverview(local.db)).toEqual([
      expect.objectContaining({ patientId, featureStatus: '已完成', psdCount: 1, fcCount: 1, hasEegFeatures: true }),
    ]);
    expect(getWorkbenchData(local.db, local.paths.dataRoot).patients[0]).toEqual(
      expect.objectContaining({ patientId, featStatus: '已完成' }),
    );
    expect(listTaskLogs(local.db, { taskId: task.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'info', message: expect.stringContaining('特征生成任务已完成') }),
      ]),
    );
  });

  it('fails the feature task when PSD manifest params violate the model contract', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '左手' });
    seedPreprocessedEegInputs(local, patientId);
    createFeatureGenerationBatch(local.db, local.paths, {
      patientIds: [patientId],
      featureKinds: ['PSD'],
      states: ['EO', 'EC'],
      overwrite: false,
    });
    const task = listTasks(local.db, { type: 'feature_generation' })[0];
    const psdPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_psd_eo.npz');
    const manifestPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'feature_manifest.json');
    writeFile(psdPath, 'psd features');
    writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        artifacts: [
          {
            kind: 'PSD',
            state: 'EO',
            filePath: psdPath,
            featureCount: 5580,
            params: { shape: [62, 89], alignment: 'right_affected_c3' },
          },
        ],
      }),
    );

    const result = completeFeatureGenerationTask(local.db, task.id, manifestPath);

    expect(result).toEqual({
      ok: false,
      message: 'PSD 特征形状必须是 [62,90]。',
      indexedArtifacts: 0,
      artifactIds: [],
    });
    expect(listTasks(local.db, { type: 'feature_generation' })[0]).toEqual(
      expect.objectContaining({ id: task.id, status: 'failed', errorMessage: 'PSD 特征形状必须是 [62,90]。' }),
    );
    expect(listFeatureArtifacts(local.db, { patientId })).toEqual([]);
    expect(listTaskLogs(local.db, { taskId: task.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'error', message: 'PSD 特征形状必须是 [62,90]。' }),
      ]),
    );
    expect(listFeatureOverview(local.db)).toEqual([
      expect.objectContaining({ patientId, featureStatus: '失败' }),
    ]);
  });

  it('fails the feature task when FC manifest params declare a non-WPLI metric', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '左手' });
    seedPreprocessedEegInputs(local, patientId);
    createFeatureGenerationBatch(local.db, local.paths, {
      patientIds: [patientId],
      featureKinds: ['FC'],
      states: ['EO', 'EC'],
      overwrite: false,
    });
    const task = listTasks(local.db, { type: 'feature_generation' })[0];
    const fcPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'sub01_fc_ec.npz');
    const manifestPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'feature_manifest.json');
    writeFile(fcPath, 'fc features');
    writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        artifacts: [
          {
            kind: 'FC',
            state: 'EC',
            filePath: fcPath,
            featureCount: 1891,
            params: { shape: [1891, 6], metric: 'plv', alignment: 'right_affected_c3' },
          },
        ],
      }),
    );

    const result = completeFeatureGenerationTask(local.db, task.id, manifestPath);

    expect(result).toEqual({
      ok: false,
      message: 'FC 特征必须声明 metric=wpli。',
      indexedArtifacts: 0,
      artifactIds: [],
    });
    expect(listTasks(local.db, { type: 'feature_generation' })[0]).toEqual(
      expect.objectContaining({ id: task.id, status: 'failed', errorMessage: 'FC 特征必须声明 metric=wpli。' }),
    );
    expect(listFeatureArtifacts(local.db, { patientId })).toEqual([]);
    expect(listTaskLogs(local.db, { taskId: task.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'error', message: 'FC 特征必须声明 metric=wpli。' }),
      ]),
    );
  });

  it('fails the feature task when the manifest references missing output files', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '左手' });
    seedPreprocessedEegInputs(local, patientId);
    createFeatureGenerationBatch(local.db, local.paths, {
      patientIds: [patientId],
      featureKinds: ['PSD'],
      states: ['EO'],
      overwrite: false,
    });
    const task = listTasks(local.db, { type: 'feature_generation' })[0];
    const missingFeaturePath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'missing_psd.npz');
    const manifestPath = path.join(local.paths.outputsRoot, 'features', 'sub01', 'feature_manifest.json');
    writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        artifacts: [
          {
            kind: 'PSD',
            state: 'EO',
            filePath: missingFeaturePath,
            featureCount: 5580,
            params: { shape: [62, 90], alignment: 'right_affected_c3' },
          },
        ],
      }),
    );

    const result = completeFeatureGenerationTask(local.db, task.id, manifestPath);

    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining('特征结果文件不存在'),
      indexedArtifacts: 0,
      artifactIds: [],
    });
    expect(listTasks(local.db, { type: 'feature_generation' })[0]).toEqual(
      expect.objectContaining({ id: task.id, status: 'failed', errorMessage: expect.stringContaining('特征结果文件不存在') }),
    );
    expect(listFeatureArtifacts(local.db, { patientId })).toEqual([]);
    expect(listTaskLogs(local.db, { taskId: task.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'error', message: expect.stringContaining('特征结果文件不存在') }),
      ]),
    );
  });
});
