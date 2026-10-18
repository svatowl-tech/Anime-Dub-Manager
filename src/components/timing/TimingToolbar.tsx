import React from 'react';

export function TimingToolbar(props: any) {
  return (
    <div className="flex items-center gap-2 p-2 bg-neutral-900 border-b border-neutral-800 text-neutral-200">
      <span className="text-xs font-bold px-2">Тайминг Студия</span>
      {props.onOpenSmartPause && (
        <button onClick={props.onOpenSmartPause} className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 rounded text-xs">
          Умные паузы
        </button>
      )}
    </div>
  );
}
