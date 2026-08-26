import { Episode, Participant, ProjectLinks, QuickUploadLink, Project } from '../../types';

export interface BookmarkItem {
  id: string;
  name: string;
  url: string;
  color?: string;
  defaultEngine?: 'smart-proxy' | 'direct-webview' | 'sandbox-iframe' | 'popup-overlay' | 'reader-extractor';
}

export interface ChecklistItemDef {
  id: string;
  label: string;
  url?: string;
}

export interface CustomFieldItem {
  id: string;
  label: string;
  value: string;
}

export type UploaderLayoutMode = 'split' | 'browser' | 'generator';
export type TemplateType = 'TG' | 'VK' | 'FINAL_TG' | 'YT' | 'TORRENT' | 'CUSTOM';

export interface UploaderPanelProps {
  currentEpisode: Episode | null;
  onRefresh?: () => void;
  onNavigate?: (tab: 'dashboard' | 'subtitles' | 'qa' | 'release' | 'uploader' | 'settings' | 'database' | 'cover' | 'stats' | 'archive') => void;
}

export const DEFAULT_BOOKMARKS: BookmarkItem[] = [
  { id: 'vk_cab', name: 'VK Видео Кабинет', url: 'https://cabinet.vkvideo.ru/', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  { id: 'anime365', name: 'Smotret-Anime (365)', url: 'https://smotret-anime.com/translations/create', color: 'text-pink-400 bg-pink-500/10 border-pink-500/30' },
  { id: 'tg', name: 'Telegram Web', url: 'https://web.telegram.org/a/', color: 'text-sky-400 bg-sky-500/10 border-sky-500/30' },
  { id: 'kodik', name: 'Kodik Converter', url: 'https://converter.kodikres.com/', color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30' },
  { id: 'rutube', name: 'RuTube Студия', url: 'https://rutube.ru/studio', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  { id: 'yt', name: 'YouTube Studio', url: 'https://studio.youtube.com', color: 'text-red-400 bg-red-500/10 border-red-500/30' },
  { id: 'yandex', name: 'Яндекс Диск', url: 'https://disk.yandex.ru', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  { id: 'gdrive', name: 'Google Drive', url: 'https://drive.google.com', color: 'text-green-400 bg-green-500/10 border-green-500/30' },
  { id: 'boosty', name: 'Boosty', url: 'https://boosty.to', color: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
  { id: 'sibnet', name: 'Sibnet Видео', url: 'https://video.sibnet.ru/', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' },
  { id: 'nyaa', name: 'Nyaa Торренты', url: 'https://nyaa.si', color: 'text-teal-400 bg-teal-500/10 border-teal-500/30' },
];

export const DEFAULT_PLATFORM_CHECKLIST: ChecklistItemDef[] = [
  { id: 'tg', label: 'Telegram Канал', url: 'https://web.telegram.org/a/' },
  { id: 'vk', label: 'ВКонтакте (Паблик / Видео)', url: 'https://vk.com/video' },
  { id: 'yt', label: 'YouTube Studio', url: 'https://studio.youtube.com' },
  { id: 'rutube', label: 'RuTube Студия', url: 'https://rutube.ru/studio' },
  { id: 'yandex', label: 'Яндекс.Диск', url: 'https://disk.yandex.ru' },
  { id: 'torrent', label: 'Торрент-трекер', url: 'https://nyaa.si' },
  { id: 'boosty', label: 'Boosty / Донаты', url: 'https://boosty.to' },
];

export const DEFAULT_CUSTOM_FIELDS: CustomFieldItem[] = [
  { id: 'f1', label: 'Теги Telegram', value: '#аниме #озвучка #новое #релиз' },
  { id: 'f2', label: 'Водяной знак', value: 'Специально для Akane Project' }
];

export const DEFAULT_QUICK_LINKS: QuickUploadLink[] = [
  { id: 'q1', title: 'TG Загрузка', name: 'TG Загрузка', url: 'https://t.me/akaneproject' },
  { id: 'q2', title: 'Kodik Конвертер', name: 'Kodik Конвертер', url: 'https://converter.kodikres.com/' },
  { id: 'q3', title: 'VK Кабинет', name: 'VK Кабинет', url: 'https://cabinet.vkvideo.ru/dashboard/@club216521493?filterPreset=published&section=video_my_content&subsection=video_my_content_videos' },
  { id: 'q4', title: 'Anime365', name: 'Anime365', url: 'https://smotret-anime.com/translations/create' },
  { id: 'q5', title: 'VK Паблик', name: 'VK Паблик', url: 'https://vk.com/okaneproject' }
];

export const DEFAULT_PLATFORM_NOTES = '• YouTube: Не забудьте выбрать категорию "Анимация" и указать "Не для детей".\n• VK Видео: Добавлять в плейлист релиза и включать обложку HD.\n• Telegram: Проверять кликабельность ссылок с разметкой.';
