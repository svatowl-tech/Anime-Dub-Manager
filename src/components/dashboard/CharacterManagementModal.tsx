import React, { useState } from 'react';
import { X, Plus, Image as ImageIcon, Link as LinkIcon, Sparkles } from 'lucide-react';
import { Project, Participant } from '../../types';
import { ipcSafe } from '../../lib/ipcSafe';
import { toast } from 'sonner';
import { getBackgroundBaseName } from '../../lib/characterUtils';

interface CharacterManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProject: Project | null;
  participants: Participant[];
  onRefresh: () => void;
}

export default function CharacterManagementModal({ isOpen, onClose, selectedProject, participants, onRefresh }: CharacterManagementModalProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newCharName, setNewCharName] = useState('');
  
  // Custom states for smart filter & merge
  const [collapseBackground, setCollapseBackground] = useState(true);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string>('');

  if (!isOpen || !selectedProject) return null;

  let mapping: {characterName: string, dubberId: string, photoUrl?: string}[] = [];
  try {
    const parsed = JSON.parse(selectedProject.globalMapping || '[]');
    if (Array.isArray(parsed)) {
      mapping = parsed;
    } else if (parsed && typeof parsed === 'object') {
      mapping = Object.entries(parsed).map(([k, v]) => ({ characterName: k, dubberId: v as string }));
    }
  } catch (e) {
    console.error(e);
  }
  const aliases: Record<string, string> = JSON.parse(selectedProject.characterAliases || '{}');
  const stresses: Record<string, string> = JSON.parse(selectedProject.nameStresses || '{}');
  
  // Group aliases by main character
  const aliasesByMain: Record<string, string[]> = {};
  Object.entries(aliases).forEach(([alias, main]) => {
    if (!aliasesByMain[main]) aliasesByMain[main] = [];
    aliasesByMain[main].push(alias);
  });

  // Group background characters if collapseBackground is true
  interface DisplayMappingEntry {
    characterName: string;
    dubberId: string;
    photoUrl?: string;
    isGroup: boolean;
    originalNames?: string[];
  }

  let displayMapping: DisplayMappingEntry[] = [];
  
  if (collapseBackground) {
    const backgroundGroups: Record<string, { characterName: string, dubberId: string, photoUrl?: string, originalNames: string[] }> = {};
    const normalEntries: DisplayMappingEntry[] = [];

    mapping.forEach(m => {
      const baseName = getBackgroundBaseName(m.characterName);
      if (baseName) {
        const groupKey = `${baseName} (Группа)`;
        if (!backgroundGroups[groupKey]) {
          backgroundGroups[groupKey] = {
            characterName: groupKey,
            dubberId: m.dubberId,
            photoUrl: m.photoUrl,
            originalNames: []
          };
        }
        backgroundGroups[groupKey].originalNames.push(m.characterName);
        if (m.dubberId && !backgroundGroups[groupKey].dubberId) {
          backgroundGroups[groupKey].dubberId = m.dubberId;
        }
        if (m.photoUrl && !backgroundGroups[groupKey].photoUrl) {
          backgroundGroups[groupKey].photoUrl = m.photoUrl;
        }
      } else {
        normalEntries.push({
          ...m,
          isGroup: false
        });
      }
    });

    displayMapping = [
      ...normalEntries,
      ...Object.values(backgroundGroups).map(g => ({
        characterName: g.characterName,
        dubberId: g.dubberId,
        photoUrl: g.photoUrl,
        isGroup: true,
        originalNames: g.originalNames
      }))
    ];
  } else {
    displayMapping = mapping.map(m => ({
      ...m,
      isGroup: false
    }));
  }

  // Handle merging two existing characters
  const handleMergeConfirm = async () => {
    if (!selectedProject || !mergeSource || !mergeTarget) return;
    
    try {
      // 1. Update project characterAliases
      const updatedAliases = { ...aliases };
      updatedAliases[mergeSource] = mergeTarget;
      
      // Also update any aliases that were pointing to mergeSource to now point to mergeTarget
      Object.keys(updatedAliases).forEach(k => {
        if (updatedAliases[k] === mergeSource) {
          updatedAliases[k] = mergeTarget;
        }
      });

      // 2. Update globalMapping (remove mergeSource)
      let updatedMapping = mapping.filter(m => m.characterName !== mergeSource);
      
      // If mergeTarget doesn't have a dubber, but mergeSource did, we copy it over
      const sourceEntry = mapping.find(m => m.characterName === mergeSource);
      const targetIndex = updatedMapping.findIndex(m => m.characterName === mergeTarget);
      if (sourceEntry && sourceEntry.dubberId && targetIndex !== -1 && !updatedMapping[targetIndex].dubberId) {
        updatedMapping[targetIndex] = { ...updatedMapping[targetIndex], dubberId: sourceEntry.dubberId };
      }

      // 3. Save the project
      await ipcSafe.invoke('save-project', {
        ...selectedProject,
        characterAliases: JSON.stringify(updatedAliases),
        globalMapping: JSON.stringify(updatedMapping)
      });

      // 4. Update role assignments across all episodes of this project
      if (selectedProject.episodes && selectedProject.episodes.length > 0) {
        for (const ep of selectedProject.episodes) {
          if (ep.assignments && ep.assignments.length > 0) {
            let hasChanges = false;
            const aliasAssignments = ep.assignments.filter(a => a.characterName === mergeSource);
            let updatedAssignments = ep.assignments.filter(a => a.characterName !== mergeSource);

            if (aliasAssignments.length > 0) {
              hasChanges = true;
              aliasAssignments.forEach(aa => {
                const dubberIdToUse = aa.dubberId;
                const alreadyHasThisDubber = updatedAssignments.some(a => a.characterName === mergeTarget && a.dubberId === dubberIdToUse);
                
                if (!alreadyHasThisDubber) {
                  updatedAssignments.push({
                    ...aa,
                    characterName: mergeTarget,
                    id: Math.random().toString(36).substring(2, 11)
                  });
                }
              });
            }

            if (hasChanges) {
              await ipcSafe.invoke('save-episode', {
                ...ep,
                assignments: updatedAssignments
              });
            }
          }
        }
      }

      setIsMerging(false);
      setMergeSource(null);
      setMergeTarget('');
      toast.success(`Персонаж "${mergeSource}" успешно связан как алиас для "${mergeTarget}".`);
      onRefresh();
    } catch (error) {
      console.error("Merge characters error:", error);
      toast.error("Ошибка при объединении персонажей.");
    }
  };

  // Handle clearing duplicates from existing projects
  const handleClearDuplicates = async () => {
    if (!selectedProject) return;
    
    try {
      const cleanedMapping: typeof mapping = [];
      const seen = new Set<string>();
      let duplicateCount = 0;
      
      mapping.forEach(m => {
        const name = m.characterName.trim();
        if (!seen.has(name)) {
          seen.add(name);
          const dups = mapping.filter(item => item.characterName.trim() === name);
          if (dups.length > 1) {
            duplicateCount += (dups.length - 1);
          }
          const dubberId = dups.find(item => item.dubberId)?.dubberId || '';
          const photoUrl = dups.find(item => item.photoUrl)?.photoUrl || undefined;
          
          cleanedMapping.push({
            characterName: name,
            dubberId,
            photoUrl
          });
        }
      });
      
      await ipcSafe.invoke('save-project', {
        ...selectedProject,
        globalMapping: JSON.stringify(cleanedMapping)
      });
      
      toast.success(`Дубликаты персонажей успешно объединены! Удалено дублей: ${duplicateCount}`);
      onRefresh();
    } catch (error) {
      console.error("Clear duplicates error:", error);
      toast.error("Ошибка при очистке дубликатов.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Управление персонажами и алиасами</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Characters Table */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h3 className="text-lg font-medium text-white">Список персонажей</h3>
              <div className="flex flex-wrap items-center gap-3">
                {/* Collapse Background Switch */}
                <button
                  onClick={() => setCollapseBackground(!collapseBackground)}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    collapseBackground 
                      ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' 
                      : 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:text-neutral-200'
                  }`}
                  title="Объединять номерных и фоновых персонажей (например, Мужчина 1, Мужчина 2) в компактные группы"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Умный фильтр фоновых: {collapseBackground ? 'ВКЛ' : 'ВЫКЛ'}
                </button>

                {/* Clear Duplicates Button */}
                <button 
                  onClick={handleClearDuplicates}
                  className="text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-3 py-1.5 rounded-lg border border-neutral-700 transition-colors"
                  title="Объединить дублирующиеся записи персонажей в списке"
                >
                  Очистить дубликаты
                </button>

                <button 
                  onClick={() => setIsAdding(true)}
                  className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300"
                >
                  <Plus className="w-4 h-4" /> Добавить персонажа
                </button>
              </div>
            </div>
            
            <div className="bg-neutral-950 rounded-xl border border-neutral-800 overflow-hidden">
              <div className="max-h-[50vh] overflow-y-auto">
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-neutral-900 z-10">
                    <tr className="bg-neutral-900/50 text-neutral-400 text-xs uppercase tracking-wider">
                      <th className="px-4 py-3 font-semibold">Фото</th>
                      <th className="px-4 py-3 font-semibold">Персонаж</th>
                      <th className="px-4 py-3 font-semibold">Имя с ударением (напр. Нару́то)</th>
                      <th className="px-4 py-3 font-semibold">Дабер по умолчанию</th>
                      <th className="px-4 py-3 font-semibold">Алиасы / Состав группы</th>
                      <th className="px-4 py-3 font-semibold text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {isAdding && (
                      <tr className="bg-blue-900/10 transition-colors">
                        <td className="px-4 py-3">
                          <div className="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center text-neutral-500 border border-blue-500/30">
                            <ImageIcon className="w-5 h-5" />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <input 
                            autoFocus
                            type="text"
                            value={newCharName}
                            onChange={(e) => setNewCharName(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter' && newCharName.trim()) {
                                mapping.push({ characterName: newCharName.trim(), dubberId: '' });
                                await ipcSafe.invoke('save-project', { ...selectedProject, globalMapping: JSON.stringify(mapping) });
                                setNewCharName('');
                                setIsAdding(false);
                                onRefresh();
                              } else if (e.key === 'Escape') {
                                setIsAdding(false);
                                setNewCharName('');
                              }
                            }}
                            className="w-full bg-neutral-900 border border-blue-500 text-white rounded px-2 py-1 text-sm outline-none"
                            placeholder="Имя... (Enter)"
                          />
                        </td>
                        <td className="px-4 py-3 text-neutral-500 italic text-xs">Доступно после сохранения</td>
                        <td className="px-4 py-3 text-neutral-500 italic text-xs">Нажмите Enter для сохранения</td>
                        <td className="px-4 py-3 text-neutral-500 italic text-xs">Esc для отмены</td>
                        <td className="px-4 py-3 text-right">
                          <button 
                            onClick={() => {
                              setIsAdding(false);
                              setNewCharName('');
                            }}
                            className="text-neutral-500 hover:text-red-400"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    )}
                    {displayMapping.map((char, idx) => (
                      <tr key={char.characterName || ('char-' + idx)} className="hover:bg-neutral-900/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="relative w-10 h-10 flex-shrink-0">
                            {char.photoUrl ? (
                              <img 
                                src={char.photoUrl} 
                                alt={char.characterName} 
                                className="absolute inset-0 w-10 h-10 rounded-full object-cover z-10" 
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  const next = e.currentTarget.nextSibling;
                                  if (next && next instanceof HTMLElement) {
                                    next.classList.remove('hidden');
                                  }
                                }}
                              />
                            ) : null}
                            <div className={`absolute inset-0 w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center text-neutral-500 ${char.photoUrl ? 'hidden' : ''}`}>
                              <ImageIcon className="w-5 h-5" />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-white font-medium">
                          {char.characterName}
                          {char.isGroup && (
                            <span className="ml-1.5 text-[9px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1 py-0.5 rounded uppercase font-bold tracking-wider">
                              Свернут
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {char.isGroup ? (
                            <span className="text-neutral-500 text-xs italic">Неприменимо к группе</span>
                          ) : (
                            <input 
                              type="text"
                              defaultValue={stresses[char.characterName] || ''}
                              onBlur={async (e) => {
                                const newStress = e.target.value.trim();
                                const updatedStresses = { ...stresses };
                                
                                if (newStress) {
                                  updatedStresses[char.characterName] = newStress;
                                } else {
                                  delete updatedStresses[char.characterName];
                                }
                                
                                await ipcSafe.invoke('save-project', { ...selectedProject, nameStresses: JSON.stringify(updatedStresses) });
                                onRefresh();
                              }}
                              className="w-full bg-neutral-900 border border-neutral-800 text-white rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500"
                              placeholder="Напр: Нару́то"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <select 
                            value={char.dubberId}
                            onChange={async (e) => {
                              const newDubberId = e.target.value;
                              let updatedMapping = [...mapping];
                              
                              if (char.isGroup && char.originalNames) {
                                updatedMapping = updatedMapping.map(m => {
                                  if (char.originalNames?.includes(m.characterName)) {
                                    return { ...m, dubberId: newDubberId };
                                  }
                                  return m;
                                });
                              } else {
                                const idxInOriginal = mapping.findIndex(m => m.characterName === char.characterName);
                                if (idxInOriginal !== -1) {
                                  updatedMapping[idxInOriginal] = { ...updatedMapping[idxInOriginal], dubberId: newDubberId };
                                }
                              }
                              
                              await ipcSafe.invoke('save-project', { ...selectedProject, globalMapping: JSON.stringify(updatedMapping) });
                              onRefresh();
                            }}
                            className="bg-neutral-900 border border-neutral-800 text-white rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="">Не назначен</option>
                            {participants
                              .filter(p => selectedProject.assignedDubberIds?.includes(p.id))
                              .map((p, pIdx) => (
                                <option key={(p.id || 'p') + pIdx} value={p.id}>{p.nickname}</option>
                              ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          {char.isGroup && char.originalNames ? (
                            <div className="text-xs text-neutral-400 max-w-xs truncate" title={char.originalNames.join(', ')}>
                              {char.originalNames.join(', ')}
                            </div>
                          ) : (
                            <input 
                              type="text"
                              defaultValue={(aliasesByMain[char.characterName] || []).join(', ')}
                              onBlur={async (e) => {
                                const newAliasesList = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                                const updatedAliases = { ...aliases };
                                
                                // Remove old aliases for this character
                                Object.keys(updatedAliases).forEach(k => {
                                  if (updatedAliases[k] === char.characterName) {
                                    delete updatedAliases[k];
                                  }
                                });
                                
                                // Add new aliases
                                newAliasesList.forEach(a => {
                                  updatedAliases[a] = char.characterName;
                                });
                                
                                await ipcSafe.invoke('save-project', { ...selectedProject, characterAliases: JSON.stringify(updatedAliases) });
                                onRefresh();
                              }}
                              className="w-full bg-neutral-900 border border-neutral-800 text-white rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500"
                              placeholder="Напр: Наруто, Узумаки"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Merge Existing Character Button */}
                            {!char.isGroup && (
                              <button 
                                onClick={() => {
                                  setMergeSource(char.characterName);
                                  setMergeTarget('');
                                  setIsMerging(true);
                                }}
                                className="text-neutral-500 hover:text-blue-400 p-1"
                                title="Объединить/Связать этого персонажа с другим"
                              >
                                <LinkIcon className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* Delete Button */}
                            <button 
                              onClick={async () => {
                                if (char.isGroup && char.originalNames) {
                                  if (window.confirm(`Удалить группу персонажей и всех участников (${char.originalNames.join(', ')})?`)) {
                                    const updatedMapping = mapping.filter(m => !char.originalNames?.includes(m.characterName));
                                    const updatedAliases = { ...aliases };
                                    char.originalNames.forEach(name => {
                                      delete updatedAliases[name];
                                      Object.keys(updatedAliases).forEach(k => {
                                        if (updatedAliases[k] === name) {
                                          delete updatedAliases[k];
                                        }
                                      });
                                    });
                                    await ipcSafe.invoke('save-project', { 
                                      ...selectedProject, 
                                      globalMapping: JSON.stringify(updatedMapping),
                                      characterAliases: JSON.stringify(updatedAliases)
                                    });
                                    onRefresh();
                                  }
                                } else {
                                  if (window.confirm(`Удалить персонажа ${char.characterName}?`)) {
                                    const updatedMapping = mapping.filter(m => m.characterName !== char.characterName);
                                    const updatedAliases = { ...aliases };
                                    Object.keys(updatedAliases).forEach(k => {
                                      if (updatedAliases[k] === char.characterName) {
                                        delete updatedAliases[k];
                                      }
                                    });
                                    await ipcSafe.invoke('save-project', { 
                                      ...selectedProject, 
                                      globalMapping: JSON.stringify(updatedMapping),
                                      characterAliases: JSON.stringify(updatedAliases)
                                    });
                                    onRefresh();
                                  }
                                }
                              }}
                              className="text-neutral-500 hover:text-red-400 p-1"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {displayMapping.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                          Персонажи не добавлены.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        
        <div className="p-6 border-t border-neutral-800 flex justify-end">
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
          >
            Готово
          </button>
        </div>
      </div>

      {/* Merge Characters Sub-Modal Overlay */}
      {isMerging && mergeSource && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-semibold text-white">Объединение персонажей</h3>
            <p className="text-neutral-400 text-sm">
              Вы собираетесь сделать персонажа <strong className="text-white">"{mergeSource}"</strong> алиасом для другого существующего персонажа. Все реплики и связи перейдут к выбранному персонажу, а сам "{mergeSource}" будет скрыт как самостоятельный субъект в списке.
            </p>
            
            <div className="space-y-1.5">
              <label className="text-xs text-neutral-400 font-medium">Выберите главного персонажа:</label>
              <select
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 text-white rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
              >
                <option value="">-- Выберите персонажа --</option>
                {mapping
                  .filter(m => m.characterName !== mergeSource)
                  .map(m => (
                    <option key={m.characterName} value={m.characterName}>
                      {m.characterName}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setIsMerging(false);
                  setMergeSource(null);
                  setMergeTarget('');
                }}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-sm transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleMergeConfirm}
                disabled={!mergeTarget}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Объединить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
