import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { parseClinicalWorkbook, parseCompletenessWorkbook } from '../../../../src/electron/backend/dataLibrary/excelParsers.js';

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-excel-parsers-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('data library Excel parsers', () => {
  it('parses clinical workbooks with row 1 headers', async () => {
    const filePath = path.join(tempRoot(), 'M1组病历记录表.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow([
      '编号',
      '姓名',
      '年龄',
      '病程',
      '性别',
      '患病侧',
      '治疗前FMA',
      '治疗后FMA',
      '治疗前MBI',
      '治疗后MBI',
      '治疗前BBT',
      '治疗后BBT',
      'MMSE',
    ]);
    sheet.addRow(['sub01', '穆祥贵', '69岁', '17天', '男', '左手', 63, 65, 80, 95, '左18右26', '左20右29', 27]);
    await workbook.xlsx.writeFile(filePath);

    await expect(parseClinicalWorkbook(filePath)).resolves.toEqual([
      {
        subjectCode: 'sub01',
        name: '穆祥贵',
        age: 69,
        sex: '男',
        affectedHand: '左手',
        diseaseCourse: '17天',
        affectedSideRaw: '左手',
        fmaBefore: 63,
        fmaAfter: 65,
        mbiBefore: 80,
        mbiAfter: 95,
        bbtBefore: '左18右26',
        bbtAfter: '左20右29',
        mmse: 27,
        missingData: '',
        dropoutReason: '',
        mriCount: null,
        sourceWorkbook: 'M1组病历记录表.xlsx',
      },
    ]);
  });

  it('parses clinical workbooks with row 4 headers', async () => {
    const filePath = path.join(tempRoot(), '脑卒中患者信息记录表.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['填充']);
    sheet.addRow(['填充']);
    sheet.addRow(['填充']);
    sheet.addRow([
      '编号',
      '姓名',
      '年龄',
      '病程',
      '性别',
      '患病侧（手）',
      '治疗前FMA',
      '治疗后FMA',
      '治疗前MBI',
      '治疗后MBI',
      '缺少数据',
      '脱落原因',
      '核磁次数',
    ]);
    sheet.addRow(['sub02', '翟玉琴', 69, 92, '女', '右', 50, 62, 75, 90, '', '', 2]);
    await workbook.xlsx.writeFile(filePath);

    await expect(parseClinicalWorkbook(filePath)).resolves.toEqual([
      expect.objectContaining({
        subjectCode: 'sub02',
        name: '翟玉琴',
        age: 69,
        sex: '女',
        affectedHand: '右手',
        diseaseCourse: '92',
        affectedSideRaw: '右',
        fmaBefore: 50,
        fmaAfter: 62,
        mbiBefore: 75,
        mbiAfter: 90,
        missingData: '',
        dropoutReason: '',
        mriCount: 2,
        sourceWorkbook: '脑卒中患者信息记录表.xlsx',
      }),
    ]);
  });

  it('expands completeness columns by stage and task', async () => {
    const filePath = path.join(tempRoot(), '19例患者脑电数据完整性检查.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['患者ID', '姓名', 'MRI', '合计', '处理', '基线_睁眼', '即时_闭眼', '最终_抓握任务']);
    sheet.addRow(['sub01', '穆祥贵', 2, '4/4', '16/16', 'Y', 'Y', 'X']);
    await workbook.xlsx.writeFile(filePath);

    await expect(parseCompletenessWorkbook(filePath)).resolves.toEqual([
      {
        subjectCode: 'sub01',
        subjectName: '穆祥贵',
        stage: '基线',
        task: '睁眼',
        workbookStatus: 'Y',
        sourceWorkbook: '19例患者脑电数据完整性检查.xlsx',
      },
      {
        subjectCode: 'sub01',
        subjectName: '穆祥贵',
        stage: '即时',
        task: '闭眼',
        workbookStatus: 'Y',
        sourceWorkbook: '19例患者脑电数据完整性检查.xlsx',
      },
      {
        subjectCode: 'sub01',
        subjectName: '穆祥贵',
        stage: '最终',
        task: '抓握任务',
        workbookStatus: 'X',
        sourceWorkbook: '19例患者脑电数据完整性检查.xlsx',
      },
    ]);
  });
});
