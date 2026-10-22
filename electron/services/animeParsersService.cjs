const axios = require('axios');

const SHIKIMORI_API = 'https://shikimori.io/api';
const ANILIBRIA_API = 'https://anilibria.top/api/v1';
const KODIK_API = 'https://kodik-api.com';

const DEFAULT_KODIK_TOKENS = [
  'q8b584d43e59530514112520619280a',
  '4b0870942a17a9436bb56715b94f6f96',
  'e0741270b2c1533034945fb4ba4faad8',
  '00e4ba0f40d164539828464fe461ec4f',
  '383c270d18256192eb63ad3c3f416fd5'
];

const http = axios.create({
  timeout: 7000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*'
  }
});

/**
 * Normalizes title into standard URL slug for Jut.su, AnimeGO, etc.
 */
function slugify(text) {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Search anime on Shikimori.io (Returns Russian title, English name, poster, episodes, ID)
 */
async function searchShikimori(query) {
  if (!query || !query.trim()) return [];
  try {
    const res = await http.get(`${SHIKIMORI_API}/animes`, {
      params: { search: query.trim(), limit: 8 }
    });
    if (!Array.isArray(res.data)) return [];
    return res.data.map(item => ({
      id: item.id,
      name: item.name,
      russian: item.russian || item.name,
      url: `https://shikimori.io${item.url}`,
      watchUrl: `https://shikimori.io/animes/${item.id}-${slugify(item.name || item.russian)}/watch`,
      episodes: item.episodes || 0,
      episodesAired: item.episodes_aired || 0,
      status: item.status,
      kind: item.kind,
      score: item.score,
      poster: item.image?.original ? `https://shikimori.io${item.image.original}` : null
    }));
  } catch (err) {
    console.warn('[AnimeParsers] Shikimori search error:', err.message);
    return [];
  }
}

/**
 * Fetch external links for Shikimori ID (discovers Fansubs.ru, Kinopoisk, World-Art, etc.)
 */
async function getShikimoriExternalLinks(shikimoriId) {
  if (!shikimoriId) return [];
  try {
    const res = await http.get(`${SHIKIMORI_API}/animes/${shikimoriId}/external_links`);
    if (!Array.isArray(res.data)) return [];
    return res.data;
  } catch (err) {
    console.warn(`[AnimeParsers] Shikimori external links error for ID ${shikimoriId}:`, err.message);
    return [];
  }
}

/**
 * Search release on AniLibria API v1 (anilibria.top)
 */
async function searchAniLibria(query) {
  if (!query || !query.trim()) return [];
  try {
    const res = await http.get(`${ANILIBRIA_API}/app/search/releases`, {
      params: { query: query.trim() }
    });
    const items = Array.isArray(res.data) ? res.data : Object.values(res.data || {});
    return items.map(item => ({
      id: item.id,
      alias: item.alias,
      titleRu: item.name?.main || '',
      titleEn: item.name?.english || '',
      year: item.year,
      season: item.season?.description || '',
      type: item.type?.description || item.type?.value || '',
      shikimoriId: item.shikimori?.id || null,
      shikimoriUrl: item.shikimori?.url || null,
      webUrl: `https://anilibria.top/anime-releases/${item.alias}.html`,
      altWebUrl: `https://anilibria.tv/release/${item.alias}.html`,
      poster: item.poster?.optimized?.src ? `https://anilibria.top${item.poster.optimized.src}` : null
    }));
  } catch (err) {
    console.warn('[AnimeParsers] AniLibria search error:', err.message);
    return [];
  }
}

/**
 * Get detailed AniLibria release including all episode direct HLS video streams and torrents
 */
async function getAniLibriaReleaseDetails(idOrAlias) {
  if (!idOrAlias) return null;
  try {
    const res = await http.get(`${ANILIBRIA_API}/anime/releases/${idOrAlias}`);
    const data = res.data;
    if (!data || !data.id) return null;

    const episodes = Array.isArray(data.episodes) ? data.episodes.map(ep => ({
      id: ep.id,
      ordinal: ep.ordinal,
      name: ep.name || `Серия ${ep.ordinal}`,
      nameEn: ep.name_english || null,
      duration: ep.duration || null,
      opening: ep.opening || null,
      ending: ep.ending || null,
      streams: {
        fhd: ep.hls_1080 || null,
        hd: ep.hls_720 || null,
        sd: ep.hls_480 || null
      }
    })) : [];

    const torrents = Array.isArray(data.torrents) ? data.torrents.map(t => ({
      id: t.id,
      hash: t.hash,
      magnet: t.magnet || (t.hash ? `magnet:?xt=urn:btih:${t.hash}` : null),
      quality: t.quality?.value || t.quality?.description || 'HD',
      series: t.series?.string || null,
      size: t.size || null,
      fileUrl: `https://anilibria.top/api/v1/anime/torrents/${t.id}/file`
    })) : [];

    return {
      id: data.id,
      alias: data.alias,
      titleRu: data.name?.main || '',
      titleEn: data.name?.english || '',
      shikimoriId: data.shikimori?.id || null,
      shikimoriUrl: data.shikimori?.url || null,
      webUrl: `https://anilibria.top/anime-releases/${data.alias}.html`,
      altWebUrl: `https://anilibria.tv/release/${data.alias}.html`,
      episodesTotal: data.episodes_total || episodes.length,
      episodes,
      torrents
    };
  } catch (err) {
    console.warn(`[AnimeParsers] AniLibria release details error for ${idOrAlias}:`, err.message);
    return null;
  }
}

/**
 * Search Kodik database by Shikimori ID and/or title
 */
async function searchKodik({ title, shikimoriId, userToken }) {
  const tokensToTry = userToken ? [userToken, ...DEFAULT_KODIK_TOKENS] : DEFAULT_KODIK_TOKENS;

  for (const token of tokensToTry) {
    try {
      const params = {
        token,
        with_episodes: 'true',
        with_material_data: 'true',
        limit: 15
      };
      if (shikimoriId) {
        params.shikimori_id = shikimoriId;
      } else if (title) {
        params.title = title;
      } else {
        return [];
      }

      const res = await http.get(`${KODIK_API}/search`, { params });
      if (res.data && Array.isArray(res.data.results) && res.data.results.length > 0) {
        return res.data.results.map(item => {
          const seasons = item.seasons || {};
          return {
            id: item.id,
            title: item.title,
            titleOrig: item.title_orig,
            translation: item.translation || { id: null, title: 'Оригинал', type: 'voice' },
            link: item.link?.startsWith('//') ? `https:${item.link}` : item.link,
            quality: item.quality,
            episodesCount: item.episodes_count || 1,
            lastEpisode: item.last_episode || 1,
            shikimoriId: item.shikimori_id,
            seasons
          };
        });
      }
    } catch (err) {
      // Try next token
    }
  }
  return [];
}

/**
 * Parses Jut.su episode page and extracts available MP4 direct streams and official episode URL
 */
async function parseJutSuEpisode(titleOrSlug, episodeNum = 1) {
  const slug = slugify(titleOrSlug);
  if (!slug) return null;

  const episodeUrl = `https://jut.su/${slug}/episode-${episodeNum}.html`;
  const seasonEpisodeUrl = `https://jut.su/${slug}/season-1/episode-${episodeNum}.html`;
  const seriesMainUrl = `https://jut.su/${slug}/`;

  // Try direct episode URL first
  const urlsToTry = [episodeUrl, seasonEpisodeUrl];

  for (const targetUrl of urlsToTry) {
    try {
      const res = await http.get(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (res.status === 200 && res.data) {
        const html = res.data;
        const videoSources = [];
        const sourceMatches = [...html.matchAll(/<source[^>]+src=["']([^"']+)["'][^>]*res=["']?([0-9]+)["']?/gi)];

        for (const m of sourceMatches) {
          const src = m[1];
          const resNum = m[2];
          // Filter placeholder pixels
          if (!src.includes('pixel.png')) {
            videoSources.push({
              quality: `${resNum}p`,
              url: src,
              type: 'mp4'
            });
          }
        }

        return {
          pageUrl: targetUrl,
          mainUrl: seriesMainUrl,
          sources: videoSources,
          found: true
        };
      }
    } catch (err) {
      // Try next variant
    }
  }

  return {
    pageUrl: episodeUrl,
    mainUrl: seriesMainUrl,
    sources: [],
    found: false
  };
}

/**
 * Builds AnimeGO release and search links
 */
function getAnimegoLinks(title, originalTitle) {
  const mainTitle = title || originalTitle || '';
  const slug = slugify(originalTitle || title);
  return {
    searchUrl: `https://animego.org/search/anime?q=${encodeURIComponent(mainTitle)}`,
    seriesUrl: slug ? `https://animego.org/anime/${slug}` : null
  };
}

/**
 * Master Aggregator: Searches all platforms from YaNesyTortiK/AnimeParsers
 * (AniLibria, Shikimori, Kodik, Jut.su, AnimeGO, Fansubs.ru)
 * to provide:
 * 1. videoSources: Direct streams & players
 * 2. subtitleSources: Direct ASS/SRT/VTT links & platforms
 * 3. releaseLinks: Automatically filled URLs for the release assembly
 */
async function searchAllSources({ title, originalTitle, episodeNumber = 1, shikimoriId, userKodikToken }) {
  const searchQuery = originalTitle || title || '';
  const epNum = Number(episodeNumber) || 1;

  console.log(`[AnimeParsers] Running unified source search for "${searchQuery}" (ep: ${epNum})...`);

  // Run initial discovery in parallel
  const [shikiResults, anilibriaResults] = await Promise.all([
    searchShikimori(searchQuery).catch(() => []),
    searchAniLibria(searchQuery).catch(() => [])
  ]);

  // Primary matches
  const shikiMatch = shikiResults[0] || null;
  const effectiveShikiId = shikimoriId || shikiMatch?.id || anilibriaResults[0]?.shikimoriId || null;

  // Secondary queries using effective IDs and aliases
  const [shikiLinks, anilibriaDetails, kodikResults, jutsuData] = await Promise.all([
    effectiveShikiId ? getShikimoriExternalLinks(effectiveShikiId).catch(() => []) : Promise.resolve([]),
    anilibriaResults[0] ? getAniLibriaReleaseDetails(anilibriaResults[0].alias || anilibriaResults[0].id).catch(() => null) : Promise.resolve(null),
    searchKodik({ title: searchQuery, shikimoriId: effectiveShikiId, userToken: userKodikToken }).catch(() => []),
    parseJutSuEpisode(anilibriaResults[0]?.alias || originalTitle || title, epNum).catch(() => null)
  ]);

  // 1. Build aggregated Release Links
  const releaseLinks = {};

  // Shikimori
  if (shikiMatch?.url || anilibriaResults[0]?.shikimoriUrl) {
    releaseLinks['shikimori'] = shikiMatch?.url || anilibriaResults[0]?.shikimoriUrl;
  } else if (effectiveShikiId) {
    releaseLinks['shikimori'] = `https://shikimori.io/animes/${effectiveShikiId}`;
  }

  // AniLibria
  if (anilibriaDetails?.webUrl || anilibriaResults[0]?.webUrl) {
    releaseLinks['anilibria'] = anilibriaDetails?.webUrl || anilibriaResults[0]?.webUrl;
  }

  // Kodik
  if (kodikResults.length > 0) {
    const firstKodik = kodikResults[0];
    let epLink = firstKodik.link;
    // Check if episode specific link exists in seasons
    if (firstKodik.seasons) {
      for (const seasonKey of Object.keys(firstKodik.seasons)) {
        const epObj = firstKodik.seasons[seasonKey]?.episodes;
        if (epObj && (epObj[epNum] || epObj[String(epNum)])) {
          const rawEpLink = epObj[epNum] || epObj[String(epNum)];
          epLink = rawEpLink.startsWith('//') ? `https:${rawEpLink}` : rawEpLink;
          break;
        }
      }
    }
    releaseLinks['kodik'] = epLink;
  }

  // Jut.su
  if (jutsuData?.pageUrl) {
    releaseLinks['jutsu'] = jutsuData.pageUrl;
  }

  // AnimeGO
  const animego = getAnimegoLinks(title, originalTitle);
  if (animego.seriesUrl) {
    releaseLinks['animego'] = animego.seriesUrl;
  }

  // External links discovered through Shikimori
  if (Array.isArray(shikiLinks)) {
    shikiLinks.forEach(link => {
      if (link.kind === 'kage_project' && link.url) {
        releaseLinks['fansubs'] = link.url;
      } else if (link.kind === 'kinopoisk' && link.url) {
        releaseLinks['kinopoisk'] = link.url;
      } else if (link.kind === 'world_art' && link.url) {
        releaseLinks['worldart'] = link.url;
      } else if (link.kind === 'myanimelist' && link.url) {
        releaseLinks['mal'] = link.url;
      } else if (link.kind === 'official_site' && link.url) {
        releaseLinks['official'] = link.url;
      }
    });
  }

  // 2. Build aggregated Video Sources (for preview, playback & direct import)
  const videoSources = [];

  // A. AniLibria direct HLS streams
  if (anilibriaDetails?.episodes) {
    const matchedEp = anilibriaDetails.episodes.find(e => e.ordinal === epNum) || anilibriaDetails.episodes[0];
    if (matchedEp && matchedEp.streams) {
      if (matchedEp.streams.fhd) {
        videoSources.push({
          id: `anilibria-1080-${epNum}`,
          platform: 'anilibria',
          platformLabel: 'AniLibria (1080p FHD HLS)',
          quality: '1080p',
          type: 'hls',
          streamUrl: matchedEp.streams.fhd,
          pageUrl: anilibriaDetails.webUrl,
          episodeName: matchedEp.name
        });
      }
      if (matchedEp.streams.hd) {
        videoSources.push({
          id: `anilibria-720-${epNum}`,
          platform: 'anilibria',
          platformLabel: 'AniLibria (720p HD HLS)',
          quality: '720p',
          type: 'hls',
          streamUrl: matchedEp.streams.hd,
          pageUrl: anilibriaDetails.webUrl,
          episodeName: matchedEp.name
        });
      }
      if (matchedEp.streams.sd) {
        videoSources.push({
          id: `anilibria-480-${epNum}`,
          platform: 'anilibria',
          platformLabel: 'AniLibria (480p SD HLS)',
          quality: '480p',
          type: 'hls',
          streamUrl: matchedEp.streams.sd,
          pageUrl: anilibriaDetails.webUrl,
          episodeName: matchedEp.name
        });
      }
    }
  }

  // B. Jut.su direct MP4 streams
  if (jutsuData?.sources && jutsuData.sources.length > 0) {
    jutsuData.sources.forEach((src, idx) => {
      videoSources.push({
        id: `jutsu-${src.quality}-${idx}`,
        platform: 'jutsu',
        platformLabel: `Jut.su (${src.quality} MP4)`,
        quality: src.quality,
        type: 'mp4',
        streamUrl: src.url,
        pageUrl: jutsuData.pageUrl
      });
    });
  }

  // C. Kodik players and translations
  kodikResults.forEach((k, idx) => {
    let epLink = k.link;
    if (k.seasons) {
      for (const sKey of Object.keys(k.seasons)) {
        const epObj = k.seasons[sKey]?.episodes;
        if (epObj && (epObj[epNum] || epObj[String(epNum)])) {
          const raw = epObj[epNum] || epObj[String(epNum)];
          epLink = raw.startsWith('//') ? `https:${raw}` : raw;
          break;
        }
      }
    }

    const isSub = k.translation?.type === 'subtitles' || (k.translation?.title || '').toLowerCase().includes('субтитр');
    videoSources.push({
      id: `kodik-${k.id || idx}`,
      platform: 'kodik',
      platformLabel: `Kodik: ${k.translation?.title || 'Плеер'} (${isSub ? 'Субтитры' : 'Озвучка'})`,
      quality: k.quality || '720p',
      type: 'embed',
      streamUrl: epLink,
      pageUrl: epLink,
      isSubtitles: isSub
    });
  });

  // D. Shikimori Watch embed player
  if (shikiMatch?.watchUrl) {
    videoSources.push({
      id: 'shikimori-watch',
      platform: 'shikimori',
      platformLabel: 'Shikimori Онлайн Плеер',
      quality: 'HD',
      type: 'embed',
      streamUrl: shikiMatch.watchUrl,
      pageUrl: shikiMatch.watchUrl
    });
  }

  // 3. Build Subtitle Sources
  const subtitleSources = [];

  // Kodik Subtitle Translations
  kodikResults
    .filter(k => k.translation?.type === 'subtitles' || (k.translation?.title || '').toLowerCase().includes('субтитр'))
    .forEach((k, idx) => {
      subtitleSources.push({
        id: `kodik-sub-${idx}`,
        platform: 'kodik',
        label: `Kodik: ${k.translation?.title || 'Русские субтитры'}`,
        url: k.link,
        type: 'player_stream',
        lang: 'ru'
      });
    });

  // Fansubs.ru / Kage Project
  if (releaseLinks['fansubs']) {
    subtitleSources.push({
      id: 'fansubs-ru',
      platform: 'fansubs',
      label: 'Fansubs.ru (Kage Project Русские субтитры)',
      url: releaseLinks['fansubs'],
      type: 'web_portal',
      lang: 'ru'
    });
  }

  // AniLibria subtitles / softsubs note
  if (anilibriaDetails) {
    subtitleSources.push({
      id: 'anilibria-sub',
      platform: 'anilibria',
      label: 'AniLibria Оригинальная дорожка + субтитры',
      url: anilibriaDetails.webUrl,
      type: 'web_portal',
      lang: 'ru'
    });
  }

  // Shikimori Watch with Subtitles
  if (shikiMatch?.watchUrl) {
    subtitleSources.push({
      id: 'shikimori-subs',
      platform: 'shikimori',
      label: 'Shikimori субтитры плееры',
      url: shikiMatch.watchUrl,
      type: 'player_stream',
      lang: 'ru'
    });
  }

  return {
    query: searchQuery,
    episodeNumber: epNum,
    animeInfo: {
      titleRu: shikiMatch?.russian || anilibriaResults[0]?.titleRu || title,
      titleEn: shikiMatch?.name || anilibriaResults[0]?.titleEn || originalTitle,
      poster: shikiMatch?.poster || anilibriaResults[0]?.poster || null,
      shikimoriId: effectiveShikiId,
      status: shikiMatch?.status || null,
      episodesTotal: shikiMatch?.episodes || anilibriaDetails?.episodesTotal || null
    },
    releaseLinks,
    videoSources,
    subtitleSources,
    torrents: anilibriaDetails?.torrents || []
  };
}

module.exports = {
  searchShikimori,
  getShikimoriExternalLinks,
  searchAniLibria,
  getAniLibriaReleaseDetails,
  searchKodik,
  parseJutSuEpisode,
  getAnimegoLinks,
  searchAllSources
};
