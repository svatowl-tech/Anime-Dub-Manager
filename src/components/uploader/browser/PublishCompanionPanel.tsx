import React, { useState } from 'react';
import { 
  Copy, 
  Check, 
  Sparkles, 
  Send, 
  Film, 
  Hash, 
  Users, 
  Volume2, 
  FileText, 
  ExternalLink,
  Layers,
  ChevronDown,
  ChevronUp,
  Tv,
  FileVideo,
  BookmarkCheck
} from 'lucide-react';
import { Episode, ProjectLinks } from '../../../types';
import { TemplateType, CustomFieldItem } from '../types';
import { toast } from 'sonner';

interface PublishCompanionPanelProps {
  currentEpisode: Episode | null;
  generatedPost?: string;
  templateType?: TemplateType;
  onBuildPostText?: (type: TemplateType) => void;
  customFields?: CustomFieldItem[];
  projectLinks?: ProjectLinks;
  compact?: boolean;
}

export const PublishCompanionPanel: React.FC<PublishCompanionPanelProps> = ({
  currentEpisode,
  generatedPost,
  templateType = 'TG',
  onBuildPostText,
  customFields = [],
  projectLinks,
  compact = false
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TemplateType>(templateType);
  const [isExpanded, setIsExpanded] = useState<boolean>(!compact);

  const projectTitle = currentEpisode?.project?.title || 'Проект';
  const episodeNumber = currentEpisode?.number || 1;
  const fullReleaseTitle = `${projectTitle} — ${episodeNumber} серия [Озвучка]`;
  const epDescription = currentEpisode?.project?.synopsis || '';
  const originalTitle = currentEpisode?.project?.originalTitle || '';

  // Extract participants
  const dubbers = currentEpisode?.assignments
    ?.map(a => a.dubber?.nickname)
    .filter(Boolean)
    .join(', ') || 'Дабберы команды';

  const soundEngineers = currentEpisode?.assignments?.find(a => (a as any).roleName?.toLowerCase().includes('звук') || (a as any).roleName?.toLowerCase().includes('sound'))?.dubber?.nickname
    || currentEpisode?.assignments?.[0]?.dubber?.nickname
    || 'Звукорежиссер';

  const safeSlug = (currentEpisode?.project?.title || 'anime')
    .toLowerCase()
    .replace(/[^a-zа-я0-9]/gi, '_')
    .replace(/_+/g, '_');

  const defaultHashtags = `#${safeSlug} #аниме #озвучка #${episodeNumber}серия`;
  const videoFilePath = currentEpisode?.rawPath || (currentEpisode as any)?.videoPath || '';

  const copyText = (text: string, label: string) => {
    if (!text) {
      toast.error('Поле пустое');
      return;
    }
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 2000);
    toast.success(`Скопировано: ${label}`);
  };

  const handleSwitchTemplate = (type: TemplateType) => {
    setActiveTab(type);
    if (onBuildPostText) {
      onBuildPostText(type);
    }
  };

  const handleOpenCompanionMiniWindow = () => {
    const miniWin = window.open('', 'adm_copier_hud', 'width=420,height=680,left=100,top=100,resizable=yes,scrollbars=yes');
    if (!miniWin) {
      toast.error('Всплывающие окна заблокированы браузером');
      return;
    }

    const postContent = generatedPost || fullReleaseTitle;
    const docHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Компаньон копирования — ${projectTitle}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #09090b;
            color: #f4f4f5;
            padding: 14px;
            margin: 0;
            font-size: 13px;
          }
          h3 { margin: 0 0 4px 0; font-size: 15px; color: #38bdf8; }
          .sub { font-size: 11px; color: #a1a1aa; margin-bottom: 12px; }
          .item {
            background: #18181b;
            border: 1px solid #27272a;
            border-radius: 8px;
            padding: 8px 10px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.15s;
          }
          .item:hover {
            border-color: #38bdf8;
            background: #27272a;
          }
          .label { font-size: 10px; text-transform: uppercase; color: #a1a1aa; font-weight: 700; }
          .val { font-size: 12px; color: #fff; margin-top: 2px; word-break: break-all; }
          .post-box {
            background: #18181b;
            border: 1px solid #0284c7;
            border-radius: 8px;
            padding: 10px;
            margin-bottom: 12px;
          }
          textarea {
            width: 100%;
            height: 140px;
            background: #09090b;
            border: 1px solid #27272a;
            color: #e4e4e7;
            border-radius: 6px;
            padding: 8px;
            font-size: 12px;
            resize: vertical;
            margin-top: 6px;
          }
          .btn {
            background: #0284c7;
            color: white;
            border: none;
            padding: 7px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            width: 100%;
            margin-top: 6px;
          }
          .btn:hover { background: #0369a1; }
          .toast {
            position: fixed;
            bottom: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: #10b981;
            color: black;
            font-weight: bold;
            padding: 6px 14px;
            border-radius: 20px;
            display: none;
          }
        </style>
      </head>
      <body>
        <h3>${projectTitle} (${episodeNumber} сер.)</h3>
        <div class="sub">Кликайте по полям для мгновенного копирования в буфер</div>

        <div class="post-box">
          <div class="label" style="color: #38bdf8;">Готовый пост релиза</div>
          <textarea id="postText">${postContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
          <button class="btn" onclick="copyValue(document.getElementById('postText').value, 'Весь пост')">Скопировать весь пост</button>
        </div>

        <div class="item" onclick="copyValue('${projectTitle.replace(/'/g, "\\'")}', 'Название')">
          <div class="label">Название тайтла</div>
          <div class="val">${projectTitle}</div>
        </div>

        <div class="item" onclick="copyValue('${episodeNumber}', 'Номер серии')">
          <div class="label">Номер серии</div>
          <div class="val">${episodeNumber} серия</div>
        </div>

        <div class="item" onclick="copyValue('${fullReleaseTitle.replace(/'/g, "\\'")}', 'Полный заголовок')">
          <div class="label">Полный заголовок релиза</div>
          <div class="val">${fullReleaseTitle}</div>
        </div>

        <div class="item" onclick="copyValue('${dubbers.replace(/'/g, "\\'")}', 'Дабберы')">
          <div class="label">Озвучка / Роли</div>
          <div class="val">${dubbers}</div>
        </div>

        <div class="item" onclick="copyValue('${soundEngineers.replace(/'/g, "\\'")}', 'Звук')">
          <div class="label">Звукорежиссер / Тайминг</div>
          <div class="val">${soundEngineers}</div>
        </div>

        <div class="item" onclick="copyValue('${defaultHashtags.replace(/'/g, "\\'")}', 'Хэштеги')">
          <div class="label">Хэштеги</div>
          <div class="val">${defaultHashtags}</div>
        </div>

        <div id="toast" class="toast">Скопировано!</div>

        <script>
          function copyValue(text, label) {
            navigator.clipboard.writeText(text);
            const t = document.getElementById('toast');
            t.innerText = 'Скопировано: ' + label;
            t.style.display = 'block';
            setTimeout(() => { t.style.display = 'none'; }, 1500);
          }
        </script>
      </body>
      </html>
    `;
    miniWin.document.open();
    miniWin.document.write(docHtml);
    miniWin.document.close();
    toast.success('Мини-окно быстрого копирования открыто');
  };

  const templatesList: Array<{ id: TemplateType; label: string; icon: React.ElementType }> = [
    { id: 'TG', label: 'Telegram', icon: Send },
    { id: 'VK', label: 'ВКонтакте', icon: Tv },
    { id: 'FINAL_TG', label: 'Финальный TG', icon: BookmarkCheck },
    { id: 'YT', label: 'YouTube / RuTube', icon: Film },
    { id: 'TORRENT', label: 'Трекер / Nyaa', icon: Layers }
  ];

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 sm:p-5 flex flex-col space-y-4 shadow-xl">
      {/* Header with Project and Mini-HUD Button */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-neutral-100 truncate">
                {projectTitle}
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-800 font-mono flex-shrink-0">
                Серия {episodeNumber}
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 truncate">
              Генератор постов и быстрый копир в 1 клик
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleOpenCompanionMiniWindow}
            className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-sky-400 hover:text-sky-300 rounded-lg text-xs font-medium border border-neutral-700 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
            title="Открыть отдельное плавающее мини-окно копирования поверх всех программ"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Мини-окно HUD</span>
          </button>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition cursor-pointer"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Template Selector Tabs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Шаблон поста публикации
              </span>
              <button
                onClick={() => copyText(generatedPost || fullReleaseTitle, 'Весь пост')}
                className="text-xs font-medium text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
              >
                {copiedKey === 'Весь пост' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Скопировать пост целиком</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {templatesList.map(t => {
                const Icon = t.icon;
                const isSel = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => handleSwitchTemplate(t.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer border ${
                      isSel
                        ? 'bg-sky-600 text-white border-sky-500 shadow-sm'
                        : 'bg-neutral-950 text-neutral-400 hover:text-neutral-200 border-neutral-800 hover:border-neutral-700'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Generated Post Box */}
            <div className="relative">
              <textarea
                readOnly
                value={generatedPost || `${fullReleaseTitle}\n\nОзвучка: ${dubbers}\nЗвук: ${soundEngineers}\n\n${defaultHashtags}`}
                className="w-full h-28 bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-xs text-neutral-200 font-sans resize-y focus:outline-none focus:border-sky-500/50 leading-relaxed select-all"
              />
              <button
                onClick={() => copyText(generatedPost || fullReleaseTitle, 'Весь пост')}
                className="absolute top-2 right-2 px-2.5 py-1 bg-sky-600/90 hover:bg-sky-500 text-white text-[11px] font-semibold rounded-md shadow flex items-center gap-1 cursor-pointer backdrop-blur-sm"
              >
                {copiedKey === 'Весь пост' ? <Check className="w-3 h-3 text-emerald-300" /> : <Copy className="w-3 h-3" />}
                <span>Копировать</span>
              </button>
            </div>
          </div>

          {/* Quick-Copy Grid (1-Click Fields) */}
          <div className="space-y-2 pt-1 border-t border-neutral-800/80">
            <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-pink-400" /> Быстрые поля в 1 клик
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Field 1: Title */}
              <button
                onClick={() => copyText(projectTitle, 'Название тайтла')}
                className="p-2.5 bg-neutral-950 hover:bg-neutral-800/90 border border-neutral-800 rounded-xl text-left transition flex items-center justify-between group cursor-pointer"
              >
                <div className="min-w-0 flex-1 pr-2">
                  <div className="text-[10px] text-neutral-500 font-semibold uppercase">Название тайтла</div>
                  <div className="text-xs text-neutral-200 truncate font-medium">{projectTitle}</div>
                </div>
                {copiedKey === 'Название тайтла' ? (
                  <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : (
                  <Copy className="w-4 h-4 text-neutral-500 group-hover:text-sky-400 flex-shrink-0" />
                )}
              </button>

              {/* Field 2: Full Title */}
              <button
                onClick={() => copyText(fullReleaseTitle, 'Полный заголовок')}
                className="p-2.5 bg-neutral-950 hover:bg-neutral-800/90 border border-neutral-800 rounded-xl text-left transition flex items-center justify-between group cursor-pointer"
              >
                <div className="min-w-0 flex-1 pr-2">
                  <div className="text-[10px] text-neutral-500 font-semibold uppercase">Полный заголовок</div>
                  <div className="text-xs text-neutral-200 truncate font-medium">{fullReleaseTitle}</div>
                </div>
                {copiedKey === 'Полный заголовок' ? (
                  <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : (
                  <Copy className="w-4 h-4 text-neutral-500 group-hover:text-sky-400 flex-shrink-0" />
                )}
              </button>

              {/* Field 3: Episode Number */}
              <button
                onClick={() => copyText(String(episodeNumber), 'Номер серии')}
                className="p-2.5 bg-neutral-950 hover:bg-neutral-800/90 border border-neutral-800 rounded-xl text-left transition flex items-center justify-between group cursor-pointer"
              >
                <div className="min-w-0 flex-1 pr-2">
                  <div className="text-[10px] text-neutral-500 font-semibold uppercase">Номер серии</div>
                  <div className="text-xs text-neutral-200 truncate font-medium">{episodeNumber} серия</div>
                </div>
                {copiedKey === 'Номер серии' ? (
                  <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : (
                  <Copy className="w-4 h-4 text-neutral-500 group-hover:text-sky-400 flex-shrink-0" />
                )}
              </button>

              {/* Field 4: Dubbers */}
              <button
                onClick={() => copyText(dubbers, 'Озвучка')}
                className="p-2.5 bg-neutral-950 hover:bg-neutral-800/90 border border-neutral-800 rounded-xl text-left transition flex items-center justify-between group cursor-pointer"
              >
                <div className="min-w-0 flex-1 pr-2">
                  <div className="text-[10px] text-neutral-500 font-semibold uppercase flex items-center gap-1">
                    <Users className="w-2.5 h-2.5 text-sky-400" /> Роли / Озвучка
                  </div>
                  <div className="text-xs text-neutral-200 truncate font-medium">{dubbers}</div>
                </div>
                {copiedKey === 'Озвучка' ? (
                  <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : (
                  <Copy className="w-4 h-4 text-neutral-500 group-hover:text-sky-400 flex-shrink-0" />
                )}
              </button>

              {/* Field 5: Sound Engineer */}
              <button
                onClick={() => copyText(soundEngineers, 'Звукорежиссер')}
                className="p-2.5 bg-neutral-950 hover:bg-neutral-800/90 border border-neutral-800 rounded-xl text-left transition flex items-center justify-between group cursor-pointer"
              >
                <div className="min-w-0 flex-1 pr-2">
                  <div className="text-[10px] text-neutral-500 font-semibold uppercase flex items-center gap-1">
                    <Volume2 className="w-2.5 h-2.5 text-amber-400" /> Звукорежиссер / Тайминг
                  </div>
                  <div className="text-xs text-neutral-200 truncate font-medium">{soundEngineers}</div>
                </div>
                {copiedKey === 'Звукорежиссер' ? (
                  <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : (
                  <Copy className="w-4 h-4 text-neutral-500 group-hover:text-sky-400 flex-shrink-0" />
                )}
              </button>

              {/* Field 6: Hashtags */}
              <button
                onClick={() => copyText(defaultHashtags, 'Хэштеги')}
                className="p-2.5 bg-neutral-950 hover:bg-neutral-800/90 border border-neutral-800 rounded-xl text-left transition flex items-center justify-between group cursor-pointer"
              >
                <div className="min-w-0 flex-1 pr-2">
                  <div className="text-[10px] text-neutral-500 font-semibold uppercase flex items-center gap-1">
                    <Hash className="w-2.5 h-2.5 text-purple-400" /> Хэштеги
                  </div>
                  <div className="text-xs text-neutral-200 truncate font-medium">{defaultHashtags}</div>
                </div>
                {copiedKey === 'Хэштеги' ? (
                  <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : (
                  <Copy className="w-4 h-4 text-neutral-500 group-hover:text-sky-400 flex-shrink-0" />
                )}
              </button>

              {/* Field 7: Video File Path / Name */}
              {videoFilePath && (
                <button
                  onClick={() => copyText(videoFilePath, 'Путь к видео')}
                  className="sm:col-span-2 p-2.5 bg-neutral-950 hover:bg-neutral-800/90 border border-neutral-800 rounded-xl text-left transition flex items-center justify-between group cursor-pointer"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="text-[10px] text-neutral-500 font-semibold uppercase flex items-center gap-1">
                      <FileVideo className="w-2.5 h-2.5 text-emerald-400" /> Исходный видеофайл
                    </div>
                    <div className="text-xs font-mono text-neutral-300 truncate">{videoFilePath}</div>
                  </div>
                  {copiedKey === 'Путь к видео' ? (
                    <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <Copy className="w-4 h-4 text-neutral-500 group-hover:text-sky-400 flex-shrink-0" />
                  )}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
