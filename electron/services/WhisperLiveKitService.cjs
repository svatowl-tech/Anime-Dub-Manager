const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const log = require('electron-log');
const { app } = require('electron');
const axios = require('axios');
const { trackProcess } = require('../lib/ProcessTracker.cjs');

class WhisperLiveKitService {
  constructor() {
    this.serverProcess = null;
    this.serverPort = 8009; // Use port 8009 for sidecar
    this.serverHost = '127.0.0.1';
  }

  /**
   * Запускает WhisperLiveKit сервер как sidecar процесс.
   */
  async startServer(modelName = 'base', port = 8009) {
    log.info(`[WhisperLiveKitService] Попытка запуска Sidecar сервера на порту ${port} с моделью ${modelName}`);
    if (this.serverProcess) {
      log.info(`[WhisperLiveKitService] Сервер уже запущен. PID: ${this.serverProcess.pid}`);
      return { success: true, port: this.serverPort };
    }

    this.serverPort = port;

    const isWin = process.platform === 'win32';
    const winPython = path.join(app.getPath('userData'), 'ai_env', 'python_env', 'python.exe');
    const unixPython = path.join(app.getPath('userData'), 'ai_env', 'python_env', 'bin', 'python');
    const unixPythonAlt = path.join(app.getPath('userData'), 'ai_env', 'python_env', 'python');
    
    let pythonPath = winPython;
    if (!isWin) {
      try {
        await fs.access(unixPython);
        pythonPath = unixPython;
      } catch {
        pythonPath = unixPythonAlt;
      }
    }

    log.info(`[WhisperLiveKitService] Определение пути интерпретатора Python: ${pythonPath}`);
    try {
      await fs.access(pythonPath);
      log.info('[WhisperLiveKitService] Проверка интерпретатора Python: Успешно найден.');
    } catch {
      log.error(`[WhisperLiveKitService] Ошибка: Интерпретатор Python не найден по пути: ${pythonPath}`);
      throw new Error('Среда ИИ не установлена. Пожалуйста, установите среду перед запуском сервера.');
    }

    const packagedWlk = process.resourcesPath ? path.join(process.resourcesPath, 'whisperlivekit') : null;
    let wlkPath = path.join(app.getAppPath(), 'whisperlivekit');
    if (app.isPackaged && packagedWlk) {
      try {
        await fs.access(packagedWlk);
        wlkPath = packagedWlk;
      } catch {
        // Fallback to appPath
      }
    }
    log.info(`[WhisperLiveKitService] Путь к модулю whisperlivekit: ${wlkPath}`);

    const args = [
      '-m', 'whisperlivekit.basic_server',
      '--host', this.serverHost,
      '--port', String(this.serverPort),
      '--model', modelName
    ];

    log.info(`[WhisperLiveKitService] Запуск sidecar процесса: python ${args.join(' ')}`);
    log.info(`[WhisperLiveKitService] Инициализация переменных окружения для Sidecar...`);

    const env = { 
      ...process.env, 
      PYTHONIOENCODING: 'utf-8',
      PYTHONPATH: wlkPath
    };

    // Запуск сервера в фоновом режиме
    const child = spawn(pythonPath, args, { 
      env,
      detached: false
    });

    trackProcess(child);
    this.serverProcess = child;
    log.info(`[WhisperLiveKitService] Процесс запущен с PID: ${child.pid}`);

    child.stdout.on('data', (data) => {
      log.info(`[WLK Server stdout] [PID:${child.pid}]: ${data.toString().trim()}`);
    });

    child.stderr.on('data', (data) => {
      log.warn(`[WLK Server stderr] [PID:${child.pid}]: ${data.toString().trim()}`);
    });

    child.on('close', (code) => {
      log.info(`[WhisperLiveKitService] Процесс сервера (PID:${child?.pid}) остановлен с кодом закрытия: ${code}`);
      this.serverProcess = null;
    });

    child.on('error', (err) => {
      log.error(`[WhisperLiveKitService] Ошибка процесса сервера:`, err);
    });

    // Ожидание старта сервера
    log.info('[WhisperLiveKitService] Ожидание запуска сервера (healthcheck пинги)...');
    const url = `http://${this.serverHost}:${this.serverPort}/health`;
    const maxRetries = 300;
    for (let i = 0; i < maxRetries; i++) {
      try {
        await new Promise(r => setTimeout(r, 1000));
        if (i % 5 === 0) {
          log.info(`[WhisperLiveKitService] Пинг ${url}... (попытка ${i + 1}/${maxRetries})`);
        }
        const response = await axios.get(url, { timeout: 1000 });
        log.info(`[WhisperLiveKitService] Sidecar сервер успешно ответил на healthcheck! Статус: ${response.status}. Данные: ${JSON.stringify(response.data)}`);
        return { success: true, port: this.serverPort };
      } catch (e) {
        if (i % 5 === 0) {
          log.info(`[WhisperLiveKitService] Сервер пока не доступен: ${e.message}`);
        }
      }
    }

    // Если не ответил, но процесс все еще идет
    if (this.serverProcess) {
      log.warn('[WhisperLiveKitService] Healthcheck таймаут после ' + maxRetries + ' попыток, но процесс все еще активен.');
      return { success: true, port: this.serverPort, warn: 'Healthcheck timeout' };
    }

    log.error('[WhisperLiveKitService] Не удалось дождаться ответа от сервера WhisperLiveKit, процесс завершился ошибкой.');
    throw new Error('Не удалось дождаться ответа от сервера WhisperLiveKit.');
  }

  /**
   * Останавливает WhisperLiveKit сервер.
   */
  async stopServer() {
    if (!this.serverProcess) {
      log.info('[WhisperLiveKitService] Запрос остановки: Сервер не запущен.');
      return { success: true };
    }

    const pid = this.serverProcess.pid;
    log.info(`[WhisperLiveKitService] Остановка sidecar сервера с PID: ${pid}...`);
    try {
      this.serverProcess.kill();
      this.serverProcess = null;
      log.info(`[WhisperLiveKitService] Сигнал SIGKILL успешно отправлен процессу ${pid}`);
      return { success: true };
    } catch (err) {
      log.error(`[WhisperLiveKitService] Ошибка при убийстве процесса ${pid}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Проверяет статус сервера.
   */
  async isServerRunning() {
    if (!this.serverProcess) {
      return false;
    }
    try {
      const url = `http://${this.serverHost}:${this.serverPort}/health`;
      const res = await axios.get(url, { timeout: 1000 });
      if (res.status === 200 && res.data.status === 'ok') {
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }
}

module.exports = new WhisperLiveKitService();
