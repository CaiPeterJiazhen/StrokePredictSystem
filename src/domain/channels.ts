import type { ReferenceMode } from './types';

export const EEG_CHANNELS_64 = [
  'Fp1',
  'Fpz',
  'Fp2',
  'AF7',
  'AF3',
  'AFz',
  'AF4',
  'AF8',
  'F7',
  'F5',
  'F3',
  'F1',
  'Fz',
  'F2',
  'F4',
  'F6',
  'F8',
  'FT7',
  'FC5',
  'FC3',
  'FC1',
  'FCz',
  'FC2',
  'FC4',
  'FC6',
  'FT8',
  'T7',
  'C5',
  'C3',
  'C1',
  'Cz',
  'C2',
  'C4',
  'C6',
  'T8',
  'TP7',
  'CP5',
  'CP3',
  'CP1',
  'CPz',
  'CP2',
  'CP4',
  'CP6',
  'TP8',
  'P7',
  'P5',
  'P3',
  'P1',
  'Pz',
  'P2',
  'P4',
  'P6',
  'P8',
  'PO7',
  'PO3',
  'POz',
  'PO4',
  'PO8',
  'O1',
  'Oz',
  'O2',
  'Iz',
  'M1',
  'M2',
] as const;

export const AUXILIARY_CHANNELS = ['HEO', 'VEO', 'EKG', 'EMG'] as const;

export const RAW_CHANNELS_68 = [...EEG_CHANNELS_64, ...AUXILIARY_CHANNELS] as const;

const AUXILIARY_CHANNEL_SET = new Set<string>(AUXILIARY_CHANNELS);
const REFERENCE_CHANNELS = ['M1', 'M2'] as const;

const normalizeChannel = (channel: string) => channel.trim().toUpperCase();

export function isAuxiliaryChannel(channel: string): boolean {
  return AUXILIARY_CHANNEL_SET.has(normalizeChannel(channel));
}

export function getReferenceConflict(
  removedChannels: string[],
  referenceMode: ReferenceMode,
): string | null {
  if (referenceMode !== 'm1m2') {
    return null;
  }

  const removedChannelSet = new Set(removedChannels.map(normalizeChannel));
  const conflictedChannels = REFERENCE_CHANNELS.filter((channel) =>
    removedChannelSet.has(channel),
  );

  if (conflictedChannels.length === 0) {
    return null;
  }

  return `M1/M2 重参考冲突：${conflictedChannels.join(
    '、',
  )} 已在移除列表中，请保留参考电极或改用 average。`;
}

export function getInterpolationCandidates(removedChannels: string[]): string[] {
  const removedChannelSet = new Set(removedChannels.map(normalizeChannel));

  return EEG_CHANNELS_64.filter(
    (channel) => !removedChannelSet.has(normalizeChannel(channel)),
  );
}
