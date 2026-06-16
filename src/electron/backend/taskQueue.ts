import type { Database } from 'sql.js';
import type { ApiResult, BackendTask, StartNextQueuedTaskResult } from '../../domain/backendTypes.js';
import type { AppPaths } from './appPaths.js';
import { runExplainabilityExecution, type ExplainabilityExecutor } from './explainability.js';
import { runFeatureGenerationExecution, type FeatureGeneratorExecutor } from './featureArtifacts.js';
import { runPredictionExecution, type PredictionExecutor } from './predictions.js';
import { runPreprocessMatlabExecution, type MatlabExecutor } from './preprocessTasks.js';

type SqlParam = string | number | null;
type SqlRow = Record<string, unknown>;

export interface StartNextQueuedTaskOptions {
  executeMatlab?: MatlabExecutor;
  executeFeatureGenerator?: FeatureGeneratorExecutor;
  executePrediction?: PredictionExecutor;
  executeExplainability?: ExplainabilityExecutor;
}

function queryOne<T extends SqlRow>(db: Database, sql: string, params: SqlParam[] = []): T | null {
  const stmt = db.prepare(sql);

  try {
    stmt.bind(params);
    if (!stmt.step()) return null;
    return stmt.getAsObject() as T;
  } finally {
    stmt.free();
  }
}

function nextQueuedTask(db: Database): Pick<BackendTask, 'id' | 'type'> | null {
  const row = queryOne<{ id: string; type: BackendTask['type'] }>(
    db,
    `SELECT id, type
     FROM tasks
     WHERE status = 'queued'
     ORDER BY CASE priority WHEN 'high' THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1`,
  );

  return row ? { id: row.id, type: row.type } : null;
}

function withTask(
  task: Pick<BackendTask, 'id' | 'type'>,
  result: ApiResult,
): StartNextQueuedTaskResult {
  return {
    ...result,
    taskId: task.id,
    taskType: task.type,
  };
}

export async function startNextQueuedTask(
  db: Database,
  paths: AppPaths,
  options: StartNextQueuedTaskOptions = {},
): Promise<StartNextQueuedTaskResult> {
  const task = nextQueuedTask(db);

  if (!task) {
    return {
      ok: false,
      message: '没有待执行任务。',
      taskId: null,
      taskType: null,
    };
  }

  if (task.type === 'preprocess') {
    return withTask(task, await runPreprocessMatlabExecution(db, paths, task.id, options.executeMatlab));
  }

  if (task.type === 'feature_generation') {
    return withTask(task, await runFeatureGenerationExecution(db, paths, task.id, options.executeFeatureGenerator));
  }

  if (task.type === 'prediction') {
    return withTask(task, await runPredictionExecution(db, paths, task.id, options.executePrediction));
  }

  if (task.type === 'explainability') {
    return withTask(task, await runExplainabilityExecution(db, paths, task.id, options.executeExplainability));
  }

  return {
    ok: false,
    message: `暂不支持从统一队列运行 ${task.type} 任务。`,
    taskId: task.id,
    taskType: task.type,
  };
}
