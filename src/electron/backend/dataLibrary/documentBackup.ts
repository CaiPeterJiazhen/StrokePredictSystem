import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DataAssetType } from '../../../domain/backendTypes.js';

export interface BackupClinicalDocumentInput {
  sourcePath: string;
  clinicalDocsBackupRoot: string;
  assetType: DataAssetType;
  subjectCode: string;
}

export interface BackupClinicalDocumentResult {
  backupPath: string;
  fileHash: string;
}

export function shouldBackupAssetType(assetType: DataAssetType): boolean {
  return assetType === 'record_pdf' || assetType === 'clinical_excel' || assetType === 'completeness_workbook';
}

export function backupClinicalDocument(input: BackupClinicalDocumentInput): BackupClinicalDocumentResult {
  if (!shouldBackupAssetType(input.assetType)) {
    throw new Error(`Cannot back up asset type: ${input.assetType}`);
  }

  const bucket = path.extname(input.sourcePath).toLowerCase() === '.pdf' ? 'pdf' : 'excel';
  const subjectBucket = safeSubjectBucket(input.subjectCode);
  const targetDir = path.join(input.clinicalDocsBackupRoot, bucket, subjectBucket);
  const fileBuffer = readFileSync(input.sourcePath);
  const fileHash = hashBuffer(fileBuffer);
  const { backupPath, shouldCopy } = availableBackupTarget(targetDir, path.basename(input.sourcePath), fileHash);

  mkdirSync(targetDir, { recursive: true });
  if (shouldCopy) {
    copyFileSync(input.sourcePath, backupPath);
  }

  return { backupPath, fileHash };
}

function safeSubjectBucket(subjectCode: string): string {
  if (!subjectCode) {
    return 'project';
  }

  if (!/^[A-Za-z0-9_-]+$/.test(subjectCode)) {
    throw new Error(`Invalid subject code for backup path: ${subjectCode}`);
  }

  return subjectCode;
}

function availableBackupTarget(
  targetDir: string,
  basename: string,
  fileHash: string,
): { backupPath: string; shouldCopy: boolean } {
  const originalPath = path.join(targetDir, basename);
  if (!existsSync(originalPath)) {
    return { backupPath: originalPath, shouldCopy: true };
  }
  if (hashFile(originalPath) === fileHash) {
    return { backupPath: originalPath, shouldCopy: false };
  }

  const parsed = path.parse(basename);
  const shortHash = fileHash.slice(0, 12);
  let candidatePath = path.join(targetDir, `${parsed.name}-${shortHash}${parsed.ext}`);
  let counter = 2;

  while (existsSync(candidatePath) && hashFile(candidatePath) !== fileHash) {
    candidatePath = path.join(targetDir, `${parsed.name}-${shortHash}-${counter}${parsed.ext}`);
    counter += 1;
  }

  return {
    backupPath: candidatePath,
    shouldCopy: !existsSync(candidatePath),
  };
}

function hashFile(filePath: string): string {
  return hashBuffer(readFileSync(filePath));
}

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
