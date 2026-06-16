import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Database } from 'sql.js';
import type { ApiResult, BackendSettings } from '../../domain/backendTypes.js';
import type { AppPaths } from './appPaths.js';
import { getSettings } from './repositories.js';

export type MatlabSessionState = 'not_started' | 'starting' | 'ready' | 'stale';

export interface MatlabSessionStatusResult extends ApiResult {
  running: boolean;
  ready: boolean;
  state: MatlabSessionState;
  sessionRoot?: string;
  workerScriptPath?: string;
  configPath?: string;
  requestDir?: string;
  heartbeatPath?: string;
  startupErrorPath?: string;
  command?: string;
  pid?: number | null;
}

export interface MatlabSessionLaunchContext {
  sessionRoot: string;
  workerScriptPath: string;
  configPath: string;
  requestDir: string;
  heartbeatPath: string;
  startupErrorPath: string;
  eeglabPath: string;
}

export interface MatlabSessionSpawnResult {
  pid?: number | null;
}

export type MatlabSessionSpawner = (
  matlabExecutable: string,
  args: string[],
  context: MatlabSessionLaunchContext,
) => Promise<MatlabSessionSpawnResult> | MatlabSessionSpawnResult;

export interface MatlabSessionCommandInput {
  command: string;
  donePath: string;
  errorPath: string;
  logPath: string;
  timeoutMs?: number;
  startupTimeoutMs?: number;
}

export interface MatlabSessionCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface MatlabSessionFileSet {
  sessionRoot: string;
  requestDir: string;
  processingDir: string;
  workerScriptPath: string;
  configPath: string;
  statePath: string;
  heartbeatPath: string;
  startupErrorPath: string;
}

const SESSION_READY_HEARTBEAT_MS = 45_000;
const SESSION_STARTING_GRACE_MS = 180_000;
const SESSION_COMMAND_TIMEOUT_MS = 14_400_000;
const SESSION_POLL_INTERVAL_MS = 500;

function matlabStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function buildMatlabRunExpression(scriptPath: string): string {
  return `run('${matlabStringLiteral(scriptPath)}')`;
}

function matlabSessionFiles(paths: AppPaths): MatlabSessionFileSet {
  const sessionRoot = path.join(paths.outputsRoot, 'matlab-session');
  return {
    sessionRoot,
    requestDir: path.join(sessionRoot, 'requests'),
    processingDir: path.join(sessionRoot, 'processing'),
    workerScriptPath: path.join(sessionRoot, 'neuro_predict_matlab_session_start.m'),
    configPath: path.join(sessionRoot, 'session-config.json'),
    statePath: path.join(sessionRoot, 'session-state.json'),
    heartbeatPath: path.join(sessionRoot, 'heartbeat.txt'),
    startupErrorPath: path.join(sessionRoot, 'startup-error.txt'),
  };
}

function ensureSessionDirectories(files: MatlabSessionFileSet): void {
  fs.mkdirSync(files.requestDir, { recursive: true });
  fs.mkdirSync(files.processingDir, { recursive: true });
}

function clearSessionQueue(files: MatlabSessionFileSet): void {
  fs.rmSync(files.requestDir, { recursive: true, force: true });
  fs.rmSync(files.processingDir, { recursive: true, force: true });
  ensureSessionDirectories(files);
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, payload: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function fileAgeMs(filePath: string): number | null {
  if (!fs.existsSync(filePath)) return null;
  return Date.now() - fs.statSync(filePath).mtimeMs;
}

function readShortText(filePath: string, maxLength = 600): string {
  if (!fs.existsSync(filePath)) return '';

  const text = fs.readFileSync(filePath, 'utf8').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMatlabSessionReady(paths: AppPaths, timeoutMs: number): Promise<MatlabSessionStatusResult> {
  const startedAt = Date.now();
  let status = getMatlabSessionStatus(paths);

  while (status.state === 'starting' && !status.ready && Date.now() - startedAt <= timeoutMs) {
    await wait(Math.min(SESSION_POLL_INTERVAL_MS, 250));
    status = getMatlabSessionStatus(paths);
  }

  return status;
}

function safeRequestToken(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultSpawnMatlabSession(
  matlabExecutable: string,
  args: string[],
): MatlabSessionSpawnResult {
  const child = spawn(matlabExecutable, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return { pid: child.pid ?? null };
}

function matlabSessionWorkerContents(configPath: string): string {
  const files = {
    configPath,
    startupErrorPath: path.join(path.dirname(configPath), 'startup-error.txt'),
  };

  return [
    '% Auto-generated by NeuroPredict. Keep this MATLAB window open while using preprocessing.',
    `NeuroPredictSessionConfigPath = '${matlabStringLiteral(files.configPath)}';`,
    `NeuroPredictSessionStartupErrorPath = '${matlabStringLiteral(files.startupErrorPath)}';`,
    'try',
    "    if exist(NeuroPredictSessionStartupErrorPath, 'file') == 2",
    '        delete(NeuroPredictSessionStartupErrorPath);',
    '    end',
    '    neuro_predict_matlab_session_loop(NeuroPredictSessionConfigPath);',
    'catch ME',
    '    try',
    "        reportText = getReport(ME, 'extended', 'hyperlinks', 'off');",
    '        disp(reportText);',
    '        neuro_predict_session_write_text(NeuroPredictSessionStartupErrorPath, reportText);',
    '    catch',
    '    end',
    '    rethrow(ME);',
    'end',
    '',
    'function neuro_predict_matlab_session_loop(configPath)',
    "configText = fileread(configPath);",
    'config = jsondecode(configText);',
    'requestDir = char(string(config.requestDir));',
    'processingDir = char(string(config.processingDir));',
    'heartbeatPath = char(string(config.heartbeatPath));',
    'eeglabPath = char(string(config.eeglabPath));',
    "if ~isempty(eeglabPath) && exist(eeglabPath, 'dir') == 7",
    '    addpath(eeglabPath);',
    'end',
    "fprintf('NeuroPredict MATLAB session worker started.\\n');",
    'while true',
    '    neuro_predict_session_write_text(heartbeatPath, datestr(now, 31));',
    "    requestFiles = dir(fullfile(requestDir, '*.json'));",
    '    if isempty(requestFiles)',
    '        pause(1);',
    '        continue;',
    '    end',
    '    [~, order] = sort({requestFiles.name});',
    '    requestFiles = requestFiles(order);',
    "    requestPath = fullfile(requestDir, requestFiles(1).name);",
    "    processingPath = fullfile(processingDir, [requestFiles(1).name '.running']);",
    '    try',
    '        movefile(requestPath, processingPath);',
    '    catch',
    '        pause(0.2);',
    '        continue;',
    '    end',
    '    request = jsondecode(fileread(processingPath));',
    '    try',
    "        if isfield(request, 'logPath')",
    '            diary(char(string(request.logPath)));',
    '            diary on;',
    '        end',
    "        fprintf('NeuroPredict session command started: %s\\n', char(string(request.id)));",
    '        eval(char(string(request.command)));',
    "        fprintf('NeuroPredict session command finished: %s\\n', char(string(request.id)));",
    '        try, diary off; catch, end',
    "        neuro_predict_session_write_text(char(string(request.donePath)), 'done=1');",
    '    catch ME',
    '        try, diary off; catch, end',
    "        reportText = getReport(ME, 'extended', 'hyperlinks', 'off');",
    '        disp(reportText);',
    '        neuro_predict_session_write_text(char(string(request.errorPath)), reportText);',
    '    end',
    "    if exist(processingPath, 'file') == 2",
    '        delete(processingPath);',
    '    end',
    'end',
    'end',
    '',
    'function neuro_predict_session_write_text(filePath, textValue)',
    '[folderPath, ~, ~] = fileparts(filePath);',
    "if exist(folderPath, 'dir') ~= 7",
    '    mkdir(folderPath);',
    'end',
    "fid = fopen(filePath, 'w');",
    'if fid >= 0',
    "    fprintf(fid, '%s\\n', char(string(textValue)));",
    '    fclose(fid);',
    'end',
    'end',
    '',
  ].join('\n');
}

function validateSessionSettings(settings: BackendSettings): ApiResult | null {
  const matlabExecutable = settings.matlabExecutable.trim();
  const eeglabPath = settings.eeglabPath.trim();

  if (!matlabExecutable) {
    return { ok: false, message: '请先在环境设置中配置 MATLAB 可执行文件。' };
  }

  if (!fs.existsSync(matlabExecutable)) {
    return { ok: false, message: 'MATLAB 可执行文件路径不存在，请检查环境设置。' };
  }

  if (!eeglabPath) {
    return { ok: false, message: '请先在环境设置中配置 EEGLAB 路径。' };
  }

  if (!fs.existsSync(eeglabPath)) {
    return { ok: false, message: 'EEGLAB 路径不存在，请检查环境设置。' };
  }

  return null;
}

export function getMatlabSessionStatus(paths: AppPaths): MatlabSessionStatusResult {
  const files = matlabSessionFiles(paths);
  const state = readJsonFile(files.statePath);

  if (!state) {
    return {
      ok: true,
      message: 'MATLAB 会话未启动',
      running: false,
      ready: false,
      state: 'not_started',
      sessionRoot: files.sessionRoot,
      workerScriptPath: files.workerScriptPath,
      configPath: files.configPath,
      requestDir: files.requestDir,
      heartbeatPath: files.heartbeatPath,
      startupErrorPath: files.startupErrorPath,
    };
  }

  const heartbeatAge = fileAgeMs(files.heartbeatPath);
  const startupError = readShortText(files.startupErrorPath);
  const launchedAt = typeof state.launchedAt === 'string' ? Date.parse(state.launchedAt) : NaN;
  const startedAge = Number.isFinite(launchedAt) ? Date.now() - launchedAt : Number.POSITIVE_INFINITY;
  const ready = heartbeatAge !== null && heartbeatAge <= SESSION_READY_HEARTBEAT_MS;
  const starting = !ready && !startupError && startedAge <= SESSION_STARTING_GRACE_MS;
  const stateName: MatlabSessionState = ready ? 'ready' : starting ? 'starting' : 'stale';

  return {
    ok: !startupError,
    message: startupError
      ? `MATLAB 会话启动失败：${startupError}`
      : ready
      ? 'MATLAB 会话已就绪'
      : starting
        ? 'MATLAB 会话正在启动'
        : 'MATLAB 会话无响应，请重新点击“打开 MATLAB”',
    running: ready || starting,
    ready,
    state: stateName,
    sessionRoot: files.sessionRoot,
    workerScriptPath: files.workerScriptPath,
    configPath: files.configPath,
    requestDir: files.requestDir,
    heartbeatPath: files.heartbeatPath,
    startupErrorPath: files.startupErrorPath,
    command: typeof state.command === 'string' ? state.command : undefined,
    pid: typeof state.pid === 'number' ? state.pid : null,
  };
}

export async function startMatlabSession(
  db: Database,
  paths: AppPaths,
  spawnMatlabSession: MatlabSessionSpawner = defaultSpawnMatlabSession,
): Promise<MatlabSessionStatusResult> {
  const settings = getSettings(db);
  const validation = validateSessionSettings(settings);
  if (validation) {
    return {
      ...validation,
      running: false,
      ready: false,
      state: 'not_started',
    };
  }

  const files = matlabSessionFiles(paths);
  ensureSessionDirectories(files);
  clearSessionQueue(files);
  fs.rmSync(files.heartbeatPath, { force: true });
  fs.rmSync(files.startupErrorPath, { force: true });

  const config = {
    sessionRoot: files.sessionRoot,
    requestDir: files.requestDir,
    processingDir: files.processingDir,
    heartbeatPath: files.heartbeatPath,
    eeglabPath: settings.eeglabPath.trim(),
  };
  writeJsonFile(files.configPath, config);
  fs.writeFileSync(files.workerScriptPath, matlabSessionWorkerContents(files.configPath), 'utf8');

  const command = buildMatlabRunExpression(files.workerScriptPath);
  const args = ['-nosplash', '-r', command];

  let spawnResult: MatlabSessionSpawnResult;
  try {
    spawnResult = await spawnMatlabSession(settings.matlabExecutable.trim(), args, {
      sessionRoot: files.sessionRoot,
      workerScriptPath: files.workerScriptPath,
      configPath: files.configPath,
      requestDir: files.requestDir,
      heartbeatPath: files.heartbeatPath,
      startupErrorPath: files.startupErrorPath,
      eeglabPath: settings.eeglabPath.trim(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `打开 MATLAB 会话失败：${message}`,
      running: false,
      ready: false,
      state: 'not_started',
      sessionRoot: files.sessionRoot,
      workerScriptPath: files.workerScriptPath,
      configPath: files.configPath,
      requestDir: files.requestDir,
      heartbeatPath: files.heartbeatPath,
      startupErrorPath: files.startupErrorPath,
      command,
    };
  }

  writeJsonFile(files.statePath, {
    launchedAt: new Date().toISOString(),
    pid: spawnResult.pid ?? null,
    command,
    sessionRoot: files.sessionRoot,
  });

  return {
    ok: true,
    message: 'MATLAB 会话已启动，请等待底栏状态变为“MATLAB 会话已就绪”。',
    running: true,
    ready: false,
    state: 'starting',
    sessionRoot: files.sessionRoot,
    workerScriptPath: files.workerScriptPath,
    configPath: files.configPath,
    requestDir: files.requestDir,
    heartbeatPath: files.heartbeatPath,
    startupErrorPath: files.startupErrorPath,
    command,
    pid: spawnResult.pid ?? null,
  };
}

export function buildMatlabSessionPreprocessCommand(entryScriptPath: string, packagePath: string): string {
  return [
    `addpath('${matlabStringLiteral(path.dirname(entryScriptPath))}')`,
    `run_preprocess_task('${matlabStringLiteral(packagePath)}')`,
  ].join('; ');
}

export function buildMatlabSessionRunCommand(scriptPath: string): string {
  return buildMatlabRunExpression(scriptPath);
}

export async function runMatlabSessionCommand(
  paths: AppPaths,
  input: MatlabSessionCommandInput,
): Promise<MatlabSessionCommandResult> {
  const status = await waitForMatlabSessionReady(paths, input.startupTimeoutMs ?? SESSION_STARTING_GRACE_MS);

  if (!status.ready || !status.requestDir) {
    return {
      exitCode: null,
      stdout: '',
      stderr: status.state === 'not_started'
        ? '请先在底栏点击“打开 MATLAB”，并等待状态显示“MATLAB 会话已就绪”。'
        : status.message || '请先在底栏点击“打开 MATLAB”，并等待状态显示“MATLAB 会话已就绪”。',
    };
  }

  fs.mkdirSync(path.dirname(input.donePath), { recursive: true });
  fs.mkdirSync(path.dirname(input.errorPath), { recursive: true });
  fs.mkdirSync(path.dirname(input.logPath), { recursive: true });
  fs.rmSync(input.donePath, { force: true });
  fs.rmSync(input.errorPath, { force: true });

  const requestPath = path.join(status.requestDir, `${safeRequestToken()}.json`);
  writeJsonFile(requestPath, {
    id: path.basename(requestPath, '.json'),
    createdAt: new Date().toISOString(),
    command: input.command,
    donePath: input.donePath,
    errorPath: input.errorPath,
    logPath: input.logPath,
  });

  const startedAt = Date.now();
  const timeoutMs = input.timeoutMs ?? SESSION_COMMAND_TIMEOUT_MS;

  while (Date.now() - startedAt <= timeoutMs) {
    if (fs.existsSync(input.donePath)) {
      return {
        exitCode: 0,
        stdout: fs.existsSync(input.logPath) ? fs.readFileSync(input.logPath, 'utf8') : '',
        stderr: '',
      };
    }

    if (fs.existsSync(input.errorPath)) {
      return {
        exitCode: 1,
        stdout: fs.existsSync(input.logPath) ? fs.readFileSync(input.logPath, 'utf8') : '',
        stderr: fs.readFileSync(input.errorPath, 'utf8'),
      };
    }

    await wait(SESSION_POLL_INTERVAL_MS);
  }

  return {
    exitCode: null,
    stdout: fs.existsSync(input.logPath) ? fs.readFileSync(input.logPath, 'utf8') : '',
    stderr: 'MATLAB 会话执行超时，未检测到 done/error 状态文件。',
  };
}
