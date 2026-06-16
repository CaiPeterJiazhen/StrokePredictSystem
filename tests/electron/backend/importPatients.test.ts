import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase, type LocalDatabase } from '../../../src/electron/backend/database.js';
import { importPatientsFromCsv } from '../../../src/electron/backend/importPatients.js';
import {
  getWorkbenchData,
  listEegFilesForPatient,
  listPatientsForMatching,
  listRecentTasks,
} from '../../../src/electron/backend/repositories.js';
import { scanEegFolderForPatients } from '../../../src/electron/backend/scanEegFiles.js';

const roots: string[] = [];
const locals: LocalDatabase[] = [];

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-import-'));
  roots.push(root);
  return root;
}

async function openTempDatabase(): Promise<LocalDatabase> {
  const local = await openLocalDatabase(createTempRoot());
  locals.push(local);
  return local;
}

afterEach(() => {
  for (const local of locals.splice(0)) {
    local.close();
  }

  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('patient CSV import and EEG folder scan', () => {
  it('imports patients, registers matched EEG files, and exposes availability in workbench data', async () => {
    const local = await openTempDatabase();
    const csvPath = path.join(local.paths.dataRoot, 'patients.csv');
    const eegFolder = path.join(local.paths.dataRoot, 'eeg');
    const nestedEegFolder = path.join(eegFolder, 'nested');
    fs.mkdirSync(eegFolder, { recursive: true });
    fs.mkdirSync(nestedEegFolder, { recursive: true });
    fs.writeFileSync(
      csvPath,
      [
        'subject_code,name,age,sex,diagnosis,affected_hand,notes',
        'sub01,Patient One,42,男,Stroke,左手,first',
        'sub02,Patient Two,51,女,Stroke,右手,second',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(eegFolder, 'sub01_EO.cnt'), 'placeholder');
    fs.writeFileSync(path.join(eegFolder, 'sub01_EC.cnt'), 'placeholder');
    fs.writeFileSync(path.join(nestedEegFolder, 'sub02_rest.cnt'), 'placeholder');
    fs.writeFileSync(path.join(eegFolder, 'unknown_EO.cnt'), 'placeholder');

    const imported = importPatientsFromCsv(local.db, csvPath);
    const scanned = scanEegFolderForPatients(local.db, eegFolder);
    const workbench = getWorkbenchData(local.db, local.paths.dataRoot);
    const sub02 = listPatientsForMatching(local.db).find((patient) => patient.subjectCode === 'sub02');
    const sub02Files = sub02 ? listEegFilesForPatient(local.db, sub02.id) : [];
    const scanTask = listRecentTasks(local.db).find((task) => task.type === 'scan_eeg_files');

    expect(imported.created).toBe(2);
    expect(scanned.scannedFiles).toBe(4);
    expect(scanned.registeredFiles).toBe(3);
    expect(scanned.unmatchedFiles).toHaveLength(1);
    expect(sub02Files).toEqual([
      expect.objectContaining({
        condition: 'UNKNOWN',
        filePath: path.join(nestedEegFolder, 'sub02_rest.cnt'),
      }),
    ]);
    expect(scanTask).toEqual(
      expect.objectContaining({
        type: 'scan_eeg_files',
        status: 'completed',
        outputJson: JSON.stringify(scanned),
        errorMessage: '',
      }),
    );
    expect(scanTask?.finishedAt).toEqual(expect.any(String));
    expect(workbench.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'info',
          text: expect.stringContaining('EEG scan completed: scanned 4, registered 3, unmatched 1'),
        }),
      ]),
    );
    expect(workbench.patients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'sub01',
          eo: true,
          ec: true,
        }),
      ]),
    );
  });

  it('skips rows with invalid age, sex, or affected hand and reports readable errors', async () => {
    const local = await openTempDatabase();
    const csvPath = path.join(local.paths.dataRoot, 'invalid-patients.csv');
    fs.writeFileSync(
      csvPath,
      [
        'subject_code,name,age,sex,diagnosis,affected_hand,notes',
        'valid01,Valid Patient,42,男,Stroke,左手,valid',
        'badage,Invalid Age,abc,男,Stroke,左手,bad age',
        'badsex,Invalid Sex,31,其他,Stroke,右手,bad sex',
        'badhand,Invalid Hand,31,女,Stroke,脚,bad hand',
      ].join('\n'),
    );

    const imported = importPatientsFromCsv(local.db, csvPath);
    const workbench = getWorkbenchData(local.db, local.paths.dataRoot);

    expect(imported).toEqual(
      expect.objectContaining({
        created: 1,
        updated: 0,
        skipped: 3,
      }),
    );
    expect(imported.errors).toEqual([
      expect.stringMatching(/Row 3.*age/i),
      expect.stringMatching(/Row 4.*sex/i),
      expect.stringMatching(/Row 5.*affectedHand/i),
    ]);
    expect(workbench.patients.map((patient) => patient.id)).toEqual(['valid01']);
  });

  it('skips malformed CSV rows with extra fields even when patient fields are valid', async () => {
    const local = await openTempDatabase();
    const csvPath = path.join(local.paths.dataRoot, 'malformed-patients.csv');
    fs.writeFileSync(
      csvPath,
      [
        'subject_code,name,age,sex,diagnosis,affected_hand,notes',
        'valid01,Valid Patient,42,男,Stroke,左手,valid',
        'extra01,Extra Field Patient,43,女,Stroke,右手,valid,unexpected',
      ].join('\n'),
    );

    const imported = importPatientsFromCsv(local.db, csvPath);
    const workbench = getWorkbenchData(local.db, local.paths.dataRoot);

    expect(imported).toEqual(
      expect.objectContaining({
        created: 1,
        updated: 0,
        skipped: 1,
      }),
    );
    expect(imported.errors).toEqual(expect.arrayContaining([expect.stringMatching(/Row 3.*malformed/i)]));
    expect(workbench.patients.map((patient) => patient.id)).toEqual(['valid01']);
  });

  it('counts a repeated subject code as an update on a later import', async () => {
    const local = await openTempDatabase();
    const csvPath = path.join(local.paths.dataRoot, 'patient.csv');
    fs.writeFileSync(
      csvPath,
      ['subjectCode,name,age,sex,diagnosis,affectedHand,notes', 'sub01,Patient One,42,男,Stroke,左手,first'].join(
        '\n',
      ),
    );

    const firstImport = importPatientsFromCsv(local.db, csvPath);
    fs.writeFileSync(
      csvPath,
      ['subjectCode,name,age,sex,diagnosis,affectedHand,notes', 'sub01,Patient One Updated,43,女,Stroke,右手,second'].join(
        '\n',
      ),
    );
    const secondImport = importPatientsFromCsv(local.db, csvPath);
    const workbench = getWorkbenchData(local.db, local.paths.dataRoot);

    expect(firstImport).toEqual(expect.objectContaining({ created: 1, updated: 0, skipped: 0 }));
    expect(secondImport).toEqual(expect.objectContaining({ created: 0, updated: 1, skipped: 0 }));
    expect(workbench.patients).toEqual([
      expect.objectContaining({
        id: 'sub01',
        hand: '右手',
      }),
    ]);
  });
});
