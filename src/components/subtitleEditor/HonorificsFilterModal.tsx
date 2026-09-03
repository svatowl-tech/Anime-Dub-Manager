import React, { useState, useMemo } from 'react';
import { X, Sparkles, Check, Filter, AlertCircle, ArrowRight } from 'lucide-react';
import { HonorificsOptions, DEFAULT_HONORIFICS_OPTIONS, filterHonorificsFromAssText } from '../../lib/honorificsFilter';

interface HonorificsFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (options: HonorificsOptions) => void;
  subtitles: Array<{ id?: string | number; rawLineIndex?: number; text?: string; [key: string]: any }>;
  isProcessing?: boolean;
}

export const HonorificsFilterModal: React.FC<HonorificsFilterModalProps> = ({
  isOpen,
  onClose,
  onApply,
  subtitles,
  isProcessing = false
}) => {
  const [options, setOptions] = useState<HonorificsOptions>(DEFAULT_HONORIFICS_OPTIONS);

  // Compute preview diffs
  const { changedCount, previews } = useMemo(() => {
    let count = 0;
    const diffs: Array<{ original: string; cleaned: string }> = [];

    for (const sub of subtitles) {
      if (!sub.text) continue;
      const { cleanedText, modified } = filterHonorificsFromAssText(sub.text, options);
      if (modified) {
        count++;
        if (diffs.length < 5) {
          diffs.push({ original: sub.text, cleaned: cleanedText });
        }
      }
    }

    return { changedCount: count, previews: diffs };
  }, [subtitles, options]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Фильтрация японских обращений</h3>
              <p className="text-xs text-neutral-400">Удаление суффиксов (-кун, -тян, -сан, -сама, -сэнсэй) из сабов</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 overflow-y-auto custom-scrollbar flex-1">
          {/* Options list */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-neutral-300 uppercase tracking-wider block">
              Настройки очистки
            </label>

            <div className="grid grid-cols-1 gap-2.5">
              <label className="flex items-start gap-3 p-3 bg-neutral-950/40 border border-neutral-800/80 rounded-xl cursor-pointer hover:border-neutral-700 transition-colors">
                <input
                  type="checkbox"
                  checked={options.removeSuffixes !== false}
                  onChange={e => setOptions(prev => ({ ...prev, removeSuffixes: e.target.checked }))}
                  className="mt-0.5 rounded border-neutral-700 text-indigo-600 focus:ring-indigo-500 bg-neutral-900"
                />
                <div>
                  <div className="text-sm font-medium text-white">Именные суффиксы через дефис</div>
                  <div className="text-xs text-neutral-400">
                    Удаляет <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-кун</code>, <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-тян</code>, <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-сан</code>, <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-сама</code>, <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-сэнсэй</code>, <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-сэмпай</code>, <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-доно</code>, <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-тан</code>, <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-чи</code>
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 bg-neutral-950/40 border border-neutral-800/80 rounded-xl cursor-pointer hover:border-neutral-700 transition-colors">
                <input
                  type="checkbox"
                  checked={options.removeSpaced !== false}
                  onChange={e => setOptions(prev => ({ ...prev, removeSpaced: e.target.checked }))}
                  className="mt-0.5 rounded border-neutral-700 text-indigo-600 focus:ring-indigo-500 bg-neutral-900"
                />
                <div>
                  <div className="text-sm font-medium text-white">Обращения с пробелом после имени</div>
                  <div className="text-xs text-neutral-400">
                    Например: <span className="text-neutral-300">«Танака кун»</span> → <span className="text-emerald-400">«Танака»</span>, <span className="text-neutral-300">«Какаши сенсей»</span> → <span className="text-emerald-400">«Какаши»</span>
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 bg-neutral-950/40 border border-neutral-800/80 rounded-xl cursor-pointer hover:border-neutral-700 transition-colors">
                <input
                  type="checkbox"
                  checked={options.removeRelatives !== false}
                  onChange={e => setOptions(prev => ({ ...prev, removeRelatives: e.target.checked }))}
                  className="mt-0.5 rounded border-neutral-700 text-indigo-600 focus:ring-indigo-500 bg-neutral-900"
                />
                <div>
                  <div className="text-sm font-medium text-white">Обращения к родственникам</div>
                  <div className="text-xs text-neutral-400">
                    Удаляет суффиксы <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-они-чан</code>, <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-оне-сан</code>, <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-нии-сан</code>
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 bg-neutral-950/40 border border-neutral-800/80 rounded-xl cursor-pointer hover:border-neutral-700 transition-colors">
                <input
                  type="checkbox"
                  checked={options.removeStandalone !== false}
                  onChange={e => setOptions(prev => ({ ...prev, removeStandalone: e.target.checked }))}
                  className="mt-0.5 rounded border-neutral-700 text-indigo-600 focus:ring-indigo-500 bg-neutral-900"
                />
                <div>
                  <div className="text-sm font-medium text-white">Отдельные обращения без имен</div>
                  <div className="text-xs text-neutral-400">
                    Например: <span className="text-neutral-300">«Сэнсэй, помогите!»</span> → <span className="text-emerald-400">«Помогите!»</span>, <span className="text-neutral-300">«Привет, сэмпай!»</span> → <span className="text-emerald-400">«Привет!»</span>
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 bg-neutral-950/40 border border-neutral-800/80 rounded-xl cursor-pointer hover:border-neutral-700 transition-colors">
                <input
                  type="checkbox"
                  checked={options.removeLatin !== false}
                  onChange={e => setOptions(prev => ({ ...prev, removeLatin: e.target.checked }))}
                  className="mt-0.5 rounded border-neutral-700 text-indigo-600 focus:ring-indigo-500 bg-neutral-900"
                />
                <div>
                  <div className="text-sm font-medium text-white">Латинские суффиксы (English/Romaji)</div>
                  <div className="text-xs text-neutral-400">
                    Удаляет <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-kun</code>, <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-chan</code>, <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-san</code>, <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-sama</code>, <code className="text-indigo-300 bg-neutral-800 px-1 rounded">-sensei</code>
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Stats & Previews */}
          <div className="space-y-3 pt-2 border-t border-neutral-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">Предпросмотр</span>
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${changedCount > 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-neutral-800 text-neutral-400'}`}>
                {changedCount > 0 ? `Найдено реплик: ${changedCount}` : 'Обращений не обнаружено'}
              </span>
            </div>

            {previews.length > 0 ? (
              <div className="space-y-2">
                {previews.map((diff, i) => (
                  <div key={i} className="p-3 bg-neutral-950/80 border border-neutral-800 rounded-xl text-xs space-y-1">
                    <div className="text-red-400/90 line-through truncate font-mono">
                      {diff.original}
                    </div>
                    <div className="flex items-center gap-1.5 text-emerald-400 font-mono">
                      <ArrowRight className="w-3 h-3 shrink-0" />
                      <span className="truncate">{diff.cleaned}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 bg-neutral-950/40 border border-neutral-800/80 rounded-xl text-xs text-neutral-500 text-center flex items-center justify-center gap-2">
                <AlertCircle className="w-4 h-4" />
                С выбранными настройками японские обращения в текущем списке сабов не найдены.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-950/80 flex items-center justify-between">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-medium transition-colors cursor-pointer"
          >
            Отмена
          </button>
          <button
            onClick={() => onApply(options)}
            disabled={isProcessing || changedCount === 0}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white rounded-xl text-xs font-semibold transition-all shadow-lg shadow-indigo-600/20 flex items-center gap-2 cursor-pointer"
          >
            <Filter className="w-3.5 h-3.5" />
            Применить к сабам ({changedCount})
          </button>
        </div>
      </div>
    </div>
  );
};
