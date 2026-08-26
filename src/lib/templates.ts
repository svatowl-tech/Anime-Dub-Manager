import { Episode, Participant } from '../types';

export const formatDeadline = (dateStr?: string) => {
  if (!dateStr) return 'не указан';
  const date = new Date(dateStr);
  const days = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  const day = days[date.getDay()];
  const dayOfMonth = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${day} ${dayOfMonth}.${month}`;
};

export const generateStartEpisodeMessage = (episode: Episode, participants: Participant[], yandexUrl?: string) => {
  const vars = getTemplateVariables(episode, participants, yandexUrl);
  const tpl = episode.startMessageTemplate || episode.project?.startMessageTemplate || DEFAULT_START_EPISODE_TEMPLATE;
  let result = applyTemplate(tpl, vars);
  
  // Ensure yandexUrl is included if provided and not already in the result
  if (yandexUrl && !result.includes(yandexUrl)) {
    result += `\n\n📁 Исходники серии: ${yandexUrl}`;
  }
  
  return result;
};

export const generateSoundEngineerMessage = (episode: Episode, yandexUrl: string, participants: Participant[] = []) => {
  const vars = getTemplateVariables(episode, participants, yandexUrl);
  const tpl = episode.soundEngineerMessageTemplate || episode.project?.soundEngineerMessageTemplate || DEFAULT_SOUND_ENGINEER_TEMPLATE;
  let result = applyTemplate(tpl, vars);
  
  if (yandexUrl && !result.includes(yandexUrl)) {
    result += `\n\n📁 Файлы доступны по ссылке: ${yandexUrl}`;
  }
  
  return result;
};

export const generateFixesIssuedMessage = (episode: Episode, participants: Participant[]) => {
  const vars = getTemplateVariables(episode, participants);
  if (!vars.dubberFixesSections) return null; // No fixes
  const tpl = episode.fixesMessageTemplate || episode.project?.fixesMessageTemplate || DEFAULT_FIXES_ISSUED_TEMPLATE;
  return applyTemplate(tpl, vars);
};

export const generateStatusMessage = (episode: Episode, participants: Participant[]) => {
  const vars = getTemplateVariables(episode, participants);
  const tpl = episode.statusMessageTemplate || episode.project?.statusMessageTemplate || DEFAULT_STATUS_TEMPLATE;
  return applyTemplate(tpl, vars);
};

export const DEFAULT_TG_TEMPLATE_RECAST = `{emoji} {title} [{releaseTypeLabel}]

👾 {progress} 👾

━━━━━━ ◦ ❖ ◦ ━━━━━━
Роли озвучили:
{mainRoles:[➤ {character} - [{nickname}]({tgLink})\n]}
———————————————-
Второстепенные герои: {secondaryDubbers:[[{nickname}]({tgLink})], }

Тайминг и работа со звуком: 
{seMention}
━━━━━━ ◦ ❖ ◦ ━━━━━━

#{projectSlug}`;

export const DEFAULT_TG_TEMPLATE_VOICEOVER = `{emoji} {title} [{releaseTypeLabel}]
👾 {progress} 👾
 
━━━━━━ ◦ ❖ ◦ ━━━━━━
Роли озвучили:
 
{dubbers:[[{nickname}]({tgLink})], }
 
Тайминг и работа со звуком: 
{seMention}
━━━━━━ ◦ ❖ ◦ ━━━━━━
#{projectSlug}`;

export const DEFAULT_VK_TEMPLATE_RECAST = `{emoji} {title} [{releaseTypeLabel}]
👾 {progress} 👾
 
| Роли озвучили: {mainRoles:[{character} - {vk} ({nickname})], }
| Второстепенные герои: {secondaryDubbers:[{vk} ({nickname})], }
 
| Тайминг и работа со звуком: {seName}
 
➪ Аниме 365: {linkAnime365}
➪ Телеграм: {linkTg}
➪ Kodik: {linkKodik}`;

export const DEFAULT_VK_TEMPLATE_VOICEOVER = `{emoji} {title} [{releaseTypeLabel}]
👾 {progress} 👾
 
| Роли озвучили: {dubbers:[{vk} ({nickname})], }
 
| Тайминг и работа со звуком: {seName}
 
➪ Аниме 365: {linkAnime365}
➪ Телеграм: {linkTg}
➪ Kodik: {linkKodik}`;

export const DEFAULT_LINKS_TEMPLATE = `➪ Аниме 365: {linkAnime365}
➪ Телеграм: {linkTg}
➪ Kodik: {linkKodik}
➪ VK: {linkVk}
➪ Shikimori: {linkShikimori}`;

export const DEFAULT_FINAL_TG_TEMPLATE = `{emoji} СЕРИЯ ВЫЛОЖЕНА: {title}
👾 {episodeNumber}/{totalEpisodes} 👾
━━━━━━ ◦ ❖ ◦ ━━━━━━
Ребята, всем спасибо за работу! Серия доступна по ссылкам ниже:

{platformLinks}
━━━━━━ ◦ ❖ ◦ ━━━━━━
#{projectSlug} #готово`;

export const DEFAULT_START_EPISODE_TEMPLATE = `{emoji} {title}
👾Серия: #{episodeNumber}
📅 ДЕДЛАЙН: {deadline}
━━━━━━ ◦ ❖ ◦ ━━━━━━
{yandexSection}
Если вы по каким то причинам не успеваете в дедлайн и знаете об этом, напишите об этом сразу, чтобы я мог найти вам замену или распределить сабы.

В серии участвуют:
{dubberMentions}`;

export const DEFAULT_SOUND_ENGINEER_TEMPLATE = `{emoji} Экспорт для звукорежиссера завершен
📌 {title} — Серия: #{episodeNumber}
━━━━━━ ◦ ❖ ◦ ━━━━━━
📁 Файлы доступны по ссылке:
{yandexUrl}`;

export const DEFAULT_FIXES_ISSUED_TEMPLATE = `{emoji} ВЫПИСАНЫ ФИКСЫ: {title}
👾 Серия: {episodeNumber}
📅 ДЕДЛАЙН ФИКСОВ: {deadline}
━━━━━━ ◦ ❖ ◦ ━━━━━━
Ребята, ознакомьтесь с правками и исправьте их до дедлайна! 🎙

{dubberFixesSections}

━━━━━━ ◦ ❖ ◦ ━━━━━━

#{projectSlug}_fix
#fix`;

export const DEFAULT_STATUS_TEMPLATE = `{emoji} {title}
👾 Серия: {episodeNumber}
📅 ДЕДЛАЙН: {deadline}
━━━━━━ ◦ ❖ ◦ ━━━━━━

🎙 ЖДЕМ ДОРОЖКИ:
{roadsMentions}

✏️ ЖДЕМ ИСПРАВЛЕНИЕ ФИКСОВ:
{fixesMentions}
━━━━━━ ◦ ❖ ◦ ━━━━━━`;

export const getTemplateVariables = (episode: Episode, participants: Participant[], yandexUrl: string = '') => {
  const assignments = episode.assignments || [];
  
  const mainRolesData = assignments.filter(a => a.isMain).map(a => {
    const dubber = participants.find(p => p.id === (a.substituteId || a.dubberId));
    if (!dubber) return null;
    const tgLink = dubber.tgChannel || `https://t.me/${(dubber.telegram || dubber.nickname).replace('@', '')}`;
    const vk = dubber.vkLink ? `@${dubber.vkLink.split('/').pop()}` : (dubber.telegram || dubber.nickname);
    return {
      character: a.characterName,
      nickname: dubber.nickname,
      tg: dubber.telegram || dubber.nickname,
      tgLink,
      vk
    };
  }).filter(Boolean);

  const secondaryDubberIds = new Set(assignments.filter(a => !a.isMain).map(a => a.substituteId || a.dubberId).filter(Boolean));
  const secondaryDubbersData = participants.filter(p => secondaryDubberIds.has(p.id)).map(d => {
    const tgLink = d.tgChannel || `https://t.me/${(d.telegram || d.nickname).replace('@', '')}`;
    const vk = d.vkLink ? `@${d.vkLink.split('/').pop()}` : (d.telegram || d.nickname);
    return {
      nickname: d.nickname,
      tg: d.telegram || d.nickname,
      tgLink,
      vk
    };
  });

  const dubbers = Array.from(new Set(assignments.map(a => a.substituteId || a.dubberId).filter(Boolean)))
    .map(id => participants.find(p => p.id === id))
    .filter(Boolean) as Participant[];
  
  const uniqueDubbersData = dubbers.map(d => {
    const tgLink = d.tgChannel || `https://t.me/${(d.telegram || d.nickname).replace('@', '')}`;
    const vk = d.vkLink ? `@${d.vkLink.split('/').pop()}` : (d.telegram || d.nickname);
    return {
      nickname: d.nickname,
      tg: d.telegram || d.nickname,
      tgLink,
      vk
    };
  });

  const projectSlug = (episode.project?.title || 'project')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-zа-яё0-9_]/g, '');
  const totalEpisodes = (episode.project?.totalEpisodes || 12).toString();
  const episodeNumber = episode.number.toString();
  const nextEpisodeNumber = (episode.number + 1).toString();

  const seId = episode.project?.soundEngineerId;
  const se = seId ? participants.find(p => p.id === seId) : null;
  const seMention = se ? ((se.telegram && se.telegram.startsWith('@')) ? se.telegram : `@${se.telegram || se.nickname}`) : '@Tenmag';
  const seName = se ? se.nickname : 'Tenmag';
  const seTg = se ? (se.telegram?.startsWith('@') ? se.telegram : `@${se.telegram || se.nickname}`) : '@Tenmag';
  const seVk = se ? (se.vkLink ? `@${se.vkLink.split('/').pop()}` : se.nickname) : 'Tenmag';

  const emoji = episode.project?.emoji || '📢';
  const releaseTypeLabel = episode.project?.releaseType === 'VOICEOVER' ? 'Закадр' : episode.project?.releaseType === 'RECAST' ? 'Рекаст' : 'Редаб';
  
  const title = episode.project?.title || 'ТАЙТЛ';
  const progress = `${episodeNumber}/${totalEpisodes}`;

  // Find previous episode
  const prevEp = episode.project?.episodes?.find(e => e.number === episode.number - 1);
  const prevEpisodeNumber = prevEp ? prevEp.number.toString() : '';
  const prevLinkTg = prevEp?.tgPostLink || '';
  const prevLinkVk = prevEp?.vkPostLink || '';

  const links = episode.project?.links ? JSON.parse(episode.project.links) : {};

  const vars: Record<string, any> = {
    emoji,
    title,
    projectTitle: title,
    releaseTypeLabel,
    projectReleaseType: releaseTypeLabel,
    progress,
    episodeNumber,
    nextEpisodeNumber,
    totalEpisodes,
    prevEpisodeNumber,
    prevLinkTg,
    prevLinkVk,
    seMention,
    seName,
    seNickname: seName,
    seTg,
    seVk,
    projectSlug,
    projectSlugRaw: projectSlug,
    allTgMentions: uniqueDubbersData.map(d => (d.tg.startsWith('@') ? d.tg : `@${d.tg}`)).join(', '),
    allVkMentions: uniqueDubbersData.map(d => (d.vk.startsWith('@') ? d.vk : `@${d.vk}`)).join(', '),
    allTgLinks: uniqueDubbersData.map(d => d.tgLink).join('\n'),
    mainNicknames: mainRolesData.map(r => r?.nickname).join(', '),
    mainCharacters: mainRolesData.map(r => r?.character).join(', '),
    secondaryNicknames: secondaryDubbersData.map(d => d.nickname).join(', '),
    // Add backward compatibility strings (cleaned)
    mainRolesText: mainRolesData.map(r => `${r?.character} - ${r?.nickname}`).join('\n'),
    secondaryDubbersText: secondaryDubbersData.map(d => d.nickname).join(', '),
    mainRolesInfo: mainRolesData.map(r => `${r?.character} - ${r?.vk} (${r?.nickname})`).join(', '),
    secondaryDubbersInfo: secondaryDubbersData.map(d => `${d.vk} (${d.nickname})`).join(', '),
    dubberLinks: uniqueDubbersData.map(d => `[${d.nickname}](${d.tgLink})`).join(', '),
    dubberInfo: uniqueDubbersData.map(d => `${d.vk} (${d.nickname})`).join(', '),
    // Add raw lists for new template engine
    mainRoles: mainRolesData,
    secondaryDubbers: secondaryDubbersData,
    dubbers: uniqueDubbersData,
  };

  // Dynamically add all links as {linkKey}
  Object.keys(links).forEach(key => {
    if (key !== 'quickUploadLinks') {
      const varName = `link${key.charAt(0).toUpperCase() + key.slice(1)}`;
      vars[varName] = links[key] || '';
    }
  });

  const linksTpl = episode.linksTemplate || episode.project?.linksTemplate || DEFAULT_LINKS_TEMPLATE;
  vars.platformLinks = applyTemplate(linksTpl, vars);

  // Status and notification specific vars
  const dubberLineCounts: Record<string, number> = {};
  assignments.forEach(as => {
    const assignedId = as.substituteId || as.dubberId;
    if (assignedId && typeof as.lineCount === 'number') {
      dubberLineCounts[assignedId] = (dubberLineCounts[assignedId] || 0) + as.lineCount;
    }
  });

  const assignedDubbers = participants.filter(p => dubbers.some(d => d.id === p.id));
  
  vars.dubberMentions = assignedDubbers.map(d => {
    const mention = (d.telegram && d.telegram.startsWith('@')) ? d.telegram : `@${d.telegram || d.nickname}`;
    const count = dubberLineCounts[d.id] || 0;
    return `${d.nickname} (${mention}) — ${count} реп.`;
  }).join('\n') || '• Даберы не назначены';

  vars.deadline = formatDeadline(episode.deadline);
  vars.yandexUrl = yandexUrl;
  vars.yandexSection = yandexUrl ? `\n📁 Исходники серии: ${yandexUrl}\n` : '';

  const dubberFixes: Record<string, { dubber: Participant, fixes: { character: string, comments: any[] }[] }> = {};
  assignments.forEach(as => {
    const assignedId = as.substituteId || as.dubberId;
    if (!assignedId || as.status !== 'FIXES_NEEDED') return;
    const dubber = participants.find(p => p.id === assignedId);
    if (!dubber) return;
    let comments = [];
    try { comments = JSON.parse(as.comments || '[]'); } catch (e) {}
    if (!Array.isArray(comments) || comments.length === 0) return;
    if (!dubberFixes[assignedId]) dubberFixes[assignedId] = { dubber, fixes: [] };
    dubberFixes[assignedId].fixes.push({ character: as.characterName, comments });
  });

  vars.dubberFixesSections = Object.keys(dubberFixes).map(id => {
    const { dubber, fixes } = dubberFixes[id];
    const mention = (dubber.telegram && dubber.telegram.startsWith('@')) ? dubber.telegram : `@${dubber.telegram || dubber.nickname}`;
    const fixesText = fixes.map(f => {
      const characterFixes = f.comments.map(c => {
        const time = typeof c.timestamp === 'number' ? new Date(c.timestamp * 1000).toISOString().substr(14, 5) : '??:??';
        return `  • [${time}] ${c.text}`;
      }).join('\n');
      return `🔹 ${f.character}:\n${characterFixes}`;
    }).join('\n\n');
    return `${dubber.nickname} (${mention}):\n${fixesText}`;
  }).join('\n\n') || '';

  vars.roadsMentions = assignedDubbers
    .filter(p => {
      const pAssignments = assignments.filter(a => (a.substituteId || a.dubberId) === p.id);
      const hasPending = pAssignments.some(a => a.status === 'PENDING');
      const hasUpload = (episode.uploads || []).some(u => u.type === 'DUBBER_FILE' && u.uploadedById === p.id);
      return hasPending && !hasUpload;
    })
    .map(p => {
      const mention = (p.telegram && p.telegram.startsWith('@')) ? p.telegram : `@${p.telegram || p.nickname}`;
      return `• ${mention}`;
    }).join('\n') || '• Все сдано!';

  vars.fixesMentions = assignedDubbers
    .filter(p => assignments.some(a => (a.substituteId || a.dubberId) === p.id && a.status === 'FIXES_NEEDED'))
    .map(p => {
      const mention = (p.telegram && p.telegram.startsWith('@')) ? p.telegram : `@${p.telegram || p.nickname}`;
      return `• ${mention}`;
    }).join('\n') || '• Фиксов нет!';

  return vars;
};

export const applyTemplate = (template: string, vars: Record<string, any>) => {
  let result = template;

  // 1. Handle lists: {listName:[itemTemplate], separator}
  const listRegex = /\{(\w+):\[([\s\S]*?)\](?:, ([\s\S]*?))?\}/g;
  result = result.replace(listRegex, (match, key, itemTemplate, separator) => {
    const list = vars[key];
    if (!Array.isArray(list)) return '';
    return list.map(item => {
      let itemResult = itemTemplate;
      Object.entries(item).forEach(([k, v]) => {
        itemResult = itemResult.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v || ''));
      });
      return itemResult;
    }).join(separator || '');
  });

  // 2. Handle flat variables
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === 'string' || typeof value === 'number') {
      result = result.replace(new RegExp(`{${key}}`, 'g'), String(value || ''));
    }
  }
  return result;
};

export const generateTGPostMessage = (episode: Episode, participants: Participant[]) => {
  const isRecastOrRedub = episode.project?.releaseType === 'RECAST' || episode.project?.releaseType === 'REDUB';
  const defaultTpl = isRecastOrRedub ? DEFAULT_TG_TEMPLATE_RECAST : DEFAULT_TG_TEMPLATE_VOICEOVER;
  const tplStr = episode.tgPostTemplate || episode.project?.tgPostTemplate || defaultTpl;
  const vars = getTemplateVariables(episode, participants);
  return applyTemplate(tplStr, vars);
};

export const generateVKPostMessage = (episode: Episode, participants: Participant[]) => {
  const isRecastOrRedub = episode.project?.releaseType === 'RECAST' || episode.project?.releaseType === 'REDUB';
  const defaultTpl = isRecastOrRedub ? DEFAULT_VK_TEMPLATE_RECAST : DEFAULT_VK_TEMPLATE_VOICEOVER;
  const tplStr = episode.vkPostTemplate || episode.project?.vkPostTemplate || defaultTpl;
  const vars = getTemplateVariables(episode, participants);
  return applyTemplate(tplStr, vars);
};

export const getTemplateString = (episode: Episode, type: 'TG' | 'VK' | 'FINAL_TG'): string => {
  const isRecastOrRedub = episode.project?.releaseType === 'RECAST' || episode.project?.releaseType === 'REDUB';
  if (type === 'TG') {
    const defaultTpl = isRecastOrRedub ? DEFAULT_TG_TEMPLATE_RECAST : DEFAULT_TG_TEMPLATE_VOICEOVER;
    return episode.tgPostTemplate || episode.project?.tgPostTemplate || defaultTpl;
  }
  if (type === 'VK') {
    const defaultTpl = isRecastOrRedub ? DEFAULT_VK_TEMPLATE_RECAST : DEFAULT_VK_TEMPLATE_VOICEOVER;
    return episode.vkPostTemplate || episode.project?.vkPostTemplate || defaultTpl;
  }
  if (type === 'FINAL_TG') {
    return episode.finalTgPostTemplate || episode.project?.finalTgPostTemplate || DEFAULT_FINAL_TG_TEMPLATE;
  }
  if (type === 'LINKS') {
    return episode.linksTemplate || episode.project?.linksTemplate || DEFAULT_LINKS_TEMPLATE;
  }
  return '';
};

export const generateFinalTGMessage = (episode: Episode, participants: Participant[]) => {
  const vars = getTemplateVariables(episode, participants);
  const defaultTpl = DEFAULT_FINAL_TG_TEMPLATE;
  return applyTemplate(defaultTpl, vars);
};

export const convertToHTMLForTelegram = (text: string): string => {
  if (!text) return '';
  
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    const safeUrl = url.replace(/"/g, '&quot;');
    return `<a href="${safeUrl}">${linkText}</a>`;
  });

  html = html.replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>');
  html = html.replace(/__([\s\S]+?)__/g, '<i>$1</i>');
  html = html.replace(/(?<!_)_([^_]+?)_(?!_)/g, '<i>$1</i>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  html = html
    .replace(/&lt;b&gt;/gi, '<b>')
    .replace(/&lt;\/b&gt;/gi, '</b>')
    .replace(/&lt;i&gt;/gi, '<i>')
    .replace(/&lt;\/i&gt;/gi, '</i>')
    .replace(/&lt;strong&gt;/gi, '<strong>')
    .replace(/&lt;\/strong&gt;/gi, '</strong>')
    .replace(/&lt;em&gt;/gi, '<em>')
    .replace(/&lt;\/em&gt;/gi, '</em>')
    .replace(/&lt;s&gt;/gi, '<s>')
    .replace(/&lt;\/s&gt;/gi, '</s>')
    .replace(/&lt;u&gt;/gi, '<u>')
    .replace(/&lt;\/u&gt;/gi, '</u>')
    .replace(/&lt;code&gt;/gi, '<code>')
    .replace(/&lt;\/code&gt;/gi, '</code>')
    .replace(/&lt;pre&gt;/gi, '<pre>')
    .replace(/&lt;\/pre&gt;/gi, '</pre>');

  html = html.replace(/\n/g, '<br/>');

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; white-space: pre-wrap;">${html}</div>`;
};

