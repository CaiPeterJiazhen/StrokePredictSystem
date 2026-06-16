interface FileStatusProps {
  available: boolean;
  label: 'EO' | 'EC' | 'EEG' | '临床数据';
}

export function FileStatus({ available, label }: FileStatusProps) {
  return (
    <span
      className={[
        'inline-flex min-w-20 justify-center rounded-md border px-2 py-1 text-xs font-medium',
        available
          ? 'border-cyan-200 bg-cyan-50 text-cyan-700'
          : 'border-slate-200 bg-slate-50 text-slate-500',
      ].join(' ')}
    >
      {label} {available ? '可用' : '缺失'}
    </span>
  );
}
