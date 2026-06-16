import { useId } from 'react';

interface ChannelSelectorProps {
  actionLabel: string;
  auxiliaryPredicate?: (channel: string) => boolean;
  channels: readonly string[];
  description: string;
  onToggle: (channel: string) => void;
  selected: readonly string[];
  title: string;
}

export function ChannelSelector({
  actionLabel,
  auxiliaryPredicate,
  channels,
  description,
  onToggle,
  selected,
  title,
}: ChannelSelectorProps) {
  const descriptionId = useId();
  const selectedChannelSet = new Set(selected);

  return (
    <fieldset
      aria-describedby={descriptionId}
      className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
    >
      <legend className="px-1 text-sm font-semibold text-slate-950">
        {title}
      </legend>
      <p id={descriptionId} className="mt-1 text-xs leading-5 text-slate-500">
        {description}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
        {channels.map((channel) => {
          const isAuxiliary = auxiliaryPredicate?.(channel) ?? false;

          return (
            <label
              key={channel}
              className={[
                'flex min-h-10 items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-sm transition',
                selectedChannelSet.has(channel)
                  ? 'border-cyan-300 bg-cyan-50 text-cyan-900'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-cyan-200 hover:bg-white',
              ].join(' ')}
            >
              <span className="flex min-w-0 items-center gap-2">
                <input
                  aria-label={`${actionLabel} ${channel}`}
                  checked={selectedChannelSet.has(channel)}
                  className="h-4 w-4 shrink-0 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                  onChange={() => onToggle(channel)}
                  type="checkbox"
                />
                <span className="truncate font-medium">{channel}</span>
              </span>
              {isAuxiliary ? (
                <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                  辅助
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
