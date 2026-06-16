import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLocalDatabase, type LocalDatabase } from '../../../src/electron/backend/database.js';
import { getMatlabSessionStatus, startMatlabSession } from '../../../src/electron/backend/matlabSession.js';
import { updateSettings } from '../../../src/electron/backend/repositories.js';

const roots: string[] = [];
const locals: LocalDatabase[] = [];

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-matlab-session-'));
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

  return { matlabPath, eeglabPath };
}

afterEach(() => {
  for (const local of locals.splice(0)) {
    local.close();
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('persistent MATLAB session bridge', () => {
  it('starts one visible MATLAB session with a polling worker instead of per-task launchers', async () => {
    const local = await openTempDatabase();
    const { matlabPath, eeglabPath } = configureMatlabToolchain(local);
    const spawnMatlabSession = vi.fn().mockResolvedValue({ pid: 42 });

    const result = await startMatlabSession(local.db, local.paths, spawnMatlabSession);

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        running: true,
        ready: false,
        state: 'starting',
        sessionRoot: expect.stringContaining(path.join('outputs', 'matlab-session')),
        workerScriptPath: expect.stringContaining('neuro_predict_matlab_session_worker.m'),
        heartbeatPath: expect.stringContaining('heartbeat.txt'),
      }),
    );
    expect(spawnMatlabSession).toHaveBeenCalledWith(
      matlabPath,
      expect.arrayContaining(['-nosplash', '-r', expect.stringContaining('neuro_predict_matlab_session_worker')]),
      expect.objectContaining({
        sessionRoot: result.sessionRoot,
        workerScriptPath: result.workerScriptPath,
        eeglabPath,
      }),
    );

    const worker = fs.readFileSync(result.workerScriptPath ?? '', 'utf8');
    expect(worker).toContain('neuro_predict_matlab_session_worker');
    expect(worker).toContain('while true');
    expect(worker).toContain('eval(char(string(request.command)))');
    expect(worker).toContain('heartbeatPath');

    expect(getMatlabSessionStatus(local.paths)).toEqual(
      expect.objectContaining({
        ok: true,
        running: true,
        ready: false,
        state: 'starting',
        sessionRoot: result.sessionRoot,
      }),
    );
  });

  it('clears stale queued commands when starting a new MATLAB session', async () => {
    const local = await openTempDatabase();
    configureMatlabToolchain(local);
    const spawnMatlabSession = vi.fn().mockResolvedValue({ pid: 42 });
    const sessionRoot = path.join(local.paths.outputsRoot, 'matlab-session');
    const staleRequest = path.join(sessionRoot, 'requests', 'old-request.json');
    const staleProcessing = path.join(sessionRoot, 'processing', 'old-request.json.running');
    writeFile(staleRequest, '{}');
    writeFile(staleProcessing, '{}');

    const result = await startMatlabSession(local.db, local.paths, spawnMatlabSession);

    expect(result.ok).toBe(true);
    expect(fs.existsSync(staleRequest)).toBe(false);
    expect(fs.existsSync(staleProcessing)).toBe(false);
    expect(fs.existsSync(path.join(sessionRoot, 'requests'))).toBe(true);
    expect(fs.existsSync(path.join(sessionRoot, 'processing'))).toBe(true);
  });
});
