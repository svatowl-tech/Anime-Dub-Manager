import React from 'react';
import { FolderPlus, UserPlus, Mic, Database, ChevronRight } from 'lucide-react';

interface GettingStartedGuideProps {
  onStart: () => void;
}

export default function GettingStartedGuide({ onStart }: GettingStartedGuideProps) {
  const steps = [
    { icon: FolderPlus, title: 'Создайте проект', description: 'Нажмите кнопку "Новый проект", чтобы начать.' },
    { icon: UserPlus, title: 'Назначьте даберов', description: 'Добавьте участников в проект.' },
    { icon: Mic, title: 'Назначьте звукаря', description: 'Выберите звукорежиссера для проекта.' },
    { icon: Database, title: 'Настройте пути', description: 'Укажите папку для хранения файлов.' },
  ];

  return (
    <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-2xl shadow-xl space-y-6">
      <h2 className="text-2xl font-bold text-white">Добро пожаловать в Anime Dub Manager!</h2>
      <p className="text-neutral-400">Чтобы начать работу, выполните следующие шаги:</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {steps.map((step, index) => (
          <div key={index} className="flex items-center gap-4 bg-neutral-950 p-4 rounded-xl border border-neutral-800">
            <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
              <step.icon className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h3 className="font-bold text-white">{step.title}</h3>
              <p className="text-sm text-neutral-500">{step.description}</p>
            </div>
          </div>
        ))}
      </div>
      <button 
        onClick={onStart}
        className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold transition-colors"
      >
        Создать первый проект <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
