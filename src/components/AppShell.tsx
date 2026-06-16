import type { ReactNode } from 'react';
import { RightPanel } from './RightPanel';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import type { AppPage } from '../domain/types';

interface AppShellProps {
  activePage: AppPage;
  children: ReactNode;
  isRightPanelOpen: boolean;
  onPageChange: (page: AppPage) => void;
  onToggleRightPanel: () => void;
}

export function AppShell({
  activePage,
  children,
  isRightPanelOpen,
  onPageChange,
  onToggleRightPanel,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <TitleBar
        isRightPanelOpen={isRightPanelOpen}
        onToggleRightPanel={onToggleRightPanel}
      />
      <div className="flex min-h-[calc(100vh-64px)]">
        <Sidebar activePage={activePage} onPageChange={onPageChange} />
        <main className="min-w-0 flex-1 overflow-x-auto bg-slate-100 text-slate-950">
          {children}
        </main>
        {isRightPanelOpen ? <RightPanel /> : null}
      </div>
    </div>
  );
}
