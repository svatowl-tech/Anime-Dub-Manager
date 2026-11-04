import { AudioClip, IntentionalOverlapMoment } from './timing.types';
import { TimingSettings, DEFAULT_TIMING_SETTINGS } from '../TimingSettingsModal';

export function isValidAudioClip(value: unknown): value is AudioClip {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.trackId === 'string' &&
    typeof candidate.clipStartSec === 'number' &&
    Number.isFinite(candidate.clipStartSec) &&
    typeof candidate.durationSec === 'number' &&
    Number.isFinite(candidate.durationSec)
  );
}

export function isValidIntentionalOverlapMoment(value: unknown): value is IntentionalOverlapMoment {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.startSec === 'number' &&
    typeof candidate.endSec === 'number' &&
    Array.isArray(candidate.tracks)
  );
}

export interface SavedTimingStatePayload {
  audioClips?: Record<string, AudioClip[]>;
  isSilenceRemoved?: boolean;
  isFixesStitched?: boolean;
  isTimingAnalyzed?: boolean;
  intentionalOverlaps?: IntentionalOverlapMoment[];
  mutedTracks?: string[];
  isAutoNormalize?: boolean;
  zoomLevel?: number;
  trackHeightMode?: 'standard' | 'compact' | 'fit';
  originalStems?: Record<string, unknown>;
  savedAt?: string;
}

export interface SavedTimingStateResponse {
  success: boolean;
  found: boolean;
  filePath?: string;
  savedAt?: string;
  state?: SavedTimingStatePayload;
}

export function isValidSavedTimingStateResponse(value: unknown): value is SavedTimingStateResponse {
  if (!value || typeof value !== 'object') return false;
  const res = value as Record<string, unknown>;
  return res.success === true && res.found === true && typeof res.state === 'object' && res.state !== null;
}

export function sanitizeTimingSettings(raw: unknown): TimingSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TIMING_SETTINGS };
  }
  return {
    ...DEFAULT_TIMING_SETTINGS,
    ...(raw as Partial<TimingSettings>)
  };
}
