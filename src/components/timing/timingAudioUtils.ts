export type {
  NoiseCalibration,
  AudioClip,
  OriginalStemsState,
  TimingIssueType,
  TimingIssue,
  MissingSubtitleMarker,
  StitchedFixMarker,
  VoiceCollisionMarker,
} from './timing.types';

export {
  calculateTextSimilarity,
  isFixTrack,
  parseTimeToSeconds,
  formatSeconds,
  normalizeName,
  cleanDubberNick,
  isSubtitleForCharacter,
  getPlayableAudioUrl,
} from './timing.utils';

export {
  analyzeTrackAudioNoiseFloor,
  detectClipSpeechBounds,
  detectSpeechIntervals,
  detectSpeechOnsetOffsetSec,
  findOriginalVocalsAnchorForSub,
  getAudioBufferRoomNoiseDb,
  ensureOriginalVocalsBuffer,
  enforceSameTrackMinGapService,
  findOriginalVocalsBurstForPhysics,
  findQuietValley40msInBuffer,
  detectInternalPausesInClip,
  checkOriginalVocalsPauseInWindow,
  applyPhysicsSmartSyncOnMap,
  applyAdaptiveInternalPauseRuleOnTrack,
  applySoftTimeFitToTrackClips,
  rescueCrossRoleMissingSubtitles,
} from './timing.service';

export * from './timing.rules';
