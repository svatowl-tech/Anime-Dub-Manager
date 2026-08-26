import React, { useState, useRef, useEffect } from 'react';
import { X, Plus, Loader2, Activity, User } from 'lucide-react';
import { searchAnime, getAnimeDetails, getAnimeCharacters } from '../../services/animeService';
import { ReleaseType } from '../../types';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (projectData: any) => void;
}

export default function CreateProjectModal({ isOpen, onClose, onCreate }: CreateProjectModalProps) {
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [newProjectOriginalTitle, setNewProjectOriginalTitle] = useState('');
  const [newProjectReleaseType, setNewProjectReleaseType] = useState<ReleaseType>('VOICEOVER');
  const [newProjectEmoji, setNewProjectEmoji] = useState('❤️');
  const [newProjectIsOngoing, setNewProjectIsOngoing] = useState(true);
  const [newProjectSynopsis, setNewProjectSynopsis] = useState('');
  const [newProjectPosterUrl, setNewProjectPosterUrl] = useState('');
  const [newProjectTypeAndSeason, setNewProjectTypeAndSeason] = useState('');
  const [newProjectTotalEpisodes, setNewProjectTotalEpisodes] = useState(12);
  const [newProjectCharacters, setNewProjectCharacters] = useState<{name: string, dubberId: string, photoUrl?: string}[]>([]);
  
  const [animeSearchQuery, setAnimeSearchQuery] = useState('');
  const [animeSearchResults, setAnimeSearchResults] = useState<any[]>([]);
  const [isSearchingAnime, setIsSearchingAnime] = useState(false);

  const animeSearchInputRef = useRef<HTMLInputElement>(null);
  const projectTitleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => animeSearchInputRef.current?.focus(), 100);
    } else {
      // Reset state when closed
      setNewProjectTitle('');
      setNewProjectOriginalTitle('');
      setNewProjectReleaseType('VOICEOVER');
      setNewProjectEmoji('❤️');
      setNewProjectIsOngoing(true);
      setNewProjectSynopsis('');
      setNewProjectPosterUrl('');
      setNewProjectTypeAndSeason('');
      setNewProjectTotalEpisodes(12);
      setNewProjectCharacters([]);
      setAnimeSearchQuery('');
      setAnimeSearchResults([]);
    }
  }, [isOpen]);

  const handleAnimeSearch = async () => {
    if (!animeSearchQuery.trim()) return;
    setIsSearchingAnime(true);
    const results = await searchAnime(animeSearchQuery);
    setAnimeSearchResults(results || []);
    setIsSearchingAnime(false);
  };

  const handleSelectAnime = async (anime: any) => {
    setNewProjectTitle(anime.title);
    
    const details = await getAnimeDetails(anime.mal_id, anime.source || 'shikimori');
    
    if (details) {
      setNewProjectOriginalTitle(details.original_title || '');
      setNewProjectSynopsis(details.description || '');
      setNewProjectPosterUrl(details.image || '');
      setNewProjectTotalEpisodes(details.episodes || 12);
      setNewProjectIsOngoing(details.status === 'Currently Airing' || details.status === 'ongoing');
      
      let typeSeason = details.type || '';
      if (details.season && details.year) {
        typeSeason += ` (${details.season} ${details.year})`;
      }
      setNewProjectTypeAndSeason(typeSeason);
    } else {
      setNewProjectOriginalTitle(anime.original_title || anime.title);
      setNewProjectPosterUrl(anime.image || '');
      setNewProjectTotalEpisodes(anime.episodes || 12);
      setNewProjectIsOngoing(anime.status === 'Currently Airing' || anime.status === 'ongoing');
      setNewProjectTypeAndSeason(anime.type || '');
    }

    setAnimeSearchResults([]);
    setAnimeSearchQuery('');

    const chars = await getAnimeCharacters(anime.mal_id, anime.source || 'shikimori');
    if (chars && chars.length > 0) {
      setNewProjectCharacters(chars.slice(0, 15).map((c: any) => ({
        name: c.name,
        dubberId: '',
        photoUrl: c.image
      })));
    }
  };

  const handleAddCharacter = () => {
    setNewProjectCharacters([...newProjectCharacters, { name: '', dubberId: '' }]);
    setTimeout(() => {
      const container = document.getElementById('character-list-container');
      if (container) container.scrollTop = container.scrollHeight;
    }, 50);
  };

  const handleUpdateCharacter = (index: number, name: string) => {
    const newChars = [...newProjectCharacters];
    newChars[index].name = name;
    setNewProjectCharacters(newChars);
  };

  const handleRemoveCharacter = (index: number) => {
    setNewProjectCharacters(newProjectCharacters.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectTitle.trim()) return;
    
    onCreate({
      title: newProjectTitle,
      originalTitle: newProjectOriginalTitle,
      releaseType: newProjectReleaseType,
      emoji: newProjectEmoji,
      isOngoing: newProjectIsOngoing,
      synopsis: newProjectSynopsis,
      posterUrl: newProjectPosterUrl,
      typeAndSeason: newProjectTypeAndSeason,
      totalEpisodes: newProjectTotalEpisodes,
      characters: newProjectCharacters
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col pointer-events-auto">
        <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Новый проект</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-left">
          {/* Anime Search Section */}
          <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800">
            <label className="block text-sm font-medium text-neutral-400 mb-2">Поиск в базе аниме (MAL)</label>
            <div className="flex gap-2">
              <input 
                ref={animeSearchInputRef}
                type="text" 
                value={animeSearchQuery} 
                onChange={(e) => setAnimeSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAnimeSearch();
                  e.stopPropagation();
                }}
                className="flex-1 bg-neutral-900 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                placeholder="Введите название для поиска..."
              />
              <button 
                type="button"
                onClick={handleAnimeSearch}
                disabled={isSearchingAnime}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
              >
                {isSearchingAnime ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                Найти
              </button>
            </div>
            
            {animeSearchResults?.length > 0 && (
              <div className="mt-4 space-y-2 max-h-40 overflow-y-auto pr-2">
                {animeSearchResults.map((anime, idx) => (
                  <button
                    key={(anime.mal_id || 'anime') + idx}
                    type="button"
                    onClick={() => handleSelectAnime(anime)}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-neutral-800 text-left transition-colors group"
                  >
                    <div className="relative w-10 h-14 flex-shrink-0 bg-neutral-900 rounded overflow-hidden">
                      <img 
                        src={anime.image || undefined} 
                        alt="" 
                        className="absolute inset-0 w-10 h-14 object-cover rounded z-10" 
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const next = e.currentTarget.nextSibling;
                          if (next && next instanceof HTMLElement) {
                            next.classList.remove('hidden');
                          }
                        }}
                      />
                      <div className="absolute inset-0 w-10 h-14 bg-neutral-900 text-neutral-600 flex items-center justify-center font-bold text-xs hidden">
                        🎬
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate group-hover:text-blue-400">{anime.title}</div>
                      <div className="text-xs text-neutral-500">{anime.type} • {anime.episodes || '?'} эп. • {anime.status}</div>
                    </div>
                    <Plus className="w-4 h-4 text-neutral-600 group-hover:text-blue-400" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Название аниме</label>
                <input 
                  ref={projectTitleInputRef}
                  type="text" 
                  value={newProjectTitle} 
                  onChange={(e) => setNewProjectTitle(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Напр: Твоё имя"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Оригинальное название</label>
                <input 
                  type="text" 
                  value={newProjectOriginalTitle} 
                  onChange={(e) => setNewProjectOriginalTitle(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Напр: Kimi no Na wa"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Тип релиза</label>
                <select 
                  value={newProjectReleaseType}
                  onChange={(e) => setNewProjectReleaseType(e.target.value as ReleaseType)}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                >
                  <option value="VOICEOVER">Закадр</option>
                  <option value="RECAST">Рекаст</option>
                  <option value="REDUB">Редаб</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Эмодзи</label>
                <input 
                  type="text" 
                  value={newProjectEmoji} 
                  onChange={(e) => setNewProjectEmoji(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                  placeholder="❤️"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Тип и Сезон</label>
                <input 
                  type="text" 
                  value={newProjectTypeAndSeason} 
                  onChange={(e) => setNewProjectTypeAndSeason(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                  placeholder="TV1, Movie..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Кол-во серий</label>
                <input 
                  type="number" 
                  value={newProjectTotalEpisodes} 
                  onChange={(e) => setNewProjectTotalEpisodes(parseInt(e.target.value) || 1)}
                  className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={newProjectIsOngoing} 
                  onChange={(e) => setNewProjectIsOngoing(e.target.checked)}
                  className="w-4 h-4 bg-neutral-950 border-neutral-800 rounded text-blue-600 focus:ring-blue-500/50"
                />
                <span className="text-sm text-neutral-300 group-hover:text-white transition-colors">Онгоинг (выходит сейчас)</span>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-2">Постер (URL)</label>
              <input 
                type="text" 
                value={newProjectPosterUrl} 
                onChange={(e) => setNewProjectPosterUrl(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50"
                placeholder="https://..."
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-neutral-300">Список персонажей (Character List)</label>
                <button 
                  type="button"
                  onClick={handleAddCharacter}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Добавить
                </button>
              </div>
                <div id="character-list-container" className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto p-1 scroll-smooth">
                  {newProjectCharacters.map((char, idx) => (
                    <div key={char.name || ('char-' + idx)} className="flex gap-2 group items-center">
                      <div className="relative w-8 h-8 flex-shrink-0">
                        {char.photoUrl ? (
                          <img 
                            src={char.photoUrl} 
                            alt="" 
                            className="absolute inset-0 w-8 h-8 rounded-full object-cover border border-neutral-800 z-10" 
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              const next = e.currentTarget.nextSibling;
                              if (next && next instanceof HTMLElement) {
                                next.classList.remove('hidden');
                              }
                            }}
                          />
                        ) : null}
                        <div className={`absolute inset-0 w-8 h-8 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-700 ${char.photoUrl ? 'hidden' : ''}`}>
                          <User className="w-4 h-4" />
                        </div>
                      </div>
                      <input 
                        type="text"
                        value={char.name}
                        onChange={(e) => handleUpdateCharacter(idx, e.target.value)}
                        placeholder="Имя персонажа"
                        className="flex-1 bg-neutral-950 border border-neutral-800 text-white rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-blue-500/50"
                      />
                      <button 
                        type="button"
                        onClick={() => handleRemoveCharacter(idx)}
                        className="text-neutral-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                {newProjectCharacters.length === 0 && (
                  <div className="col-span-full text-center py-4 text-xs text-neutral-500 italic border border-dashed border-neutral-800 rounded-lg">
                    Список пуст. Найдите аниме или добавьте вручную.
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-2">Описание (Синопсис)</label>
              <textarea 
                value={newProjectSynopsis} 
                onChange={(e) => setNewProjectSynopsis(e.target.value)}
                rows={4}
                className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500/50 resize-none text-sm"
                placeholder="Краткое описание сюжета..."
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button 
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg font-medium transition-colors"
              >
                Отмена
              </button>
              <button 
                type="submit"
                className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/20"
              >
                Создать проект
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
