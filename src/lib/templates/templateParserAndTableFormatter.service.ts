import { Episode, Participant } from '../../types';

export const DEFAULT_LINKS_TEMPLATE = `➪ Аниме 365: {linkAnime365}
➪ Телеграм: {linkTg}
➪ Kodik: {linkKodik}
➪ VK: {linkVk}
➪ Shikimori: {linkShikimori}`;

export const formatDeadline = (dateStr?: string, includeTime: boolean = true) => {
  if (!dateStr) return 'не указан';
  const date = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T12:00:00');
  if (isNaN(date.getTime())) return 'не указан';
  const days = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  const day = days[date.getDay()];
  const dayOfMonth = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');

  if (includeTime && dateStr.includes('T')) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    if (date.getHours() !== 0 || date.getMinutes() !== 0) {
      return `${day} ${dayOfMonth}.${month} в ${hours}:${minutes}`;
    }
  }
  return `${day} ${dayOfMonth}.${month}`;
};

export const formatDeadlineRelative = (dateStr?: string): { text: string; isOverdue: boolean; hoursLeft: number } => {
  if (!dateStr) return { text: 'не указан', isOverdue: false, hoursLeft: 9999 };
  const date = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T12:00:00');
  if (isNaN(date.getTime())) return { text: 'не указан', isOverdue: false, hoursLeft: 9999 };

  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const hoursLeft = Math.round(diffMs / (1000 * 60 * 60));
  const isOverdue = diffMs < 0;

  if (isOverdue) {
    const overdueHours = Math.abs(hoursLeft);
    if (overdueHours < 24) {
      return { text: `Просрочено на ${overdueHours} ч`, isOverdue: true, hoursLeft };
    }
    const overdueDays = Math.floor(overdueHours / 24);
    return { text: `Просрочено на ${overdueDays} дн`, isOverdue: true, hoursLeft };
  }

  if (hoursLeft <= 1) {
    const minutesLeft = Math.max(1, Math.round(diffMs / (1000 * 60)));
    return { text: `Осталось ${minutesLeft} мин`, isOverdue: false, hoursLeft };
  }
  if (hoursLeft < 24) {
    return { text: `Осталось ${hoursLeft} ч`, isOverdue: false, hoursLeft };
  }
  const daysLeft = Math.floor(hoursLeft / 24);
  const remHours = hoursLeft % 24;
  return {
    text: remHours > 0 ? `Осталось ${daysLeft} д ${remHours} ч` : `Осталось ${daysLeft} д`,
    isOverdue: false,
    hoursLeft
  };
};

export const getFixesDeadlineDate = (deadlineStr?: string, fixesDeadlineStr?: string): Date | null => {
  if (fixesDeadlineStr) {
    const d = fixesDeadlineStr.includes('T') ? new Date(fixesDeadlineStr) : new Date(fixesDeadlineStr + 'T12:00:00');
    if (!isNaN(d.getTime())) return d;
  }
  if (deadlineStr) {
    const d = deadlineStr.includes('T') ? new Date(deadlineStr) : new Date(deadlineStr + 'T12:00:00');
    if (!isNaN(d.getTime())) {
      const fixesDate = new Date(d);
      fixesDate.setDate(fixesDate.getDate() + 1);
      return fixesDate;
    }
  }
  return null;
};

export const formatFullDeadline = (deadlineStr?: string, fixesDeadlineStr?: string): string => {
  if (!deadlineStr && !fixesDeadlineStr) return 'не указан';
  const mainStr = formatDeadline(deadlineStr);
  const fixesDate = getFixesDeadlineDate(deadlineStr, fixesDeadlineStr);
  const fixesStr = fixesDate ? formatDeadline(fixesDate.toISOString()) : 'не указан';

  if (mainStr === 'не указан') {
    return `с фиксами ${fixesStr}`;
  }
  return `${mainStr} (с фиксами ${fixesStr})`;
};

export const applyTemplate = (template: string, vars: Record<string, any>) => {
  if (!template) return '';
  let result = template;

  const listRegex = /\{(\w+):\[([\s\S]*?)\](?:,\s*([\s\S]*?))?\}/g;
  result = result.replace(listRegex, (_match, key, itemTemplate, separator) => {
    const list = vars[key];
    if (!Array.isArray(list)) return '';
    return list
      .map(item => {
        let itemResult = itemTemplate;
        if (item && typeof item === 'object') {
          itemResult = itemResult.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k) => {
            return k in item ? String(item[k] ?? '') : m;
          });
        }
        return itemResult;
      })
      .join(separator !== undefined ? separator : '');
  });

  result = result.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (key in vars && (typeof vars[key] === 'string' || typeof vars[key] === 'number')) {
      return String(vars[key] ?? '');
    }
    return match;
  });

  return result;
};

export const getTemplateVariables = (episode: Episode, participants: Participant[], yandexUrl: string = '') => {
  const assignments = episode.assignments || [];

  const mainRolesData = assignments
    .filter(a => a.isMain)
    .map(a => {
      const dubber = participants.find(p => p.id === (a.substituteId || a.dubberId));
      if (!dubber) return null;
      const tgLink = dubber.tgChannel || `https://t.me/${(dubber.telegram || dubber.nickname).replace('@', '')}`;
      const vk = dubber.vkLink ? `@${dubber.vkLink.split('/').pop()}` : dubber.telegram || dubber.nickname;
      return {
        character: a.characterName,
        nickname: dubber.nickname,
        tg: dubber.telegram || dubber.nickname,
        tgLink,
        vk
      };
    })
    .filter(Boolean);

  const secondaryDubberIds = new Set(
    assignments
      .filter(a => !a.isMain)
      .map(a => a.substituteId || a.dubberId)
      .filter(Boolean)
  );
  const secondaryDubbersData = participants
    .filter(p => secondaryDubberIds.has(p.id))
    .map(d => {
      const tgLink = d.tgChannel || `https://t.me/${(d.telegram || d.nickname).replace('@', '')}`;
      const vk = d.vkLink ? `@${d.vkLink.split('/').pop()}` : d.telegram || d.nickname;
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
    const vk = d.vkLink ? `@${d.vkLink.split('/').pop()}` : d.telegram || d.nickname;
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
  const seMention = se
    ? se.telegram && se.telegram.startsWith('@')
      ? se.telegram
      : `@${se.telegram || se.nickname}`
    : '@Tenmag';
  const seName = se ? se.nickname : 'Tenmag';
  const seTg = se ? (se.telegram?.startsWith('@') ? se.telegram : `@${se.telegram || se.nickname}`) : '@Tenmag';
  const seVk = se ? (se.vkLink ? `@${se.vkLink.split('/').pop()}` : se.nickname) : 'Tenmag';

  const emoji = episode.project?.emoji || '📢';
  const releaseTypeLabel =
    episode.project?.releaseType === 'VOICEOVER'
      ? 'Закадр'
      : episode.project?.releaseType === 'RECAST'
      ? 'Рекаст'
      : 'Редаб';

  const title = episode.project?.title || 'ТАЙТЛ';
  const progress = `${episodeNumber}/${totalEpisodes}`;

  const prevEp = episode.project?.episodes?.find(e => e.number === episode.number - 1);
  const prevEpisodeNumber = prevEp ? prevEp.number.toString() : '';
  const prevLinkTg = prevEp?.tgPostLink || '';
  const prevLinkVk = prevEp?.vkPostLink || '';

  let links: Record<string, any> = {};
  if (episode.project?.links) {
    try {
      links = JSON.parse(episode.project.links);
    } catch {
      links = {};
    }
  }

  const seTgLink = se
    ? se.tgChannel || `https://t.me/${(se.telegram || se.nickname).replace('@', '')}`
    : 'https://t.me/Tenmag';
  const catalogLabel = 'Каталог всех релизов';
  const linkCatalog = links.catalog || links.tg || 'https://t.me';

  let articleTableRows = '';
  if (mainRolesData.length > 0) {
    articleTableRows += mainRolesData.map(r => `| ❇ ${r?.character} | [${r?.nickname}](${r?.tgLink}) |`).join('\n') + '\n';
  } else if (uniqueDubbersData.length > 0) {
    articleTableRows += uniqueDubbersData.map(d => `| 🎙 Даббер | [${d.nickname}](${d.tgLink}) |`).join('\n') + '\n';
  }
  if (secondaryDubbersData.length > 0) {
    const secStr = secondaryDubbersData.map(d => `[${d.nickname}](${d.tgLink})`).join(', ');
    articleTableRows += `| ${secStr} | |\n`;
  }
  articleTableRows += `| **Работа со звуком:** | [${seName}](${seTgLink}) |`;

  const articleTable = `| **Роли озвучивали** | |\n| :--- | :--- |\n${articleTableRows}`;

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
    seTgLink,
    catalogLabel,
    linkCatalog,
    articleTable,
    articleTableMarkdown: articleTable,
    projectSlug,
    projectSlugRaw: projectSlug,
    allTgMentions: uniqueDubbersData.map(d => (d.tg.startsWith('@') ? d.tg : `@${d.tg}`)).join(', '),
    allVkMentions: uniqueDubbersData.map(d => (d.vk.startsWith('@') ? d.vk : `@${d.vk}`)).join(', '),
    allTgLinks: uniqueDubbersData.map(d => d.tgLink).join('\n'),
    mainNicknames: mainRolesData.map(r => r?.nickname).join(', '),
    mainCharacters: mainRolesData.map(r => r?.character).join(', '),
    secondaryNicknames: secondaryDubbersData.map(d => d.nickname).join(', '),
    secondaryDubberLinks: secondaryDubbersData.map(d => `[${d.nickname}](${d.tgLink})`).join(', '),
    mainRolesText: mainRolesData.map(r => `${r?.character} - ${r?.nickname}`).join('\n'),
    secondaryDubbersText: secondaryDubbersData.map(d => d.nickname).join(', '),
    mainRolesInfo: mainRolesData.map(r => `${r?.character} - ${r?.vk} (${r?.nickname})`).join(', '),
    secondaryDubbersInfo: secondaryDubbersData.map(d => `${d.vk} (${d.nickname})`).join(', '),
    dubberLinks: uniqueDubbersData.map(d => `[${d.nickname}](${d.tgLink})`).join(', '),
    dubberInfo: uniqueDubbersData.map(d => `${d.vk} (${d.nickname})`).join(', '),
    mainRoles: mainRolesData,
    secondaryDubbers: secondaryDubbersData,
    dubbers: uniqueDubbersData
  };

  Object.keys(links).forEach(key => {
    if (key !== 'quickUploadLinks') {
      const varName = `link${key.charAt(0).toUpperCase() + key.slice(1)}`;
      vars[varName] = links[key] || '';
    }
  });

  const linksTpl = episode.linksTemplate || episode.project?.linksTemplate || DEFAULT_LINKS_TEMPLATE;
  vars.platformLinks = applyTemplate(linksTpl, vars);

  const dubberLineCounts: Record<string, number> = {};
  assignments.forEach(as => {
    const assignedId = as.substituteId || as.dubberId;
    if (assignedId && typeof as.lineCount === 'number') {
      dubberLineCounts[assignedId] = (dubberLineCounts[assignedId] || 0) + as.lineCount;
    }
  });

  const assignedDubbers = participants.filter(p => dubbers.some(d => d.id === p.id));

  vars.dubberMentions =
    assignedDubbers
      .map(d => {
        const mention = d.telegram && d.telegram.startsWith('@') ? d.telegram : `@${d.telegram || d.nickname}`;
        const count = dubberLineCounts[d.id] || 0;
        return `${d.nickname} (${mention}) — ${count} реп.`;
      })
      .join('\n') || '• Даберы не назначены';

  const mainDeadlineStr = formatDeadline(episode.deadline);
  const fixesDeadlineDate = getFixesDeadlineDate(episode.deadline, episode.fixesDeadline);
  const fixesDeadlineStr = fixesDeadlineDate ? formatDeadline(fixesDeadlineDate.toISOString()) : 'не указан';
  const fullDeadlineStr = formatFullDeadline(episode.deadline, episode.fixesDeadline);

  vars.deadline = fullDeadlineStr;
  vars.mainDeadline = mainDeadlineStr;
  vars.fixesDeadline = fixesDeadlineStr;
  vars.yandexUrl = yandexUrl;
  vars.yandexSection = yandexUrl ? `\n📁 Исходники серии: ${yandexUrl}\n` : '';

  const dubberFixes: Record<string, { dubber: Participant; comments: any[] }> = {};
  assignments.forEach(as => {
    const assignedId = as.substituteId || as.dubberId;
    if (!assignedId || as.status !== 'FIXES_NEEDED') return;
    const dubber = participants.find(p => p.id === assignedId);
    if (!dubber) return;
    let comments = [];
    try {
      comments = JSON.parse(as.comments || '[]');
    } catch (e) {}
    if (!Array.isArray(comments) || comments.length === 0) return;
    if (!dubberFixes[assignedId]) dubberFixes[assignedId] = { dubber, comments: [] };
    const getCommentKey = (c: any) => {
      if (c.subId !== undefined && c.subId !== null) {
        return `sub_${c.subId}_${(c.text || '').trim()}`;
      }
      return `${(c.text || '').trim()}_${Math.round(c.timestamp || 0)}`;
    };
    comments.forEach(c => {
      const key = getCommentKey(c);
      if (
        !dubberFixes[assignedId].comments.some(existing => existing.id === c.id || getCommentKey(existing) === key)
      ) {
        dubberFixes[assignedId].comments.push(c);
      }
    });
  });

  vars.dubberFixesSections =
    Object.keys(dubberFixes)
      .map(id => {
        const { dubber, comments } = dubberFixes[id];
        const mention =
          dubber.telegram && dubber.telegram.startsWith('@') ? dubber.telegram : `@${dubber.telegram || dubber.nickname}`;
        const sortedComments = [...comments].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        const fixesText = sortedComments
          .map(c => {
            const sec = typeof c.timestamp === 'number' ? c.timestamp : 0;
            const hours = Math.floor(sec / 3600);
            const mins = Math.floor((sec % 3600) / 60);
            const secs = Math.floor(sec % 60);
            const timeStr =
              hours > 0
                ? `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
                : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            return `  • [${timeStr}] ${c.text}`;
          })
          .join('\n');
        return `${dubber.nickname} (${mention}):\n${fixesText}`;
      })
      .join('\n\n') || '';

  vars.roadsMentions =
    assignedDubbers
      .filter(p => {
        const pAssignments = assignments.filter(a => (a.substituteId || a.dubberId) === p.id);
        const hasPending = pAssignments.some(a => a.status === 'PENDING');
        const hasUpload = (episode.uploads || []).some(u => u.type === 'DUBBER_FILE' && u.uploadedById === p.id);
        return hasPending && !hasUpload;
      })
      .map(p => {
        const mention = p.telegram && p.telegram.startsWith('@') ? p.telegram : `@${p.telegram || p.nickname}`;
        return `• ${mention}`;
      })
      .join('\n') || '• Все сдано!';

  vars.fixesMentions =
    assignedDubbers
      .filter(p => assignments.some(a => (a.substituteId || a.dubberId) === p.id && a.status === 'FIXES_NEEDED'))
      .map(p => {
        const mention = p.telegram && p.telegram.startsWith('@') ? p.telegram : `@${p.telegram || p.nickname}`;
        return `• ${mention}`;
      })
      .join('\n') || '• Фиксов нет!';

  return vars;
};

export const isTableSeparatorLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes('-')) return false;
  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim())
    .filter(Boolean);
  if (cells.length === 0) return false;
  return cells.every(c => /^:?-+:?$/.test(c));
};

export const formatInlineMarkdown = (text: string): string => {
  if (!text) return '';
  let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  html = html.replace(
    /`([^`]+)`/g,
    '<code style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 4px; font-family: monospace;">$1</code>'
  );
  html = html.replace(/\*\*([^*]+?)\*\*/g, '<b>$1</b>');
  html = html.replace(/__([^_]+?)__/g, '<i>$1</i>');
  html = html.replace(/(^|\s)_([^_]+?)_(\s|$|[.,!?;:])/g, '$1<i>$2</i>$3');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
    const safeUrl = url.replace(/"/g, '&quot;');
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color: #64b5f6; font-style: italic; text-decoration: none;">${linkText}</a>`;
  });

  return html;
};

export const convertToHTMLForTelegram = (text: string): string => {
  if (!text) return '';

  const lines = text.split('\n');
  const resultBlocks: string[] = [];
  let inTable = false;
  let tableRows: string[] = [];

  const flushTable = () => {
    if (tableRows.length === 0) return;

    let tableHtml = `<table style="width: 100%; max-width: 480px; margin: 12px auto; border-collapse: collapse; border: 1px solid #233d5d; border-radius: 8px; overflow: hidden; background-color: #141f2d; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13.5px; color: #ffffff; text-align: left;">\n<tbody>\n`;
    const contentRows = tableRows.filter(r => !isTableSeparatorLine(r));

    contentRows.forEach((row, idx) => {
      const cells = row
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(c => c.trim());
      const isHeader = idx === 0 && (cells.length === 1 || !cells[1] || cells[0].includes('Роли озвучивали'));

      if (isHeader) {
        tableHtml += `  <tr style="background-color: #1e334d;">\n`;
        tableHtml += `    <th colspan="2" style="padding: 10px 14px; text-align: center; font-weight: bold; color: #ffffff; border: 1px solid #233d5d; font-size: 14.5px;">${formatInlineMarkdown(cells[0])}</th>\n`;
        tableHtml += `  </tr>\n`;
      } else if (cells.length >= 2 && !cells[1]) {
        tableHtml += `  <tr>\n`;
        tableHtml += `    <td colspan="2" style="padding: 8px 14px; border: 1px solid #233d5d; color: #94a3b8; font-style: italic; text-align: left; vertical-align: middle;">${formatInlineMarkdown(cells[0])}</td>\n`;
        tableHtml += `  </tr>\n`;
      } else if (cells.length >= 2) {
        tableHtml += `  <tr>\n`;
        tableHtml += `    <td style="padding: 8px 14px; border: 1px solid #233d5d; color: #f0f6fc; vertical-align: middle; width: 62%;">${formatInlineMarkdown(cells[0])}</td>\n`;
        tableHtml += `    <td style="padding: 8px 14px; border: 1px solid #233d5d; color: #64b5f6; font-style: italic; vertical-align: middle; width: 38%;">${formatInlineMarkdown(cells[1])}</td>\n`;
        tableHtml += `  </tr>\n`;
      } else if (cells.length === 1) {
        tableHtml += `  <tr>\n`;
        tableHtml += `    <td colspan="2" style="padding: 8px 14px; border: 1px solid #233d5d; color: #f0f6fc; vertical-align: middle;">${formatInlineMarkdown(cells[0])}</td>\n`;
        tableHtml += `  </tr>\n`;
      }
    });

    tableHtml += `</tbody>\n</table>`;
    resultBlocks.push(tableHtml);
    tableRows = [];
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTableLine = /^\s*\|.*\|\s*$/.test(line);

    if (isTableLine) {
      inTable = true;
      tableRows.push(line);
    } else {
      if (inTable) {
        flushTable();
      }

      const trimmed = line.trim();
      if (!trimmed) {
        resultBlocks.push('<div style="height: 6px;"></div>');
      } else if (trimmed.includes('───') || trimmed.includes('🎀')) {
        resultBlocks.push(
          `<div style="text-align: center; color: #f472b6; font-weight: bold; margin: 8px 0; font-size: 14px; letter-spacing: 1px;">${formatInlineMarkdown(trimmed)}</div>`
        );
      } else if (trimmed.startsWith('˗ˏˋ') || (trimmed.startsWith('**') && trimmed.endsWith('**') && trimmed.length < 60)) {
        resultBlocks.push(
          `<div style="text-align: center; font-weight: bold; font-size: 16px; color: #ffffff; margin: 4px 0;">${formatInlineMarkdown(trimmed)}</div>`
        );
      } else if (trimmed.includes('🤍') || (trimmed.startsWith('👾') && trimmed.endsWith('👾'))) {
        resultBlocks.push(
          `<div style="text-align: center; font-weight: bold; font-size: 14px; color: #ffffff; margin: 4px 0;">${formatInlineMarkdown(trimmed)}</div>`
        );
      } else if (trimmed.includes('🌸') || trimmed.includes('➡️') || trimmed.includes('Каталог')) {
        resultBlocks.push(
          `<div style="text-align: center; font-size: 13.5px; color: #e2e8f0; margin: 8px 0;">${formatInlineMarkdown(trimmed)}</div>`
        );
      } else {
        resultBlocks.push(`<div style="margin: 3px 0;">${formatInlineMarkdown(trimmed)}</div>`);
      }
    }
  }

  if (inTable) {
    flushTable();
  }

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0e1621; color: #ffffff; padding: 16px 20px; border-radius: 12px; max-width: 520px; margin: 0 auto; line-height: 1.5;">${resultBlocks.join('\n')}</div>`;
};

export const markdownTableToUnicodeBox = (text: string): string => {
  if (!text) return '';

  const getVisualLength = (str: string): number => {
    const clean = str
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1');

    let len = 0;
    for (const char of clean) {
      const code = char.codePointAt(0) || 0;
      if (
        (code >= 0x1f300 && code <= 0x1f9ff) ||
        (code >= 0x2600 && code <= 0x27bf) ||
        char === '❇' ||
        char === '🎀' ||
        char === '🤍' ||
        char === '🌸' ||
        char === '🎙' ||
        char === '👾'
      ) {
        len += 2;
      } else {
        len += 1;
      }
    }
    return len;
  };

  const stripFormatting = (str: string): string => {
    return str
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
  };

  const padRight = (str: string, targetWidth: number): string => {
    const currentWidth = getVisualLength(str);
    if (!targetWidth || currentWidth >= targetWidth) return str;
    const diff = Math.max(0, targetWidth - currentWidth);
    return str + ' '.repeat(diff);
  };

  const centerText = (str: string, targetWidth: number): string => {
    const currentWidth = getVisualLength(str);
    if (!targetWidth || currentWidth >= targetWidth) return str;
    const totalSpaces = Math.max(0, targetWidth - currentWidth);
    const leftSpaces = Math.floor(totalSpaces / 2);
    const rightSpaces = Math.max(0, totalSpaces - leftSpaces);
    return ' '.repeat(leftSpaces) + str + ' '.repeat(rightSpaces);
  };

  const lines = text.split('\n');
  const outputLines: string[] = [];
  let tableRows: string[] = [];

  const flushUnicodeTable = () => {
    if (tableRows.length === 0) return;

    const contentRows = tableRows.filter(r => !isTableSeparatorLine(r));
    if (contentRows.length === 0) {
      tableRows = [];
      return;
    }

    const parsedRows: { isHeader: boolean; isFullWidth: boolean; col1: string; col2: string }[] = [];
    let col1Max = 22;
    let col2Max = 12;

    contentRows.forEach((row, idx) => {
      const cells = row
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(c => stripFormatting(c.trim()));
      const isHeader = idx === 0 && (cells.length === 1 || !cells[1] || cells[0].includes('Роли озвучивали'));
      const isFullWidth = !isHeader && cells.length >= 2 && !cells[1];

      const col1 = cells[0] || '';
      const col2 = cells[1] || '';

      if (!isHeader && !isFullWidth) {
        col1Max = Math.max(col1Max, getVisualLength(col1));
        col2Max = Math.max(col2Max, getVisualLength(col2));
      }

      parsedRows.push({ isHeader, isFullWidth, col1, col2 });
    });

    const col1Width = Math.max(10, col1Max + 1);
    const col2Width = Math.max(10, col2Max + 1);
    const totalInnerWidth = col1Width + col2Width + 5;

    const boxLines: string[] = [];

    parsedRows.forEach((row, idx) => {
      if (row.isHeader) {
        boxLines.push(`┌${'─'.repeat(totalInnerWidth)}┐`);
        boxLines.push(`│${centerText(row.col1, totalInnerWidth)}│`);
      } else if (idx === 0) {
        boxLines.push(`┌${'─'.repeat(col1Width + 2)}┬${'─'.repeat(col2Width + 2)}┐`);
      }

      if (idx === 0 && row.isHeader) {
        boxLines.push(`├${'─'.repeat(col1Width + 2)}┬${'─'.repeat(col2Width + 2)}┤`);
      } else if (idx > 0) {
        const prev = parsedRows[idx - 1];
        if (prev.isFullWidth && !row.isFullWidth) {
          boxLines.push(`├${'─'.repeat(col1Width + 2)}┬${'─'.repeat(col2Width + 2)}┤`);
        } else if (!prev.isFullWidth && row.isFullWidth) {
          boxLines.push(`├${'─'.repeat(col1Width + 2)}┴${'─'.repeat(col2Width + 2)}┤`);
        } else if (!prev.isFullWidth && !row.isFullWidth && !prev.isHeader) {
          boxLines.push(`├${'─'.repeat(col1Width + 2)}┼${'─'.repeat(col2Width + 2)}┤`);
        }
      }

      if (row.isFullWidth) {
        boxLines.push(`│ ${padRight(row.col1, totalInnerWidth - 2)} │`);
      } else if (!row.isHeader) {
        boxLines.push(`│ ${padRight(row.col1, col1Width)} │ ${padRight(row.col2, col2Width)} │`);
      }
    });

    const last = parsedRows[parsedRows.length - 1];
    if (last && last.isFullWidth) {
      boxLines.push(`└${'─'.repeat(totalInnerWidth)}┘`);
    } else {
      boxLines.push(`└${'─'.repeat(col1Width + 2)}┴${'─'.repeat(col2Width + 2)}┘`);
    }

    outputLines.push(boxLines.join('\n'));
    tableRows = [];
  };

  for (const line of lines) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      tableRows.push(line);
    } else {
      if (tableRows.length > 0) {
        flushUnicodeTable();
      }
      outputLines.push(line);
    }
  }

  if (tableRows.length > 0) {
    flushUnicodeTable();
  }

  return outputLines.join('\n');
};
