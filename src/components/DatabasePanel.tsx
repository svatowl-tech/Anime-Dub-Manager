import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Save, UserPlus, Download, Upload } from 'lucide-react';
import { Participant } from '../types';
import { ROLES } from '../constants';
import { getParticipants, saveParticipant, deleteParticipant, exportParticipants, importParticipants } from '../services/dbService';
import { toast } from 'sonner';
import { ConfirmModal } from './ui/ConfirmModal';

export default function DatabasePanel() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [editing, setEditing] = useState<Participant | null>(null);

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  useEffect(() => {
    getParticipants().then(setParticipants);
  }, []);

  const handleExport = async () => {
    const data = await exportParticipants();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'participants.json';
    a.click();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const json = event.target?.result as string;
          await importParticipants(json);
          const updated = await getParticipants();
          setParticipants(updated);
          toast.success('База импортирована!');
        } catch (error) {
          console.error('Import error:', error);
          toast.error('Ошибка при импорте базы: ' + (error instanceof Error ? error.message : 'Неизвестная ошибка'));
        }
      };
      reader.readAsText(file);
    }
  };

  const handleSave = async (p: Participant) => {
    await saveParticipant(p);
    const updated = await getParticipants();
    setParticipants(updated);
    setEditing(null);
  };

  const handleDelete = async (id: string) => {
    setConfirmState({
      isOpen: true,
      title: 'Удаление участника',
      message: 'Вы уверены, что хотите удалить этого участника?',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await deleteParticipant(id);
          const updated = await getParticipants();
          setParticipants(updated);
          toast.success('Участник удален');
        } catch (error) {
          console.error('Delete participant error:', error);
          toast.error('Ошибка при удалении участника');
        }
      }
    });
  };

  return (
    <div className="p-8 w-full mx-auto space-y-8">
      <h1 className="text-3xl font-bold text-white">База участников</h1>
      
      <div className="flex gap-4">
        <button 
          onClick={() => setEditing({ id: Date.now().toString(), nickname: '', telegram: '', tgChannel: '', vkLink: '', roles: [] })}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg"
        >
          <UserPlus className="w-5 h-5" /> Добавить участника
        </button>
        <button onClick={handleExport} className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2 rounded-lg">
          <Download className="w-5 h-5" /> Экспорт JSON
        </button>
        <label className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2 rounded-lg cursor-pointer">
          <Upload className="w-5 h-5" /> Импорт JSON
          <input type="file" accept=".json" onChange={handleImport} className="hidden" />
        </label>
      </div>

      {editing && (
        <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-xl space-y-4">
          <h2 className="text-xl font-bold text-white">{editing.id ? 'Редактирование' : 'Новый участник'}</h2>
          <div className="grid grid-cols-2 gap-4">
            <input placeholder="Ник" value={editing.nickname} onChange={e => setEditing({...editing, nickname: e.target.value})} className="bg-neutral-950 p-2 rounded border border-neutral-800 text-white" />
            <input placeholder="Телеграм" value={editing.telegram} onChange={e => setEditing({...editing, telegram: e.target.value})} className="bg-neutral-950 p-2 rounded border border-neutral-800 text-white" />
            <input placeholder="ТГ канал" value={editing.tgChannel} onChange={e => setEditing({...editing, tgChannel: e.target.value})} className="bg-neutral-950 p-2 rounded border border-neutral-800 text-white" />
            <input placeholder="Ссылка ВК" value={editing.vkLink} onChange={e => setEditing({...editing, vkLink: e.target.value})} className="bg-neutral-950 p-2 rounded border border-neutral-800 text-white" />
          </div>
          <div>
            <label className="text-neutral-400">Роли:</label>
            <div className="flex gap-2 flex-wrap mt-2">
              {ROLES.map(role => (
                <button 
                  key={role.id}
                  onClick={() => {
                    const currentRoles = Array.isArray(editing.roles) ? editing.roles : [];
                    setEditing({
                      ...editing, 
                      roles: currentRoles.includes(role.id) 
                        ? currentRoles.filter(r => r !== role.id) 
                        : [...currentRoles, role.id]
                    });
                  }}
                  className={`px-3 py-1 rounded-full text-sm ${(Array.isArray(editing.roles) ? editing.roles : []).includes(role.id) ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-400'}`}
                >
                  {role.name}
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => handleSave(editing)} className="bg-green-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"><Save className="w-4 h-4"/> Сохранить</button>
        </div>
      )}

      <table className="w-full text-left text-neutral-300 border-collapse">
        <thead>
          <tr className="border-b border-neutral-800">
            <th className="p-3">Ник</th>
            <th className="p-3">Телеграм</th>
            <th className="p-3">ТГ канал</th>
            <th className="p-3">Ссылка ВК</th>
            <th className="p-3">Роли</th>
            <th className="p-3">Действия</th>
          </tr>
        </thead>
        <tbody>
          {participants.map(p => (
            <tr key={p.id} className="border-b border-neutral-800">
              <td className="p-3">{p.nickname}</td>
              <td className="p-3">{p.telegram}</td>
              <td className="p-3">{p.tgChannel}</td>
              <td className="p-3">{p.vkLink}</td>
              <td className="p-3">{(Array.isArray(p.roles) ? p.roles : []).join(', ')}</td>
              <td className="p-3 flex gap-2">
                <button onClick={() => setEditing(p)}><Edit2 className="w-4 h-4 text-blue-400"/></button>
                <button onClick={() => handleDelete(p.id)}><Trash2 className="w-4 h-4 text-red-400"/></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ConfirmModal 
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
