import fs from 'node:fs';
import path from 'node:path';

export interface AppPaths {
  dataRoot: string;
  databasePath: string;
  outputsRoot: string;
  logsRoot: string;
  backupsRoot: string;
  clinicalDocsBackupRoot: string;
}

export const DEFAULT_APP_ROOT = path.join('F:\\', 'NeuroPredict');

export function resolveDefaultDataRoot(): string {
  return DEFAULT_APP_ROOT;
}

export function ensureOutputRoot(outputsRoot: string): void {
  const requiredDirs = [
    outputsRoot,
    path.join(outputsRoot, 'preprocess'),
    path.join(outputsRoot, 'features'),
    path.join(outputsRoot, 'predictions'),
    path.join(outputsRoot, 'explainability'),
    path.join(outputsRoot, 'reports'),
  ];

  for (const dir of requiredDirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function ensureAppPaths(dataRoot = resolveDefaultDataRoot()): AppPaths {
  const outputsRoot = path.join(dataRoot, 'outputs');
  const logsRoot = path.join(dataRoot, 'logs');
  const backupsRoot = path.join(dataRoot, 'backups');
  const clinicalDocsBackupRoot = path.join(backupsRoot, 'clinical_docs');
  const requiredDirs = [
    dataRoot,
    logsRoot,
    backupsRoot,
    clinicalDocsBackupRoot,
    path.join(clinicalDocsBackupRoot, 'pdf'),
    path.join(clinicalDocsBackupRoot, 'excel'),
  ];

  for (const dir of requiredDirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
  ensureOutputRoot(outputsRoot);

  return {
    dataRoot,
    databasePath: path.join(dataRoot, 'app.db'),
    outputsRoot,
    logsRoot,
    backupsRoot,
    clinicalDocsBackupRoot,
  };
}
