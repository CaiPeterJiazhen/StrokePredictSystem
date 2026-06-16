import fs from 'node:fs';
import type { Database } from 'sql.js';
import Papa from 'papaparse';
import type { CreatePatientInput, ImportPatientsResult } from '../../domain/backendTypes.js';
import { nowIso } from './database.js';
import { addTask, addTaskLog, completeTask, createPatient, failTask, patientExistsBySubjectCode } from './repositories.js';

type CsvRow = Record<string, unknown> & {
  __parsed_extra?: unknown[];
};
type RowValidationResult = { ok: true; input: CreatePatientInput } | { ok: false; error: string };
type AgeValidationResult = { ok: true; value: number | null } | { ok: false; error: string };
type SexValidationResult = { ok: true; value: CreatePatientInput['sex'] } | { ok: false; error: string };
type AffectedHandValidationResult =
  | { ok: true; value: CreatePatientInput['affectedHand'] }
  | { ok: false; error: string };

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const normalized = text(value);

    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function parseAge(value: unknown): AgeValidationResult {
  const raw = text(value);

  if (!raw) {
    return { ok: true, value: null };
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `invalid age "${raw}"` };
  }

  return { ok: true, value: parsed };
}

function parseSex(value: unknown): SexValidationResult {
  const raw = text(value);

  switch (raw) {
    case '':
    case '男':
    case '女':
      return { ok: true, value: raw };
    default:
      return { ok: false, error: `invalid sex "${raw}"` };
  }
}

function parseAffectedHand(value: unknown): AffectedHandValidationResult {
  const raw = text(value);

  switch (raw) {
    case '':
    case '左手':
    case '右手':
    case '双手':
      return { ok: true, value: raw };
    default:
      return { ok: false, error: `invalid affectedHand "${raw}"` };
  }
}

function patientInputFromRow(row: CsvRow): RowValidationResult {
  const subjectCode = firstText(row.subject_code, row.subjectCode);

  if (!subjectCode) {
    return { ok: false, error: 'missing subject_code' };
  }

  const age = parseAge(row.age);
  if (!age.ok) {
    return { ok: false, error: age.error };
  }

  const sex = parseSex(row.sex);
  if (!sex.ok) {
    return { ok: false, error: sex.error };
  }

  const affectedHand = parseAffectedHand(firstText(row.affected_hand, row.affectedHand));
  if (!affectedHand.ok) {
    return { ok: false, error: affectedHand.error };
  }

  return {
    ok: true,
    input: {
      subjectCode,
      name: text(row.name),
      age: age.value,
      sex: sex.value,
      diagnosis: text(row.diagnosis),
      affectedHand: affectedHand.value,
      notes: text(row.notes),
    },
  };
}

function fieldMismatchErrorsByRow(errors: Papa.ParseError[]): Map<number, string> {
  const rowErrors = new Map<number, string>();

  for (const error of errors) {
    if (error.type === 'FieldMismatch' && error.row !== undefined) {
      rowErrors.set(error.row, error.message);
    }
  }

  return rowErrors;
}

export function importPatientsFromCsv(db: Database, csvPath: string): ImportPatientsResult {
  const taskId = addTask(db, {
    type: 'import_patients',
    status: 'running',
    inputJson: JSON.stringify({ csvPath }),
    startedAt: nowIso(),
  });

  try {
    const csv = fs.readFileSync(csvPath, 'utf8');
    const parsed = Papa.parse<CsvRow>(csv, {
      header: true,
      skipEmptyLines: true,
    });
    const malformedRows = fieldMismatchErrorsByRow(parsed.errors);
    const result: ImportPatientsResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    parsed.data.forEach((row, index) => {
      const fieldMismatchError = malformedRows.get(index);

      if (fieldMismatchError || row.__parsed_extra !== undefined) {
        result.skipped += 1;
        result.errors.push(`Row ${index + 2} skipped: malformed CSV row${fieldMismatchError ? ` (${fieldMismatchError})` : ''}`);
        return;
      }

      const validation = patientInputFromRow(row);

      if (!validation.ok) {
        result.skipped += 1;
        result.errors.push(`Row ${index + 2} skipped: ${validation.error}`);
        return;
      }

      const exists = patientExistsBySubjectCode(db, validation.input.subjectCode);
      createPatient(db, validation.input);

      if (exists) {
        result.updated += 1;
      } else {
        result.created += 1;
      }
    });

    addTaskLog(db, {
      taskId,
      level: 'info',
      source: 'app',
      message: `Patient import completed: created ${result.created}, updated ${result.updated}, skipped ${result.skipped}`,
    });
    completeTask(db, taskId, JSON.stringify(result));

    return result;
  } catch (error) {
    failTask(db, taskId, error instanceof Error ? error.message : String(error));
    addTaskLog(db, {
      taskId,
      level: 'error',
      source: 'app',
      message: `Patient import failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    throw error;
  }
}
