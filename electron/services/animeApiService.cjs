const axios = require('axios');

const SHIKIMORI_BASE = 'https://shikimori.io/api';
const JIKAN_BASE = 'https://api.jikan.moe/v4';

const axiosInstance = axios.create({
  headers: {
    'User-Agent': 'AnimeDubManager'
  }
});

// Configure retry for 429 Too Many Requests
axiosInstance.interceptors.response.use(null, async (error) => {
  const config = error.config;
  if (!config) return Promise.reject(error);
  
  if (error.response && error.response.status === 429) {
    config.__retryCount = config.__retryCount || 0;
    if (config.__retryCount < 3) {
      config.__retryCount += 1;
      const delay = 1000 * config.__retryCount;
      console.log(`Rate limited by API. Retrying in ${delay}ms... (Attempt ${config.__retryCount}/3)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return axiosInstance(config);
    }
  }
  return Promise.reject(error);
});

async function searchAnime(query) {
  try {
    const response = await axiosInstance.get(`${SHIKIMORI_BASE}/animes`, {
      params: {
        search: query,
        limit: 5
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error searching Shikimori in main process:', error.message);
    // Fallback to Jikan
    try {
      const response = await axiosInstance.get(`${JIKAN_BASE}/anime`, {
        params: {
          q: query,
          limit: 5
        }
      });
      return { source: 'mal', data: response.data.data };
    } catch (jikanError) {
      console.error('Error searching Jikan in main process:', jikanError.message);
      return [];
    }
  }
}

async function getAnimeDetails(id, source = 'shikimori') {
  let shikimoriData = null;
  if (source === 'shikimori') {
    try {
      const response = await axiosInstance.get(`${SHIKIMORI_BASE}/animes/${id}`);
      shikimoriData = response.data;
    } catch (error) {
      console.error('Error fetching Shikimori details in main process:', error.message);
    }
  }

  // Fallback to Jikan if needed
  if (!shikimoriData || !shikimoriData.description) {
    try {
      const malId = shikimoriData?.mal_id || id;
      const response = await axiosInstance.get(`${JIKAN_BASE}/anime/${malId}`);
      return { source: 'mal', data: response.data.data, shikimoriData };
    } catch (error) {
      console.error('Error fetching Jikan details in main process:', error.message);
    }
  }

  return { source: 'shikimori', data: shikimoriData };
}

async function getAnimeCharacters(id, source = 'shikimori') {
  let shikimoriChars = [];
  if (source === 'shikimori') {
    try {
      const response = await axiosInstance.get(`${SHIKIMORI_BASE}/animes/${id}/roles`);
      shikimoriChars = response.data;
    } catch (error) {
      console.error('Error fetching Shikimori characters in main process:', error.message);
    }
  }

  if (shikimoriChars.length === 0) {
    try {
      const response = await axiosInstance.get(`${JIKAN_BASE}/anime/${id}/characters`);
      return { source: 'mal', data: response.data.data };
    } catch (error) {
      console.error('Error fetching Jikan characters in main process:', error.message);
    }
  }

  return { source: 'shikimori', data: shikimoriChars };
}

async function getNextEpisodeDate(title) {
  if (!title) return null;
  let animeId = null;
  let originalName = '';
  let russianName = '';

  // 1. Try to find the anime on Shikimori to get its ID and names
  try {
    const searchRes = await axiosInstance.get(`${SHIKIMORI_BASE}/animes`, {
      params: {
        search: title,
        limit: 5
      }
    });
    if (searchRes.data && searchRes.data.length > 0) {
      // Find a close match
      const match = searchRes.data.find(a => 
        (a.name && a.name.toLowerCase() === title.toLowerCase()) ||
        (a.russian && a.russian.toLowerCase() === title.toLowerCase())
      ) || searchRes.data[0];

      animeId = match.id;
      originalName = match.name;
      russianName = match.russian;

      if (match.status === 'released') {
        return 'Вышел полностью';
      }
    }
  } catch (err) {
    console.error('Error searching Shikimori for calendar match:', err.message);
  }

  // 2. Query the calendar
  try {
    const calRes = await axiosInstance.get(`${SHIKIMORI_BASE}/calendar`);
    if (calRes.data && Array.isArray(calRes.data)) {
      // Try to find the calendar entry by ID first, then by title match
      let entry = null;
      if (animeId) {
        entry = calRes.data.find(e => e.anime && e.anime.id === animeId);
      }
      if (!entry && title) {
        entry = calRes.data.find(e => {
          if (!e.anime) return false;
          const searchLower = title.toLowerCase();
          return (e.anime.name && e.anime.name.toLowerCase() === searchLower) ||
                 (e.anime.russian && e.anime.russian.toLowerCase() === searchLower) ||
                 (originalName && e.anime.name && e.anime.name.toLowerCase() === originalName.toLowerCase()) ||
                 (russianName && e.anime.russian && e.anime.russian.toLowerCase() === russianName.toLowerCase());
        });
      }

      if (entry && entry.next_episode_at) {
        const nextEpNum = entry.next_episode;
        const airDate = new Date(entry.next_episode_at);
        if (!isNaN(airDate.getTime())) {
          // Format as DD.MM.YYYY HH:mm (or in Russian timezone)
          const pad = (num) => String(num).padStart(2, '0');
          const day = pad(airDate.getDate());
          const month = pad(airDate.getMonth() + 1);
          const year = airDate.getFullYear();
          const hours = pad(airDate.getHours());
          const minutes = pad(airDate.getMinutes());
          return `Серия ${nextEpNum}: ${day}.${month}.${year} ${hours}:${minutes}`;
        }
      }
    }
  } catch (err) {
    console.error('Error fetching/parsing Shikimori calendar:', err.message);
  }

  // 3. Fallback to Jikan schedule or details if needed
  try {
    const q = originalName || title;
    const jikanRes = await axiosInstance.get(`${JIKAN_BASE}/anime`, {
      params: { q, limit: 1 }
    });
    if (jikanRes.data && jikanRes.data.data && jikanRes.data.data.length > 0) {
      const anime = jikanRes.data.data[0];
      if (anime.status === 'Finished Airing') {
        return 'Вышел полностью';
      }
      // If airing, construct broadcast time if available
      if (anime.airing && anime.broadcast?.string) {
        return anime.broadcast.string; // e.g. "Saturdays at 23:00 (JST)"
      }
    }
  } catch (err) {
    console.error('Error in Jikan calendar fallback:', err.message);
  }

  return 'Не определена';
}

async function getEpisodeTitle(title, originalTitle, episodeNumber, anime365Id) {
  let matchedTitle = null;

  // 1. Try Anime365 first if ID is present
  if (anime365Id) {
    try {
      const Anime365Service = require('./Anime365Service.cjs');
      const seriesDetails = await Anime365Service.getSeriesByID(anime365Id);
      if (seriesDetails && seriesDetails.episodes && Array.isArray(seriesDetails.episodes)) {
        const targetEp = seriesDetails.episodes.find(ep => 
          String(ep.episode) === String(episodeNumber) || 
          ep.episodeInt === episodeNumber
        );
        if (targetEp) {
          matchedTitle = targetEp.title || targetEp.episodeTitle || targetEp.titleRussian || targetEp.titleRomaji;
          if (matchedTitle) {
            console.log(`[Episode Title] Found on Anime365 for ep ${episodeNumber}: ${matchedTitle}`);
            return matchedTitle;
          }
        }
      }
    } catch (e) {
      console.error(`[Episode Title] Error getting from Anime365 (id: ${anime365Id}):`, e.message);
    }
  }

  // 2. Try Jikan (MyAnimeList) fallback
  try {
    const q = originalTitle || title;
    if (q) {
      const jikanRes = await axiosInstance.get(`${JIKAN_BASE}/anime`, {
        params: { q, limit: 1 }
      });
      if (jikanRes.data && jikanRes.data.data && jikanRes.data.data.length > 0) {
        const malId = jikanRes.data.data[0].mal_id;
        if (malId) {
          // Fetch specific episode exactly
          try {
            const epRes = await axiosInstance.get(`${JIKAN_BASE}/anime/${malId}/episodes/${episodeNumber}`);
            if (epRes.data && epRes.data.data) {
              const epData = epRes.data.data;
              matchedTitle = epData.title || epData.title_romanji || epData.title_japanese;
              if (matchedTitle) {
                console.log(`[Episode Title] Found on Jikan for ep ${episodeNumber}: ${matchedTitle}`);
                return matchedTitle;
              }
            }
          } catch (e) {
            // Direct fetch sometimes fails if Jikan hasn't mapped the direct endpoint, fallback silently
            const episodesRes = await axiosInstance.get(`${JIKAN_BASE}/anime/${malId}/episodes`);
            if (episodesRes.data && episodesRes.data.data && Array.isArray(episodesRes.data.data)) {
              const epData = episodesRes.data.data.find(ep => ep.mal_id === episodeNumber || ep.episode_id === episodeNumber);
              if (epData) {
                matchedTitle = epData.title || epData.title_romanji || epData.title_japanese;
                if (matchedTitle) {
                  console.log(`[Episode Title] Found on Jikan (from list) for ep ${episodeNumber}: ${matchedTitle}`);
                  return matchedTitle;
                }
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error(`[Episode Title] Error fetching from Jikan for ${title}:`, err.message);
  }

  return null;
}

async function getEpisodesMetadata(title, originalTitle, anime365Id) {
  const metadataMap = {};

  // 1. Get from Anime365 if ID is present
  if (anime365Id) {
    try {
      const Anime365Service = require('./Anime365Service.cjs');
      const seriesDetails = await Anime365Service.getSeriesByID(anime365Id);
      if (seriesDetails && seriesDetails.episodes && Array.isArray(seriesDetails.episodes)) {
        for (const ep of seriesDetails.episodes) {
          const epNum = ep.episodeInt || parseInt(ep.episode);
          if (!epNum || isNaN(epNum)) continue;

          const epTitle = ep.title || ep.episodeTitle || ep.titleRussian || ep.titleRomaji;
          let calendarAiringDate = null;
          if (ep.created) {
            const d = new Date(ep.created);
            if (!isNaN(d.getTime())) {
              const pad = (num) => String(num).padStart(2, '0');
              calendarAiringDate = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
            }
          }

          metadataMap[epNum] = {
            title: epTitle || null,
            airingDate: calendarAiringDate || null
          };
        }
      }
    } catch (e) {
      console.error('[Episodes Metadata] Error getting from Anime365:', e.message);
    }
  }

  // 2. Query Jikan (MAL) as fallback & rich metadata source
  try {
    const q = originalTitle || title;
    if (q) {
      const jikanRes = await axiosInstance.get(`${JIKAN_BASE}/anime`, {
        params: { q, limit: 1 }
      });
      if (jikanRes.data && jikanRes.data.data && jikanRes.data.data.length > 0) {
        const malId = jikanRes.data.data[0].mal_id;
        if (malId) {
          const episodesRes = await axiosInstance.get(`${JIKAN_BASE}/anime/${malId}/episodes`);
          if (episodesRes.data && episodesRes.data.data && Array.isArray(episodesRes.data.data)) {
            for (const ep of episodesRes.data.data) {
              const epNum = ep.mal_id || ep.episode_id;
              if (!epNum) continue;

              const epTitle = ep.title || ep.title_romanji || ep.title_japanese;
              let calendarAiringDate = null;
              if (ep.aired) {
                const d = new Date(ep.aired);
                if (!isNaN(d.getTime())) {
                  const pad = (num) => String(num).padStart(2, '0');
                  calendarAiringDate = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
                }
              }

              if (!metadataMap[epNum]) {
                metadataMap[epNum] = {};
              }
              if (epTitle) metadataMap[epNum].title = epTitle;
              if (calendarAiringDate) metadataMap[epNum].airingDate = calendarAiringDate;
            }
          }
          
          // Fallback for explicitly missing titles in metadataMap (e.g. latest episode or paginated)
          const missingKeys = Object.entries(metadataMap).filter(([k, v]) => !v.title).map(([k]) => parseInt(k)).filter(n => !isNaN(n));
          if (missingKeys.length > 0 && missingKeys.length < 10) {
            for (const epNum of missingKeys) {
              try {
                const epRes = await axiosInstance.get(`${JIKAN_BASE}/anime/${malId}/episodes/${epNum}`);
                if (epRes.data && epRes.data.data) {
                  const epData = epRes.data.data;
                  const epTitle = epData.title || epData.title_romanji || epData.title_japanese;
                  if (epTitle) {
                    if (!metadataMap[epNum]) metadataMap[epNum] = {};
                    metadataMap[epNum].title = epTitle;
                  }
                }
                // Sleep to avoid rate limiting (Jikan is 3 req/sec)
                await new Promise(r => setTimeout(r, 340));
              } catch(e) {
                console.log(`[Episodes Metadata] Failed to fetch exact ep ${epNum} from Jikan`);
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[Episodes Metadata] Error fetching from Jikan:', err.message);
  }

  return metadataMap;
}

module.exports = {
  searchAnime,
  getAnimeDetails,
  getAnimeCharacters,
  getNextEpisodeDate,
  getEpisodeTitle,
  getEpisodesMetadata
};
