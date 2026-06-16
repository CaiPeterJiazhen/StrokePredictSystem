# Stroke Predict System Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Gemini's single-file `tacs_eeg.tsx` prototype into a maintainable React + Electron frontend with mock data, routing-like page state, tests, and backend interface placeholders.

**Architecture:** Build a Vite React TypeScript app first, then add an Electron desktop shell. Split the Gemini prototype into domain data, reusable shell components, feature pages, and API boundary modules so later Python/FastAPI, MATLAB/EEGLAB, model inference, and explainability backends can be connected without rewriting the UI.

**Tech Stack:** React, TypeScript, Vite, Tailwind CSS, lucide-react, Vitest, React Testing Library, Electron.

---

## Scope

This plan covers the first implementation stage only:

- Create a frontend project in `F:\CJZProjectFile\StrokePredictSystem`.
- Refactor `C:\Users\HPGZZ\Downloads\tacs_eeg.tsx` into focused source files.
- Preserve the selected patient-workbench product structure.
- Preserve critical EEG preprocessing rules: 68 raw channels, auxiliary channels, user-selected empty electrodes, user-selected bad channels, and M1/M2 reference conflict handling.
- Keep all data as mock data.
- Add typed backend API placeholders but do not call real MATLAB, EEGLAB, Python, or model files.
- Add tests for domain logic and core UI behavior.

Out of scope for this plan:

- Real MATLAB/EEGLAB execution.
- Real PSD/FC feature extraction.
- Real trained model inference.
- Real SHAP/Gradient SHAP computation.
- Installer packaging.

## File Structure

Create or modify these files:

- `package.json`: npm scripts and dependencies.
- `index.html`: Vite HTML entry.
- `vite.config.ts`: Vite and Vitest config.
- `tsconfig.json`: TypeScript app config.
- `tsconfig.node.json`: TypeScript config for Vite/Electron config files.
- `tailwind.config.ts`: Tailwind content and theme extension.
- `postcss.config.js`: Tailwind/PostCSS setup.
- `src/main.tsx`: React mount entry.
- `src/App.tsx`: App-level page selection and shell composition.
- `src/styles.css`: Tailwind directives and global UI defaults.
- `src/domain/types.ts`: Shared patient, preprocessing, model, feature, prediction, and task types.
- `src/domain/channels.ts`: 68-channel definitions, auxiliary-channel helpers, and reference conflict logic.
- `src/domain/mockData.ts`: Mock patients, tasks, logs, models, prediction queues, and explainability data.
- `src/services/apiClient.ts`: Typed placeholder API functions for later backend integration.
- `src/components/AppShell.tsx`: Desktop shell layout.
- `src/components/TitleBar.tsx`: Mock window title bar.
- `src/components/Sidebar.tsx`: Navigation.
- `src/components/RightPanel.tsx`: Task queue and logs.
- `src/components/ui/StatusBadge.tsx`: Status rendering.
- `src/components/ui/FileStatus.tsx`: EO/EC and data availability badge.
- `src/components/ui/ChannelSelector.tsx`: Reusable channel selector for empty electrodes and bad channels.
- `src/features/workbench/PatientWorkbench.tsx`: Patient workbench page.
- `src/features/preprocess/PreprocessWizard.tsx`: EEG preprocessing wizard page.
- `src/features/predict/BatchPredictView.tsx`: Batch prediction page.
- `src/features/interpret/ModelInterpretationView.tsx`: Explainability page.
- `src/features/models/ModelLibraryView.tsx`: Model library page.
- `src/features/features/FeatureGenerationView.tsx`: Feature generation/view page.
- `src/features/archive/FeatureArchiveView.tsx`: Feature archive page.
- `src/features/settings/SettingsView.tsx`: Environment settings page.
- `src/features/placeholder/PlaceholderView.tsx`: Stub for not-yet-built pages.
- `src/electron/main.ts`: Electron main process.
- `src/electron/preload.ts`: Electron preload bridge placeholder.
- `tests/domain/channels.test.ts`: Channel and reference conflict tests.
- `tests/features/preprocess.test.tsx`: Preprocessing wizard behavior tests.
- `tests/features/predict.test.tsx`: Prediction/model compatibility tests.
- `tests/features/workbench.test.tsx`: Workbench rendering tests.

## Task 1: Scaffold The React/Vite Project

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`

- [ ] **Step 1: Create package metadata and scripts**

Create `package.json`:

```json
{
  "name": "stroke-predict-system",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "electron:dev": "concurrently -k \"npm run dev\" \"wait-on http://127.0.0.1:5173 && electron .\"",
    "electron:build": "tsc -p tsconfig.node.json && npm run build"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^latest",
    "electron": "^latest",
    "lucide-react": "^latest",
    "react": "^latest",
    "react-dom": "^latest"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^latest",
    "@testing-library/react": "^latest",
    "@testing-library/user-event": "^latest",
    "@types/node": "^latest",
    "@types/react": "^latest",
    "@types/react-dom": "^latest",
    "autoprefixer": "^latest",
    "concurrently": "^latest",
    "jsdom": "^latest",
    "postcss": "^latest",
    "tailwindcss": "^latest",
    "typescript": "^latest",
    "vite": "^latest",
    "vitest": "^latest",
    "wait-on": "^latest"
  }
}
```

- [ ] **Step 2: Create Vite HTML entry**

Create `index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>tACS EEG Recovery Predictor</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create Vite/Vitest config**

Create `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
});
```

- [ ] **Step 4: Create TypeScript configs**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2020"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src", "tests"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

Create `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts", "src/electron/**/*.ts"]
}
```

- [ ] **Step 5: Create Tailwind config**

Create `tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', './tests/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Microsoft YaHei', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['Consolas', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

Create `postcss.config.js`:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: Create React entry and temporary app**

Create `src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

Create `src/App.tsx`:

```tsx
export default function App() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-100">
      <div>
        <h1 className="text-2xl font-semibold">tACS EEG Recovery Predictor</h1>
        <p className="mt-2 text-sm text-slate-400">Frontend scaffold ready.</p>
      </div>
    </div>
  );
}
```

Create `src/styles.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  background: #0f172a;
}

button,
input,
select,
textarea {
  font: inherit;
}
```

- [ ] **Step 7: Install dependencies**

Run:

```powershell
npm install
```

Expected: npm creates `package-lock.json` and `node_modules`.

- [ ] **Step 8: Run first build**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite complete without errors and create `dist/`.

## Task 2: Add Domain Types And Mock Data

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/channels.ts`
- Create: `src/domain/mockData.ts`
- Create: `tests/setup.ts`
- Create: `tests/domain/channels.test.ts`

- [ ] **Step 1: Add test setup**

Create `tests/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 2: Write failing channel tests**

Create `tests/domain/channels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  AUXILIARY_CHANNELS,
  EEG_CHANNELS_64,
  RAW_CHANNELS_68,
  getReferenceConflict,
  isAuxiliaryChannel,
} from '../../src/domain/channels';

describe('channel definitions', () => {
  it('defines 68 raw channels as 64 EEG channels plus 4 auxiliary channels', () => {
    expect(EEG_CHANNELS_64).toHaveLength(64);
    expect(AUXILIARY_CHANNELS).toEqual(['HEO', 'VEO', 'EKG', 'EMG']);
    expect(RAW_CHANNELS_68).toHaveLength(68);
  });

  it('marks HEO VEO EKG EMG as auxiliary channels', () => {
    expect(isAuxiliaryChannel('HEO')).toBe(true);
    expect(isAuxiliaryChannel('VEO')).toBe(true);
    expect(isAuxiliaryChannel('EKG')).toBe(true);
    expect(isAuxiliaryChannel('EMG')).toBe(true);
    expect(isAuxiliaryChannel('C3')).toBe(false);
  });

  it('detects M1 M2 reference conflict after removal', () => {
    expect(getReferenceConflict(['M1', 'HEO'], 'm1m2')).toContain('M1');
    expect(getReferenceConflict(['M1', 'M2'], 'average')).toBeNull();
    expect(getReferenceConflict(['HEO', 'VEO'], 'm1m2')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```powershell
npm run test -- tests/domain/channels.test.ts
```

Expected: FAIL because `src/domain/channels.ts` does not exist.

- [ ] **Step 4: Add shared types**

Create `src/domain/types.ts`:

```ts
import type { LucideIcon } from 'lucide-react';

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

export type RecoveryClass = '比例恢复' | '恢复不良';
export type ReferenceMode = 'average' | 'm1m2';
export type PreprocessStepType = 'auto' | 'manual' | 'semi-auto';

export interface NavItem {
  id: AppPage;
  label: string;
  icon: LucideIcon;
}

export interface PatientRecord {
  id: string;
  affectedHand: '左侧' | '右侧';
  eo: boolean;
  ec: boolean;
  preprocessStatus: string;
  featureStatus: string;
  task: string;
  prediction: RecoveryClass | '-';
  probability: number | null;
  reportStatus: string;
}

export interface TaskRecord {
  id: number;
  patient: string;
  name: string;
  progress?: number;
  time?: string;
  action?: string;
}

export interface PreprocessStep {
  id: number;
  title: string;
  type: PreprocessStepType;
  description: string;
}

export interface PredictionTaskDefinition {
  id: string;
  name: string;
  labelRule: string;
  description: string;
}

export interface ModelVersion {
  id: string;
  taskId: string;
  name: string;
  version: string;
  inputType: 'EEG-only' | 'EEG+Clinical';
  inputs: string;
  validation: string;
  accuracy: string;
  balancedAccuracy: string;
  rocAuc: string;
  prAuc: string;
}

export interface PredictionQueueRow {
  id: string;
  hasEegFeatures: boolean;
  hasClinical: boolean;
  prediction: RecoveryClass | '未跑模型' | '-';
  probability: number | null;
  modelUsed: string;
  explanationStatus: string;
}

export interface FeatureImportance {
  name: string;
  score: number;
  type: 'clinical' | 'psd' | 'fc';
}
```

- [ ] **Step 5: Add channel helpers**

Create `src/domain/channels.ts`:

```ts
import type { ReferenceMode } from './types';

export const EEG_CHANNELS_64 = [
  'Fp1', 'Fpz', 'Fp2',
  'AF3', 'AF4',
  'F7', 'F5', 'F3', 'F1', 'Fz', 'F2', 'F4', 'F6', 'F8',
  'FT7', 'FC5', 'FC3', 'FC1', 'FCz', 'FC2', 'FC4', 'FC6', 'FT8',
  'T7', 'C5', 'C3', 'C1', 'Cz', 'C2', 'C4', 'C6', 'T8',
  'TP7', 'CP5', 'CP3', 'CP1', 'CPz', 'CP2', 'CP4', 'CP6', 'TP8',
  'P7', 'P5', 'P3', 'P1', 'Pz', 'P2', 'P4', 'P6', 'P8',
  'PO7', 'PO5', 'PO3', 'POz', 'PO4', 'PO6', 'PO8',
  'CB1', 'O1', 'Oz', 'O2', 'CB2',
  'M1', 'M2',
];

export const AUXILIARY_CHANNELS = ['HEO', 'VEO', 'EKG', 'EMG'];

export const RAW_CHANNELS_68 = [...EEG_CHANNELS_64, ...AUXILIARY_CHANNELS];

export function isAuxiliaryChannel(channel: string): boolean {
  return AUXILIARY_CHANNELS.includes(channel);
}

export function getReferenceConflict(
  removedChannels: string[],
  referenceMode: ReferenceMode,
): string | null {
  if (referenceMode !== 'm1m2') {
    return null;
  }

  const removedReferences = ['M1', 'M2'].filter((channel) =>
    removedChannels.includes(channel),
  );

  if (removedReferences.length === 0) {
    return null;
  }

  return `当前选择了 M1/M2 参考，但 ${removedReferences.join('/')} 已在空电极移除列表中。请保留 M1/M2 至重参考后，或改用平均参考。`;
}
```

- [ ] **Step 6: Add mock data**

Create `src/domain/mockData.ts`:

```ts
import {
  Activity,
  Archive,
  BarChart2,
  Box,
  Brain,
  Database,
  FileText,
  PlayCircle,
  Settings,
  Users,
} from 'lucide-react';
import type {
  FeatureImportance,
  ModelVersion,
  NavItem,
  PatientRecord,
  PredictionQueueRow,
  PredictionTaskDefinition,
  PreprocessStep,
  TaskRecord,
} from './types';

export const navItems: NavItem[] = [
  { id: 'workbench', label: '患者工作台', icon: Users },
  { id: 'batch', label: '批次与导入', icon: Database },
  { id: 'preprocess', label: 'EEG 预处理向导', icon: Activity },
  { id: 'feature', label: '特征生成与查看', icon: Brain },
  { id: 'archive', label: '特征档案库', icon: Archive },
  { id: 'models', label: '模型库', icon: Box },
  { id: 'predict', label: '批量预测', icon: PlayCircle },
  { id: 'interpret', label: '模型解释性', icon: BarChart2 },
  { id: 'report', label: '报告导出', icon: FileText },
  { id: 'settings', label: '环境设置', icon: Settings },
];

export const mockPatients: PatientRecord[] = [
  { id: 'sub01', affectedHand: '右侧', eo: true, ec: true, preprocessStatus: '已完成', featureStatus: 'PSD/FC 已完成', task: 'Residual <= 1.5', prediction: '比例恢复', probability: 0.88, reportStatus: '已生成' },
  { id: 'sub05', affectedHand: '左侧', eo: true, ec: true, preprocessStatus: '等待坏段检查', featureStatus: '未开始', task: 'Residual <= 1.5', prediction: '-', probability: null, reportStatus: '-' },
  { id: 'sub07', affectedHand: '右侧', eo: true, ec: true, preprocessStatus: '已完成', featureStatus: 'FC 失败', task: 'Residual <= 1.5', prediction: '-', probability: null, reportStatus: '-' },
  { id: 'sub08', affectedHand: '左侧', eo: true, ec: false, preprocessStatus: '暂停：缺 EC', featureStatus: '-', task: '-', prediction: '-', probability: null, reportStatus: '-' },
];

export const mockTasks: { running: TaskRecord[]; manual: TaskRecord[]; failed: TaskRecord[] } = {
  running: [{ id: 1, patient: 'sub01', name: '患者报告生成', progress: 85, time: '01:12' }],
  manual: [{ id: 2, patient: 'sub05', name: 'EEGLAB 坏段手动剔除', action: '打开 EEGLAB' }],
  failed: [{ id: 3, patient: 'sub07', name: 'wPLI 矩阵计算异常', action: '重试 FC' }],
};

export const mockLogs = [
  "[INFO] 初始化项目：M1-tACS 基线 EEG 比例恢复预测",
  "[WARN] sub08 未发现 EC 数据",
  "[WAIT] sub05 已启动 EEGLAB，等待人工坏段剔除",
  "[ERR] sub07 FC 计算失败：wPLI 输入文件缺失",
  "[INFO] sub01 预测完成：比例恢复，概率 0.88",
];

export const preprocessSteps: PreprocessStep[] = [
  { id: 1, title: '导入原始数据', type: 'auto', description: '读取 CNT 或其他 EEG 文件' },
  { id: 2, title: '导入电极定位', type: 'auto', description: '加载默认 64 导 EEG 电极定位文件' },
  { id: 3, title: '移除空电极/辅助通道', type: 'semi-auto', description: '用户选择 68 通道中需要移除或排除的通道' },
  { id: 4, title: '降采样率', type: 'auto', description: '批量统一采样率' },
  { id: 5, title: '滤波', type: 'auto', description: '高通、低通、陷波滤波' },
  { id: 6, title: '人工去除坏段', type: 'manual', description: '打开 EEGLAB 独立窗口' },
  { id: 7, title: 'ICA / 坏导插值 + ICA', type: 'semi-auto', description: '用户选择坏导后自动插值并运行 ICA' },
  { id: 8, title: '人工去除伪迹', type: 'manual', description: '打开 EEGLAB 选择伪迹成分' },
  { id: 9, title: '重参考与保存', type: 'auto', description: '选择 M1/M2 参考或平均参考' },
];

export const predictionTasks: PredictionTaskDefinition[] = [
  { id: 'proportional-recovery', name: '比例恢复 vs 恢复不良', labelRule: 'Residual <= 1.5', description: '根据基线 EEG 和可选临床信息预测 tACS 后上肢恢复结局。' },
];

export const modelVersions: ModelVersion[] = [
  { id: 'm1', taskId: 'proportional-recovery', name: 'PSD-FC-wPLI Gated CNN', version: 'v0.1-mock', inputType: 'EEG-only', inputs: 'PSD + FC-wPLI', validation: 'LOSO-CV', accuracy: '0.8421', balancedAccuracy: '0.8333', rocAuc: '0.7667', prAuc: '0.6828' },
  { id: 'm2', taskId: 'proportional-recovery', name: 'PSD-FC-wPLI + Clinical', version: 'v0.1-mock-clinical', inputType: 'EEG+Clinical', inputs: 'PSD + FC-wPLI + Baseline Clinical', validation: 'LOSO-CV', accuracy: '待接入', balancedAccuracy: '待接入', rocAuc: '待接入', prAuc: '待接入' },
];

export const predictionQueue: PredictionQueueRow[] = [
  { id: 'sub01', hasEegFeatures: true, hasClinical: true, prediction: '比例恢复', probability: 0.88, modelUsed: 'PSD-FC-wPLI Gated CNN', explanationStatus: '已生成' },
  { id: 'sub05', hasEegFeatures: false, hasClinical: true, prediction: '-', probability: null, modelUsed: '-', explanationStatus: '-' },
  { id: 'sub07', hasEegFeatures: false, hasClinical: false, prediction: '-', probability: null, modelUsed: '-', explanationStatus: '-' },
  { id: 'sub08', hasEegFeatures: false, hasClinical: true, prediction: '-', probability: null, modelUsed: '-', explanationStatus: '-' },
];

export const globalFeatureImportance: FeatureImportance[] = [
  { name: 'C3 Beta Medium PSD', score: 0.28, type: 'psd' },
  { name: 'Cz-Pz wPLI', score: 0.22, type: 'fc' },
  { name: 'Oz Alpha PSD', score: 0.17, type: 'psd' },
  { name: 'FMA-UE baseline', score: 0.14, type: 'clinical' },
];
```

- [ ] **Step 7: Run channel tests**

Run:

```powershell
npm run test -- tests/domain/channels.test.ts
```

Expected: PASS for all three channel tests.

## Task 3: Build App Shell Components

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/AppShell.tsx`
- Create: `src/components/TitleBar.tsx`
- Create: `src/components/Sidebar.tsx`
- Create: `src/components/RightPanel.tsx`
- Create: `src/components/ui/StatusBadge.tsx`
- Create: `src/components/ui/FileStatus.tsx`
- Create: `src/features/placeholder/PlaceholderView.tsx`

- [ ] **Step 1: Add status UI components**

Create `src/components/ui/StatusBadge.tsx`:

```tsx
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

interface StatusBadgeProps {
  text: string;
}

export function StatusBadge({ text }: StatusBadgeProps) {
  if (text === '-') {
    return <span className="text-slate-400">-</span>;
  }

  let className = 'border-slate-200 bg-slate-100 text-slate-600';
  let icon: React.ReactNode = null;

  if (text.includes('完成') || text.includes('生成')) {
    className = 'border-emerald-200 bg-emerald-50 text-emerald-700';
    icon = <CheckCircle2 size={12} className="mr-1" />;
  } else if (text.includes('等待') || text.includes('人工') || text.includes('未开始')) {
    className = 'border-yellow-200 bg-yellow-50 text-yellow-700';
    icon = <AlertTriangle size={12} className="mr-1" />;
  } else if (text.includes('失败') || text.includes('缺')) {
    className = 'border-rose-200 bg-rose-50 text-rose-700';
    icon = <XCircle size={12} className="mr-1" />;
  } else if (text.includes('比例恢复')) {
    className = 'border-blue-200 bg-blue-50 text-blue-700';
  } else if (text.includes('恢复不良')) {
    className = 'border-indigo-200 bg-indigo-50 text-indigo-700';
  }

  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${className}`}>
      {icon}
      {text}
    </span>
  );
}
```

Create `src/components/ui/FileStatus.tsx`:

```tsx
import { CheckCircle2, X } from 'lucide-react';

interface FileStatusProps {
  status: boolean;
  label: string;
}

export function FileStatus({ status, label }: FileStatusProps) {
  return (
    <span
      className={`mr-1 inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] ${
        status
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-rose-200 bg-rose-50 text-rose-700'
      }`}
    >
      {status ? <CheckCircle2 size={10} className="mr-1" /> : <X size={10} className="mr-1" />}
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Add shell components**

Create `src/components/TitleBar.tsx`:

```tsx
import { Brain, Minus, PanelRight, Square, X } from 'lucide-react';

interface TitleBarProps {
  isRightPanelOpen: boolean;
  onToggleRightPanel: () => void;
}

export function TitleBar({ isRightPanelOpen, onToggleRightPanel }: TitleBarProps) {
  return (
    <div className="flex h-8 shrink-0 select-none items-center justify-between border-b border-slate-800 bg-slate-900 px-3 text-slate-400">
      <div className="flex items-center space-x-2">
        <Brain size={14} className="text-blue-400" />
        <span className="text-xs font-medium text-slate-300">NeuroPredict: tACS EEG 康复结局预测系统 v0.1</span>
      </div>
      <div className="flex items-center space-x-3">
        <button
          type="button"
          onClick={onToggleRightPanel}
          className={`transition-colors hover:text-white ${isRightPanelOpen ? 'text-blue-400' : ''}`}
          title={isRightPanelOpen ? '收起侧边面板' : '展开侧边面板'}
        >
          <PanelRight size={14} />
        </button>
        <div className="mx-1 h-3 w-px bg-slate-700" />
        <Minus size={14} />
        <Square size={12} />
        <X size={14} />
      </div>
    </div>
  );
}
```

Create `src/components/Sidebar.tsx`:

```tsx
import { navItems } from '../domain/mockData';
import type { AppPage } from '../domain/types';

interface SidebarProps {
  activePage: AppPage;
  onPageChange: (page: AppPage) => void;
}

export function Sidebar({ activePage, onPageChange }: SidebarProps) {
  const primary = navItems.slice(0, 7);
  const secondary = navItems.slice(7);

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-slate-700 bg-slate-800 text-slate-300">
      <nav className="p-4">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">核心工作流</div>
        <div className="space-y-1">
          {primary.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onPageChange(item.id)}
                className={`flex w-full items-center space-x-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  activePage === item.id ? 'bg-blue-600 text-white shadow-sm' : 'hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <nav className="mt-auto p-4">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">分析与设置</div>
        <div className="space-y-1">
          {secondary.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onPageChange(item.id)}
                className={`flex w-full items-center space-x-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  activePage === item.id ? 'bg-blue-600 text-white shadow-sm' : 'hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
```

Create `src/components/RightPanel.tsx`:

```tsx
import { Activity, AlertTriangle, Clock, RefreshCw, Terminal, X, XCircle } from 'lucide-react';
import { mockLogs, mockTasks } from '../domain/mockData';

interface RightPanelProps {
  onClose: () => void;
}

export function RightPanel({ onClose }: RightPanelProps) {
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-slate-200 bg-slate-50">
      <div className="flex items-center border-b border-slate-200 bg-white">
        <div className="flex flex-1 items-center justify-center space-x-2 border-b-2 border-blue-600 py-2 text-sm font-medium text-blue-600">
          <Activity size={14} />
          <span>任务队列</span>
        </div>
        <button type="button" onClick={onClose} className="border-l border-slate-200 px-3 py-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <section className="mb-4">
          <h3 className="mb-2 flex items-center text-xs font-semibold text-slate-500">
            <Clock size={12} className="mr-1" /> 正在运行
          </h3>
          {mockTasks.running.map((task) => (
            <div key={task.id} className="rounded border border-blue-200 bg-white p-3 shadow-sm">
              <div className="mb-2 text-sm font-medium text-slate-800">[{task.patient}] {task.name}</div>
              <div className="h-1.5 rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${task.progress ?? 0}%` }} />
              </div>
            </div>
          ))}
        </section>
        <section className="mb-4">
          <h3 className="mb-2 flex items-center text-xs font-semibold text-yellow-600">
            <AlertTriangle size={12} className="mr-1" /> 等待人工
          </h3>
          {mockTasks.manual.map((task) => (
            <div key={task.id} className="rounded border border-yellow-200 bg-yellow-50 p-3 text-sm shadow-sm">
              <div className="mb-2 font-medium text-slate-800">[{task.patient}] {task.name}</div>
              <button type="button" className="w-full rounded border border-yellow-300 bg-white py-1.5 text-xs font-medium text-yellow-700">
                {task.action}
              </button>
            </div>
          ))}
        </section>
        <section className="mb-4">
          <h3 className="mb-2 flex items-center text-xs font-semibold text-rose-600">
            <XCircle size={12} className="mr-1" /> 失败可重试
          </h3>
          {mockTasks.failed.map((task) => (
            <div key={task.id} className="rounded border border-rose-200 bg-rose-50 p-3 text-sm shadow-sm">
              <div className="mb-2 font-medium text-slate-800">[{task.patient}] {task.name}</div>
              <button type="button" className="flex w-full items-center justify-center rounded border border-rose-300 bg-white py-1.5 text-xs font-medium text-rose-700">
                <RefreshCw size={12} className="mr-1" /> {task.action}
              </button>
            </div>
          ))}
        </section>
        <section>
          <h3 className="mb-2 flex items-center text-xs font-semibold text-slate-500">
            <Terminal size={12} className="mr-1" /> 引擎日志
          </h3>
          <div className="rounded bg-slate-900 p-2 font-mono text-xs text-slate-200">
            {mockLogs.map((log) => (
              <div key={log} className="py-0.5">{log}</div>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Add shell wrapper and placeholder**

Create `src/components/AppShell.tsx`:

```tsx
import type { ReactNode } from 'react';
import { RightPanel } from './RightPanel';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import type { AppPage } from '../domain/types';

interface AppShellProps {
  activePage: AppPage;
  isRightPanelOpen: boolean;
  onPageChange: (page: AppPage) => void;
  onToggleRightPanel: () => void;
  onCloseRightPanel: () => void;
  children: ReactNode;
}

export function AppShell({
  activePage,
  isRightPanelOpen,
  onPageChange,
  onToggleRightPanel,
  onCloseRightPanel,
  children,
}: AppShellProps) {
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-slate-900 font-sans">
      <TitleBar isRightPanelOpen={isRightPanelOpen} onToggleRightPanel={onToggleRightPanel} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activePage={activePage} onPageChange={onPageChange} />
        {children}
        {isRightPanelOpen ? <RightPanel onClose={onCloseRightPanel} /> : null}
      </div>
    </div>
  );
}
```

Create `src/features/placeholder/PlaceholderView.tsx`:

```tsx
import { Brain } from 'lucide-react';
import { navItems } from '../../domain/mockData';
import type { AppPage } from '../../domain/types';

interface PlaceholderViewProps {
  page: AppPage;
}

export function PlaceholderView({ page }: PlaceholderViewProps) {
  const item = navItems.find((navItem) => navItem.id === page);
  const Icon = item?.icon ?? Brain;

  return (
    <main className="flex h-full flex-1 flex-col items-center justify-center bg-slate-50 text-slate-500">
      <Icon size={48} className="mb-4 text-slate-300" />
      <h2 className="text-lg font-medium text-slate-700">{item?.label ?? '页面'} 视图</h2>
      <p className="mt-2 text-sm">该页面将在后续任务中接入。</p>
    </main>
  );
}
```

- [ ] **Step 4: Wire App shell**

Modify `src/App.tsx`:

```tsx
import { useState } from 'react';
import { AppShell } from './components/AppShell';
import type { AppPage } from './domain/types';
import { PlaceholderView } from './features/placeholder/PlaceholderView';

export default function App() {
  const [activePage, setActivePage] = useState<AppPage>('workbench');
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);

  return (
    <AppShell
      activePage={activePage}
      isRightPanelOpen={isRightPanelOpen}
      onPageChange={setActivePage}
      onToggleRightPanel={() => setIsRightPanelOpen((open) => !open)}
      onCloseRightPanel={() => setIsRightPanelOpen(false)}
    >
      <PlaceholderView page={activePage} />
    </AppShell>
  );
}
```

- [ ] **Step 5: Build after shell split**

Run:

```powershell
npm run build
```

Expected: PASS.

## Task 4: Implement Patient Workbench

**Files:**
- Create: `src/features/workbench/PatientWorkbench.tsx`
- Modify: `src/App.tsx`
- Create: `tests/features/workbench.test.tsx`

- [ ] **Step 1: Write failing workbench test**

Create `tests/features/workbench.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PatientWorkbench } from '../../src/features/workbench/PatientWorkbench';

describe('PatientWorkbench', () => {
  it('renders patient rows and key workflow statuses', () => {
    render(<PatientWorkbench />);

    expect(screen.getByRole('heading', { name: '患者工作台' })).toBeInTheDocument();
    expect(screen.getByText('sub01')).toBeInTheDocument();
    expect(screen.getByText('sub05')).toBeInTheDocument();
    expect(screen.getByText('等待坏段检查')).toBeInTheDocument();
    expect(screen.getByText('FC 失败')).toBeInTheDocument();
    expect(screen.getByText('暂停：缺 EC')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm run test -- tests/features/workbench.test.tsx
```

Expected: FAIL because `PatientWorkbench` does not exist.

- [ ] **Step 3: Add workbench implementation**

Create `src/features/workbench/PatientWorkbench.tsx`:

```tsx
import { Download, FilePlus, FolderOpen, Play } from 'lucide-react';
import { mockPatients } from '../../domain/mockData';
import { FileStatus } from '../../components/ui/FileStatus';
import { StatusBadge } from '../../components/ui/StatusBadge';

export function PatientWorkbench() {
  const preprocessedCount = mockPatients.filter((patient) => patient.preprocessStatus === '已完成').length;
  const featureCount = mockPatients.filter((patient) => patient.featureStatus.includes('已完成')).length;
  const predictionCount = mockPatients.filter((patient) => patient.prediction !== '-').length;
  const manualCount = mockPatients.filter((patient) => patient.preprocessStatus.includes('等待')).length;

  return (
    <main className="flex h-full flex-1 flex-col overflow-hidden bg-slate-50">
      <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">患者工作台</h1>
            <p className="mt-1 text-sm text-slate-500">当前项目：M1-tACS 基线 EEG 比例恢复预测</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="inline-flex items-center rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
              <FilePlus size={15} className="mr-2" /> 导入患者表
            </button>
            <button className="inline-flex items-center rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
              <FolderOpen size={15} className="mr-2" /> 添加 EEG 文件夹
            </button>
            <button className="inline-flex items-center rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white">
              <Play size={15} className="mr-2" /> 批量运行下一步
            </button>
            <button className="inline-flex items-center rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
              <Download size={15} className="mr-2" /> 导出批次汇总
            </button>
          </div>
        </div>
      </header>
      <section className="grid shrink-0 grid-cols-5 gap-3 p-4">
        <MetricCard label="患者总数" value={mockPatients.length} />
        <MetricCard label="已完成预处理" value={preprocessedCount} />
        <MetricCard label="已生成特征" value={featureCount} />
        <MetricCard label="已完成预测" value={predictionCount} />
        <MetricCard label="等待人工 EEGLAB" value={manualCount} tone="warning" />
      </section>
      <section className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        <table className="w-full whitespace-nowrap rounded-xl border border-slate-200 bg-white text-left text-sm text-slate-600 shadow-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">患者 ID</th>
              <th className="px-4 py-3">患侧</th>
              <th className="px-4 py-3">EO/EC</th>
              <th className="px-4 py-3">预处理</th>
              <th className="px-4 py-3">特征</th>
              <th className="px-4 py-3">标签任务</th>
              <th className="px-4 py-3">预测</th>
              <th className="px-4 py-3">概率</th>
              <th className="px-4 py-3">报告</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {mockPatients.map((patient) => (
              <tr key={patient.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{patient.id}</td>
                <td className="px-4 py-3">{patient.affectedHand}</td>
                <td className="px-4 py-3">
                  <FileStatus status={patient.eo} label="EO" />
                  <FileStatus status={patient.ec} label="EC" />
                </td>
                <td className="px-4 py-3"><StatusBadge text={patient.preprocessStatus} /></td>
                <td className="px-4 py-3"><StatusBadge text={patient.featureStatus} /></td>
                <td className="px-4 py-3">{patient.task}</td>
                <td className="px-4 py-3"><StatusBadge text={patient.prediction} /></td>
                <td className="px-4 py-3 font-mono">{patient.probability === null ? '-' : `${(patient.probability * 100).toFixed(1)}%`}</td>
                <td className="px-4 py-3"><StatusBadge text={patient.reportStatus} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function MetricCard({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'warning' }) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${tone === 'warning' ? 'border-yellow-200' : 'border-slate-200'}`}>
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}
```

- [ ] **Step 4: Wire workbench in App**

Modify `src/App.tsx`:

```tsx
import { useState } from 'react';
import { AppShell } from './components/AppShell';
import type { AppPage } from './domain/types';
import { PlaceholderView } from './features/placeholder/PlaceholderView';
import { PatientWorkbench } from './features/workbench/PatientWorkbench';

export default function App() {
  const [activePage, setActivePage] = useState<AppPage>('workbench');
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);

  const page = activePage === 'workbench'
    ? <PatientWorkbench />
    : <PlaceholderView page={activePage} />;

  return (
    <AppShell
      activePage={activePage}
      isRightPanelOpen={isRightPanelOpen}
      onPageChange={setActivePage}
      onToggleRightPanel={() => setIsRightPanelOpen((open) => !open)}
      onCloseRightPanel={() => setIsRightPanelOpen(false)}
    >
      {page}
    </AppShell>
  );
}
```

- [ ] **Step 5: Run workbench test**

Run:

```powershell
npm run test -- tests/features/workbench.test.tsx
```

Expected: PASS.

## Task 5: Implement Preprocessing Wizard

**Files:**
- Create: `src/components/ui/ChannelSelector.tsx`
- Create: `src/features/preprocess/PreprocessWizard.tsx`
- Modify: `src/App.tsx`
- Create: `tests/features/preprocess.test.tsx`

- [ ] **Step 1: Write failing preprocessing tests**

Create `tests/features/preprocess.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PreprocessWizard } from '../../src/features/preprocess/PreprocessWizard';

describe('PreprocessWizard', () => {
  it('shows 68-channel removal controls with auxiliary channels', () => {
    render(<PreprocessWizard />);

    expect(screen.getByRole('heading', { name: 'EEG 预处理向导' })).toBeInTheDocument();
    expect(screen.getByText('68 通道移除选择')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'HEO' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'VEO' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'EKG' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'EMG' })).toBeInTheDocument();
  });

  it('warns when M1 M2 reference conflicts with removed channels', async () => {
    const user = userEvent.setup();
    render(<PreprocessWizard />);

    await user.click(screen.getByLabelText('M1/M2 参考'));

    expect(screen.getByText(/当前选择了 M1\/M2 参考/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm run test -- tests/features/preprocess.test.tsx
```

Expected: FAIL because preprocessing components do not exist.

- [ ] **Step 3: Add reusable channel selector**

Create `src/components/ui/ChannelSelector.tsx`:

```tsx
import { isAuxiliaryChannel } from '../../domain/channels';

interface ChannelSelectorProps {
  channels: string[];
  selected: string[];
  onToggle: (channel: string) => void;
  title: string;
}

export function ChannelSelector({ channels, selected, onToggle, title }: ChannelSelectorProps) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">{title}</h2>
      <div className="grid grid-cols-8 gap-2">
        {channels.map((channel) => {
          const isSelected = selected.includes(channel);
          const auxiliary = isAuxiliaryChannel(channel);
          return (
            <button
              key={channel}
              type="button"
              onClick={() => onToggle(channel)}
              className={`rounded border px-2 py-1.5 text-xs font-medium transition-colors ${
                isSelected
                  ? 'border-yellow-300 bg-yellow-50 text-yellow-800'
                  : auxiliary
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {channel}
            </button>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Add preprocessing wizard implementation**

Create `src/features/preprocess/PreprocessWizard.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, MonitorPlay, Play } from 'lucide-react';
import { ChannelSelector } from '../../components/ui/ChannelSelector';
import { RAW_CHANNELS_68 } from '../../domain/channels';
import { preprocessSteps } from '../../domain/mockData';
import type { ReferenceMode } from '../../domain/types';
import { getReferenceConflict } from '../../domain/channels';

export function PreprocessWizard() {
  const [removedChannels, setRemovedChannels] = useState<string[]>(['M1', 'M2', 'HEO', 'VEO', 'EKG', 'EMG']);
  const [badChannels, setBadChannels] = useState<string[]>(['FC3', 'C3']);
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>('average');

  const conflict = getReferenceConflict(removedChannels, referenceMode);
  const validEegChannels = useMemo(
    () => RAW_CHANNELS_68.filter((channel) => !removedChannels.includes(channel) && !['HEO', 'VEO', 'EKG', 'EMG'].includes(channel)),
    [removedChannels],
  );

  function toggleRemoved(channel: string) {
    setRemovedChannels((current) =>
      current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel],
    );
  }

  function toggleBad(channel: string) {
    setBadChannels((current) =>
      current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel],
    );
  }

  return (
    <main className="flex h-full flex-1 flex-col overflow-hidden bg-slate-50">
      <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-xl font-semibold text-slate-800">EEG 预处理向导</h1>
        <p className="mt-1 text-sm text-slate-500">前端配置流程，实际处理由 MATLAB/EEGLAB 执行。</p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] overflow-hidden">
        <aside className="overflow-y-auto border-r border-slate-200 bg-white p-4">
          <div className="space-y-2">
            {preprocessSteps.map((step) => (
              <div key={step.id} className="rounded border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-800">{step.id}. {step.title}</h2>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{step.type}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{step.description}</p>
              </div>
            ))}
          </div>
        </aside>
        <section className="overflow-y-auto p-5">
          <div className="space-y-5">
            <ChannelSelector
              title="68 通道移除选择"
              channels={RAW_CHANNELS_68}
              selected={removedChannels}
              onToggle={toggleRemoved}
            />
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">ICA 路径</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded border border-slate-200 p-3">
                  <h3 className="text-sm font-semibold">直接 ICA</h3>
                  <p className="mt-1 text-xs text-slate-500">不做坏导插值，直接运行 ICA。</p>
                </div>
                <div className="rounded border border-blue-300 bg-blue-50 p-3">
                  <h3 className="text-sm font-semibold text-blue-900">选择坏导后插值 + ICA</h3>
                  <p className="mt-1 text-xs text-blue-700">用户选择坏导，MATLAB 执行插值和 ICA。</p>
                </div>
              </div>
            </div>
            <ChannelSelector
              title="坏导选择器"
              channels={validEegChannels}
              selected={badChannels}
              onToggle={toggleBad}
            />
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">重参考方式</h2>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="reference"
                    checked={referenceMode === 'average'}
                    onChange={() => setReferenceMode('average')}
                  />
                  平均参考
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    aria-label="M1/M2 参考"
                    type="radio"
                    name="reference"
                    checked={referenceMode === 'm1m2'}
                    onChange={() => setReferenceMode('m1m2')}
                  />
                  M1/M2 参考
                </label>
              </div>
              {conflict ? (
                <div className="mt-3 flex items-start rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
                  <AlertTriangle size={16} className="mr-2 mt-0.5" />
                  {conflict}
                </div>
              ) : (
                <div className="mt-3 flex items-center rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  <CheckCircle2 size={16} className="mr-2" />
                  当前重参考设置与通道移除设置兼容。
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button className="inline-flex items-center rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700">
                <MonitorPlay size={15} className="mr-2" /> 打开 EEGLAB
              </button>
              <button className="inline-flex items-center rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
                <Play size={15} className="mr-2" /> 运行当前步骤
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Wire preprocess page in App**

Modify `src/App.tsx` page selection:

```tsx
import { useState } from 'react';
import { AppShell } from './components/AppShell';
import type { AppPage } from './domain/types';
import { PlaceholderView } from './features/placeholder/PlaceholderView';
import { PreprocessWizard } from './features/preprocess/PreprocessWizard';
import { PatientWorkbench } from './features/workbench/PatientWorkbench';

export default function App() {
  const [activePage, setActivePage] = useState<AppPage>('workbench');
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);

  const page = activePage === 'workbench'
    ? <PatientWorkbench />
    : activePage === 'preprocess'
      ? <PreprocessWizard />
      : <PlaceholderView page={activePage} />;

  return (
    <AppShell
      activePage={activePage}
      isRightPanelOpen={isRightPanelOpen}
      onPageChange={setActivePage}
      onToggleRightPanel={() => setIsRightPanelOpen((open) => !open)}
      onCloseRightPanel={() => setIsRightPanelOpen(false)}
    >
      {page}
    </AppShell>
  );
}
```

- [ ] **Step 6: Run preprocessing tests**

Run:

```powershell
npm run test -- tests/features/preprocess.test.tsx
```

Expected: PASS.

## Task 6: Implement Prediction And Model Library

**Files:**
- Create: `src/features/predict/BatchPredictView.tsx`
- Create: `src/features/models/ModelLibraryView.tsx`
- Modify: `src/App.tsx`
- Create: `tests/features/predict.test.tsx`

- [ ] **Step 1: Write failing prediction test**

Create `tests/features/predict.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BatchPredictView } from '../../src/features/predict/BatchPredictView';

describe('BatchPredictView', () => {
  it('shows label definition bound to available model versions', () => {
    render(<BatchPredictView />);

    expect(screen.getByRole('heading', { name: '批量预测控制台' })).toBeInTheDocument();
    expect(screen.getByText('Residual <= 1.5')).toBeInTheDocument();
    expect(screen.getByText('PSD-FC-wPLI Gated CNN')).toBeInTheDocument();
    expect(screen.getByText('标签定义和模型版本绑定')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm run test -- tests/features/predict.test.tsx
```

Expected: FAIL because `BatchPredictView` does not exist.

- [ ] **Step 3: Add prediction page**

Create `src/features/predict/BatchPredictView.tsx`:

```tsx
import { Lock, Play } from 'lucide-react';
import { modelVersions, predictionQueue, predictionTasks } from '../../domain/mockData';
import { FileStatus } from '../../components/ui/FileStatus';
import { StatusBadge } from '../../components/ui/StatusBadge';

export function BatchPredictView() {
  const selectedTask = predictionTasks[0];
  const availableModels = modelVersions.filter((model) => model.taskId === selectedTask.id);

  return (
    <main className="flex h-full flex-1 flex-col overflow-hidden bg-slate-50">
      <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-xl font-semibold text-slate-800">批量预测控制台</h1>
        <p className="mt-1 text-sm text-slate-500">标签定义和模型版本绑定，避免错用模型。</p>
      </header>
      <section className="grid shrink-0 grid-cols-[1fr_80px_1fr] gap-4 p-5">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <h2 className="text-sm font-semibold text-blue-950">{selectedTask.name}</h2>
          <p className="mt-2 text-sm text-blue-800">{selectedTask.description}</p>
          <div className="mt-3 rounded bg-white px-3 py-2 font-mono text-xs text-blue-900">{selectedTask.labelRule}</div>
        </div>
        <div className="flex items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm">
            <Lock size={16} className="text-indigo-600" />
          </div>
        </div>
        <div className="space-y-3">
          {availableModels.map((model) => (
            <div key={model.id} className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-indigo-900">{model.name}</h2>
              <p className="mt-1 text-xs text-slate-500">{model.version} · {model.inputType} · {model.inputs}</p>
              <p className="mt-2 text-xs text-slate-600">{model.validation}: Acc {model.accuracy}, BAcc {model.balancedAccuracy}, ROC-AUC {model.rocAuc}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="min-h-0 flex-1 overflow-auto px-5 pb-5">
        <table className="w-full rounded-xl border border-slate-200 bg-white text-left text-sm text-slate-600 shadow-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-4 py-3">患者 ID</th>
              <th className="px-4 py-3">数据就绪度</th>
              <th className="px-4 py-3">预测类别</th>
              <th className="px-4 py-3">PR 概率</th>
              <th className="px-4 py-3">模型版本</th>
              <th className="px-4 py-3">解释状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {predictionQueue.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{row.id}</td>
                <td className="px-4 py-3">
                  <FileStatus status={row.hasEegFeatures} label="EEG 特征" />
                  <FileStatus status={row.hasClinical} label="临床基线" />
                </td>
                <td className="px-4 py-3"><StatusBadge text={row.prediction} /></td>
                <td className="px-4 py-3 font-mono">{row.probability === null ? '-' : `${(row.probability * 100).toFixed(1)}%`}</td>
                <td className="px-4 py-3">{row.modelUsed}</td>
                <td className="px-4 py-3"><StatusBadge text={row.explanationStatus} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <footer className="flex shrink-0 justify-between border-t border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-500">标签定义和模型版本绑定</p>
        <button className="inline-flex items-center rounded bg-blue-600 px-5 py-2 text-sm font-medium text-white">
          <Play size={15} className="mr-2" /> 开始批量预测
        </button>
      </footer>
    </main>
  );
}
```

- [ ] **Step 4: Add model library page**

Create `src/features/models/ModelLibraryView.tsx`:

```tsx
import { AlertTriangle, Cpu } from 'lucide-react';
import { modelVersions } from '../../domain/mockData';

export function ModelLibraryView() {
  return (
    <main className="flex h-full flex-1 flex-col overflow-hidden bg-slate-50">
      <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-xl font-semibold text-slate-800">预测模型库</h1>
        <p className="mt-1 text-sm text-slate-500">第一版只管理模型版本，不提供训练入口。</p>
      </header>
      <section className="overflow-y-auto p-6">
        <div className="mb-5 flex items-start rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
          <AlertTriangle size={20} className="mr-3 mt-0.5 shrink-0" />
          <div>
            <h2 className="text-sm font-bold">第一版架构限制</h2>
            <p className="mt-1 text-xs">系统当前版本暂不提供面向用户的模型重新训练入口。</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-5">
          {modelVersions.map((model) => (
            <article key={model.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-indigo-100 p-2 text-indigo-700"><Cpu size={20} /></div>
                  <div>
                    <h2 className="text-base font-semibold text-slate-800">{model.name}</h2>
                    <p className="text-xs text-slate-500">{model.version}</p>
                  </div>
                </div>
                <span className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">推理可用</span>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-slate-500">标签定义</dt><dd className="font-medium text-slate-800">Residual &lt;= 1.5</dd></div>
                <div><dt className="text-xs text-slate-500">输入</dt><dd className="font-medium text-slate-800">{model.inputType}</dd></div>
                <div><dt className="text-xs text-slate-500">Accuracy</dt><dd>{model.accuracy}</dd></div>
                <div><dt className="text-xs text-slate-500">Balanced Accuracy</dt><dd>{model.balancedAccuracy}</dd></div>
                <div><dt className="text-xs text-slate-500">ROC-AUC</dt><dd>{model.rocAuc}</dd></div>
                <div><dt className="text-xs text-slate-500">PR-AUC</dt><dd>{model.prAuc}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Wire prediction and models in App**

Modify `src/App.tsx` page selection to include these imports and branches:

```tsx
import { ModelLibraryView } from './features/models/ModelLibraryView';
import { BatchPredictView } from './features/predict/BatchPredictView';
```

Use this page expression:

```tsx
const page = activePage === 'workbench'
  ? <PatientWorkbench />
  : activePage === 'preprocess'
    ? <PreprocessWizard />
    : activePage === 'predict'
      ? <BatchPredictView />
      : activePage === 'models'
        ? <ModelLibraryView />
        : <PlaceholderView page={activePage} />;
```

- [ ] **Step 6: Run prediction test**

Run:

```powershell
npm run test -- tests/features/predict.test.tsx
```

Expected: PASS.

## Task 7: Add Remaining Mock Pages

**Files:**
- Create: `src/features/interpret/ModelInterpretationView.tsx`
- Create: `src/features/features/FeatureGenerationView.tsx`
- Create: `src/features/archive/FeatureArchiveView.tsx`
- Create: `src/features/settings/SettingsView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add explainability page**

Create `src/features/interpret/ModelInterpretationView.tsx`:

```tsx
import { BarChart2, Download, FileText, TrendingUp } from 'lucide-react';
import { globalFeatureImportance, predictionQueue } from '../../domain/mockData';

export function ModelInterpretationView() {
  const selectedPatient = predictionQueue.find((row) => row.prediction !== '-') ?? predictionQueue[0];

  return (
    <main className="flex h-full flex-1 flex-col overflow-hidden bg-slate-50">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div>
          <h1 className="flex items-center text-xl font-semibold text-slate-800">
            <TrendingUp size={22} className="mr-2 text-indigo-600" /> 模型解释性
          </h1>
          <p className="mt-1 text-sm text-slate-500">全局解释 + 患者级解释。</p>
        </div>
        <div className="flex gap-2">
          <button className="inline-flex items-center rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
            <Download size={15} className="mr-2" /> 导出解释图
          </button>
          <button className="inline-flex items-center rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white">
            <FileText size={15} className="mr-2" /> 加入患者报告
          </button>
        </div>
      </header>
      <section className="grid min-h-0 flex-1 grid-cols-2 gap-5 overflow-y-auto p-5">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center text-sm font-semibold text-slate-800">
            <BarChart2 size={16} className="mr-2 text-blue-600" /> 全局特征重要性
          </h2>
          <div className="space-y-4">
            {globalFeatureImportance.map((feature) => (
              <div key={feature.name}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-medium text-slate-700">{feature.name}</span>
                  <span className="font-mono text-slate-500">{Math.round(feature.score * 100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-blue-500" style={{ width: `${feature.score * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">患者级解释：{selectedPatient.id}</h2>
          <div className="rounded-xl bg-gradient-to-r from-indigo-900 to-slate-900 p-5 text-white">
            <p className="text-xs uppercase tracking-wide text-indigo-200">预测结局</p>
            <div className="mt-2 text-2xl font-bold">{selectedPatient.prediction}</div>
            <div className="mt-2 font-mono text-3xl font-extrabold">{selectedPatient.probability ? `${Math.round(selectedPatient.probability * 100)}%` : '-'}</div>
          </div>
          <div className="mt-5 rounded border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800">EO/EC 状态贡献</h3>
            <div className="mt-3 flex h-6 overflow-hidden rounded bg-slate-100 text-xs text-white">
              <div className="flex items-center justify-center bg-indigo-500" style={{ width: '60%' }}>EO 60%</div>
              <div className="flex items-center justify-center bg-emerald-500" style={{ width: '40%' }}>EC 40%</div>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Add feature generation page**

Create `src/features/features/FeatureGenerationView.tsx`:

```tsx
import { Brain, CheckCircle2 } from 'lucide-react';

export function FeatureGenerationView() {
  return (
    <main className="flex h-full flex-1 flex-col overflow-hidden bg-slate-50">
      <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="flex items-center text-xl font-semibold text-slate-800">
          <Brain size={22} className="mr-2 text-blue-600" /> 特征生成与查看
        </h1>
        <p className="mt-1 text-sm text-slate-500">PSD/FC 生成状态、热图、矩阵和 EO/EC 对比。</p>
      </header>
      <section className="grid flex-1 grid-cols-2 gap-5 overflow-y-auto p-5">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center text-sm font-semibold text-slate-800">
            <CheckCircle2 size={16} className="mr-2 text-emerald-500" /> 生成状态与来源
          </h2>
          <dl className="space-y-3 text-sm">
            <div><dt className="text-xs text-slate-500">PSD 参数</dt><dd className="font-mono">Welch, 0.5-45 Hz, 0.5 Hz resolution</dd></div>
            <div><dt className="text-xs text-slate-500">FC 参数</dt><dd className="font-mono">wPLI, 6 bands</dd></div>
            <div><dt className="text-xs text-slate-500">输出路径</dt><dd className="font-mono">data/features/</dd></div>
          </dl>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">PSD 通道-频段热图预览</h2>
          <div className="grid grid-cols-6 gap-1">
            {Array.from({ length: 36 }).map((_, index) => (
              <div
                key={index}
                className="h-8 rounded"
                style={{ backgroundColor: `rgba(37, 99, 235, ${0.15 + (index % 6) * 0.12})` }}
              />
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Add archive and settings pages**

Create `src/features/archive/FeatureArchiveView.tsx`:

```tsx
import { Archive, FolderOpen } from 'lucide-react';

export function FeatureArchiveView() {
  const rows = ['sub01', 'sub05', 'sub07', 'sub08'];

  return (
    <main className="flex h-full flex-1 flex-col overflow-hidden bg-slate-50">
      <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="flex items-center text-xl font-semibold text-slate-800">
          <Archive size={22} className="mr-2 text-blue-600" /> 特征档案库
        </h1>
      </header>
      <section className="overflow-auto p-5">
        <table className="w-full rounded-xl border border-slate-200 bg-white text-left text-sm shadow-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr><th className="px-5 py-3">归档对象</th><th className="px-5 py-3">内容</th><th className="px-5 py-3">导出</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((id) => (
              <tr key={id}>
                <td className="px-5 py-4 font-medium text-slate-900"><FolderOpen size={14} className="mr-2 inline text-blue-500" />{id}</td>
                <td className="px-5 py-4">特征文件、参数、日志、预览图</td>
                <td className="px-5 py-4">特征摘要报告</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
```

Create `src/features/settings/SettingsView.tsx`:

```tsx
import { Settings, Terminal } from 'lucide-react';

export function SettingsView() {
  return (
    <main className="flex h-full flex-1 flex-col overflow-y-auto bg-slate-50 p-6">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <h1 className="flex items-center text-xl font-semibold text-slate-800">
          <Settings size={22} className="mr-2 text-blue-600" /> 环境与依赖设置
        </h1>
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 flex items-center border-b border-slate-100 pb-2 text-sm font-semibold text-slate-800">
            <Terminal size={16} className="mr-2 text-indigo-600" /> 执行引擎路径配置
          </h2>
          <div className="space-y-4">
            <SettingInput label="MATLAB 可执行文件路径" value="F:\\Matlab2020a\\bin\\matlab.exe" />
            <SettingInput label="EEGLAB 路径" value="F:\\MatlabToolbox\\eeglab" />
            <SettingInput label="Python/FastAPI 后端路径" value="backend\\app.py" />
            <SettingInput label="模型库目录" value="models\\" />
          </div>
        </section>
      </div>
    </main>
  );
}

function SettingInput({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-700">{label}</span>
      <input readOnly value={value} className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-600" />
    </label>
  );
}
```

- [ ] **Step 4: Wire remaining pages in App**

Modify `src/App.tsx` imports:

```tsx
import { FeatureArchiveView } from './features/archive/FeatureArchiveView';
import { FeatureGenerationView } from './features/features/FeatureGenerationView';
import { ModelInterpretationView } from './features/interpret/ModelInterpretationView';
import { SettingsView } from './features/settings/SettingsView';
```

Use this page expression:

```tsx
const page = activePage === 'workbench'
  ? <PatientWorkbench />
  : activePage === 'preprocess'
    ? <PreprocessWizard />
    : activePage === 'predict'
      ? <BatchPredictView />
      : activePage === 'models'
        ? <ModelLibraryView />
        : activePage === 'interpret'
          ? <ModelInterpretationView />
          : activePage === 'feature'
            ? <FeatureGenerationView />
            : activePage === 'archive'
              ? <FeatureArchiveView />
              : activePage === 'settings'
                ? <SettingsView />
                : <PlaceholderView page={activePage} />;
```

- [ ] **Step 5: Run full tests and build**

Run:

```powershell
npm run test
npm run build
```

Expected: tests pass and build succeeds.

## Task 8: Add Electron Shell And API Placeholders

**Files:**
- Create: `src/electron/main.ts`
- Create: `src/electron/preload.ts`
- Create: `src/services/apiClient.ts`
- Modify: `package.json`

- [ ] **Step 1: Add API placeholder module**

Create `src/services/apiClient.ts`:

```ts
import type { ReferenceMode } from '../domain/types';

export interface PreprocessRequest {
  patientId: string;
  rawFilePaths: string[];
  removedChannels: string[];
  badChannels: string[];
  referenceMode: ReferenceMode;
}

export interface ApiResult {
  ok: boolean;
  message: string;
}

export async function startPreprocessing(request: PreprocessRequest): Promise<ApiResult> {
  return {
    ok: true,
    message: `Mock preprocessing queued for ${request.patientId}. Backend integration pending.`,
  };
}

export async function runBatchPrediction(taskId: string, modelId: string): Promise<ApiResult> {
  return {
    ok: true,
    message: `Mock prediction queued for task ${taskId} with model ${modelId}. Backend integration pending.`,
  };
}
```

- [ ] **Step 2: Add Electron main process**

Create `src/electron/main.ts`:

```ts
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

const isDev = !app.isPackaged;

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    title: 'tACS EEG Recovery Predictor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    await window.loadURL('http://127.0.0.1:5173');
  } else {
    await window.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
```

Create `src/electron/preload.ts`:

```ts
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('strokePredictSystem', {
  version: '0.1.0',
});
```

- [ ] **Step 3: Add Electron TypeScript build script**

Modify `package.json` scripts:

```json
{
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "electron:compile": "tsc -p tsconfig.node.json --outDir dist-electron",
    "electron:dev": "concurrently -k \"npm run dev\" \"wait-on http://127.0.0.1:5173 && npm run electron:compile && electron .\"",
    "electron:build": "npm run electron:compile && npm run build"
  }
}
```

- [ ] **Step 4: Verify Electron compile**

Run:

```powershell
npm run electron:build
```

Expected: Electron TypeScript compiles and Vite build succeeds.

## Task 9: Run Browser Verification And Fix Layout Issues

**Files:**
- Modify only files created in Tasks 1-8 if verification exposes visual or interaction problems.

- [ ] **Step 1: Start dev server**

Run:

```powershell
npm run dev
```

Expected: Vite prints a local URL, usually `http://127.0.0.1:5173/`.

- [ ] **Step 2: Open the app in browser**

Open:

```text
http://127.0.0.1:5173/
```

Expected: patient workbench opens by default.

- [ ] **Step 3: Verify core navigation**

Click these sidebar items:

```text
患者工作台
EEG 预处理向导
批量预测
模型解释性
模型库
特征生成与查看
特征档案库
环境设置
```

Expected: each page renders without console errors and the right task/log panel remains usable.

- [ ] **Step 4: Verify preprocessing interactions**

On `EEG 预处理向导`:

```text
1. Confirm HEO, VEO, EKG, EMG are visible.
2. Confirm M1 and M2 start selected in the removal selector.
3. Select M1/M2 reference.
4. Confirm the conflict warning appears.
5. Deselect M1 and M2.
6. Confirm the conflict warning disappears.
```

Expected: warning state matches the selected channels and reference mode.

- [ ] **Step 5: Verify responsive desktop bounds**

Set browser viewport to:

```text
1440 x 900
1180 x 760
```

Expected: no primary controls are clipped; table scrolling remains contained; right panel does not overlap main content.

- [ ] **Step 6: Run final automated checks**

Run:

```powershell
npm run test
npm run build
npm run electron:build
```

Expected: all commands pass.

## Task 10: Document Frontend Handoff

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-05-28-stroke-predict-system-design.md`

- [ ] **Step 1: Create README with local commands**

Create `README.md`:

```md
# StrokePredictSystem

Windows local research software for batch EEG preprocessing workflow management and post-tACS stroke recovery prediction.

## Current Stage

This repository currently contains the React/Electron frontend prototype with mock data and backend interface placeholders.

## Run Frontend

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Run Tests

```powershell
npm run test
npm run build
```

## Desktop Shell

```powershell
npm run electron:dev
```

## Design Rules To Preserve

- Patient is the core object.
- Raw import presents 68 channels: 64 EEG channels plus HEO, VEO, EKG, and EMG.
- Empty electrode removal requires user selection.
- Bad-channel interpolation requires user selection.
- M1/M2 reference must conflict with removing M1/M2 before re-reference.
- Version 1 manages model versions but does not train models.
```

- [ ] **Step 2: Add implementation note to design spec**

Append to `docs/superpowers/specs/2026-05-28-stroke-predict-system-design.md`:

```md

## Implementation Status

Frontend implementation is planned in `docs/superpowers/plans/2026-05-28-stroke-predict-system-frontend.md`.
The first implementation stage uses mock data and API placeholders only.
```

- [ ] **Step 3: Run final file scan**

Run:

```powershell
Get-ChildItem -Force
```

Expected: project contains source files, docs, package metadata, and no accidental temporary debug files.

## Self-Review Checklist

- Spec coverage:
  - Patient workbench: Tasks 3 and 4.
  - React/Electron structure: Tasks 1 and 8.
  - Preprocessing 68-channel and reference conflict rules: Tasks 2 and 5.
  - Prediction task/model binding: Task 6.
  - Feature archive, feature viewer, explainability, settings: Task 7.
  - Mock backend API boundary: Task 8.
  - Verification: Task 9.
  - Documentation: Task 10.
- Placeholder scan: no task says TBD, TODO, or "implement later"; all planned files have concrete contents or commands.
- Type consistency:
  - `ReferenceMode` is `average | m1m2` everywhere.
  - `AppPage` values match `navItems` and `App.tsx` branches.
  - `PatientRecord`, `ModelVersion`, and `PredictionQueueRow` are defined before use.
