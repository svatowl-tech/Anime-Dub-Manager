import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  BookOpen,
  UserCheck,
  Plus,
  Trash2,
  Search,
  Save,
  Sparkles,
  Check,
  Edit3,
  Globe,
  Folder,
} from 'lucide-react';
import { toast } from 'sonner';
import { Episode, SubtitleLine } from '../../types';
import {
  CharacterAgeGroup,
  CharacterEmotionTolerance,
  CharacterGenderTarget,
  CharacterPersonaProfile,
  StressDictionaryEntry,
} from '../../lib/qa/detector/missingLinesTypes';
import { qaActingService } from '../../services/qaActingService';
import { ipcSafe } from '../../lib/ipcSafe';

const RUSSIAN_VOWELS = new Set('аеёиоуыэюяАЕЁИОУЫЭЮЯ'.split(''));

function applyVowelStressAtIndex(word: string, targetIdx: number): string {
  return word
    .split('')
    .map((ch, idx) => (idx === targetIdx ? ch.toUpperCase() : ch.toLowerCase()))
    .join('');
}

interface QADictionaryAndProfilesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  episode?: Episode | null;
  subLines?: SubtitleLine[];
  initialTab?: 'stress' | 'profiles';
}

export const QADictionaryAndProfilesDrawer: React.FC<QADictionaryAndProfilesDrawerProps> = ({
  isOpen,
  onClose,
  episode,
  subLines = [],
  initialTab = 'stress',
}) => {
  const [activeTab, setActiveTab] = useState<'stress' | 'profiles'>(initialTab);
  const projectId = episode?.projectId || null;
  const projectName = episode?.project?.title || episode?.projectId || 'default_project';

  // --- Stress Dictionary state ---
  const [entries, setEntries] = useState<StressDictionaryEntry[]>([]);
  const [dictSearch, setDictSearch] = useState('');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [wordInput, setWordInput] = useState('');
  const [stressedForm, setStressedForm] = useState('');
  const [entryScope, setEntryScope] = useState<'project' | 'global'>('project');
  const [entryNotes, setEntryNotes] = useState('');
  const [isSavingEntry, setIsSavingEntry] = useState(false);

  // --- Character Profiles state ---
  const [profiles, setProfiles] = useState<CharacterPersonaProfile[]>([]);
  const [selectedChar, setSelectedChar] = useState('');
  const [customChar, setCustomChar] = useState('');
  const [ageGroup, setAgeGroup] = useState<CharacterAgeGroup>('any');
  const [expectedGender, setExpectedGender] = useState<CharacterGenderTarget>('any');
  const [targetF0MinHz, setTargetF0MinHz] = useState<string>('');
  const [targetF0MaxHz, setTargetF0MaxHz] = useState<string>('');
  const [emotionTolerance, setEmotionTolerance] = useState<CharacterEmotionTolerance>('standard');
  const [profileNotes, setProfileNotes] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isTrainingVoiceBase, setIsTrainingVoiceBase] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [dictRes, profRes] = await Promise.all([
        qaActingService.getStressDictionary(projectId),
        qaActingService.getCharacterProfiles(projectId),
      ]);
      setEntries(dictRes);
      setProfiles(profRes);
    } catch (e) {
      console.warn('Failed to load dictionary/profiles:', e);
    }
  }, [projectId]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      loadData();
    }
  }, [isOpen, initialTab, loadData]);

  const episodeCharacters = useMemo(() => {
    const names = new Set<string>();
    (episode?.assignments || []).forEach((a) => {
      if (a.characterName?.trim()) names.add(a.characterName.trim());
    });
    profiles.forEach((p) => {
      if (p.characterName?.trim()) names.add(p.characterName.trim());
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [episode?.assignments, profiles]);

  useEffect(() => {
    if (!selectedChar && episodeCharacters.length > 0) {
      setSelectedChar(episodeCharacters[0]);
    }
  }, [episodeCharacters, selectedChar]);

  // Populate profile editor when selectedChar changes
  useEffect(() => {
    const targetName = selectedChar === '__custom__' ? customChar.trim() : selectedChar.trim();
    if (!targetName) return;
    const match = profiles.find((p) => p.characterName.toLowerCase() === targetName.toLowerCase());
    if (match) {
      setAgeGroup(match.ageGroup || 'any');
      setExpectedGender(match.expectedGender || 'any');
      setTargetF0MinHz(match.targetF0MinHz ? String(match.targetF0MinHz) : '');
      setTargetF0MaxHz(match.targetF0MaxHz ? String(match.targetF0MaxHz) : '');
      setEmotionTolerance(match.emotionTolerance || 'standard');
      setProfileNotes(match.notes || '');
    } else {
      setAgeGroup('any');
      setExpectedGender('any');
      setTargetF0MinHz('');
      setTargetF0MaxHz('');
      setEmotionTolerance('standard');
      setProfileNotes('');
    }
  }, [selectedChar, customChar, profiles]);

  const handleWordInputChange = (val: string) => {
    setWordInput(val);
    if (!val.trim()) {
      setStressedForm('');
      return;
    }
    const hasUpperVowel = val.split('').some((ch) => ch === ch.toUpperCase() && RUSSIAN_VOWELS.has(ch));
    if (hasUpperVowel) {
      setStressedForm(val);
    } else {
      const firstVowelIdx = val.split('').findIndex((ch) => RUSSIAN_VOWELS.has(ch));
      setStressedForm(firstVowelIdx >= 0 ? applyVowelStressAtIndex(val, firstVowelIdx) : val);
    }
  };

  const handleSaveEntry = async () => {
    const cleanWord = wordInput.trim();
    const cleanStressed = (stressedForm || cleanWord).trim();
    if (!cleanWord) {
      toast.error('Введите слово для словаря ударений');
      return;
    }
    setIsSavingEntry(true);
    try {
      await qaActingService.saveStressEntry({
        id: editingEntryId || undefined,
        word: cleanWord.toLowerCase(),
        stressedForm: cleanStressed,
        scope: entryScope,
        projectId: entryScope === 'project' ? projectId : null,
        notes: entryNotes.trim() || undefined,
      });
      toast.success(`Сохранено в словарь: ${cleanStressed}`);
      setEditingEntryId(null);
      setWordInput('');
      setStressedForm('');
      setEntryNotes('');
      await loadData();
    } catch (e: any) {
      toast.error(`Ошибка сохранения: ${e?.message || e}`);
    } finally {
      setIsSavingEntry(false);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    try {
      await qaActingService.deleteStressEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      toast.success('Запись удалена');
    } catch (e: any) {
      toast.error(`Ошибка удаления: ${e?.message || e}`);
    }
  };

  const handleSaveProfile = async () => {
    const charName = selectedChar === '__custom__' ? customChar.trim() : selectedChar.trim();
    if (!charName) {
      toast.error('Укажите имя персонажа');
      return;
    }
    setIsSavingProfile(true);
    try {
      const minF0 = targetF0MinHz.trim() ? parseFloat(targetF0MinHz) : null;
      const maxF0 = targetF0MaxHz.trim() ? parseFloat(targetF0MaxHz) : null;
      await qaActingService.saveCharacterProfile({
        projectId,
        characterName: charName,
        ageGroup,
        expectedGender,
        targetF0MinHz: minF0 && !isNaN(minF0) ? minF0 : null,
        targetF0MaxHz: maxF0 && !isNaN(maxF0) ? maxF0 : null,
        emotionTolerance,
        notes: profileNotes.trim() || undefined,
      });
      toast.success(`Профиль персонажа «${charName}» сохранён`);
      await loadData();
    } catch (e: any) {
      toast.error(`Ошибка сохранения профиля: ${e?.message || e}`);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleTrainVoiceBaseV2 = async () => {
    if (!episode?.rawPath) {
      toast.error('У серии не привязан оригинальный видеофайл');
      return;
    }
    if (!subLines || subLines.length === 0) {
      toast.error('Отсутствуют субтитры для извлечения эталонов голосов');
      return;
    }
    setIsTrainingVoiceBase(true);
    try {
      const res = await ipcSafe.invoke('auto-train-voice-base', {
        projectName,
        videoPath: episode.rawPath,
        subtitleLines: subLines,
      });
      if (res && res.success) {
        toast.success(`База эталонов голосов (ECAPA + F0) обновлена! Персонажей: ${res.count || 0}`);
      } else {
        toast.error(res?.error || 'Не удалось обновить базу голосов');
      }
    } catch (e: any) {
      toast.error(`Ошибка обучения базы голосов: ${e?.message || e}`);
    } finally {
      setIsTrainingVoiceBase(false);
    }
  };

  const filteredEntries = useMemo(() => {
    const q = dictSearch.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.word.toLowerCase().includes(q) ||
        e.stressedForm.toLowerCase().includes(q) ||
        (e.notes || '').toLowerCase().includes(q)
    );
  }, [entries, dictSearch]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[125] flex justify-end bg-black/65 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg h-full bg-neutral-900 border-l border-neutral-800 flex flex-col text-neutral-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-white">Словарь ударений и профили ролей</h3>
            <p className="text-[11px] text-neutral-400">
              Локальные правила произношения и возраст/тембр персонажей для QA
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 border-b border-neutral-800 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('stress')}
            className={`px-3 py-2 text-xs font-medium border-b-2 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === 'stress'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Словарь ударений ({entries.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('profiles')}
            className={`px-3 py-2 text-xs font-medium border-b-2 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              activeTab === 'profiles'
                ? 'border-indigo-400 text-indigo-300'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Профили ролей ({profiles.length})</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 custom-scrollbar">
          {activeTab === 'stress' && (
            <>
              {/* Add / Edit Form */}
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-3.5 space-y-3">
                <div className="text-xs font-semibold text-neutral-200 flex items-center justify-between">
                  <span>{editingEntryId ? 'Редактировать слово' : 'Добавить ударение'}</span>
                  {editingEntryId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingEntryId(null);
                        setWordInput('');
                        setStressedForm('');
                        setEntryNotes('');
                      }}
                      className="text-[11px] text-neutral-400 hover:text-white"
                    >
                      Отмена
                    </button>
                  )}
                </div>

                <input
                  type="text"
                  value={wordInput}
                  onChange={(e) => handleWordInputChange(e.target.value)}
                  placeholder="Например: сасуке, хокаге, наруто..."
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                />

                {/* Interactive Vowel Chips */}
                {wordInput.trim().length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] text-neutral-400">
                      Нажмите на ударную гласную: <strong className="text-amber-300 font-mono">{stressedForm}</strong>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {wordInput.split('').map((ch, idx) => {
                        const isVowel = RUSSIAN_VOWELS.has(ch);
                        const isStressed = stressedForm[idx] === ch.toUpperCase() && isVowel;
                        return isVowel ? (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setStressedForm(applyVowelStressAtIndex(wordInput, idx))}
                            className={`w-7 h-7 rounded border text-xs font-mono font-bold transition-colors ${
                              isStressed
                                ? 'bg-amber-500 text-neutral-950 border-amber-400'
                                : 'bg-neutral-900 text-neutral-200 border-neutral-700 hover:border-amber-500/60'
                            }`}
                          >
                            {isStressed ? ch.toUpperCase() : ch.toLowerCase()}
                          </button>
                        ) : (
                          <span
                            key={idx}
                            className="w-5 h-7 flex items-center justify-center text-xs font-mono text-neutral-500"
                          >
                            {ch.toLowerCase()}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setEntryScope('project')}
                      className={`px-2.5 py-1 rounded border text-[11px] inline-flex items-center gap-1 ${
                        entryScope === 'project'
                          ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                          : 'bg-neutral-900 border-neutral-800 text-neutral-400'
                      }`}
                    >
                      <Folder className="w-3 h-3" />
                      Проект
                    </button>
                    <button
                      type="button"
                      onClick={() => setEntryScope('global')}
                      className={`px-2.5 py-1 rounded border text-[11px] inline-flex items-center gap-1 ${
                        entryScope === 'global'
                          ? 'bg-blue-500/20 border-blue-500/50 text-blue-200'
                          : 'bg-neutral-900 border-neutral-800 text-neutral-400'
                      }`}
                    >
                      <Globe className="w-3 h-3" />
                      Глобальный
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveEntry}
                    disabled={isSavingEntry || !wordInput.trim()}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{editingEntryId ? 'Обновить' : 'Добавить'}</span>
                  </button>
                </div>

                <input
                  type="text"
                  value={entryNotes}
                  onChange={(e) => setEntryNotes(e.target.value)}
                  placeholder="Примечание (опционально)..."
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1 text-[11px] text-neutral-300 focus:outline-none focus:border-neutral-700"
                />
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={dictSearch}
                  onChange={(e) => setDictSearch(e.target.value)}
                  placeholder="Поиск по словарю ударений..."
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-neutral-700"
                />
              </div>

              {/* Entries List */}
              <div className="space-y-2">
                {filteredEntries.length === 0 ? (
                  <div className="text-center py-8 text-xs text-neutral-500">
                    Записей в словаре пока нет. Добавьте имя или термин выше.
                  </div>
                ) : (
                  filteredEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-neutral-800 bg-neutral-950/60"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-amber-300">
                            {entry.stressedForm}
                          </span>
                          <span className="text-[10px] text-neutral-500">
                            {entry.scope === 'global' ? 'Глобальный' : 'Проект'}
                          </span>
                        </div>
                        {entry.notes && (
                          <div className="text-[11px] text-neutral-400 truncate mt-0.5">{entry.notes}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingEntryId(entry.id);
                            setWordInput(entry.word);
                            setStressedForm(entry.stressedForm);
                            setEntryScope(entry.scope);
                            setEntryNotes(entry.notes || '');
                          }}
                          className="p-1.5 text-neutral-400 hover:text-white rounded hover:bg-neutral-800"
                          title="Редактировать"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteEntry(entry.id)}
                          className="p-1.5 text-neutral-500 hover:text-red-400 rounded hover:bg-neutral-800"
                          title="Удалить"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {activeTab === 'profiles' && (
            <>
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-3.5 space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-neutral-300">Персонаж</label>
                  <select
                    value={selectedChar}
                    onChange={(e) => setSelectedChar(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    {episodeCharacters.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                    <option value="__custom__">+ Ввести имя вручную...</option>
                  </select>
                  {selectedChar === '__custom__' && (
                    <input
                      type="text"
                      value={customChar}
                      onChange={(e) => setCustomChar(e.target.value)}
                      placeholder="Имя персонажа..."
                      className="w-full mt-1.5 bg-neutral-900 border border-indigo-500/50 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
                    />
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-xs text-neutral-400">Возрастная группа</label>
                    <select
                      value={ageGroup}
                      onChange={(e) => setAgeGroup(e.target.value as CharacterAgeGroup)}
                      className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1.5 text-xs text-neutral-100"
                    >
                      <option value="any">Любой</option>
                      <option value="child">Ребёнок</option>
                      <option value="teen">Подросток</option>
                      <option value="young_adult">Юноша / девушка</option>
                      <option value="adult">Взрослый</option>
                      <option value="mature">Зрелый / пожилой</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-neutral-400">Ожидаемый тембр (пол)</label>
                    <select
                      value={expectedGender}
                      onChange={(e) => setExpectedGender(e.target.value as CharacterGenderTarget)}
                      className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1.5 text-xs text-neutral-100"
                    >
                      <option value="any">Любой</option>
                      <option value="male">Мужской</option>
                      <option value="female">Женский</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-xs text-neutral-400">Мин. высота тона F0 (Гц)</label>
                    <input
                      type="number"
                      value={targetF0MinHz}
                      onChange={(e) => setTargetF0MinHz(e.target.value)}
                      placeholder="Авто"
                      className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs font-mono tabular-nums text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-neutral-400">Макс. высота тона F0 (Гц)</label>
                    <input
                      type="number"
                      value={targetF0MaxHz}
                      onChange={(e) => setTargetF0MaxHz(e.target.value)}
                      placeholder="Авто"
                      className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs font-mono tabular-nums text-white"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-neutral-400">Допуск по эмоциональной подаче</label>
                  <select
                    value={emotionTolerance}
                    onChange={(e) => setEmotionTolerance(e.target.value as CharacterEmotionTolerance)}
                    className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-neutral-100"
                  >
                    <option value="strict">Строгий (близко к оригиналу)</option>
                    <option value="standard">Стандартный</option>
                    <option value="free">Свободный отыгрыш</option>
                  </select>
                </div>

                <input
                  type="text"
                  value={profileNotes}
                  onChange={(e) => setProfileNotes(e.target.value)}
                  placeholder="Заметки по характеру и подаче..."
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200"
                />

                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={isSavingProfile}
                  className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingProfile ? 'Сохранение...' : 'Сохранить профиль роли'}</span>
                </button>
              </div>

              {/* Voice Base v2 Trigger */}
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-3.5 space-y-2">
                <div className="text-xs font-semibold text-neutral-200">Эталон голосов оригинала (Voice Base v2)</div>
                <p className="text-[11px] text-neutral-400 leading-relaxed">
                  Извлекает эмбеддинги ECAPA и медианную высоту тона F0 из оригинальных реплик для проверки попадания дабберов в образ.
                </p>
                <button
                  type="button"
                  onClick={handleTrainVoiceBaseV2}
                  disabled={isTrainingVoiceBase || !episode?.rawPath}
                  className="w-full py-2 rounded-lg border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-100 text-xs font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>
                    {isTrainingVoiceBase
                      ? 'Обучение эталонов...'
                      : 'Обучить эталонные голоса из текущей серии'}
                  </span>
                </button>
              </div>

              {/* Saved Profiles List */}
              {profiles.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-neutral-400">Сохранённые профили</div>
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedChar(p.characterName)}
                      className="w-full text-left p-2.5 rounded-lg border border-neutral-800 bg-neutral-950/60 hover:border-neutral-700 flex items-center justify-between"
                    >
                      <div>
                        <div className="text-xs font-semibold text-neutral-100">{p.characterName}</div>
                        <div className="text-[11px] text-neutral-400">
                          Возраст: {p.ageGroup} · Пол: {p.expectedGender} · Допуск: {p.emotionTolerance}
                        </div>
                      </div>
                      <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
