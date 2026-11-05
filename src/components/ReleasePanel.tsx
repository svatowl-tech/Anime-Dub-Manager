import React from 'react';
import {
  PlaySquare,
  Send,
  Globe,
  Sparkles,
  Copy,
  CheckCircle2,
  MessageSquare,
  Save,
  Package,
  Loader2,
  Edit3,
  Download,
  Upload,
  Table,
  Eye,
  Code,
  Columns,
  ExternalLink,
  Sliders
} from 'lucide-react';
import { ipcSafe, isWeb } from '../lib/ipcSafe';
import { safeCopyToClipboard } from '../lib/clipboard';
import { DesktopRequiredMessage } from './DesktopRequiredMessage';
import { TelegramClientPanel } from './TelegramClientPanel';
import AnimeSourcesModal from './AnimeSourcesModal';
import ReleasePresetsModal from './release/ReleasePresetsModal';
import TemplateVariablesBar from './TemplateVariablesBar';
import TemplateBlockConfiguratorModal from './TemplateBlockConfiguratorModal';
import { getReleasePresetSync } from '../lib/releasePresetsService';
import {
  generateTGPostMessage,
  generateVKPostMessage,
  generateFinalTGMessage,
  generateTGArticleMessage,
  markdownTableToUnicodeBox
} from '../lib/templates';
import {
  useReleasePanelController,
  ReleasePanelProps,
  DEFAULT_QUICK_LINKS
} from './release/useReleasePanelController';
import {
  ReleaseLinksAndPlatformsSection,
  ReleaseTemplateCardItem
} from './release/ReleaseLinksAndPlatformsSection';

export { DEFAULT_QUICK_LINKS };
export type { ReleasePanelProps };

export function ReleasePanel({ currentEpisode, onRefresh }: ReleasePanelProps) {
  const {
    participants,
    postContent,
    setPostContent,
    isCopied,
    isCopiedMarkdown,
    setIsCopiedMarkdown,
    isCopiedUnicode,
    setIsCopiedUnicode,
    activeTemplate,
    setActiveTemplate,
    articleViewMode,
    setArticleViewMode,
    links,
    setLinks,
    isSavingLinks,
    isBuilding,
    buildProgress,
    customAudioPath,
    setCustomAudioPath,
    customRawPath,
    setCustomRawPath,
    isEditingTemplate,
    setIsEditingTemplate,
    editingTemplateStr,
    setEditingTemplateStr,
    linksTemplateStr,
    setLinksTemplateStr,
    isEditingLinksTemplate,
    setIsEditingLinksTemplate,
    quickLinks,
    setQuickLinks,
    isEditingQuickLinks,
    setIsEditingQuickLinks,
    tgPostLink,
    setTgPostLink,
    vkPostLink,
    setVkPostLink,
    isTelegramModalOpen,
    setIsTelegramModalOpen,
    allProjects,
    loadProjects,
    isAnimeSourcesModalOpen,
    setIsAnimeSourcesModalOpen,
    isAutoFillingLinks,
    autoFillFeedback,
    setAutoFillFeedback,
    isPresetsModalOpen,
    setIsPresetsModalOpen,
    isTemplateBlockConfiguratorOpen,
    setIsTemplateBlockConfiguratorOpen,
    renderedHtmlArticle,
    renderedUnicodeArticle,
    updateLinksAndSync,
    handleApplyConfiguratorTemplate,
    handleQuickAutoFill,
    handleApplySourcesModalLinks,
    handleSelectVideoSource,
    handleSelectSubtitleSource,
    handleBuildRelease,
    handleSaveLinks,
    handleSaveEpisodePostLinks,
    handleCopy,
    handleTextareaKeyDown,
    handleOpenExternal,
    handleSaveTemplateLocal,
    handleSaveLinksTemplate,
    handleSaveTemplateGlobal,
    handleExportConfig,
    handleImportConfig,
    getTemplateString
  } = useReleasePanelController({ currentEpisode, onRefresh });

  const templates: ReleaseTemplateCardItem[] = [
    { 
      name: 'Пост в Telegram', 
      icon: <Send className="w-4 h-4" />, 
      color: 'bg-blue-600',
      generate: () => currentEpisode ? generateTGPostMessage(currentEpisode, participants) : '',
      type: 'TG' as const
    },
    { 
      name: 'Статья TG (с таблицей)', 
      icon: <Table className="w-4 h-4" />, 
      color: 'bg-emerald-600',
      generate: () => currentEpisode ? generateTGArticleMessage(currentEpisode, participants) : '',
      type: 'TG_ARTICLE' as const
    },
    { 
      name: 'Пост в VK', 
      icon: <Globe className="w-4 h-4" />, 
      color: 'bg-indigo-600',
      generate: () => currentEpisode ? generateVKPostMessage(currentEpisode, participants) : '',
      type: 'VK' as const
    },
    { 
      name: 'Финальный пост TG', 
      icon: <Sparkles className="w-4 h-4" />, 
      color: 'bg-purple-600',
      generate: () => currentEpisode ? generateFinalTGMessage(currentEpisode, participants) : '',
      type: 'FINAL_TG' as const
    }
  ];

  if (!currentEpisode) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 italic">
        Выберите серию для сборки релиза
      </div>
    );
  }

  return (
    <div className="w-full space-y-8 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-purple-600/20 rounded-xl">
            <PlaySquare className="w-8 h-8 text-purple-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Сборка релиза</h1>
            <p className="text-neutral-400">Формирование постов и сборка финального файла</p>
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <button
                onClick={() => setIsPresetsModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600/30 to-indigo-600/30 hover:from-purple-600/40 hover:to-indigo-600/40 text-purple-300 rounded-lg text-xs font-bold transition-all border border-purple-500/30 hover:border-purple-500/50 cursor-pointer shadow-sm shadow-purple-500/10"
                title="Настроить глобальные шаблоны сообщений и ссылки по типам релизов (Закадр, Рекаст, Дубляж)"
              >
                <Sliders className="w-3.5 h-3.5 text-purple-400" />
                <span>Глобальные шаблоны типов релизов</span>
              </button>

              <button
                onClick={handleExportConfig}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-purple-400 hover:text-purple-300 rounded-lg text-xs font-bold transition-all border border-neutral-800 hover:border-neutral-700 cursor-pointer"
                title="Экспортировать настройки сборки, ссылки и шаблоны"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Экспорт JSON</span>
              </button>
              <label
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-emerald-400 hover:text-emerald-300 rounded-lg text-xs font-bold transition-all border border-neutral-800 hover:border-neutral-700 cursor-pointer"
                title="Импортировать настройки сборки, ссылки и шаблоны"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Импорт JSON</span>
                <input 
                  type="file" 
                  accept=".json" 
                  onChange={handleImportConfig} 
                  className="hidden" 
                />
              </label>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 space-y-2">
              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Аудио от звукорежиссера</label>
              <div className="flex gap-2">
                <input 
                  type="text"
                  readOnly
                  value={customAudioPath}
                  placeholder="Выберите файл .wav или .mp3..."
                  className="flex-1 bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
                />
                <button
                  onClick={async () => {
                    try {
                      const res = await ipcSafe.invoke('select-file', { 
                        filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac'] }] 
                      });
                      if (res && res.path) setCustomAudioPath(res.path);
                    } catch (e: any) {
                      if (e && e.message !== 'Selection canceled') console.error(e);
                    }
                  }}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-bold transition-all"
                >
                  Выбрать
                </button>
              </div>
            </div>

            {currentEpisode?.isHardsub && (
              <div className="flex-1 space-y-2">
                <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Чистый RAW (т.к. загружен хардсаб)</label>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    readOnly
                    value={customRawPath}
                    placeholder="Выберите чистый видеофайл..."
                    className="flex-1 bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
                  />
                  <button
                    onClick={async () => {
                      try {
                        const res = await ipcSafe.invoke('select-file', { 
                          filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov'] }] 
                        });
                        if (res && res.path) setCustomRawPath(res.path);
                      } catch (e: any) {
                        if (e && e.message !== 'Selection canceled') console.error(e);
                      }
                    }}
                    className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-bold transition-all"
                  >
                    Выбрать
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col md:flex-row gap-4">
            {isWeb ? (
              <div className="w-full">
                 <DesktopRequiredMessage title="Сборка релиза недоступна" />
              </div>
            ) : (
             <button
              onClick={handleBuildRelease}
              disabled={isBuilding}
              className="flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-2xl font-bold shadow-xl shadow-purple-500/20 transition-all group relative overflow-hidden"
            >
              {isBuilding ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Сборка... {buildProgress}%</span>
                  <div 
                    className="absolute bottom-0 left-0 h-1 bg-white/30 transition-all duration-300" 
                    style={{ width: `${buildProgress}%` }}
                  />
                </>
              ) : (
                <>
                  <Package className="w-5 h-5 group-hover:scale-110 transition-transform" />
                  <span>Собрать релиз</span>
                </>
              )}
             </button>
            )}
          </div>
        </div>
      </div>

      <ReleaseLinksAndPlatformsSection
        currentEpisode={currentEpisode}
        tgPostLink={tgPostLink}
        setTgPostLink={setTgPostLink}
        vkPostLink={vkPostLink}
        setVkPostLink={setVkPostLink}
        isSavingLinks={isSavingLinks}
        handleSaveEpisodePostLinks={handleSaveEpisodePostLinks}
        isEditingQuickLinks={isEditingQuickLinks}
        setIsEditingQuickLinks={setIsEditingQuickLinks}
        quickLinks={quickLinks}
        setQuickLinks={setQuickLinks}
        handleSaveLinks={handleSaveLinks}
        handleOpenExternal={handleOpenExternal}
        templates={templates}
        activeTemplate={activeTemplate}
        setActiveTemplate={setActiveTemplate}
        setPostContent={setPostContent}
        handleQuickAutoFill={handleQuickAutoFill}
        isAutoFillingLinks={isAutoFillingLinks}
        setIsAnimeSourcesModalOpen={setIsAnimeSourcesModalOpen}
        linksTemplateStr={linksTemplateStr}
        setLinksTemplateStr={setLinksTemplateStr}
        isEditingLinksTemplate={isEditingLinksTemplate}
        setIsEditingLinksTemplate={setIsEditingLinksTemplate}
        handleSaveLinksTemplate={handleSaveLinksTemplate}
        handleTextareaKeyDown={handleTextareaKeyDown}
        autoFillFeedback={autoFillFeedback}
        setAutoFillFeedback={setAutoFillFeedback}
        links={links}
        setLinks={setLinks}
        updateLinksAndSync={updateLinksAndSync}
      />

      {postContent && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {activeTemplate === 'TG_ARTICLE' ? (
                  <Table className="w-4 h-4 text-emerald-400" />
                ) : (
                  <MessageSquare className="w-4 h-4 text-purple-400" />
                )}
                <span className="text-sm font-bold text-white uppercase tracking-wider">
                  {isEditingTemplate ? 'Редактирование шаблона' : activeTemplate === 'TG_ARTICLE' ? 'Статья Telegram с таблицей' : 'Предпросмотр сообщения'}
                </span>
              </div>

              {!isEditingTemplate && activeTemplate === 'TG_ARTICLE' && (
                <div className="flex items-center bg-black/40 border border-neutral-800 rounded-lg p-0.5 text-xs">
                  <button
                    onClick={() => setArticleViewMode('visual')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all font-medium ${
                      articleViewMode === 'visual'
                        ? 'bg-emerald-600/80 text-white shadow-sm'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                    title="Вид статьи со стилизованной таблицей"
                  >
                    <Eye className="w-3 h-3" />
                    <span>Вид статьи</span>
                  </button>
                  <button
                    onClick={() => setArticleViewMode('markdown')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all font-medium ${
                      articleViewMode === 'markdown'
                        ? 'bg-emerald-600/80 text-white shadow-sm'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                    title="Исходная Markdown-разметка таблицы"
                  >
                    <Code className="w-3 h-3" />
                    <span>Markdown</span>
                  </button>
                  <button
                    onClick={() => setArticleViewMode('unicode')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all font-medium ${
                      articleViewMode === 'unicode'
                        ? 'bg-emerald-600/80 text-white shadow-sm'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                    title="Таблица Unicode-символами (для моноширинного текста в Telegram)"
                  >
                    <Columns className="w-3 h-3" />
                    <span>Unicode-таблица</span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!isEditingTemplate ? (
                <>
                  <button
                    onClick={() => setIsTemplateBlockConfiguratorOpen(true)}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 rounded-lg text-xs font-bold transition-all shadow-sm"
                    title="Настроить содержимое блоков (актеры, роли, ссылки, форматы)"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                    <span>Конструктор блоков</span>
                  </button>

                  <button
                    onClick={() => {
                      if (activeTemplate) {
                        setEditingTemplateStr(getTemplateString(currentEpisode, activeTemplate));
                        setIsEditingTemplate(true);
                      }
                    }}
                    className="flex items-center gap-2 px-3.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-bold transition-all"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-purple-400" />
                    Редактировать код
                  </button>

                  {activeTemplate === 'TG_ARTICLE' && (
                    <>
                      <button
                        onClick={async () => {
                          try {
                            await safeCopyToClipboard(postContent);
                            setIsCopiedMarkdown(true);
                            setTimeout(() => setIsCopiedMarkdown(false), 2000);
                          } catch (e) {
                            console.error(e);
                          }
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          isCopiedMarkdown ? 'bg-green-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
                        }`}
                        title="Скопировать чистый Markdown статьи"
                      >
                        {isCopiedMarkdown ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Code className="w-3.5 h-3.5" />}
                        {isCopiedMarkdown ? 'Markdown скопирован!' : 'Копировать MD'}
                      </button>

                      <button
                        onClick={async () => {
                          try {
                            const unicodeText = markdownTableToUnicodeBox(postContent);
                            await safeCopyToClipboard(unicodeText);
                            setIsCopiedUnicode(true);
                            setTimeout(() => setIsCopiedUnicode(false), 2000);
                          } catch (e) {
                            console.error(e);
                          }
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          isCopiedUnicode ? 'bg-green-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
                        }`}
                        title="Скопировать таблицу псевдографикой Unicode (для обычных постов в моноширинном шрифте)"
                      >
                        {isCopiedUnicode ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Columns className="w-3.5 h-3.5" />}
                        {isCopiedUnicode ? 'Таблица скопирована!' : 'Копировать Unicode'}
                      </button>

                      <a
                        href="https://telegra.ph"
                        onClick={(e) => handleOpenExternal('https://telegra.ph', e)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-bold transition-all"
                        title="Открыть Telegra.ph в браузере для вставки статьи"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Telegra.ph</span>
                      </a>
                    </>
                  )}

                  <button
                    onClick={handleCopy}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md ${
                      isCopied ? 'bg-green-600 text-white' : activeTemplate === 'TG_ARTICLE' ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-purple-600 hover:bg-purple-500 text-white'
                    }`}
                    title="Копирует форматированный текст и HTML-таблицу для вставки в Telegram/Telegra.ph"
                  >
                    {isCopied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {isCopied ? 'Скопировано!' : activeTemplate === 'TG_ARTICLE' ? 'Скопировать для статьи' : 'Копировать'}
                  </button>

                  <button
                    onClick={() => setIsTelegramModalOpen(true)}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold transition-all shadow-md"
                    title="Опубликовать в канале через Telegram MTProto Client"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Опубликовать в TG MTProto</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setIsEditingTemplate(false)}
                    className="flex items-center gap-2 px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-bold transition-all"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={handleSaveTemplateLocal}
                    className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Сохранить только для этой серии
                  </button>
                  <button
                    onClick={handleSaveTemplateGlobal}
                    className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Сохранить для всего проекта
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="p-6 md:p-8 flex flex-col gap-4">
            {activeTemplate === 'TG_ARTICLE' && !isEditingTemplate && (
              <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-3.5 text-xs text-emerald-200/90 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <span className="text-base">💡</span>
                  <span>
                    Нажмите <strong>«Скопировать для статьи»</strong> и вставьте (<strong>Ctrl+V</strong>) в редактор <strong>Telegram Desktop</strong> или <strong>Telegra.ph</strong>. Готовая таблица, роли и ссылки отформатируются автоматически.
                  </span>
                </div>
              </div>
            )}

            {isEditingTemplate && (
              <div className="bg-blue-900/20 border border-blue-500/20 p-6 rounded-xl text-xs text-blue-200 overflow-y-auto max-h-[300px] custom-scrollbar space-y-6">
                <div>
                  <p className="font-bold mb-3 text-sm text-blue-300">💡 Таблицы и списки для статьи:</p>
                  <div className="space-y-4 font-mono bg-black/40 p-3 rounded-lg border border-blue-900/40">
                    <div>
                      <p className="text-[10px] text-emerald-400 font-bold uppercase mb-1">Готовая таблица для статьи:</p>
                      <ul className="list-disc list-inside space-y-1 opacity-90">
                        <li><span className="text-emerald-300">{'{articleTable}'}</span> — полная таблица с ролями, дабберами, таймингом и оформлением</li>
                      </ul>
                    </div>
                    <div className="pt-2 border-t border-blue-900/20">
                      <p className="text-[10px] text-blue-400 font-bold uppercase mb-1">Списки для кастомной таблицы:</p>
                      <ul className="list-disc list-inside space-y-1 opacity-90">
                        <li><span className="text-white">mainRoles</span> (Пер. { '{character}, {nickname}, {tgLink}, {vk}' })</li>
                        <li><span className="text-white">secondaryDubbers</span> (Пер. { '{nickname}, {tgLink}, {vk}' })</li>
                        <li><span className="text-white">dubbers</span> (Пер. { '{nickname}, {tgLink}, {vk}' })</li>
                      </ul>
                    </div>
                    <div className="pt-2 border-t border-blue-900/20">
                      <p className="text-[10px] text-blue-400 font-bold uppercase mb-1">Пример строки таблицы:</p>
                      <p className="text-white opacity-80 whitespace-pre text-[11px]">| ❇ {'{character}'} | [{'{nickname}'}]({'{tgLink}'}) |</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                  <div className="space-y-2">
                    <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1 opacity-70">Основы (Чистые)</p>
                    <div className="grid grid-cols-1 gap-1 font-mono text-[11px]">
                      <span>{'{emoji}'}</span>
                      <span>{'{projectTitle}'}</span>
                      <span>{'{releaseTypeLabel}'} - Закадр/Рекаст</span>
                      <span>{'{progress}'} - 1/12</span>
                      <span>{'{episodeNumber}'}</span>
                      <span>{'{nextEpisodeNumber}'}</span>
                      <span>{'{totalEpisodes}'}</span>
                      <span>{'{projectSlug}'} - хештег</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1 opacity-70">Предыдущая серия и ссылки</p>
                    <div className="grid grid-cols-1 gap-1 font-mono text-[11px]">
                      <span>{'{prevEpisodeNumber}'}</span>
                      <span>{'{prevLinkTg}'}</span>
                      <span>{'{prevLinkVk}'}</span>
                      <span>{'{linkCatalog}'}</span>
                      <span>{'{catalogLabel}'}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1 opacity-70">Звукорежиссер</p>
                    <div className="grid grid-cols-1 gap-1 font-mono text-[11px]">
                      <span>{'{seNickname}'}</span>
                      <span>{'{seMention}'} - @тг</span>
                      <span>{'{seVk}'} - @вк</span>
                      <span>{'{seTgLink}'} - ссылка на тг</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1 opacity-70">Готовые блоки</p>
                    <div className="grid grid-cols-1 gap-1 font-mono text-[11px]">
                      <span>{'{articleTable}'}</span>
                      <span>{'{mainRolesText}'}</span>
                      <span>{'{dubberLinks}'}</span>
                      <span>{'{dubberInfo}'}</span>
                      <span>{'{platformLinks}'}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {isEditingTemplate ? (
              <div className="border border-neutral-800 rounded-xl overflow-hidden shadow-inner">
                <TemplateVariablesBar
                  onInsertVariable={(varSyntax) => setEditingTemplateStr(prev => prev + '\n' + varSyntax)}
                  onOpenBlockConfigurator={() => setIsTemplateBlockConfiguratorOpen(true)}
                />
                <textarea
                  value={editingTemplateStr}
                  onChange={e => setEditingTemplateStr(e.target.value)}
                  onKeyDown={e => handleTextareaKeyDown(e, setEditingTemplateStr)}
                  className="w-full bg-black/50 p-6 text-sm text-neutral-300 font-mono leading-relaxed min-h-[400px] focus:outline-none focus:ring-2 focus:ring-purple-500/50 border-0"
                />
              </div>
            ) : activeTemplate === 'TG_ARTICLE' && articleViewMode === 'visual' ? (
              <div 
                className="bg-[#0e1621] border border-[#233d5d] rounded-2xl p-6 overflow-x-auto shadow-inner flex justify-center cursor-default"
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  const anchor = target.closest('a');
                  if (anchor && anchor.href) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleOpenExternal(anchor.href, e as any);
                  }
                }}
              >
                <div 
                  className="w-full max-w-[540px]"
                  dangerouslySetInnerHTML={{ __html: renderedHtmlArticle }}
                />
              </div>
            ) : activeTemplate === 'TG_ARTICLE' && articleViewMode === 'unicode' ? (
              <pre className="bg-black/60 border border-neutral-800 rounded-xl p-6 text-sm text-emerald-300/90 whitespace-pre font-mono leading-tight max-h-[550px] overflow-x-auto overflow-y-auto custom-scrollbar">
                {renderedUnicodeArticle}
              </pre>
            ) : (
              <pre className="bg-black/50 border border-neutral-800 rounded-xl p-8 text-sm text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed max-h-[500px] overflow-y-auto custom-scrollbar">
                {postContent}
              </pre>
            )}
          </div>
        </div>
      )}

      {isTelegramModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4 overflow-hidden">
          <div className="w-full max-w-6xl max-h-[92vh] h-full flex flex-col my-auto">
            <TelegramClientPanel
              currentEpisode={currentEpisode}
              currentProject={currentEpisode?.project}
              allProjects={allProjects}
              onRefreshProjects={() => {
                loadProjects();
                onRefresh();
              }}
              onClose={() => setIsTelegramModalOpen(false)}
            />
          </div>
        </div>
      )}

      <AnimeSourcesModal
        isOpen={isAnimeSourcesModalOpen}
        onClose={() => setIsAnimeSourcesModalOpen(false)}
        currentEpisode={currentEpisode}
        project={currentEpisode?.project}
        onApplyLinks={handleApplySourcesModalLinks}
        onSelectVideoSource={handleSelectVideoSource}
        onSelectSubtitleSource={handleSelectSubtitleSource}
      />

      <TemplateBlockConfiguratorModal
        isOpen={isTemplateBlockConfiguratorOpen}
        onClose={() => setIsTemplateBlockConfiguratorOpen(false)}
        currentEpisode={currentEpisode}
        activeTemplateType={activeTemplate || 'TG'}
        onApplyTemplate={handleApplyConfiguratorTemplate}
      />

      <ReleasePresetsModal
        isOpen={isPresetsModalOpen}
        onClose={() => setIsPresetsModalOpen(false)}
        currentReleaseType={currentEpisode?.project?.releaseType || 'VOICEOVER'}
        allProjects={allProjects}
        onPresetUpdated={() => {
          onRefresh();
          if (currentEpisode) {
            const relType = currentEpisode.project?.releaseType || 'VOICEOVER';
            const preset = getReleasePresetSync(relType);
            const targetType = activeTemplate || preset.defaultTemplateType || 'TG';
            if (targetType === 'TG') setPostContent(generateTGPostMessage(currentEpisode, participants));
            else if (targetType === 'TG_ARTICLE') setPostContent(generateTGArticleMessage(currentEpisode, participants));
            else if (targetType === 'VK') setPostContent(generateVKPostMessage(currentEpisode, participants));
            else if (targetType === 'FINAL_TG') setPostContent(generateFinalTGMessage(currentEpisode, participants));
          }
        }}
      />
    </div>
  );
}
export default ReleasePanel;
