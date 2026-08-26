import { ipcSafe } from '../lib/ipcSafe';

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

export const getAnimeDetails = async (id: number, source: string = 'shikimori') => {
  try {
    const result = await ipcSafe.invoke('get-anime-details', { id, source });
    if (!result || !result.data) return null;
    if (result && result.mocked) return null;
    
    if (result.source === 'mal') {
      const anime = result.data;
      const shikimoriData = result.shikimoriData;
      
      const shikimoriImageOriginal = shikimoriData?.image?.original;
      const finalImageOriginal = (shikimoriImageOriginal && !isShikimoriPlaceholder(shikimoriImageOriginal)) 
        ? `https://shikimori.io${shikimoriImageOriginal}` 
        : (anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url);

      return {
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
    }

    const data = result.data;
    const isPlaceholder = isShikimoriPlaceholder(data.image?.original);
    return {
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
  } catch (error) {
    console.error('Error fetching anime details via IPC:', error);
  }
  return null;
};

export const getAnimeCharacters = async (id: number, source: string = 'shikimori') => {
  try {
    const result = await ipcSafe.invoke('get-anime-characters', { id, source });
    if (result && result.mocked) return [];
    
    if (result.source === 'mal') {
      return result.data.map((item: any) => ({
        id: item.character.mal_id,
        name: item.character.name,
        original_name: item.character.name,
        image: item.character.images?.jpg?.image_url || ''
      }));
    }

    const shikimoriChars = result.data;
    if (Array.isArray(shikimoriChars)) {
      return shikimoriChars
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
  } catch (error) {
    console.error('Error fetching anime characters via IPC:', error);
  }
  return [];
};

export const getNextEpisodeDate = async (title: string): Promise<string | null> => {
  try {
    const result = await ipcSafe.invoke('get-next-episode-date', { title });
    if (result && typeof result === 'object' && result.mocked) {
      return null;
    }
    return typeof result === 'string' ? result : null;
  } catch (error) {
    console.error('Error fetching next episode date via IPC:', error);
    return null;
  }
};

