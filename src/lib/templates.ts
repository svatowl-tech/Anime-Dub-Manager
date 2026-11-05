import { Episode, Participant } from '../types';
import { MissingLineDetection } from './qa/missingLinesDetector';
import { getReleasePresetSync } from './releasePresetsService';
import {
  DEFAULT_LINKS_TEMPLATE,
  formatDeadline,
  formatDeadlineRelative,
  getFixesDeadlineDate,
  formatFullDeadline,
  applyTemplate,
  getTemplateVariables,
  isTableSeparatorLine,
  formatInlineMarkdown,
  convertToHTMLForTelegram,
  markdownTableToUnicodeBox
} from './templates/templateParserAndTableFormatter.service';

export {
  DEFAULT_LINKS_TEMPLATE,
  formatDeadline,
  formatDeadlineRelative,
  getFixesDeadlineDate,
  formatFullDeadline,
  applyTemplate,
  getTemplateVariables,
  isTableSeparatorLine,
  formatInlineMarkdown,
  convertToHTMLForTelegram,
  markdownTableToUnicodeBox
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

export const generateStartEpisodeMessage = (episode: Episode, participants: Participant[], yandexUrl?: string) => {
  const vars = getTemplateVariables(episode, participants, yandexUrl);
  const tpl = episode.startMessageTemplate || episode.project?.startMessageTemplate || DEFAULT_START_EPISODE_TEMPLATE;
  let result = applyTemplate(tpl, vars);

  if (yandexUrl && !result.includes(yandexUrl)) {
    result += `\n\n📁 Исходники серии: ${yandexUrl}`;
  }

  return result;
};

export const generateSoundEngineerMessage = (episode: Episode, yandexUrl: string, participants: Participant[] = []) => {
  const vars = getTemplateVariables(episode, participants, yandexUrl);
  const tpl =
    episode.soundEngineerMessageTemplate ||
    episode.project?.soundEngineerMessageTemplate ||
    DEFAULT_SOUND_ENGINEER_TEMPLATE;
  let result = applyTemplate(tpl, vars);

  if (yandexUrl && !result.includes(yandexUrl)) {
    result += `\n\n📁 Файлы доступны по ссылке: ${yandexUrl}`;
  }

  return result;
};

export const generateFixesIssuedMessage = (episode: Episode, participants: Participant[]) => {
  const vars = getTemplateVariables(episode, participants);
  if (!vars.dubberFixesSections) return null;
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

  const items =
    detections.length > 0 ? (detections.some(d => d.selected) ? detections.filter(d => d.selected) : detections) : [];

  const overlaps = items.filter(d => d.defectCategory === 'actor_overlap');
  const collisions = items.filter(d => d.defectCategory === 'actor_collision');
  const shortLines = items.filter(d => d.defectCategory === 'timing_too_short');
  const longLines = items.filter(d => d.defectCategory === 'timing_too_long');
  const unwanted = items.filter(d => d.defectCategory === 'unwanted_speech');
  const subErrors = items.filter(
    d => d.resolutionAction === 'reassign_character' || d.isSubtitleError || d.reassignedCharacterName
  );
  const regularMissing = items.filter(
    d =>
      (d.defectCategory || 'missing_line') === 'missing_line' &&
      !d.isSubtitleError &&
      d.resolutionAction !== 'reassign_character'
  );

  let report = `🎧 ${seMention}, отчет по таймингу, стыкам и косякам озвучки:\n`;
  report += `🎬 ${title} — ${epNum} серия\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

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

  if (collisions.length > 0) {
    report += `⚠️ КОНФЛИКТЫ (ОЗВУЧИЛИ ОДНУ РЕПЛИКУ ВДВОЁМ):\n`;
    collisions.forEach((col, idx) => {
      report += `${idx + 1}. [${col.startFormatted} - ${col.endFormatted}] Реплика: "${col.text}"\n`;
      report += `   • Записали оба: ${col.dubberName} и ${col.secondDubberName || 'второй даббер'}\n`;
      if (col.resolutionAction === 'keep_first') {
        report += `   👉 Решение: оставить ${col.dubberName}, дубль ${col.secondDubberName} вырезать до тишины\n`;
      } else if (col.resolutionAction === 'keep_second') {
        report += `   👉 Решение: оставить ${col.secondDubberName}, дубль ${col.dubberName} вырезать до тишины\n`;
      } else if (col.resolutionAction === 'transfer_second_to_first') {
        report += `   👉 Решение: перенести дубль от ${col.secondDubberName} в дорожку ${col.dubberName} целиком до тишины\n`;
      } else if (col.resolutionAction === 'transfer_first_to_second') {
        report += `   👉 Решение: перенести дубль от ${col.dubberName} в дорожку ${col.secondDubberName} целиком до тишины\n`;
      } else if (col.resolutionAction === 'fix_subs' && col.selectedCharacterForSub) {
        report += `   👉 Решение: по сабам это персонаж ${col.selectedCharacterForSub}\n`;
      } else {
        report += `   👉 Рекомендация: выбрать основную дорожку, вторую заглушить до тишины\n`;
      }
      report += `\n`;
    });
  }

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

  if (unwanted.length > 0) {
    report += `🎙 ОЗВУЧЕНО ВНЕ САБОВ (ЛИШНИЕ ФРАЗЫ):\n`;
    unwanted.forEach((un, idx) => {
      const action = un.resolutionAction === 'silence' ? 'заменить тишиной' : 'оставить';
      report += `${idx + 1}. [${un.startFormatted} - ${un.endFormatted}] ${un.dubberName} (${un.durationSec}с)\n`;
      if (un.nearestContext) report += `   • Контекст: ${un.nearestContext}\n`;
      report += `   👉 Решение: ${action}\n\n`;
    });
  }

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

  const seArtifacts = items.filter(
    d =>
      (d.defectCategory === 'audio_artifact' ||
        d.type === 'clipping' ||
        d.type === 'mouse_click' ||
        d.type === 'plosive' ||
        d.type === 'swallowed_vowel') &&
      d.resolutionAction === 'note_sound_engineer'
  );

  if (seArtifacts.length > 0) {
    report += `🎛 ТЕХНИЧЕСКИЕ АРТЕФАКТЫ (ДЛЯ ОБРАБОТКИ ПЛАГИНАМИ / СВЕДЕНИЯ):\n`;
    seArtifacts.forEach((art, idx) => {
      const typeDesc =
        art.artifactType === 'clipping'
          ? 'Клиппинг / микро-перегруз'
          : art.artifactType === 'mouse_click'
          ? 'Клик мыши / щелчок'
          : art.artifactType === 'plosive'
          ? 'Задув капсюля / П-всплеск'
          : 'Обрыв фразы гейтом';
      report += `${idx + 1}. [${art.startFormatted}] ${art.dubberName} (${art.characterName}): ${typeDesc}\n`;
      if (art.artifactMetric) report += `   • Параметры: ${art.artifactMetric}\n`;
      report += `   👉 Задача звукорежиссеру: ${art.comment.replace(/^\[.*?\]\s*/, '') || 'Обработать декликером / эквалайзером при сведении'}\n\n`;
    });
  }

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
  try {
    const vars = getTemplateVariables(episode, participants);
    const tpl = episode.statusMessageTemplate || episode.project?.statusMessageTemplate || DEFAULT_STATUS_TEMPLATE;
    return applyTemplate(tpl, vars);
  } catch (err) {
    console.error('Error generating status reminder message:', err);
    return `⏰ Напоминание о сдаче дорожек: ${episode.project?.title || 'Проект'} (Серия ${episode.number})\nДедлайн: ${episode.deadline || 'не указан'}`;
  }
};

export const generateTGPostMessage = (episode: Episode, participants: Participant[]) => {
  const relType = episode.project?.releaseType || 'VOICEOVER';
  const isRecastOrRedub = relType === 'RECAST' || relType === 'REDUB';
  const defaultTpl = isRecastOrRedub ? DEFAULT_TG_TEMPLATE_RECAST : DEFAULT_TG_TEMPLATE_VOICEOVER;
  const preset = getReleasePresetSync(relType);
  const tplStr = episode.tgPostTemplate || episode.project?.tgPostTemplate || preset.tgPostTemplate || defaultTpl;
  const vars = getTemplateVariables(episode, participants);
  return applyTemplate(tplStr, vars);
};

export const generateVKPostMessage = (episode: Episode, participants: Participant[]) => {
  const relType = episode.project?.releaseType || 'VOICEOVER';
  const isRecastOrRedub = relType === 'RECAST' || relType === 'REDUB';
  const defaultTpl = isRecastOrRedub ? DEFAULT_VK_TEMPLATE_RECAST : DEFAULT_VK_TEMPLATE_VOICEOVER;
  const preset = getReleasePresetSync(relType);
  const tplStr = episode.vkPostTemplate || episode.project?.vkPostTemplate || preset.vkPostTemplate || defaultTpl;
  const vars = getTemplateVariables(episode, participants);
  return applyTemplate(tplStr, vars);
};

export const generateTGArticleMessage = (episode: Episode, participants: Participant[]) => {
  const relType = episode.project?.releaseType || 'VOICEOVER';
  const isRecastOrRedub = relType === 'RECAST' || relType === 'REDUB';
  const defaultTpl = isRecastOrRedub ? DEFAULT_TG_ARTICLE_TEMPLATE_RECAST : DEFAULT_TG_ARTICLE_TEMPLATE_VOICEOVER;
  const preset = getReleasePresetSync(relType);
  const tplStr =
    episode.tgArticleTemplate || episode.project?.tgArticleTemplate || preset.tgArticleTemplate || defaultTpl;
  const vars = getTemplateVariables(episode, participants);
  return applyTemplate(tplStr, vars);
};

export const getTemplateString = (
  episode: Episode,
  type: 'TG' | 'VK' | 'FINAL_TG' | 'TG_ARTICLE' | 'LINKS'
): string => {
  const relType = episode.project?.releaseType || 'VOICEOVER';
  const isRecastOrRedub = relType === 'RECAST' || relType === 'REDUB';
  const preset = getReleasePresetSync(relType);

  if (type === 'TG') {
    const defaultTpl = isRecastOrRedub ? DEFAULT_TG_TEMPLATE_RECAST : DEFAULT_TG_TEMPLATE_VOICEOVER;
    return episode.tgPostTemplate || episode.project?.tgPostTemplate || preset.tgPostTemplate || defaultTpl;
  }
  if (type === 'TG_ARTICLE') {
    const defaultTpl = isRecastOrRedub ? DEFAULT_TG_ARTICLE_TEMPLATE_RECAST : DEFAULT_TG_ARTICLE_TEMPLATE_VOICEOVER;
    return episode.tgArticleTemplate || episode.project?.tgArticleTemplate || preset.tgArticleTemplate || defaultTpl;
  }
  if (type === 'VK') {
    const defaultTpl = isRecastOrRedub ? DEFAULT_VK_TEMPLATE_RECAST : DEFAULT_VK_TEMPLATE_VOICEOVER;
    return episode.vkPostTemplate || episode.project?.vkPostTemplate || preset.vkPostTemplate || defaultTpl;
  }
  if (type === 'FINAL_TG') {
    return (
      episode.finalTgPostTemplate ||
      episode.project?.finalTgPostTemplate ||
      preset.finalTgPostTemplate ||
      DEFAULT_FINAL_TG_TEMPLATE
    );
  }
  if (type === 'LINKS') {
    return episode.linksTemplate || episode.project?.linksTemplate || preset.linksTemplate || DEFAULT_LINKS_TEMPLATE;
  }
  return '';
};

export const generateFinalTGMessage = (episode: Episode, participants: Participant[]) => {
  const relType = episode.project?.releaseType || 'VOICEOVER';
  const preset = getReleasePresetSync(relType);
  const vars = getTemplateVariables(episode, participants);
  const tplStr =
    episode.finalTgPostTemplate ||
    episode.project?.finalTgPostTemplate ||
    preset.finalTgPostTemplate ||
    DEFAULT_FINAL_TG_TEMPLATE;
  return applyTemplate(tplStr, vars);
};
