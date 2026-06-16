import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupClinicalDocument, shouldBackupAssetType } from '../../../../src/electron/backend/dataLibrary/documentBackup.js';

describe('document backup', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  function makeTempDir(): string {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'stroke-document-backup-'));
    tempDirs.push(tempDir);
    return tempDir;
  }

  it.each(['record_pdf', 'clinical_excel', 'completeness_workbook'] as const)(
    'backs up document asset type %s',
    (assetType) => {
      expect(shouldBackupAssetType(assetType)).toBe(true);
    },
  );

  it.each(['raw_eeg_cnt', 'processed_eeg_set', 'processed_eeg_fdt'] as const)(
    'does not back up EEG asset type %s',
    (assetType) => {
      expect(shouldBackupAssetType(assetType)).toBe(false);
    },
  );

  it('copies a PDF into the subject PDF backup bucket and hashes the copied content', () => {
    const sourceDir = makeTempDir();
    const backupRoot = makeTempDir();
    const sourcePath = path.join(sourceDir, 'sub01-record.pdf');
    const content = '%PDF-1.7 test clinical record';
    writeFileSync(sourcePath, content);

    const result = backupClinicalDocument({
      sourcePath,
      clinicalDocsBackupRoot: backupRoot,
      assetType: 'record_pdf',
      subjectCode: 'sub01',
    });

    expect(result.backupPath).toContain(path.join('pdf', 'sub01'));
    expect(path.basename(result.backupPath)).toBe('sub01-record.pdf');
    expect(readFileSync(result.backupPath, 'utf8')).toBe(content);
    expect(result.fileHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects non-document asset types without copying them', () => {
    const sourceDir = makeTempDir();
    const backupRoot = makeTempDir();
    const sourcePath = path.join(sourceDir, 'resting-eye-open.cnt');
    writeFileSync(sourcePath, 'raw eeg content');

    expect(() =>
      backupClinicalDocument({
        sourcePath,
        clinicalDocsBackupRoot: backupRoot,
        assetType: 'raw_eeg_cnt',
        subjectCode: 'sub01',
      }),
    ).toThrow(/cannot back up/i);
    expect(existsSync(path.join(backupRoot, 'excel', 'sub01', 'resting-eye-open.cnt'))).toBe(false);
  });

  it('rejects subject codes that could escape the backup root', () => {
    const sourceDir = makeTempDir();
    const backupRoot = makeTempDir();
    const sourcePath = path.join(sourceDir, 'sub01-record.pdf');
    writeFileSync(sourcePath, 'clinical record');

    expect(() =>
      backupClinicalDocument({
        sourcePath,
        clinicalDocsBackupRoot: backupRoot,
        assetType: 'record_pdf',
        subjectCode: '..\\escape',
      }),
    ).toThrow(/invalid subject/i);
    expect(existsSync(path.join(backupRoot, 'pdf'))).toBe(false);
  });

  it('keeps both backups when different same-named documents are copied for the same subject', () => {
    const firstSourceDir = makeTempDir();
    const secondSourceDir = makeTempDir();
    const backupRoot = makeTempDir();
    const firstSourcePath = path.join(firstSourceDir, 'sub01-record.pdf');
    const secondSourcePath = path.join(secondSourceDir, 'sub01-record.pdf');
    writeFileSync(firstSourcePath, 'first clinical record');
    writeFileSync(secondSourcePath, 'second clinical record');

    const firstResult = backupClinicalDocument({
      sourcePath: firstSourcePath,
      clinicalDocsBackupRoot: backupRoot,
      assetType: 'record_pdf',
      subjectCode: 'sub01',
    });
    const secondResult = backupClinicalDocument({
      sourcePath: secondSourcePath,
      clinicalDocsBackupRoot: backupRoot,
      assetType: 'record_pdf',
      subjectCode: 'sub01',
    });

    expect(secondResult.backupPath).not.toBe(firstResult.backupPath);
    expect(readFileSync(firstResult.backupPath, 'utf8')).toBe('first clinical record');
    expect(readFileSync(secondResult.backupPath, 'utf8')).toBe('second clinical record');
  });
});
