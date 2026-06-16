import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeatureGenerationBatch, listFeatureArtifacts } from '../../../src/electron/backend/featureArtifacts.js';
import { openLocalDatabase, type LocalDatabase } from '../../../src/electron/backend/database.js';
import { upsertDataAsset, upsertSourceRoot } from '../../../src/electron/backend/dataLibrary/repository.js';
import { createPatient, listTasks } from '../../../src/electron/backend/repositories.js';
import { startNextQueuedTask } from '../../../src/electron/backend/taskQueue.js';

const roots: string[] = [];
const locals: LocalDatabase[] = [];

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-task-queue-'));
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

function seedPreprocessedEegInput(local: LocalDatabase, patientId: string, subjectCode: string): void {
  const sourceRoot = upsertSourceRoot(local.db, {
    projectName: 'EEG_M1',
    rootPath: path.join(local.paths.dataRoot, 'source-library'),
    status: 'active',
  });

  for (const stateSubjectCode of [`${subjectCode}1`, `${subjectCode}2`]) {
    const setPath = path.join(
      sourceRoot.rootPath,
      'Patient_tACS_M1_RestingStateEEG_afterProcess',
      '基线',
      stateSubjectCode,
      `${stateSubjectCode}.set`,
    );
    const fdtPath = path.join(
      sourceRoot.rootPath,
      'Patient_tACS_M1_RestingStateEEG_afterProcess',
      '基线',
      stateSubjectCode,
      `${stateSubjectCode}.fdt`,
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
        subjectCode: stateSubjectCode,
        sourceSubjectCode: stateSubjectCode,
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
  for (const local of locals.splice(0)) local.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('queued task dispatcher', () => {
  it('reports when there is no queued task to run', async () => {
    const local = await openTempDatabase();

    await expect(startNextQueuedTask(local.db, local.paths)).resolves.toEqual({
      ok: false,
      message: '没有待执行任务。',
      taskId: null,
      taskType: null,
    });
  });

  it('runs the next queued feature generation task through its executor', async () => {
    const local = await openTempDatabase();
    const patientId = createPatient(local.db, { subjectCode: 'sub01', name: '穆祥贵', affectedHand: '左手' });
    const executablePath = path.join(local.paths.dataRoot, 'tools', 'python.exe');
    const scriptPath = path.join(local.paths.dataRoot, 'scripts', 'generate_features.py');
    writeFile(executablePath, 'python stub');
    writeFile(scriptPath, 'feature script stub');
    seedPreprocessedEegInput(local, patientId, 'sub01');
    createFeatureGenerationBatch(local.db, local.paths, {
      patientIds: [patientId],
      featureKinds: ['PSD', 'FC'],
      states: ['EO', 'EC'],
      overwrite: false,
      params: {
        executor: { executablePath, scriptPath },
      },
    });
    const queuedTask = listTasks(local.db, { status: 'queued' })[0];
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
              params: { alignment: 'right_affected_c3', shape: [62, 90] },
            },
            {
              kind: 'FC',
              state: 'EC',
              filePath: fcPath,
              featureCount: 11346,
              params: { alignment: 'right_affected_c3', metric: 'wpli', shape: [1891, 6] },
            },
          ],
        }),
      );
      return { exitCode: 0, stdout: 'features generated', stderr: '' };
    });

    const result = await startNextQueuedTask(local.db, local.paths, { executeFeatureGenerator });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        taskId: queuedTask.id,
        taskType: 'feature_generation',
        message: '特征生成任务已完成，已索引 2 个特征文件。',
      }),
    );
    expect(executeFeatureGenerator).toHaveBeenCalledOnce();
    expect(listTasks(local.db, { status: 'queued' })).toEqual([]);
    expect(listTasks(local.db, { status: 'completed' })).toEqual([
      expect.objectContaining({ id: queuedTask.id, type: 'feature_generation' }),
    ]);
    expect(listFeatureArtifacts(local.db, { patientId })).toHaveLength(2);
  });
});
