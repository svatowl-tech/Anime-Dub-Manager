const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const log = require('electron-log');

class EnvironmentManager {
  constructor() {
    this._manifestCache = null;
    this._manifestFetchedAt = 0;
    this._installPromise = null;
  }

  getPlatformAssetTag() {
    const isMac = process.platform === 'darwin';
    const isLinux = process.platform === 'linux';
    const isArm = process.arch === 'arm64';
    if (isMac) return isArm ? 'macos_arm64' : 'macos_x64';
    if (isLinux) return isArm ? 'linux_arm64' : 'linux_x64';
    return 'windows_x64';
  }

  getTargetDir() {
    const userDataPath =
      process.env.ADM_DATA_DIR ||
      (typeof app !== 'undefined' && app.getPath ? app.getPath('userData') : process.cwd());
    return process.env.ADM_AI_ENV_DIR || path.join(userDataPath, 'ai_env');
  }

  getExpectedAiEnvDepsHash() {
    try {
      const candidates = [
        path.resolve(__dirname, '..', '..', 'scripts', 'compute-ai-env-hash.cjs'),
        typeof app !== 'undefined' && app.getAppPath
          ? path.join(app.getAppPath(), 'scripts', 'compute-ai-env-hash.cjs')
          : null,
      ].filter(Boolean);
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          const { computeAiEnvDepsHash } = require(c);
          const rootDir = path.resolve(path.dirname(c), '..');
          const hash = computeAiEnvDepsHash(rootDir);
          if (hash) return hash;
        }
      }
    } catch {}

    try {
      const metaCandidates = [
        path.resolve(__dirname, '..', '..', 'src', 'build-metadata.json'),
        typeof app !== 'undefined' && app.getAppPath
          ? path.join(app.getAppPath(), 'src', 'build-metadata.json')
          : null,
      ].filter(Boolean);
      for (const m of metaCandidates) {
        if (fs.existsSync(m)) {
          const parsed = JSON.parse(fs.readFileSync(m, 'utf8'));
          if (parsed?.aiEnvDepsHash) return parsed.aiEnvDepsHash;
        }
      }
    } catch {}

    return null;
  }

  readEnvInfo(dir) {
    if (!dir) return null;
    const candidates = [
      path.join(dir, 'env_info.json'),
      path.join(dir, 'ai_env', 'env_info.json'),
    ];
    for (const c of candidates) {
      try {
        if (fs.existsSync(c)) {
          return JSON.parse(fs.readFileSync(c, 'utf8'));
        }
      } catch {}
    }
    return null;
  }

  _resolvePythonInDir(dir) {
    if (!dir || !fs.existsSync(dir)) return null;
    const isWin = process.platform === 'win32';
    const candidates = isWin
      ? [
          path.join(dir, 'python_env', 'Scripts', 'python.exe'),
          path.join(dir, 'python_env', 'python.exe'),
          path.join(dir, 'Scripts', 'python.exe'),
          path.join(dir, 'python.exe'),
          path.join(dir, 'ai_env', 'python_env', 'Scripts', 'python.exe'),
          path.join(dir, 'ai_env', 'python_env', 'python.exe'),
        ]
      : [
          path.join(dir, 'python_env', 'bin', 'python'),
          path.join(dir, 'python_env', 'bin', 'python3'),
          path.join(dir, 'bin', 'python'),
          path.join(dir, 'bin', 'python3'),
          path.join(dir, 'python'),
          path.join(dir, 'ai_env', 'python_env', 'bin', 'python'),
          path.join(dir, 'ai_env', 'python_env', 'bin', 'python3'),
        ];

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }
    return null;
  }

  getActiveAiEnvDir() {
    const dirsToCheck = [];
    if (process.env.ADM_AI_ENV_DIR) dirsToCheck.push(process.env.ADM_AI_ENV_DIR);
    if (process.platform !== 'win32' && fs.existsSync('/opt/ai_env')) dirsToCheck.push('/opt/ai_env');
    if (process.env.ADM_DATA_DIR) dirsToCheck.push(path.join(process.env.ADM_DATA_DIR, 'ai_env'));
    if (typeof app !== 'undefined' && app.getPath) {
      try {
        dirsToCheck.push(path.join(app.getPath('userData'), 'ai_env'));
      } catch {}
    }
    dirsToCheck.push(path.join(process.cwd(), 'ai_env'));

    for (const d of dirsToCheck) {
      const py = this._resolvePythonInDir(d);
      if (py) return d;
    }
    return this.getTargetDir();
  }

  async _verifyZipSha256(filePath, expectedSha256) {
    if (!expectedSha256) return true;
    const crypto = require('crypto');
    const cleanExpected = String(expectedSha256).trim().split(/\s+/)[0].toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(cleanExpected)) return true;

    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    const actual = hash.digest('hex').toLowerCase();
    if (actual !== cleanExpected) {
      throw new Error(`Контрольная сумма AI_env не совпала (ожидалось ${cleanExpected.slice(0, 12)}, получено ${actual.slice(0, 12)})`);
    }
    return true;
  }

  async _flattenExtractedAiEnvDir(stagingDir) {
    const nestedDir = path.join(stagingDir, 'ai_env');
    if (!fs.existsSync(nestedDir)) return;
    let stat;
    try {
      stat = await fsPromises.stat(nestedDir);
    } catch {
      return;
    }
    if (!stat.isDirectory()) return;

    const nestedHasPython =
      fs.existsSync(path.join(nestedDir, 'python_env')) ||
      fs.existsSync(path.join(nestedDir, 'env_info.json'));
    if (!nestedHasPython) return;

    const tempMove = path.join(path.dirname(stagingDir), `_ai_env_flat_${Date.now()}`);
    await fsPromises.rename(nestedDir, tempMove);
    const entries = await fsPromises.readdir(tempMove);
    for (const entry of entries) {
      const src = path.join(tempMove, entry);
      const dst = path.join(stagingDir, entry);
      if (fs.existsSync(dst)) {
        await fsPromises.rm(dst, { recursive: true, force: true });
      }
      await fsPromises.rename(src, dst);
    }
    await fsPromises.rm(tempMove, { recursive: true, force: true });
  }

  async _moveDirectorySafe(srcDir, dstDir) {
    try {
      await fsPromises.rename(srcDir, dstDir);
    } catch (err) {
      if (err && (err.code === 'EXDEV' || err.code === 'EPERM' || err.code === 'EACCES')) {
        await fsPromises.cp(srcDir, dstDir, { recursive: true });
        await fsPromises.rm(srcDir, { recursive: true, force: true });
      } else {
        throw err;
      }
    }
  }

  /**
   * Запускает процесс скачивания и установки портативной среды (Python + DeepFilterNet3 + Demucs v4 + WhisperX)
   * с проверкой SHA-256, распаковкой в staging и атомарной заменой с автооткатом при сбое.
   *
   * @param {string} url URL-адрес для скачивания архива
   * @param {Object} window Объект окна Electron (BrowserWindow), содержащий webContents
   * @param {Object} [options] Дополнительные параметры ({ expectedSha256, preserveBackupDir })
   */
  async downloadAndInstall(url, window, options = {}) {
    if (this._installPromise) {
      return this._installPromise;
    }

    this._installPromise = this._performDownloadAndInstall(url, window, options).finally(() => {
      this._installPromise = null;
    });
    return this._installPromise;
  }

  async _performDownloadAndInstall(url, window, options = {}) {
    let axios;
    let extract;
    try {
      axios = require('axios');
      extract = require('extract-zip');
    } catch (reqErr) {
      log.error('[EnvironmentManager] Не удалось загрузить зависимости axios или extract-zip. Выполните npm install.', reqErr);
      this._sendProgress(window, { status: 'error', percent: 0, message: 'Отсутствуют зависимости (axios/extract-zip). Пожалуйста, выполните npm install.' });
      throw reqErr;
    }

    const userDataPath =
      process.env.ADM_DATA_DIR ||
      (typeof app !== 'undefined' && app.getPath ? app.getPath('userData') : process.cwd());
    const targetDir = options.targetDir || this.getTargetDir();
    const targetParent = path.dirname(targetDir);
    const stagingDir = path.join(targetParent, `_ai_env_staging_${Date.now()}`);
    const backupDir = options.preserveBackupDir || path.join(targetParent, `_ai_env_prev_${Date.now()}`);
    const zipPath = path.join(userDataPath, 'ai_env_temp.zip');

    try {
      this._sendProgress(window, { status: 'downloading', percent: 0, message: 'Инициализация загрузки AI-окружения...' });

      await fsPromises.mkdir(userDataPath, { recursive: true });
      await fsPromises.mkdir(targetParent, { recursive: true });

      if (fs.existsSync(zipPath)) {
        await fsPromises.rm(zipPath, { force: true });
      }
      if (fs.existsSync(stagingDir)) {
        await fsPromises.rm(stagingDir, { recursive: true, force: true });
      }

      log.info(`[EnvironmentManager] Начинаем скачивание из ${url} в ${zipPath}`);

      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        maxRedirects: 8,
        timeout: 60000,
        headers: {
          'User-Agent': 'AnimeDubManager-Updater'
        }
      });

      const totalLength = parseInt(response.headers['content-length'], 10);
      let downloadedLength = 0;
      let lastSentAt = 0;

      const writer = fs.createWriteStream(zipPath);

      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          downloadedLength += chunk.length;
          const now = Date.now();
          if (now - lastSentAt < 250 && (!totalLength || downloadedLength < totalLength)) return;
          lastSentAt = now;

          if (totalLength && totalLength > 0) {
            const percent = Math.min(99, Math.round((downloadedLength / totalLength) * 100));
            this._sendProgress(window, {
              status: 'downloading',
              percent,
              downloadedBytes: downloadedLength,
              totalBytes: totalLength,
              message: `Скачивание AI-окружения: ${percent}%`
            });
          } else {
            const mb = (downloadedLength / (1024 * 1024)).toFixed(1);
            this._sendProgress(window, {
              status: 'downloading',
              percent: 0,
              downloadedBytes: downloadedLength,
              message: `Скачивание AI-окружения: ${mb} MB`
            });
          }
        });

        response.data.pipe(writer);

        writer.on('finish', () => resolve());
        writer.on('error', (err) => reject(err));
        response.data.on('error', (err) => reject(err));
      });

      if (options.expectedSha256) {
        this._sendProgress(window, { status: 'verifying', percent: 100, message: 'Проверка контрольной суммы SHA-256...' });
        await this._verifyZipSha256(zipPath, options.expectedSha256);
      }

      log.info(`[EnvironmentManager] Скачивание завершено. Начинаем распаковку в staging: ${stagingDir}`);
      this._sendProgress(window, { status: 'extracting', percent: 0, message: 'Распаковка и настройка AI-окружения...' });

      await fsPromises.mkdir(stagingDir, { recursive: true });
      try {
        await extract(zipPath, { dir: stagingDir });
        await this._flattenExtractedAiEnvDir(stagingDir);
      } catch (extractError) {
        log.error('[EnvironmentManager] Ошибка при распаковке:', extractError);
        await fsPromises.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
        throw new Error(`Ошибка распаковки: ${extractError.message}`);
      }

      if (process.platform !== 'win32') {
        this._fixPosixPermissions(stagingDir);
      }

      const stagingPython = this._resolvePythonInDir(stagingDir);
      if (stagingPython) {
        const pyEnvDir = path.dirname(path.dirname(stagingPython));
        this._autoRepairPyvenvCfg(pyEnvDir);
      }

      // Atomic swap with rollback safety
      this._sendProgress(window, { status: 'verifying', percent: 95, message: 'Активация и проверка Python AI-окружения...' });
      let hadPrevious = false;
      if (fs.existsSync(targetDir)) {
        if (fs.existsSync(backupDir)) {
          await fsPromises.rm(backupDir, { recursive: true, force: true });
        }
        await this._moveDirectorySafe(targetDir, backupDir);
        hadPrevious = true;
      }

      try {
        await this._moveDirectorySafe(stagingDir, targetDir);
        const installedPy = this._resolvePythonInDir(targetDir);
        const works = installedPy ? this._isPythonExecutableWorking(installedPy) : false;
        if (!works) {
          throw new Error('Установленный Python-интерпретатор не прошёл проверку запуска');
        }
      } catch (swapErr) {
        log.error('[EnvironmentManager] Ошибка при активации нового AI_env, выполняем откат:', swapErr);
        await fsPromises.rm(targetDir, { recursive: true, force: true }).catch(() => {});
        if (hadPrevious && fs.existsSync(backupDir)) {
          await this._moveDirectorySafe(backupDir, targetDir).catch(() => {});
        }
        throw swapErr;
      }

      if (hadPrevious && !options.preserveBackupDir && fs.existsSync(backupDir)) {
        await fsPromises.rm(backupDir, { recursive: true, force: true }).catch(() => {});
      }

      log.info(`[EnvironmentManager] Среда AI_env успешно установлена в ${targetDir}`);
      this._sendProgress(window, { status: 'ready', percent: 100, message: 'AI-окружение готово к работе' });
      return { success: true, targetDir, envInfo: this.readEnvInfo(targetDir) };
    } catch (error) {
      log.error('[EnvironmentManager] Ошибка загрузки/установки среды:', error);
      this._sendProgress(window, { status: 'error', percent: 0, message: error.message || 'Неизвестная ошибка' });
      await fsPromises.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    } finally {
      if (fs.existsSync(zipPath)) {
        try {
          await fsPromises.rm(zipPath, { force: true });
        } catch (rmError) {
          log.error('[EnvironmentManager] Не удалось удалить временный архив после установки:', rmError);
        }
      }
    }
  }

  /**
   * Назначает флаг исполняемости для Python-бинарников на POSIX системах.
   */
  _fixPosixPermissions(dir) {
    try {
      const files = fs.readdirSync(dir, { withFileTypes: true });
      for (const file of files) {
        const fullPath = path.join(dir, file.name);
        if (file.isDirectory()) {
          this._fixPosixPermissions(fullPath);
        } else if (
          file.name === 'python' || 
          file.name === 'python3' || 
          file.name.startsWith('python3.') || 
          fullPath.includes('/bin/')
        ) {
          try {
            fs.chmodSync(fullPath, 0o755);
          } catch (e) {}
        }
      }
    } catch (err) {
      log.warn('[EnvironmentManager] Предупреждение при назначении прав POSIX:', err);
    }
  }

  /**
   * Проверяет, действительно ли исполняемый файл Python запускается в системе (не битый симлинк/shim).
   * Обязательно передает PATH с папкой интерпретатора для загрузки зависимых DLL (python310.dll, vcruntime140.dll).
   */
  _isPythonExecutableWorking(executablePath) {
    if (!executablePath) return false;
    try {
      if (!fs.existsSync(executablePath)) return false;
      const { spawnSync } = require('child_process');
      const dir = path.dirname(executablePath);
      const parentDir = path.dirname(dir);
      const delimiter = process.platform === 'win32' ? ';' : ':';
      const customPath = `${dir}${delimiter}${parentDir}${delimiter}${process.env.PATH || ''}`;

      const test = spawnSync(executablePath, ['-c', 'import sys; sys.exit(0)'], {
        timeout: 4000,
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          PATH: customPath
        }
      });
      return test.status === 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * Ищет установленный системный Python на Windows/macOS/Linux.
   */
  _findSystemPython() {
    const isWin = process.platform === 'win32';
    const { spawnSync } = require('child_process');
    const systemCandidates = [];

    if (isWin) {
      // 1. Поиск через where.exe для python.exe и python3.exe
      try {
        const whereRes = spawnSync('where.exe', ['python.exe'], { timeout: 3000, encoding: 'utf8', windowsHide: true });
        if (whereRes.status === 0 && whereRes.stdout) {
          const lines = whereRes.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          for (const line of lines) {
            systemCandidates.push(line);
          }
        }
      } catch (e) {}

      try {
        const whereRes3 = spawnSync('where.exe', ['python3.exe'], { timeout: 3000, encoding: 'utf8', windowsHide: true });
        if (whereRes3.status === 0 && whereRes3.stdout) {
          const lines = whereRes3.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          for (const line of lines) {
            systemCandidates.push(line);
          }
        }
      } catch (e) {}

      // 2. Проверка стандартного Python Launcher (py.exe)
      try {
        const pyLauncher = 'C:\\Windows\\py.exe';
        if (fs.existsSync(pyLauncher)) {
          const pyRes = spawnSync(pyLauncher, ['-3', '-c', 'import sys; print(sys.executable)'], { timeout: 3000, encoding: 'utf8', windowsHide: true });
          if (pyRes.status === 0 && pyRes.stdout) {
            const detected = pyRes.stdout.trim();
            if (detected && fs.existsSync(detected)) systemCandidates.push(detected);
          }
        }
      } catch (e) {}

      // 3. Стандартные папки установки Python на Windows
      const userProfile = process.env.USERPROFILE || '';
      const localAppData = process.env.LOCALAPPDATA || '';
      const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
      const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const systemDrive = process.env.SystemDrive || 'C:';

      const pythonVersions = ['Python310', 'Python311', 'Python312', 'Python313', 'Python39', 'Python38'];
      for (const ver of pythonVersions) {
        if (localAppData) systemCandidates.push(path.join(localAppData, 'Programs', 'Python', ver, 'python.exe'));
        if (progFiles) systemCandidates.push(path.join(progFiles, ver, 'python.exe'));
        if (progFilesX86) systemCandidates.push(path.join(progFilesX86, ver, 'python.exe'));
        systemCandidates.push(path.join(systemDrive, ver, 'python.exe'));
        systemCandidates.push(path.join(systemDrive, 'Program Files', ver, 'python.exe'));
      }

      // 4. WindowsApps / Microsoft Store
      if (localAppData) {
        systemCandidates.push(path.join(localAppData, 'Microsoft', 'WindowsApps', 'python.exe'));
        systemCandidates.push(path.join(localAppData, 'Microsoft', 'WindowsApps', 'python3.exe'));
      }

      // 5. Scoop / Chocolatey / Pyenv
      if (userProfile) {
        systemCandidates.push(path.join(userProfile, 'scoop', 'apps', 'python', 'current', 'python.exe'));
        systemCandidates.push(path.join(userProfile, '.pyenv', 'pyenv-win', 'shims', 'python.exe'));
        systemCandidates.push(path.join(userProfile, 'anaconda3', 'python.exe'));
        systemCandidates.push(path.join(userProfile, 'miniconda3', 'python.exe'));
      }
      const programData = process.env.ProgramData || 'C:\\ProgramData';
      systemCandidates.push(path.join(programData, 'chocolatey', 'bin', 'python.exe'));
    } else {
      systemCandidates.push('/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3', 'python3', 'python');
    }

    for (const cand of systemCandidates) {
      if (cand && this._isPythonExecutableWorking(cand)) {
        log.info(`[EnvironmentManager] Найден рабочий системный Python: ${cand}`);
        return cand;
      }
    }
    return null;
  }

  /**
   * Автоматически восстанавливает pyvenv.cfg и синхронизирует бинарники, 
   * если home указывает на несуществующую папку CI-билда (например C:\hostedtoolcache).
   */
  _autoRepairPyvenvCfg(envDir, workingPythonPath = null) {
    if (!envDir || !fs.existsSync(envDir)) return;
    const isWin = process.platform === 'win32';
    const cfgPath = path.join(envDir, 'pyvenv.cfg');

    try {
      // 1. На Windows: если в корне envDir есть рабочий python.exe, но в Scripts/python.exe битый стаб venvlauncher,
      // синхронизируем файлы из корня в Scripts/
      if (isWin) {
        const rootPy = path.join(envDir, 'python.exe');
        const scriptsPy = path.join(envDir, 'Scripts', 'python.exe');
        if (fs.existsSync(rootPy) && fs.existsSync(scriptsPy)) {
          try {
            // Копируем все dll и python.exe из корня в Scripts/
            const entries = fs.readdirSync(envDir, { withFileTypes: true });
            for (const ent of entries) {
              if (ent.isFile() && (ent.name.toLowerCase().endsWith('.dll') || ent.name.toLowerCase() === 'python.exe')) {
                fs.copyFileSync(path.join(envDir, ent.name), path.join(envDir, 'Scripts', ent.name));
              }
            }
          } catch (e) {}
        }
      }

      // 2. Проверяем и восстанавливаем pyvenv.cfg
      if (fs.existsSync(cfgPath)) {
        const content = fs.readFileSync(cfgPath, 'utf8');
        const lines = content.split(/\r?\n/);
        let modified = false;

        const newLines = lines.map(line => {
          if (line.trim().startsWith('home =')) {
            const oldHome = line.split('=')[1]?.trim();
            // Если oldHome не существует или указывает на папку hostedtoolcache / CI
            if (!oldHome || !fs.existsSync(oldHome) || oldHome.includes('hostedtoolcache') || oldHome === '.') {
              let targetHome = workingPythonPath ? path.dirname(workingPythonPath) : envDir;
              log.info(`[EnvironmentManager] Авто-ремонт pyvenv.cfg: ${oldHome} -> ${targetHome}`);
              modified = true;
              return `home = ${targetHome}`;
            }
          }
          return line;
        });

        if (modified) {
          fs.writeFileSync(cfgPath, newLines.join('\n'), 'utf8');
        }
      }

      // 3. Проверяем и восстанавливаем целостность torch/testing/_internal/common_dtype.py
      this._ensureTorchTestingIntegrity(envDir);
      // 4. Проверяем и устраняем несовместимость SciPy / NumPy 2.x (_fitpack_impl.py, _multiufuncs.py)
      this._ensureScipyNumpyIntegrity(envDir);
    } catch (e) {
      log.warn('[EnvironmentManager] Не удалось обновить pyvenv.cfg:', e);
    }
  }

  /**
   * Гарантирует совместимость SciPy 1.x / NumPy 2.x на диске:
   * 1. scipy/special/_multiufuncs.py (устраняет ValueError ufuncs)
   * 2. scipy/interpolate/_fitpack_impl.py (устраняет TypeError dfitpack_int)
   */
  _ensureScipyNumpyIntegrity(envDir) {
    if (!envDir || !fs.existsSync(envDir)) return;
    try {
      const siteCandidates = [
        path.join(envDir, 'Lib', 'site-packages'),
        path.join(envDir, 'lib', 'site-packages'),
        path.join(envDir, 'python_env', 'Lib', 'site-packages'),
        path.join(envDir, 'python_env', 'lib', 'site-packages'),
        path.join(envDir, 'lib', 'python3.10', 'site-packages'),
        path.join(envDir, 'lib', 'python3.11', 'site-packages'),
        path.join(envDir, 'lib', 'python3.12', 'site-packages')
      ];

      for (const siteDir of siteCandidates) {
        if (!fs.existsSync(siteDir)) continue;

        // 1. Патч scipy/special/_multiufuncs.py
        const multiufuncsP = path.join(siteDir, 'scipy', 'special', '_multiufuncs.py');
        if (fs.existsSync(multiufuncsP)) {
          try {
            const content = fs.readFileSync(multiufuncsP, 'utf8');
            if (content.includes('isinstance(ufunc, np.ufunc)') || content.includes('All ufuncs must have type')) {
              const patched = content
                .replace(/if not isinstance\(ufunc, np\.ufunc\):/g, 'if False and not isinstance(ufunc, np.ufunc):')
                .replace(/raise ValueError\("All ufuncs must have type `numpy\.ufunc`\."\)/g, 'pass');
              if (patched !== content) {
                fs.writeFileSync(multiufuncsP, patched, 'utf8');
                log.info(`[EnvironmentManager] Применен патч совместимости NumPy к ${multiufuncsP}`);
              }
            }
          } catch (e) {}
        }

        // 2. Патч scipy/interpolate/_fitpack_impl.py
        const fitpackP = path.join(siteDir, 'scipy', 'interpolate', '_fitpack_impl.py');
        if (fs.existsSync(fitpackP)) {
          try {
            const content = fs.readFileSync(fitpackP, 'utf8');
            if (content.includes('dfitpack_int') || content.includes("'iwrk': array([], dfitpack_int)")) {
              const patched = content
                .replace(/'iwrk':\s*array\(\[\],\s*dfitpack_int\)/g, "'iwrk': array([], int)")
                .replace(/"iwrk":\s*array\(\[\],\s*dfitpack_int\)/g, '"iwrk": array([], int)')
                .replace(/\bdfitpack_int\b/g, 'int');
              if (patched !== content) {
                fs.writeFileSync(fitpackP, patched, 'utf8');
                log.info(`[EnvironmentManager] Применен патч dfitpack_int к ${fitpackP}`);
              }
            }
          } catch (e) {}
        }
      }
    } catch (err) {
      log.warn('[EnvironmentManager] Предупреждение при проверке целостности scipy:', err);
    }
  }

  /**
   * Гарантирует наличие highest_precision_float в torch/testing/_internal/common_dtype.py
   * для стабильной работы PyTorch 2.x без повреждения inspect.py.
   */
  _ensureTorchTestingIntegrity(envDir) {
    if (!envDir || !fs.existsSync(envDir)) return;
    try {
      const siteCandidates = [
        path.join(envDir, 'Lib', 'site-packages'),
        path.join(envDir, 'lib', 'site-packages'),
        path.join(envDir, 'lib', 'python3.10', 'site-packages'),
        path.join(envDir, 'lib', 'python3.11', 'site-packages'),
        path.join(envDir, 'lib', 'python3.12', 'site-packages')
      ];
      const snippet = `\n# Auto-injected highest_precision_float compatibility shim for PyTorch 2.x
def highest_precision_float(device=None):
    import torch
    if device is None:
        try:
            device = torch.get_default_device()
        except Exception:
            device = "cpu"
    try:
        if hasattr(torch, "device") and torch.device(device).type == "mps":
            return torch.float32
    except Exception:
        pass
    return getattr(torch, "float64", float)
\n`;

      for (const siteDir of siteCandidates) {
        if (!fs.existsSync(siteDir)) continue;
        const torchDir = path.join(siteDir, 'torch');
        if (fs.existsSync(torchDir)) {
          // Проверяем наличие подмодуля torch/cuda
          const cudaDir = path.join(torchDir, 'cuda');
          const cudaInit = path.join(cudaDir, '__init__.py');
          if (!fs.existsSync(cudaInit)) {
            try {
              if (!fs.existsSync(cudaDir)) {
                fs.mkdirSync(cudaDir, { recursive: true });
              }
              const cudaStub = `# Auto-healed torch.cuda stub for CPU/fallback runtime
import sys
import contextlib

def is_available(): return False
def is_initialized(): return False
def device_count(): return 0
def current_device(): return 0
def get_device_name(*args, **kwargs): return ""
def init(): pass
def empty_cache(): pass
def synchronize(*args, **kwargs): pass
def set_device(*args, **kwargs): pass

class device:
    def __init__(self, idx=0): self.idx = idx
    def __enter__(self): return self
    def __exit__(self, *args): pass

class Stream:
    def __init__(self, *args, **kwargs): pass
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def synchronize(self): pass

class Event:
    def __init__(self, *args, **kwargs): pass
    def record(self, *args, **kwargs): pass
    def wait(self, *args, **kwargs): pass
    def synchronize(self): pass
    def elapsed_time(self, *args, **kwargs): return 0.0

class _Amp:
    autocast = contextlib.nullcontext
amp = _Amp()
`;
              fs.writeFileSync(cudaInit, cudaStub, 'utf8');
              log.info(`[EnvironmentManager] Восстановлен stub torch.cuda: ${cudaInit}`);
            } catch (cudaErr) {
              log.warn('[EnvironmentManager] Не удалось восстановить torch.cuda stub:', cudaErr);
            }
          }

          const testingDir = path.join(torchDir, 'testing');
          const internalDir = path.join(testingDir, '_internal');
          if (!fs.existsSync(internalDir)) {
            fs.mkdirSync(internalDir, { recursive: true });
          }
          const testingInit = path.join(testingDir, '__init__.py');
          if (!fs.existsSync(testingInit)) {
            fs.writeFileSync(testingInit, '# torch testing init\n', 'utf8');
          }
          const internalInit = path.join(internalDir, '__init__.py');
          if (!fs.existsSync(internalInit)) {
            fs.writeFileSync(internalInit, '# torch testing internal init\n', 'utf8');
          }
          const commonDtype = path.join(internalDir, 'common_dtype.py');
          if (fs.existsSync(commonDtype)) {
            const content = fs.readFileSync(commonDtype, 'utf8');
            if (!content.includes('highest_precision_float')) {
              fs.appendFileSync(commonDtype, snippet, 'utf8');
              log.info(`[EnvironmentManager] Восстановлен highest_precision_float в ${commonDtype}`);
            }
          } else {
            fs.writeFileSync(commonDtype, snippet, 'utf8');
            log.info(`[EnvironmentManager] Создан ${commonDtype} с highest_precision_float`);
          }
        }
      }
    } catch (err) {
      log.warn('[EnvironmentManager] Предупреждение при проверке целостности torch:', err);
    }
  }

  /**
   * Патчит устаревший импорт AudioMetaData в df/io.py для совместимости с TorchAudio 2.2+.
   */
  _ensureDeepFilterIntegrity(envDir) {
    if (!envDir || !fs.existsSync(envDir)) return;
    try {
      const siteCandidates = [
        path.join(envDir, 'Lib', 'site-packages'),
        path.join(envDir, 'lib', 'site-packages'),
        path.join(envDir, 'lib', 'python3.10', 'site-packages'),
        path.join(envDir, 'lib', 'python3.11', 'site-packages'),
        path.join(envDir, 'lib', 'python3.12', 'site-packages'),
        path.join(envDir, 'site-packages')
      ];
      for (const siteDir of siteCandidates) {
        if (!fs.existsSync(siteDir)) continue;
        const dfIo = path.join(siteDir, 'df', 'io.py');
        if (fs.existsSync(dfIo)) {
          const content = fs.readFileSync(dfIo, 'utf8');
          if (content.includes('from torchaudio.backend.common import AudioMetaData')) {
            const patched = content.replace(
              'from torchaudio.backend.common import AudioMetaData',
              'try:\n    from torchaudio import AudioMetaData\nexcept (ImportError, AttributeError):\n    from torchaudio.backend.common import AudioMetaData'
            );
            fs.writeFileSync(dfIo, patched, 'utf8');
            log.info(`[EnvironmentManager] Патч df/io.py успешно применен: ${dfIo}`);
          }
        }
      }
    } catch (err) {
      log.warn('[EnvironmentManager] Предупреждение при проверке df/io.py:', err);
    }
  }

  /**
   * Возвращает папки site-packages внутри ai_env для проброса через PYTHONPATH.
   */
  getPythonSitePackagesDirs(customPythonPath = null) {
    const dirs = [];
    const roots = [];
    if (typeof app !== 'undefined' && app.getPath) {
      try { roots.push(app.getPath('userData')); } catch (e) {}
    }
    roots.push(process.cwd());

    // 1. Проверяем папки относительно переданного пути к Python
    if (customPythonPath) {
      const pyDir = path.dirname(customPythonPath);
      const pyParent = path.dirname(pyDir);
      const pyCandidates = [
        path.join(pyDir, 'Lib', 'site-packages'),
        path.join(pyDir, 'lib', 'site-packages'),
        path.join(pyDir, 'lib', 'python3.10', 'site-packages'),
        path.join(pyDir, 'lib', 'python3.11', 'site-packages'),
        path.join(pyDir, 'lib', 'python3.12', 'site-packages'),
        path.join(pyParent, 'Lib', 'site-packages'),
        path.join(pyParent, 'lib', 'site-packages'),
        path.join(pyParent, 'lib', 'python3.10', 'site-packages'),
        path.join(pyParent, 'lib', 'python3.11', 'site-packages'),
        path.join(pyParent, 'lib', 'python3.12', 'site-packages'),
        path.join(pyParent, 'python_env', 'Lib', 'site-packages'),
        path.join(pyParent, 'python_env', 'lib', 'site-packages'),
        path.join(pyParent, 'python_env', 'lib', 'python3.10', 'site-packages'),
        path.join(pyParent, 'python_env', 'lib', 'python3.11', 'site-packages')
      ];
      for (const c of pyCandidates) {
        if (fs.existsSync(c)) dirs.push(c);
      }
    }

    // 2. Проверяем явные серверные пути (ADM_AI_ENV_DIR / /opt/ai_env) и стандартные корни userData/cwd
    const aiEnvRoots = [];
    if (process.env.ADM_AI_ENV_DIR) aiEnvRoots.push(process.env.ADM_AI_ENV_DIR);
    if (process.platform !== 'win32' && fs.existsSync('/opt/ai_env')) aiEnvRoots.push('/opt/ai_env');
    if (process.env.ADM_DATA_DIR) aiEnvRoots.push(path.join(process.env.ADM_DATA_DIR, 'ai_env'));
    for (const r of roots) {
      aiEnvRoots.push(path.join(r, 'ai_env'));
    }

    for (const aiEnv of aiEnvRoots) {
      const candidates = [
        path.join(aiEnv, 'python_env', 'Lib', 'site-packages'),
        path.join(aiEnv, 'python_env', 'lib', 'site-packages'),
        path.join(aiEnv, 'python_env', 'lib', 'python3.10', 'site-packages'),
        path.join(aiEnv, 'python_env', 'lib', 'python3.11', 'site-packages'),
        path.join(aiEnv, 'python_env', 'lib', 'python3.12', 'site-packages'),
        path.join(aiEnv, 'Lib', 'site-packages'),
        path.join(aiEnv, 'lib', 'site-packages'),
        path.join(aiEnv, 'lib', 'python3.10', 'site-packages'),
        path.join(aiEnv, 'lib', 'python3.11', 'site-packages'),
        path.join(aiEnv, 'ai_env', 'python_env', 'Lib', 'site-packages'),
        path.join(aiEnv, 'ai_env', 'python_env', 'lib', 'site-packages'),
        path.join(aiEnv, 'ai_env', 'python_env', 'lib', 'python3.10', 'site-packages'),
        path.join(aiEnv, 'ai_env', 'python_env', 'lib', 'python3.11', 'site-packages')
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) dirs.push(c);
      }
    }

    for (const r of roots) {
      const wlkCandidates = [
        path.join(r, 'whisperlivekit', 'venv', 'Lib', 'site-packages'),
        path.join(r, 'whisperlivekit', 'venv', 'lib', 'site-packages')
      ];
      for (const c of wlkCandidates) {
        if (fs.existsSync(c)) dirs.push(c);
      }
    }
    return [...new Set(dirs)];
  }

  /**
   * Возвращает валидный, протестированный путь к исполняемому файлу Python.
   */
  getPythonPath(customEnvDir = null) {
    const isWin = process.platform === 'win32';
    const candidatePaths = [];
    let userData = null;

    const envDirsToCheck = [];
    if (customEnvDir) envDirsToCheck.push(customEnvDir);
    if (process.env.ADM_AI_ENV_DIR) envDirsToCheck.push(process.env.ADM_AI_ENV_DIR);
    if (!isWin && fs.existsSync('/opt/ai_env')) envDirsToCheck.push('/opt/ai_env');
    if (process.env.ADM_DATA_DIR) envDirsToCheck.push(path.join(process.env.ADM_DATA_DIR, 'ai_env'));

    for (const dir of envDirsToCheck) {
      if (isWin) {
        candidatePaths.push(path.join(dir, 'python_env', 'Scripts', 'python.exe'));
        candidatePaths.push(path.join(dir, 'python_env', 'python.exe'));
        candidatePaths.push(path.join(dir, 'Scripts', 'python.exe'));
        candidatePaths.push(path.join(dir, 'python.exe'));
      } else {
        candidatePaths.push(path.join(dir, 'python_env', 'bin', 'python'));
        candidatePaths.push(path.join(dir, 'python_env', 'bin', 'python3'));
        candidatePaths.push(path.join(dir, 'bin', 'python'));
        candidatePaths.push(path.join(dir, 'bin', 'python3'));
        candidatePaths.push(path.join(dir, 'python'));
      }
    }

    if (typeof app !== 'undefined' && app.getPath) {
      try {
        userData = app.getPath('userData');
        if (isWin) {
          // Исполняемые файлы в портативной ai_env
          candidatePaths.push(path.join(userData, 'ai_env', 'python_env', 'Scripts', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python_env', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'Scripts', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'ai_env', 'python_env', 'Scripts', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'ai_env', 'python_env', 'python.exe'));
          candidatePaths.push(path.join(userData, 'whisperlivekit', 'venv', 'Scripts', 'python.exe'));
        } else {
          candidatePaths.push(path.join(userData, 'ai_env', 'python_env', 'bin', 'python'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python_env', 'bin', 'python3'));
          candidatePaths.push(path.join(userData, 'ai_env', 'bin', 'python'));
          candidatePaths.push(path.join(userData, 'ai_env', 'bin', 'python3'));
          candidatePaths.push(path.join(userData, 'ai_env', 'ai_env', 'python_env', 'bin', 'python'));
          candidatePaths.push(path.join(userData, 'ai_env', 'ai_env', 'python_env', 'bin', 'python3'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python_env', 'python'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python'));
          candidatePaths.push(path.join(userData, 'whisperlivekit', 'venv', 'bin', 'python'));
          candidatePaths.push(path.join(userData, 'whisperlivekit', 'venv', 'bin', 'python3'));
        }
      } catch (e) {}
    }

    // Check application folder and cwd
    const cwd = process.cwd();
    if (isWin) {
      candidatePaths.push(path.join(cwd, 'ai_env', 'python_env', 'Scripts', 'python.exe'));
      candidatePaths.push(path.join(cwd, 'ai_env', 'python_env', 'python.exe'));
      candidatePaths.push(path.join(cwd, 'ai_env', 'Scripts', 'python.exe'));
      candidatePaths.push(path.join(cwd, 'ai_env', 'python.exe'));
      candidatePaths.push(path.join(cwd, 'venv', 'Scripts', 'python.exe'));
      candidatePaths.push(path.join(cwd, '.venv', 'Scripts', 'python.exe'));
    } else {
      candidatePaths.push(path.join(cwd, 'ai_env', 'python_env', 'bin', 'python'));
      candidatePaths.push(path.join(cwd, 'ai_env', 'python_env', 'bin', 'python3'));
      candidatePaths.push(path.join(cwd, 'ai_env', 'bin', 'python'));
      candidatePaths.push(path.join(cwd, 'ai_env', 'bin', 'python3'));
      candidatePaths.push(path.join(cwd, 'ai_env', 'python'));
      candidatePaths.push(path.join(cwd, 'venv', 'bin', 'python'));
      candidatePaths.push(path.join(cwd, '.venv', 'bin', 'python'));
    }

    // 1. Выполняем превентивный ремонт pyvenv.cfg для всех найденных окружений
    const envDirsToRepair = new Set();
    for (const cand of candidatePaths) {
      if (cand && fs.existsSync(cand) && cand.includes('python_env')) {
        const eDir = cand.includes('Scripts') || cand.includes('bin')
          ? path.dirname(path.dirname(cand))
          : path.dirname(cand);
        envDirsToRepair.add(eDir);
      }
    }
    for (const eDir of envDirsToRepair) {
      this._autoRepairPyvenvCfg(eDir);
    }

    // 2. Проверяем кандидатов и тестируем их реальный запуск
    for (const cand of candidatePaths) {
      if (cand && fs.existsSync(cand)) {
        if (this._isPythonExecutableWorking(cand)) {
          return cand;
        }
      }
    }

    // 3. Если бинарники в ai_env не запустились напрямую, ищем системный Python
    const systemPy = this._findSystemPython();
    if (systemPy) {
      // Повторно ремонтируем ai_env с привязкой к рабочему системному Python
      for (const eDir of envDirsToRepair) {
        this._autoRepairPyvenvCfg(eDir, systemPy);
      }
      return systemPy;
    }

    // 4. Последняя попытка - стандартное имя в PATH
    const fallbackName = isWin ? 'python' : 'python3';
    if (this._isPythonExecutableWorking(fallbackName)) {
      return fallbackName;
    }

    // Если ни один вариант не работает, возвращаем лучший найденный существующий файл
    for (const cand of candidatePaths) {
      if (cand && fs.existsSync(cand)) {
        return cand;
      }
    }

    return fallbackName;
  }

  /**
   * Helper для прямого выполнения Python процессов без shell: true
   * с потоковым парсингом PROGRESS:<float> и полной передачей системных переменных
   */
  spawnPythonProcess(pythonPath, scriptArgs, options = {}) {
    const { spawn } = require('child_process');
    const { onProgress, onLog, abortSignal, operationName = 'PythonProcess', cwd } = options;

    if (!pythonPath || !fs.existsSync(pythonPath)) {
      const errMsg = `Интерпретатор Python не найден по указанному пути: "${pythonPath}". Проверьте установку AI-окружения.`;
      log.error(`[EnvironmentManager] ${errMsg}`);
      if (onLog) onLog(`❌ ${errMsg}`, 'error');
      return Promise.reject(new Error(errMsg));
    }

    const pythonDir = path.dirname(pythonPath);
    const pythonBaseDir = path.dirname(pythonDir);
    const extraPaths = [pythonDir, pythonBaseDir];
    if (process.platform === 'win32') {
      extraPaths.push(path.join(pythonBaseDir, 'Library', 'bin'));
    }
    const delimiter = path.delimiter || (process.platform === 'win32' ? ';' : ':');
    const updatedPath = `${extraPaths.join(delimiter)}${delimiter}${process.env.PATH || ''}`;

    const sitePackages = this.getPythonSitePackagesDirs(pythonPath);
    const existingPythonPath = process.env.PYTHONPATH || '';
    const fullPythonPath = sitePackages.length > 0
      ? `${sitePackages.join(delimiter)}${delimiter}${existingPythonPath}`
      : existingPythonPath;

    const persistentModelsBase = process.env.ADM_DATA_DIR || (typeof app !== 'undefined' && app.getPath ? app.getPath('userData') : process.cwd());
    const env = {
      ...process.env,
      SystemRoot: process.env.SystemRoot || (process.platform === 'win32' ? 'C:\\Windows' : undefined),
      ComSpec: process.env.ComSpec || (process.platform === 'win32' ? 'C:\\Windows\\system32\\cmd.exe' : undefined),
      PATH: updatedPath,
      PYTHONPATH: fullPythonPath,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      TORCH_HOME: process.env.TORCH_HOME || path.join(persistentModelsBase, 'models', 'torch'),
      HF_HOME: process.env.HF_HOME || path.join(persistentModelsBase, 'models', 'huggingface'),
      DEEPFILTERNET_CACHE: process.env.DEEPFILTERNET_CACHE || path.join(persistentModelsBase, 'models', 'deepfilternet'),
      ...(options.env || {})
    };

    let workingDir = cwd || path.dirname(pythonPath);
    if (workingDir.includes('.asar')) {
      workingDir = typeof app !== 'undefined' && app.getPath ? app.getPath('userData') : process.cwd();
    }

    const child = spawn(pythonPath, scriptArgs, {
      cwd: workingDir,
      env,
      shell: false,
      windowsHide: true
    });

    return new Promise((resolve, reject) => {
      let isSettled = false;
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let resultData = null;

      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          if (!isSettled) {
            isSettled = true;
            try { child.kill('SIGKILL'); } catch (e) {}
            reject(new Error(`Операция ${operationName} отменена.`));
          }
        });
      }

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        stdoutBuffer += text;
        const lines = text.split('\n');
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          if (line.startsWith('PROGRESS:')) {
            const payloadStr = line.slice('PROGRESS:'.length).trim();
            const colonIdx = payloadStr.indexOf(':');
            const numPart = colonIdx !== -1 ? payloadStr.slice(0, colonIdx).trim() : payloadStr;
            const msgPart = colonIdx !== -1 ? payloadStr.slice(colonIdx + 1).trim() : '';
            const pct = parseFloat(numPart);
            if (!isNaN(pct) && onProgress) {
              onProgress({
                percent: Math.round(pct),
                message: msgPart || `${operationName}: ${Math.round(pct)}%`
              });
            }
          } else if (line.startsWith('LOG:') && onLog) {
            onLog(line.replace('LOG:', '').trim(), 'info');
          } else if (line.startsWith('RESULT:') || line.startsWith('ENV_STATUS:')) {
            try {
              const jsonStr = line.replace(/^(RESULT|ENV_STATUS):/, '').trim();
              resultData = JSON.parse(jsonStr);
            } catch (e) {}
          } else if (onLog) {
            onLog(line, 'info');
          }
        }
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        stderrBuffer += text;
        if (onLog) onLog(`[Python STDERR] ${text.trim()}`, 'warn');
      });

      child.on('error', (err) => {
        if (!isSettled) {
          isSettled = true;
          log.error(`[EnvironmentManager] Child process spawn error: ${err.message}`);
          reject(new Error(`Не удалось запустить Python (${pythonPath}): ${err.message}`));
        }
      });

      child.on('close', (code) => {
        if (isSettled) return;
        isSettled = true;
        if (code === 0) {
          resolve(resultData || { success: true, stdout: stdoutBuffer });
        } else {
          const tailStderr = (stderrBuffer || stdoutBuffer).slice(-1200);
          const errMessage = `Процесс Python (${operationName}) завершился с кодом ошибки ${code}.\nДетали:\n${tailStderr}`;
          log.error(`[EnvironmentManager] ${errMessage}`);
          reject(new Error(errMessage));
        }
      });
    });
  }

  async isEnvironmentReady() {
    const activeDir = this.getActiveAiEnvDir();
    const portablePy = this._resolvePythonInDir(activeDir);
    if (!portablePy) {
      return false;
    }
    return this._isPythonExecutableWorking(portablePy);
  }

  async fetchLatestAiEnvManifest(force = false) {
    const now = Date.now();
    if (!force && this._manifestCache && now - this._manifestFetchedAt < 5 * 60 * 1000) {
      return this._manifestCache;
    }
    const axios = require('axios');
    const manifestUrl =
      process.env.ADM_AI_ENV_MANIFEST_URL ||
      'https://github.com/svatowl-tech/Anime-Dub-Manager/releases/download/ai-env-runtime/ai_env_manifest.json';

    try {
      const res = await axios.get(manifestUrl, {
        timeout: 12000,
        maxRedirects: 5,
        headers: { 'User-Agent': 'AnimeDubManager-Updater' }
      });
      if (res.data && typeof res.data === 'object') {
        this._manifestCache = res.data;
        this._manifestFetchedAt = now;
        return res.data;
      }
    } catch (err) {
      log.warn('[EnvironmentManager] Не удалось получить ai_env_manifest.json:', err?.message || err);
    }
    return this._manifestCache;
  }

  async getAiEnvStatus(checkRemote = false) {
    const platformTag = this.getPlatformAssetTag();
    const activeDir = this.getActiveAiEnvDir();
    const portablePy = this._resolvePythonInDir(activeDir);
    const ready = portablePy ? this._isPythonExecutableWorking(portablePy) : false;
    const installedInfo = this.readEnvInfo(activeDir);
    const expectedHash = this.getExpectedAiEnvDepsHash();
    const installedHash = installedInfo?.aiEnvDepsHash || null;

    let remoteManifest = null;
    if (checkRemote) {
      remoteManifest = await this.fetchLatestAiEnvManifest(true);
    } else if (this._manifestCache) {
      remoteManifest = this._manifestCache;
    }

    const remoteAsset = remoteManifest?.assets?.[platformTag] || null;
    const fallbackUrl = `https://github.com/svatowl-tech/Anime-Dub-Manager/releases/download/ai-env-runtime/ai_env_${platformTag}.zip`;
    const remoteAssetUrl = remoteAsset?.url || fallbackUrl;
    const remoteHash = remoteManifest?.aiEnvDepsHash || null;
    const targetHash = remoteHash || expectedHash;

    const hashMismatch = Boolean(ready && targetHash && installedHash && installedHash !== targetHash);
    const updateAvailable = Boolean(
      ready &&
        remoteHash &&
        (!installedHash || installedHash !== remoteHash)
    );

    return {
      installed: Boolean(portablePy),
      ready,
      installing: Boolean(this._installPromise),
      platformTag,
      activeDir,
      pythonPath: portablePy || null,
      installedInfo,
      installedHash,
      expectedHash,
      remoteHash,
      remoteAssetUrl,
      remoteSha256: remoteAsset?.sha256 || null,
      remoteSize: remoteAsset?.size || null,
      needsInstall: !ready,
      updateAvailable,
      hashMismatch,
    };
  }

  async installOrUpdateFromManifest(window, { customUrl = null, force = false } = {}) {
    const status = await this.getAiEnvStatus(!customUrl);
    if (!force && status.ready && !status.updateAvailable && !status.hashMismatch && !customUrl) {
      return status;
    }

    const url = customUrl || status.remoteAssetUrl;
    const expectedSha256 = !customUrl ? status.remoteSha256 : null;

    await this.downloadAndInstall(url, window, { expectedSha256 });
    return await this.getAiEnvStatus(false);
  }

  /**
   * Вспомогательный метод для отправки событий в Renderer-процесс
   */
  _sendProgress(window, payload) {
    if (window && window.webContents) {
      window.webContents.send('env-download-progress', payload);
    }
  }
}

module.exports = new EnvironmentManager();
