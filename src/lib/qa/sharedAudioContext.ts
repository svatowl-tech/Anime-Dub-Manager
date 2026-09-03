/**
 * Shared Singleton AudioContext Manager
 * 
 * Reuses a single AudioContext across QAPanel, TrackWaveform, and MissingLinesDetector.
 * Browsers impose a strict limit (6) on simultaneous AudioContexts.
 * Creating new AudioContexts on every track or playback action leads to suspended/closed audio
 * contexts, causing audio tracks and phrases to go completely silent.
 */

let sharedCtx: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtxClass) return null;

  if (!sharedCtx || sharedCtx.state === 'closed') {
    try {
      sharedCtx = new AudioCtxClass();
    } catch (e) {
      console.warn('Failed to create shared AudioContext:', e);
      return null;
    }
  }

  if (sharedCtx.state === 'suspended') {
    sharedCtx.resume().catch(() => {});
  }

  return sharedCtx;
}

export function ensureAudioContextResumed(): void {
  if (sharedCtx && sharedCtx.state === 'suspended') {
    sharedCtx.resume().catch(() => {});
  }
}
