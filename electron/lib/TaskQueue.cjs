const log = require('electron-log');
const { EventEmitter } = require('events');

/**
 * TaskQueue manages a queue of heavy tasks (like FFmpeg processes).
 * It limits concurrency, reports progress, and allows cancellation.
 */
class TaskQueue extends EventEmitter {
  constructor(maxParallel = 2) {
    super();
    this.maxParallel = maxParallel;
    this.queue = [];
    this.activeTasks = new Map(); // taskId -> { command, task }
    this.taskIdCounter = 0;
  }

  /**
   * Register or enqueue an externally managed background job (like WebTorrent or Anime365 direct stream)
   */
  registerExternalTask(id, type, metadata = {}, abortHandler = null) {
    let task = this.queue.find(t => t.id === id);
    if (!task) {
      task = {
        id,
        type,
        metadata,
        abortHandler,
        status: 'running',
        progress: 0,
        eta: null,
        error: null,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: null
      };
      this.queue.push(task);
      this.activeTasks.set(id, { 
        command: { kill: () => { if (typeof abortHandler === 'function') abortHandler(); } }, 
        task 
      });
      log.info(`TaskQueue: Registered external task ${id} (${type})`);
      this.emit('queue-updated', this.getTasksSummary());
    } else {
      task.metadata = { ...task.metadata, ...metadata };
      if (abortHandler) task.abortHandler = abortHandler;
    }
    return id;
  }

  /**
   * Update progress of a task in the queue
   */
  updateProgress(id, progress, eta = null, metadataUpdate = {}) {
    const task = this.queue.find(t => t.id === id);
    if (task) {
      task.progress = Math.min(100, Math.max(0, Math.round(progress)));
      if (eta !== undefined && eta !== null) task.eta = eta;
      if (metadataUpdate && typeof metadataUpdate === 'object') {
        task.metadata = { ...task.metadata, ...metadataUpdate };
      }
      this.emit('task-progress', { id: task.id, progress: task.progress, eta: task.eta });
    }
  }

  /**
   * Mark external task as completed
   */
  completeExternalTask(id, result = null) {
    const task = this.queue.find(t => t.id === id);
    if (task && task.status !== 'completed') {
      task.status = 'completed';
      task.progress = 100;
      task.completedAt = new Date().toISOString();
      this.activeTasks.delete(id);
      log.info(`TaskQueue: External task ${id} completed.`);
      const safeTask = { ...task };
      delete safeTask.abortHandler;
      delete safeTask.taskFn;
      this.emit('task-completed', { id, result, task: safeTask });
      this.emit('queue-updated', this.getTasksSummary());
    }
  }

  /**
   * Mark external task as failed
   */
  failExternalTask(id, errorMsg) {
    const task = this.queue.find(t => t.id === id);
    if (task && task.status !== 'aborted') {
      task.status = 'failed';
      task.error = errorMsg;
      this.activeTasks.delete(id);
      log.error(`TaskQueue: External task ${id} failed: ${errorMsg}`);
      this.emit('task-failed', { id, error: errorMsg });
      this.emit('queue-updated', this.getTasksSummary());
    }
  }

  /**
   * Enqueue a new task
   * @param {string} type - Task type (e.g., 'render', 'mux')
   * @param {Function} taskFn - The function that executes the task. 
   *                            Must accept (id, ...args, onProgress, onCommand)
   * @param {Array} args - Arguments for the task function
   * @param {Object} metadata - Additional info for the UI
   * @returns {string} taskId
   */
  enqueue(type, taskFn, args, metadata = {}) {
    const id = `task_${Date.now()}_${++this.taskIdCounter}`;
    const task = {
      id,
      type,
      taskFn, // Store the function to execute
      args,
      metadata,
      status: 'pending',
      progress: 0,
      eta: null,
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null
    };

    this.queue.push(task);
    log.info(`TaskQueue: Enqueued task ${id} (${type})`);
    
    // Limit queue size in memory if needed, but for now just keep all
    this.emit('queue-updated', this.getTasksSummary());
    
    // Use setImmediate to avoid blocking the current execution flow
    setImmediate(() => this.processNext());
    
    return id;
  }

  /**
   * Process the next task in the queue
   */
  async processNext() {
    if (this.activeTasks.size >= this.maxParallel) {
      return;
    }
    
    const task = this.queue.find(t => t.status === 'pending');
    if (!task) {
      return;
    }

    task.status = 'running';
    task.startedAt = new Date().toISOString();
    
    log.info(`TaskQueue: Starting task ${task.id}`);
    this.emit('queue-updated', this.getTasksSummary());

    try {
      // taskFn is expected to return a Promise
      // It should call onProgress({ percent, eta })
      // It should call onCommand(ffmpegCommand) so we can kill it if needed
      
      const result = await task.taskFn(
        task.id, 
        ...task.args || [], 
        (progressData) => {
          task.progress = progressData.percent || 0;
          
          // Calculate ETA
          if (task.progress > 0 && task.progress < 100) {
            const now = Date.now();
            const startedAt = new Date(task.startedAt).getTime();
            const elapsed = now - startedAt;
            const total = elapsed / (task.progress / 100);
            task.eta = Math.max(0, Math.round((total - elapsed) / 1000)); // in seconds
          } else if (task.progress === 100) {
            task.eta = 0;
          }

          this.emit('task-progress', { id: task.id, progress: task.progress, eta: task.eta });
        },
        (command) => {
          this.activeTasks.set(task.id, { command, task });
        }
      );

      task.status = 'completed';
      task.progress = 100;
      task.completedAt = new Date().toISOString();
      log.info(`TaskQueue: Task ${task.id} completed successfully.`);
      const safeTask = { ...task };
      delete safeTask.taskFn; // functions cannot be serialized over IPC
      this.emit('task-completed', { id: task.id, result, task: safeTask });
    } catch (err) {
      if (task.status !== 'aborted') {
        task.status = 'failed';
        task.error = err.message;
        log.error(`TaskQueue: Task ${task.id} failed:`, err);
        this.emit('task-failed', { id: task.id, error: err.message });
      }
    } finally {
      this.activeTasks.delete(task.id);
      this.emit('queue-updated', this.getTasksSummary());
      this.processNext();
    }
  }

  /**
   * Abort a running or pending task
   * @param {string} taskId 
   */
  abort(taskId) {
    const active = this.activeTasks.get(taskId);
    if (active) {
      log.info(`TaskQueue: Aborting active task ${taskId}`);
      active.task.status = 'aborted';
      if (typeof active.task.abortHandler === 'function') {
        try { active.task.abortHandler(); } catch (e) { log.warn('TaskQueue abortHandler error:', e); }
      }
      if (active.command && typeof active.command.kill === 'function') {
        try { active.command.kill('SIGKILL'); } catch (e) {}
      }
      this.activeTasks.delete(taskId);
      this.emit('queue-updated', this.getTasksSummary());
      this.processNext();
      return true;
    }
    
    const pendingTask = this.queue.find(t => t.id === taskId && t.status === 'pending');
    if (pendingTask) {
      log.info(`TaskQueue: Aborting pending task ${taskId}`);
      pendingTask.status = 'aborted';
      this.emit('queue-updated', this.getTasksSummary());
      return true;
    }

    return false;
  }

  /**
   * Abort all running tasks
   */
  abortAll() {
    log.info('TaskQueue: Aborting all tasks');
    for (const taskId of this.activeTasks.keys()) {
      this.abort(taskId);
    }
    this.queue = [];
    this.emit('queue-updated', this.getTasksSummary());
  }

  /**
   * Get a summary of all tasks for the UI
   */
  getTasksSummary() {
    // Return only necessary info, and maybe limit to last N tasks
    return this.queue.slice(-20).map(t => ({
      id: t.id,
      type: t.type,
      metadata: t.metadata,
      status: t.status,
      progress: t.progress,
      eta: t.eta,
      error: t.error,
      createdAt: t.createdAt,
      startedAt: t.startedAt,
      completedAt: t.completedAt
    }));
  }

  /**
   * Clear completed/failed/aborted tasks from history
   */
  clearHistory() {
    this.queue = this.queue.filter(t => t.status === 'pending' || t.status === 'running');
    this.emit('queue-updated', this.getTasksSummary());
  }
}

module.exports = TaskQueue;
