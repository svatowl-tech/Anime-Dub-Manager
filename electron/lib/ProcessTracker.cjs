const { execSync, exec } = require('child_process');
const log = require('electron-log');

let treeKill;
try {
  treeKill = require('tree-kill');
} catch (e) {
  log.warn('[ProcessTracker] tree-kill module not found. Falling back to standard kill.');
}

const activePids = new Set();
const activeChildren = new Set();

function trackProcess(child) {
  if (!child) return;

  if (typeof child === 'number') {
    activePids.add(child);
    return;
  }

  if (child.pid) {
    activePids.add(child.pid);
    activeChildren.add(child);

    const cleanup = () => {
      activePids.delete(child.pid);
      activeChildren.delete(child);
    };

    child.once('exit', cleanup);
    child.once('close', cleanup);
    child.once('error', cleanup);
  }
}

function untrackProcess(childOrPid) {
  if (!childOrPid) return;
  if (typeof childOrPid === 'number') {
    activePids.delete(childOrPid);
  } else if (childOrPid.pid) {
    activePids.delete(childOrPid.pid);
    activeChildren.delete(childOrPid);
  }
}

function killPidTree(pid) {
  if (!pid || typeof pid !== 'number') return;
  
  const isWin = process.platform === 'win32';
  if (isWin) {
    try {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true });
      log.info(`[ProcessTracker] Executed taskkill for PID ${pid}`);
    } catch (e) {
      // Ignore if process already exited
    }
  }

  if (treeKill) {
    try {
      treeKill(pid, 'SIGKILL', () => {});
    } catch (e) {}
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (e) {}
  }
}

/**
 * Synchronously terminate all active child processes and process trees.
 * Safe to execute inside process.on('exit') handlers.
 */
function killAllTrackedProcessesSync() {
  const pidsToKill = Array.from(activePids);
  if (pidsToKill.length === 0 && activeChildren.size === 0) return;

  log.info(`[ProcessTracker] Sync terminating ${pidsToKill.length} tracked PIDs...`);

  // 1. Direct SIGKILL to all active child process handles
  for (const child of activeChildren) {
    try {
      if (child && typeof child.kill === 'function') {
        child.kill('SIGKILL');
      }
    } catch (e) {}
  }

  // 2. Terminate PID trees synchronously
  const isWin = process.platform === 'win32';
  for (const pid of pidsToKill) {
    try {
      if (isWin) {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true });
      } else {
        try {
          process.kill(pid, 'SIGKILL');
        } catch (e) {}
        try {
          execSync(`pkill -P ${pid} -9`, { stdio: 'ignore' });
        } catch (e) {}
      }
    } catch (e) {}
  }

  activePids.clear();
  activeChildren.clear();
}

/**
 * Asynchronously terminate all active child processes and their process trees.
 */
async function killAllTrackedProcesses() {
  const count = activePids.size + activeChildren.size;
  if (count === 0) return;

  log.info(`[ProcessTracker] Terminating ${activePids.size} tracked PIDs and ${activeChildren.size} child handles...`);

  // 1. Send immediate SIGKILL to child objects
  for (const child of activeChildren) {
    try {
      if (typeof child.kill === 'function') {
        child.kill('SIGKILL');
      }
    } catch (e) {}
  }

  // 2. Terminate trees for all known PIDs with a strict timeout guard
  const pidsToKill = Array.from(activePids);
  activePids.clear();
  activeChildren.clear();

  const killPromises = pidsToKill.map(pid => {
    return new Promise((resolve) => {
      try {
        const isWin = process.platform === 'win32';
        if (isWin) {
          exec(`taskkill /F /T /PID ${pid}`, { windowsHide: true }, () => resolve());
        } else if (treeKill) {
          treeKill(pid, 'SIGKILL', () => resolve());
        } else {
          try {
            process.kill(pid, 'SIGKILL');
          } catch (e) {}
          resolve();
        }
      } catch (e) {
        resolve();
      }
    });
  });

  // Guarantee we don't block shutdown for more than 1500ms
  try {
    await Promise.race([
      Promise.all(killPromises),
      new Promise(r => setTimeout(r, 1500))
    ]);
  } catch (e) {
    log.error('[ProcessTracker] Error during process cleanup:', e);
  }
}

// Emergency safety hooks: guarantee termination on abnormal exit or signal
process.on('exit', () => {
  killAllTrackedProcessesSync();
});

process.on('SIGINT', () => {
  log.info('[ProcessTracker] Received SIGINT signal, cleaning up child processes...');
  killAllTrackedProcessesSync();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('[ProcessTracker] Received SIGTERM signal, cleaning up child processes...');
  killAllTrackedProcessesSync();
  process.exit(0);
});

process.on('SIGHUP', () => {
  log.info('[ProcessTracker] Received SIGHUP signal, cleaning up child processes...');
  killAllTrackedProcessesSync();
  process.exit(0);
});

module.exports = {
  trackProcess,
  untrackProcess,
  killPidTree,
  killAllTrackedProcesses,
  killAllTrackedProcessesSync
};

