import { PanelRightClose, PanelRightOpen } from 'lucide-react';

interface TitleBarProps {
  isRightPanelOpen: boolean;
  onToggleRightPanel: () => void;
}

export function TitleBar({
  isRightPanelOpen,
  onToggleRightPanel,
}: TitleBarProps) {
  const ToggleIcon = isRightPanelOpen ? PanelRightClose : PanelRightOpen;

  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950 px-5">
      <div>
        <p className="text-sm text-cyan-200">NeuroPredict</p>
        <h1 className="text-base font-semibold tracking-normal text-slate-50 sm:text-lg">
          NeuroPredict: tACS EEG 康复结局预测系统
        </h1>
      </div>
      <button
        type="button"
        aria-label={isRightPanelOpen ? '隐藏右侧面板' : '显示右侧面板'}
        onClick={onToggleRightPanel}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-700 text-slate-200 transition hover:border-cyan-400 hover:text-cyan-100"
      >
        <ToggleIcon aria-hidden="true" className="h-5 w-5" />
      </button>
    </header>
  );
}
