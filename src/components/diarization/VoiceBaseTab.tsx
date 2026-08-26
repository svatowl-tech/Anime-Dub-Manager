import React, { useState, useEffect } from 'react';
import { Database, Plus, Trash2, Mic, Sparkles, RefreshCw } from 'lucide-react';
import { Episode, SubtitleLine } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { toast } from 'sonner';

interface VoiceBaseTabProps {
  currentEpisode: Episode | null;
  subLines: SubtitleLine[];
}

export const VoiceBaseTab: React.FC<VoiceBaseTabProps> = ({
  currentEpisode,
  subLines,
}) => {
  const [savedCharacters, setSavedCharacters] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [newCharName, setNewCharName] = useState('');
  const [startSec, setStartSec] = useState('');
  const [endSec, setEndSec] = useState('');
  const [isAddingManual, setIsAddingManual] = useState(false);

  const projectName = currentEpisode?.project?.title || currentEpisode?.projectId || 'default_project';

  const loadSavedCharacters = async () => {
    setIsLoading(true);
    try {
      const res = await ipcSafe.invoke('get-voice-base-characters', { projectName });
      if (res && res.success) {
        setSavedCharacters(res.characters || []);
      }
    } catch (err: any) {
      console.error('Error loading voice base:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSavedCharacters();
  }, [projectName]);

  const handleAutoTrain = async () => {
    if (!currentEpisode?.rawPath) {
      toast.error('Не найден видеофайл серии для извлечения аудио');
      return;
    }

    setIsTraining(true);
    try {
      const res = await ipcSafe.invoke('auto-train-voice-base', {
        projectName,
        videoPath: currentEpisode.rawPath,
        subtitleLines: subLines
      });

      if (res && res.success) {
        toast.success(`База обучена! Добавлено персонажей: ${res.count}`);
        await loadSavedCharacters();
      } else {
        toast.error(res?.error || 'Не удалось обучить базу голосов');
      }
    } catch (err: any) {
      console.error('Error auto-training voice base:', err);
      toast.error(`Ошибка обучения: ${err.message}`);
    } finally {
      setIsTraining(false);
    }
  };

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCharName.trim() || !startSec || !endSec) {
      toast.error('Заполните имя персонажа и интервал времени');
      return;
    }

    if (!currentEpisode?.rawPath) {
      toast.error('Не найден видеофайл серии');
      return;
    }

    const s = parseFloat(startSec);
    const end = parseFloat(endSec);
    if (isNaN(s) || isNaN(end) || end <= s) {
      toast.error('Некорректный интервал времени');
      return;
    }

    setIsAddingManual(true);
    try {
      const res = await ipcSafe.invoke('learn-voice-from-interval', {
        projectName,
        characterName: newCharName.trim(),
        videoPath: currentEpisode.rawPath,
        startSec: s,
        endSec: end
      });

      if (res && res.success) {
        toast.success(`Голосовой профиль для "${newCharName}" успешно сохранен!`);
        setNewCharName('');
        setStartSec('');
        setEndSec('');
        await loadSavedCharacters();
      } else {
        toast.error(res?.error || 'Ошибка при сохранении голосового профиля');
      }
    } catch (err: any) {
      console.error('Error adding voice print:', err);
      toast.error(`Ошибка: ${err.message}`);
    } finally {
      setIsAddingManual(false);
    }
  };

  const handleDeleteProfile = async (charName: string) => {
    try {
      const res = await ipcSafe.invoke('delete-voice-profile', {
        projectName,
        characterName: charName
      });

      if (res && res.success) {
        toast.success(`Профиль "${charName}" удален`);
        setSavedCharacters(prev => prev.filter(c => c !== charName));
      } else {
        toast.error('Не удалось удалить профиль');
      }
    } catch (err: any) {
      toast.error(`Ошибка при удалении: ${err.message}`);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full py-2">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-indigo-900/30 via-neutral-900 to-neutral-900 border border-indigo-500/20 rounded-2xl p-6 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400 shrink-0">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              База спектральных голосовых слепков (Voice Base)
            </h3>
            <p className="text-xs text-neutral-300 mt-1">
              Проект: <span className="font-semibold text-indigo-300">{projectName}</span>. Хранит акустические отпечатки персонажей для автоматического узнавания их голосов в новых сериях.
            </p>
          </div>
        </div>

        <button
          onClick={handleAutoTrain}
          disabled={isTraining || !currentEpisode?.rawPath}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-600/20 transition-all shrink-0 cursor-pointer"
        >
          {isTraining ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Обучение...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Обучить из текущей серии
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Saved Profiles List */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl flex flex-col space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-indigo-400" />
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                Сохраненные профили ({savedCharacters.length})
              </h4>
            </div>

            <button
              onClick={loadSavedCharacters}
              disabled={isLoading}
              className="text-neutral-400 hover:text-white transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 max-h-[360px] pr-1">
            {savedCharacters.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-neutral-800 rounded-xl text-neutral-500 text-xs">
                В базе пока нет голосовых профилей для этого проекта. Нажмите «Обучить из текущей серии» или добавьте вручную.
              </div>
            ) : (
              savedCharacters.map((char) => (
                <div
                  key={char}
                  className="flex items-center justify-between p-3 bg-neutral-950 border border-neutral-850 rounded-xl hover:border-neutral-700 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-xs border border-indigo-500/20">
                      {char.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs font-semibold text-white">{char}</span>
                  </div>

                  <button
                    onClick={() => handleDeleteProfile(char)}
                    className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Удалить профиль"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Manual Sample Extraction Form */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-neutral-800">
            <Plus className="w-4 h-4 text-indigo-400" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Добавить слепок вручную
            </h4>
          </div>

          <form onSubmit={handleAddManual} className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                Имя персонажа
              </label>
              <input
                type="text"
                placeholder="например: Танджиро"
                value={newCharName}
                onChange={(e) => setNewCharName(e.target.value)}
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                  Начало (сек)
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="12.5"
                  value={startSec}
                  onChange={(e) => setStartSec(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                  Конец (сек)
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="15.8"
                  value={endSec}
                  onChange={(e) => setEndSec(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
            </div>

            <p className="text-[11px] text-neutral-500">
              Совет: Выбирайте чистый фрагмент речи персонажа длительностью от 2 до 5 секунд без громкой музыки и фоновых шумов.
            </p>

            <button
              type="submit"
              disabled={isAddingManual}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold rounded-xl transition-colors border border-neutral-700 disabled:opacity-50 cursor-pointer"
            >
              {isAddingManual ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Извлечение слепка...
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5 text-indigo-400" />
                  Сохранить голосовой слепок
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
