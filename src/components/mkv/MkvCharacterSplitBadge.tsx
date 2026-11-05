import React from 'react';
import {
  Loader2,
  Users,
  UserMinus,
  UserX,
  Star,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import {
  MkvTrackInfo,
  SubtitleCharacterAnalysis,
  getSplitStatusDisplay
} from '../../lib/mkvSubtitleExtractor';

export interface MkvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  subtitleTracks: MkvTrackInfo[];
  audioTracks: MkvTrackInfo[];
  onConfirmSingle: (selectedSubtitleIndex?: number, selectedAudioIndex?: number) => void;
  onConfirmMultiMerge: (selectedSubtitleTracks: MkvTrackInfo[], selectedAudioIndex?: number) => void;
  isProcessing?: boolean;
}

export function getCharactersDeclension(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'персонажей';
  if (mod10 === 1) return 'персонаж';
  if (mod10 >= 2 && mod10 <= 4) return 'персонажа';
  return 'персонажей';
}

export function computeBestSplitSubIndex(
  subtitleTracks: MkvTrackInfo[],
  trackAnalyses: Record<number, SubtitleCharacterAnalysis>
): number | null {
  let bestIdx = -1;
  let maxScore = -1;

  for (const track of subtitleTracks) {
    const analysis = trackAnalyses[track.index];
    if (!analysis) continue;
    let score = 0;
    if (analysis.isRecommendedForDubbing) score += 1000;
    if (analysis.splitStatus === 'full') score += 500;
    if (analysis.splitStatus === 'partial') score += 100;
    score += analysis.characterCount * 10 + analysis.namedPercentage;

    const lang = (track.tags?.language || '').toLowerCase();
    if (lang.includes('ru')) score += 50;

    if (score > maxScore) {
      maxScore = score;
      bestIdx = track.index;
    }
  }

  if (bestIdx !== -1) return bestIdx;
  if (subtitleTracks.length > 0) return subtitleTracks[0].index;
  return null;
}

export function filterMkvSubtitleTracksByStatus(
  subtitleTracks: MkvTrackInfo[],
  trackAnalyses: Record<number, SubtitleCharacterAnalysis>,
  characterFilter: 'all' | 'full' | 'partial' | 'none' | 'rus'
): MkvTrackInfo[] {
  return subtitleTracks.filter(track => {
    const analysis = trackAnalyses[track.index];
    if (characterFilter === 'all') return true;
    if (characterFilter === 'full') return analysis?.splitStatus === 'full';
    if (characterFilter === 'partial') return analysis?.splitStatus === 'partial';
    if (characterFilter === 'none') return analysis?.splitStatus === 'none';
    if (characterFilter === 'rus') {
      const lang = (track.tags?.language || '').toLowerCase();
      const title = (track.tags?.title || '').toLowerCase();
      return lang.includes('rus') || lang.includes('ru') || title.includes('rus') || title.includes('рус');
    }
    return true;
  });
}

export function CharacterSplitBadge({
  analysis,
  isLoading,
  onToggleExpand,
  isExpanded
}: {
  analysis?: SubtitleCharacterAnalysis;
  isLoading?: boolean;
  onToggleExpand?: () => void;
  isExpanded?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="mt-2 pt-2 border-t border-neutral-800/60 flex items-center gap-1.5 text-[11px] text-neutral-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
        <span>Определение персонажей и ролей...</span>
      </div>
    );
  }

  if (!analysis) return null;

  const display = getSplitStatusDisplay(analysis.splitStatus);

  return (
    <div className="mt-2.5 pt-2 border-t border-neutral-800/60 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Main Status Badge */}
          <div
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${display.badgeClass}`}
            title={display.description}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${display.dotClass}`} />
            {analysis.splitStatus === 'full' && <Users className="w-3.5 h-3.5 shrink-0" />}
            {analysis.splitStatus === 'partial' && <UserMinus className="w-3.5 h-3.5 shrink-0" />}
            {analysis.splitStatus === 'none' && <UserX className="w-3.5 h-3.5 shrink-0" />}
            <span>{display.label}</span>
          </div>

          {/* Recommended for dubbing badge */}
          {analysis.isRecommendedForDubbing && (
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/35 text-amber-300 text-[11px] font-bold">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              <span>Рекомендуется для озвучки</span>
            </div>
          )}

          {/* Details */}
          <span className="text-[11px] text-neutral-400">
            {analysis.splitStatus === 'full' || analysis.splitStatus === 'partial' ? (
              <>
                <strong className="text-neutral-200">{analysis.characterCount}</strong> {getCharactersDeclension(analysis.characterCount)} •{' '}
                <strong className="text-neutral-200">{analysis.namedPercentage}%</strong> строк ({analysis.namedLines}/{analysis.totalLines})
              </>
            ) : (
              <>
                {analysis.totalLines > 0 ? (
                  <span>Сплошной текст без разделения ролей ({analysis.totalLines} строк)</span>
                ) : (
                  <span>Только знаки или без диалогов</span>
                )}
              </>
            )}
          </span>
        </div>

        {/* Expand/Collapse characters toggle */}
        {analysis.allCharacters && analysis.allCharacters.length > 0 && onToggleExpand && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5 hover:underline ml-auto"
          >
            <span>{isExpanded ? 'Скрыть список' : `Все роли (${analysis.characterCount})`}</span>
            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
      </div>

      {/* Visual coverage bar */}
      {analysis.totalLines > 0 && (
        <div className="w-full bg-neutral-800 rounded-full h-1 overflow-hidden flex">
          <div
            className={`h-full transition-all duration-300 ${
              analysis.splitStatus === 'full'
                ? 'bg-emerald-500'
                : analysis.splitStatus === 'partial'
                ? 'bg-amber-500'
                : 'bg-neutral-600'
            }`}
            style={{ width: `${Math.max(analysis.namedPercentage, analysis.namedLines > 0 ? 5 : 0)}%` }}
          />
        </div>
      )}

      {/* Top Characters Chips */}
      {analysis.topCharacters && analysis.topCharacters.length > 0 && !isExpanded && (
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          <span className="text-[10px] text-neutral-500 font-medium">Персонажи:</span>
          {analysis.topCharacters.slice(0, 5).map((char, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-800/90 text-neutral-300 text-[10px] border border-neutral-700/60"
            >
              <span className="font-medium text-white">{char.name}</span>
              <span className="text-neutral-400 text-[9px]">({char.count})</span>
            </span>
          ))}
          {analysis.characterCount > 5 && onToggleExpand && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand();
              }}
              className="px-1.5 py-0.5 rounded bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 text-[10px] border border-indigo-700/50 transition-colors"
            >
              +{analysis.characterCount - 5} еще
            </button>
          )}
        </div>
      )}

      {/* Expanded full characters list */}
      {isExpanded && analysis.allCharacters && analysis.allCharacters.length > 0 && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800 text-[11px] mt-1 space-y-1.5"
        >
          <div className="text-[10px] text-neutral-400 font-medium pb-1 border-b border-neutral-800 flex items-center justify-between">
            <span>Все найденные персонажи ({analysis.characterCount}):</span>
            <span className="text-neutral-500">Количество реплик</span>
          </div>
          <div className="max-h-36 overflow-y-auto pr-1 flex flex-wrap gap-1.5 pt-1">
            {analysis.topCharacters.map((char, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-800 text-neutral-200 border border-neutral-700 text-[10px]"
              >
                <span className="font-semibold text-white">{char.name}</span>
                <span className="text-neutral-400">({char.count})</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
