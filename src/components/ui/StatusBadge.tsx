interface StatusBadgeProps {
  value: string | null;
}

function getBadgeClass(value: string | null) {
  if (
    value === '已完成' ||
    value === '已生成' ||
    value === '当前版本' ||
    value === 'Residual <= 1.5' ||
    value === 'info'
  ) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }

  if (value === '处理中' || value === '生成中') {
    return 'border-blue-200 bg-blue-50 text-blue-700';
  }

  if (
    value === '需复核' ||
    value === '草稿' ||
    value === '候选版本' ||
    value === 'warning'
  ) {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }

  if (value === '失败' || value === 'Residual > 1.5' || value === 'error') {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }

  return 'border-slate-200 bg-slate-100 text-slate-700';
}

function getLabel(value: string | null) {
  if (value === null) {
    return '待预测';
  }

  if (value === 'info') {
    return '信息';
  }

  if (value === 'warning') {
    return '警告';
  }

  if (value === 'error') {
    return '错误';
  }

  return value;
}

export function StatusBadge({ value }: StatusBadgeProps) {
  const label = getLabel(value);

  return (
    <span
      className={[
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        getBadgeClass(value),
      ].join(' ')}
    >
      {label}
    </span>
  );
}
