import React, { useState, useEffect } from 'react';
import { 
  Sliders, Sparkles, Check, Copy, X, Users, Globe, Hash, Music, AlignLeft, 
  CheckCircle2, RefreshCw, Eye, BookOpen, MessageSquare, Layers, HelpCircle
} from 'lucide-react';
import { Episode } from '../types';
import { 
  DEFAULT_TG_TEMPLATE_RECAST, 
  DEFAULT_TG_TEMPLATE_VOICEOVER,
  DEFAULT_VK_TEMPLATE_RECAST,
  DEFAULT_VK_TEMPLATE_VOICEOVER,
  DEFAULT_FINAL_TG_TEMPLATE,
  DEFAULT_TG_ARTICLE_TEMPLATE_RECAST,
  DEFAULT_TG_ARTICLE_TEMPLATE_VOICEOVER,
  DEFAULT_LINKS_TEMPLATE
} from '../lib/templates';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentEpisode: Episode | null;
  activeTemplateType: 'TG' | 'VK' | 'FINAL_TG' | 'TG_ARTICLE' | 'LINKS';
  onApplyTemplate: (templateStr: string, saveForWholeProject: boolean) => void;
}

export default function TemplateBlockConfiguratorModal({
  isOpen,
  onClose,
  currentEpisode,
  activeTemplateType,
  onApplyTemplate
}: Props) {
  const isRecast = currentEpisode?.project?.releaseType === 'RECAST' || currentEpisode?.project?.releaseType === 'REDUB';

  // 1. Header & General Block Settings
  const [headerEmoji, setHeaderEmoji] = useState('👾');
  const [releaseTypeBadge, setReleaseTypeBadge] = useState(isRecast ? 'Рекаст' : 'Закадр');
  const [progressFormat, setProgressFormat] = useState<'short' | 'full' | 'series_only'>('short');
  const [separatorStyle, setSeparatorStyle] = useState<'stars' | 'ribbon' | 'line' | 'none'>('stars');

  // 2. Main Roles Block Settings
  const [mainRolesHeader, setMainRolesHeader] = useState('Роли озвучили:');
  const [mainRolesFormat, setMainRolesFormat] = useState<string>(
    activeTemplateType === 'VK' 
      ? '{character} - {vk} ({nickname})' 
      : '➤ {character} - [{nickname}]({tgLink})'
  );
  const [mainRolesSeparator, setMainRolesSeparator] = useState<'\n' | ', ' | ' | '>('\n');

  // 3. Secondary Roles Block Settings
  const [includeSecondaryRoles, setIncludeSecondaryRoles] = useState(true);
  const [secondaryRolesHeader, setSecondaryRolesHeader] = useState('Второстепенные герои:');
  const [secondaryRolesFormat, setSecondaryRolesFormat] = useState<string>(
    activeTemplateType === 'VK'
      ? '{vk} ({nickname})'
      : '[{nickname}]({tgLink})'
  );
  const [secondaryRolesSeparator, setSecondaryRolesSeparator] = useState<'\n' | ', ' | ' | '>(', ');

  // 4. Sound Engineer Block Settings
  const [soundEngineerHeader, setSoundEngineerHeader] = useState('Тайминг и работа со звуком:');
  const [soundEngineerFormat, setSoundEngineerFormat] = useState<string>(
    activeTemplateType === 'VK' ? '{seName}' : '{seMention}'
  );

  // 5. Platform Links Block Settings
  const [linkPrefixStyle, setLinkPrefixStyle] = useState<'pointer' | 'bullet' | 'play' | 'flower'>('pointer');
  const [includedPlatforms, setIncludedPlatforms] = useState<Record<string, boolean>>({
    Anime365: true,
    Tg: true,
    Kodik: true,
    Vk: true,
    Shikimori: true,
    Jutsu: true,
    Animego: true
  });

  // 6. Footer Block Settings
  const [includeProjectHashtag, setIncludeProjectHashtag] = useState(true);
  const [includeDoneHashtag, setIncludeDoneHashtag] = useState(activeTemplateType === 'FINAL_TG');
  const [includePrevEpisodeLink, setIncludePrevEpisodeLink] = useState(false);
  const [customFooterText, setCustomFooterText] = useState('');

  // Output Generated Template
  const [generatedTemplate, setGeneratedTemplate] = useState('');

  // Re-generate template string dynamically on setting changes
  useEffect(() => {
    let result = '';

    const sepMap = {
      stars: '━━━━━━ ◦ ❖ ◦ ━━━━━━',
      ribbon: '─── 🎀 ───',
      line: '-------------------------------',
      none: ''
    };
    const sep = sepMap[separatorStyle];

    const prefixMap = {
      pointer: '➪',
      bullet: '•',
      play: '▶',
      flower: '🌸'
    };
    const linkPrefix = prefixMap[linkPrefixStyle];

    if (activeTemplateType === 'LINKS') {
      const activeKeys = Object.keys(includedPlatforms).filter(k => includedPlatforms[k]);
      result = activeKeys.map(k => `${linkPrefix} ${k}: {link${k}}`).join('\n');
      setGeneratedTemplate(result);
      return;
    }

    if (activeTemplateType === 'TG_ARTICLE') {
      result = `${sep ? sep + '\n' : ''}˗ˏˋ **{title}** ˎˊ˗\n🤍 **{progress}** 🤍\n${sep ? sep + '\n' : ''}\n{articleTable}\n\n${sep ? sep + '\n' : ''}`;
      if (includePrevEpisodeLink) {
        result += `🌸 [{catalogLabel}]({linkCatalog}) | ⬅ [{prevEpisodeNumber} серия]({prevLinkTg}) | {nextEpisodeNumber} (Скоро) ➡️`;
      } else {
        result += `🌸 [{catalogLabel}]({linkCatalog}) | {nextEpisodeNumber} (Скоро) ➡️`;
      }
      setGeneratedTemplate(result);
      return;
    }

    if (activeTemplateType === 'FINAL_TG') {
      result = `${headerEmoji} СЕРИЯ ВЫЛОЖЕНА: {title}\n👾 {progress} 👾\n`;
      if (sep) result += `${sep}\n`;
      result += `Ребята, всем спасибо за работу! Серия доступна по ссылкам ниже:\n\n{platformLinks}\n`;
      if (sep) result += `${sep}\n`;
      if (includeProjectHashtag) result += `#{projectSlug} `;
      if (includeDoneHashtag) result += `#готово`;
      setGeneratedTemplate(result.trim());
      return;
    }

    // Standard TG or VK Templates
    result = `${headerEmoji} {title} [${releaseTypeBadge}]\n`;
    if (progressFormat === 'short') {
      result += `👾 {progress} 👾\n`;
    } else if (progressFormat === 'full') {
      result += `👾 Серия {episodeNumber} из {totalEpisodes} 👾\n`;
    } else {
      result += `👾 Серия #{episodeNumber} 👾\n`;
    }

    if (sep) result += `\n${sep}\n`;

    // Main Roles
    if (mainRolesHeader) result += `${mainRolesHeader}\n`;
    result += `{mainRoles:[${mainRolesFormat}]${mainRolesSeparator === '\n' ? '\n' : `, `}}\n`;

    // Secondary Roles
    if (includeSecondaryRoles) {
      if (mainRolesSeparator !== '\n') result += `\n`;
      if (secondaryRolesHeader) result += `${secondaryRolesHeader} `;
      result += `{secondaryDubbers:[${secondaryRolesFormat}]${secondaryRolesSeparator === '\n' ? '\n' : `, `}}\n`;
    }

    // Sound Engineer
    result += `\n${soundEngineerHeader} \n${soundEngineerFormat}\n`;

    if (sep) result += `${sep}\n`;

    if (includePrevEpisodeLink && activeTemplateType === 'TG') {
      result += `\n⬅️ Предыдущая серия: {prevLinkTg}\n`;
    }

    if (customFooterText) {
      result += `\n${customFooterText}\n`;
    }

    if (includeProjectHashtag) {
      result += `\n#{projectSlug}`;
    }

    setGeneratedTemplate(result.trim());
  }, [
    headerEmoji, releaseTypeBadge, progressFormat, separatorStyle,
    mainRolesHeader, mainRolesFormat, mainRolesSeparator,
    includeSecondaryRoles, secondaryRolesHeader, secondaryRolesFormat, secondaryRolesSeparator,
    soundEngineerHeader, soundEngineerFormat, linkPrefixStyle, includedPlatforms,
    includeProjectHashtag, includeDoneHashtag, includePrevEpisodeLink, customFooterText,
    activeTemplateType, isRecast
  ]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-6 border-b border-neutral-800 bg-neutral-900/60 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-2xl text-purple-400">
              <Sliders className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white tracking-wide">
                  Детальный конструктор блоков шаблона
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-[10px] font-bold uppercase tracking-wider border border-purple-500/30">
                  {activeTemplateType}
                </span>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Настройте отображение ролей, ссылок, разделителей и переменных внутри каждого блока
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body: Left settings, Right Live Preview */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
          
          {/* LEFT: Detailed Settings */}
          <div className="lg:col-span-7 overflow-y-auto p-6 space-y-6 border-r border-neutral-800 custom-scrollbar">
            
            {/* 1. Header & General */}
            <div className="bg-neutral-950/60 border border-neutral-800/80 rounded-2xl p-4 space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold text-purple-400 uppercase tracking-wider">
                <AlignLeft className="w-4 h-4" />
                <span>1. Заголовок и оформление</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-neutral-500 uppercase">Эмодзи заголовка</label>
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    {['👾', '📢', '✨', '🎀', '🎙', '🎬', '🔥', '⭐'].map(e => (
                      <button
                        key={e}
                        onClick={() => setHeaderEmoji(e)}
                        className={`w-8 h-8 rounded-lg text-sm transition-all ${
                          headerEmoji === e ? 'bg-purple-600 text-white scale-110 shadow-md' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
                        }`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-neutral-500 uppercase">Стиль разделителя</label>
                  <select
                    value={separatorStyle}
                    onChange={(e) => setSeparatorStyle(e.target.value as any)}
                    className="w-full mt-1.5 bg-black/60 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                  >
                    <option value="stars">━━━━━━ ◦ ❖ ◦ ━━━━━━</option>
                    <option value="ribbon">─── 🎀 ───</option>
                    <option value="line">-------------------------------</option>
                    <option value="none">Без разделителя</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 2. Main Roles Block */}
            <div className="bg-neutral-950/60 border border-neutral-800/80 rounded-2xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-purple-400 uppercase tracking-wider">
                  <Users className="w-4 h-4" />
                  <span>2. Блок главных ролей</span>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-neutral-500 uppercase">Заголовок блока</label>
                  <input
                    type="text"
                    value={mainRolesHeader}
                    onChange={(e) => setMainRolesHeader(e.target.value)}
                    className="w-full mt-1 bg-black/60 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-neutral-500 uppercase">Формат отображения каждой роли</label>
                  <div className="space-y-2 mt-1">
                    <input
                      type="text"
                      value={mainRolesFormat}
                      onChange={(e) => setMainRolesFormat(e.target.value)}
                      className="w-full bg-black/60 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-purple-300 font-mono focus:outline-none focus:ring-1 focus:ring-purple-500"
                      placeholder="напр.: ➤ {character} - [{nickname}]({tgLink})"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setMainRolesFormat('➤ {character} - [{nickname}]({tgLink})')}
                        className="px-2 py-1 bg-neutral-850 hover:bg-neutral-800 border border-neutral-800 rounded text-[10px] text-neutral-300 font-mono"
                      >
                        [Name](t.me/...)
                      </button>
                      <button
                        onClick={() => setMainRolesFormat('• {character} — {nickname}')}
                        className="px-2 py-1 bg-neutral-850 hover:bg-neutral-800 border border-neutral-800 rounded text-[10px] text-neutral-300 font-mono"
                      >
                        Простой текст
                      </button>
                      <button
                        onClick={() => setMainRolesFormat('{character} — @{tg}')}
                        className="px-2 py-1 bg-neutral-850 hover:bg-neutral-800 border border-neutral-800 rounded text-[10px] text-neutral-300 font-mono"
                      >
                        Упоминание @
                      </button>
                      <button
                        onClick={() => setMainRolesFormat('{character} - {vk} ({nickname})')}
                        className="px-2 py-1 bg-neutral-850 hover:bg-neutral-800 border border-neutral-800 rounded text-[10px] text-neutral-300 font-mono"
                      >
                        VK Тэг
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-neutral-500 uppercase">Разделитель актеров</label>
                  <select
                    value={mainRolesSeparator}
                    onChange={(e) => setMainRolesSeparator(e.target.value as any)}
                    className="w-full mt-1 bg-black/60 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                  >
                    <option value="\n">Каждый актер с новой строки (\n)</option>
                    <option value=", ">Через запятую (, )</option>
                    <option value=" | ">Через черту ( | )</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 3. Secondary Roles Block */}
            <div className="bg-neutral-950/60 border border-neutral-800/80 rounded-2xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-purple-400 uppercase tracking-wider">
                  <Users className="w-4 h-4" />
                  <span>3. Второстепенные роли</span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeSecondaryRoles}
                    onChange={(e) => setIncludeSecondaryRoles(e.target.checked)}
                    className="w-4 h-4 accent-purple-600 rounded cursor-pointer"
                  />
                  <span className="text-xs text-neutral-300 font-semibold">Включить блок</span>
                </label>
              </div>

              {includeSecondaryRoles && (
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-bold text-neutral-500 uppercase">Заголовок блока</label>
                    <input
                      type="text"
                      value={secondaryRolesHeader}
                      onChange={(e) => setSecondaryRolesHeader(e.target.value)}
                      className="w-full mt-1 bg-black/60 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-neutral-500 uppercase">Формат карточки актера</label>
                    <input
                      type="text"
                      value={secondaryRolesFormat}
                      onChange={(e) => setSecondaryRolesFormat(e.target.value)}
                      className="w-full mt-1 bg-black/60 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-purple-300 font-mono focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 4. Sound Engineer & Navigation Links */}
            <div className="bg-neutral-950/60 border border-neutral-800/80 rounded-2xl p-4 space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold text-purple-400 uppercase tracking-wider">
                <Music className="w-4 h-4" />
                <span>4. Работа со звуком и навигация</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-neutral-500 uppercase">Заголовок блока звукаря</label>
                  <input
                    type="text"
                    value={soundEngineerHeader}
                    onChange={(e) => setSoundEngineerHeader(e.target.value)}
                    className="w-full mt-1 bg-black/60 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-neutral-500 uppercase">Формат звукаря</label>
                  <select
                    value={soundEngineerFormat}
                    onChange={(e) => setSoundEngineerFormat(e.target.value)}
                    className="w-full mt-1 bg-black/60 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                  >
                    <option value="{seMention}">Упоминание @username</option>
                    <option value="[{seName}]({seTgLink})">Markdown ссылка [Name](t.me/...)</option>
                    <option value="{seName}">Просто имя/никнейм</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 border-t border-neutral-800/60 flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includePrevEpisodeLink}
                    onChange={(e) => setIncludePrevEpisodeLink(e.target.checked)}
                    className="w-4 h-4 accent-purple-600 rounded cursor-pointer"
                  />
                  <span className="text-xs text-neutral-300">Ссылка на предыдущую серию ({'{prevLinkTg}'})</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeProjectHashtag}
                    onChange={(e) => setIncludeProjectHashtag(e.target.checked)}
                    className="w-4 h-4 accent-purple-600 rounded cursor-pointer"
                  />
                  <span className="text-xs text-neutral-300">Хэштег проекта ({'#{projectSlug}'})</span>
                </label>
              </div>
            </div>

          </div>

          {/* RIGHT: Live Template Output & Apply Controls */}
          <div className="lg:col-span-5 bg-black/40 p-6 flex flex-col justify-between space-y-4">
            <div className="space-y-3 flex-1 flex flex-col">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Eye className="w-4 h-4 text-purple-400" />
                  Сгенерированный шаблон
                </span>
                <span className="text-[10px] text-neutral-500 font-mono">
                  {generatedTemplate.length} символов
                </span>
              </div>

              <textarea
                readOnly
                value={generatedTemplate}
                className="w-full flex-1 bg-black/70 border border-neutral-800 rounded-2xl p-4 text-xs text-purple-200 font-mono leading-relaxed focus:outline-none resize-none custom-scrollbar min-h-[360px]"
              />
            </div>

            <div className="pt-4 border-t border-neutral-800 space-y-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onApplyTemplate(generatedTemplate, false)}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  <span>Применить для серии</span>
                </button>

                <button
                  onClick={() => onApplyTemplate(generatedTemplate, true)}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Применить для проекта</span>
                </button>
              </div>

              <p className="text-[10px] text-neutral-500 text-center">
                Сохранение для всего проекта установит эти блоки по умолчанию для всех следующих серий.
              </p>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
