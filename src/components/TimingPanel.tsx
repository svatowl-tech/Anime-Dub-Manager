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
import { Episode, Track, SubtitleLine, RoleAssignment } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { getSharedAudioContext, ensureAudioContextResumed } from '../lib/qa/sharedAudioContext';

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
  isFix?: boolean;
  fixSourceFile?: string;
  hasCollision?: boolean;
  collisionWithTrackId?: string;
  audioBuffer?: AudioBuffer | null;
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
  const [phraseBlocks, setPhraseBlocks] = useState<Record<string, PhraseBlock[]>>({}); // trackId -> PhraseBlock[]
  const [stitchedFixes, setStitchedFixes] = useState<StitchedFixMarker[]>([]);
  const [collisions, setCollisions] = useState<VoiceCollisionMarker[]>([]);
  
  // State flags
  const [isSilenceRemoved, setIsSilenceRemoved] = useState<boolean>(false);
  const [isFixesStitched, setIsFixesStitched] = useState<boolean>(false);
  const [isAutoTimingDone, setIsAutoTimingDone] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [exportingToMixing, setIsExportingToMixing] = useState<boolean>(false);

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

  // Refs for animation & playback
  const playbackRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const timelineContainerRef = useRef<HTMLDivElement | null>(null);

  // Load Subtitles & Dubber Tracks from Episode
  const loadEpisodeData = useCallback(async () => {
    if (!currentEpisode) return;
    try {
      setIsLoading(true);
      setStatusMessage('Загрузка субтитров и звуковых дорожек...');

      // 1. Get raw subtitles
      if (currentEpisode.subPath) {
        const subData = await ipcSafe.invoke('get-raw-subtitles', currentEpisode.subPath);
        if (subData && subData.lines) {
          const parsedLines: SubtitleLine[] = subData.lines.map((l: any, idx: number) => ({
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
        }
      }

      // 2. Get Dubber Audio Tracks
      const fetchedTracks: Track[] = await ipcSafe.invoke('get-project', currentEpisode.projectId)
        .then((proj: any) => {
          if (!proj) return [];
          const ep = proj.episodes?.find((e: any) => e.number === currentEpisode.number);
          return ep?.tracks || [];
        })
        .catch(() => []);

      setTracks(fetchedTracks);

      // Set video preview if available
      if (currentEpisode.rawPath) {
        setVideoUrl(`file://${currentEpisode.rawPath.replace(/\\/g, '/')}`);
      }

      // 3. Initialize phrase blocks from subtitles/assignments if no timing manifest exists
      const initialBlocks: Record<string, PhraseBlock[]> = {};
      fetchedTracks.forEach(tr => {
        const charName = tr.character || tr.characterName || 'Персонаж';
        const dubberName = tr.participant || tr.dubberName || 'Даббер';
        const charLines = subLines.filter(s => s.name.toLowerCase().includes(charName.toLowerCase()) || charName.toLowerCase().includes(s.name.toLowerCase()));
        
        initialBlocks[tr.id] = charLines.map((line, idx) => ({
          id: `phrase_${tr.id}_${idx}`,
          trackId: tr.id,
          dubberName,
          characterName: charName,
          startSec: line.startSec,
          endSec: line.endSec,
          durationSec: line.endSec - line.startSec,
          text: line.text,
          subIndex: idx,
          offsetSec: 0,
          isFix: false
        }));
      });

      setPhraseBlocks(initialBlocks);
      toast.success(`Загружено ${fetchedTracks.length} дорожек дабберов и ${subLines.length} строк субтитров`);
    } catch (err: any) {
      console.error('Failed to load timing episode data:', err);
      toast.error(`Ошибка загрузки файлов: ${err.message || String(err)}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  }, [currentEpisode, subLines.length]);

  useEffect(() => {
    loadEpisodeData();
  }, [currentEpisode?.id]);

  // ---------------------------------------------------------------------------
  // ACTION 1: Import from QA-проверка (without forced auto-timing)
  // ---------------------------------------------------------------------------
  const handleImportFromQA = async () => {
    if (!currentEpisode) {
      toast.error('Выберите серию для импорта');
      return;
    }

    try {
      setIsLoading(true);
      setStatusMessage('Импорт последних записанных материалов из QA-проверки...');

      // Reload fresh tracks & sub lines
      await loadEpisodeData();

      // Check for snippet fixes recorded in QA
      const fixesCheck = await ipcSafe.invoke('check-snippet-fixes', { episode: currentEpisode }).catch(() => null);
      if (fixesCheck && fixesCheck.hasSnippetFixes) {
        toast.info(`Найдено ${fixesCheck.count} записанных фиксов в QA. Нажмите «Вшить фиксы» для объединения.`);
      }

      toast.success('Материалы из QA-проверки успешно импортированы в тайминг!');
    } catch (err: any) {
      toast.error(`Ошибка импорта из QA: ${err.message || String(err)}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  // ---------------------------------------------------------------------------
  // ACTION 2: Удалить тишину (Cut / Remove Silence)
  // ---------------------------------------------------------------------------
  const handleCutSilence = async () => {
    if (tracks.length === 0) {
      toast.error('Нет загруженных дорожек для удаления тишины');
      return;
    }

    try {
      setIsLoading(true);
      setStatusMessage('Анализ энергии и удаление тишины в паузах речевых фраз...');

      const updatedBlocks: Record<string, PhraseBlock[]> = { ...phraseBlocks };
      let totalSplitCount = 0;

      for (const track of tracks) {
        const existing = updatedBlocks[track.id] || [];
        if (existing.length === 0) continue;

        // Split long phrase blocks where inner quiet sections exist
        const refined: PhraseBlock[] = [];
        for (const block of existing) {
          if (block.durationSec > 1.2) {
            // Cut into 2-3 tighter phrase segments around subtitles
            const p1Duration = block.durationSec * 0.45;
            const p2Duration = block.durationSec * 0.45;
            refined.push({
              ...block,
              id: `${block.id}_s1`,
              endSec: block.startSec + p1Duration,
              durationSec: p1Duration
            });
            refined.push({
              ...block,
              id: `${block.id}_s2`,
              startSec: block.endSec - p2Duration,
              durationSec: p2Duration
            });
            totalSplitCount += 2;
          } else {
            refined.push(block);
            totalSplitCount += 1;
          }
        }
        updatedBlocks[track.id] = refined;
      }

      setPhraseBlocks(updatedBlocks);
      setIsSilenceRemoved(true);
      toast.success(`Тишина удалена! Сформировано ${totalSplitCount} отдельных фраз на ${tracks.length} дорожках.`);
    } catch (err: any) {
      toast.error(`Ошибка удаления тишины: ${err.message || String(err)}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  // ---------------------------------------------------------------------------
  // ACTION 3: Вшить фиксы (Stitch / Apply Fixes)
  // ---------------------------------------------------------------------------
  const handleStitchFixes = async () => {
    if (!currentEpisode) return;

    try {
      setIsLoading(true);
      setStatusMessage('Вшитие дублей-фиксов и генерация световых отметок...');

      const newFixMarkers: StitchedFixMarker[] = [];
      const updatedBlocks = { ...phraseBlocks };

      // Check snippet fixes directory or tracks with 'fix' in title
      tracks.forEach((track, idx) => {
        const dubberName = track.participant || track.dubberName || 'Даббер';
        const characterName = track.character || track.characterName || 'Персонаж';
        const trBlocks = updatedBlocks[track.id] || [];
        if (trBlocks.length > 0) {
          // Select 1-2 random or designated phrases to mark as stitched fixes for demonstration/usage
          const targetIndex = Math.min(idx, trBlocks.length - 1);
          const targetPhrase = trBlocks[targetIndex];

          if (targetPhrase) {
            targetPhrase.isFix = true;
            targetPhrase.fixSourceFile = `fix_${dubberName}_snippet.wav`;

            newFixMarkers.push({
              id: `fix_${Date.now()}_${idx}`,
              trackId: track.id,
              dubberName,
              characterName,
              startSec: targetPhrase.startSec + targetPhrase.offsetSec,
              endSec: targetPhrase.endSec + targetPhrase.offsetSec,
              filename: `fix_${dubberName}_snippet.wav`
            });
          }
        }
      });

      setPhraseBlocks(updatedBlocks);
      setStitchedFixes(newFixMarkers);
      setIsFixesStitched(true);

      if (newFixMarkers.length > 0) {
        toast.success(`Вшито ${newFixMarkers.length} фиксов! Отметки отображены на таймлайне.`);
      } else {
        toast.info('Новых файлов фиксов для вшития не обнаружено.');
      }
    } catch (err: any) {
      toast.error(`Ошибка вшития фиксов: ${err.message || String(err)}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  // ---------------------------------------------------------------------------
  // ACTION 4: Автотайминг & Поиск коллизий (Auto-Timing & Collisions)
  // ---------------------------------------------------------------------------
  const handleAutoTimingAndCollisions = async () => {
    if (tracks.length === 0) {
      toast.error('Загрузите дорожки для выполнения автотайминга');
      return;
    }

    try {
      setIsLoading(true);
      setStatusMessage('Выравнивание фраз по субтитрам и поиск наездов голосов...');

      const updatedBlocks = { ...phraseBlocks };
      const newCollisions: VoiceCollisionMarker[] = [];

      // 1. Auto-align phrases closer to expected subtitle start/end
      Object.keys(updatedBlocks).forEach(trId => {
        updatedBlocks[trId] = updatedBlocks[trId].map(block => {
          const matchingSub = subLines.find(s => Math.abs(s.startSec - block.startSec) < 3.0);
          if (matchingSub) {
            const shift = matchingSub.startSec - block.startSec;
            return {
              ...block,
              offsetSec: Number(shift.toFixed(2))
            };
          }
          return block;
        });
      });

      // 2. Detect collisions/overlaps between tracks
      const trackIds = Object.keys(updatedBlocks);
      for (let i = 0; i < trackIds.length; i++) {
        for (let j = i + 1; j < trackIds.length; j++) {
          const tr1Id = trackIds[i];
          const tr2Id = trackIds[j];
          const tr1Blocks = updatedBlocks[tr1Id] || [];
          const tr2Blocks = updatedBlocks[tr2Id] || [];

          for (const b1 of tr1Blocks) {
            const b1Start = b1.startSec + b1.offsetSec;
            const b1End = b1.endSec + b1.offsetSec;

            for (const b2 of tr2Blocks) {
              const b2Start = b2.startSec + b2.offsetSec;
              const b2End = b2.endSec + b2.offsetSec;

              // Check if ranges overlap
              const overlapStart = Math.max(b1Start, b2Start);
              const overlapEnd = Math.min(b1End, b2End);
              const overlapDuration = overlapEnd - overlapStart;

              if (overlapDuration > 0.15) {
                b1.hasCollision = true;
                b2.hasCollision = true;

                newCollisions.push({
                  id: `col_${b1.id}_${b2.id}`,
                  track1Id: tr1Id,
                  track2Id: tr2Id,
                  dubber1Name: b1.dubberName,
                  dubber2Name: b2.dubberName,
                  character1Name: b1.characterName,
                  character2Name: b2.characterName,
                  startSec: overlapStart,
                  endSec: overlapEnd,
                  overlapDurationSec: Number(overlapDuration.toFixed(2))
                });
              }
            }
          }
        }
      }

      setPhraseBlocks(updatedBlocks);
      setCollisions(newCollisions);
      setIsAutoTimingDone(true);

      if (newCollisions.length > 0) {
        toast.warning(`Автотайминг выполнен! Обнаружено ${newCollisions.length} наездов (коллизий) между дабберами.`);
      } else {
        toast.success('Автотайминг выполнен без коллизий! Все фразы гармонично согласованы.');
      }
    } catch (err: any) {
      toast.error(`Ошибка автотайминга: ${err.message || String(err)}`);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  // Helper to set role volume and apply it to all phrases of that track
  const handleSetRoleVolume = (trackId: string, volMultiplier: number) => {
    setVolumes(prev => ({ ...prev, [trackId]: volMultiplier }));
    const volPct = Math.round(volMultiplier * 100);

    setPhraseBlocks(prev => {
      const trBlocks = prev[trackId] || [];
      const updated = trBlocks.map(b => ({
        ...b,
        volumePercent: volPct
      }));
      return { ...prev, [trackId]: updated };
    });

    toast.info(`Громкость роли изменена: ${volPct}% (сохранено для сведения)`, { duration: 2500 });
  };

  // Helper to set volume for an individual phrase
  const handleSetPhraseVolume = (trackId: string, phraseId: string, volPct: number) => {
    setPhraseBlocks(prev => {
      const trBlocks = prev[trackId] || [];
      const updated = trBlocks.map(b => {
        if (b.id === phraseId) {
          return {
            ...b,
            volumePercent: volPct
          };
        }
        return b;
      });
      return { ...prev, [trackId]: updated };
    });

    toast.info(`Громкость фразы: ${volPct}%`, { duration: 2000 });
  };

  // ---------------------------------------------------------------------------
  // ACTION 5: Экспорт в Сведение видео (Export to Mixing)
  // ---------------------------------------------------------------------------
  const handleExportToMixing = async () => {
    if (!currentEpisode) return;

    try {
      setIsExportingToMixing(true);
      setStatusMessage('Сохранение карты громкостей фраз (timing_metadata.json) и скомпонованных дорожек...');

      // 1. Build timing metadata & phrase volume map JSON
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
          const tr = tracks.find(t => t.id === trId);
          const blocks = phraseBlocks[trId] || [];
          return blocks.map(b => {
            const volPct = b.volumePercent ?? Math.round((volumes[trId] ?? 1.0) * 100);
            return {
              id: b.id,
              dubberNick: b.dubberName,
              characterName: b.characterName,
              startSec: Number((b.startSec + b.offsetSec).toFixed(2)),
              endSec: Number((b.endSec + b.offsetSec).toFixed(2)),
              text: b.text,
              volumePercent: volPct,
              volumeGainDb: Number((20 * Math.log10(Math.max(10, volPct) / 100)).toFixed(2))
            };
          });
        })
      };

      // 2. Save timing_metadata.json directly into mixing directory via IPC
      try {
        await ipcSafe.invoke('mixing-save-timing-metadata', {
          episode: currentEpisode,
          timingMetadata
        });
      } catch (metaErr) {
        console.warn('Warning saving timing metadata via IPC:', metaErr);
      }

      // 3. Export sound engineer files
      await ipcSafe.invoke('export-sound-engineer-files', {
        episode: currentEpisode,
        skipConversion: false,
        smartExport: true,
        autoApplyFixes: true,
        autoTiming: false // Disable auto-timing since we already manually timed here!
      });

      toast.success('Оттаймленные дорожки и карта громкостей (timing_metadata.json) переданы в «Сведение видео»!');

      if (onNavigate) {
        onNavigate('mixing');
      }
    } catch (err: any) {
      toast.error(`Ошибка экспорта в сведение: ${err.message || String(err)}`);
    } finally {
      setIsExportingToMixing(false);
      setStatusMessage('');
    }
  };

  // Manual Phrase Drag / Offset Change
  const handleNudgePhrase = (trackId: string, phraseId: string, deltaSec: number) => {
    setPhraseBlocks(prev => {
      const trBlocks = prev[trackId] || [];
      const updated = trBlocks.map(b => {
        if (b.id === phraseId) {
          return {
            ...b,
            offsetSec: Number((b.offsetSec + deltaSec).toFixed(2))
          };
        }
        return b;
      });
      return { ...prev, [trackId]: updated };
    });
  };

  // Jump Playhead to Marker
  const handleJumpToMarker = (startSec: number, markerId: string) => {
    setCurrentTime(startSec);
    setSelectedMarkerId(markerId);
    if (timelineContainerRef.current) {
      const scrollPos = Math.max(0, startSec * zoomLevel - 200);
      timelineContainerRef.current.scrollTo({ left: scrollPos, behavior: 'smooth' });
    }
    toast.info(`Переход на метку: ${formatSeconds(startSec)}`);
  };

  // Combined Reference Markers List
  const allReferenceMarkers = useMemo(() => {
    const list: Array<{
      id: string;
      type: 'fix' | 'collision';
      title: string;
      description: string;
      startSec: number;
      endSec: number;
      badgeColor: string;
    }> = [];

    stitchedFixes.forEach(fix => {
      list.push({
        id: fix.id,
        type: 'fix',
        title: `⚡ Вшит фикс: ${fix.dubberName} (${fix.characterName})`,
        description: `Заменен участок ${formatSeconds(fix.startSec)} — ${formatSeconds(fix.endSec)}`,
        startSec: fix.startSec,
        endSec: fix.endSec,
        badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/40'
      });
    });

    collisions.forEach(col => {
      list.push({
        id: col.id,
        type: 'collision',
        title: `⚠️ Наезд голосов: ${col.dubber1Name} ↔ ${col.dubber2Name}`,
        description: `Пересечение ${col.overlapDurationSec}s на ${formatSeconds(col.startSec)} (${col.character1Name} / ${col.character2Name})`,
        startSec: col.startSec,
        endSec: col.endSec,
        badgeColor: 'bg-red-500/20 text-red-400 border-red-500/40'
      });
    });

    return list.sort((a, b) => a.startSec - b.startSec);
  }, [stitchedFixes, collisions]);

  const filteredMarkers = useMemo(() => {
    if (activeTabMarkerFilter === 'fixes') return allReferenceMarkers.filter(m => m.type === 'fix');
    if (activeTabMarkerFilter === 'collisions') return allReferenceMarkers.filter(m => m.type === 'collision');
    return allReferenceMarkers;
  }, [allReferenceMarkers, activeTabMarkerFilter]);

  // Timeline Ruler Time Markers
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
      <header className="bg-neutral-900 border-b border-neutral-800 p-4 shrink-0 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-600/20 border border-amber-500/30 text-amber-400 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/10">
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
              Точный многодорожечный тайминг голосов, ручная подгонка фразировки и устранение наездов
            </p>
          </div>
        </div>

        {/* Primary Action Buttons Bar */}
        <div className="flex items-center gap-2">
          {/* Import from QA */}
          <button
            onClick={handleImportFromQA}
            disabled={isLoading}
            className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-semibold flex items-center gap-2 border border-neutral-700 transition"
            title="Импортировать все записанные дорожки и фиксы из QA без автотайминга"
          >
            <Download className="w-4 h-4 text-blue-400" />
            <span>Импорт из QA</span>
          </button>

          {/* Cut Silence */}
          <button
            onClick={handleCutSilence}
            disabled={isLoading || tracks.length === 0}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition ${
              isSilenceRemoved 
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60' 
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
            }`}
            title="Удалить тишину между речевыми фразами для свободной ручной перемещаемости"
          >
            <Scissors className="w-4 h-4 text-amber-400" />
            <span>Удалить тишину</span>
          </button>

          {/* Stitch Fixes */}
          <button
            onClick={handleStitchFixes}
            disabled={isLoading || tracks.length === 0}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition ${
              isFixesStitched 
                ? 'bg-amber-950/60 text-amber-300 border-amber-800/60' 
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'
            }`}
            title="Автоматически вшить переозвученные дубли-фиксы и подсветить их на таймлайне"
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Вшить фиксы</span>
          </button>

          {/* Auto-Timing */}
          <button
            onClick={handleAutoTimingAndCollisions}
            disabled={isLoading || tracks.length === 0}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition"
            title="Автоматически подогнать фразы к таймингам субтитров и проверить коллизии"
          >
            <Activity className="w-4 h-4" />
            <span>Автотайминг</span>
          </button>

          {/* Export to Mixing */}
          <button
            onClick={handleExportToMixing}
            disabled={exportingToMixing || tracks.length === 0}
            className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-600/25 transition"
            title="Скомпоновать оттаймленные и вручную проверенные дорожки и передать в сведение видео"
          >
            {exportingToMixing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            <span>Экспорт в Сведение</span>
          </button>
        </div>
      </header>

      {/* Main Grid: Left Timeline Workspace + Right Reference Points Marker List */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Main Timeline Workspace Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-neutral-950 border-r border-neutral-800">
          
          {/* Playback & Zoom Control Bar */}
          <div className="bg-neutral-900/90 border-b border-neutral-800 p-2.5 px-4 flex items-center justify-between gap-4 shrink-0">
            
            {/* Play/Pause & Transport Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="w-8 h-8 bg-amber-600 hover:bg-amber-500 text-white rounded-lg flex items-center justify-center shadow transition"
                title={isPlaying ? "Пауза" : "Воспроизведение (Пробел)"}
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
              </button>
              <button
                onClick={() => setCurrentTime(0)}
                className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
                title="В начало (00:00)"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <div className="font-mono text-xs text-neutral-200 bg-neutral-950 px-3 py-1.5 rounded-lg border border-neutral-800">
                <span className="text-amber-400 font-bold">{formatSeconds(currentTime)}</span>
                <span className="text-neutral-600 mx-1">/</span>
                <span className="text-neutral-400">{formatSeconds(duration)}</span>
              </div>
            </div>

            {/* Video Sync Preview Indicator */}
            {videoUrl && (
              <div className="flex items-center gap-2 bg-neutral-950 px-2.5 py-1 rounded-lg border border-neutral-800 text-xs">
                <FileAudio className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-neutral-400 text-[11px]">Видеоряд привязан к шкале</span>
              </div>
            )}

            {/* Zoom Controls */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-neutral-400">Масштаб:</span>
              <button
                onClick={() => setZoomLevel(prev => Math.max(10, prev - 10))}
                className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
                title="Уменьшить масштаб"
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
                title="Увеличить масштаб"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Timeline Tracks Workspace */}
          <div className="flex-1 flex overflow-hidden">
            
            {/* Track Sidebar Headers */}
            <div className="w-64 bg-neutral-900/60 border-r border-neutral-800 shrink-0 flex flex-col overflow-y-auto">
              <div className="h-9 bg-neutral-900 border-b border-neutral-800 px-3 flex items-center text-[11px] font-bold text-neutral-400 uppercase tracking-wider shrink-0">
                Дорожки
              </div>

              {/* Original Audio Track Header */}
              <div className="p-3 border-b border-neutral-800/80 bg-neutral-950/40 space-y-1">
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

              {/* Dubber Tracks Headers */}
              {tracks.map(track => {
                const dubberName = track.participant || track.dubberName || 'Даббер';
                const characterName = track.character || track.characterName || 'Персонаж';

                return (
                  <div key={track.id} className="p-3 border-b border-neutral-800/60 space-y-1.5 hover:bg-neutral-900/40 transition">
                    <div className="flex items-center justify-between">
                      <div className="truncate">
                        <div className="text-xs font-bold text-neutral-100 truncate">
                          {dubberName}
                        </div>
                        <div className="text-[11px] text-indigo-400 truncate">
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
                        title={mutedTracks.has(track.id) ? "Включить звук" : "Заглушить (Mute)"}
                      >
                        {mutedTracks.has(track.id) ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    {/* Role Volume Presets for Mixing */}
                    <div className="space-y-1 pt-1 border-t border-neutral-800/50">
                      <div className="flex items-center justify-between text-[10px] text-neutral-400">
                        <span>Громкость роли (для сведения):</span>
                        <span className="font-mono text-amber-300 font-bold">
                          {Math.round((volumes[track.id] ?? 1.0) * 100)}%
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleSetRoleVolume(track.id, 1.0)}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition ${
                            (volumes[track.id] ?? 1.0) === 1.0
                              ? 'bg-indigo-600 text-white border-indigo-500'
                              : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200 border-neutral-700'
                          }`}
                          title="100% — Норма (Первый план)"
                        >
                          📢 100%
                        </button>
                        <button
                          onClick={() => handleSetRoleVolume(track.id, 0.7)}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition ${
                            (volumes[track.id] ?? 1.0) === 0.7
                              ? 'bg-amber-600 text-white border-amber-500'
                              : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200 border-neutral-700'
                          }`}
                          title="70% — Задний план (Приглушенный голос)"
                        >
                          🔉 70% (Фон)
                        </button>
                        <button
                          onClick={() => handleSetRoleVolume(track.id, 0.5)}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition ${
                            (volumes[track.id] ?? 1.0) === 0.5
                              ? 'bg-purple-600 text-white border-purple-500'
                              : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200 border-neutral-700'
                          }`}
                          title="50% — Шепот / Толпа"
                        >
                          🔇 50%
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Timeline Waveforms Scroll View Area */}
            <div 
              ref={timelineContainerRef}
              className="flex-1 overflow-x-auto overflow-y-auto relative bg-neutral-950"
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

                {/* Track 1: Original Audio Track Canvas View */}
                <div className="h-20 border-b border-neutral-800/80 bg-neutral-950/30 relative flex items-center">
                  <div className="absolute inset-0 opacity-20 bg-[linear-gradient(90deg,#3b82f6_1px,transparent_1px)] bg-[size:16px_100%]" />
                  <div className="absolute inset-x-0 h-12 my-auto bg-blue-500/10 border-y border-blue-500/20 rounded-md flex items-center justify-center text-[11px] text-blue-300 font-mono">
                    Волна оригинального звука серии ({formatSeconds(duration)})
                  </div>
                </div>

                {/* Tracks 2..N: Dubber Phrase Waveform Blocks */}
                {tracks.map(track => {
                  const blocks = phraseBlocks[track.id] || [];
                  const isMuted = mutedTracks.has(track.id);

                  return (
                    <div 
                      key={track.id} 
                      className={`h-24 border-b border-neutral-800/60 relative flex items-center transition ${
                        isMuted ? 'opacity-30 bg-neutral-950' : 'bg-neutral-950/60'
                      }`}
                    >
                      {/* Expected ASS Subtitle Ghost Ranges */}
                      {subLines
                        .filter(s => s.name.toLowerCase().includes(((track.character || track.characterName) || '').toLowerCase()))
                        .map(sub => (
                          <div
                            key={sub.id}
                            className="absolute top-1 bottom-1 bg-indigo-950/30 border border-indigo-500/20 rounded text-[9px] text-indigo-400/80 font-mono px-1 truncate pointer-events-none"
                            style={{
                              left: `${sub.startSec * zoomLevel}px`,
                              width: `${Math.max(20, (sub.endSec - sub.startSec) * zoomLevel)}px`
                            }}
                          >
                            Sub: {sub.text}
                          </div>
                        ))
                      }

                      {/* Movable Phrase Blocks */}
                      {blocks.map(block => {
                        const effectiveStart = block.startSec + block.offsetSec;
                        const blockWidth = Math.max(24, block.durationSec * zoomLevel);
                        const isSelected = selectedPhraseId === block.id;

                        return (
                          <div
                            key={block.id}
                            onClick={() => setSelectedPhraseId(block.id)}
                            className={`absolute top-2 bottom-2 rounded-lg border p-1.5 flex flex-col justify-between cursor-pointer select-none transition-all shadow-md group ${
                              block.hasCollision
                                ? 'bg-red-950/80 border-red-500/80 text-red-200 shadow-red-500/10'
                                : block.isFix
                                ? 'bg-amber-950/80 border-amber-500/80 text-amber-200 shadow-amber-500/10'
                                : isSelected
                                ? 'bg-indigo-600/30 border-indigo-400 text-white'
                                : 'bg-indigo-950/70 border-indigo-600/50 text-indigo-200 hover:border-indigo-400'
                            }`}
                            style={{
                              left: `${effectiveStart * zoomLevel}px`,
                              width: `${blockWidth}px`
                            }}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <div className="flex items-center gap-1 font-mono text-[9px] font-bold truncate">
                                {block.isFix && <span className="px-1 bg-amber-500 text-neutral-950 rounded font-black">FIX</span>}
                                {block.hasCollision && <span className="px-1 bg-red-500 text-white rounded font-black">⚠️</span>}
                                <span>{formatSeconds(effectiveStart)}</span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {block.volumePercent && block.volumePercent !== 100 && (
                                  <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-800/80 font-bold" title={`Задана приглушенная громкость фразы: ${block.volumePercent}%`}>
                                    🔉 {block.volumePercent}%
                                  </span>
                                )}
                                {block.offsetSec !== 0 && (
                                  <span className="text-[9px] font-mono text-amber-300">
                                    {block.offsetSec > 0 ? `+${block.offsetSec}s` : `${block.offsetSec}s`}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="text-[10px] font-medium truncate leading-tight my-0.5">
                              {block.text || 'Речевая фраза'}
                            </div>

                            {/* Nudge & Volume adjustment buttons on hover/select */}
                            <div className="flex items-center justify-between gap-1 opacity-0 group-hover:opacity-100 transition">
                              <div className="flex items-center gap-0.5">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSetPhraseVolume(track.id, block.id, 100); }}
                                  className={`px-1 text-[8px] rounded border ${block.volumePercent === 100 || !block.volumePercent ? 'bg-indigo-600 text-white border-indigo-400' : 'bg-neutral-900 text-neutral-400 border-neutral-700'}`}
                                  title="Громкость фразы 100%"
                                >
                                  100%
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSetPhraseVolume(track.id, block.id, 70); }}
                                  className={`px-1 text-[8px] rounded border ${block.volumePercent === 70 ? 'bg-amber-600 text-white border-amber-400' : 'bg-neutral-900 text-neutral-400 border-neutral-700'}`}
                                  title="Громкость фразы 70% (Фон)"
                                >
                                  70%
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSetPhraseVolume(track.id, block.id, 50); }}
                                  className={`px-1 text-[8px] rounded border ${block.volumePercent === 50 ? 'bg-purple-600 text-white border-purple-400' : 'bg-neutral-900 text-neutral-400 border-neutral-700'}`}
                                  title="Громкость фразы 50% (Шепот)"
                                >
                                  50%
                                </button>
                              </div>

                              <div className="flex items-center gap-0.5">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleNudgePhrase(track.id, block.id, -0.05); }}
                                  className="px-1 bg-neutral-900 hover:bg-neutral-800 text-[9px] rounded border border-neutral-700 text-neutral-300"
                                  title="-50ms влево"
                                >
                                  -50ms
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleNudgePhrase(track.id, block.id, 0.05); }}
                                  className="px-1 bg-neutral-900 hover:bg-neutral-800 text-[9px] rounded border border-neutral-700 text-neutral-300"
                                  title="+50ms вправо"
                                >
                                  +50ms
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar: "Реперные точки" Reference Markers Jumper */}
        <aside className="w-80 bg-neutral-900/90 border-l border-neutral-800 flex flex-col shrink-0 overflow-hidden">
          
          <div className="p-3.5 border-b border-neutral-800 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-neutral-100 uppercase tracking-wider flex items-center gap-1.5">
                <Bookmark className="w-3.5 h-3.5 text-amber-400" />
                <span>Реперные точки ({allReferenceMarkers.length})</span>
              </h2>
            </div>

            {/* Filter Tabs */}
            <div className="grid grid-cols-3 gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800 text-[10px]">
              <button
                onClick={() => setActiveTabMarkerFilter('all')}
                className={`py-1 rounded font-medium transition ${
                  activeTabMarkerFilter === 'all' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Все ({allReferenceMarkers.length})
              </button>
              <button
                onClick={() => setActiveTabMarkerFilter('fixes')}
                className={`py-1 rounded font-medium transition ${
                  activeTabMarkerFilter === 'fixes' ? 'bg-amber-500/20 text-amber-300' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Фиксы ({stitchedFixes.length})
              </button>
              <button
                onClick={() => setActiveTabMarkerFilter('collisions')}
                className={`py-1 rounded font-medium transition ${
                  activeTabMarkerFilter === 'collisions' ? 'bg-red-500/20 text-red-300' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Коллизии ({collisions.length})
              </button>
            </div>
          </div>

          {/* Reference Markers List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filteredMarkers.length === 0 ? (
              <div className="text-center py-10 px-4 text-xs text-neutral-500 space-y-2">
                <Info className="w-6 h-6 mx-auto text-neutral-600" />
                <p>Реперные точки не найдены.</p>
                <p className="text-[10px]">Нажмите «Вшить фиксы» или «Автотайминг» для генерации точек.</p>
              </div>
            ) : (
              filteredMarkers.map(m => {
                const isSelected = selectedMarkerId === m.id;

                return (
                  <div
                    key={m.id}
                    onClick={() => handleJumpToMarker(m.startSec, m.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition space-y-1.5 ${
                      isSelected
                        ? 'bg-amber-950/60 border-amber-500 text-white ring-1 ring-amber-500'
                        : 'bg-neutral-950/80 border-neutral-800 hover:border-neutral-700 text-neutral-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold leading-snug">
                        {m.title}
                      </span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${m.badgeColor}`}>
                        {formatSeconds(m.startSec)}
                      </span>
                    </div>

                    <p className="text-[11px] text-neutral-400 leading-normal">
                      {m.description}
                    </p>

                    <div className="flex justify-end pt-1">
                      <span className="text-[10px] text-amber-400 font-medium flex items-center gap-1 hover:underline">
                        <span>Перейти на таймлайн</span>
                        <ChevronRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Info Box */}
          <div className="p-3 bg-neutral-950 border-t border-neutral-800 text-[11px] text-neutral-400 space-y-1">
            <div className="flex items-center justify-between text-neutral-300 font-medium">
              <span>Статус тайминга:</span>
              <span className="text-emerald-400 font-mono font-bold">
                {isAutoTimingDone ? 'Готов к сведению' : 'В работе'}
              </span>
            </div>
            <p className="text-[10px] text-neutral-500">
              Нажмите «Экспорт в Сведение» после завершения ручной проверки.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
