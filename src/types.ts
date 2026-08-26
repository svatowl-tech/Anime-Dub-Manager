export interface QuickUploadLink {
  id?: string;
  title?: string;
  name?: string;
  url: string;
}

export interface TelegramMTProtoSettings {
  apiId: number | string;
  apiHash: string;
  phoneNumber: string;
  defaultChannelId: string;
  autoPin: boolean;
  autoNotify: boolean;
  parseMode: 'html' | 'md';
  headerTemplate: string;
  footerTemplate: string;
  startNoticeTemplate?: string;
  reminderTemplate?: string;
  fixNoticeTemplate?: string;
  trackReceivedTemplate?: string;
  hasSession?: boolean;
}

export interface TelegramMTProtoMe {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  phone: string;
}

export interface TelegramMTProtoStatus {
  status: 'disconnected' | 'code_sent' | 'password_required' | 'connected';
  me: TelegramMTProtoMe | null;
  settings: TelegramMTProtoSettings;
}

export interface TelegramMTProtoDialog {
  id: string;
  title: string;
  username: string;
  isChannel: boolean;
  isGroup: boolean;
  isUser: boolean;
  unreadCount: number;
  type: 'channel' | 'group' | 'user' | 'chat';
  lastMessage?: string;
  date?: string;
}

export interface TelegramMTProtoPostParams {
  targetPeer: string;
  text: string;
  parseMode?: 'html' | 'md';
  silent?: boolean;
  pin?: boolean;
  scheduleDate?: string;
  mediaPath?: string;
}

export interface ProjectLinks {
  tg?: string;
  vk?: string;
  anime365?: string;
  shikimori?: string;
  kodik?: string;
  quickUploadLinks?: QuickUploadLink[];
  [key: string]: any;
}

export interface Participant {
  id: string;
  nickname: string;
  telegram: string;
  tgChannel: string;
  vkLink: string;
  roles: string[];
}

declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      send: (channel: string, ...args: any[]) => void;
      on: (channel: string, callback: (...args: any[]) => void) => () => void;
    };
  }
}

export type EpisodeStatus = "UPLOAD" | "ROLES" | "RECORDING" | "QA" | "FIXES" | "SOUND_ENGINEERING" | "FINISHED";
export type ReleaseType = "VOICEOVER" | "RECAST" | "REDUB";

export interface Episode {
  id: string;
  projectId: string;
  project?: Project;
  number: number;
  title?: string;
  airingDate?: string;
  status: EpisodeStatus;
  deadline?: string;
  rawPath?: string;
  subPath?: string;
  isHardsub?: boolean;
  tgPostTemplate?: string;
  vkPostTemplate?: string;
  finalTgPostTemplate?: string;
  linksTemplate?: string;
  startMessageTemplate?: string;
  soundEngineerMessageTemplate?: string;
  fixesMessageTemplate?: string;
  statusMessageTemplate?: string;
  tgPostLink?: string;
  vkPostLink?: string;
  yandexUrl?: string;
  assignments: RoleAssignment[];
  uploads: UploadedFile[];
  statusHistory?: { status: EpisodeStatus; timestamp: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface RoleAssignment {
  id: string;
  episodeId: string;
  characterName: string;
  dubberId?: string;
  dubber?: Participant;
  substituteId?: string;
  substitute?: Participant;
  status: string; // "PENDING", "RECORDED", "APPROVED", "REJECTED", "FIXES_NEEDED"
  comments?: string; // JSON string
  lineCount?: number;
  isMain?: boolean;
}

export interface UploadedFile {
  id: string;
  episodeId: string;
  assignmentId?: string;
  type: "DUBBER_FILE" | "FIXES" | "SOUND_ENGINEER_FILE";
  path: string;
  uploadedById: string;
  uploadedBy?: Participant;
  role?: string; // e.g. "SOUND_ENGINEER"
  createdAt: string;
}

export interface Project {
  id: string;
  title: string;
  originalTitle?: string;
  status: "ACTIVE" | "COMPLETED";
  lastActiveEpisode: number;
  totalEpisodes: number;
  assignedDubberIds: string[];
  soundEngineerId?: string;
  releaseType?: ReleaseType;
  emoji?: string;
  isOngoing?: boolean;
  synopsis?: string;
  posterUrl?: string;
  anime365Id?: number | null;
  airedEpisodes?: number;
  links?: string; // JSON string
  globalMapping?: string; // JSON string
  characterAliases?: string; // JSON string: Record<string, string> (alias -> mainName)
  nameStresses?: string; // JSON string: Record<string, string> (name -> stressed name)
  characters?: string; // JSON string: string[]
  coverSettings?: string; // JSON string
  typeAndSeason?: string; // e.g. "TV1", "Movie", "OVA"
  tgReleaseChannelId?: string;
  tgWorkGroupId?: string;
  tgStartTemplate?: string;
  tgReminderTemplate?: string;
  tgFixTemplate?: string;
  tgTrackReceivedTemplate?: string;
  autoTriggersConfig?: string;
  tgPostTemplate?: string;
  vkPostTemplate?: string;
  finalTgPostTemplate?: string;
  linksTemplate?: string;
  startMessageTemplate?: string;
  soundEngineerMessageTemplate?: string;
  fixesMessageTemplate?: string;
  statusMessageTemplate?: string;
  nextEpisodeDate?: string;
  episodes: Episode[];
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  type: string;
  metadata: any;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
  progress: number;
  eta: number | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface Comment {
  id: string;
  text: string;
  timestamp: number;
  author: string;
  subId?: string;
}

export interface SubtitleLine {
  id: number;
  start: string;
  end: string;
  startSec: number;
  endSec: number;
  style: string;
  name: string;
  text: string;
  rawLineIndex: number;
}

export interface SubtitleData {
  lines: SubtitleLine[];
  actors: string[];
}

export interface Track {
  id: string;
  participant: string;
  character: string;
  status: 'pending' | 'approved' | 'rejected' | 'fixes_needed';
  files: { id: string; path: string; createdAt: string; type?: 'DUBBER_FILE' | 'FIXES' | 'SOUND_ENGINEER_FILE' }[];
  selectedFileId?: string;
  comments: Comment[];
}
