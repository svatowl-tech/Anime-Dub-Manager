import { ipcSafe } from '../lib/ipcSafe';
import { Project } from '../types';

const ANIME_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const TRACKER_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SERVICES_STATUS_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  timestamp: number;
  value: T;
}

const detailsCache = new Map<string, CacheEntry<any>>();
const detailsInFlight = new Map<string, Promise<any>>();

const charactersCache = new Map<string, CacheEntry<any[]>>();
const charactersInFlight = new Map<string, Promise<any[]>>();

const nextEpisodeDateCache = new Map<string, CacheEntry<string | null>>();
const nextEpisodeDateInFlight = new Map<string, Promise<string | null>>();

const trackerEpisodeCache = new Map<string, CacheEntry<number | null>>();
const trackerEpisodeInFlight = new Map<string, Promise<number | null>>();

let servicesStatusCache: CacheEntry<Record<string, { status: string; latency: number; error?: string }>> | null = null;
let servicesStatusInFlight: Promise<Record<string, { status: string; latency: number; error?: string }> | null> | null = null;

function readSessionCache<T>(storageKey: string, ttlMs: number): T | undefined {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (parsed && typeof parsed.timestamp === 'number' && Date.now() - parsed.timestamp < ttlMs) {
      return parsed.value;
    }
  } catch (err) {
    // Ignore sessionStorage read errors
  }
  return undefined;
}

function writeSessionCache<T>(storageKey: string, value: T): void {
  try {
    const entry: CacheEntry<T> = { timestamp: Date.now(), value };
    sessionStorage.setItem(storageKey, JSON.stringify(entry));
  } catch (err) {
    // Ignore quota or storage errors
  }
}

const isShikimoriPlaceholder = (url: string | undefined | null) => {
  if (!url) return true;
  const lowerUrl = url.toLowerCase();
  return lowerUrl.includes('missing_original.png') || 
         lowerUrl.includes('missing_preview.png') || 
         lowerUrl.includes('missing.png') || 
         lowerUrl.includes('main.png') ||
         lowerUrl.includes('missing_original.jpg') ||
         lowerUrl.includes('missing_preview.jpg') ||
         lowerUrl.includes('missing.jpg');
};

export const searchAnime = async (query: string) => {
  try {
    const result = await ipcSafe.invoke('search-anime', { query });
    if (!result) return [];
    if (result.mocked) return [];
    
    if (result.source === 'mal') {
      if (!result.data) return [];
      return result.data.map((anime: any) => ({
        id: anime.mal_id,
        mal_id: anime.mal_id,
        title: anime.title_english || anime.title,
        original_title: anime.title,
        image: anime.images?.jpg?.image_url || '',
        status: anime.status,
        type: anime.type,
        episodes: anime.episodes,
        aired_episodes: anime.episodes_aired || anime.aired_episodes || 0,
        source: 'mal'
      }));
    }

    const shikimoriData = Array.isArray(result) ? result : result.data;
    if (Array.isArray(shikimoriData) && shikimoriData.length > 0) {
      return shikimoriData.map((anime: any) => {
        const isPlaceholder = isShikimoriPlaceholder(anime.image?.original);
        return {
          id: anime.id,
          mal_id: anime.id,
          title: anime.russian || anime.name,
          original_title: anime.name,
          image: anime.image && !isPlaceholder ? `https://shikimori.io${anime.image.original}` : '',
          status: anime.status === 'ongoing' ? 'Currently Airing' : anime.status === 'released' ? 'Finished Airing' : anime.status,
          type: anime.kind ? anime.kind.toUpperCase() : '',
          episodes: anime.episodes,
          aired_episodes: anime.episodes_aired || 0,
          source: 'shikimori'
        };
      });
    }
  } catch (error) {
    console.error('Error searching anime via IPC:', error);
  }
  return [];
};

export const getAnimeDetails = async (id: number, source: string = 'shikimori', forceRefresh = false) => {
  const key = `${source}:${id}`;
  const now = Date.now();

  if (!forceRefresh) {
    const mem = detailsCache.get(key);
    if (mem && now - mem.timestamp < ANIME_CACHE_TTL_MS) {
      return mem.value;
    }
    const sess = readSessionCache<any>(`anime_details_${key}`, ANIME_CACHE_TTL_MS);
    if (sess !== undefined) {
      detailsCache.set(key, { timestamp: now, value: sess });
      return sess;
    }
    const existingPromise = detailsInFlight.get(key);
    if (existingPromise) {
      return existingPromise;
    }
  }

  const promise = (async () => {
    try {
      const result = await ipcSafe.invoke('get-anime-details', { id, source });
      if (!result || !result.data) return null;
      if (result && result.mocked) return null;
      
      let parsed: any = null;
      if (result.source === 'mal') {
        const anime = result.data;
        const shikimoriData = result.shikimoriData;
        
        const shikimoriImageOriginal = shikimoriData?.image?.original;
        const finalImageOriginal = (shikimoriImageOriginal && !isShikimoriPlaceholder(shikimoriImageOriginal)) 
          ? `https://shikimori.io${shikimoriImageOriginal}` 
          : (anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url);

        parsed = {
          id: shikimoriData?.id || anime.mal_id,
          title: shikimoriData?.russian || anime.title_english || anime.title,
          original_title: anime.title || shikimoriData?.name || '',
          image: finalImageOriginal,
          status: shikimoriData?.status || anime.status,
          episodes: shikimoriData?.episodes || anime.episodes,
          aired_episodes: shikimoriData?.episodes_aired || anime.episodes_aired || 0,
          aired_on: shikimoriData?.aired_on || anime.aired?.from?.split('T')[0],
          description: shikimoriData?.description || anime.synopsis,
          type: anime.type || shikimoriData?.kind?.toUpperCase() || '',
          season: anime.season,
          year: anime.year,
          source: shikimoriData ? 'shikimori+mal' : 'mal'
        };
      } else {
        const data = result.data;
        const isPlaceholder = isShikimoriPlaceholder(data.image?.original);
        parsed = {
          id: data.id,
          title: data.russian || data.name,
          original_title: data.name,
          image: data.image?.original && !isPlaceholder ? `https://shikimori.io${data.image.original}` : '',
          status: data.status,
          episodes: data.episodes,
          aired_episodes: data.episodes_aired || 0,
          aired_on: data.aired_on,
          description: data.description,
          type: data.kind ? data.kind.toUpperCase() : '',
          source: 'shikimori'
        };
      }

      if (parsed) {
        detailsCache.set(key, { timestamp: Date.now(), value: parsed });
        writeSessionCache(`anime_details_${key}`, parsed);
      }
      return parsed;
    } catch (error) {
      console.error('Error fetching anime details via IPC:', error);
      return null;
    } finally {
      detailsInFlight.delete(key);
    }
  })();

  detailsInFlight.set(key, promise);
  return promise;
};

export const getAnimeCharacters = async (id: number, source: string = 'shikimori', forceRefresh = false) => {
  const key = `${source}:${id}`;
  const now = Date.now();

  if (!forceRefresh) {
    const mem = charactersCache.get(key);
    if (mem && now - mem.timestamp < ANIME_CACHE_TTL_MS) {
      return mem.value;
    }
    const sess = readSessionCache<any[]>(`anime_chars_${key}`, ANIME_CACHE_TTL_MS);
    if (sess !== undefined) {
      charactersCache.set(key, { timestamp: now, value: sess });
      return sess;
    }
    const existingPromise = charactersInFlight.get(key);
    if (existingPromise) {
      return existingPromise;
    }
  }

  const promise = (async () => {
    try {
      const result = await ipcSafe.invoke('get-anime-characters', { id, source });
      if (!result || result.mocked) return [];
      
      let chars: any[] = [];
      if (result.source === 'mal' && Array.isArray(result.data)) {
        chars = result.data.map((item: any) => ({
          id: item.character.mal_id,
          name: item.character.name,
          original_name: item.character.name,
          image: item.character.images?.jpg?.image_url || ''
        }));
      } else if (Array.isArray(result.data)) {
        chars = result.data
          .filter((role: any) => role && role.character)
          .map((role: any) => ({
            id: role.character.id,
            name: role.character.russian || role.character.name,
            original_name: role.character.name,
            image: role.character.image && !isShikimoriPlaceholder(role.character.image.original) 
              ? `https://shikimori.io${role.character.image.original}` 
              : ''
          }));
      }

      if (chars.length > 0) {
        charactersCache.set(key, { timestamp: Date.now(), value: chars });
        writeSessionCache(`anime_chars_${key}`, chars);
      }
      return chars;
    } catch (error) {
      console.error('Error fetching anime characters via IPC:', error);
      return [];
    } finally {
      charactersInFlight.delete(key);
    }
  })();

  charactersInFlight.set(key, promise);
  return promise;
};

export const getNextEpisodeDate = async (title: string, forceRefresh = false): Promise<string | null> => {
  const normalizedTitle = (title || '').trim().toLowerCase();
  if (!normalizedTitle) return null;
  const now = Date.now();

  if (!forceRefresh) {
    const mem = nextEpisodeDateCache.get(normalizedTitle);
    if (mem && now - mem.timestamp < ANIME_CACHE_TTL_MS) {
      return mem.value;
    }
    const sess = readSessionCache<string | null>(`anime_next_ep_${normalizedTitle}`, ANIME_CACHE_TTL_MS);
    if (sess !== undefined) {
      nextEpisodeDateCache.set(normalizedTitle, { timestamp: now, value: sess });
      return sess;
    }
    const existingPromise = nextEpisodeDateInFlight.get(normalizedTitle);
    if (existingPromise) {
      return existingPromise;
    }
  }

  const promise = (async () => {
    try {
      const result = await ipcSafe.invoke('get-next-episode-date', { title });
      if (result && typeof result === 'object' && result.mocked) {
        return null;
      }
      const dateStr = typeof result === 'string' ? result : null;
      nextEpisodeDateCache.set(normalizedTitle, { timestamp: Date.now(), value: dateStr });
      writeSessionCache(`anime_next_ep_${normalizedTitle}`, dateStr);
      return dateStr;
    } catch (error) {
      console.error('Error fetching next episode date via IPC:', error);
      return null;
    } finally {
      nextEpisodeDateInFlight.delete(normalizedTitle);
    }
  })();

  nextEpisodeDateInFlight.set(normalizedTitle, promise);
  return promise;
};

export const getCachedTrackerNewEpisode = (project: Project): { hit: boolean; value: number | null } => {
  const currentMaxEp = project.episodes?.reduce((max, ep) => Math.max(max, ep.number), 0) || 0;
  const key = `${project.id}:${currentMaxEp}`;
  const now = Date.now();

  const mem = trackerEpisodeCache.get(key);
  if (mem && now - mem.timestamp < TRACKER_CACHE_TTL_MS) {
    return { hit: true, value: mem.value };
  }

  const sess = readSessionCache<number | null>(`anime_tracker_${key}`, TRACKER_CACHE_TTL_MS);
  if (sess !== undefined) {
    trackerEpisodeCache.set(key, { timestamp: now, value: sess });
    return { hit: true, value: sess };
  }

  return { hit: false, value: null };
};

export const checkNewEpisodesForProject = async (project: Project, forceRefresh = false): Promise<number | null> => {
  if (!project || !project.id) return null;
  const currentMaxEp = project.episodes?.reduce((max, ep) => Math.max(max, ep.number), 0) || 0;
  const key = `${project.id}:${currentMaxEp}`;

  if (!forceRefresh) {
    const cached = getCachedTrackerNewEpisode(project);
    if (cached.hit) {
      return cached.value;
    }
    const inFlight = trackerEpisodeInFlight.get(key);
    if (inFlight) {
      return inFlight;
    }
  }

  const promise = (async (): Promise<number | null> => {
    try {
      let foundNewEpisode: number | null = null;
      try {
        const checkRes = await ipcSafe.invoke('anime365-check-new-episodes', { projectId: project.id });
        if (checkRes && typeof checkRes.maxEpisode === 'number') {
          if (checkRes.maxEpisode > currentMaxEp) {
            foundNewEpisode = checkRes.maxEpisode;
          }
          trackerEpisodeCache.set(key, { timestamp: Date.now(), value: foundNewEpisode });
          writeSessionCache(`anime_tracker_${key}`, foundNewEpisode);
          return foundNewEpisode;
        }
      } catch (err) {
        // Fallback to Nyaa below if originalTitle is present
      }

      if (project.originalTitle) {
        try {
          const results = await ipcSafe.invoke('search-nyaa-torrents', {
            query: project.originalTitle,
            category: 'anime',
            subCategory: 'raw'
          });
          if (results && Array.isArray(results) && results.length > 0) {
            let maxEpFound = 0;
            for (const r of results) {
              const match = r.title ? r.title.match(/[ -_]0*([1-9]\d*)[ -_xv]/i) : null;
              if (match) {
                const ep = parseInt(match[1], 10);
                if (ep > maxEpFound && ep < 1000) maxEpFound = ep;
              }
            }
            if (maxEpFound > currentMaxEp) {
              foundNewEpisode = maxEpFound;
            }
          }
        } catch (nyaaErr) {
          // Ignore Nyaa fallback error
        }
      }

      trackerEpisodeCache.set(key, { timestamp: Date.now(), value: foundNewEpisode });
      writeSessionCache(`anime_tracker_${key}`, foundNewEpisode);
      return foundNewEpisode;
    } finally {
      trackerEpisodeInFlight.delete(key);
    }
  })();

  trackerEpisodeInFlight.set(key, promise);
  return promise;
};

export const checkServicesStatusCached = async (
  forceRefresh = false
): Promise<Record<string, { status: string; latency: number; error?: string }> | null> => {
  const now = Date.now();
  if (!forceRefresh) {
    if (servicesStatusCache && now - servicesStatusCache.timestamp < SERVICES_STATUS_TTL_MS) {
      return servicesStatusCache.value;
    }
    const sess = readSessionCache<Record<string, { status: string; latency: number; error?: string }>>(
      'anime_services_status',
      SERVICES_STATUS_TTL_MS
    );
    if (sess) {
      servicesStatusCache = { timestamp: now, value: sess };
      return sess;
    }
    if (servicesStatusInFlight) {
      return servicesStatusInFlight;
    }
  }

  servicesStatusInFlight = ipcSafe
    .invoke('check-services-status')
    .then((res: Record<string, { status: string; latency: number; error?: string }> | null) => {
      if (res && typeof res === 'object') {
        servicesStatusCache = { timestamp: Date.now(), value: res };
        writeSessionCache('anime_services_status', res);
      }
      return res;
    })
    .finally(() => {
      servicesStatusInFlight = null;
    });

  return servicesStatusInFlight;
};


