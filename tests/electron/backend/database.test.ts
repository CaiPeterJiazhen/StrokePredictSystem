import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../../../src/electron/backend/database.js';
import { addTask } from '../../../src/electron/backend/repositories.js';

const roots: string[] = [];

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stroke-db-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('local database initialization', () => {
  it('creates app directories and required tables', async () => {
    const root = createTempRoot();
    const local = await openLocalDatabase(root);

    const tables =
      local.db
        .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")[0]
        ?.values.flat() ?? [];

    expect(fs.existsSync(path.join(root, 'app.db'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'outputs', 'preprocess'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'outputs', 'features'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'outputs', 'predictions'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'outputs', 'explainability'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'outputs', 'reports'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'logs'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'backups', 'clinical_docs'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'backups', 'clinical_docs', 'pdf'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'backups', 'clinical_docs', 'excel'))).toBe(true);
    expect(tables).toContain('schema_migrations');
    expect(tables).toContain('patients');
    expect(tables).toContain('eeg_files');
    expect(tables).toContain('workflow_status');
    expect(tables).toContain('tasks');
    expect(tables).toContain('task_logs');
    expect(tables).toContain('settings');
    expect(tables).toContain('source_roots');
    expect(tables).toContain('data_assets');
    expect(tables).toContain('clinical_metrics');
    expect(tables).toContain('data_completeness');
    expect(tables).toContain('feature_artifacts');
    expect(tables).toContain('prediction_models');
    expect(tables).toContain('prediction_results');
    expect(tables).toContain('explanation_artifacts');
    expect(tables).toContain('patient_reports');
    expect(tables).toContain('batch_reports');

    local.close();
  });

  it('keeps SQLite foreign key enforcement enabled after opening the database', async () => {
    const root = createTempRoot();
    const local = await openLocalDatabase(root);
    const foreignKeys = local.db.exec('PRAGMA foreign_keys')[0]?.values[0]?.[0];

    expect(foreignKeys).toBe(1);
    expect(() =>
      addTask(local.db, {
        type: 'preprocess',
        patientId: 'missing-patient',
      }),
    ).toThrow();

    local.close();
  });

  it('creates model metadata and prediction provenance columns', async () => {
    const root = createTempRoot();
    const local = await openLocalDatabase(root);

    const modelColumns =
      local.db
        .exec('PRAGMA table_info(prediction_models)')[0]
        ?.values.map((row) => row[1]) ?? [];
    const resultColumns =
      local.db
        .exec('PRAGMA table_info(prediction_results)')[0]
        ?.values.map((row) => row[1]) ?? [];

    expect(modelColumns).toContain('model_family');
    expect(modelColumns).toContain('checkpoint_mode');
    expect(resultColumns).toContain('feature_artifact_ids_json');

    local.close();
  });
});
