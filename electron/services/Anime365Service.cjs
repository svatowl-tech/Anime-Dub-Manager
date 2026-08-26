const axios = require('axios');
const log = require('electron-log');

const MIRRORS = [
  'https://smotret-anime.app',
  'https://smotret-anime.ru',
  'https://smotret-anime-365.ru',
  'https://smotret-anime.org',
  'https://smotret-anime.com',
  'https://anime365.ru'
];

let activeApiBase = 'https://smotret-anime.app/api';
let lastCheckTime = 0;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes cache

const axiosInstance = axios.create({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Sec-CH-UA': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"'
  },
  timeout: 8000
});

/**
 * Returns the currently active, tested mirror's API base, testing with RTT ping on cache miss
 */
async function getActiveApiBase() {
  const now = Date.now();
  if (now - lastCheckTime < CACHE_DURATION) {
    return activeApiBase;
  }

  log.info('[Anime365Service] Testing mirrors to choose the most responsive host...');
  let fastestHost = 'https://smotret-anime.app';
  let minLatency = Infinity;

  const promises = MIRRORS.map(async (host) => {
    const startTime = Date.now();
    try {
      // Small query as a ping test
      const res = await axiosInstance.get(`${host}/api/series`, {
        params: { limit: 1 },
        timeout: 2000
      });
      if (res.status === 200) {
        const latency = Date.now() - startTime;
        return { host, latency, success: true };
      }
    } catch (e) {
      // Mirror timed out or is blocked on this network
    }
    return { host, latency: Infinity, success: false };
  });

  const testResults = await Promise.allSettled(promises);

  for (const res of testResults) {
    if (res.status === 'fulfilled' && res.value.success) {
      log.info(`[Anime365Service] Peer check: ${res.value.host} ping: ${res.value.latency}ms`);
      if (res.value.latency < minLatency) {
        minLatency = res.value.latency;
        fastestHost = res.value.host;
      }
    }
  }

  log.info(`[Anime365Service] Selected active mirror: ${fastestHost} with a ping of ${minLatency}ms`);
  activeApiBase = `${fastestHost}/api`;
  lastCheckTime = now;
  return activeApiBase;
}

/**
 * Replace URL hostname with target active mirror
 */
function replaceMirrorHost(urlStr, targetBase) {
  if (!urlStr) return urlStr;
  try {
    const targetUrl = new URL(targetBase);
    const parsedUrl = new URL(urlStr);
    
    // Identify if the host belongs to some of our mirrors or smotret/365 domains
    const isAnime365Url = MIRRORS.some(m => new URL(m).hostname === parsedUrl.hostname) || 
                          parsedUrl.hostname.includes('smotret-anime') || 
                          parsedUrl.hostname.includes('anime365');
                          
    if (isAnime365Url) {
      parsedUrl.protocol = targetUrl.protocol;
      parsedUrl.host = targetUrl.host;
      return parsedUrl.toString();
    }
  } catch (e) {
    // Relative URL or parse failure
  }
  return urlStr;
}

/**
 * Traverses an item recursively to patch all smotret/365 media and stream URLs to use the current mirror
 */
function patchItemUrls(item, activeHost) {
  if (!item) return item;
  
  if (Array.isArray(item)) {
    return item.map(i => patchItemUrls(i, activeHost));
  }
  
  if (typeof item === 'object') {
    const patched = { ...item };
    
    if (typeof patched.url === 'string') {
      patched.url = replaceMirrorHost(patched.url, activeHost);
    }
    if (typeof patched.embedUrl === 'string') {
      patched.embedUrl = replaceMirrorHost(patched.embedUrl, activeHost);
    }
    if (typeof patched.posterUrl === 'string') {
      patched.posterUrl = replaceMirrorHost(patched.posterUrl, activeHost);
    }
    if (typeof patched.posterUrlSmall === 'string') {
      patched.posterUrlSmall = replaceMirrorHost(patched.posterUrlSmall, activeHost);
    }
    if (typeof patched.fileUrl === 'string') {
      patched.fileUrl = replaceMirrorHost(patched.fileUrl, activeHost);
    }

    // Traverse details
    if (patched.episodes) patched.episodes = patchItemUrls(patched.episodes, activeHost);
    if (patched.translations) patched.translations = patchItemUrls(patched.translations, activeHost);
    if (patched.descriptions) patched.descriptions = patchItemUrls(patched.descriptions, activeHost);
    
    return patched;
  }
  
  return item;
}

/**
 * Get series by query parameters
 */
async function getSeries(parameters = {}) {
  try {
    const base = await getActiveApiBase();
    const response = await axiosInstance.get(`${base}/series`, { params: parameters });
    const data = response.data?.data || [];
    const activeHost = base.replace('/api', '');
    return patchItemUrls(data, activeHost);
  } catch (error) {
    log.error('[Anime365Service] Error in getSeries:', error.message);
    return [];
  }
}

/**
 * Get series by precise Anime 365 ID
 */
async function getSeriesByID(id, parameters = {}) {
  try {
    const base = await getActiveApiBase();
    const response = await axiosInstance.get(`${base}/series/${id}`, { params: parameters });
    const data = response.data?.data || null;
    const activeHost = base.replace('/api', '');
    return patchItemUrls(data, activeHost);
  } catch (error) {
    log.error(`[Anime365Service] Error in getSeriesByID for ID ${id}:`, error.message);
    return null;
  }
}

/**
 * Get translations by query parameters
 */
async function getTranslations(parameters = {}) {
  try {
    const base = await getActiveApiBase();
    const response = await axiosInstance.get(`${base}/translations`, { params: parameters });
    const data = response.data?.data || [];
    const activeHost = base.replace('/api', '');
    return patchItemUrls(data, activeHost);
  } catch (error) {
    log.error('[Anime365Service] Error in getTranslations:', error.message);
    return [];
  }
}

/**
 * Get translation details by ID
 */
async function getTranslationByID(id, parameters = {}) {
  try {
    const base = await getActiveApiBase();
    const response = await axiosInstance.get(`${base}/translations/${id}`, { params: parameters });
    const data = response.data?.data || null;
    const activeHost = base.replace('/api', '');
    return patchItemUrls(data, activeHost);
  } catch (error) {
    log.error(`[Anime365Service] Error in getTranslationByID for ID ${id}:`, error.message);
    return null;
  }
}

/**
 * Get episode details by ID
 */
async function getEpisodeByID(id, parameters = {}) {
  try {
    const base = await getActiveApiBase();
    const response = await axiosInstance.get(`${base}/episodes/${id}`, { params: parameters });
    const data = response.data?.data || null;
    const activeHost = base.replace('/api', '');
    return patchItemUrls(data, activeHost);
  } catch (error) {
    log.error(`[Anime365Service] Error in getEpisodeByID for ID ${id}:`, error.message);
    return null;
  }
}

/**
 * Automatically match an anime project title with Anime 365 series
 */
async function matchProjectToSeries(title, originalTitle) {
  const searchQueries = [originalTitle, title].filter(Boolean);
  for (const q of searchQueries) {
    log.info(`[Anime365Service] Attempting to match title "${q}"`);
    const results = await getSeries({ query: q, limit: 5 });
    if (results && results.length > 0) {
      // Find exact or closest title match
      const matched = results.find(s => {
        const lowerQ = q.toLowerCase();
        return (
          s.title?.toLowerCase() === lowerQ ||
          s.titles?.ru?.toLowerCase() === lowerQ ||
          s.titles?.romaji?.toLowerCase() === lowerQ ||
          s.titles?.en?.toLowerCase() === lowerQ ||
          s.titles?.ja?.toLowerCase() === lowerQ
        );
      }) || results[0]; // fallback to first result
      
      log.info(`[Anime365Service] Successfully matched "${q}" to series ID ${matched.id} (${matched.title})`);
      return matched;
    }
  }
  return null;
}

module.exports = {
  getSeries,
  getSeriesByID,
  getTranslations,
  getTranslationByID,
  getEpisodeByID,
  matchProjectToSeries,
  getActiveApiBase
};
