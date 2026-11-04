import React, { useState } from 'react';
import { 
  Cpu, 
  RefreshCw, 
  Sliders, 
  FolderOpen, 
  Play, 
  Square, 
  Check, 
  Trash2, 
  Bookmark, 
  Volume2 
} from 'lucide-react';
import { MixingVst3ModalProps } from './mixing.types';

export const MixingVst3Modal: React.FC<MixingVst3ModalProps> = ({
  isOpen,
  onClose,
  isDesktopSupported,
  installedPlugins,
  isScanning,
  selectedPlugin,
  setSelectedPlugin,
  subPluginName,
  setSubPluginName,
  inspectedParameters,
  isInspecting,
  userPresets,
  wetMixPercent,
  setWetMixPercent,
  outputGainDb,
  setOutputGainDb,
  snippetDurationSec,
  setSnippetDurationSec,
  isPreviewing,
  onScanPlugins,
  onSelectPluginFile,
  onOpenNativeEditor,
  onCloseNativeEditor,
  onPreviewSnippet,
  onSavePreset,
  onApplyPreset,
  onDeletePreset
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [newPresetTitle, setNewPresetTitle] = useState('');
  const [newPresetDesc, setNewPresetDesc] = useState('');

  if (!isOpen) return null;

  const filteredPlugins = installedPlugins.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.category && p.category.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-600/20 text-purple-400 rounded-xl border border-purple-500/30">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Менеджер VST3 плагинов и пресетов</span>
                <span className="text-[10px] px-2 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-full font-mono">
                  VST3 Host
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                Сканирование системы, нативный GUI плагина и быстрый рендер превью
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white p-1 rounded-lg"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
          {/* Top Actions */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Поиск по установленным VST3 плагинам..."
                className="w-full max-w-sm px-3 py-1.5 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={onScanPlugins}
                disabled={isScanning}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-purple-300 rounded-lg font-medium flex items-center gap-1.5 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                <span>Пересканировать VST3</span>
              </button>
              <button
                onClick={onSelectPluginFile}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg font-medium flex items-center gap-1.5 transition"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Обзор .vst3</span>
              </button>
            </div>
            <span className="text-neutral-400 font-mono">
              Найдено: {installedPlugins.length} шт.
            </span>
          </div>

          {/* Plugin Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Installed List */}
            <div className="bg-neutral-950 rounded-xl border border-neutral-800 p-3 space-y-2 max-h-64 overflow-y-auto">
              <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider block">
                Установленные VST3 в системе
              </span>
              {filteredPlugins.length === 0 ? (
                <div className="text-neutral-500 py-6 text-center">
                  Плагины не найдены
                </div>
              ) : (
                filteredPlugins.map((pl, idx) => {
                  const isSel = selectedPlugin?.path === pl.path;
                  return (
                    <div
                      key={idx}
                      onClick={() => setSelectedPlugin(pl)}
                      className={`p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                        isSel
                          ? 'bg-purple-950/40 border-purple-500 text-white'
                          : 'bg-neutral-900 border-neutral-800/80 text-neutral-300 hover:border-neutral-700'
                      }`}
                    >
                      <div className="truncate pr-2">
                        <div className="font-semibold text-xs truncate">{pl.name}</div>
                        <div className="text-[10px] text-neutral-500 font-mono truncate">{pl.path}</div>
                      </div>
                      {Array.isArray(pl.subPlugins) && pl.subPlugins.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-300 border border-purple-700 shrink-0">
                          {pl.subPlugins.length} суб-плагинов
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Selected Plugin Details & Controls */}
            <div className="bg-neutral-950 rounded-xl border border-neutral-800 p-4 space-y-3 flex flex-col justify-between">
              {selectedPlugin ? (
                <div className="space-y-3">
                  <div>
                    <h3 className="font-bold text-sm text-purple-300">{selectedPlugin.name}</h3>
                    <p className="text-[11px] text-neutral-400 font-mono truncate">{selectedPlugin.path}</p>
                  </div>

                  {Array.isArray(selectedPlugin.subPlugins) && selectedPlugin.subPlugins.length > 0 && (
                    <div>
                      <label className="text-[11px] text-neutral-400 block mb-1">
                        Выбрать модуль WaveShell / суб-плагин:
                      </label>
                      <select
                        value={subPluginName}
                        onChange={e => setSubPluginName(e.target.value)}
                        className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-neutral-200"
                      >
                        {selectedPlugin.subPlugins.map((sub, sIdx) => (
                          <option key={sIdx} value={sub}>{sub}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={onOpenNativeEditor}
                      className="flex-1 px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-lg flex items-center justify-center gap-1.5 transition shadow"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Открыть нативное окно VST3</span>
                    </button>
                    <button
                      onClick={onCloseNativeEditor}
                      className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition"
                      title="Закрыть окно редактора"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Wet / Gain Sliders */}
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div>
                      <div className="flex justify-between text-[11px] text-neutral-400 mb-1">
                        <span>Баланс Wet:</span>
                        <span className="font-mono text-purple-300 font-bold">{wetMixPercent}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={wetMixPercent}
                        onChange={e => setWetMixPercent(Number(e.target.value))}
                        className="w-full accent-purple-500 cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] text-neutral-400 mb-1">
                        <span>Выходной Gain:</span>
                        <span className="font-mono text-emerald-300 font-bold">{outputGainDb} dB</span>
                      </div>
                      <input
                        type="range"
                        min={-12}
                        max={12}
                        step={0.5}
                        value={outputGainDb}
                        onChange={e => setOutputGainDb(Number(e.target.value))}
                        className="w-full accent-emerald-500 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-neutral-500 space-y-2 py-8">
                  <Sliders className="w-8 h-8 text-neutral-700" />
                  <p>Выберите VST3 плагин слева для настройки</p>
                </div>
              )}

              {/* Quick Preview Action */}
              <div className="border-t border-neutral-800 pt-3">
                <button
                  onClick={onPreviewSnippet}
                  disabled={!selectedPlugin || isPreviewing}
                  className="w-full py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-purple-300 border border-purple-500/30 rounded-lg font-semibold flex items-center justify-center gap-2 transition"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{isPreviewing ? 'Рендеринг превью...' : 'Быстрый рендер превью 12 сек'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* User Presets Library */}
          <div className="bg-neutral-950 rounded-xl border border-neutral-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-neutral-300 uppercase tracking-wider text-[11px]">
                Сохраненные VST3 пресеты ({userPresets.length})
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPresetTitle}
                  onChange={e => setNewPresetTitle(e.target.value)}
                  placeholder="Название нового пресета..."
                  className="px-2.5 py-1 bg-neutral-900 border border-neutral-800 rounded text-neutral-200 text-xs w-52"
                />
                <button
                  onClick={() => {
                    if (newPresetTitle.trim()) {
                      onSavePreset(newPresetTitle.trim(), newPresetDesc);
                      setNewPresetTitle('');
                    }
                  }}
                  disabled={!newPresetTitle.trim()}
                  className="px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded text-xs font-semibold flex items-center gap-1 transition"
                >
                  <Bookmark className="w-3 h-3" />
                  <span>Сохранить текущий</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 max-h-40 overflow-y-auto">
              {userPresets.map((up) => (
                <div
                  key={up.id}
                  className="p-2.5 bg-neutral-900 rounded-lg border border-neutral-800 flex items-center justify-between"
                >
                  <div className="truncate pr-2">
                    <div className="font-bold text-neutral-200 truncate">{up.title || up.name}</div>
                    <div className="text-[10px] text-neutral-500 font-mono truncate">{up.pluginName}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onApplyPreset(up.id)}
                      className="p-1 bg-purple-600/30 hover:bg-purple-600 text-purple-300 hover:text-white rounded transition"
                      title="Применить пресет"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onDeletePreset(up.id)}
                      className="p-1 text-neutral-500 hover:text-red-400 rounded transition"
                      title="Удалить"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-neutral-800 bg-neutral-950 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-medium transition"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
