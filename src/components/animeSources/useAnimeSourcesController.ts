import { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { Episode, Project } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { safeCopyToClipboard } from '../../lib/clipboard';

export interface AnimeSourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentEpisode: Episode | null;
  project?: Project | null;
  onApplyLinks?: (links: Record<string, string>) => void;
  onSelectVideoSource?: (streamUrl: string, label: string) => void;
  onSelectSubtitleSource?: (subUrl: string, label: string) => void;
}

export interface VideoSource {
  id: string;
  platform: 'anilibria' | 'kodik' | 'jutsu' | 'shikimori' | string;
  platformLabel: string;
  quality?: string;
  type: 'hls' | 'mp4' | 'embed';
  streamUrl: string;
  pageUrl?: string;
  episodeName?: string;
  isSubtitles?: boolean;
}

export interface SubtitleSource {
  id: string;
  platform: 'fansubs' | 'kodik' | 'anilibria' | 'shikimori' | string;
  label: string;
  url: string;
  type: 'ass' | 'srt' | 'vtt' | 'player_stream' | 'web_portal';
  lang?: string;
}

export interface TorrentSource {
  id: number | string;
  hash?: string;
  magnet?: string;
  quality: string;
  series?: string;
  size?: number | string;
  fileUrl?: string;
}

export const PLATFORM_LABELS: Record<string, { label: string; desc: string; iconColor: string }> = {
  kodik: { label: 'Kodik', desc: 'Плеер и база переводов', iconColor: 'text-purple-400' },
  shikimori: { label: 'Shikimori', desc: 'Главная база аниме', iconColor: 'text-blue-400' },
  anilibria: { label: 'AniLibria', desc: 'Официальный релиз и плеер', iconColor: 'text-red-400' },
  jutsu: { label: 'Jut.su', desc: 'Плеер серий Jut.su', iconColor: 'text-amber-400' },
  animego: { label: 'AnimeGO', desc: 'Страница релиза AnimeGO', iconColor: 'text-emerald-400' },
  fansubs: { label: 'Fansubs.ru (Kage)', desc: 'База русских субтитров', iconColor: 'text-cyan-400' },
  kinopoisk: { label: 'Кинопоиск', desc: 'Карточка на Кинопоиске', iconColor: 'text-orange-400' },
  worldart: { label: 'World-Art', desc: 'Каталог World-Art', iconColor: 'text-indigo-400' },
  mal: { label: 'MyAnimeList', desc: 'Международная база MAL', iconColor: 'text-blue-500' },
  official: { label: 'Официальный сайт', desc: 'Японский сайт тайтла', iconColor: 'text-neutral-400' }
};

export function useAnimeSourcesController({
  isOpen,
  currentEpisode,
  project,
  onApplyLinks
}: Pick<AnimeSourcesModalProps, 'isOpen' | 'currentEpisode' | 'project' | 'onApplyLinks'>) {
  const [activeTab, setActiveTab] = useState<'links' | 'video' | 'subtitles' | 'torrents'>('links');
  const [searchQuery, setSearchQuery] = useState('');
  const [episodeNum, setEpisodeNum] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Search Results
  const [animeInfo, setAnimeInfo] = useState<any>(null);
  const [releaseLinks, setReleaseLinks] = useState<Record<string, string>>({});
  const [videoSources, setVideoSources] = useState<VideoSource[]>([]);
  const [subtitleSources, setSubtitleSources] = useState<SubtitleSource[]>([]);
  const [torrents, setTorrents] = useState<TorrentSource[]>([]);

  // Selected links for applying
  const [selectedLinks, setSelectedLinks] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [appliedSuccess, setAppliedSuccess] = useState(false);

  // Active preview player state
  const [activePreviewStream, setActivePreviewStream] = useState<VideoSource | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Initialize search input based on project & episode
  useEffect(() => {
    if (isOpen) {
      const initialQuery = project?.originalTitle || project?.title || currentEpisode?.project?.title || '';
      setSearchQuery(initialQuery);
      setEpisodeNum(currentEpisode?.number || 1);
      if (initialQuery) {
        handleSearch(initialQuery, currentEpisode?.number || 1);
      }
    } else {
      // Clean up player on close
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      setActivePreviewStream(null);
      setAppliedSuccess(false);
    }
  }, [isOpen, project?.id, currentEpisode?.id]);

  // Handle HLS stream attachment when preview stream changes
  useEffect(() => {
    if (!activePreviewStream || !videoRef.current) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const videoEl = videoRef.current;

    if (activePreviewStream.type === 'hls') {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true
        });
        hls.loadSource(activePreviewStream.streamUrl);
        hls.attachMedia(videoEl);
        hlsRef.current = hls;
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = activePreviewStream.streamUrl;
      }
    } else if (activePreviewStream.type === 'mp4') {
      videoEl.src = activePreviewStream.streamUrl;
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [activePreviewStream]);

  const handleSearch = async (queryToSearch = searchQuery, epToSearch = episodeNum) => {
    if (!queryToSearch.trim()) return;
    setIsLoading(true);
    setErrorMsg(null);
    setAppliedSuccess(false);

    try {
      const res = await ipcSafe.invoke('anime-parsers:search-all', {
        title: queryToSearch.trim(),
        originalTitle: project?.originalTitle || undefined,
        episodeNumber: epToSearch,
        shikimoriId: undefined
      });

      if (res) {
        setAnimeInfo(res.animeInfo || null);
        const links = res.releaseLinks || {};
        setReleaseLinks(links);
        setVideoSources(res.videoSources || []);
        setSubtitleSources(res.subtitleSources || []);
        setTorrents(res.torrents || []);

        // Default: select all found links
        const sel: Record<string, boolean> = {};
        Object.keys(links).forEach(k => {
          if (links[k]) sel[k] = true;
        });
        setSelectedLinks(sel);

        // Pre-select first direct stream for preview if none selected
        if (res.videoSources && res.videoSources.length > 0 && !activePreviewStream) {
          const firstHls = res.videoSources.find((v: VideoSource) => v.type === 'hls' || v.type === 'mp4');
          if (firstHls) setActivePreviewStream(firstHls);
        }
      }
    } catch (err: any) {
      console.error('Anime parsers search error:', err);
      setErrorMsg(err.message || 'Ошибка при поиске источников');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplySelectedLinks = () => {
    const toApply: Record<string, string> = {};
    Object.entries(selectedLinks).forEach(([key, isSelected]) => {
      if (isSelected && releaseLinks[key]) {
        toApply[key] = releaseLinks[key];
      }
    });

    if (onApplyLinks) {
      onApplyLinks(toApply);
      setAppliedSuccess(true);
      setTimeout(() => setAppliedSuccess(false), 3000);
    }
  };

  const handleCopyLink = async (key: string, url: string) => {
    await safeCopyToClipboard(url);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return {
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    episodeNum,
    setEpisodeNum,
    isLoading,
    errorMsg,
    animeInfo,
    releaseLinks,
    videoSources,
    subtitleSources,
    torrents,
    selectedLinks,
    setSelectedLinks,
    copiedKey,
    appliedSuccess,
    setAppliedSuccess,
    activePreviewStream,
    setActivePreviewStream,
    videoRef,
    handleSearch,
    handleApplySelectedLinks,
    handleCopyLink
  };
}
