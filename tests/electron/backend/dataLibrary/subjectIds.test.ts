import { describe, expect, it } from 'vitest';
import { extractSubjectFromText, normalizeSubjectCode } from '../../../../src/electron/backend/dataLibrary/subjectIds.js';

describe('EEG_M1 subject ids', () => {
  it.each([
    ['sub01穆祥贵', 'patient', 'sub01'],
    ['sub011单庆明', 'patient', 'sub11'],
    ['sub021王宇', 'patient', 'sub21'],
    ['sub001', 'patient', 'sub01'],
    ['sub001朱卫清', 'health', 'sub001'],
    ['sub0011齐巍', 'health', 'sub011'],
  ] as const)('normalizes %s for %s cohort', (text, cohort, expected) => {
    expect(normalizeSubjectCode(text, cohort)).toBe(expected);
  });

  it('extracts subject code and Chinese name from mixed folder and PDF names', () => {
    expect(extractSubjectFromText('sub01穆祥贵', 'patient')).toEqual({
      subjectCode: 'sub01',
      sourceSubjectCode: 'sub01',
      subjectName: '穆祥贵',
    });
    expect(extractSubjectFromText('sub23李厚强.pdf', 'patient')).toEqual({
      subjectCode: 'sub23',
      sourceSubjectCode: 'sub23',
      subjectName: '李厚强',
    });
  });

  it('removes connectors and spaces around the subject token and name', () => {
    expect(extractSubjectFromText('sub011 - 单庆明.pdf', 'patient')).toEqual({
      subjectCode: 'sub11',
      sourceSubjectCode: 'sub011',
      subjectName: '单庆明',
    });
    expect(extractSubjectFromText('sub0011 齐巍.pdf', 'health')).toEqual({
      subjectCode: 'sub011',
      sourceSubjectCode: 'sub0011',
      subjectName: '齐巍',
    });
  });

  it('normalizes health source tokens with extra padding to the same subject code', () => {
    expect(extractSubjectFromText('sub0012-郭兆麟.pdf', 'health')).toEqual({
      subjectCode: 'sub012',
      sourceSubjectCode: 'sub0012',
      subjectName: '郭兆麟',
    });
    expect(extractSubjectFromText('sub012郭兆麟', 'health')).toEqual({
      subjectCode: 'sub012',
      sourceSubjectCode: 'sub012',
      subjectName: '郭兆麟',
    });
  });

  it('returns empty subject details when no subject code is present', () => {
    expect(extractSubjectFromText('脑卒中患者信息记录表.xlsx', 'patient')).toEqual({
      subjectCode: '',
      sourceSubjectCode: '',
      subjectName: '',
    });
  });
});
