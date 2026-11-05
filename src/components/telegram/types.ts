import { Episode, Project, TelegramMTProtoDialog, TelegramMTProtoSettings, TelegramMTProtoStatus } from '../../types';

export interface TelegramForumTopic {
  id: number;
  title: string;
  iconColor?: number;
  iconEmojiId?: string;
  unreadCount?: number;
  isClosed?: boolean;
  isPinned?: boolean;
}

export interface TelegramChatMessage {
  id: string;
  senderName: string;
  text: string;
  time: string;
  isMe: boolean;
  mediaPath?: string;
  isPinned?: boolean;
  topicId?: number;
}

export type TelegramTabType = 'tracks' | 'verify' | 'composer' | 'automations' | 'messenger' | 'dialogs' | 'settings';

export interface TelegramAudioFileItem {
  id: number;
  date: number;
  dateFormatted: string;
  sender: {
    id: string;
    name: string;
    username: string;
  };
  fileName: string;
  mimeType: string;
  size: number;
  sizeFormatted: string;
  duration?: number;
  durationFormatted?: string;
  isVoice?: boolean;
  topicId?: number;
  caption?: string;
  downloadedPath?: string;
}

export interface TelegramPostSearchResult {
  id: number;
  date: number;
  dateFormatted: string;
  text: string;
  views?: number;
  forwards?: number;
  hasMedia?: boolean;
  link: string;
}

export interface TelegramTabProps {
  status: TelegramMTProtoStatus | null;
  onRefreshStatus: () => Promise<void>;
  currentEpisode?: Episode | null;
  currentProject?: Project | null;
  allProjects?: Project[];
}
