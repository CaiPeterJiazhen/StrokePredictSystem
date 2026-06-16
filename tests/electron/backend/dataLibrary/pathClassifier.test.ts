import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyDataLibraryPath } from '../../../../src/electron/backend/dataLibrary/pathClassifier.js';

const rootPath = 'F:\\CJZFile\\EEG_M1';
const winPath = (...segments: string[]) => path.win32.join(rootPath, ...segments);

describe('EEG_M1 path classifier', () => {
  it('classifies patient raw CNT files from the stage and subject parent folders', () => {
    expect(
      classifyDataLibraryPath(
        rootPath,
        winPath('Patient_tACS_M1_EEG', '基线', 'sub011单庆明', 'resting-eye-open.cnt'),
      ),
    ).toEqual({
      cohort: 'patient',
      stage: '基线',
      assetType: 'raw_eeg_cnt',
      subjectCode: 'sub11',
      sourceSubjectCode: 'sub011',
      subjectName: '单庆明',
    });
  });

  it('classifies patient processed SET and FDT files from the subject parent folder', () => {
    expect(
      classifyDataLibraryPath(
        rootPath,
        winPath('Patient_tACS_M1_RestingStateEEG_afterProcess', '即时', 'sub021王宇', 'anything.set'),
      ),
    ).toEqual({
      cohort: 'patient',
      stage: '即时',
      assetType: 'processed_eeg_set',
      subjectCode: 'sub21',
      sourceSubjectCode: 'sub021',
      subjectName: '王宇',
    });
    expect(
      classifyDataLibraryPath(
        rootPath,
        winPath('Patient_tACS_M1_RestingStateEEG_afterProcess', '最终', 'sub021王宇', 'anything.fdt'),
      ),
    ).toEqual(expect.objectContaining({ assetType: 'processed_eeg_fdt', stage: '最终', subjectCode: 'sub21' }));
  });

  it('classifies health raw and processed files with not-applicable stage', () => {
    expect(
      classifyDataLibraryPath(
        rootPath,
        winPath('Health-tACS-M1-RestingStateEEG', 'sub001朱卫清', 'baseline.cnt'),
      ),
    ).toEqual({
      cohort: 'health',
      stage: '不适用',
      assetType: 'raw_eeg_cnt',
      subjectCode: 'sub001',
      sourceSubjectCode: 'sub001',
      subjectName: '朱卫清',
    });
    expect(
      classifyDataLibraryPath(
        rootPath,
        winPath('Health_tACS_M1_RestingStateEEG_afterProcess', 'sub0011齐巍', 'rest.set'),
      ),
    ).toEqual(expect.objectContaining({ cohort: 'health', stage: '不适用', assetType: 'processed_eeg_set' }));
    expect(
      classifyDataLibraryPath(
        rootPath,
        winPath('Health_tACS_M1_RestingStateEEG_afterProcess', 'sub0011齐巍', 'rest.fdt'),
      ),
    ).toEqual(expect.objectContaining({ cohort: 'health', stage: '不适用', assetType: 'processed_eeg_fdt' }));
  });

  it('classifies record PDFs, project workbooks, electrode files, channel files, and archives', () => {
    expect(classifyDataLibraryPath(rootPath, winPath('患者记录本', 'sub01穆祥贵.pdf'))).toEqual({
      cohort: 'patient',
      stage: '不适用',
      assetType: 'record_pdf',
      subjectCode: 'sub01',
      sourceSubjectCode: 'sub01',
      subjectName: '穆祥贵',
    });
    expect(classifyDataLibraryPath(rootPath, winPath('健康人记录本', 'sub001朱卫清.pdf'))).toEqual(
      expect.objectContaining({ cohort: 'health', assetType: 'record_pdf', subjectCode: 'sub001' }),
    );
    expect(classifyDataLibraryPath(rootPath, winPath('脑卒中患者信息记录表.xlsx'))).toEqual(
      expect.objectContaining({ cohort: 'project', stage: '不适用', assetType: 'clinical_excel' }),
    );
    expect(classifyDataLibraryPath(rootPath, winPath('M1组病历记录表.xlsx'))).toEqual(
      expect.objectContaining({ cohort: 'project', stage: '不适用', assetType: 'clinical_excel' }),
    );
    expect(classifyDataLibraryPath(rootPath, winPath('19例患者脑电数据完整性检查.xlsx'))).toEqual(
      expect.objectContaining({ cohort: 'project', stage: '不适用', assetType: 'completeness_workbook' }),
    );
    expect(classifyDataLibraryPath(rootPath, winPath('standard-10-20.ced'))).toEqual(
      expect.objectContaining({ cohort: 'project', assetType: 'electrode_location' }),
    );
    expect(classifyDataLibraryPath(rootPath, winPath('channels.node'))).toEqual(
      expect.objectContaining({ cohort: 'project', assetType: 'channel_file' }),
    );
    expect(classifyDataLibraryPath(rootPath, winPath('backup.zip'))).toEqual(
      expect.objectContaining({ cohort: 'project', assetType: 'archive' }),
    );
  });

  it('does not classify EEG files from a matching basename alone', () => {
    expect(classifyDataLibraryPath(rootPath, winPath('misc', 'sub01穆祥贵.cnt'))).toBeNull();
    expect(classifyDataLibraryPath(rootPath, winPath('Patient_tACS_M1_EEG', '基线', 'unmatched-folder', 'sub01.cnt'))).toEqual(
      expect.objectContaining({
        subjectCode: '',
        sourceSubjectCode: '',
        subjectName: '',
      }),
    );
  });

  it('returns null for unknown paths', () => {
    expect(classifyDataLibraryPath(rootPath, winPath('notes', 'readme.txt'))).toBeNull();
  });
});
