/**
 * Сервис для генерации постов и анализа текста на основе алгоритмов и шаблонов (Main Process).
 * Больше не использует внешние AI API.
 */
class SocialMediaBot {
  constructor() {
    // API ключ больше не требуется
  }

  /**
   * Генерирует текст поста на основе данных о релизе (Алгоритмический подход).
   */
  async generateReleasePost(data) {
    const { projectTitle, episodeNumber, dubbers } = data;
    
    const templates = [
      `🔥 УРА! ВЫШЛА НОВАЯ СЕРИЯ! 🔥\n\n🎬 Проект: ${projectTitle}\n📺 Серия: ${episodeNumber}\n\n🎙 Роли озвучивали: ${dubbers.join(', ')}\n\n✨ Наша команда приложила максимум усилий, чтобы вы могли насладиться просмотром в качественной озвучке. Спасибо всем даберам за их труд!\n\n🍿 Приятного просмотра! Ждем ваши отзывы в комментариях! 👇`,
      
      `🚀 РЕЛИЗ: ${projectTitle} — Серия ${episodeNumber} уже доступна! 🚀\n\nВстречайте продолжение любимого тайтла в нашей озвучке! ✨\n\n👥 Над серией работали: ${dubbers.join(', ')}\n\nОгромное спасибо ребятам за оперативность и качество! ❤️\n\nСмотрите прямо сейчас и делитесь впечатлениями! 🎬✨`,
      
      `🎧 Новая серия ${projectTitle} (${episodeNumber}) готова к просмотру! 🎧\n\nМы продолжаем радовать вас качественным фандабом! 🎙🔥\n\n🌟 Голоса серии: ${dubbers.join(', ')}\n\nСпасибо команде за отличную работу! Вы лучшие! 🙌✨\n\nСкорее бегите смотреть! 🍿🎬`
    ];

    // Выбираем случайный шаблон
    const randomIndex = Math.floor(Math.random() * templates.length);
    return templates[randomIndex];
  }

  /**
   * Извлекает список персонажей из текста субтитров (Алгоритмический подход).
   * Использует регулярные выражения для поиска имен в формате ASS.
   */
  async extractCharacters(text) {
    try {
      // В формате ASS имена персонажей обычно идут после "Dialogue: ...,Name,"
      // Регулярное выражение для извлечения имен из строк диалогов ASS
      const characterRegex = /^Dialogue: [^,]*,[^,]*,[^,]*,([^,]*),/gm;
      const characters = new Set();
      let match;

      while ((match = characterRegex.exec(text)) !== null) {
        const name = match[1].trim();
        if (name && name !== 'Default' && name !== 'NTP' && isNaN(Number(name))) {
          characters.add(name);
        }
      }

      // Если регулярка не сработала (например, текст не в формате ASS), 
      // попробуем простой поиск по строкам с двоеточием (как в сценариях)
      if (characters.size === 0) {
        const scriptRegex = /^([^:\n\r]{2,25}):/gm;
        while ((match = scriptRegex.exec(text)) !== null) {
          const name = match[1].trim();
          if (name && !['http', 'https', 'ftp'].includes(name.toLowerCase())) {
            characters.add(name);
          }
        }
      }

      return Array.from(characters).sort();
    } catch (error) {
      const log = require('electron-log');
      log.error('Ошибка при алгоритмическом извлечении персонажей:', error);
      return [];
    }
  }
}

module.exports = {
  SocialMediaBot
};
