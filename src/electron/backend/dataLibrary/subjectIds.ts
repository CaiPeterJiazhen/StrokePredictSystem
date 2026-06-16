import path from 'node:path';
import type { CohortType } from '../../../domain/backendTypes.js';

export interface ExtractedSubject {
  subjectCode: string;
  sourceSubjectCode: string;
  subjectName: string;
}

const subjectCodePattern = /sub\s*0*(\d+)/i;
const sourceSubjectCodePattern = /sub\s*(\d+)/i;

function cleanText(text: string): string {
  return path.parse(text.trim()).name;
}

function compactSubjectToken(token: string): string {
  return token.replace(/\s+/g, '').toLowerCase();
}

export function normalizeSubjectCode(text: string, cohort: Extract<CohortType, 'patient' | 'health'>): string {
  const sourceMatch = cleanText(text).match(sourceSubjectCodePattern);

  if (!sourceMatch) {
    return '';
  }

  const sourceCode = compactSubjectToken(`sub${sourceMatch[1]}`);
  const numericMatch = sourceCode.match(subjectCodePattern);
  if (!numericMatch) {
    return '';
  }

  const subjectNumber = Number(numericMatch[1]);
  if (cohort === 'health') {
    return subjectNumber > 9 ? `sub${subjectNumber.toString().padStart(3, '0')}` : sourceCode;
  }

  return `sub${subjectNumber.toString().padStart(2, '0')}`;
}

export function extractSubjectFromText(text: string, cohort: Extract<CohortType, 'patient' | 'health'>): ExtractedSubject {
  const value = cleanText(text);
  const sourceMatch = value.match(sourceSubjectCodePattern);

  if (!sourceMatch || sourceMatch.index === undefined) {
    return {
      subjectCode: '',
      sourceSubjectCode: '',
      subjectName: '',
    };
  }

  const sourceSubjectCode = compactSubjectToken(`sub${sourceMatch[1]}`);
  const subjectCode = normalizeSubjectCode(sourceSubjectCode, cohort);
  const nameStart = sourceMatch.index + sourceMatch[0].length;
  const subjectName = value
    .slice(nameStart)
    .replace(/^[\s_\-—–]+/, '')
    .replace(/[\s_\-—–]+/g, '');

  return {
    subjectCode,
    sourceSubjectCode,
    subjectName,
  };
}
