import { useState, useEffect, useRef } from 'react';
import { 
  Globe, Play, FileText, Sparkles, ExternalLink, Check, Copy, RefreshCw, 
  X, Layers, Film, Download, CheckCircle2, ChevronRight, Magnet, Radio, AlertCircle
} from 'lucide-react';
import Hls from 'hls.js';
import { Episode, Project } from '../types';
import { ipcSafe } from '../lib/ipcSafe';
import { safeCopyToClipboard } from '../lib/clipboard';

interface AnimeSourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentEpisode: Episode | null;
  project?: Project | null;
  onApplyLinks?: (links: Record<string, string>) => void;
  onSelectVideoSource?: (streamUrl: string, label: string) => void;
  onSelectSubtitleSource?: (subUrl: string, label: string) => void;
}

interface VideoSource {
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

interface SubtitleSource {
  id: string;
  platform: 'fansubs' | 'kodik' | 'anilibria' | 'shikimori' | string;
  label: string;
  url: string;
  type: 'ass' | 'srt' | 'vtt' | 'player_stream' | 'web_portal';
  lang?: string;
}

interface TorrentSource {
  id: number | string;
  hash?: string;
  magnet?: string;
  quality: string;
  series?: string;
  size?: number | string;
  fileUrl?: string;
}

export default function AnimeSourcesModal({
  isOpen,
  onClose,
  currentEpisode,
  project,
  onApplyLinks,
  onSelectVideoSource,
  onSelectSubtitleSource
}: AnimeSourcesModalProps) {
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

  if (!isOpen) return null;

  const PLATFORM_LABELS: Record<string, { label: string; desc: string; iconColor: string }> = {
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

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-6 border-b border-neutral-800 bg-neutral-900/60 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-2xl text-purple-400">
              <Sparkles className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white tracking-wide">
                  AnimeParsers: Источники Видео, Субтитров и Ссылок
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-[10px] font-bold uppercase tracking-wider border border-purple-500/30">
                  Multi-Source Hub
                </span>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Автопоиск по базам Kodik, AniLibria, Shikimori, Jut.su, AnimeGO и Fansubs.ru
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

        {/* Search Bar & Title Info */}
        <div className="p-6 bg-neutral-950/50 border-b border-neutral-800 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex-1 w-full flex items-center gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Поиск по названию аниме (русское или ромадзи)..."
                className="w-full bg-black/60 border border-neutral-800 focus:border-purple-500 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:outline-none transition-all"
              />
            </div>
            <div className="w-28 flex items-center gap-1.5 bg-black/60 border border-neutral-800 rounded-xl px-3 py-2">
              <span className="text-[10px] font-bold uppercase text-neutral-500">Серия:</span>
              <input
                type="number"
                min={1}
                value={episodeNum}
                onChange={(e) => setEpisodeNum(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-transparent text-sm font-bold text-white focus:outline-none"
              />
            </div>
            <button
              onClick={() => handleSearch()}
              disabled={isLoading}
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold shadow-lg shadow-purple-500/20 transition-all cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              <span>{isLoading ? 'Поиск во всех базах...' : 'Искать везде'}</span>
            </button>
          </div>

          {animeInfo && (
            <div className="flex items-center gap-3 bg-purple-500/5 border border-purple-500/20 px-4 py-2 rounded-xl text-left">
              {animeInfo.poster && (
                <img
                  src={animeInfo.poster}
                  alt={animeInfo.titleRu}
                  className="w-10 h-10 object-cover rounded-lg border border-neutral-800"
                />
              )}
              <div className="max-w-[240px]">
                <div className="text-xs font-bold text-white truncate" title={animeInfo.titleRu}>
                  {animeInfo.titleRu}
                </div>
                <div className="text-[10px] text-neutral-400 truncate" title={animeInfo.titleEn}>
                  {animeInfo.titleEn || 'Без ромадзи'} {animeInfo.episodesTotal ? `• ${animeInfo.episodesTotal} сер.` : ''}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-neutral-800 bg-neutral-900/40 px-6 gap-2">
          <button
            onClick={() => setActiveTab('links')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 font-bold text-xs uppercase tracking-wider transition-all ${
              activeTab === 'links'
                ? 'border-purple-500 text-purple-400 bg-purple-500/5'
                : 'border-transparent text-neutral-400 hover:text-white'
            }`}
          >
            <Globe className="w-4 h-4" />
            <span>Ссылки релиза ({Object.keys(releaseLinks).length})</span>
          </button>

          <button
            onClick={() => setActiveTab('video')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 font-bold text-xs uppercase tracking-wider transition-all ${
              activeTab === 'video'
                ? 'border-purple-500 text-purple-400 bg-purple-500/5'
                : 'border-transparent text-neutral-400 hover:text-white'
            }`}
          >
            <Play className="w-4 h-4" />
            <span>Источники видео ({videoSources.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('subtitles')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 font-bold text-xs uppercase tracking-wider transition-all ${
              activeTab === 'subtitles'
                ? 'border-purple-500 text-purple-400 bg-purple-500/5'
                : 'border-transparent text-neutral-400 hover:text-white'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Источники субтитров ({subtitleSources.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('torrents')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 font-bold text-xs uppercase tracking-wider transition-all ${
              activeTab === 'torrents'
                ? 'border-purple-500 text-purple-400 bg-purple-500/5'
                : 'border-transparent text-neutral-400 hover:text-white'
            }`}
          >
            <Magnet className="w-4 h-4" />
            <span>Торренты ({torrents.length})</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {errorMsg && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center gap-3 text-red-400 text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* TAB 1: RELEASE LINKS */}
          {activeTab === 'links' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-purple-500/10 border border-purple-500/20 rounded-2xl">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    Автозаполнение ссылок релиза
                  </h3>
                  <p className="text-xs text-neutral-400 mt-1">
                    Найденные ссылки будут автоматически добавлены в сборку серии и шаблон публикации.
                  </p>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    onClick={() => {
                      const allChecked = Object.keys(releaseLinks).every(k => selectedLinks[k]);
                      const next: Record<string, boolean> = {};
                      Object.keys(releaseLinks).forEach(k => {
                        next[k] = !allChecked;
                      });
                      setSelectedLinks(next);
                    }}
                    className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-semibold transition-all"
                  >
                    {Object.keys(releaseLinks).every(k => selectedLinks[k]) ? 'Снять выбор' : 'Выбрать все'}
                  </button>

                  <button
                    onClick={handleApplySelectedLinks}
                    disabled={Object.values(selectedLinks).filter(Boolean).length === 0}
                    className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-purple-500/20"
                  >
                    {appliedSuccess ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-300" />
                        <span>Ссылки применены!</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Применить ссылки в релиз</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {Object.keys(releaseLinks).length === 0 && !isLoading ? (
                <div className="text-center py-12 text-neutral-500 space-y-3">
                  <Globe className="w-12 h-12 mx-auto stroke-[1.2] opacity-40" />
                  <p className="text-sm">Ссылки пока не найдены. Введите точное название и нажмите «Искать везде».</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(releaseLinks).map(([key, url]) => {
                    const meta = PLATFORM_LABELS[key] || {
                      label: key.toUpperCase(),
                      desc: 'Внешняя платформа',
                      iconColor: 'text-neutral-400'
                    };
                    const isChecked = !!selectedLinks[key];

                    return (
                      <div
                        key={key}
                        className={`p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                          isChecked
                            ? 'bg-neutral-900/90 border-purple-500/40 shadow-sm'
                            : 'bg-black/30 border-neutral-800/80 opacity-70'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <label className="flex items-center gap-3 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => setSelectedLinks({ ...selectedLinks, [key]: e.target.checked })}
                              className="w-4 h-4 accent-purple-600 rounded cursor-pointer"
                            />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-bold text-white ${meta.iconColor}`}>
                                  {meta.label}
                                </span>
                                <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-neutral-800 text-neutral-400">
                                  {`{link${key.charAt(0).toUpperCase() + key.slice(1)}}`}
                                </span>
                              </div>
                              <p className="text-[11px] text-neutral-400 mt-0.5">{meta.desc}</p>
                            </div>
                          </label>

                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleCopyLink(key, url)}
                              className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
                              title="Скопировать ссылку"
                            >
                              {copiedKey === key ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 text-neutral-400 hover:text-purple-400 hover:bg-neutral-800 rounded-lg transition-colors"
                              title="Открыть в браузере"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>

                        <div className="bg-black/50 border border-neutral-800/60 rounded-xl px-3 py-2 text-xs font-mono text-purple-300 truncate select-all">
                          {url}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: VIDEO SOURCES & PLAYERS */}
          {activeTab === 'video' && (
            <div className="space-y-6">
              {/* Preview Player */}
              {activePreviewStream && (
                <div className="bg-black/80 border border-neutral-800 rounded-2xl overflow-hidden p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Play className="w-4 h-4 text-purple-400" />
                      <span className="text-sm font-bold text-white">
                        Плеер предпросмотра: {activePreviewStream.platformLabel}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {onSelectVideoSource && (
                        <button
                          onClick={() => {
                            onSelectVideoSource(activePreviewStream.streamUrl, activePreviewStream.platformLabel);
                            setAppliedSuccess(true);
                            setTimeout(() => setAppliedSuccess(false), 2500);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all shadow-md"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Установить как видео серии (RAW)</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-neutral-800/80">
                    {activePreviewStream.type === 'embed' ? (
                      <iframe
                        src={activePreviewStream.streamUrl}
                        className="w-full h-full border-0"
                        allowFullScreen
                        allow="autoplay; encrypted-media; fullscreen"
                      />
                    ) : (
                      <video
                        ref={videoRef}
                        controls
                        className="w-full h-full object-contain"
                        poster={animeInfo?.poster}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Video Sources List */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-2">
                  <Film className="w-3.5 h-3.5 text-purple-400" />
                  Доступные источники видео и потоки ({videoSources.length})
                </h3>

                {videoSources.length === 0 ? (
                  <div className="text-center py-10 text-neutral-500 text-sm">
                    Видеопотоки не найдены. Попробуйте уточнить название.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {videoSources.map((v) => {
                      const isPlaying = activePreviewStream?.id === v.id;

                      return (
                        <div
                          key={v.id}
                          className={`p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                            isPlaying
                              ? 'bg-purple-950/20 border-purple-500/60 shadow-lg'
                              : 'bg-neutral-900/60 border-neutral-800 hover:border-neutral-700'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-white">
                                  {v.platformLabel}
                                </span>
                                {v.quality && (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-neutral-800 text-purple-300">
                                    {v.quality}
                                  </span>
                                )}
                              </div>
                              {v.episodeName && (
                                <p className="text-xs text-neutral-400 mt-0.5">{v.episodeName}</p>
                              )}
                              <p className="text-[10px] font-mono text-neutral-500 mt-1 uppercase">
                                Тип: {v.type.toUpperCase()}
                              </p>
                            </div>

                            <button
                              onClick={() => setActivePreviewStream(v)}
                              className={`p-2 rounded-xl transition-all ${
                                isPlaying
                                  ? 'bg-purple-600 text-white shadow-md shadow-purple-500/20'
                                  : 'bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700'
                              }`}
                              title="Предпросмотр"
                            >
                              <Play className="w-4 h-4 fill-current" />
                            </button>
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-2 border-t border-neutral-800/60">
                            <button
                              onClick={() => handleCopyLink(v.id, v.streamUrl)}
                              className="text-xs text-neutral-400 hover:text-white flex items-center gap-1.5 transition-colors"
                            >
                              {copiedKey === v.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  <span className="text-emerald-400">Скопировано</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Копировать URL потока</span>
                                </>
                              )}
                            </button>

                            {onSelectVideoSource && (
                              <button
                                onClick={() => {
                                  onSelectVideoSource(v.streamUrl, v.platformLabel);
                                  setAppliedSuccess(true);
                                  setTimeout(() => setAppliedSuccess(false), 2500);
                                }}
                                className="px-3 py-1.5 bg-neutral-800 hover:bg-purple-600 text-white rounded-lg text-xs font-semibold transition-all flex items-center gap-1"
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                                <span>Выбрать</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SUBTITLES SOURCES */}
          {activeTab === 'subtitles' && (
            <div className="space-y-4">
              <div className="p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-2xl flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <FileText className="w-4 h-4 text-cyan-400" />
                    Базы и дорожки субтитров
                  </h3>
                  <p className="text-xs text-neutral-400 mt-1">
                    Источники оригинальных и фанатских субтитров (Kage Project Fansubs.ru, Kodik, AniLibria).
                  </p>
                </div>
              </div>

              {subtitleSources.length === 0 ? (
                <div className="text-center py-10 text-neutral-500 text-sm">
                  Источники субтитров не обнаружены.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {subtitleSources.map((s) => (
                    <div
                      key={s.id}
                      className="p-4 bg-neutral-900/60 border border-neutral-800 rounded-2xl flex flex-col justify-between gap-3 hover:border-neutral-700 transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">{s.label}</span>
                            <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-neutral-800 text-cyan-300">
                              {s.lang?.toUpperCase() || 'RU'}
                            </span>
                          </div>
                          <p className="text-xs text-neutral-400 mt-1 font-mono break-all">{s.url}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-neutral-800/60">
                        <button
                          onClick={() => handleCopyLink(s.id, s.url)}
                          className="text-xs text-neutral-400 hover:text-white flex items-center gap-1.5 transition-colors"
                        >
                          {copiedKey === s.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400">Скопировано</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Копировать ссылку</span>
                            </>
                          )}
                        </button>

                        <div className="flex items-center gap-2">
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs font-semibold transition-all"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Перейти</span>
                          </a>

                          {onSelectSubtitleSource && (
                            <button
                              onClick={() => onSelectSubtitleSource(s.url, s.label)}
                              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold transition-all shadow-md flex items-center gap-1"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Выбрать субтитры</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: TORRENTS */}
          {activeTab === 'torrents' && (
            <div className="space-y-4">
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Magnet className="w-4 h-4 text-red-400" />
                    Официальные торренты релиза
                  </h3>
                  <p className="text-xs text-neutral-400 mt-1">
                    Раздачи и magnet-ссылки качества Full HD / HD для скачивания чистых исходников без потерь.
                  </p>
                </div>
              </div>

              {torrents.length === 0 ? (
                <div className="text-center py-10 text-neutral-500 text-sm">
                  Торренты для данного релиза не найдены.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {torrents.map((t, idx) => (
                    <div
                      key={t.id || idx}
                      className="p-4 bg-neutral-900/60 border border-neutral-800 rounded-2xl flex flex-col justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">Качество: {t.quality}</span>
                          {t.series && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-neutral-800 text-red-300">
                              {t.series}
                            </span>
                          )}
                        </div>
                        {t.size && (
                          <p className="text-xs text-neutral-400 mt-1">
                            Размер: {typeof t.size === 'number' ? `${(t.size / 1024 / 1024 / 1024).toFixed(2)} GB` : t.size}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 pt-2 border-t border-neutral-800/60">
                        {t.magnet && (
                          <a
                            href={t.magnet}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-red-500/20"
                          >
                            <Magnet className="w-3.5 h-3.5" />
                            <span>Magnet-ссылка</span>
                          </a>
                        )}
                        {t.fileUrl && (
                          <a
                            href={t.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-bold transition-all"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Скачать .torrent</span>
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-neutral-950 border-t border-neutral-800 flex items-center justify-between text-xs text-neutral-500">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
            <span>Подключено к AniLibria V1, Shikimori API, Jut.su, Kodik и AnimeGO</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl font-bold transition-colors"
          >
            Закрыть
          </button>
        </div>

      </div>
    </div>
  );
}
