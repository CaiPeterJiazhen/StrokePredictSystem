import path from 'node:path';
import type { CohortType, DataAssetStage, DataAssetType } from '../../../domain/backendTypes.js';
import { extractSubjectFromText } from './subjectIds.js';

export interface ClassifiedDataLibraryPath {
  cohort: CohortType;
  stage: DataAssetStage;
  assetType: DataAssetType;
  subjectCode: string;
  sourceSubjectCode: string;
  subjectName: string;
}

const patientRawRoot = 'Patient_tACS_M1_EEG';
const patientProcessedRoot = 'Patient_tACS_M1_RestingStateEEG_afterProcess';
const healthRawRoot = 'Health-tACS-M1-RestingStateEEG';
const healthProcessedRoot = 'Health_tACS_M1_RestingStateEEG_afterProcess';
const patientRecordRoot = '患者记录本';
const healthRecordRoot = '健康人记录本';
const clinicalWorkbooks = new Set(['脑卒中患者信息记录表.xlsx', 'M1组病历记录表.xlsx']);
const completenessWorkbook = '19例患者脑电数据完整性检查.xlsx';
export const dataLibraryProjectDirectoryNames = new Set([
  patientRawRoot,
  patientProcessedRoot,
  healthRawRoot,
  healthProcessedRoot,
  patientRecordRoot,
  healthRecordRoot,
]);
export const dataLibraryProjectFileNames = new Set([...clinicalWorkbooks, completenessWorkbook]);

function normalizePathForWin32(value: string): string {
  return value.replace(/\//g, '\\');
}

function relativeSegments(rootPath: string, filePath: string): string[] {
  const normalizedRoot = normalizePathForWin32(rootPath);
  const normalizedFile = normalizePathForWin32(filePath);
  const relative = path.win32.relative(normalizedRoot, normalizedFile);

  if (!relative || relative.startsWith('..') || path.win32.isAbsolute(relative)) {
    return [];
  }

  return relative.split(path.win32.sep).filter(Boolean);
}

function projectClassification(assetType: DataAssetType): ClassifiedDataLibraryPath {
  return {
    cohort: 'project',
    stage: '不适用',
    assetType,
    subjectCode: '',
    sourceSubjectCode: '',
    subjectName: '',
  };
}

function subjectClassification(
  cohort: Extract<CohortType, 'patient' | 'health'>,
  stage: DataAssetStage,
  assetType: DataAssetType,
  subjectFolder: string,
): ClassifiedDataLibraryPath {
  return {
    cohort,
    stage,
    assetType,
    ...extractSubjectFromText(subjectFolder, cohort),
  };
}

function processedAssetType(extension: string): DataAssetType | null {
  if (extension === '.set') {
    return 'processed_eeg_set';
  }

  if (extension === '.fdt') {
    return 'processed_eeg_fdt';
  }

  return null;
}

export function classifyDataLibraryPath(rootPath: string, filePath: string): ClassifiedDataLibraryPath | null {
  const segments = relativeSegments(rootPath, filePath);
  const fileName = segments.at(-1) ?? '';
  const extension = path.win32.extname(fileName).toLowerCase();

  if (segments.length === 0 || !fileName) {
    return null;
  }

  if (clinicalWorkbooks.has(fileName)) {
    return projectClassification('clinical_excel');
  }

  if (fileName === completenessWorkbook) {
    return projectClassification('completeness_workbook');
  }

  if (extension === '.ced') {
    return projectClassification('electrode_location');
  }

  if (extension === '.node') {
    return projectClassification('channel_file');
  }

  if (extension === '.zip') {
    return projectClassification('archive');
  }

  if (segments[0] === patientRecordRoot && extension === '.pdf') {
    return subjectClassification('patient', '不适用', 'record_pdf', fileName);
  }

  if (segments[0] === healthRecordRoot && extension === '.pdf') {
    return subjectClassification('health', '不适用', 'record_pdf', fileName);
  }

  if (segments[0] === patientRawRoot && segments.length >= 4 && extension === '.cnt') {
    return subjectClassification('patient', segments[1] as DataAssetStage, 'raw_eeg_cnt', segments[2]);
  }

  if (segments[0] === patientProcessedRoot && segments.length >= 4) {
    const assetType = processedAssetType(extension);
    return assetType ? subjectClassification('patient', segments[1] as DataAssetStage, assetType, segments[2]) : null;
  }

  if (segments[0] === healthRawRoot && segments.length >= 3 && extension === '.cnt') {
    return subjectClassification('health', '不适用', 'raw_eeg_cnt', segments[1]);
  }

  if (segments[0] === healthProcessedRoot && segments.length >= 3) {
    const assetType = processedAssetType(extension);
    return assetType ? subjectClassification('health', '不适用', assetType, segments[1]) : null;
  }

  return null;
}
