import React from 'react';
import { 
  Activity, 
  X, 
  Volume2, 
  FolderOpen, 
  RefreshCw, 
  Sliders, 
  Plus, 
  CheckCircle2, 
  Play 
} from 'lucide-react';
import { MixingAcousticMatchModalProps } from './mixing.types';

export const MixingAcousticMatchModal: React.FC<MixingAcousticMatchModalProps> = ({
  isOpen,
  onClose,
  origVocalsPath,
  setOrigVocalsPath,
  origVocalsError,
  ourVocalsPath,
  setOurVocalsPath,
  ourVocalsError,
  isAnalyzingAcoustics,
  acousticProfile,
  selectedEffectFilter,
  setSelectedEffectFilter,
  loudnessStrength,
  setLoudnessStrength,
  reverbStrength,
  setReverbStrength,
  eqStrength,
  setEqStrength,
  targetLufsOffset,
  setTargetLufsOffset,
  isApplyingAcousticMatch,
  acousticMatchResult,
  onAnalyzeOriginal,
  onApplyMatch,
  onAddToPipeline,
  onSeek
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-emerald-500/40 rounded-2xl w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col max-h-[94vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-gradient-to-r from-emerald-950/50 via-teal-950/30 to-neutral-900">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-600/20 text-emerald-400 rounded-xl border border-emerald-500/30">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Повторение эффектов оригинала по кривой автоматизации</span>
                <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full font-mono">
                  acoustic_matched v2.0 • 100ms Automation DSP
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                Строгий контроль 2-х входов (вокал оригинала + склеенная дорожка всех голосов) и пофразовая автоматизация
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Inputs Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Input 1: Original Vocals Stem */}
            <div className={`p-4 rounded-xl border ${origVocalsError ? 'bg-red-950/25 border-red-500/50' : 'bg-emerald-950/15 border-emerald-500/30'} space-y-2.5`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-emerald-300">
                  <Volume2 className="w-4 h-4" />
                  1. Вокальная дорожка оригинала (Stem Vocals)
                </span>
                <button
                  type="button"
                  onClick={() => onAnalyzeOriginal(origVocalsPath)}
                  className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-[11px] font-medium border border-neutral-700 transition flex items-center gap-1"
                >
                  <FolderOpen className="w-3 h-3" />
                  <span>Обзор...</span>
                </button>
              </div>

              {origVocalsError ? (
                <div className="text-xs text-red-300 bg-red-950/50 p-3 rounded-lg border border-red-500/30 whitespace-pre-line leading-relaxed">
                  {origVocalsError}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between bg-neutral-950 px-3 py-2 rounded-lg border border-emerald-500/30">
                    <span className="text-xs font-mono text-emerald-300 truncate" title={origVocalsPath}>
                      ✓ {origVocalsPath || 'Ожидание...'}
                    </span>
                    {origVocalsPath && (
                      <button
                        onClick={() => onAnalyzeOriginal(origVocalsPath)}
                        disabled={isAnalyzingAcoustics}
                        className="ml-2 px-2 py-0.5 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 rounded text-[10px] border border-emerald-500/30 shrink-0 transition"
                      >
                        Переанализировать
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-400">
                    Проверка пройдена: выделен чистый вокал оригинала из видео.
                  </p>
                </div>
              )}
            </div>

            {/* Input 2: Glued Dubber Voices */}
            <div className={`p-4 rounded-xl border ${ourVocalsError ? 'bg-red-950/25 border-red-500/50' : 'bg-purple-950/15 border-purple-500/30'} space-y-2.5`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-purple-300">
                  <Sliders className="w-4 h-4" />
                  2. Склеенная дорожка всех голосов (voices_master)
                </span>
              </div>

              {ourVocalsError ? (
                <div className="text-xs text-red-300 bg-red-950/50 p-3 rounded-lg border border-red-500/30 whitespace-pre-line leading-relaxed">
                  {ourVocalsError}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between bg-neutral-950 px-3 py-2 rounded-lg border border-purple-500/30">
                    <span className="text-xs font-mono text-purple-300 truncate" title={ourVocalsPath}>
                      ✓ {ourVocalsPath || 'Не выбрана'}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-400">
                    Проверка пройдена: голоса дабберов склеены для синхронной автоматизации.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Analysis View */}
          {isAnalyzingAcoustics ? (
            <div className="p-8 bg-neutral-950 rounded-xl border border-neutral-800 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin" />
              <span className="text-sm text-neutral-200 font-medium">
                Выполняется покадровый (100 мс) физический анализ эффектов вокала оригинала...
              </span>
              <span className="text-xs text-neutral-500">
                Измерение частотных полос, реверберации RT60, дилэя, панорамы и кривой динамики
              </span>
            </div>
          ) : acousticProfile ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="p-3.5 bg-neutral-950 rounded-xl border border-neutral-800 space-y-1.5">
                  <div className="text-[11px] font-bold text-amber-400 uppercase flex items-center justify-between">
                    <span>1. Динамика</span>
                    <span className="font-mono text-xs bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                      {acousticProfile.phrasesCount || 0} фраз
                    </span>
                  </div>
                  <div className="text-xs text-neutral-300 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Уровень:</span>
                      <span className="font-mono font-semibold text-white">{acousticProfile.overallStats?.integratedLufs} LUFS</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Пик:</span>
                      <span className="font-mono text-neutral-200">{acousticProfile.overallStats?.truePeakDb} dBTP</span>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 bg-neutral-950 rounded-xl border border-neutral-800 space-y-1.5">
                  <div className="text-[11px] font-bold text-cyan-400 uppercase flex items-center justify-between">
                    <span>2. Пространство</span>
                    <span className="font-mono text-xs bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
                      RT60 {acousticProfile.overallStats?.avgReverbRt60}с
                    </span>
                  </div>
                  <div className="text-xs text-neutral-300 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Среда:</span>
                      <span className="font-medium text-cyan-200 truncate max-w-[130px]">{acousticProfile.overallStats?.reverbCategory}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Реверберация:</span>
                      <span className="font-mono text-white">{acousticProfile.overallStats?.effectCounts?.reverb_space || 0} фраз</span>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 bg-neutral-950 rounded-xl border border-neutral-800 space-y-1.5">
                  <div className="text-[11px] font-bold text-purple-400 uppercase flex items-center justify-between">
                    <span>3. Фильтры</span>
                    <span className="font-mono text-xs bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                      {acousticProfile.overallStats?.phrasesWithSpecialEffects || 0} спецфраз
                    </span>
                  </div>
                  <div className="text-xs text-neutral-300 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Телефон/Рация:</span>
                      <span className="font-mono text-amber-300">{acousticProfile.overallStats?.effectCounts?.telephone || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">За стеной:</span>
                      <span className="font-mono text-orange-300">{acousticProfile.overallStats?.effectCounts?.muffled_wall || 0}</span>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 bg-neutral-950 rounded-xl border border-neutral-800 space-y-1.5">
                  <div className="text-[11px] font-bold text-emerald-400 uppercase flex items-center justify-between">
                    <span>4. Спектр EQ</span>
                    <span className="font-mono text-[10px] text-neutral-400">Оригинал</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono text-neutral-300">
                    <div>Pres: <span className="text-emerald-300">{acousticProfile.overallStats?.spectralBandsDb?.presence3500Hz}dB</span></div>
                    <div>Air: <span className="text-cyan-300">{acousticProfile.overallStats?.spectralBandsDb?.air10000Hz}dB</span></div>
                  </div>
                </div>
              </div>

              {/* Phrase Inspector */}
              {Array.isArray(acousticProfile.phrases) && acousticProfile.phrases.length > 0 && (
                <div className="bg-neutral-950 rounded-xl border border-neutral-800 max-h-48 overflow-y-auto p-2 space-y-1 font-mono text-xs">
                  {acousticProfile.phrases.slice(0, 50).map((ph: any, pIdx: number) => (
                    <div 
                      key={pIdx}
                      onClick={() => onSeek(ph.startSec || 0)}
                      className="p-2 bg-neutral-900/60 hover:bg-neutral-800 rounded flex items-center justify-between cursor-pointer transition text-[11px]"
                    >
                      <div className="flex items-center gap-2">
                        <Play className="w-3 h-3 text-emerald-400 fill-current" />
                        <span className="text-neutral-400">{ph.startSec?.toFixed(1)}с – {ph.endSec?.toFixed(1)}с</span>
                        <span className="text-neutral-200">{ph.dominantEffect || 'Обычная речь'}</span>
                      </div>
                      <span className="text-emerald-400">{ph.lufs ? `${ph.lufs.toFixed(1)} LUFS` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* Sliders for Automation Depth */}
          <div className="p-4 bg-neutral-950 rounded-xl border border-neutral-800 space-y-4">
            <div className="text-xs font-bold text-neutral-200 uppercase tracking-wider">
              Глубина наложения кривых автоматизации (Automation Curves)
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-neutral-400">1. Автоматизация громкости и экспрессии:</span>
                  <span className="font-mono text-amber-400 font-bold">{loudnessStrength}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={loudnessStrength}
                  onChange={e => setLoudnessStrength(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-neutral-400">2. Автоматизация пространства (Реверберация + Эхо):</span>
                  <span className="font-mono text-cyan-400 font-bold">{reverbStrength}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={reverbStrength}
                  onChange={e => setReverbStrength(Number(e.target.value))}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-neutral-400">3. Автоматизация фильтров (Телефон / Рация / Стены / EQ):</span>
                  <span className="font-mono text-purple-400 font-bold">{eqStrength}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={eqStrength}
                  onChange={e => setEqStrength(Number(e.target.value))}
                  className="w-full accent-purple-500 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-neutral-400">Смещение целевой громкости голосов:</span>
                  <span className="font-mono text-emerald-400 font-bold">{targetLufsOffset > 0 ? `+${targetLufsOffset}` : targetLufsOffset} dB</span>
                </div>
                <input
                  type="range"
                  min={-6}
                  max={6}
                  step={0.5}
                  value={targetLufsOffset}
                  onChange={e => setTargetLufsOffset(Number(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Results Card */}
          {acousticMatchResult && (
            <div className="p-4 bg-emerald-950/30 border border-emerald-500/40 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-300">
                  ✓ Кривые автоматизации успешно наложены на дорожку голосов!
                </span>
                <span className="text-[11px] font-mono text-emerald-400">
                  {acousticMatchResult.outputPath}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-neutral-800 bg-neutral-950 flex items-center justify-between gap-3">
          <button
            onClick={onAddToPipeline}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-emerald-300 rounded-xl text-xs font-semibold border border-emerald-500/30 flex items-center gap-2 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Добавить шаг «acoustic_matched» в конвейер</span>
          </button>

          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-medium transition"
            >
              Закрыть
            </button>
            <button
              onClick={onApplyMatch}
              disabled={isApplyingAcousticMatch || !origVocalsPath || !ourVocalsPath || !!origVocalsError || !!ourVocalsError}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition shadow-lg shadow-emerald-900/30"
            >
              {isApplyingAcousticMatch ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Рендеринг кривых автоматизации...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Наложить эффекты по кривой сейчас</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
