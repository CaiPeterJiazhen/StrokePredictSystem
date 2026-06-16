import type { AppPage } from '../../domain/types';
import { pageLabels } from '../../components/Sidebar';

interface PlaceholderViewProps {
  pageId: AppPage;
}

export function PlaceholderView({ pageId }: PlaceholderViewProps) {
  return (
    <section className="min-h-full bg-slate-100 p-6">
      <div className="rounded-md border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-cyan-700">模块接入</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">
          {pageLabels[pageId]}
        </h1>
        <p className="mt-3 text-sm text-slate-600">模块正在接入</p>
      </div>
    </section>
  );
}
