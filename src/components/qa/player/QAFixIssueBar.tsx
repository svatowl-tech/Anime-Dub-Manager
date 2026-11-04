import React, { useMemo, useState, useRef, useCallback, useEffect } from "react";
import {
  MessageSquare,
  AlertCircle,
  User,
  Trash2,
  SkipForward,
  SkipBack,
  Edit3,
  ChevronDown,
  ChevronUp,
  CheckCircle
} from "lucide-react";
import { toast } from "sonner";
import { Episode, Track, SubtitleLine, Comment } from "../../../types";
import { MissingLineDetection } from "../../../lib/qa/missingLinesDetector";

export interface EnrichedFixItem {
  comment: Comment;
  trackId: string;
  baseDubberId: string;
  dubberName: string;
  characterName: string;
  isAuto: boolean;
}

export interface QAFixIssueBarProps {
  currentEpisode: Episode;
  tracks: Track[];
  selectedTrackId: string | null;
  selectedTrack: Track | undefined;
  currentTime: number;
  isPlaying: boolean;
  handlePause: () => void;
  seekToNext: () => void;
  seekToPrev: () => void;
  handleSeekToTime: (time: number) => void;
  currentCharacter: string | null;
  currentDubberNickname: string | null;
  currentSubtitleText: string | null;
  currentSubId?: string | null;
  handleReassignCharacter: (newCharacterName: string) => Promise<void>;
  isManualDubberOverride: boolean;
  setIsManualDubberOverride: React.Dispatch<React.SetStateAction<boolean>>;
  manualDubberId: string;
  setManualDubberId: React.Dispatch<React.SetStateAction<string>>;
  newComment: string;
  setNewComment: React.Dispatch<React.SetStateAction<string>>;
  handleAddComment: (textOverride?: string) => Promise<void>;
  handleDeleteComment: (trackId: string, commentId: string) => Promise<void>;
  detectedGaps: MissingLineDetection[];
  handleApplyGapFixes: (selectedGaps: MissingLineDetection[]) => Promise<void>;
  isApplyingGapFixes: boolean;
  subLines: SubtitleLine[];
}

export const QAFixIssueBar: React.FC<QAFixIssueBarProps> = ({
  currentEpisode,
  tracks,
  selectedTrackId,
  selectedTrack,
  currentTime,
  isPlaying,
  handlePause,
  seekToNext,
  seekToPrev,
  handleSeekToTime,
  currentCharacter,
  currentDubberNickname,
  currentSubtitleText,
  currentSubId,
  handleReassignCharacter,
  isManualDubberOverride,
  setIsManualDubberOverride,
  manualDubberId,
  setManualDubberId,
  newComment,
  setNewComment,
  handleAddComment,
  handleDeleteComment,
  detectedGaps,
  handleApplyGapFixes,
  isApplyingGapFixes,
  subLines
}) => {
  const [fixesFilterMode, setFixesFilterMode] = useState<'target' | 'all'>('all');
  const [isFixesHistoryExpanded, setIsFixesHistoryExpanded] = useState<boolean>(true);
  const fixInputRef = useRef<HTMLInputElement | null>(null);

  const currentSubIndex = useMemo(() => {
    if (!subLines || subLines.length === 0) return -1;
    let idx = -1;
    for (let i = subLines.length - 1; i >= 0; i--) {
      if (currentTime >= (subLines[i].startSec ?? 0) - 0.05) {
        idx = i;
        break;
      }
    }
    return idx;
  }, [subLines, currentTime]);

  const activeSubLine = useMemo(() => {
    if (currentSubIndex >= 0 && subLines[currentSubIndex]) {
      return subLines[currentSubIndex];
    }
    return null;
  }, [subLines, currentSubIndex]);

  const availableDubbers = useMemo(() => {
    const list: Array<{ id: string; name: string; roles: string; trackId?: string }> = [];
    const seen = new Set<string>();

    (currentEpisode?.assignments || []).forEach(a => {
      const dId = a.substituteId || a.dubberId;
      if (!dId) return;
      const nick = a.substitute?.nickname || a.dubber?.nickname || a.characterName || 'Даббер';
      if (!seen.has(dId)) {
        seen.add(dId);
        const dubberRoles = (currentEpisode?.assignments || [])
          .filter(other => (other.substituteId || other.dubberId) === dId)
          .map(other => other.characterName)
          .filter(Boolean);

        const matchingTrack = tracks.find(t => t.id === dId || t.id.startsWith(dId + '__'));
        list.push({
          id: dId,
          name: nick,
          roles: dubberRoles.join(', '),
          trackId: matchingTrack?.id || dId
        });
      }
    });

    tracks.forEach(t => {
      if (t.id === 'original') return;
      const baseId = t.id.split('__')[0];
      if (!seen.has(baseId)) {
        seen.add(baseId);
        list.push({
          id: baseId,
          name: t.participant,
          roles: t.character,
          trackId: t.id
        });
      }
    });

    return list;
  }, [currentEpisode?.assignments, tracks]);

  useEffect(() => {
    if (!manualDubberId && availableDubbers.length > 0) {
      setManualDubberId(availableDubbers[0].id);
    }
  }, [availableDubbers, manualDubberId, setManualDubberId]);

  const allEpisodeFixes = useMemo<EnrichedFixItem[]>(() => {
    const seenIds = new Set<string>();
    const list: EnrichedFixItem[] = [];

    tracks.forEach(t => {
      if (t.id === 'original') return;
      const baseDubberId = t.id.split('__')[0];
      (t.comments || []).forEach(c => {
        if (seenIds.has(c.id)) return;
        seenIds.add(c.id);
        const isAuto = Boolean(c.author && (c.author.includes('Авто') || c.author.includes('Auto')));
        list.push({
          comment: c,
          trackId: t.id,
          baseDubberId,
          dubberName: t.participant || 'Даббер',
          characterName: t.character || '',
          isAuto
        });
      });
    });

    return list.sort((a, b) => a.comment.timestamp - b.comment.timestamp);
  }, [tracks]);

  const activeTargetDubber = useMemo(() => {
    if (isManualDubberOverride && manualDubberId) {
      const found = availableDubbers.find(d => d.id === manualDubberId);
      if (found) return found;
    }
    if (selectedTrackId && selectedTrackId !== 'all' && selectedTrack) {
      const baseId = selectedTrack.id.split('__')[0];
      return {
        id: baseId,
        name: selectedTrack.participant,
        roles: selectedTrack.character,
        trackId: selectedTrack.id
      };
    }
    if (currentDubberNickname) {
      const foundByNick = availableDubbers.find(
        d => d.name.toLowerCase() === currentDubberNickname.toLowerCase()
      );
      if (foundByNick) return foundByNick;
    }
    return null;
  }, [isManualDubberOverride, manualDubberId, availableDubbers, selectedTrackId, selectedTrack, currentDubberNickname]);

  const isFixOnCurrentPhrase = useCallback(
    (item: EnrichedFixItem): boolean => {
      const c = item.comment;
      if (currentSubId && c.subId && String(c.subId) === String(currentSubId)) {
        return true;
      }
      if (activeSubLine) {
        const start = (activeSubLine.startSec ?? 0) - 1.2;
        const end = Math.max((activeSubLine.endSec ?? 0) + 1.2, (activeSubLine.startSec ?? 0) + 2.5);
        if (c.timestamp >= start && c.timestamp <= end) {
          return true;
        }
      }
      return Math.abs(c.timestamp - currentTime) <= 2.2;
    },
    [currentSubId, activeSubLine, currentTime]
  );

  const currentPhraseFixes = useMemo(() => {
    return allEpisodeFixes.filter(isFixOnCurrentPhrase);
  }, [allEpisodeFixes, isFixOnCurrentPhrase]);

  const currentPhraseUnappliedGaps = useMemo(() => {
    if (!detectedGaps || detectedGaps.length === 0) return [];
    return detectedGaps.filter(g => {
      const inRange = activeSubLine
        ? g.startSec >= (activeSubLine.startSec ?? 0) - 1.2 && g.startSec <= Math.max((activeSubLine.endSec ?? 0) + 1.2, (activeSubLine.startSec ?? 0) + 2.5)
        : Math.abs(g.startSec - currentTime) <= 2.2;
      if (!inRange) return false;
      const gBaseId = (g.trackId || '').split('__')[0];
      const alreadyApplied = currentPhraseFixes.some(
        f => Math.abs(f.comment.timestamp - g.startSec) <= 2.0 && (f.trackId === g.trackId || f.baseDubberId === gBaseId || f.dubberName === g.dubberName)
      );
      return !alreadyApplied;
    });
  }, [detectedGaps, activeSubLine, currentTime, currentPhraseFixes]);

  const filteredFixesFeed = useMemo(() => {
    if (fixesFilterMode === 'target' && activeTargetDubber) {
      return allEpisodeFixes.filter(
        item =>
          item.baseDubberId === activeTargetDubber.id ||
          item.dubberName.toLowerCase() === activeTargetDubber.name.toLowerCase()
      );
    }
    return allEpisodeFixes;
  }, [allEpisodeFixes, fixesFilterMode, activeTargetDubber]);

  const handleReplaceFix = async (item: EnrichedFixItem) => {
    setNewComment(item.comment.text);
    if (item.baseDubberId) {
      setIsManualDubberOverride(true);
      setManualDubberId(item.baseDubberId);
    }
    await handleDeleteComment(item.trackId, item.comment.id);
    toast.info(`Фикс «${item.dubberName}» перенесен в поле ввода для замены`);
    setTimeout(() => {
      fixInputRef.current?.focus();
    }, 50);
  };

  const formatTimeShort = (sec: number) => {
    const safeSec = Math.max(0, Number.isFinite(sec) ? sec : 0);
    return new Date(safeSec * 1000).toISOString().substr(14, 5);
  };

  const hasPhraseActivity = currentPhraseFixes.length > 0 || currentPhraseUnappliedGaps.length > 0;

  return (
    <div className="bg-neutral-900/95 border border-neutral-800 rounded-xl p-3 space-y-2.5 shrink-0">
      {/* Top bar: Subtitle speaker, Subtitle Navigation & Manual Dubber checkbox */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${
            currentCharacter 
              ? 'bg-blue-950/40 border-blue-600/50 text-blue-300' 
              : 'bg-neutral-800 border-neutral-700 text-neutral-400'
          }`}>
            <User className="w-3.5 h-3.5" />
            <span>{currentCharacter ? (currentDubberNickname ? `${currentDubberNickname} (${currentCharacter})` : currentCharacter) : 'Вне сабов'}</span>
          </div>

          {currentPhraseFixes.length > 0 && (
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[11px] font-semibold animate-pulse"
              title="На эту фразу уже выписан фикс"
            >
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>На фразе: {currentPhraseFixes.length} фикс(а)</span>
            </div>
          )}

          <div className="flex items-center gap-1 bg-neutral-950 p-0.5 rounded-lg border border-neutral-800 shadow-inner">
            <button
              type="button"
              onClick={seekToPrev}
              disabled={subLines.length === 0}
              className="px-2 py-1 rounded bg-neutral-850 hover:bg-neutral-750 text-neutral-200 hover:text-white text-xs font-semibold flex items-center gap-1 transition disabled:opacity-40 disabled:cursor-not-allowed"
              title="Перейти к предыдущему субтитру (Shift+A / Alt+Left)"
            >
              <SkipBack className="w-3.5 h-3.5 text-blue-400" />
              <span>Пред. саб</span>
            </button>

            <span className="text-[11px] font-mono text-neutral-400 px-2 select-none">
              {currentSubIndex >= 0 ? `${currentSubIndex + 1}` : '–'} / {subLines.length}
            </span>

            <button
              type="button"
              onClick={seekToNext}
              disabled={subLines.length === 0}
              className="px-2 py-1 rounded bg-neutral-850 hover:bg-neutral-750 text-neutral-200 hover:text-white text-xs font-semibold flex items-center gap-1 transition disabled:opacity-40 disabled:cursor-not-allowed"
              title="Перейти к следующему субтитру (Shift+D / Alt+Right)"
            >
              <span>След. саб</span>
              <SkipForward className="w-3.5 h-3.5 text-blue-400" />
            </button>
          </div>

          {currentCharacter && currentEpisode && (
            <div className="flex items-center gap-1.5 text-xs text-neutral-400">
              <span className="text-[10px]">Роль:</span>
              <select 
                className="bg-neutral-800 border border-neutral-700 text-white text-[10px] rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={currentCharacter}
                onChange={(e) => handleReassignCharacter(e.target.value)}
              >
                <option value={currentCharacter}>{currentCharacter}</option>
                {currentEpisode.assignments?.map(a => a.characterName)
                  .filter(name => name !== currentCharacter)
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))
                }
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 bg-neutral-950/80 px-2.5 py-1 rounded-lg border border-neutral-800">
          <label className="flex items-center gap-1.5 text-xs text-neutral-300 cursor-pointer select-none font-medium">
            <input
              type="checkbox"
              checked={isManualDubberOverride}
              onChange={(e) => {
                setIsManualDubberOverride(e.target.checked);
                if (e.target.checked && !manualDubberId && availableDubbers.length > 0) {
                  setManualDubberId(availableDubbers[0].id);
                }
              }}
              className="rounded border-neutral-700 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 accent-blue-600 cursor-pointer"
            />
            <span>Указать дабера:</span>
          </label>

          {isManualDubberOverride ? (
            <select
              value={manualDubberId}
              onChange={(e) => setManualDubberId(e.target.value)}
              className="bg-neutral-850 border border-blue-500/60 text-blue-200 text-xs font-semibold rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400 max-w-[200px]"
            >
              {availableDubbers.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name} {d.roles ? `(${d.roles})` : ''}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[11px] text-neutral-500 italic">
              (авто: {currentDubberNickname || selectedTrack?.participant || 'по фразе'})
            </span>
          )}
        </div>
      </div>

      {currentSubtitleText && (
        <div className="text-xs text-amber-200/90 bg-neutral-950/60 px-3 py-1.5 rounded-lg border border-neutral-800/80 flex items-center justify-between gap-2">
          <span className="italic truncate">"{currentSubtitleText}"</span>
          <button
            type="button"
            onClick={() => setNewComment(prev => prev ? `${prev} [${currentSubtitleText}]` : `[${currentSubtitleText}] `)}
            className="text-[10px] text-blue-400 hover:text-blue-300 font-medium shrink-0 underline ml-2"
            title="Вставить текст текущего субтитра в поле правки"
          >
            Вставить текст
          </button>
        </div>
      )}

      {/* Input & Send Action */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input 
            ref={fixInputRef}
            type="text" 
            value={newComment}
            onChange={(e) => {
              setNewComment(e.target.value);
              if (isPlaying && e.target.value.length > 0) {
                handlePause();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddComment();
              if (e.key === ' ') {
                e.stopPropagation();
              }
            }}
            placeholder={
              isManualDubberOverride
                ? `Выписать фикс дабберу «${availableDubbers.find(d => d.id === manualDubberId)?.name || 'Выбранному'}» на ${formatTimeShort(currentTime)}...`
                : "Добавить замечание / фикс на этой секунде (Enter)..."
            }
            className="w-full bg-neutral-850 border border-neutral-700 text-white rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-neutral-500"
          />
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-neutral-500 pointer-events-none">
            [F — быстрый фикс]
          </div>
        </div>
        <button 
          type="button"
          onClick={() => handleAddComment()}
          disabled={!newComment.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white rounded-lg transition-colors font-bold text-sm shrink-0 flex items-center gap-1.5 shadow-md shadow-blue-600/20"
        >
          <MessageSquare className="w-4 h-4" />
          <span>Выписать фикс</span>
        </button>
      </div>

      {/* BOTTOM FIX INDICATION & MANAGEMENT PANEL */}
      <div className="pt-2 border-t border-neutral-800/80 space-y-2">
        {hasPhraseActivity ? (
          <div className="rounded-lg bg-amber-950/25 border border-amber-500/35 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>
                  На текущую фразу уже есть правки ({currentPhraseFixes.length} выписано
                  {currentPhraseUnappliedGaps.length > 0 ? `, ${currentPhraseUnappliedGaps.length} найдено авто-поиском` : ''})
                </span>
              </div>
              <span className="text-[10px] text-amber-400/80">
                Можно переписать на другого дабера или удалить
              </span>
            </div>

            <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
              {currentPhraseFixes.map(item => (
                <div
                  key={item.comment.id}
                  className="flex items-center justify-between gap-2 bg-neutral-950/85 border border-amber-500/25 rounded-md px-2.5 py-1.5 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => handleSeekToTime(item.comment.timestamp)}
                      className="font-mono text-[11px] font-bold text-amber-300 hover:text-amber-200 bg-amber-500/10 px-1.5 py-0.5 rounded shrink-0"
                      title="Перейти к таймкоду фикса"
                    >
                      {formatTimeShort(item.comment.timestamp)}
                    </button>

                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${
                        item.isAuto
                          ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                          : 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                      }`}
                    >
                      {item.isAuto ? 'АВТО' : 'ВРУЧНУЮ'}
                    </span>

                    <span className="text-[11px] font-bold text-white shrink-0">
                      {item.dubberName}
                      {item.characterName ? (
                        <span className="text-neutral-400 font-normal"> ({item.characterName})</span>
                      ) : null}
                      :
                    </span>

                    <span className="text-neutral-200 truncate" title={item.comment.text}>
                      {item.comment.text}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleReplaceFix(item)}
                      className="px-2 py-0.5 rounded bg-blue-600/20 hover:bg-blue-600/35 text-blue-300 border border-blue-500/30 text-[10px] font-semibold flex items-center gap-1 transition-colors"
                      title="Удалить этот фикс и перенести его текст в поле ввода для исправления / смены дабера"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Заменить</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteComment(item.trackId, item.comment.id)}
                      className="p-1 rounded bg-red-500/15 hover:bg-red-500/30 text-red-400 border border-red-500/25 transition-colors"
                      title="Удалить неправильный фикс"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              {currentPhraseUnappliedGaps.map(gap => (
                <div
                  key={gap.id}
                  className="flex items-center justify-between gap-2 bg-neutral-950/60 border border-purple-500/30 rounded-md px-2.5 py-1.5 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => handleSeekToTime(gap.startSec)}
                      className="font-mono text-[11px] font-bold text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded shrink-0"
                    >
                      {formatTimeShort(gap.startSec)}
                    </button>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 shrink-0">
                      КАНДИДАТ (АВТО)
                    </span>
                    <span className="text-[11px] font-bold text-white shrink-0">
                      {gap.dubberName} ({gap.characterName}):
                    </span>
                    <span className="text-neutral-300 truncate" title={gap.comment || gap.text}>
                      [{gap.typeLabel}] «{gap.text}»
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleApplyGapFixes([gap])}
                    disabled={isApplyingGapFixes}
                    className="px-2 py-0.5 rounded bg-purple-600/25 hover:bg-purple-600/40 text-purple-200 border border-purple-500/40 text-[10px] font-semibold shrink-0 transition-colors"
                    title="Выписать этот авто-найденный фикс даберу"
                  >
                    + Выписать
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between px-2 py-1 rounded bg-neutral-950/50 border border-neutral-800/60 text-[11px] text-neutral-500">
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-500/70" />
              <span>На текущей фразе ({formatTimeShort(currentTime)}) выписанных фиксов нет</span>
            </div>
            {activeTargetDubber && (
              <span>
                Целевой дабер: <strong className="text-neutral-300">{activeTargetDubber.name}</strong>
              </span>
            )}
          </div>
        )}

        {/* Collapsible Strip of Previously Issued Fixes */}
        {allEpisodeFixes.length > 0 && (
          <div className="bg-neutral-950/70 border border-neutral-800/90 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-2.5 py-1.5 bg-neutral-900/60 border-b border-neutral-800/60">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsFixesHistoryExpanded(prev => !prev)}
                  className="flex items-center gap-1 text-[11px] font-bold text-neutral-300 hover:text-white transition-colors"
                >
                  {isFixesHistoryExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5 text-blue-400" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-blue-400" />
                  )}
                  <span>Выписанные фиксы ({filteredFixesFeed.length})</span>
                </button>

                <div className="flex items-center bg-neutral-950 rounded p-0.5 border border-neutral-800 text-[10px]">
                  <button
                    type="button"
                    onClick={() => {
                      setFixesFilterMode('all');
                      setIsFixesHistoryExpanded(true);
                    }}
                    className={`px-2 py-0.5 rounded transition-colors font-medium ${
                      fixesFilterMode === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    Все даберы ({allEpisodeFixes.length})
                  </button>
                  {activeTargetDubber && (
                    <button
                      type="button"
                      onClick={() => {
                        setFixesFilterMode('target');
                        setIsFixesHistoryExpanded(true);
                      }}
                      className={`px-2 py-0.5 rounded transition-colors font-medium ${
                        fixesFilterMode === 'target'
                          ? 'bg-blue-600 text-white'
                          : 'text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      Только {activeTargetDubber.name} (
                      {
                        allEpisodeFixes.filter(
                          i =>
                            i.baseDubberId === activeTargetDubber.id ||
                            i.dubberName.toLowerCase() === activeTargetDubber.name.toLowerCase()
                        ).length
                      }
                      )
                    </button>
                  )}
                </div>
              </div>

              <span className="text-[10px] text-neutral-500 hidden sm:inline">
                Клик по таймкоду — переход · «Заменить» — переписать фикс
              </span>
            </div>

            {isFixesHistoryExpanded && (
              <div className="max-h-28 overflow-y-auto divide-y divide-neutral-800/50">
                {filteredFixesFeed.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-neutral-500 italic">
                    Для выбранного дабера пока нет выписанных фиксов.
                  </div>
                ) : (
                  filteredFixesFeed.map(item => {
                    const isCurrent = isFixOnCurrentPhrase(item);
                    return (
                      <div
                        key={item.comment.id}
                        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs transition-colors ${
                          isCurrent
                            ? 'bg-amber-500/10 hover:bg-amber-500/15'
                            : 'hover:bg-neutral-900/80'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => handleSeekToTime(item.comment.timestamp)}
                            className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 transition-colors ${
                              isCurrent
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : 'bg-neutral-800 text-blue-400 hover:bg-neutral-700'
                            }`}
                            title="Перейти к секунде фикса"
                          >
                            {formatTimeShort(item.comment.timestamp)}
                          </button>

                          <span
                            className={`text-[9px] font-semibold px-1 py-0.5 rounded shrink-0 ${
                              item.isAuto
                                ? 'bg-purple-500/15 text-purple-300'
                                : 'bg-neutral-800 text-neutral-400'
                            }`}
                          >
                            {item.isAuto ? 'Авто' : 'Ручн.'}
                          </span>

                          <span className="text-[11px] font-semibold text-neutral-200 shrink-0">
                            {item.dubberName}:
                          </span>

                          <span className="text-neutral-300 truncate" title={item.comment.text}>
                            {item.comment.text}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleReplaceFix(item)}
                            className="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-blue-600/30 text-neutral-300 hover:text-blue-200 text-[10px] flex items-center gap-1 transition-colors"
                            title="Заменить / переписать этот фикс"
                          >
                            <Edit3 className="w-2.5 h-2.5" />
                            <span>Заменить</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(item.trackId, item.comment.id)}
                            className="p-1 rounded text-neutral-500 hover:text-red-400 hover:bg-red-500/15 transition-colors"
                            title="Удалить этот фикс"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
