import React from 'react';
import {
  Scissors,
  Sliders,
  Headphones,
  Clock,
  RotateCcw,
  Sparkles,
  X,
  Search,
  CheckSquare,
  Square,
  Zap,
  Layers,
  FileText,
  Mic,
  Flame,
  UserCheck,
  Terminal
} from 'lucide-react';
import { DefectCategory, QAScanReport } from '../../../lib/qa/missingLinesDetector';
import { AudioArtifactType } from '../../../lib/qa/artifactDetector';

export interface MissingLinesFilterToolbarProps {
  totalGapsCount: number;
  selectedSensitivity: number;
  handleSensitivityChange: (val: number) => void;
  isAnalyzing: boolean;
  handleGenerateReportForSE: () => void;
  handleSaveToTiming: (navigateToTiming?: boolean) => Promise<void>;
  isSavingToTiming: boolean;
  onOpenScanConfig?: () => void;
  activeReport?: QAScanReport;
  setIsLogModalOpen: (val: boolean) => void;
  onClose: () => void;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  selectedDubberFilter: string;
  setSelectedDubberFilter: (val: string) => void;
  dubbers: string[];
  handleToggleSelectAll: (select: boolean) => void;
  filteredGapsCount: number;
  selectedCategoryTab: 'all' | DefectCategory | 'sub_error';
  setSelectedCategoryTab: (val: 'all' | DefectCategory | 'sub_error') => void;
  selectedArtifactTypeFilter: 'all' | AudioArtifactType;
  setSelectedArtifactTypeFilter: (val: 'all' | AudioArtifactType) => void;
  missingCount: number;
  unwantedCount: number;
  collisionsCount: number;
  overlapsCount: number;
  shortTimingCount: number;
  longTimingCount: number;
  subErrorCount: number;
  artifactsCount: number;
  clippingCount: number;
  clicksCount: number;
  plosivesCount: number;
  cutoffsCount: number;
  textMismatchCount: number;
}

export const MissingLinesFilterToolbar: React.FC<MissingLinesFilterToolbarProps> = ({
  totalGapsCount,
  selectedSensitivity,
  handleSensitivityChange,
  isAnalyzing,
  handleGenerateReportForSE,
  handleSaveToTiming,
  isSavingToTiming,
  onOpenScanConfig,
  activeReport,
  setIsLogModalOpen,
  onClose,
  searchQuery,
  setSearchQuery,
  selectedDubberFilter,
  setSelectedDubberFilter,
  dubbers,
  handleToggleSelectAll,
  filteredGapsCount,
  selectedCategoryTab,
  setSelectedCategoryTab,
  selectedArtifactTypeFilter,
  setSelectedArtifactTypeFilter,
  missingCount,
  unwantedCount,
  collisionsCount,
  overlapsCount,
  shortTimingCount,
  longTimingCount,
  subErrorCount,
  artifactsCount,
  clippingCount,
  clicksCount,
  plosivesCount,
  cutoffsCount,
  textMismatchCount
}) => {
  return (
    <div className="shrink-0 space-y-3 p-5 border-b border-neutral-800 bg-neutral-900/95">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Scissors className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white">Центр проверки качества и косяков озвучки</h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold font-mono">
                {totalGapsCount} {totalGapsCount === 1 ? 'замечание' : totalGapsCount < 5 ? 'замечания' : 'замечаний'}
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              Автосканирование: пропуски реплик, лишняя речь вне субтитров и конфликты параллельной озвучки
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Sensitivity selector */}
          <div className="flex items-center gap-1.5 bg-neutral-950/80 border border-neutral-700/70 rounded-lg px-2 py-1 text-xs">
            <Sliders className="w-3.5 h-3.5 text-neutral-400" />
            <span className="text-[11px] text-neutral-400 font-medium">Чувствительность:</span>
            <div className="flex items-center gap-1">
              {[
                { value: 2.0, label: '2.0 дБ (Тихий)' },
                { value: 3.0, label: '3.0 дБ (Стандарт)' },
                { value: 4.5, label: '4.5 дБ (Строгий)' }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleSensitivityChange(opt.value)}
                  disabled={isAnalyzing}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                    selectedSensitivity === opt.value
                      ? 'bg-amber-500 text-neutral-950 shadow-sm'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                  }`}
                  title={`Считать фразой, если перепад громкости внутри реплики превышает ${opt.value} дБ`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sound Engineer Message Button */}
          <button
            onClick={handleGenerateReportForSE}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 transition-all flex items-center gap-1.5 shadow-sm hover:shadow-indigo-500/20"
            title="Выписать звукорежиссеру подробный отчет по наездам, конфликтам и рассинхрону"
          >
            <Headphones className="w-3.5 h-3.5 text-indigo-400" />
            <span>Выписать звукорежиссеру</span>
          </button>

          {/* Record to Timing Video Button */}
          <button
            onClick={() => handleSaveToTiming(true)}
            disabled={isSavingToTiming}
            className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-neutral-950 transition-all flex items-center gap-1.5 shadow-md shadow-amber-600/20 disabled:opacity-50"
            title="Записать все найденные замечания в файл тайминга и открыть панель «Тайминг видео»"
          >
            <Clock className="w-3.5 h-3.5 text-neutral-950" />
            <span>Записать в тайминг (свожу сам)</span>
          </button>

          {/* Re-Analyze Button */}
          {onOpenScanConfig && (
            <button
              onClick={onOpenScanConfig}
              disabled={isAnalyzing}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
              <span>Пересканировать</span>
            </button>
          )}

          {/* Log / Report Inspector Button */}
          {activeReport && (
            <button
              onClick={() => setIsLogModalOpen(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-purple-300 border border-purple-500/30 transition-all flex items-center gap-1.5"
              title="Открыть полный технический лог и протокол сканирования"
            >
              <Terminal className="w-3.5 h-3.5 text-purple-400" />
              <span>Лог ({activeReport.logs?.length || 0})</span>
            </button>
          )}

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Controls Bar: Search, Dubber Filter, Select All */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-950/60 p-2.5 rounded-xl border border-neutral-800/80">
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по тексту фразы, персонажу или дабберу..."
              className="w-full bg-neutral-900 border border-neutral-800 text-neutral-200 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            />
          </div>

          {dubbers.length > 0 && (
            <select
              value={selectedDubberFilter}
              onChange={(e) => setSelectedDubberFilter(e.target.value)}
              className="bg-neutral-900 border border-neutral-800 text-neutral-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500/50 max-w-[180px]"
            >
              <option value="all">Все дабберы ({dubbers.length})</option>
              {dubbers.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleToggleSelectAll(true)}
            className="px-2.5 py-1 rounded bg-neutral-850 hover:bg-neutral-800 text-neutral-300 text-xs font-medium flex items-center gap-1 transition-colors border border-neutral-700/60"
          >
            <CheckSquare className="w-3.5 h-3.5 text-blue-400" />
            <span>Выбрать все ({filteredGapsCount})</span>
          </button>
          <button
            onClick={() => handleToggleSelectAll(false)}
            className="px-2.5 py-1 rounded bg-neutral-850 hover:bg-neutral-800 text-neutral-400 text-xs font-medium flex items-center gap-1 transition-colors border border-neutral-700/60"
          >
            <Square className="w-3.5 h-3.5" />
            <span>Снять выбор</span>
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
        <button
          onClick={() => setSelectedCategoryTab('all')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shrink-0 border ${
            selectedCategoryTab === 'all'
              ? 'bg-neutral-800 text-white border-neutral-600 shadow-sm'
              : 'bg-neutral-950/40 text-neutral-400 border-neutral-800/80 hover:bg-neutral-900 hover:text-neutral-200'
          }`}
        >
          <span>Все замечания</span>
          <span className="px-1.5 py-0.2 rounded bg-black/40 text-[10px] font-mono">{totalGapsCount}</span>
        </button>

        {missingCount > 0 && (
          <button
            onClick={() => setSelectedCategoryTab('missing_line')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shrink-0 border ${
              selectedCategoryTab === 'missing_line'
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                : 'bg-neutral-950/40 text-neutral-400 border-neutral-800/80 hover:bg-neutral-900 hover:text-neutral-200'
            }`}
          >
            <span>Пропуски реплик</span>
            <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px] font-mono font-bold">{missingCount}</span>
          </button>
        )}

        {collisionsCount > 0 && (
          <button
            onClick={() => setSelectedCategoryTab('actor_collision')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shrink-0 border ${
              selectedCategoryTab === 'actor_collision'
                ? 'bg-red-500/20 text-red-300 border-red-500/50 shadow-sm'
                : 'bg-neutral-950/40 text-neutral-400 border-neutral-800/80 hover:bg-neutral-900 hover:text-neutral-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-red-400" />
            <span>Конфликты</span>
            <span className="px-1.5 py-0.2 rounded bg-red-500/20 text-red-300 text-[10px] font-mono font-bold">{collisionsCount}</span>
          </button>
        )}

        {overlapsCount > 0 && (
          <button
            onClick={() => setSelectedCategoryTab('actor_overlap')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shrink-0 border ${
              selectedCategoryTab === 'actor_overlap'
                ? 'bg-orange-500/20 text-orange-300 border-orange-500/50 shadow-sm'
                : 'bg-neutral-950/40 text-neutral-400 border-neutral-800/80 hover:bg-neutral-900 hover:text-neutral-200'
            }`}
          >
            <span>Наезды хвостов</span>
            <span className="px-1.5 py-0.2 rounded bg-orange-500/20 text-orange-300 text-[10px] font-mono font-bold">{overlapsCount}</span>
          </button>
        )}

        {unwantedCount > 0 && (
          <button
            onClick={() => setSelectedCategoryTab('unwanted_speech')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shrink-0 border ${
              selectedCategoryTab === 'unwanted_speech'
                ? 'bg-blue-500/20 text-blue-300 border-blue-500/50 shadow-sm'
                : 'bg-neutral-950/40 text-neutral-400 border-neutral-800/80 hover:bg-neutral-900 hover:text-neutral-200'
            }`}
          >
            <span>Лишняя речь</span>
            <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 text-[10px] font-mono font-bold">{unwantedCount}</span>
          </button>
        )}

        {artifactsCount > 0 && (
          <button
            onClick={() => setSelectedCategoryTab('audio_artifact')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shrink-0 border ${
              selectedCategoryTab === 'audio_artifact'
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-sm'
                : 'bg-neutral-950/40 text-neutral-400 border-neutral-800/80 hover:bg-neutral-900 hover:text-neutral-200'
            }`}
          >
            <Flame className="w-3.5 h-3.5 text-rose-400" />
            <span>Артефакты звука</span>
            <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 text-[10px] font-mono font-bold">{artifactsCount}</span>
          </button>
        )}

        {textMismatchCount > 0 && (
          <button
            onClick={() => setSelectedCategoryTab('text_mismatch')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shrink-0 border ${
              selectedCategoryTab === 'text_mismatch'
                ? 'bg-purple-500/20 text-purple-300 border-purple-500/50 shadow-sm'
                : 'bg-neutral-950/40 text-neutral-400 border-neutral-800/80 hover:bg-neutral-900 hover:text-neutral-200'
            }`}
          >
            <Mic className="w-3.5 h-3.5 text-purple-400" />
            <span>Расхождения текста</span>
            <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 text-[10px] font-mono font-bold">{textMismatchCount}</span>
          </button>
        )}

        {subErrorCount > 0 && (
          <button
            onClick={() => setSelectedCategoryTab('sub_error')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shrink-0 border ${
              selectedCategoryTab === 'sub_error'
                ? 'bg-purple-900/40 text-purple-300 border-purple-500/60 shadow-sm'
                : 'bg-neutral-950/40 text-neutral-400 border-neutral-800/80 hover:bg-neutral-900 hover:text-neutral-200'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5 text-purple-400" />
            <span>Ошибки в сабах</span>
            <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 text-[10px] font-mono font-bold">{subErrorCount}</span>
          </button>
        )}
      </div>

      {/* Artifact type sub-filter if audio_artifact tab selected */}
      {selectedCategoryTab === 'audio_artifact' && (
        <div className="flex items-center gap-2 pt-1 border-t border-neutral-800/60 text-xs">
          <span className="text-neutral-400 font-medium">Тип артефакта:</span>
          {[
            { id: 'all', label: `Все (${artifactsCount})` },
            { id: 'clipping', label: `Клиппинг (${clippingCount})` },
            { id: 'mouse_click', label: `Щелчки (${clicksCount})` },
            { id: 'plosive', label: `Плевки (${plosivesCount})` },
            { id: 'swallowed_vowel', label: `Съеденные гласные (${cutoffsCount})` }
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setSelectedArtifactTypeFilter(f.id as any)}
              className={`px-2.5 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                selectedArtifactTypeFilter === f.id
                  ? 'bg-rose-500 text-neutral-950'
                  : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
