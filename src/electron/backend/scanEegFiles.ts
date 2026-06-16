import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'sql.js';
import type { EegCondition, ScanEegFolderResult } from '../../domain/backendTypes.js';
import { nowIso } from './database.js';
import {
  addTask,
  addTaskLog,
  completeTask,
  failTask,
  listPatientsForMatching,
  registerEegFile,
} from './repositories.js';

type PatientMatch = {
  id: string;
  subjectCode: string;
  subjectCodeLower: string;
};

const eegExtensions = new Set(['.cnt', '.set', '.edf', '.bdf']);

function scanFiles(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...scanFiles(entryPath));
    } else if (entry.isFile() && eegExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function conditionFromBaseName(baseName: string): EegCondition {
  const tokens = baseName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

  if (tokens.some((token) => token === 'eo' || token === 'eyesopen' || token === 'open')) {
    return 'EO';
  }

  if (tokens.some((token) => token === 'ec' || token === 'eyesclosed' || token === 'closed')) {
    return 'EC';
  }

  return 'UNKNOWN';
}

function patientsForMatching(db: Database): PatientMatch[] {
  return listPatientsForMatching(db).map((patient) => ({
    ...patient,
    subjectCodeLower: patient.subjectCode.toLowerCase(),
  }));
}

export function scanEegFolderForPatients(db: Database, folderPath: string): ScanEegFolderResult {
  const taskId = addTask(db, {
    type: 'scan_eeg_files',
    status: 'running',
    inputJson: JSON.stringify({ folderPath }),
    startedAt: nowIso(),
  });

  try {
    const patients = patientsForMatching(db);
    const files = scanFiles(folderPath);
    const result: ScanEegFolderResult = {
      scannedFiles: files.length,
      registeredFiles: 0,
      unmatchedFiles: [],
    };

    for (const filePath of files) {
      const parsed = path.parse(filePath);
      const baseName = parsed.name.toLowerCase();
      const patient = patients.find((candidate) => baseName.includes(candidate.subjectCodeLower));

      if (!patient) {
        result.unmatchedFiles.push(filePath);
        continue;
      }

      registerEegFile(db, {
        patientId: patient.id,
        condition: conditionFromBaseName(parsed.name),
        filePath,
      });
      result.registeredFiles += 1;
    }

    addTaskLog(db, {
      taskId,
      level: 'info',
      source: 'app',
      message: `EEG scan completed: scanned ${result.scannedFiles}, registered ${result.registeredFiles}, unmatched ${result.unmatchedFiles.length}`,
    });
    completeTask(db, taskId, JSON.stringify(result));

    return result;
  } catch (error) {
    failTask(db, taskId, error instanceof Error ? error.message : String(error));
    addTaskLog(db, {
      taskId,
      level: 'error',
      source: 'app',
      message: `EEG scan failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    throw error;
  }
}
