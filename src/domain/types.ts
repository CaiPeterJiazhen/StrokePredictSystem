export type AppPage =
  | 'workbench'
  | 'batch'
  | 'preprocess'
  | 'feature'
  | 'archive'
  | 'models'
  | 'predict'
  | 'interpret'
  | 'report'
  | 'settings';

export type ReferenceMode = 'average' | 'm1m2';
export type InputType = 'EEG-only' | 'EEG+Clinical';
export type PredictionClass = 'Residual <= 1.5' | 'Residual > 1.5';
export type Sex = '男' | '女';
export type AffectedHand = '左手' | '右手' | '双手';
export type WorkflowStatus = '未开始' | '待处理' | '处理中' | '已完成' | '需复核' | '失败';
export type ReportStatus = '未生成' | '草稿' | '已生成' | '已签发';
export type ModelStatus = '当前版本' | '候选版本' | '归档版本';
export type QueuePriority = '常规' | '加急';
export type ExplanationStatus = '未生成' | '生成中' | '已生成' | '需复核';
export type LogLevel = 'info' | 'warning' | 'error';

export interface NavItem {
  id: AppPage;
  label: string;
  description: string;
}

export interface PatientRecord {
  id: string;
  name: string;
  age: number;
  sex: Sex;
  diagnosis: string;
  affectedHand: AffectedHand;
  eo: boolean;
  ec: boolean;
  preprocessStatus: WorkflowStatus;
  featureStatus: WorkflowStatus;
  task: string;
  prediction: PredictionClass | null;
  probability: number | null;
  probabilityLabel: 'Residual <= 1.5';
  reportStatus: ReportStatus;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  patientId: string;
  patientName: string;
  task: string;
  stage: string;
  status: WorkflowStatus;
  assignee: string;
  updatedAt: string;
}

export interface PreprocessStep {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  referenceMode?: ReferenceMode;
}

export interface PredictionTaskDefinition {
  id: string;
  taskId: string;
  name: string;
  target: string;
  labelDefinition: 'Residual <= 1.5';
  positiveLabel: string;
  horizon: string;
  description: string;
}

export interface ModelVersion {
  id: string;
  taskId: string;
  name: string;
  version: string;
  inputType: InputType;
  inputs: string[];
  validation: string;
  accuracy: number;
  balancedAccuracy: number;
  rocAuc: number;
  prAuc: number;
  status: ModelStatus;
  releasedAt: string;
}

export interface PredictionQueueRow {
  id: string;
  patientId: string;
  patientName: string;
  taskId: string;
  priority: QueuePriority;
  status: WorkflowStatus;
  hasEegFeatures: boolean;
  hasClinical: boolean;
  prediction: PredictionClass | null;
  probability: number | null;
  probabilityLabel: 'Residual <= 1.5';
  modelUsed: string;
  explanationStatus: ExplanationStatus;
  submittedAt: string;
}

export interface FeatureImportance {
  id: string;
  modelId: string;
  feature: string;
  label: string;
  category: string;
  importance: number;
  direction: '正向' | '负向';
}

export interface MockLog {
  id: string;
  time: string;
  level: LogLevel;
  source: string;
  message: string;
}
