const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const log = require('electron-log');

class EnvironmentManager {
  /**
   * Запускает процесс скачивания и установки портативной среды (Python + WhisperX).
   * 
   * @param {string} url URL-адрес для скачивания архива
   * @param {Object} window Объект окна Electron (BrowserWindow), содержащий webContents
   */
  async downloadAndInstall(url, window) {
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

    // Получаем защищенную директорию пользователя и определяем целевую папку
    const userDataPath = app.getPath('userData');
    const targetDir = path.join(userDataPath, 'ai_env');
    const zipPath = path.join(userDataPath, 'ai_env_temp.zip');

    try {
      // Отправляем начальный статус
      this._sendProgress(window, { status: 'downloading', percent: 0, message: 'Инициализация загрузки...' });

      // Очищаем предыдущие неудачные попытки скачивания (если файл остался)
      if (fs.existsSync(zipPath)) {
        await fsPromises.rm(zipPath, { force: true });
      }

      // Создаем целевую директорию, если она не существует
      await fsPromises.mkdir(targetDir, { recursive: true });

      log.info(`[EnvironmentManager] Начинаем скачивание из ${url} в ${zipPath}`);

      // Запрашиваем файл в виде потока (stream), чтобы не загружать весь файл в RAM
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
      });

      // Пытаемся получить общий размер файла из заголовков ответа для расчета процентов
      const totalLength = parseInt(response.headers['content-length'], 10);
      let downloadedLength = 0;

      // Создаем поток записи на диск
      const writer = fs.createWriteStream(zipPath);

      // Оборачиваем скачивание в Promise для удобного отслеживания завершения
      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          downloadedLength += chunk.length;

          // Рассчитываем процент, если общий размер известен
          if (totalLength) {
            const percent = Math.round((downloadedLength / totalLength) * 100);
            this._sendProgress(window, { 
              status: 'downloading', 
              percent, 
              message: `Скачивание: ${percent}%` 
            });
          } else {
            // Если сервер не отдал content-length, просто показываем объем скачанного
            const mb = (downloadedLength / (1024 * 1024)).toFixed(1);
            this._sendProgress(window, { 
              status: 'downloading', 
              percent: 0, 
              message: `Скачивание: ${mb} MB` 
            });
          }
        });

        // Перенаправляем (pipe) получаемые данные прямо в файловый поток записи
        response.data.pipe(writer);

        writer.on('finish', () => resolve());
        writer.on('error', (err) => reject(err));
        response.data.on('error', (err) => reject(err));
      });

      log.info(`[EnvironmentManager] Скачивание завершено. Начинаем распаковку в ${targetDir}`);
      this._sendProgress(window, { status: 'extracting', percent: 0, message: 'Распаковка архива...' });

      // Распаковываем архив
      try {
        await extract(zipPath, { dir: targetDir });
      } catch (extractError) {
        log.error('[EnvironmentManager] Ошибка при распаковке:', extractError);
        // В случае ошибки распаковки удаляем битую целевую папку, чтобы не оставлять сломанную среду
        if (fs.existsSync(targetDir)) {
          await fsPromises.rm(targetDir, { recursive: true, force: true });
        }
        throw new Error(`Ошибка распаковки: ${extractError.message}`);
      }

      log.info(`[EnvironmentManager] Среда успешно установлена в ${targetDir}`);
      this._sendProgress(window, { status: 'ready', percent: 100, message: 'Среда готова к использованию' });

    } catch (error) {
      log.error('[EnvironmentManager] Ошибка загрузки/установки среды:', error);
      this._sendProgress(window, { status: 'error', percent: 0, message: error.message || 'Неизвестная ошибка' });

      // Очистка частично скачанного архива при сбое (обрыв сети и т.п.)
      if (fs.existsSync(zipPath)) {
         try {
           await fsPromises.rm(zipPath, { force: true });
         } catch (rmError) {
           log.error('[EnvironmentManager] Не удалось удалить временный архив:', rmError);
         }
      }
    } finally {
      // В штатном режиме также удаляем временный архив, если распаковка прошла успешно
      if (fs.existsSync(zipPath)) {
        try {
          await fsPromises.rm(zipPath, { force: true });
        } catch (rmError) {
          log.error('[EnvironmentManager] Не удалось удалить временный архив после установки:', rmError);
        }
      }
    }
  }

  async isEnvironmentReady() {
    const userDataPath = app.getPath('userData');
    const targetDir = path.join(userDataPath, 'ai_env');
    try {
      const stats = await fsPromises.stat(targetDir);
      return stats.isDirectory();
    } catch (e) {
      return false;
    }
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
