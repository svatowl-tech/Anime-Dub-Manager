import React, { useEffect, useState } from 'react';
import { ipcSafe } from '../lib/ipcSafe';
import { Activity, Cpu, List, MemoryStick, Terminal, XCircle, Info, Calendar, GitBranch } from 'lucide-react';
import { Task } from '../types';
// @ts-ignore
import buildMetadata from '../build-metadata.json';

export default function DebugConsole() {
  const [stats, setStats] = useState({ cpu: 0, ram: 0, ffmpeg: [] });
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await ipcSafe.invoke('get-debug-stats');
        if (data) setStats(data);
        
        const taskData = await ipcSafe.invoke('get-tasks');
        if (taskData) setTasks(taskData);
      } catch (error) {
        console.error('Failed to fetch debug stats', error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 1000);

    const removeListener = ipcSafe.on('task-queue-updated', (updatedTasks: Task[]) => {
      setTasks(updatedTasks);
    });

    return () => {
      clearInterval(interval);
      removeListener();
    };
  }, []);

  const handleAbort = async (taskId: string) => {
    try {
      await ipcSafe.invoke('abort-task', taskId);
    } catch (error) {
      console.error('Failed to abort task', error);
    }
  };

  const handleClearHistory = async () => {
    try {
      await ipcSafe.invoke('clear-task-history');
    } catch (error) {
      console.error('Failed to clear history', error);
    }
  };

  return (
    <div className="h-screen bg-black text-green-400 font-mono p-6 overflow-auto">
      <div className="flex items-center justify-between mb-6 border-b border-green-900 pb-4">
        <div className="flex items-center gap-3">
          <Terminal className="w-6 h-6" />
          <h1 className="text-2xl font-bold tracking-tight">Debug Console</h1>
        </div>
        <div className="flex items-center gap-4">
          {buildMetadata && (
            <div className="flex items-center gap-4 text-[10px] text-green-700 bg-green-950/20 px-3 py-1 rounded border border-green-900/30">
              <div className="flex items-center gap-1">
                <Info className="w-3 h-3" />
                <span>v{buildMetadata.version}</span>
              </div>
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                <span>{new Date(buildMetadata.buildDate).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1">
                <GitBranch className="w-3 h-3" />
                <span>{buildMetadata.commitHash}</span>
              </div>
            </div>
          )}
          <button 
            onClick={handleClearHistory}
            className="text-xs border border-green-900 px-2 py-1 rounded hover:bg-green-900/30 transition-colors"
          >
            Clear History
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-6 mb-8">
        <div className="bg-green-950/30 border border-green-900 rounded-lg p-4 flex items-center gap-4">
          <Cpu className="w-8 h-8 text-green-500" />
          <div>
            <div className="text-sm text-green-600 uppercase tracking-wider">CPU Usage</div>
            <div className="text-2xl font-bold">{stats.cpu.toFixed(2)}%</div>
          </div>
        </div>
        <div className="bg-green-950/30 border border-green-900 rounded-lg p-4 flex items-center gap-4">
          <MemoryStick className="w-8 h-8 text-green-500" />
          <div>
            <div className="text-sm text-green-600 uppercase tracking-wider">RAM Usage</div>
            <div className="text-2xl font-bold">{(stats.ram / 1024 / 1024).toFixed(2)} MB</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <List className="w-5 h-5" />
            <h2 className="text-lg font-bold">Task Queue</h2>
          </div>
          
          {tasks.length === 0 ? (
            <div className="text-green-700 italic">No tasks in queue</div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => (
                <div key={task.id} className={`bg-green-950/20 border ${task.status === 'running' ? 'border-green-500' : 'border-green-900/50'} rounded p-3 text-sm`}>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="font-bold uppercase text-xs px-1 bg-green-900 rounded mr-2">{task.type}</span>
                      <span className="text-green-600 text-xs">{task.id}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${
                        task.status === 'running' ? 'text-green-400 animate-pulse' : 
                        task.status === 'completed' ? 'text-blue-400' :
                        task.status === 'failed' ? 'text-red-400' : 'text-green-700'
                      }`}>
                        {task.status.toUpperCase()}
                      </span>
                      {(task.status === 'pending' || task.status === 'running') && (
                        <button onClick={() => handleAbort(task.id)} className="text-red-900 hover:text-red-500">
                          <XCircle className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div className="text-xs text-green-500 mb-2">
                    {task.metadata?.title || 'Untitled Task'}
                  </div>

                  {task.status === 'running' && (
                    <div className="space-y-1">
                      <div className="w-full bg-green-950 rounded-full h-1.5">
                        <div className="bg-green-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${task.progress}%` }}></div>
                      </div>
                      <div className="flex justify-between text-[10px] text-green-600">
                        <span>{task.progress}%</span>
                        <span>{task.eta ? `ETA: ${task.eta}s` : 'Calculating...'}</span>
                      </div>
                    </div>
                  )}

                  {task.error && (
                    <div className="text-[10px] text-red-500 mt-2 bg-red-950/20 p-1 rounded border border-red-900/30">
                      {task.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5" />
            <h2 className="text-lg font-bold">Active FFmpeg Processes</h2>
          </div>
          
          {stats.ffmpeg.length === 0 ? (
            <div className="text-green-700 italic">No active processes</div>
          ) : (
            <div className="space-y-3">
              {stats.ffmpeg.map((p: any, i: number) => (
                <div key={i} className="bg-green-950/20 border border-green-900/50 rounded p-3 text-sm break-all">
                  <div className="text-green-600 mb-1">Process ID: {p.id}</div>
                  <div className="font-mono text-[10px] leading-relaxed opacity-80">{p.commandLine}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
