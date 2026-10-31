import { useState, useEffect } from 'react';
import { 
  X, Save, Check, Globe, Send, Table, Sparkles, Plus, Trash2,
  RefreshCw, CheckCircle2, Sliders, ExternalLink, Info, Copy
} from 'lucide-react';
import { toast } from 'sonner';
import { ReleaseType, Project } from '../../types';
import { 
  ReleaseTypePreset, 
  RELEASE_TYPE_LABELS, 
  RELEASE_TYPE_DESCRIPTIONS,
  getReleasePreset, 
  saveReleasePreset, 
  getDefaultPresetForType,
  applyPresetToAllProjectsOfType,
  QuickUploadLink
} from '../../lib/releasePresetsService';

interface ReleasePresetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentReleaseType?: ReleaseType;
  allProjects?: Project[];
  onPresetUpdated?: () => void;
}

export default function ReleasePresetsModal({
  isOpen,
  onClose,
  currentReleaseType = 'VOICEOVER',
  allProjects = [],
  onPresetUpdated
}: ReleasePresetsModalProps) {
  const [selectedType, setSelectedType] = useState<ReleaseType>(currentReleaseType);
  const [preset, setPreset] = useState<ReleaseTypePreset | null>(null);
  const [activeTab, setActiveTab] = useState<'templates' | 'quickLinks' | 'platformLinks'>('templates');
  const [activeTplTab, setActiveTplTab] = useState<'TG' | 'TG_ARTICLE' | 'VK' | 'FINAL_TG' | 'LINKS'>('TG');
  const [isSaving, setIsSaving] = useState(false);
  const [isApplyingAll, setIsApplyingAll] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedType(currentReleaseType);
    }
  }, [isOpen, currentReleaseType]);

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    getReleasePreset(selectedType).then(p => {
      if (isMounted) setPreset(p);
    });
    return () => { isMounted = false; };
  }, [selectedType, isOpen]);

  if (!isOpen || !preset) return null;

  const matchingProjectsCount = allProjects.filter(p => (p.releaseType || 'VOICEOVER') === selectedType).length;

  const handleSave = async (showToast: boolean = true) => {
    if (!preset) return;
    setIsSaving(true);
    try {
      await saveReleasePreset(preset);
      if (showToast) {
        toast.success(`Глобальные настройки для «${RELEASE_TYPE_LABELS[selectedType]}» сохранены!`);
      }
      onPresetUpdated?.();
    } catch (err: any) {
      toast.error(`Ошибка сохранения: ${err.message || String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyToAllProjects = async () => {
    if (!preset) return;
    setIsApplyingAll(true);
    try {
      await saveReleasePreset(preset);
      const res = await applyPresetToAllProjectsOfType(selectedType, allProjects);
      toast.success(
        `Настройки успешно применены ко всем ${res.updatedCount} проектам типа «${RELEASE_TYPE_LABELS[selectedType]}»!`,
        { duration: 4000 }
      );
      onPresetUpdated?.();
    } catch (err: any) {
      toast.error(`Ошибка при обновлении проектов: ${err.message || String(err)}`);
    } finally {
      setIsApplyingAll(false);
    }
  };

  const handleResetToDefault = () => {
    if (confirm(`Сбросить настройки для «${RELEASE_TYPE_LABELS[selectedType]}» к стандартным значениям системы?`)) {
      const def = getDefaultPresetForType(selectedType);
      setPreset(def);
      toast.info('Значения сброшены к дефолтным. Нажмите «Сохранить», чтобы зафиксировать.');
    }
  };

  const handleAddQuickLink = () => {
    if (!preset) return;
    setPreset({
      ...preset,
      quickUploadLinks: [...preset.quickUploadLinks, { name: 'Новая ссылка', url: 'https://' }]
    });
  };

  const handleUpdateQuickLink = (idx: number, field: 'name' | 'url', val: string) => {
    if (!preset) return;
    const next = [...preset.quickUploadLinks];
    next[idx] = { ...next[idx], [field]: val };
    setPreset({ ...preset, quickUploadLinks: next });
  };

  const handleRemoveQuickLink = (idx: number) => {
    if (!preset) return;
    setPreset({
      ...preset,
      quickUploadLinks: preset.quickUploadLinks.filter((_, i) => i !== idx)
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-hidden animate-in fade-in duration-200">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-neutral-200">
        
        {/* Header */}
        <div className="p-5 border-b border-neutral-800 bg-neutral-950/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-600/20 text-purple-400 rounded-xl border border-purple-500/20">
              <Sliders className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Глобальные шаблоны и ссылки по типам релизов
              </h2>
              <p className="text-xs text-neutral-400">
                Настройте шаблоны постов и ссылки один раз — они автоматически применятся ко всем новым и выбранным релизам
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Release Type Selector Tabs */}
        <div className="px-6 pt-4 pb-2 bg-neutral-950/40 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2 p-1 bg-black/40 rounded-xl border border-neutral-800">
            {(['VOICEOVER', 'RECAST', 'REDUB'] as ReleaseType[]).map((type) => {
              const isSelected = selectedType === type;
              return (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    isSelected
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60'
                  }`}
                >
                  <span>{type === 'VOICEOVER' ? '🎙️ Закадр' : type === 'RECAST' ? '🎭 Рекаст' : '🎬 Дубляж'}</span>
                  {selectedType === type && (
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="text-xs text-neutral-400 font-medium">
            В базе: <span className="text-purple-300 font-bold">{matchingProjectsCount}</span> релизов типа «{RELEASE_TYPE_LABELS[selectedType]}»
          </div>
        </div>

        {/* Description Banner */}
        <div className="px-6 py-2.5 bg-purple-950/20 border-b border-purple-500/10 text-xs text-purple-200/90 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-purple-400 shrink-0" />
            <span>{RELEASE_TYPE_DESCRIPTIONS[selectedType]}</span>
          </div>
          <button
            onClick={handleResetToDefault}
            className="text-[11px] text-neutral-400 hover:text-purple-300 underline underline-offset-2 transition-colors cursor-pointer"
          >
            Сброс к дефолтам системы
          </button>
        </div>

        {/* Section Navigation */}
        <div className="px-6 pt-3 flex gap-4 border-b border-neutral-800/80 bg-neutral-900 text-xs font-bold">
          <button
            onClick={() => setActiveTab('templates')}
            className={`pb-3 px-1 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'templates'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>Шаблоны сообщений</span>
          </button>
          <button
            onClick={() => setActiveTab('quickLinks')}
            className={`pb-3 px-1 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'quickLinks'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Быстрые ссылки куда закачивать</span>
            <span className="px-1.5 py-0.2 rounded-full bg-neutral-800 text-[10px] text-neutral-300">
              {preset.quickUploadLinks.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('platformLinks')}
            className={`pb-3 px-1 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'platformLinks'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Дефолтные ссылки платформ</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          
          {/* TAB 1: TEMPLATES */}
          {activeTab === 'templates' && (
            <div className="space-y-4">
              {/* Default Active Template Selector */}
              <div className="p-3.5 bg-black/30 border border-neutral-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-bold text-white block">Шаблон по умолчанию при открытии сборки:</span>
                  <span className="text-[11px] text-neutral-400">
                    Этот шаблон будет автоматически активироваться и генерироваться при входе в релиз
                  </span>
                </div>
                <div className="flex gap-1.5 p-1 bg-neutral-900 rounded-lg border border-neutral-800">
                  {[
                    { key: 'TG', label: 'Telegram' },
                    { key: 'TG_ARTICLE', label: 'Статья TG' },
                    { key: 'VK', label: 'VK' },
                    { key: 'FINAL_TG', label: 'Финал TG' }
                  ].map(t => (
                    <button
                      key={t.key}
                      onClick={() => setPreset({ ...preset, defaultTemplateType: t.key as any })}
                      className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                        preset.defaultTemplateType === t.key
                          ? 'bg-purple-600 text-white'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Template sub-tabs */}
              <div className="flex flex-wrap gap-2">
                {[
                  { key: 'TG', label: 'Пост в Telegram', icon: <Send className="w-3.5 h-3.5 text-blue-400" /> },
                  { key: 'TG_ARTICLE', label: 'Статья TG (таблица)', icon: <Table className="w-3.5 h-3.5 text-emerald-400" /> },
                  { key: 'VK', label: 'Пост в VK', icon: <Globe className="w-3.5 h-3.5 text-indigo-400" /> },
                  { key: 'FINAL_TG', label: 'Финальный пост TG', icon: <Sparkles className="w-3.5 h-3.5 text-purple-400" /> },
                  { key: 'LINKS', label: 'Шаблон блока ссылок', icon: <ExternalLink className="w-3.5 h-3.5 text-amber-400" /> }
                ].map(t => (
                  <button
                    key={t.key}
                    onClick={() => setActiveTplTab(t.key as any)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                      activeTplTab === t.key
                        ? 'bg-neutral-800 border-purple-500 text-white'
                        : 'bg-black/30 border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-700'
                    }`}
                  >
                    {t.icon}
                    <span>{t.label}</span>
                    {preset.defaultTemplateType === t.key && (
                      <span className="text-[10px] text-purple-400 font-mono">★</span>
                    )}
                  </button>
                ))}
              </div>

              {/* Textarea for selected template */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-neutral-400">
                  <span className="font-mono text-[11px]">
                    Доступны переменные: {'{emoji}, {title}, {progress}, {mainRoles}, {dubbers}, {seMention}, {linkTg}, {linkAnime365}, {platformLinks}'}
                  </span>
                  {activeTplTab === 'TG_ARTICLE' && (
                    <span className="text-emerald-400 font-semibold">{'{articleTable}'} для готовой таблицы</span>
                  )}
                </div>
                <textarea
                  value={
                    activeTplTab === 'TG' ? preset.tgPostTemplate :
                    activeTplTab === 'TG_ARTICLE' ? preset.tgArticleTemplate :
                    activeTplTab === 'VK' ? preset.vkPostTemplate :
                    activeTplTab === 'FINAL_TG' ? preset.finalTgPostTemplate :
                    preset.linksTemplate
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (activeTplTab === 'TG') setPreset({ ...preset, tgPostTemplate: val });
                    else if (activeTplTab === 'TG_ARTICLE') setPreset({ ...preset, tgArticleTemplate: val });
                    else if (activeTplTab === 'VK') setPreset({ ...preset, vkPostTemplate: val });
                    else if (activeTplTab === 'FINAL_TG') setPreset({ ...preset, finalTgPostTemplate: val });
                    else setPreset({ ...preset, linksTemplate: val });
                  }}
                  className="w-full bg-black/50 border border-neutral-800 rounded-xl p-4 text-xs text-neutral-200 font-mono leading-relaxed min-h-[280px] focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                  placeholder="Введите шаблон сообщения..."
                />
              </div>
            </div>
          )}

          {/* TAB 2: QUICK UPLOAD LINKS */}
          {activeTab === 'quickLinks' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                    Кнопки быстрого перехода для загрузки серий
                  </h3>
                  <p className="text-[11px] text-neutral-400">
                    Отображаются в сборке релиза вверху для быстрого открытия сервисов закачки
                  </p>
                </div>
                <button
                  onClick={handleAddQuickLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-purple-400 rounded-lg text-xs font-bold transition-all border border-neutral-700 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Добавить кнопку</span>
                </button>
              </div>

              <div className="space-y-2.5">
                {preset.quickUploadLinks.map((item, idx) => (
                  <div 
                    key={idx} 
                    className="flex flex-col sm:flex-row items-start sm:items-center gap-2.5 bg-black/40 p-3 rounded-xl border border-neutral-800"
                  >
                    <span className="text-xs font-mono text-neutral-500 w-5 text-center">{idx + 1}</span>
                    <div className="w-full sm:w-1/3">
                      <label className="text-[9px] font-bold text-neutral-500 uppercase block mb-1">Название</label>
                      <input
                        type="text"
                        value={item.name}
                        onChange={(e) => handleUpdateQuickLink(idx, 'name', e.target.value)}
                        placeholder="Напр., Kodik Конвертер"
                        className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                    </div>
                    <div className="w-full sm:flex-1">
                      <label className="text-[9px] font-bold text-neutral-500 uppercase block mb-1">Ссылка для перехода</label>
                      <input
                        type="text"
                        value={item.url}
                        onChange={(e) => handleUpdateQuickLink(idx, 'url', e.target.value)}
                        placeholder="https://..."
                        className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
                      />
                    </div>
                    <button
                      onClick={() => handleRemoveQuickLink(idx)}
                      className="p-2 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors sm:mt-5 cursor-pointer"
                      title="Удалить кнопку"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                {preset.quickUploadLinks.length === 0 && (
                  <div className="py-8 text-center text-xs text-neutral-500 italic bg-black/20 rounded-xl border border-dashed border-neutral-800">
                    Список кнопок пуст. Нажмите «Добавить кнопку» выше.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: PLATFORM DEFAULT LINKS */}
          {activeTab === 'platformLinks' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Дефолтные базовые ссылки для новых релизов
                </h3>
                <p className="text-[11px] text-neutral-400">
                  Эти ссылки будут автоматически подставляться в карточку нового релиза
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { key: 'tg', label: 'Telegram канал', placeholder: 'https://t.me/your_channel' },
                  { key: 'vk', label: 'VK паблик / группа', placeholder: 'https://vk.com/your_group' },
                  { key: 'anime365', label: 'Anime365', placeholder: 'https://smotret-anime.com/...' },
                  { key: 'kodik', label: 'Kodik плеер', placeholder: 'https://...' },
                  { key: 'shikimori', label: 'Shikimori', placeholder: 'https://shikimori.one/...' }
                ].map(f => (
                  <div key={f.key} className="space-y-1 bg-black/30 p-3 rounded-xl border border-neutral-800">
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                      {f.label}
                    </label>
                    <input
                      type="text"
                      value={preset.defaultPlatformLinks[f.key] || ''}
                      onChange={(e) => {
                        setPreset({
                          ...preset,
                          defaultPlatformLinks: {
                            ...preset.defaultPlatformLinks,
                            [f.key]: e.target.value
                          }
                        });
                      }}
                      placeholder={f.placeholder}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-950/90 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleApplyToAllProjects}
              disabled={isApplyingAll || isSaving}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
              title={`Обновить шаблоны и ссылки во всех существующих релизах (${matchingProjectsCount} шт.) типа «${RELEASE_TYPE_LABELS[selectedType]}»`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isApplyingAll ? 'animate-spin' : ''}`} />
              <span>
                {isApplyingAll 
                  ? 'Применение ко всем проектам...' 
                  : `Применить ко всем ${matchingProjectsCount} схожим проектам`}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Закрыть
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={isSaving || isApplyingAll}
              className="flex items-center gap-2 px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-purple-600/30 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Сохранение...' : `Сохранить глобально для «${RELEASE_TYPE_LABELS[selectedType]}»`}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
