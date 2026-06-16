import path from 'node:path';
import ExcelJS from 'exceljs';
import type { DataAssetStage } from '../../../domain/backendTypes.js';
import { normalizeSubjectCode } from './subjectIds.js';

export interface ParsedClinicalRow {
  subjectCode: string;
  name: string;
  age: number | null;
  sex: '男' | '女' | '';
  affectedHand: '左手' | '右手' | '双手' | '';
  diseaseCourse: string;
  affectedSideRaw: string;
  fmaBefore: number | null;
  fmaAfter: number | null;
  mbiBefore: number | null;
  mbiAfter: number | null;
  bbtBefore: string;
  bbtAfter: string;
  mmse: number | null;
  missingData: string;
  dropoutReason: string;
  mriCount: number | null;
  sourceWorkbook: string;
}

export interface ParsedCompletenessRow {
  subjectCode: string;
  subjectName: string;
  stage: DataAssetStage;
  task: '睁眼' | '闭眼' | '运动想象' | '抓握任务';
  workbookStatus: 'Y' | 'X' | '';
  sourceWorkbook: string;
}

type HeaderMap = Map<string, number>;

const headerLabels = new Set(['编号', '患者ID', '姓名', '年龄', '性别', '患病侧', '患病侧（手）']);
const completenessHeaderPattern = /^(基线|即时|阶段|最终)_(睁眼|闭眼|运动想象|抓握任务)$/;

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }
    if ('hyperlink' in value && 'text' in value && typeof value.text === 'string') return value.text.trim();
    return '';
  }
  return String(value).trim();
}

function normalizeHeader(value: string): string {
  return value.replace(/\s+/g, '');
}

function rowValues(row: ExcelJS.Row): string[] {
  const values: string[] = [];
  row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    values[columnNumber] = normalizeHeader(cellText(cell.value));
  });
  return values;
}

function headerScore(values: string[]): number {
  return values.reduce((score, value) => score + (headerLabels.has(value) ? 1 : 0), 0);
}

function findHeaderRow(worksheet: ExcelJS.Worksheet): ExcelJS.Row | null {
  let bestRow: ExcelJS.Row | null = null;
  let bestScore = 0;
  worksheet.eachRow((row) => {
    const score = headerScore(rowValues(row));
    if (score > bestScore) {
      bestRow = row;
      bestScore = score;
    }
  });
  return bestScore >= 2 ? bestRow : null;
}

function makeHeaderMap(headerRow: ExcelJS.Row): HeaderMap {
  const headers = new Map<string, number>();
  headerRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    const label = normalizeHeader(cellText(cell.value));
    if (label) headers.set(label, columnNumber);
  });
  return headers;
}

function getCell(row: ExcelJS.Row, headers: HeaderMap, names: string[]): string {
  for (const name of names) {
    const column = headers.get(name);
    if (column !== undefined) return cellText(row.getCell(column).value);
  }
  return '';
}

function parseNumber(value: string): number | null {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numberValue = Number(match[0]);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function parseSex(value: string): '男' | '女' | '' {
  if (value === '男' || value === '女') return value;
  return '';
}

function parseAffectedHand(value: string): '左手' | '右手' | '双手' | '' {
  if (value === '左手' || value === '右手' || value === '双手') return value;
  if (value.includes('双')) return '双手';
  if (value.includes('左')) return '左手';
  if (value.includes('右')) return '右手';
  return '';
}

async function readWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

export async function parseClinicalWorkbook(filePath: string): Promise<ParsedClinicalRow[]> {
  const workbook = await readWorkbook(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const headerRow = findHeaderRow(worksheet);
  if (!headerRow) return [];

  const headers = makeHeaderMap(headerRow);
  const sourceWorkbook = path.basename(filePath);
  const rows: ParsedClinicalRow[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow.number) return;

    const subjectRaw = getCell(row, headers, ['编号', '患者ID']);
    const subjectCode = normalizeSubjectCode(subjectRaw, 'patient');
    if (!subjectCode) return;

    const affectedSideRaw = getCell(row, headers, ['患病侧', '患病侧（手）']);
    rows.push({
      subjectCode,
      name: getCell(row, headers, ['姓名']),
      age: parseNumber(getCell(row, headers, ['年龄'])),
      sex: parseSex(getCell(row, headers, ['性别'])),
      affectedHand: parseAffectedHand(affectedSideRaw),
      diseaseCourse: getCell(row, headers, ['病程']),
      affectedSideRaw,
      fmaBefore: parseNumber(getCell(row, headers, ['治疗前FMA'])),
      fmaAfter: parseNumber(getCell(row, headers, ['治疗后FMA'])),
      mbiBefore: parseNumber(getCell(row, headers, ['治疗前MBI'])),
      mbiAfter: parseNumber(getCell(row, headers, ['治疗后MBI'])),
      bbtBefore: getCell(row, headers, ['治疗前BBT']),
      bbtAfter: getCell(row, headers, ['治疗后BBT']),
      mmse: parseNumber(getCell(row, headers, ['MMSE'])),
      missingData: getCell(row, headers, ['缺少数据']),
      dropoutReason: getCell(row, headers, ['脱落原因']),
      mriCount: parseNumber(getCell(row, headers, ['核磁次数'])),
      sourceWorkbook,
    });
  });

  return rows;
}

export async function parseCompletenessWorkbook(filePath: string): Promise<ParsedCompletenessRow[]> {
  const workbook = await readWorkbook(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const headerRow = findHeaderRow(worksheet);
  if (!headerRow) return [];

  const headers = makeHeaderMap(headerRow);
  const sourceWorkbook = path.basename(filePath);
  const completenessColumns: Array<{
    column: number;
    stage: DataAssetStage;
    task: ParsedCompletenessRow['task'];
  }> = [];

  for (const [header, column] of headers) {
    const match = header.match(completenessHeaderPattern);
    if (match) {
      completenessColumns.push({
        column,
        stage: match[1] as DataAssetStage,
        task: match[2] as ParsedCompletenessRow['task'],
      });
    }
  }

  const rows: ParsedCompletenessRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow.number) return;

    const subjectRaw = getCell(row, headers, ['患者ID', '编号']);
    const subjectCode = normalizeSubjectCode(subjectRaw, 'patient');
    if (!subjectCode) return;

    const subjectName = getCell(row, headers, ['姓名']);
    for (const columnInfo of completenessColumns) {
      const statusText = cellText(row.getCell(columnInfo.column).value);
      const workbookStatus = statusText === 'Y' || statusText === 'X' ? statusText : '';
      rows.push({
        subjectCode,
        subjectName,
        stage: columnInfo.stage,
        task: columnInfo.task,
        workbookStatus,
        sourceWorkbook,
      });
    }
  });

  return rows;
}
