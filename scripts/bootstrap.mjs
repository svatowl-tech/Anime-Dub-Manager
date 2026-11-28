import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IMAGE_APP_DIR = path.resolve(__dirname, '..');

const DATA_DIR = path.resolve(process.env.ADM_DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(IMAGE_APP_DIR, 'server_data')));
const RUNTIME_DIR = path.join(DATA_DIR, 'runtime');
const CURRENT_DIR = path.join(RUNTIME_DIR, 'current');
const PREVIOUS_DIR = path.join(RUNTIME_DIR, 'previous');
const BOOT_PENDING_FILE = path.join(RUNTIME_DIR, 'boot_pending.json');
const DATA_AI_ENV_DIR = path.join(DATA_DIR, 'ai_env');
const PREV_AI_ENV_DIR = path.join(DATA_DIR, 'ai_env_prev');
const OPT_AI_ENV_DIR = '/opt/ai_env';

const RESTART_EXIT_CODE = 75;
const CRASH_ROLLBACK_WINDOW_MS = 25000;

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function compareSemver(a = '0.0.0', b = '0.0.0') {
  const clean = (v) => String(v || '0.0.0').replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pa = clean(a);
  const pb = clean(b);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

function hasValidServerApp(dir) {
  return (
    fs.existsSync(path.join(dir, 'server.ts')) &&
    fs.existsSync(path.join(dir, 'package.json')) &&
    fs.existsSync(path.join(dir, 'dist', 'index.html'))
  );
}

function hasValidAiEnv(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  const candidates = process.platform === 'win32'
    ? [
        path.join(dir, 'python_env', 'Scripts', 'python.exe'),
        path.join(dir, 'python_env', 'python.exe'),
      ]
    : [
        path.join(dir, 'python_env', 'bin', 'python'),
        path.join(dir, 'python_env', 'bin', 'python3'),
        path.join(dir, 'bin', 'python'),
      ];
  return candidates.some((c) => fs.existsSync(c));
}

function ensureBaseDirs() {
  for (const dir of [
    DATA_DIR,
    RUNTIME_DIR,
    path.join(DATA_DIR, 'models'),
    path.join(DATA_DIR, 'models', 'torch'),
    path.join(DATA_DIR, 'models', 'huggingface'),
    path.join(DATA_DIR, 'models', 'deepfilternet'),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function performRollback(reason) {
  console.error(`[Bootstrap] Initiating automatic rollback: ${reason}`);
  const pending = readJsonSafe(BOOT_PENDING_FILE);
  try {
    if (fs.existsSync(PREVIOUS_DIR) && hasValidServerApp(PREVIOUS_DIR)) {
      const brokenDir = path.join(RUNTIME_DIR, `broken_${Date.now()}`);
      if (fs.existsSync(CURRENT_DIR)) {
        fs.renameSync(CURRENT_DIR, brokenDir);
      }
      fs.renameSync(PREVIOUS_DIR, CURRENT_DIR);
      fs.rmSync(brokenDir, { recursive: true, force: true });
      console.error('[Bootstrap] Rolled back /data/runtime/current to previous release.');
    } else if (fs.existsSync(CURRENT_DIR)) {
      fs.rmSync(CURRENT_DIR, { recursive: true, force: true });
      console.error('[Bootstrap] Removed broken /data/runtime/current; falling back to baked image app.');
    }

    if (pending?.swappedAiEnv && fs.existsSync(PREV_AI_ENV_DIR) && hasValidAiEnv(PREV_AI_ENV_DIR)) {
      const brokenAi = path.join(DATA_DIR, `ai_env_broken_${Date.now()}`);
      if (fs.existsSync(DATA_AI_ENV_DIR)) {
        fs.renameSync(DATA_AI_ENV_DIR, brokenAi);
      }
      fs.renameSync(PREV_AI_ENV_DIR, DATA_AI_ENV_DIR);
      fs.rmSync(brokenAi, { recursive: true, force: true });
      console.error('[Bootstrap] Rolled back /data/ai_env to previous runtime.');
    }
  } catch (err) {
    console.error('[Bootstrap] Rollback encountered an error:', err);
  } finally {
    fs.rmSync(BOOT_PENDING_FILE, { force: true });
    try {
      const stateFile = path.join(DATA_DIR, 'update_state.json');
      const state = readJsonSafe(stateFile) || {};
      state.status = 'error';
      state.lastError = `Автооткат после сбоя запуска: ${reason}`;
      state.rolledBackAt = new Date().toISOString();
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } catch {}
  }
}

function selectActiveAppDir() {
  const imagePkg = readJsonSafe(path.join(IMAGE_APP_DIR, 'package.json'));
  const imageVersion = imagePkg?.version || '0.0.0';

  if (hasValidServerApp(CURRENT_DIR)) {
    const currentPkg = readJsonSafe(path.join(CURRENT_DIR, 'package.json'));
    const currentVersion = currentPkg?.version || '0.0.0';
    // Prefer hot-swapped runtime only when its version is >= the Docker image version
    if (compareSemver(currentVersion, imageVersion) >= 0) {
      return { appDir: CURRENT_DIR, version: currentVersion, source: 'hot-swap' };
    }
    console.log(`[Bootstrap] Baked image v${imageVersion} is newer than hot-swapped v${currentVersion}; using baked image.`);
  }

  return { appDir: IMAGE_APP_DIR, version: imageVersion, source: 'image' };
}

function selectActiveAiEnvDir(activeApp) {
  if (process.env.ADM_AI_ENV_OVERRIDE) {
    return process.env.ADM_AI_ENV_OVERRIDE;
  }

  const appMeta = readJsonSafe(path.join(activeApp.appDir, 'src', 'build-metadata.json'));
  const optInfo = readJsonSafe(path.join(OPT_AI_ENV_DIR, 'env_info.json'));
  const dataInfo = readJsonSafe(path.join(DATA_AI_ENV_DIR, 'env_info.json'));

  if (hasValidAiEnv(DATA_AI_ENV_DIR)) {
    // If baked image is newer than hot-swap and /opt/ai_env matches the newer image's hash while /data/ai_env is stale, use /opt/ai_env
    if (
      activeApp.source === 'image' &&
      hasValidAiEnv(OPT_AI_ENV_DIR) &&
      appMeta?.aiEnvDepsHash &&
      optInfo?.aiEnvDepsHash === appMeta.aiEnvDepsHash &&
      dataInfo?.aiEnvDepsHash !== appMeta.aiEnvDepsHash
    ) {
      return OPT_AI_ENV_DIR;
    }
    return DATA_AI_ENV_DIR;
  }

  if (hasValidAiEnv(OPT_AI_ENV_DIR)) {
    return OPT_AI_ENV_DIR;
  }

  return DATA_AI_ENV_DIR;
}

let activeChild = null;
let shuttingDown = false;

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    shuttingDown = true;
    if (activeChild) {
      try {
        activeChild.kill(sig);
      } catch {}
    } else {
      process.exit(0);
    }
  });
}

async function runLoop() {
  ensureBaseDirs();

  while (!shuttingDown) {
    // Check if an unverified update crashed hard previously
    const pendingBeforeStart = readJsonSafe(BOOT_PENDING_FILE);
    if (pendingBeforeStart && Number(pendingBeforeStart.attempts || 0) >= 1) {
      performRollback('Предыдущий запуск обновлённой версии не подтвердил работоспособность');
    }

    const activeApp = selectActiveAppDir();
    const aiEnvDir = selectActiveAiEnvDir(activeApp);

    const pendingNow = readJsonSafe(BOOT_PENDING_FILE);
    if (pendingNow) {
      pendingNow.attempts = Number(pendingNow.attempts || 0) + 1;
      pendingNow.lastStartedAt = new Date().toISOString();
      fs.writeFileSync(BOOT_PENDING_FILE, JSON.stringify(pendingNow, null, 2));
    }

    const libDir = path.join(aiEnvDir, 'python_env', 'lib');
    const existingLd = process.env.LD_LIBRARY_PATH || '';
    const nextLd = fs.existsSync(libDir)
      ? (existingLd ? `${libDir}:${existingLd}` : libDir)
      : existingLd;

    const childEnv = {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'production',
      ADM_SERVER_MODE: process.env.ADM_SERVER_MODE || 'true',
      ADM_DATA_DIR: DATA_DIR,
      ADM_AI_ENV_DIR: aiEnvDir,
      ADM_IMAGE_APP_DIR: IMAGE_APP_DIR,
      ADM_BOOTSTRAP_MANAGED: 'true',
      ...(nextLd ? { LD_LIBRARY_PATH: nextLd } : {}),
    };

    // Pass through server CLI flags or defaults
    const cliArgs = process.argv.slice(2);
    const serverArgs = cliArgs.length > 0 ? ['server.ts', ...cliArgs] : ['server.ts', '--server', '--prod'];
    const tsxBin = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';

    console.log(`[Bootstrap] Launching v${activeApp.version} (${activeApp.source}) from ${activeApp.appDir} [AI_env=${aiEnvDir}]`);
    const startedAt = Date.now();

    const exitCode = await new Promise((resolve) => {
      const child = spawn(tsxBin, serverArgs, {
        cwd: activeApp.appDir,
        env: childEnv,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      activeChild = child;

      child.on('error', (err) => {
        console.error('[Bootstrap] Failed to spawn server process:', err);
        activeChild = null;
        resolve(1);
      });

      child.on('exit', (code, signal) => {
        activeChild = null;
        if (signal && shuttingDown) {
          resolve(0);
          return;
        }
        resolve(code ?? 1);
      });
    });

    if (shuttingDown) {
      process.exit(0);
    }

    if (exitCode === RESTART_EXIT_CODE) {
      console.log('[Bootstrap] Graceful update restart requested (exit 75). Rebooting into new version...');
      continue;
    }

    const uptimeMs = Date.now() - startedAt;
    if (fs.existsSync(BOOT_PENDING_FILE) && uptimeMs < CRASH_ROLLBACK_WINDOW_MS) {
      performRollback(`Сервер завершился с кодом ${exitCode} через ${Math.round(uptimeMs / 1000)}с после запуска`);
      continue;
    }

    console.error(`[Bootstrap] Server exited unexpectedly with code ${exitCode}. Exiting container.`);
    process.exit(exitCode);
  }
}

runLoop().catch((err) => {
  console.error('[Bootstrap] Fatal error:', err);
  process.exit(1);
});
