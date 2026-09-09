import { useEffect, useState } from 'react';
import { ipcSafe } from '../lib/ipcSafe';
import { DownloadCloud, Play, Pause, X, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';

export default function ActiveDownloadsIndicator() {
  const [downloads, setDownloads] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    let timerId: any = null;
    let isMounted = true;
    
    const fetchDownloads = async () => {
      if (document.hidden) {
        // Postpone if document is not visible
        timerId = setTimeout(fetchDownloads, 5000);
        return;
      }
      
      try {
        const data = await ipcSafe.invoke('get-active-downloads');
        if (isMounted && data && Array.isArray(data)) {
          const active = data.filter(d => d.status === 'downloading' || d.status === 'error');
          setDownloads(active);
          
          // If active downloads exist, poll faster (2s), otherwise slow down (8s)
          const nextInterval = active.length > 0 ? 2000 : 8000;
          timerId = setTimeout(fetchDownloads, nextInterval);
        } else if (isMounted) {
          timerId = setTimeout(fetchDownloads, 8000);
        }
      } catch (e) {
        console.error('Failed to fetch downloads:', e);
        if (isMounted) timerId = setTimeout(fetchDownloads, 10000);
      }
    };

    fetchDownloads();

    const handleVisibility = () => {
      if (!document.hidden) {
        clearTimeout(timerId);
        fetchDownloads();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    
    return () => {
      isMounted = false;
      clearTimeout(timerId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  if (downloads.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-6 z-[9999]">
      <div 
        className={`bg-neutral-900 border border-neutral-800 shadow-xl rounded-xl transition-all duration-300 overflow-hidden ${
          isOpen ? 'w-80 h-auto' : 'w-14 h-14'
        }`}
      >
        {!isOpen ? (
          <button 
            onClick={() => setIsOpen(true)}
            className="w-full h-full flex items-center justify-center text-indigo-400 hover:text-indigo-300 relative group bg-neutral-900"
          >
            <DownloadCloud className="w-6 h-6 animate-pulse" />
            <span className="absolute top-1 right-1 bg-indigo-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
              {downloads.length}
            </span>
          </button>
        ) : (
          <div className="flex flex-col">
            <div className="p-3 border-b border-neutral-800 flex items-center justify-between bg-neutral-950">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <DownloadCloud className="w-4 h-4 text-indigo-400" />
                Активные загрузки ({downloads.length})
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-neutral-500 hover:text-white transition-colors"
                title="Свернуть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="max-h-80 overflow-y-auto p-2 space-y-2">
              {downloads.map(d => (
                <div key={d.id} className="p-3 bg-neutral-950/50 rounded-lg border border-neutral-800 flex flex-col gap-2">
                  <div className="text-xs font-semibold text-neutral-200 truncate" title={d.name}>
                    {d.name || 'Ожидание...'}
                  </div>
                  
                  {d.status === 'downloading' ? (
                    <>
                      <div className="w-full bg-neutral-800 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500 ease-out"
                          style={{ width: `${d.progress}%` }}
                        />
                      </div>
                      
                      <div className="flex items-center justify-between text-[10px] text-neutral-400 font-mono">
                        <div>
                          {d.downloadSpeed > 0 
                            ? `${(d.downloadSpeed / 1024 / 1024).toFixed(2)} MB/s` 
                            : (d.warning || 'Поиск пиров...')}
                        </div>
                        <div className="flex items-center gap-1">
                          Пиры: {d.numPeers} <span className="text-neutral-600">|</span> {d.progress}%
                        </div>
                      </div>

                      {d.warning && d.downloadSpeed === 0 && (
                        <div className="text-[10px] text-amber-400 font-medium flex items-center gap-1 bg-amber-500/10 p-1 rounded border border-amber-500/20">
                          <Info className="w-3 h-3 text-amber-400 shrink-0" />
                          <span className="truncate">{d.warning}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-[10px] text-red-400 font-medium">
                      ⚠️ Ошибка: {d.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
