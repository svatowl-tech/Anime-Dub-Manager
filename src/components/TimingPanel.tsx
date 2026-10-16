import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Episode, Track, SubtitleLine, RoleAssignment } from '../types';
import { 
  AudioClip, 
  TimingIssue, 
  TimingIssueType, 
  MissingSubtitleMarker, 
  StitchedFixMarker, 
  VoiceCollisionMarker, 
  TimingPanelProps,
  ClipAlignmentDiff
} from '../types/timing';
import { ipcSafe } from '../lib/ipcSafe';
import { resolveLocalPath } from '../lib/webFileSystem';
import { prepareQATracksForTiming } from '../lib/qaTimingHelper';
import { loadTimingProjectForEpisode, applyTimingPassportToClips, TimingProjectData } from '../lib/qa/timingSyncService';

// Timing Services & Engines
import { detectSpeechIntervals } from '../services/timing/AudioVADEngine';
import { 
  isSubtitleForCharacter, 
  cleanDubberNick, 
  formatSeconds, 
  parseTimeToSeconds 
} from '../services/timing/SubtitleAlignmentService';
import { applySmartPauseDiffs } from '../services/timing/SmartPauseBreathingEngine';
import { detectVoiceCollisions } from '../services/timing/TimingCollisionResolver';
import { createTimingPassport, saveTimingPassportToDisk } from '../services/timing/TimingPassportSerializer';

// Hooks
import { useTimingAudioEngine } from '../hooks/timing/useTimingAudioEngine';
import { useTimingClips } from '../hooks/timing/useTimingClips';
import { useTimingShortcuts } from '../hooks/timing/useTimingShortcuts';

// Modular UI Components
import { TimingToolbar } from './timing/TimingToolbar';
import { TimingTrackHeaderList } from './timing/TimingTrackHeaderList';
import { TimingWaveformCanvas } from './timing/TimingWaveformCanvas';
import { TimingSubtitleDrawer } from './timing/TimingSubtitleDrawer';
import { SmartPauseModal } from './timing/SmartPauseModal';
import { TimingSettingsModal, TimingSettings, DEFAULT_TIMING_SETTINGS } from './TimingSettingsModal';
import { ExportModal } from './ExportModal';

// Re-export types so external files (like timingSyncService.ts) remain 100% compatible
export type { 
  AudioClip, 
  TimingIssue, 
  TimingIssueType, 
  MissingSubtitleMarker, 
  StitchedFixMarker, 
  VoiceCollisionMarker, 
  TimingPanelProps 
};

// Color palette for tracks
const TRACK_PALETTE = [
  '#6366f1', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', 
  '#8b5cf6', '#14b8a6', '#f97316', '#06b6d4', '#e11d48'
];

export default function TimingPanel({ currentEpisode, onRefresh, onNavigate }: TimingPanelProps) {
  // Core Data
  const [tracks, setTracks] = useState<Track[]>([]);
  const [subLines, setSubLines] = useState<SubtitleLine[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [zoomPixelsPerSec, setZoomPixelsPerSec] = useState<number>(45);

  // Modals & Panels
  const [isSmartPauseModalOpen, setIsSmartPauseModalOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isSubtitlesOpen, setIsSubtitlesOpen] = useState<boolean>(true);

  // Settings
  const [timingSettings, setTimingSettings] = useState<TimingSettings>(() => {
    try {
      const saved = localStorage.getItem('timing_settings');
      if (saved) return { ...DEFAULT_TIMING_SETTINGS, ...JSON.parse(saved) };
    } catch (e) {}
    return DEFAULT_TIMING_SETTINGS;
  });

  // Audio Engine Hook
  const {
    isPlaying,
    currentTime,
    duration,
    audioBuffers,
    volumeByTrack,
    mutedByTrack,
    soloByTrack,
    play,
    pause,
    togglePlay,
    seek,
    setTrackVolume,
    toggleTrackMute,
    toggleTrackSolo,
    loadAudioBuffer,
    setDuration
  } = useTimingAudioEngine();

  // Clips Management Hook
  const {
    clipsByTrack,
    selectedClipId,
    setSelectedClipId,
    setAllClips,
    splitClip,
    trimClipStart,
    trimClipEnd,
    nudgeClip,
    deleteClip,
    undo,
    redo,
    canUndo,
    canRedo
  } = useTimingClips();

  // Assigned colors per track
  const trackColors = useMemo(() => {
    const map: Record<string, string> = {};
    tracks.forEach((t, i) => {
      map[t.id] = TRACK_PALETTE[i % TRACK_PALETTE.length];
    });
    return map;
  }, [tracks]);

  // Flattened clips
  const allClipsList = useMemo(() => {
    const list: AudioClip[] = [];
    Object.values(clipsByTrack).forEach(arr => arr.forEach(c => list.push(c)));
    return list;
  }, [clipsByTrack]);

  // Load episode tracks & subtitles
  const loadEpisodeData = useCallback(async () => {
    if (!currentEpisode) return;
    setIsLoading(true);

    try {
      // 1. Prepare QA tracks
      const epTracks = await prepareQATracksForTiming(currentEpisode);
      setTracks(epTracks);

      if (epTracks.length > 0) {
        setSelectedTrackId(prev => prev || epTracks[0].id);
      }

      // 2. Load subtitles using correct IPC handler (get-raw-subtitles)
      let parsedSubs: SubtitleLine[] = [];
      if (currentEpisode.subPath) {
        try {
          let subData: any = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
          if (!subData) {
            try { subData = await ipcSafe.invoke('get-subtitles', currentEpisode.subPath); } catch (e) {}
          }

          if (subData && Array.isArray(subData.lines)) {
            parsedSubs = subData.lines.map((l: any, idx: number) => ({
              id: l.id || idx,
              start: l.start || '00:00:00.00',
              end: l.end || '00:00:00.00',
              startSec: l.startSec !== undefined ? l.startSec : parseTimeToSeconds(l.start),
              endSec: l.endSec !== undefined ? l.endSec : parseTimeToSeconds(l.end),
              style: l.style || 'Default',
              name: l.name || '',
              text: l.text || '',
              rawLineIndex: l.rawLineIndex || idx
            }));
            setSubLines(parsedSubs);

            // Expand timeline duration to encompass all subtitles
            let maxSubEnd = 0;
            parsedSubs.forEach(l => { if (l.endSec > maxSubEnd) maxSubEnd = l.endSec; });
            if (maxSubEnd > 0) {
              setDuration(prev => Math.max(prev, maxSubEnd + 10));
            }
          }
        } catch (subErr) {
          console.warn('Subtitles could not be loaded via IPC:', subErr);
        }
      }

      // 3. Populate initial clips from subtitles immediately so user sees tracks right away
      if (epTracks.length > 0 && parsedSubs.length > 0) {
        const initialClips: Record<string, AudioClip[]> = {};

        epTracks.forEach(track => {
          const trackDubber = cleanDubberNick(track.participant || track.dubberName || '');
          const trackChar = track.character || track.characterName || '';

          const matchedSubs = parsedSubs.filter(sub =>
            isSubtitleForCharacter(sub.name, trackChar, trackDubber, currentEpisode?.assignments)
          );

          initialClips[track.id] = matchedSubs.map((sub, idx) => ({
            id: `clip_${track.id}_sub_${sub.id || idx}`,
            trackId: track.id,
            dubberName: trackDubber,
            characterName: trackChar,
            clipStartSec: sub.startSec,
            durationSec: Math.max(0.1, Number((sub.endSec - sub.startSec).toFixed(3))),
            sourceStartSec: sub.startSec,
            sourceEndSec: sub.endSec,
            rawSourceStartSec: sub.startSec,
            rawSourceEndSec: sub.endSec,
            text: sub.text,
            targetSubStartSec: sub.startSec,
            targetSubEndSec: sub.endSec,
            volumePercent: 100,
            offsetSec: 0,
            timingIssue: null
          }));
        });

        // 4. Try loading existing saved timing project / QA gaps
        try {
          const passport = await loadTimingProjectForEpisode(currentEpisode, epTracks);
          if (passport) {
            const enriched = applyTimingPassportToClips(initialClips, passport);
            setAllClips(enriched);
          } else {
            setAllClips(initialClips);
          }
        } catch (e) {
          setAllClips(initialClips);
        }
      }

      // 5. Load Audio Buffers for tracks asynchronously
      for (const t of epTracks) {
        const filePath = t.files?.[0]?.path || t.filePath;
        if (filePath) {
          const resolvedUrl = await resolveLocalPath(filePath);
          if (resolvedUrl) {
            loadAudioBuffer(t.id, resolvedUrl);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load episode data for timing:', err);
      toast.error('Ошибка загрузки данных эпизода для тайминга');
    } finally {
      setIsLoading(false);
    }
  }, [currentEpisode, setDuration, setAllClips, loadAudioBuffer]);

  useEffect(() => {
    loadEpisodeData();
  }, [loadEpisodeData]);

  // When audio buffers arrive, refine clips with exact audio waveform boundaries
  useEffect(() => {
    if (tracks.length === 0 || Object.keys(audioBuffers).length === 0) return;

    tracks.forEach(track => {
      const buf = audioBuffers[track.id];
      if (!buf) return;

      // Update duration if audio is longer than current timeline
      if (buf.duration > 0) {
        setDuration(prev => Math.max(prev, buf.duration));
      }

      // If track has audio buffer, detect speech intervals
      const intervals = detectSpeechIntervals(buf, {
        minSilenceDurationSec: timingSettings.minSilenceDurationSec,
        leadInPaddingSec: timingSettings.leadInPaddingSec,
        leadOutPaddingSec: timingSettings.leadOutPaddingSec,
        manualThresholdDb: timingSettings.silenceThresholdDb
      });

      if (intervals.length === 0) return;

      const trackDubber = cleanDubberNick(track.participant || track.dubberName || '');
      const trackChar = track.character || track.characterName || '';

      const refinedClips: AudioClip[] = intervals.map((interval, idx) => {
        const matchedSub = subLines.find(sub => {
          return (
            sub.startSec <= interval.endSec + 0.3 &&
            sub.endSec >= interval.startSec - 0.3 &&
            isSubtitleForCharacter(sub.name, trackChar, trackDubber, currentEpisode?.assignments)
          );
        });

        return {
          id: `clip_${track.id}_vad_${idx}`,
          trackId: track.id,
          dubberName: trackDubber,
          characterName: trackChar,
          clipStartSec: interval.startSec,
          durationSec: interval.durationSec,
          sourceStartSec: interval.startSec,
          sourceEndSec: interval.endSec,
          rawSourceStartSec: interval.startSec,
          rawSourceEndSec: interval.endSec,
          text: matchedSub?.text || '',
          targetSubStartSec: matchedSub?.startSec,
          targetSubEndSec: matchedSub?.endSec,
          volumePercent: 100,
          offsetSec: 0,
          timingIssue: null
        };
      });

      // Update clips for this track
      setAllClips({
        ...clipsByTrack,
        [track.id]: refinedClips
      });
    });
  }, [audioBuffers, tracks, timingSettings, subLines, currentEpisode, setDuration, setAllClips]);

  // Keyboard Shortcuts Integration
  useTimingShortcuts({
    onTogglePlay: togglePlay,
    onSplit: () => {
      if (selectedClipId && selectedTrackId) {
        splitClip(selectedTrackId, selectedClipId, currentTime, audioBuffers[selectedTrackId]);
      }
    },
    onDelete: () => {
      if (selectedClipId && selectedTrackId) {
        deleteClip(selectedTrackId, selectedClipId);
        setSelectedClipId(null);
      }
    },
    onNudge: (deltaSec) => {
      if (selectedClipId && selectedTrackId) {
        nudgeClip(selectedTrackId, selectedClipId, deltaSec);
      }
    },
    onUndo: undo,
    onRedo: redo,
    onRewind: () => seek(0)
  });

  // Zoom handlers
  const handleZoomIn = () => setZoomPixelsPerSec(z => Math.min(300, z * 1.3));
  const handleZoomOut = () => setZoomPixelsPerSec(z => Math.max(8, z / 1.3));
  const handleZoomFit = () => {
    if (duration > 0) {
      const containerW = window.innerWidth - 300;
      setZoomPixelsPerSec(Math.max(10, containerW / duration));
    }
  };

  // Smart Pause Application
  const handleApplySmartPauseDiffs = (diffs: ClipAlignmentDiff[]) => {
    const updated = applySmartPauseDiffs(clipsByTrack, diffs);
    setAllClips(updated);
    toast.success(`Успешно подогнано ${diffs.length} реплик с компенсацией пауз!`);
  };

  // Export Timing Passport
  const handleExportPassport = async () => {
    const collisions = detectVoiceCollisions(clipsByTrack);
    const passport = createTimingPassport(currentEpisode, clipsByTrack, collisions);
    const ok = await saveTimingPassportToDisk(currentEpisode, passport);
    if (ok) {
      toast.success('Паспорт тайминга успешно сохранен в проект!');
    } else {
      toast.error('Не удалось сохранить паспорт тайминга');
    }
  };

  return (
    <div className="flex flex-col h-full bg-neutral-950 text-neutral-100 select-none overflow-hidden">
      {/* Top Toolbar */}
      <TimingToolbar
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        zoomPixelsPerSec={zoomPixelsPerSec}
        canUndo={canUndo}
        canRedo={canRedo}
        hasSelectedClip={!!selectedClipId}
        onTogglePlay={togglePlay}
        onRewind={() => seek(0)}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomFit={handleZoomFit}
        onUndo={undo}
        onRedo={redo}
        onSplit={() => {
          if (selectedClipId && selectedTrackId) {
            splitClip(selectedTrackId, selectedClipId, currentTime, audioBuffers[selectedTrackId]);
          }
        }}
        onDelete={() => {
          if (selectedClipId && selectedTrackId) {
            deleteClip(selectedTrackId, selectedClipId);
            setSelectedClipId(null);
          }
        }}
        onOpenSmartPause={() => setIsSmartPauseModalOpen(true)}
        onExportPassport={handleExportPassport}
        onExportAudio={() => setIsExportModalOpen(true)}
      />

      {/* Main Studio Viewport */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Tracks channel strips */}
        <TimingTrackHeaderList
          tracks={tracks}
          clipsByTrack={clipsByTrack}
          volumeByTrack={volumeByTrack}
          mutedByTrack={mutedByTrack}
          soloByTrack={soloByTrack}
          selectedTrackId={selectedTrackId}
          trackColors={trackColors}
          onSelectTrack={setSelectedTrackId}
          onToggleMute={toggleTrackMute}
          onToggleSolo={toggleTrackSolo}
          onChangeVolume={setTrackVolume}
        />

        {/* Center: Multi-track Waveform Timeline */}
        <TimingWaveformCanvas
          tracks={tracks}
          clipsByTrack={clipsByTrack}
          audioBuffers={audioBuffers}
          currentTime={currentTime}
          duration={duration}
          zoomPixelsPerSec={zoomPixelsPerSec}
          selectedClipId={selectedClipId}
          trackColors={trackColors}
          onSeek={seek}
          onSelectClip={(clipId, trackId) => {
            setSelectedClipId(clipId);
            setSelectedTrackId(trackId);
          }}
          onTrimClipStart={trimClipStart}
          onTrimClipEnd={trimClipEnd}
          onNudgeClip={nudgeClip}
          onSplitClip={(trackId, clipId, splitTime) => {
            splitClip(trackId, clipId, splitTime, audioBuffers[trackId]);
          }}
        />
      </div>

      {/* Bottom: Subtitles Drawer */}
      <TimingSubtitleDrawer
        subLines={subLines}
        allClips={allClipsList}
        currentTime={currentTime}
        isOpen={isSubtitlesOpen}
        onToggleOpen={() => setIsSubtitlesOpen(o => !o)}
        onSeek={seek}
      />

      {/* Smart Pause Breathing Modal */}
      <SmartPauseModal
        isOpen={isSmartPauseModalOpen}
        clipsByTrack={clipsByTrack}
        subLines={subLines}
        audioBuffers={audioBuffers}
        onClose={() => setIsSmartPauseModalOpen(false)}
        onApply={handleApplySmartPauseDiffs}
      />

      {/* Timing Settings Modal */}
      {isSettingsModalOpen && (
        <TimingSettingsModal
          isOpen={isSettingsModalOpen}
          settings={timingSettings}
          onClose={() => setIsSettingsModalOpen(false)}
          onSave={(newSettings) => {
            setTimingSettings(newSettings);
            localStorage.setItem('timing_settings', JSON.stringify(newSettings));
            setIsSettingsModalOpen(false);
          }}
        />
      )}

      {/* Audio Export Modal */}
      {isExportModalOpen && currentEpisode && (
        <ExportModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          episode={currentEpisode}
          role="SOUND_ENGINEER"
          onExport={async (targetDir, skipConversion, smartExport) => {
            try {
              toast.info('Запуск экспорта сведенного аудио...');
              await ipcSafe.invoke('export-sound-engineer-files', {
                episode: currentEpisode,
                targetDir,
                skipConversion,
                smartExport
              });
              toast.success('Экспорт успешно завершен!');
            } catch (err) {
              console.error('Export error:', err);
              toast.error('Ошибка экспорта аудио');
            }
          }}
        />
      )}
    </div>
  );
}
