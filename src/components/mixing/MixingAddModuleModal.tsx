import React, { useState, useMemo } from 'react';
import {
  Layers,
  Plus,
  Search,
  Sparkles,
  Check,
  Download,
  Cpu,
  Sliders,
  Volume2,
  Shield,
  Wand2,
  X
} from 'lucide-react';
import { MixingModuleDef, PipelineStep } from '../../types';

export interface MixingAddModuleModalProps {
  isOpen: boolean;
  onClose: () => void;
  moduleDatabase: MixingModuleDef[];
  currentPipeline: PipelineStep[];
  onAddModule: (modDef: MixingModuleDef) => void;
  onDownloadModel?: (modelId: string) => void;
  isDownloadingModel?: boolean;
  downloadPercent?: number;
}

const CATEGORY_META: Record<string, { label: string; badgeClass: string }> = {
  all: { label: 'Все модули', badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
  timing: { label: 'Тайминг и липсинк', badgeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  cleaning: { label: 'Очистка и гейт', badgeClass: 'bg-teal-500/15 text-teal-300 border-teal-500/30' },
  denoise: { label: 'Шумоподавление (AI)', badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  dereverb: { label: 'Удаление эха / реверба', badgeClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  separation: { label: 'Разделение стемов', badgeClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  timbre: { label: 'Калибровка тембра', badgeClass: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30' },
  analysis: { label: 'Акустический перенос', badgeClass: 'bg-pink-500/15 text-pink-300 border-pink-500/30' },
  vocal_match: { label: 'Посадка в микс', badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  equalization: { label: 'Эквализация (EQ)', badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  dynamics: { label: 'Компрессия и динамика', badgeClass: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  loudness: { label: 'Громкость и LUFS', badgeClass: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30' },
  restoration: { label: 'Реставрация голоса', badgeClass: 'bg-lime-500/15 text-lime-300 border-lime-500/30' },
  effects: { label: 'Пространство и FX', badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  vst3: { label: 'VST3 Плагины', badgeClass: 'bg-purple-500/20 text-purple-200 border-purple-400/40' },
  balance: { label: 'Дакинг и баланс', badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  mastering: { label: 'Мастеринг шин', badgeClass: 'bg-red-500/15 text-red-300 border-red-500/30' },
  export: { label: 'Сборка видео / мультиплекс', badgeClass: 'bg-neutral-500/20 text-neutral-200 border-neutral-500/40' }
};

export const MixingAddModuleModal: React.FC<MixingAddModuleModalProps> = ({
  isOpen,
  onClose,
  moduleDatabase,
  currentPipeline,
  onAddModule,
  onDownloadModel,
  isDownloadingModel = false,
  downloadPercent = 0
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [keepOpenOnAdd, setKeepOpenOnAdd] = useState<boolean>(false);

  const countInPipelineByModId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const step of currentPipeline || []) {
      map[step.moduleId] = (map[step.moduleId] || 0) + 1;
    }
    return map;
  }, [currentPipeline]);

  const categoriesWithCounts = useMemo(() => {
    const counts: Record<string, number> = { all: moduleDatabase.length };
    for (const mod of moduleDatabase) {
      const cat = mod.category || 'other';
      counts[cat] = (counts[cat] || 0) + 1;
    }
    const orderedKeys = [
      'all',
      ...Object.keys(CATEGORY_META).filter((k) => k !== 'all' && counts[k] > 0),
      ...Object.keys(counts).filter((k) => k !== 'all' && !CATEGORY_META[k])
    ];
    return orderedKeys.map((key) => ({
      key,
      label: CATEGORY_META[key]?.label || key,
      count: counts[key] || 0
    }));
  }, [moduleDatabase]);

  const filteredModules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return moduleDatabase.filter((mod) => {
      if (selectedCategory !== 'all' && mod.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        mod.id,
        mod.title,
        mod.name,
        mod.description,
        mod.engineArchitecture,
        mod.recommended_for,
        CATEGORY_META[mod.category]?.label
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [moduleDatabase, selectedCategory, searchQuery]);

  if (!isOpen) return null;

  const handleSelectModule = (mod: MixingModuleDef) => {
    onAddModule(mod);
    if (!keepOpenOnAdd) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-4xl max-h-[86vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-600/20 text-purple-400 rounded-xl border border-purple-500/30">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-neutral-100 flex items-center gap-2">
                <span>Каталог модулей сведения и DSP / AI обработки</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-950/80 text-purple-300 border border-purple-700/50 font-mono">
                  {moduleDatabase.length} в базе
                </span>
              </h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                Выберите модуль для добавления в конец цепочки (порядок шагов можно менять стрелками в конвейере)
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition"
            title="Закрыть каталог"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Category Filter Bar */}
        <div className="px-6 py-3 bg-neutral-950/60 border-b border-neutral-800/80 space-y-2.5 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск по названию, архитектуре (DeepFilterNet, Demucs, Pedalboard, VST3, LUFS, EQ)..."
                className="w-full pl-9 pr-8 py-2 bg-neutral-900 border border-neutral-800 rounded-xl text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-purple-500 transition"
                autoFocus
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer select-none shrink-0 bg-neutral-900 px-3 py-2 rounded-xl border border-neutral-800 hover:border-neutral-700 transition">
              <input
                type="checkbox"
                checked={keepOpenOnAdd}
                onChange={(e) => setKeepOpenOnAdd(e.target.checked)}
                className="rounded border-neutral-700 bg-neutral-950 text-purple-600 focus:ring-purple-500"
              />
              <span>Не закрывать окно (пакетное добавление)</span>
            </label>
          </div>

          {/* Categories Horizontal Scroll / Wrap */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {categoriesWithCounts.map((cat) => {
              const isActive = selectedCategory === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => setSelectedCategory(cat.key)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap border transition flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-purple-600 text-white border-purple-500 shadow-sm'
                      : 'bg-neutral-900/90 text-neutral-400 border-neutral-800 hover:bg-neutral-800 hover:text-neutral-200'
                  }`}
                >
                  <span>{cat.label}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      isActive ? 'bg-purple-800/80 text-purple-100' : 'bg-neutral-800 text-neutral-400'
                    }`}
                  >
                    {cat.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Modules Grid */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          {filteredModules.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-sm text-neutral-400">
                По запросу «{searchQuery}» в выбранной категории модулей не найдено.
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('all');
                }}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs transition"
              >
                Сбросить фильтры
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredModules.map((mod) => {
                const catInfo = CATEGORY_META[mod.category] || {
                  label: mod.category,
                  badgeClass: 'bg-neutral-800 text-neutral-300 border-neutral-700'
                };
                const existingCount = countInPipelineByModId[mod.id] || 0;
                const hasWeightsFile = Boolean(mod.filename && /\.(pth|ckpt|onnx|bin)$/i.test(mod.filename));

                return (
                  <div
                    key={mod.id}
                    className={`p-4 rounded-xl border transition flex flex-col justify-between gap-3 ${
                      existingCount > 0
                        ? 'bg-purple-950/15 border-purple-800/50 hover:border-purple-500/70'
                        : 'bg-neutral-950/70 border-neutral-800/90 hover:border-purple-600/60 hover:bg-neutral-900/60'
                    }`}
                  >
                    <div className="space-y-2">
                      {/* Badges row */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${catInfo.badgeClass}`}>
                            {catInfo.label}
                          </span>
                          {mod.engineArchitecture && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-neutral-900 text-neutral-400 border border-neutral-800 font-mono flex items-center gap-1">
                              <Cpu className="w-2.5 h-2.5 text-purple-400" />
                              {mod.engineArchitecture}
                            </span>
                          )}
                        </div>

                        {existingCount > 0 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-medium flex items-center gap-1">
                            <Check className="w-3 h-3" />В конвейере{existingCount > 1 ? ` ×${existingCount}` : ''}
                          </span>
                        )}
                      </div>

                      {/* Title & Description */}
                      <div>
                        <h3 className="text-xs font-bold text-neutral-100 leading-snug">{mod.title}</h3>
                        <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed line-clamp-3">
                          {mod.description}
                        </p>
                      </div>

                      {/* Optional Input Slots & Model Weights Status */}
                      {(mod.recommended_for || hasWeightsFile || (mod.presets && mod.presets.length > 0)) && (
                        <div className="flex items-center gap-2 flex-wrap pt-1 text-[10px] text-neutral-400">
                          {mod.presets && mod.presets.length > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-300">
                              🎛 Пресетов: {mod.presets.length}
                            </span>
                          )}
                          {hasWeightsFile && (
                            <span
                              className={`px-1.5 py-0.5 rounded border ${
                                mod.is_installed
                                  ? 'bg-emerald-950/50 border-emerald-800/60 text-emerald-300'
                                  : 'bg-amber-950/50 border-amber-800/60 text-amber-300'
                              }`}
                            >
                              {mod.is_installed
                                ? `✓ Веса установлены (${mod.size_mb || '?'} МБ)`
                                : `⬇ Веса ${mod.size_mb || '?'} МБ (скачаются автоматически)`}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action Footer */}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-neutral-800/70">
                      <span className="text-[10px] text-neutral-500 font-mono truncate" title={mod.id}>
                        ID: {mod.id}
                      </span>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {hasWeightsFile && !mod.is_installed && onDownloadModel && (
                          <button
                            onClick={() => onDownloadModel(mod.id)}
                            disabled={isDownloadingModel}
                            className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-amber-300 border border-amber-600/30 rounded-lg text-[11px] font-medium flex items-center gap-1 transition"
                            title="Предварительно скачать веса нейросети на диск"
                          >
                            <Download className="w-3 h-3" />
                            <span>{isDownloadingModel ? `${downloadPercent}%` : 'Скачать веса'}</span>
                          </button>
                        )}

                        <button
                          onClick={() => handleSelectModule(mod)}
                          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{existingCount > 0 ? 'Добавить ещё' : 'Добавить в конвейер'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-neutral-950 border-t border-neutral-800 flex items-center justify-between text-xs text-neutral-400 shrink-0">
          <span>
            Показано модулей: <strong className="text-neutral-200">{filteredModules.length}</strong> из{' '}
            {moduleDatabase.length} | В текущей цепочке:{' '}
            <strong className="text-purple-300">{currentPipeline?.length || 0}</strong>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-medium transition"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};
