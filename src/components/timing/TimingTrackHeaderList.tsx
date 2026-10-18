import React from 'react';

export function TimingTrackHeaderList(props: any) {
  return (
    <div className="w-64 bg-neutral-900 border-r border-neutral-800 p-2 overflow-y-auto">
      <div className="text-xs font-bold text-neutral-400 mb-2">Дорожки</div>
      {props.tracks?.map((t: any) => (
        <div key={t.id} className="p-2 mb-1 rounded bg-neutral-800 text-xs text-white">
          {t.participant || t.id}
        </div>
      ))}
    </div>
  );
}
