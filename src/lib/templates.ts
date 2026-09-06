import { Episode, Participant } from '../types';
import { MissingLineDetection } from './qa/missingLinesDetector';

export const formatDeadline = (dateStr?: string) => {
  if (!dateStr) return 'не указан';
  const date = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T12:00:00');
  if (isNaN(date.getTime())) return 'не указан';
  const days = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  const day = days[date.getDay()];
  const dayOfMonth = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${day} ${dayOfMonth}.${month}`;
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
  return `${mainStr} с фиксами ${fixesStr}`;
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

export const generateSoundEngineerQAReport = (
  episode: Episode,
  detections: MissingLineDetection[],
  participants: Participant[]
): string => {
  const vars = getTemplateVariables(episode, participants);
  const seMention = vars.seMention || '@звукарь';
  const title = vars.title || 'Серия';
  const epNum = vars.episodeNumber || episode.number;

  const items = detections.length > 0 ? (detections.some(d => d.selected) ? detections.filter(d => d.selected) : detections) : [];

  const overlaps = items.filter(d => d.defectCategory === 'actor_overlap');
  const collisions = items.filter(d => d.defectCategory === 'actor_collision');
  const shortLines = items.filter(d => d.defectCategory === 'timing_too_short');
  const longLines = items.filter(d => d.defectCategory === 'timing_too_long');
  const unwanted = items.filter(d => d.defectCategory === 'unwanted_speech');
  const subErrors = items.filter(d => d.resolutionAction === 'reassign_character' || d.isSubtitleError || d.reassignedCharacterName);
  const regularMissing = items.filter(d => (d.defectCategory || 'missing_line') === 'missing_line' && !d.isSubtitleError && d.resolutionAction !== 'reassign_character');

  let report = `🎧 ${seMention}, отчет по таймингу, стыкам и косякам озвучки:\n`;
  report += `🎬 ${title} — ${epNum} серия\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 1. Наезды дублеров (хвосты фраз)
  if (overlaps.length > 0) {
    report += `⚡️ НАЕЗДЫ ХВОСТОВ ФРАЗ (КОЛЛИЗИИ ДУБЛЕРОВ):\n`;
    overlaps.forEach((ov, idx) => {
      report += `${idx + 1}. [${ov.startFormatted} - ${ov.endFormatted}] Наезд: ~${ov.overlapSec || 0.2}с\n`;
      report += `   • ${ov.dubberName} (${ov.characterName}): "${ov.text.replace(/^\[.*?\]:\s*"/, '').replace(/"$/, '')}"\n`;
      if (ov.secondDubberName) {
        report += `   • наехал на ${ov.secondDubberName} (${ov.secondCharacterName}): "${(ov.secondText || '').replace(/^\[.*?\]:\s*"/, '').replace(/"$/, '')}"\n`;
      }
      if (ov.isTimingTooLongMerged) {
        report += `   • ⚠️ Единый фикс: фраза длиннее саба на +${ov.timingDeltaPercent}% (вылет +${ov.overflowDurationSec || 0.4}с) и залезает на соседний саб\n`;
        report += `   👉 Рекомендация: поджать длительность фразы дабера и развести стык\n\n`;
      } else {
        report += `   👉 Рекомендация: развести стык / подрезать наплывающий хвост\n\n`;
      }
    });
  } else {
    report += `⚡️ НАЕЗДЫ ДУБЛЕРОВ: наездов хвостов фраз не обнаружено (чисто) ✅\n\n`;
  }

  // 2. Конфликты (одну реплику озвучили двое)
  if (collisions.length > 0) {
    report += `⚠️ КОНФЛИКТЫ (ОЗВУЧИЛИ ОДНУ РЕПЛИКУ ВДВОЁМ):\n`;
    collisions.forEach((col, idx) => {
      report += `${idx + 1}. [${col.startFormatted} - ${col.endFormatted}] Реплика: "${col.text}"\n`;
      report += `   • Записали оба: ${col.dubberName} и ${col.secondDubberName || 'второй даббер'}\n`;
      if (col.resolutionAction === 'keep_first') {
        report += `   👉 Решение: оставить ${col.dubberName}, заглушить ${col.secondDubberName}\n`;
      } else if (col.resolutionAction === 'keep_second') {
        report += `   👉 Решение: оставить ${col.secondDubberName}, заглушить ${col.dubberName}\n`;
      } else if (col.resolutionAction === 'fix_subs' && col.selectedCharacterForSub) {
        report += `   👉 Решение: по сабам это персонаж ${col.selectedCharacterForSub}\n`;
      } else {
        report += `   👉 Рекомендация: выбрать основную дорожку, вторую заглушить\n`;
      }
      report += `\n`;
    });
  }

  // 3. Рассинхрон тайминга: фраза короче саба (японский хвост)
  if (shortLines.length > 0) {
    report += `⏱ РАССИНХРОН: ФРАЗА КОРОЧЕ САБА (>30%, ВИСЯЩИЙ ЯПОНСКИЙ ХВОСТ):\n`;
    shortLines.forEach((sh, idx) => {
      const delta = sh.timingDeltaPercent ? Math.abs(sh.timingDeltaPercent) : '30+';
      const tail = sh.tailDurationSec ? `~${sh.tailDurationSec}с` : 'есть';
      report += `${idx + 1}. [${sh.startFormatted}] ${sh.dubberName} (${sh.characterName})\n`;
      report += `   • Реплика: "${sh.text}"\n`;
      report += `   • Короче на: -${delta}% | Хвост японского оригинала: ${tail}\n`;
      report += `   👉 Рекомендация: аккуратно приглушить/увести оригинальную дорожку под конец фразы\n\n`;
    });
  }

  // 4. Рассинхрон тайминга: фраза длиннее саба (>40%, вылет)
  if (longLines.length > 0) {
    report += `⏱ РАССИНХРОН: ФРАЗА ДЛИННЕЕ САБА (>40%, ВЫЛЕТ ЗА ТАЙМИНГ):\n`;
    longLines.forEach((lg, idx) => {
      const delta = lg.timingDeltaPercent ? `+${lg.timingDeltaPercent}%` : '+40%';
      const overflow = lg.overflowDurationSec ? `(вылет +${lg.overflowDurationSec}с)` : '';
      report += `${idx + 1}. [${lg.startFormatted} - ${lg.endFormatted}] ${lg.dubberName} (${lg.characterName})\n`;
      report += `   • Реплика: "${lg.text}"\n`;
      report += `   • Длиннее на: ${delta} ${overflow}\n`;
      report += `   👉 Рекомендация: поджать тайминг / легкая компрессия длительности\n\n`;
    });
  }

  // 5. Озвучено вне сабов (лишнее)
  if (unwanted.length > 0) {
    report += `🎙 ОЗВУЧЕНО ВНЕ САБОВ (ЛИШНИЕ ФРАЗЫ):\n`;
    unwanted.forEach((un, idx) => {
      const action = un.resolutionAction === 'silence' ? 'заменить тишиной' : 'оставить';
      report += `${idx + 1}. [${un.startFormatted} - ${un.endFormatted}] ${un.dubberName} (${un.durationSec}с)\n`;
      if (un.nearestContext) report += `   • Контекст: ${un.nearestContext}\n`;
      report += `   👉 Решение: ${action}\n\n`;
    });
  }

  // 6. Исправления субтитров (чужие фразы / ошибки разметки)
  if (subErrors.length > 0) {
    report += `🔄 ИСПРАВЛЕНИЯ СУБТИТРОВ (ОШИБКА АТРИБУЦИИ В САБАХ):\n`;
    subErrors.forEach((se, idx) => {
      const targetChar = se.reassignedCharacterName || se.selectedCharacterForSub || 'Персонаж';
      const targetDubber = se.reassignedDubberName || 'Даббер';
      report += `${idx + 1}. [${se.startFormatted}] Реплика: "${se.text}"\n`;
      report += `   • В исходных сабах: ${se.characterName} (${se.dubberName})\n`;
      report += `   • Переназначено на: ${targetChar} (${targetDubber})\n`;
      report += `   👉 Субтитры обновлены, задача на доозвучку направлена ${targetDubber}\n\n`;
    });
  }

  // 7. Технические артефакты записи (для исправления плагинами при сведении)
  const seArtifacts = items.filter(d => 
    (d.defectCategory === 'audio_artifact' || d.type === 'clipping' || d.type === 'mouse_click' || d.type === 'plosive' || d.type === 'swallowed_vowel') &&
    d.resolutionAction === 'note_sound_engineer'
  );

  if (seArtifacts.length > 0) {
    report += `🎛 ТЕХНИЧЕСКИЕ АРТЕФАКТЫ (ДЛЯ ОБРАБОТКИ ПЛАГИНАМИ / СВЕДЕНИЯ):\n`;
    seArtifacts.forEach((art, idx) => {
      const typeDesc = 
        art.artifactType === 'clipping' ? 'Клиппинг / микро-перегруз' :
        art.artifactType === 'mouse_click' ? 'Клик мыши / щелчок' :
        art.artifactType === 'plosive' ? 'Задув капсюля / П-всплеск' : 'Обрыв фразы гейтом';
      report += `${idx + 1}. [${art.startFormatted}] ${art.dubberName} (${art.characterName}): ${typeDesc}\n`;
      if (art.artifactMetric) report += `   • Параметры: ${art.artifactMetric}\n`;
      report += `   👉 Задача звукорежиссеру: ${art.comment.replace(/^\[.*?\]\s*/, '') || 'Обработать декликером / эквалайзером при сведении'}\n\n`;
    });
  }

  // 8. Пропуски реплик (если есть)
  if (regularMissing.length > 0) {
    report += `🔇 ПРОПУСКИ РЕПЛИК В ДОРОЖКАХ (ОЖИДАЮТ ДООЗВУЧКИ):\n`;
    regularMissing.forEach((m, idx) => {
      report += `${idx + 1}. [${m.startFormatted}] ${m.dubberName} (${m.characterName}): "${m.text}"\n`;
    });
    report += `\n`;
  }

  report += `━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `Сгенерировано через QA Контроль Качества`;

  return report;
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

export const DEFAULT_TG_ARTICLE_TEMPLATE_RECAST = `─── 🎀 ───
˗ˏˋ **{title}** ˎˊ˗
🤍 **{progress}** 🤍
─── 🎀 ───

{articleTable}

─── 🎀 ───
🌸 [{catalogLabel}]({linkCatalog}) | {nextEpisodeNumber} (Скоро) ➡️`;

export const DEFAULT_TG_ARTICLE_TEMPLATE_VOICEOVER = `─── 🎀 ───
˗ˏˋ **{title}** ˎˊ˗
🤍 **{progress}** 🤍
─── 🎀 ───

{articleTable}

─── 🎀 ───
🌸 [{catalogLabel}]({linkCatalog}) | {nextEpisodeNumber} (Скоро) ➡️`;

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
📅 ДЕДЛАЙН ФИКСОВ: {fixesDeadline}
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

  const seTgLink = se ? (se.tgChannel || `https://t.me/${(se.telegram || se.nickname).replace('@', '')}`) : 'https://t.me/Tenmag';
  const catalogLabel = 'Каталог всех релизов';
  const linkCatalog = links.catalog || links.tg || 'https://t.me';

  // Build article table in standard Markdown table format
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

  const mainDeadlineStr = formatDeadline(episode.deadline);
  const fixesDeadlineDate = getFixesDeadlineDate(episode.deadline, episode.fixesDeadline);
  const fixesDeadlineStr = fixesDeadlineDate ? formatDeadline(fixesDeadlineDate.toISOString()) : 'не указан';
  const fullDeadlineStr = formatFullDeadline(episode.deadline, episode.fixesDeadline);

  vars.deadline = fullDeadlineStr;
  vars.mainDeadline = mainDeadlineStr;
  vars.fixesDeadline = fixesDeadlineStr;
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

export const generateTGArticleMessage = (episode: Episode, participants: Participant[]) => {
  const isRecastOrRedub = episode.project?.releaseType === 'RECAST' || episode.project?.releaseType === 'REDUB';
  const defaultTpl = isRecastOrRedub ? DEFAULT_TG_ARTICLE_TEMPLATE_RECAST : DEFAULT_TG_ARTICLE_TEMPLATE_VOICEOVER;
  const tplStr = episode.tgArticleTemplate || episode.project?.tgArticleTemplate || defaultTpl;
  const vars = getTemplateVariables(episode, participants);
  return applyTemplate(tplStr, vars);
};

export const getTemplateString = (episode: Episode, type: 'TG' | 'VK' | 'FINAL_TG' | 'TG_ARTICLE' | 'LINKS'): string => {
  const isRecastOrRedub = episode.project?.releaseType === 'RECAST' || episode.project?.releaseType === 'REDUB';
  if (type === 'TG') {
    const defaultTpl = isRecastOrRedub ? DEFAULT_TG_TEMPLATE_RECAST : DEFAULT_TG_TEMPLATE_VOICEOVER;
    return episode.tgPostTemplate || episode.project?.tgPostTemplate || defaultTpl;
  }
  if (type === 'TG_ARTICLE') {
    const defaultTpl = isRecastOrRedub ? DEFAULT_TG_ARTICLE_TEMPLATE_RECAST : DEFAULT_TG_ARTICLE_TEMPLATE_VOICEOVER;
    return episode.tgArticleTemplate || episode.project?.tgArticleTemplate || defaultTpl;
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

export const formatInlineMarkdown = (text: string): string => {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    const safeUrl = url.replace(/"/g, '&quot;');
    return `<a href="${safeUrl}" style="color: #64b5f6; font-style: italic; text-decoration: none;">${linkText}</a>`;
  });

  // Bold: **text**
  html = html.replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>');

  // Italic: __text__ or _text_
  html = html.replace(/__([\s\S]+?)__/g, '<i>$1</i>');
  html = html.replace(/(?<!_)_([^_]+?)_(?!_)/g, '<i>$1</i>');

  // Code: `code`
  html = html.replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 4px; font-family: monospace;">$1</code>');

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

    const contentRows = tableRows.filter(r => !/^\s*\|?\s*:?-+:?\s*(\|?\s*:?-+:?\s*)+\|?\s*$/.test(r));

    contentRows.forEach((row, idx) => {
      const cells = row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      const isHeader = idx === 0 && (cells.length === 1 || !cells[1] || cells[0].includes('Роли озвучивали'));

      if (isHeader) {
        tableHtml += `  <tr style="background-color: #1e334d;">\n`;
        tableHtml += `    <th colspan="2" style="padding: 10px 14px; text-align: center; font-weight: bold; color: #ffffff; border: 1px solid #233d5d; font-size: 14.5px;">${formatInlineMarkdown(cells[0])}</th>\n`;
        tableHtml += `  </tr>\n`;
      } else if (cells.length >= 2 && !cells[1]) {
        // Single cell spanning 2 columns (e.g. secondary actors)
        tableHtml += `  <tr>\n`;
        tableHtml += `    <td colspan="2" style="padding: 8px 14px; border: 1px solid #233d5d; color: #94a3b8; font-style: italic; text-align: left; vertical-align: middle;">${formatInlineMarkdown(cells[0])}</td>\n`;
        tableHtml += `  </tr>\n`;
      } else if (cells.length >= 2) {
        // Standard two-column row
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
        resultBlocks.push(`<div style="text-align: center; color: #f472b6; font-weight: bold; margin: 8px 0; font-size: 14px; letter-spacing: 1px;">${formatInlineMarkdown(trimmed)}</div>`);
      } else if (trimmed.startsWith('˗ˏˋ') || (trimmed.startsWith('**') && trimmed.endsWith('**') && trimmed.length < 60)) {
        resultBlocks.push(`<div style="text-align: center; font-weight: bold; font-size: 16px; color: #ffffff; margin: 4px 0;">${formatInlineMarkdown(trimmed)}</div>`);
      } else if (trimmed.includes('🤍') || (trimmed.startsWith('👾') && trimmed.endsWith('👾'))) {
        resultBlocks.push(`<div style="text-align: center; font-weight: bold; font-size: 14px; color: #ffffff; margin: 4px 0;">${formatInlineMarkdown(trimmed)}</div>`);
      } else if (trimmed.includes('🌸') || trimmed.includes('➡️') || trimmed.includes('Каталог')) {
        resultBlocks.push(`<div style="text-align: center; font-size: 13.5px; color: #e2e8f0; margin: 8px 0;">${formatInlineMarkdown(trimmed)}</div>`);
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
        (code >= 0x1F300 && code <= 0x1F9FF) ||
        (code >= 0x2600 && code <= 0x27BF) ||
        char === '❇' || char === '🎀' || char === '🤍' || char === '🌸' || char === '🎙' || char === '👾'
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
    if (currentWidth >= targetWidth) return str;
    return str + ' '.repeat(targetWidth - currentWidth);
  };

  const centerText = (str: string, targetWidth: number): string => {
    const currentWidth = getVisualLength(str);
    if (currentWidth >= targetWidth) return str;
    const totalSpaces = targetWidth - currentWidth;
    const leftSpaces = Math.floor(totalSpaces / 2);
    const rightSpaces = totalSpaces - leftSpaces;
    return ' '.repeat(leftSpaces) + str + ' '.repeat(rightSpaces);
  };

  const lines = text.split('\n');
  const outputLines: string[] = [];
  let tableRows: string[] = [];

  const flushUnicodeTable = () => {
    if (tableRows.length === 0) return;

    const contentRows = tableRows.filter(r => !/^\s*\|?\s*:?-+:?\s*(\|?\s*:?-+:?\s*)+\|?\s*$/.test(r));
    if (contentRows.length === 0) {
      tableRows = [];
      return;
    }

    const parsedRows: { isHeader: boolean; isFullWidth: boolean; col1: string; col2: string }[] = [];

    let col1Max = 22;
    let col2Max = 12;

    contentRows.forEach((row, idx) => {
      const cells = row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => stripFormatting(c.trim()));
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

    const col1Width = col1Max + 1;
    const col2Width = col2Max + 1;
    const totalInnerWidth = col1Width + col2Width + 3;

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

