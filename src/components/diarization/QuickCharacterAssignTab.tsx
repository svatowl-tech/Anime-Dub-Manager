import React, { useState } from 'react';
import { FileSpreadsheet, CheckCircle2, Upload, Check, ShieldCheck, Sparkles, RefreshCw } from 'lucide-react';
import { Episode, SubtitleLine } from '../../types';
import { matchSubtitlesByTiming } from '../../lib/diarization/timingMatcher';
import { ipcSafe } from '../../lib/ipcSafe';
import { toast } from 'sonner';

interface QuickCharacterAssignTabProps {
  currentEpisode: Episode | null;
  subLines: SubtitleLine[];
  onRefresh: () => void;
  onUpdateSubtitles: (updatedLines: SubtitleLine[]) => Promise<void>;
}

export const QuickCharacterAssignTab: React.FC<QuickCharacterAssignTabProps> = ({
  currentEpisode,
  subLines,
  onRefresh,
  onUpdateSubtitles,
}) => {
  const [refFilePath, setRefFilePath] = useState<string>('');
  const [refLines, setRefLines] = useState<SubtitleLine[]>([]);
  const [preserveExisting, setPreserveExisting] = useState<boolean>(true);
  const [ignoreSigns, setIgnoreSigns] = useState<boolean>(true);
  const [minOverlap, setMinOverlap] = useState<number>(0.2);
  const [isLoadingRef, setIsLoadingRef] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [previewStats, setPreviewStats] = useState<{
    mapped: number;
    skipped: number;
    total: number;
    newCharacters: string[];
  } | null>(null);

  const handleSelectReferenceFile = async () => {
    try {
      const res = await ipcSafe.invoke('select-file', {
        title: 'Выберите референсный файл субтитров с персонажами (ASS/SRT)',
        filters: [{ name: 'Subtitles', extensions: ['ass', 'srt'] }]
      });

      const selectedPath = res?.path || res?.filePath;
      if (res && !res.canceled && selectedPath) {
        setRefFilePath(selectedPath);
        setIsLoadingRef(true);
        const data = await ipcSafe.invoke('get-raw-subtitles', selectedPath);
        const loadedLines: SubtitleLine[] = data.lines || data || [];
        setRefLines(loadedLines);

        // Run preliminary match calculation
        const matchResult = matchSubtitlesByTiming(subLines, loadedLines, {
          preserveExistingNames: preserveExisting,
          ignoreSigns,
          minOverlapSecs: minOverlap
        });
        setPreviewStats(matchResult.stats);
        toast.success(`Референсный файл загружен: ${loadedLines.length} строк`);
      }
    } catch (err: any) {
      console.error('Error loading reference file:', err);
      toast.error(`Не удалось загрузить файл: ${err.message}`);
    } finally {
      setIsLoadingRef(false);
    }
  };

  const handleRecalculate = () => {
    if (refLines.length === 0) return;
    const matchResult = matchSubtitlesByTiming(subLines, refLines, {
      preserveExistingNames: preserveExisting,
      ignoreSigns,
      minOverlapSecs: minOverlap
    });
    setPreviewStats(matchResult.stats);
  };

  const handleApplyToSubtitles = async () => {
    if (refLines.length === 0) {
      toast.error('Сначала выберите референсный файл субтитров');
      return;
    }

    if (subLines.length === 0) {
      toast.error('В текущей серии нет субтитров для разметки');
      return;
    }

    setIsApplying(true);
    try {
      const matchResult = matchSubtitlesByTiming(subLines, refLines, {
        preserveExistingNames: preserveExisting,
        ignoreSigns,
        minOverlapSecs: minOverlap
      });

      await onUpdateSubtitles(matchResult.updatedLines);
      toast.success(`Успешно расставлены имена для ${matchResult.stats.mapped} реплик!`);
      onRefresh();
    } catch (err: any) {
      console.error('Error applying character matches:', err);
      toast.error(`Ошибка при сохранении: ${err.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full py-2">
      {/* Header Info Banner */}
      <div className="bg-gradient-to-r from-indigo-900/30 via-neutral-900 to-neutral-900 border border-indigo-500/20 rounded-2xl p-6 shadow-xl">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400 shrink-0">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              Быстрый перенос персонажей из референсных субтитров
            </h3>
            <p className="text-xs text-neutral-300 mt-1 leading-relaxed">
              Мгновенно сопоставляет тайминги ваших переведенных русских субтитров с оригинальными 
              (японскими/английскими) субтитрами, в которых уже прописаны имена персонажей. 
              Работает за секунду без нейросетей с высокой точностью!
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column: Input and Parameters */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl space-y-5">
          <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2">
            <Upload className="w-4 h-4" />
            1. Выбор референсного файла
          </h4>

          <div className="space-y-3">
            <div className="p-4 bg-neutral-950/80 border border-neutral-800 rounded-xl flex flex-col gap-3">
              <div className="text-xs text-neutral-400 truncate">
                {refFilePath ? (
                  <span className="text-white font-mono">{refFilePath.split(/[\\/]/).pop()}</span>
                ) : (
                  'Файл с именами персонажей не выбран'
                )}
              </div>

              <button
                onClick={handleSelectReferenceFile}
                disabled={isLoadingRef || isApplying}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold rounded-lg transition-colors border border-neutral-700 cursor-pointer"
              >
                <Upload className="w-4 h-4 text-indigo-400" />
                {refFilePath ? 'Выбрать другой файл (ASS/SRT)' : 'Выбрать референсный ASS/SRT'}
              </button>
            </div>

            {refLines.length > 0 && (
              <div className="text-[11px] text-emerald-400 flex items-center gap-1.5 px-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Загружено {refLines.length} строк референса
              </div>
            )}
          </div>

          <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2 pt-2 border-t border-neutral-800">
            <ShieldCheck className="w-4 h-4" />
            2. Параметры сопоставления
          </h4>

          <div className="space-y-3">
            <label className="flex items-center justify-between p-3 bg-neutral-950 border border-neutral-850 rounded-xl cursor-pointer hover:bg-neutral-925 transition-colors">
              <div className="flex flex-col pr-3">
                <span className="text-xs font-bold text-white">Сохранять уже назначенные роли</span>
                <span className="text-[10px] text-neutral-500">Не перезаписывать строки, где имя уже указано</span>
              </div>
              <input
                type="checkbox"
                checked={preserveExisting}
                onChange={(e) => {
                  setPreserveExisting(e.target.checked);
                  setTimeout(handleRecalculate, 50);
                }}
                className="rounded border-neutral-700 text-indigo-600 focus:ring-0 w-4 h-4 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between p-3 bg-neutral-950 border border-neutral-850 rounded-xl cursor-pointer hover:bg-neutral-925 transition-colors">
              <div className="flex flex-col pr-3">
                <span className="text-xs font-bold text-white">Игнорировать титры и надписи</span>
                <span className="text-[10px] text-neutral-500">Не переносить имена со строк стилей Sign, Title</span>
              </div>
              <input
                type="checkbox"
                checked={ignoreSigns}
                onChange={(e) => {
                  setIgnoreSigns(e.target.checked);
                  setTimeout(handleRecalculate, 50);
                }}
                className="rounded border-neutral-700 text-indigo-600 focus:ring-0 w-4 h-4 cursor-pointer"
              />
            </label>

            <div className="p-3 bg-neutral-950 border border-neutral-850 rounded-xl space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="text-white font-medium">Мин. перекрытие таймингов</span>
                <span className="text-indigo-400 font-mono font-bold">{minOverlap} сек</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="1.0"
                step="0.05"
                value={minOverlap}
                onChange={(e) => {
                  setMinOverlap(parseFloat(e.target.value));
                  setTimeout(handleRecalculate, 50);
                }}
                className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Right Column: Preview Stats and Apply Action */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              3. Результаты сопоставления
            </h4>

            {previewStats ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-neutral-950 border border-neutral-850 rounded-xl">
                    <div className="text-[10px] text-neutral-500 uppercase font-bold">Будет назначено</div>
                    <div className="text-xl font-bold text-indigo-400 font-mono mt-1">
                      {previewStats.mapped} <span className="text-xs font-normal text-neutral-500">реплик</span>
                    </div>
                  </div>

                  <div className="p-3 bg-neutral-950 border border-neutral-850 rounded-xl">
                    <div className="text-[10px] text-neutral-500 uppercase font-bold">Без изменений</div>
                    <div className="text-xl font-bold text-neutral-300 font-mono mt-1">
                      {previewStats.skipped} <span className="text-xs font-normal text-neutral-500">реплик</span>
                    </div>
                  </div>
                </div>

                {previewStats.newCharacters.length > 0 && (
                  <div className="p-3.5 bg-neutral-950 border border-neutral-850 rounded-xl space-y-2">
                    <div className="text-xs font-bold text-neutral-300">
                      Обнаруженные персонажи ({previewStats.newCharacters.length}):
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                      {previewStats.newCharacters.map(char => (
                        <span
                          key={char}
                          className="px-2 py-0.5 bg-indigo-950/60 border border-indigo-800/40 text-indigo-300 text-[11px] rounded-md font-medium"
                        >
                          {char}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center border border-dashed border-neutral-800 rounded-xl text-neutral-500 text-xs">
                Выберите референсный файл, чтобы рассчитать совпадения
              </div>
            )}
          </div>

          <button
            onClick={handleApplyToSubtitles}
            disabled={isApplying || refLines.length === 0 || !previewStats || previewStats.mapped === 0}
            className="w-full flex items-center justify-center gap-2 py-3.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-bold rounded-xl shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
          >
            {isApplying ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Применение...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Расставить персонажей ({previewStats?.mapped || 0})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
