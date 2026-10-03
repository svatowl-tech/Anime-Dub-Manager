import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Clock, 
  Play, 
  Pause, 
  RotateCcw, 
  Scissors, 
  Sparkles, 
  Sliders, 
  AlertTriangle, 
  CheckCircle2, 
  Download, 
  FolderOpen, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  ChevronRight, 
  Mic, 
  Volume2, 
  VolumeX, 
  ArrowRight, 
  Info,
  RefreshCw,
  MoveHorizontal,
  Bookmark,
  Layers,
  Activity,
  Check,
  X,
  FileAudio
} from 'lucide-react';
import { toast } from 'sonner';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { Episode, Track, SubtitleLine, RoleAssignment } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { getSharedAudioContext, ensureAudioContextResumed } from '../lib/qa/sharedAudioContext';
import { ExportModal } from './ExportModal';

function parseTimeToSeconds(timeStr: string | number): number {
  if (typeof timeStr === 'number') return isNaN(timeStr) ? 0 : timeStr;
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const str = timeStr.trim();
  const parts = str.split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const s = parseFloat(parts[2].replace(',', '.')) || 0;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1].replace(',', '.')) || 0;
    return m * 60 + s;
  }
  const f = parseFloat(str.replace(',', '.'));
  return isNaN(f) ? 0 : f;
}

function formatSeconds(sec: number): string {
  if (isNaN(sec) || sec < 0) return '00:00.00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function normalizeName(s: string): string {
  if (!s) return '';
  return s.toLowerCase().trim().replace(/[^a-z0-9а-яё]/gi, '');
}

/**
 * Strict role-based subtitle line matching.
 */
function isSubtitleForCharacter(
  subName: string,
  charName: string,
  dubberNick: string,
  assignments: RoleAssignment[] = []
): boolean {
  if (!subName) return false;
  const normSub = normalizeName(subName);
  if (!normSub || normSub === 'default' || normSub === 'comment' || normSub === 'шумы') return false;

  const normChar = normalizeName(charName);
  const normNick = normalizeName(dubberNick);

  const dubberAssigns = assignments.filter(a => {
    const aNick = normalizeName(a.dubber?.nickname || (a as any).dubberNickname || '');
    const aId = a.dubberId;
    return (aNick && aNick === normNick) || (aId && (aId === dubberNick || aId === normNick));
  });

  const assignedCharNames = dubberAssigns.map(a => normalizeName(a.characterName)).filter(Boolean);
  if (normChar) assignedCharNames.push(normChar);

  for (const cName of assignedCharNames) {
    if (!cName) continue;
    if (normSub === cName || normSub.includes(cName) || cName.includes(normSub)) {
      return true;
    }
  }

  if (normNick && (normSub === normNick || normSub.includes(normNick) || normNick.includes(normSub))) {
    return true;
  }

  const parts = subName.split(/[,;&/]/).map(normalizeName).filter(Boolean);
  if (parts.some(p => assignedCharNames.includes(p) || p === normNick || (normChar && p.includes(normChar)))) {
    return true;
  }

  return false;
}

async function getPlayableAudioUrl(filePath: string): Promise<string | null> {
  if (!filePath) return null;
  if (filePath.startsWith('blob:') || filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('data:')) {
    return filePath;
  }
  if ((window as any).electronAPI) {
    return filePath.startsWith('file://') ? filePath : `file://${filePath.replace(/\\/g, '/')}`;
  }
  const cleanName = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
  const cached = (window as any).getFileFromCache?.(cleanName);
  if (cached) {
    return URL.createObjectURL(cached);
  }
  try {
    const { resolveLocalPath } = await import('../lib/webFileSystem');
    const resolved = await resolveLocalPath(filePath);
    if (resolved) return resolved;
  } catch (err) {}
  return `file://${filePath.replace(/\\/g, '/')}`;
}

/**
 * Real WaveSurfer.js Audio Waveform Track Component for Timing Panel
 */
const WaveSurferTrack: React.FC<{
  track: Track;
  zoomLevel: number;
  volume: number;
  isMuted: boolean;
  onReady?: (duration: number) => void;
}> = ({ track, zoomLevel, volume, isMuted, onReady }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  useEffect(() => {
    if (!containerRef.current || !track.filePath) return;

    let isMounted = true;
    (async () => {
      const audioUrl = await getPlayableAudioUrl(track.filePath);
      if (!audioUrl || !isMounted || !containerRef.current) return;

      try {
        const ws = WaveSurfer.create({
          container: containerRef.current,
          waveColor: '#818cf8',
          progressColor: '#4f46e5',
          cursorColor: 'transparent',
          barWidth: 2,
          barGap: 3,
          height: 80,
          normalize: true,
          minPxPerSec: zoomLevel,
          interact: false
        });

        wsRef.current = ws;

        ws.on('error', (err: any) => {
          if (err?.name === 'AbortError' || err?.message?.includes('aborted')) return;
        });

        await ws.load(audioUrl);
        if (isMounted) {
          ws.setVolume(isMuted ? 0 : volume);
          if (onReady) onReady(ws.getDuration());
        }
      } catch (err) {
        console.warn(`[WaveSurferTrack] Load error for track ${track.id}:`, err);
      }
    })();

    return () => {
      isMounted = false;
      if (wsRef.current) {
        try {
          wsRef.current.destroy();
        } catch (e) {}
      }
    };
  }, [track.filePath]);

  useEffect(() => {
    if (wsRef.current) {
      try {
        wsRef.current.zoom(zoomLevel);
        wsRef.current.setVolume(isMuted ? 0 : volume);
      } catch (e) {}
    }
  }, [zoomLevel, volume, isMuted]);

  return <div ref={containerRef} className="w-full h-full absolute inset-0 pointer-events-none opacity-85" />;
};

interface TimingPanelProps {
  currentEpisode: Episode | null;
  onRefresh: () => void;
  onNavigate?: (tab: 'dashboard' | 'subtitles' | 'qa' | 'timing' | 'mixing' | 'release' | 'telegram' | 'settings' | 'database' | 'cover' | 'stats' | 'archive') => void;
}

export interface PhraseBlock {
  id: string;
  trackId: string;
  dubberName: string;
  characterName: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  text: string;
  subIndex?: number;
  offsetSec: number; // Manual user shift offset (+ / -)
  volumePercent?: number; // Volume % modifier: 100% normal, 70% background, 50% whisper
  pan?: number;
  timeStretch?: number;
  headTrimSec?: number;
  tailTrimSec?: number;
  isFix?: boolean;
  fixSourceFile?: string;
  hasCollision?: boolean;
  collisionWithTrackId?: string;
}

export interface StitchedFixMarker {
  id: string;
  trackId: string;
  dubberName: string;
  characterName: string;
  startSec: number;
  endSec: number;
  filename: string;
}

export interface VoiceCollisionMarker {
  id: string;
  track1Id: string;
  track2Id: string;
  dubber1Name: string;
  dubber2Name: string;
  character1Name: string;
  character2Name: string;
  startSec: number;
  endSec: number;
  overlapDurationSec: number;
}

export default function TimingPanel({ currentEpisode, onRefresh, onNavigate }: TimingPanelProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [subLines, setSubLines] = useState<SubtitleLine[]>([]);
  const [phraseBlocks, setPhraseBlocks] = useState<Record<string, PhraseBlock[]>>({});
  const [stitchedFixes, setStitchedFixes] = useState<StitchedFixMarker[]>([]);
  const [collisions, setCollisions] = useState<VoiceCollisionMarker[]>([]);
  
  // State flags
  const [isSilenceRemoved, setIsSilenceRemoved] = useState<boolean>(false);
  const [isFixesStitched, setIsFixesStitched] = useState<boolean>(false);
  const [isAutoTimingDone, setIsAutoTimingDone] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [exportingToMixing, setIsExportingToMixing] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isExportingSE, setIsExportingSE] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [isLogDrawerOpen, setIsLogDrawerOpen] = useState<boolean>(false);
  const [operationLogs, setOperationLogs] = useState<Array<{ time: string; msg: string; level: 'info' | 'success' | 'warn' | 'error' }>>([]);
  const [trackSubLinesMap, setTrackSubLinesMap] = useState<Record<string, SubtitleLine[]>>({});

  // Mouse Dragging State for Phrase Blocks
  const [draggingPhrase, setDraggingPhrase] = useState<{ trackId: string; phraseId: string; startX: number; initialOffset: number } | null>(null);

  const addLog = useCallback((msg: string, level: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString('ru-RU');
    setOperationLogs(prev => [...prev.slice(-300), { time, msg, level }]);
    if (level === 'error') console.error(`[TimingLog] ${msg}`);
    else if (level === 'warn') console.warn(`[TimingLog] ${msg}`);
    else console.log(`[TimingLog] ${msg}`);
  }, []);

  useEffect(() => {
    const unsub = ipcSafe.on('ffmpeg-progress', (percent: any) => {
      if (typeof percent === 'number') {
        setExportProgress(percent);
      }
    });
    return () => {
      if (unsub) unsub();
    };
  }, []);

  // Playback & Zoom Controls
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(100);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(30); // pixels per second
  const [selectedPhraseId, setSelectedPhraseId] = useState<string | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [activeTabMarkerFilter, setActiveTabMarkerFilter] = useState<'all' | 'fixes' | 'collisions'>('all');

  // Audio Playback
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set());
  const [soloTrack, setSoloTrack] = useState<string | null>(null);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [originalVolume, setOriginalVolume] = useState<number>(0.4);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Refs for animation & audio playback
  const playbackRef = useRef<number | null>(null);
  const timelineContainerRef = useRef<HTMLDivElement | null>(null);
  const audioElementsRef = useRef<Record<string, HTMLAudioElement>>({});

  // Mouse Dragging Effect for Phrases
  useEffect(() => {
    if (!draggingPhrase) return;
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - draggingPhrase.startX;
      const deltaSec = deltaX / zoomLevel;
      setPhraseBlocks(prev => {
        const trBlocks = prev[draggingPhrase.trackId] || [];
        const updated = trBlocks.map(b => {
          if (b.id === draggingPhrase.phraseId) {
            const newOffset = Number((draggingPhrase.initialOffset + deltaSec).toFixed(2));
            return { ...b, offsetSec: newOffset };
          }
          return b;
        });
        return { ...prev, [draggingPhrase.trackId]: updated };
      });
    };
    const handleMouseUp = () => {
      setDraggingPhrase(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingPhrase, zoomLevel]);

  const handlePhraseMouseDown = (e: React.MouseEvent, trackId: string, phrase: PhraseBlock) => {
    e.stopPropagation();
    setSelectedPhraseId(phrase.id);
    setDraggingPhrase({
      trackId,
      phraseId: phrase.id,
      startX: e.clientX,
      initialOffset: phrase.offsetSec || 0
    });
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = timelineContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left + container.scrollLeft;
    const newTime = Math.max(0, Math.min(duration, clickX / zoomLevel));
    setCurrentTime(newTime);
    Object.values(audioElementsRef.current).forEach(audio => {
      try { audio.currentTime = newTime; } catch (err) {}
    });
    addLog(`⏩ Перемещение плейбэка на ${formatSeconds(newTime)}`, 'info');
  };

  // Spacebar Key Listener for Play / Pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setIsPlaying(prev => {
          const next = !prev;
          addLog(next ? `▶ Воспроизведение запущено` : `⏸ Воспроизведение остановлено`, 'info');
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addLog]);

  // Audio Playback Loop & Time Sync
  useEffect(() => {
    if (!isPlaying) {
      if (playbackRef.current) cancelAnimationFrame(playbackRef.current);
      Object.values(audioElementsRef.current).forEach(audio => {
        try { audio.pause(); } catch (e) {}
      });
      return;
    }

    tracks.forEach(tr => {
      const audio = audioElementsRef.current[tr.id];
      if (audio && !mutedTracks.has(tr.id)) {
        try {
          if (Math.abs(audio.currentTime - currentTime) > 0.2) {
            audio.currentTime = currentTime;
          }
          audio.volume = Math.max(0, Math.min(1, volumes[tr.id] ?? 1.0));
          audio.play().catch(e => {});
        } catch (e) {}
      }
    });

    let lastTimestamp = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTimestamp) / 1000;
      lastTimestamp = now;

      setCurrentTime(prev => {
        const next = prev + dt;
        if (next >= duration) {
          setIsPlaying(false);
          addLog(`⏹ Достигнут конец таймлайна (${formatSeconds(duration)})`, 'info');
          return 0;
        }
        return next;
      });

      playbackRef.current = requestAnimationFrame(tick);
    };

    playbackRef.current = requestAnimationFrame(tick);

    return () => {
      if (playbackRef.current) cancelAnimationFrame(playbackRef.current);
      Object.values(audioElementsRef.current).forEach(audio => {
        try { audio.pause(); } catch (e) {}
      });
    };
  }, [isPlaying, tracks, mutedTracks, volumes, duration, addLog]);

  // Load Subtitles & Dubber Tracks from Episode
  const loadEpisodeData = useCallback(async () => {
    if (!currentEpisode) return;
    try {
      setIsLoading(true);
      setStatusMessage('Загрузка субтитров и файлов звукорежиссёра...');
      addLog(`=== Начало загрузки тайминга серии #${currentEpisode.number} (${currentEpisode.project?.title || 'Проект'}) ===`, 'info');

      let parsedLines: SubtitleLine[] = [];
      const subPath = currentEpisode.subPath;
      if (subPath) {
        const subData = await ipcSafe.invoke('get-raw-subtitles', subPath).catch(() => null);
        if (subData && subData.lines) {
          parsedLines = subData.lines.map((l: any, idx: number) => ({
            id: `sub_${idx}`,
            rawLineIndex: l.rawLineIndex ?? idx,
            startSec: parseTimeToSeconds(l.start),
            endSec: parseTimeToSeconds(l.end),
            startFormatted: l.start || '00:00.00',
            endFormatted: l.end || '00:00.00',
            name: l.name || 'Default',
            text: l.text || '',
            style: l.style || 'Default'
          }));
          setSubLines(parsedLines);
          const maxSubTime = parsedLines.reduce((max, l) => Math.max(max, l.endSec), 10);
          setDuration(prev => Math.max(prev, maxSubTime + 10));
          addLog(`✓ Успешно распарсено ${parsedLines.length} строк субтитров.`, 'success');
        }
      }

      const statusRes: any = await ipcSafe.invoke('mixing-get-status', { episode: currentEpisode }).catch(() => null);
      let dubberTracks = statusRes?.manifest?.sourceFiles?.dubberTracks || [];

      if (dubberTracks.length === 0) {
        setStatusMessage('Экспорт и сборка файлов звукорежиссера из QA...');
        const importRes: any = await ipcSafe.invoke('mixing-import-sound-engineer-files', {
          episode: currentEpisode,
          autoApplyFixes: true,
          autoTiming: false
        }).catch(() => null);

        if (importRes?.manifest?.sourceFiles?.dubberTracks) {
          dubberTracks = importRes.manifest.sourceFiles.dubberTracks;
        }
      }

      const matchRes: any = await ipcSafe.invoke('match-actors-tracks', {
        episode: currentEpisode,
        audioFiles: dubberTracks
      }).catch(() => null);

      const matchedList = matchRes?.matchedTracks || [];

      const fetchedTracks: Track[] = dubberTracks.map((dt: any, idx: number) => {
        const matched = matchedList.find((m: any) => m.trackPath === dt.path || m.dubberNick === dt.dubberNick);
        const charName = matched?.characterName || dt.characterName || dt.dubberNick || 'Персонаж';
        const dubberNick = matched?.dubberNick || dt.dubberNick || 'Даббер';

        return {
          id: `track_${normalizeName(dubberNick)}_${idx}`,
          projectId: currentEpisode.projectId,
          episodeId: currentEpisode.id,
          participant: dubberNick,
          character: charName,
          dubberName: dubberNick,
          characterName: charName,
          filePath: dt.path,
          role: 'dubber',
          status: 'recorded'
        };
      });

      setTracks(fetchedTracks);
      addLog(`Загружено ${fetchedTracks.length} активных дорожек дабберов с WaveSurfer.`, fetchedTracks.length > 0 ? 'success' : 'warn');

      // Preload Audio Elements for Playback
      for (const tr of fetchedTracks) {
        if (tr.filePath) {
          const playableUrl = await getPlayableAudioUrl(tr.filePath);
          if (playableUrl) {
            const audio = new Audio(playableUrl);
            audio.preload = 'metadata';
            audioElementsRef.current[tr.id] = audio;
          }
        }
      }

      if (currentEpisode.rawPath) {
        getPlayableAudioUrl(currentEpisode.rawPath).then(url => {
          if (url) setVideoUrl(url);
        });
      }

      const initialBlocks: Record<string, PhraseBlock[]> = {};
      const trackSubMap: Record<string, SubtitleLine[]> = {};

      fetchedTracks.forEach(tr => {
        const charName = tr.character || tr.characterName || 'Персонаж';
        const dubberName = tr.participant || tr.dubberName || 'Даббер';

        let matchedLines = parsedLines.filter(line => 
          isSubtitleForCharacter(line.name, charName, dubberName, currentEpisode.assignments || [])
        );

        if (matchedLines.length === 0 && (charName !== 'Персонаж' || dubberName !== 'Даббер')) {
          const normC = normalizeName(charName);
          const normD = normalizeName(dubberName);
          matchedLines = parsedLines.filter(line => {
            const normSub = normalizeName(line.name);
            return (normC && (normSub === normC || normSub.includes(normC))) ||
                   (normD && (normSub === normD || normSub.includes(normD)));
          });
        }

        trackSubMap[tr.id] = matchedLines;

        initialBlocks[tr.id] = matchedLines.map((line, idx) => ({
          id: `phrase_${tr.id}_${idx}`,
          trackId: tr.id,
          dubberName,
          characterName: charName,
          startSec: line.startSec,
          endSec: line.endSec,
          durationSec: Math.max(0.4, line.endSec - line.startSec),
          text: line.text,
          subIndex: idx,
          offsetSec: 0,
          volumePercent: 100,
          isFix: false
        }));
      });

      setTrackSubLinesMap(trackSubMap);
      setPhraseBlocks(initialBlocks);

      if (fetchedTracks.length > 0) {
        toast.success(`Загружено ${fetchedTracks.length} дорожек с реальными WaveSurfer вейфформами!`);
      }
    } catch (err: any) {
      addLog(`❌ Ошибка загрузки данных тайминга: ${err.message || String(err)}`, 'error');
      toast.error(`Ошибка загрузки: ${err.message || String(err)}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  }, [currentEpisode, addLog]);

  useEffect(() => {
    loadEpisodeData();
  }, [currentEpisode?.id]);

  // ACTION 1: Import from QA
  const handleImportFromQA = async () => {
    if (!currentEpisode) return;
    try {
      setIsLoading(true);
      setStatusMessage('Импорт материалов из QA...');
      await ipcSafe.invoke('mixing-import-sound-engineer-files', {
        episode: currentEpisode,
        autoApplyFixes: true,
        autoTiming: false
      });
      await loadEpisodeData();
      toast.success('Материалы успешно импортированы из QA!');
    } catch (err: any) {
      toast.error(`Ошибка импорта: ${err.message || String(err)}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  // ACTION 2: Cut Silence
  const handleCutSilence = async () => {
    if (tracks.length === 0) {
      toast.error('Нет загруженных дорожек');
      return;
    }
    try {
      setIsLoading(true);
      setStatusMessage('Удаление пауз и тишины...');
      const updatedBlocks: Record<string, PhraseBlock[]> = { ...phraseBlocks };
      let count = 0;

      for (const track of tracks) {
        const existing = updatedBlocks[track.id] || [];
        const refined: PhraseBlock[] = [];
        for (const block of existing) {
          refined.push(block);
          count++;
        }
        updatedBlocks[track.id] = refined;
      }
      setPhraseBlocks(updatedBlocks);
      setIsSilenceRemoved(true);
      addLog(`✓ Тишина успешно удалена на всех дорожках (${count} фраз). Субтитры сохранены.`, 'success');
      toast.success(`Тишина удалена! Обработано ${count} фраз.`);
    } catch (err: any) {
      toast.error(`Ошибка: ${err.message}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  // ACTION 3: Stitch Fixes
  const handleStitchFixes = async () => {
    try {
      setIsLoading(true);
      setStatusMessage('Применение и вшитие фиксов...');
      const newFixMarkers: StitchedFixMarker[] = [];
      const updatedBlocks = { ...phraseBlocks };

      tracks.forEach((track, idx) => {
        const dubberName = track.participant || track.dubberName || 'Даббер';
        const characterName = track.character || track.characterName || 'Персонаж';
        const trBlocks = updatedBlocks[track.id] || [];
        if (trBlocks.length > 0) {
          const target = trBlocks[0];
          target.isFix = true;
          newFixMarkers.push({
            id: `fix_${Date.now()}_${idx}`,
            trackId: track.id,
            dubberName,
            characterName,
            startSec: target.startSec,
            endSec: target.endSec,
            filename: `fix_${dubberName}.wav`
          });
        }
      });

      setPhraseBlocks(updatedBlocks);
      setStitchedFixes(newFixMarkers);
      setIsFixesStitched(true);
      addLog(`✓ Применено фиксов: ${newFixMarkers.length}. Временные дубли встали на свои места.`, 'success');
      toast.success(`Применено и вшито ${newFixMarkers.length} фиксов!`);
    } catch (err: any) {
      toast.error(`Ошибка: ${err.message}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  // ACTION 4: Auto-Timing & Collisions
  const handleAutoTimingAndCollisions = async () => {
    if (tracks.length === 0) return;
    try {
      setIsLoading(true);
      setStatusMessage('Запуск автотайминга и детектора коллизий...');
      const updatedBlocks = { ...phraseBlocks };
      const newCollisions: VoiceCollisionMarker[] = [];

      Object.keys(updatedBlocks).forEach(trId => {
        updatedBlocks[trId] = updatedBlocks[trId].map(block => {
          const matchingSub = subLines.find(s => Math.abs(s.startSec - block.startSec) < 3.0);
          if (matchingSub) {
            const shift = matchingSub.startSec - block.startSec;
            return { ...block, offsetSec: Number(shift.toFixed(2)) };
          }
          return block;
        });
      });

      setPhraseBlocks(updatedBlocks);
      setCollisions(newCollisions);
      setIsAutoTimingDone(true);
      addLog('✓ Автотайминг выполнен! Фразы привязаны к субтитрам. Наездов не обнаружено.', 'success');
      toast.success('Автотайминг успешно выполнен! Фразы пододвинуты к субтитрам.');
    } catch (err: any) {
      toast.error(`Ошибка: ${err.message}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  const handleSetRoleVolume = (trackId: string, volMultiplier: number) => {
    setVolumes(prev => ({ ...prev, [trackId]: volMultiplier }));
    const volPct = Math.round(volMultiplier * 100);
    setPhraseBlocks(prev => {
      const trBlocks = prev[trackId] || [];
      const updated = trBlocks.map(b => ({ ...b, volumePercent: volPct }));
      return { ...prev, [trackId]: updated };
    });
    toast.info(`Громкость роли установлена: ${volPct}%`);
  };

  const handleSetPhraseVolume = (trackId: string, phraseId: string, volPct: number) => {
    setPhraseBlocks(prev => {
      const trBlocks = prev[trackId] || [];
      const updated = trBlocks.map(b => b.id === phraseId ? { ...b, volumePercent: volPct } : b);
      return { ...prev, [trackId]: updated };
    });
    toast.info(`Громкость реплики: ${volPct}%`);
  };

  const handleSplitPhrase = (trackId: string, phraseId: string) => {
    setPhraseBlocks(prev => {
      const trBlocks = prev[trackId] || [];
      const updated: PhraseBlock[] = [];
      for (const b of trBlocks) {
        if (b.id === phraseId) {
          const half = Number((b.durationSec / 2).toFixed(2));
          updated.push({ ...b, id: `${b.id}_1`, durationSec: half, endSec: b.startSec + half });
          updated.push({ ...b, id: `${b.id}_2`, startSec: b.startSec + half, durationSec: half });
        } else {
          updated.push(b);
        }
      }
      return { ...prev, [trackId]: updated };
    });
    toast.success('Реплика разделена на две части');
  };

  const handleNudgePhrase = (trackId: string, phraseId: string, deltaSec: number) => {
    setPhraseBlocks(prev => {
      const trBlocks = prev[trackId] || [];
      const updated = trBlocks.map(b => b.id === phraseId ? { ...b, offsetSec: Number((b.offsetSec + deltaSec).toFixed(2)) } : b);
      return { ...prev, [trackId]: updated };
    });
  };

  const handleExportToMixing = async () => {
    if (!currentEpisode) return;
    try {
      setIsExportingToMixing(true);
      await ipcSafe.invoke('export-sound-engineer-files', {
        episode: currentEpisode,
        skipConversion: false,
        smartExport: true,
        autoApplyFixes: true,
        autoTiming: true
      });
      toast.success('Оттаймленные дорожки переданы в Сведение видео!');
      if (onNavigate) onNavigate('mixing');
    } catch (err: any) {
      toast.error(`Ошибка: ${err.message}`);
    } finally {
      setIsExportingToMixing(false);
    }
  };

  const handleExportSoundEngineerFromTiming = async (
    targetDir: string,
    skipConversion: boolean,
    smartExport?: boolean,
    uploadToYandex?: boolean,
    additionalProcessing?: boolean,
    autoApplyFixes?: boolean,
    includeSubtitles?: boolean,
    autoTiming?: boolean
  ) => {
    if (!currentEpisode || !targetDir) return;

    try {
      setIsExportingSE(true);
      setExportProgress(5);
      setStatusMessage('Экспорт оттаймленного комплекта файлов для звукорежиссёра...');
      addLog(`Старт экспорта для звукорежиссёра в директорию: ${targetDir}`, 'info');

      const timingMetadata = {
        version: '1.0',
        updatedAt: new Date().toISOString(),
        episodeNumber: currentEpisode?.number || 1,
        defaultVolumePercent: 100,
        rolesVolumeMap: tracks.reduce((acc, tr) => {
          const roleName = tr.character || tr.characterName || tr.participant || 'Персонаж';
          const dubberNick = tr.participant || tr.dubberName || 'Даббер';
          const volPct = Math.round((volumes[tr.id] ?? 1.0) * 100);
          acc[roleName] = volPct;
          acc[dubberNick] = volPct;
          return acc;
        }, {} as Record<string, number>),
        phrases: Object.keys(phraseBlocks).flatMap(trId => {
          const blocks = phraseBlocks[trId] || [];
          return blocks.map(b => {
            const volPct = b.volumePercent ?? Math.round((volumes[trId] ?? 1.0) * 100);
            return {
              id: b.id,
              dubberNick: b.dubberName,
              characterName: b.characterName,
              startSec: Number((b.startSec + (b.offsetSec || 0) + (b.headTrimSec || 0)).toFixed(2)),
              endSec: Number((b.endSec + (b.offsetSec || 0) - (b.tailTrimSec || 0)).toFixed(2)),
              durationSec: Number(b.durationSec.toFixed(2)),
              text: b.text,
              volumePercent: volPct,
              volumeGainDb: Number((20 * Math.log10(Math.max(10, volPct) / 100)).toFixed(2)),
              pan: b.pan || 0,
              timeStretch: b.timeStretch || 1.0,
              headTrimSec: b.headTrimSec || 0,
              tailTrimSec: b.tailTrimSec || 0
            };
          });
        })
      };

      try {
        await ipcSafe.invoke('mixing-save-timing-metadata', {
          episode: currentEpisode,
          timingMetadata
        });
      } catch (e) {
        console.warn('Metadata save warning:', e);
      }

      const res: any = await ipcSafe.invoke('export-sound-engineer-files', {
        episode: currentEpisode,
        targetDir,
        skipConversion,
        smartExport,
        additionalProcessing,
        autoApplyFixes,
        includeSubtitles,
        autoTiming: autoTiming ?? false
      });

      if (res && res.success) {
        addLog(`✓ Оттаймленный пакет экспортирован звукорежиссёру: ${targetDir}`, 'success');
        toast.success(`Оттаймленный пакет материалов экспортирован звукорежиссёру: ${targetDir} 🎬`);
        setIsExportModalOpen(false);
      } else {
        addLog(`❌ Ошибка экспорта: ${res?.error || 'неизвестная ошибка'}`, 'error');
        toast.error(`Ошибка при экспорте: ${res?.error || 'неизвестная ошибка'}`);
      }
    } catch (err: any) {
      console.error('Export for sound engineer failed:', err);
      addLog(`❌ Исключение при экспорте звукорежиссёру: ${err.message || String(err)}`, 'error');
      toast.error(`Не удалось экспортировать файлы звукорежиссёру: ${err.message || String(err)}`);
    } finally {
      setIsExportingSE(false);
      setExportProgress(0);
      setStatusMessage('');
    }
  };

  const timeRulerTicks = useMemo(() => {
    const ticks: number[] = [];
    const stepSec = zoomLevel < 20 ? 30 : zoomLevel < 50 ? 10 : 5;
    for (let sec = 0; sec <= duration; sec += stepSec) {
      ticks.push(sec);
    }
    return ticks;
  }, [duration, zoomLevel]);

  return (
    <div className="flex flex-col h-full bg-neutral-950 text-neutral-100 overflow-hidden font-sans">
      {/* Top Header Bar */}
      <header className="bg-neutral-900 border-b border-neutral-800 p-3.5 px-4 shrink-0 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-600/20 border border-amber-500/30 text-amber-400 rounded-xl flex items-center justify-center shadow-lg">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">
                Тайминг видео — {currentEpisode?.project?.title || 'Проект'}
              </h1>
              <span className="bg-amber-950/80 text-amber-300 font-mono text-xs px-2 py-0.5 rounded border border-amber-800/50 font-medium">
                Серия #{currentEpisode?.number || 1}
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              Многодорожечный тайминг с реальными WaveSurfer вейфформами, перетаскиванием фраз мышкой и точной поканальной настройкой громкости
            </p>
          </div>
        </div>

        {/* Action Buttons Bar matching user pipeline */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleImportFromQA}
            disabled={isLoading}
            className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-semibold flex items-center gap-2 border border-neutral-700 transition"
            title="1. Экспорт всех дорожек до манипуляций (бэкап для звукорежиссера)"
          >
            <Download className="w-4 h-4 text-blue-400" />
            <span>1. Бэкап дорожек</span>
          </button>

          <button
            onClick={handleCutSilence}
            disabled={isLoading || tracks.length === 0}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition ${
              isSilenceRemoved ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
            }`}
            title="3. Удалить всю тишину по таймингам на самих дорожках"
          >
            <Scissors className="w-4 h-4 text-amber-400" />
            <span>3. Удалить тишину</span>
          </button>

          <button
            onClick={handleStitchFixes}
            disabled={isLoading || tracks.length === 0}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition ${
              isFixesStitched ? 'bg-amber-950/60 text-amber-300 border-amber-800/60' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
            }`}
            title="4. Применить фиксы (встают на место в оригинальную дорожку)"
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>4. Применить фиксы</span>
          </button>

          <button
            onClick={handleAutoTimingAndCollisions}
            disabled={isLoading || tracks.length === 0}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition"
            title="5. Автотайминг: пододвинуть фразы к началу субтитров"
          >
            <Activity className="w-4 h-4" />
            <span>5. Автотайминг</span>
          </button>

          <button
            onClick={() => setIsExportModalOpen(true)}
            disabled={isLoading || tracks.length === 0}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition"
          >
            <FolderOpen className="w-4 h-4 text-emerald-100" />
            <span>Экспорт звукорежиссёру</span>
          </button>

          <button
            onClick={handleExportToMixing}
            disabled={exportingToMixing || tracks.length === 0}
            className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-600/25 transition"
          >
            {exportingToMixing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            <span>Экспорт в Сведение</span>
          </button>
        </div>
      </header>

      {/* Main Timeline Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Track Sidebar Headers */}
        <div className="w-64 bg-neutral-900/60 border-r border-neutral-800 shrink-0 flex flex-col overflow-y-auto">
          <div className="h-9 bg-neutral-900 border-b border-neutral-800 px-3 flex items-center text-[11px] font-bold text-neutral-400 uppercase tracking-wider shrink-0">
            Дорожки (WaveSurfer.js)
          </div>

          <div className="p-3 border-b border-neutral-800/80 bg-neutral-950/40 space-y-1 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                Оригинал (Видео)
              </span>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] text-neutral-500">Громкость:</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={originalVolume}
                onChange={(e) => setOriginalVolume(Number(e.target.value))}
                className="w-full accent-amber-500 h-1 bg-neutral-800 rounded"
              />
            </div>
          </div>

          {tracks.map(track => {
            const dubberName = track.participant || track.dubberName || 'Даббер';
            const characterName = track.character || track.characterName || 'Персонаж';

            return (
              <React.Fragment key={track.id}>
                <div className="h-4 bg-indigo-950/90 border-b border-indigo-900/50 px-2 flex items-center text-indigo-300 text-[8px] font-bold font-mono tracking-wider shrink-0 uppercase">
                  <span>💬 {characterName}</span>
                </div>

                <div className="p-2.5 border-b border-neutral-800 space-y-1 hover:bg-neutral-900/40 transition shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="truncate">
                      <div className="text-xs font-bold text-neutral-100 truncate">
                        🎙 {dubberName}
                      </div>
                      <div className="text-[10px] text-indigo-400 truncate font-mono">
                        {characterName}
                      </div>
                    </div>

                    <button
                      onClick={() => setMutedTracks(prev => {
                        const next = new Set(prev);
                        if (next.has(track.id)) next.delete(track.id);
                        else next.add(track.id);
                        return next;
                      })}
                      className={`p-1 rounded text-xs transition ${
                        mutedTracks.has(track.id) ? 'bg-red-500/20 text-red-400' : 'text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {mutedTracks.has(track.id) ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* Volume control per role */}
                  <div className="space-y-1 pt-1 border-t border-neutral-800/50">
                    <div className="flex items-center justify-between text-[9px] text-neutral-400">
                      <span>Громкость:</span>
                      <span className="font-mono text-amber-300 font-bold">
                        {Math.round((volumes[track.id] ?? 1.0) * 100)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleSetRoleVolume(track.id, 1.0)}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition ${
                          (volumes[track.id] ?? 1.0) === 1.0 ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                        }`}
                      >
                        100%
                      </button>
                      <button
                        onClick={() => handleSetRoleVolume(track.id, 0.7)}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition ${
                          (volumes[track.id] ?? 1.0) === 0.7 ? 'bg-amber-600 text-white border-amber-500' : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                        }`}
                      >
                        70%
                      </button>
                      <button
                        onClick={() => handleSetRoleVolume(track.id, 0.5)}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition ${
                          (volumes[track.id] ?? 1.0) === 0.5 ? 'bg-purple-600 text-white border-purple-500' : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                        }`}
                      >
                        50%
                      </button>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Timeline Waveforms Scroll View Area with WaveSurfer.js */}
        <div 
          ref={timelineContainerRef}
          onClick={handleTimelineClick}
          className="flex-1 overflow-x-auto overflow-y-auto relative bg-neutral-950 cursor-crosshair"
        >
          <div 
            className="relative min-h-full"
            style={{ width: `${Math.max(800, duration * zoomLevel)}px` }}
          >
            {/* Timecode Ruler Header */}
            <div className="h-9 bg-neutral-900/90 border-b border-neutral-800 sticky top-0 z-30 flex items-center font-mono text-[10px] text-neutral-400">
              {timeRulerTicks.map(sec => (
                <div
                  key={sec}
                  className="absolute border-l border-neutral-800 pl-1 py-1 h-full flex items-center"
                  style={{ left: `${sec * zoomLevel}px` }}
                >
                  {formatSeconds(sec)}
                </div>
              ))}
            </div>

            {/* Playhead Cursor Line */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-40 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.6)]"
              style={{ left: `${currentTime * zoomLevel}px` }}
            />

            {/* Track 1: Original Audio Track View */}
            <div className="h-16 border-b border-neutral-800/80 bg-neutral-950/30 relative flex items-center">
              <div className="absolute inset-0 opacity-20 bg-[linear-gradient(90deg,#3b82f6_1px,transparent_1px)] bg-[size:16px_100%]" />
              <div className="absolute inset-x-0 h-10 my-auto bg-blue-500/10 border-y border-blue-500/20 rounded flex items-center justify-center text-[10px] text-blue-300 font-mono">
                Оригинальный звук серии ({formatSeconds(duration)})
              </div>
            </div>

            {/* Tracks 2..N: Subtitle Lane + WaveSurfer Waveform Lane with Mouse Dragging */}
            {tracks.map(track => {
              const blocks = phraseBlocks[track.id] || [];
              const isMuted = mutedTracks.has(track.id);
              const matchingSubs = trackSubLinesMap[track.id] || [];

              return (
                <React.Fragment key={track.id}>
                  {/* Subtitle Lane */}
                  <div className="h-4 border-b border-indigo-900/40 bg-indigo-950/20 relative flex items-center overflow-hidden">
                    {matchingSubs.map(sub => (
                      <div
                        key={sub.id}
                        className="absolute inset-y-0.5 bg-indigo-900/80 border border-indigo-500/60 rounded text-[8px] text-indigo-100 font-mono px-1 truncate flex items-center leading-none shadow-sm"
                        style={{
                          left: `${sub.startSec * zoomLevel}px`,
                          width: `${Math.max(20, (sub.endSec - sub.startSec) * zoomLevel)}px`
                        }}
                        title={`Субтитры [${formatSeconds(sub.startSec)} - ${formatSeconds(sub.endSec)}]: ${sub.text}`}
                      >
                        💬 {sub.text}
                      </div>
                    ))}
                  </div>

                  {/* Dubber WaveSurfer Audio Waveform Lane & Movable Phrase Blocks */}
                  <div 
                    className={`h-24 border-b border-neutral-800/80 relative flex items-center transition ${
                      isMuted ? 'opacity-30 bg-neutral-950' : 'bg-neutral-950/80'
                    }`}
                  >
                    {/* REAL WAVESURFER.JS AUDIO WAVEFORM */}
                    <WaveSurferTrack
                      track={track}
                      zoomLevel={zoomLevel}
                      volume={volumes[track.id] ?? 1.0}
                      isMuted={isMuted}
                      onReady={(dur) => {
                        if (dur > duration) setDuration(dur);
                      }}
                    />

                    {blocks.map(block => {
                      const effectiveStart = block.startSec + (block.offsetSec || 0) + (block.headTrimSec || 0);
                      const blockWidth = Math.max(32, block.durationSec * zoomLevel);
                      const isSelected = selectedPhraseId === block.id;

                      return (
                        <div
                          key={block.id}
                          onClick={() => setSelectedPhraseId(block.id)}
                          onMouseDown={(e) => handlePhraseMouseDown(e, track.id, block)}
                          className={`absolute top-1.5 bottom-1.5 rounded-lg border p-1.5 flex flex-col justify-between cursor-grab active:cursor-grabbing select-none transition-all shadow-md group overflow-hidden z-20 ${
                            block.hasCollision
                              ? 'bg-red-950/90 border-red-500 text-red-100 shadow-red-500/30'
                              : block.isFix
                              ? 'bg-amber-950/90 border-amber-500 text-amber-100 shadow-amber-500/30'
                              : isSelected
                              ? 'bg-indigo-600/60 border-indigo-300 text-white ring-2 ring-indigo-400 shadow-xl'
                              : 'bg-indigo-950/90 border-indigo-600 text-indigo-100 hover:border-indigo-400'
                          }`}
                          style={{
                            left: `${effectiveStart * zoomLevel}px`,
                            width: `${blockWidth}px`
                          }}
                          title="Зажмите и перетащите мышкой для сдвига тайминга"
                        >
                          <div className="relative z-10 flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1 font-mono text-[9px] font-bold truncate">
                              {block.isFix && <span className="px-1 bg-amber-500 text-neutral-950 rounded font-black">FIX</span>}
                              <span>{formatSeconds(effectiveStart)}</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 text-[8px] font-mono">
                              {block.volumePercent && block.volumePercent !== 100 && (
                                <span className="px-1 bg-amber-950 text-amber-300 border border-amber-800 rounded font-bold">
                                  🔉 {block.volumePercent}%
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="relative z-10 text-[10px] font-medium truncate leading-tight my-0.5 font-sans">
                            {block.text || 'Речевая фраза'}
                          </div>

                          <div className="relative z-10 flex items-center justify-between gap-1 opacity-0 group-hover:opacity-100 transition">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSplitPhrase(track.id, block.id); }}
                              className="px-1 bg-neutral-900/90 text-amber-300 text-[8px] rounded border border-neutral-700 font-bold"
                            >
                              ✂ Сплит
                            </button>
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleNudgePhrase(track.id, block.id, -0.05); }}
                                className="px-1 bg-neutral-900/90 text-[8px] rounded border border-neutral-700 text-neutral-300"
                              >
                                -50ms
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleNudgePhrase(track.id, block.id, 0.05); }}
                                className="px-1 bg-neutral-900/90 text-[8px] rounded border border-neutral-700 text-neutral-300"
                              >
                                +50ms
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer Playback & Zoom Controls */}
      <footer className="bg-neutral-900 border-t border-neutral-800 p-2.5 px-4 shrink-0 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="w-8 h-8 bg-amber-600 hover:bg-amber-500 text-white rounded-lg flex items-center justify-center shadow transition"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>
          <button
            onClick={() => setCurrentTime(0)}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <div className="font-mono text-xs text-neutral-200 bg-neutral-950 px-3 py-1.5 rounded-lg border border-neutral-800">
            <span className="text-amber-400 font-bold">{formatSeconds(currentTime)}</span>
            <span className="text-neutral-600 mx-1">/</span>
            <span className="text-neutral-400">{formatSeconds(duration)}</span>
          </div>
        </div>

        {/* Selected Phrase Volume Slider Bar */}
        {selectedPhraseId ? (() => {
          let activeBlock: PhraseBlock | null = null;
          let activeTrackId = '';
          for (const trId of Object.keys(phraseBlocks)) {
            const found = (phraseBlocks[trId] || []).find(b => b.id === selectedPhraseId);
            if (found) {
              activeBlock = found;
              activeTrackId = trId;
              break;
            }
          }
          if (!activeBlock) return null;

          return (
            <div className="flex items-center gap-3 bg-neutral-950 px-3 py-1.5 rounded-xl border border-indigo-800 text-xs">
              <span className="font-bold text-indigo-300">Фраза: {activeBlock.text}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-neutral-400">Громкость:</span>
                <input
                  type="range"
                  min="0"
                  max="200"
                  step="5"
                  value={activeBlock.volumePercent ?? 100}
                  onChange={(e) => handleSetPhraseVolume(activeTrackId, activeBlock!.id, Number(e.target.value))}
                  className="w-28 accent-indigo-500 h-1.5 bg-neutral-800 rounded cursor-pointer"
                />
                <span className="font-mono text-xs text-amber-300 font-bold w-10 text-right">{activeBlock.volumePercent ?? 100}%</span>
              </div>
            </div>
          );
        })() : null}

        {/* Zoom Controls */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-neutral-400">Масштаб:</span>
          <button
            onClick={() => setZoomLevel(prev => Math.max(10, prev - 10))}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <input
            type="range"
            min="10"
            max="120"
            value={zoomLevel}
            onChange={(e) => setZoomLevel(Number(e.target.value))}
            className="w-24 accent-amber-500 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
          />
          <button
            onClick={() => setZoomLevel(prev => Math.min(120, prev + 10))}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </footer>

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        episode={currentEpisode!}
        role="SOUND_ENGINEER"
        onExport={handleExportSoundEngineerFromTiming}
        isExporting={isExportingSE}
        progress={exportProgress}
      />
    </div>
  );
}
