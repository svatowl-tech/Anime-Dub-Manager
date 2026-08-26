import React from 'react';
import { UserCheck, Users, Check, Sparkles, ChevronDown } from 'lucide-react';
import { SubtitleLine } from '../../types';

interface SpeakerCharacterGridProps {
  speakerMapping: Record<string, string>; // lineId -> "Speaker 1"
  characterAssignments: Record<string, string>; // "Speaker 1" -> "Tanjiro"
  onAssignmentChange: (speaker: string, character: string) => void;
  subLines: SubtitleLine[];
  knownCharacters: string[];
  onApplyAssignments: () => void;
  isSaving: boolean;
}

export const SpeakerCharacterGrid: React.FC<SpeakerCharacterGridProps> = ({
  speakerMapping,
  characterAssignments,
  onAssignmentChange,
  subLines,
  knownCharacters,
  onApplyAssignments,
  isSaving,
}) => {
  // Aggregate stats per speaker
  const uniqueSpeakers = Array.from(new Set(Object.values(speakerMapping))).sort();

  if (uniqueSpeakers.length === 0) {
    return null;
  }

  const getSpeakerStats = (speaker: string) => {
    const linesForSpeaker = subLines.filter(l => speakerMapping[String(l.id)] === speaker);
    const lineCount = linesForSpeaker.length;
    const sampleText = linesForSpeaker.slice(0, 2).map(l => l.text).join(' // ');
    return { lineCount, sampleText };
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 shadow-xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-500/20 text-indigo-400 rounded-lg">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Обнаруженные спикеры ({uniqueSpeakers.length})</h3>
            <p className="text-xs text-neutral-400">Сопоставьте обнаруженные голоса с персонажами тайтла</p>
          </div>
        </div>

        <button
          onClick={onApplyAssignments}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-md transition-colors"
        >
          <Check className="w-4 h-4" />
          Записать персонажей в субтитры
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {uniqueSpeakers.map((speaker) => {
          const { lineCount, sampleText } = getSpeakerStats(speaker);
          const currentChar = characterAssignments[speaker] || '';

          return (
            <div
              key={speaker}
              className="bg-neutral-950/80 border border-neutral-800 rounded-lg p-3.5 flex flex-col justify-between gap-3 hover:border-neutral-700 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-semibold text-xs text-indigo-400 flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5" />
                    {speaker}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 bg-neutral-850 text-neutral-400 rounded-full border border-neutral-800 font-mono">
                    {lineCount} реплик
                  </span>
                </div>

                {sampleText && (
                  <p className="text-[11px] text-neutral-400 italic line-clamp-2 bg-neutral-900/60 p-2 rounded border border-neutral-850">
                    "{sampleText}"
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[10px] text-neutral-500 font-medium uppercase mb-1">
                  Назначить персонажа:
                </label>
                <div className="relative">
                  <input
                    type="text"
                    list={`chars-${speaker}`}
                    placeholder="Введите имя или выберите..."
                    value={currentChar}
                    onChange={(e) => onAssignmentChange(speaker, e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-neutral-900 border border-neutral-700 rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500 font-medium"
                  />
                  <datalist id={`chars-${speaker}`}>
                    {knownCharacters.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
