import type { EegCondition } from '../../domain/backendTypes.js';

const manualFileTaskSeparator = '::manual-file::';

export type ManualFileTaskCondition = Extract<EegCondition, 'EO' | 'EC'>;

export function manualFileTaskId(taskId: string, condition: ManualFileTaskCondition): string {
  return `${taskId}${manualFileTaskSeparator}${condition}`;
}

export function parseManualFileTaskId(value: string): {
  taskId: string;
  condition: ManualFileTaskCondition | null;
} {
  const [taskId, condition, ...extra] = value.split(manualFileTaskSeparator);

  if (!taskId || extra.length > 0 || (condition !== 'EO' && condition !== 'EC')) {
    return { taskId: value, condition: null };
  }

  return { taskId, condition };
}
