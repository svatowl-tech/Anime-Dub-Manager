import React from 'react';
import { Bot, FileSpreadsheet, Database, Radio, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { DiarizationTabType } from '../../types/diarization';

interface DiarizationHeaderProps {
  activeTab: DiarizationTabType;
  onTabChange: (tab: DiarizationTabType) => void;
  isEnvReady: boolean;
  isCheckingEnv: boolean;
  onRefreshEnv: () => void;
}

export const DiarizationHeader: React.FC<DiarizationHeaderProps> = ({
  activeTab,
  onTabChange,
  isEnvReady,
  isCheckingEnv,
  onRefreshEnv,
}) => {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-neutral-800 shrink-0">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400">
          <Bot className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white tracking-tight">
            Диаризация и распределение голосов
          </h2>
          <p className="text-xs text-neutral-400">
            Разделение аудио на голоса, распознавание персонажей через ИИ и быстрый перенос ролей в субтитры
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {/* Navigation Tabs */}
        <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-lg p-1">
          <button
            onClick={() => onTabChange('pipeline')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              activeTab === 'pipeline'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            ИИ-Конвейер
          </button>

          <button
            onClick={() => onTabChange('quick-assign')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              activeTab === 'quick-assign'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Перенос по сабам
          </button>

          <button
            onClick={() => onTabChange('voicebase')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              activeTab === 'voicebase'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            База голосов
          </button>

          <button
            onClick={() => onTabChange('sidecar')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              activeTab === 'sidecar'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            WLK Sidecar
          </button>
        </div>

        {/* AI Environment Status Pill */}
        <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-lg text-xs">
          {isEnvReady ? (
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <CheckCircle className="w-3.5 h-3.5" />
              ИИ-Среда готова
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-amber-400 font-medium">
              <AlertCircle className="w-3.5 h-3.5" />
              ИИ-Среда не установлена
            </span>
          )}

          <button
            onClick={onRefreshEnv}
            disabled={isCheckingEnv}
            title="Обновить статус среды"
            className="text-neutral-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCheckingEnv ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  );
};
