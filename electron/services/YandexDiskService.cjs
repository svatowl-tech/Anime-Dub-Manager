const axios = require('axios');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const log = require('electron-log');

class YandexDiskService {
  constructor(clientId, clientSecret, redirectUri) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.baseUrl = 'https://cloud-api.yandex.net/v1/disk/resources';
  }

  getAuthUrl() {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
    });
    return `https://oauth.yandex.ru/authorize?${params.toString()}`;
  }

  async exchangeCodeForToken(code) {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    try {
      const response = await axios.post('https://oauth.yandex.ru/token', params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      return response.data;
    } catch (error) {
      log.error('YandexDisk: Failed to exchange code for token', error.response?.data || error.message);
      throw error;
    }
  }

  async getFileMeta(token, remotePath) {
    try {
      log.info(`YandexDisk: Fetching meta for ${remotePath}`);
      const response = await axios.get(this.baseUrl, {
        params: { path: remotePath },
        headers: { Authorization: `OAuth ${token}` },
      });
      log.info(`YandexDisk: Successfully fetched meta for ${remotePath}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        log.info(`YandexDisk: Resource not found (404) at ${remotePath}`);
        return null;
      }
      log.error(`YandexDisk: Failed to get file meta for ${remotePath}`, error.response?.data || error.message);
      throw error;
    }
  }

  async ensureFolder(token, remotePath) {
    let basePath = '';
    let foldersToCreate = [];

    log.info(`YandexDisk: Ensuring folder exists at ${remotePath}`);
    if (remotePath.startsWith('app:/')) {
      basePath = 'app:/';
      foldersToCreate = remotePath.replace('app:/', '').split('/').filter(Boolean);
    } else if (remotePath.startsWith('disk:/')) {
      basePath = 'disk:/';
      foldersToCreate = remotePath.replace('disk:/', '').split('/').filter(Boolean);
    } else {
      foldersToCreate = remotePath.split('/').filter(Boolean);
      // Optional: prefix with / if it was just implicit relative path, but let's stick to base
      basePath = '/';
    }

    let currentPath = basePath === '/' ? '' : basePath;
    
    for (const part of foldersToCreate) {
      if (currentPath && !currentPath.endsWith('/')) {
        currentPath += '/' + part;
      } else {
        currentPath += part;
      }
      
      try {
        log.info(`YandexDisk: Attempting to create folder part: ${currentPath}`);
        await axios.put(this.baseUrl, null, {
          params: { path: currentPath },
          headers: { Authorization: `OAuth ${token}` },
        });
        log.info(`YandexDisk: Successfully created folder ${currentPath}`);
      } catch (error) {
        if (error.response?.status !== 409) { // 409 means folder already exists
          log.error(`YandexDisk: Failed to create folder ${currentPath}:`, error.response?.data || error.message);
          throw error;
        } else {
          log.info(`YandexDisk: Folder ${currentPath} already exists.`);
        }
      }
    }
  }

  async uploadFile(token, localPath, remotePath) {
    try {
      log.info(`YandexDisk: Requesting upload URL for ${remotePath}`);
      // 1. Get upload URL
      const { data } = await axios.get(`${this.baseUrl}/upload`, {
        params: { path: remotePath, overwrite: true },
        headers: { Authorization: `OAuth ${token}` },
      });

      log.info(`YandexDisk: Upload URL received, starting upload of ${localPath}`);
      // 2. Upload file
      const stat = await fs.stat(localPath);
      const readStream = fsSync.createReadStream(localPath);
      await axios.put(data.href, readStream, {
        headers: { 
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });

      log.info(`YandexDisk: Successfully uploaded ${localPath} to ${remotePath}`);
      return true;
    } catch (error) {
      log.error(`YandexDisk: Failed to upload ${localPath} to ${remotePath}`, error.response?.data || error.message);
      throw error;
    }
  }

  async downloadFile(token, remotePath, localPath) {
    try {
      // 1. Get download URL
      const { data } = await axios.get(`${this.baseUrl}/download`, {
        params: { path: remotePath },
        headers: { Authorization: `OAuth ${token}` },
      });

      // 2. Download file
      const response = await axios.get(data.href, { responseType: 'arraybuffer' });
      await fs.writeFile(localPath, response.data);

      return true;
    } catch (error) {
      log.error(`YandexDisk: Failed to download ${remotePath} to ${localPath}`, error.response?.data || error.message);
      throw error;
    }
  }
  async getDiskInfo(token) {
    try {
      const response = await axios.get('https://cloud-api.yandex.net/v1/disk/', {
        headers: { Authorization: `OAuth ${token}` }
      });
      return response.data;
    } catch (error) {
      log.error('YandexDisk: Failed to get disk info', error.response?.data || error.message);
      throw error;
    }
  }

  async getFlatFilesList(token, limit = 20, offset = 0, media_type = null) {
    try {
      const params = { limit, offset };
      if (media_type) params.media_type = media_type;

      const response = await axios.get(`${this.baseUrl}/files`, {
        params,
        headers: { Authorization: `OAuth ${token}` }
      });
      return response.data;
    } catch (error) {
      log.error('YandexDisk: Failed to get flat files list', error.response?.data || error.message);
      throw error;
    }
  }

  async copyResource(token, from, toPath, overwrite = false) {
    try {
      const response = await axios.post(`${this.baseUrl}/copy`, null, {
        params: { from, path: toPath, overwrite },
        headers: { Authorization: `OAuth ${token}` }
      });
      return response.data;
    } catch (error) {
      log.error(`YandexDisk: Failed to copy resource from ${from} to ${toPath}`, error.response?.data || error.message);
      throw error;
    }
  }

  async moveResource(token, from, toPath, overwrite = false) {
    try {
      const response = await axios.post(`${this.baseUrl}/move`, null, {
        params: { from, path: toPath, overwrite },
        headers: { Authorization: `OAuth ${token}` }
      });
      return response.data;
    } catch (error) {
      log.error(`YandexDisk: Failed to move resource from ${from} to ${toPath}`, error.response?.data || error.message);
      throw error;
    }
  }

  async deleteResource(token, remotePath, permanently = false) {
    try {
      const response = await axios.delete(this.baseUrl, {
        params: { path: remotePath, permanently },
        headers: { Authorization: `OAuth ${token}` }
      });
      // 204 No Content for success without body, 202 Accepted for async
      return response.status === 202 ? response.data : true;
    } catch (error) {
      log.error(`YandexDisk: Failed to delete resource at ${remotePath}`, error.response?.data || error.message);
      throw error;
    }
  }

  async createFolder(token, remotePath) {
    try {
      const response = await axios.put(this.baseUrl, null, {
        params: { path: remotePath },
        headers: { Authorization: `OAuth ${token}` }
      });
      return response.data;
    } catch (error) {
       if (error.response?.status === 409) return null; // already exists
       log.error(`YandexDisk: Failed to create folder ${remotePath}`, error.response?.data || error.message);
       throw error;
    }
  }

  async publishResource(token, remotePath) {
    try {
      log.info(`YandexDisk: Attempting to publish resource ${remotePath}`);
      const response = await axios.put(`${this.baseUrl}/publish`, null, {
        params: { path: remotePath },
        headers: { Authorization: `OAuth ${token}` }
      });
      log.info(`YandexDisk: Successfully published resource ${remotePath}`);
      return response.data;
    } catch (error) {
      log.error(`YandexDisk: Failed to publish resource ${remotePath}`, error.response?.data || error.message);
      throw error;
    }
  }

  async unpublishResource(token, remotePath) {
    try {
      log.info(`YandexDisk: Attempting to unpublish resource ${remotePath}`);
      const response = await axios.put(`${this.baseUrl}/unpublish`, null, {
        params: { path: remotePath },
        headers: { Authorization: `OAuth ${token}` }
      });
      log.info(`YandexDisk: Successfully unpublished resource ${remotePath}`);
      return response.data;
    } catch (error) {
      log.error(`YandexDisk: Failed to unpublish resource ${remotePath}`, error.response?.data || error.message);
      throw error;
    }
  }

  async getPublicResourceMeta(publicKey, relativePath = null) {
    try {
      const params = { public_key: publicKey };
      if (relativePath) params.path = relativePath;
      
      const response = await axios.get('https://cloud-api.yandex.net/v1/disk/public/resources', {
        params
      });
      return response.data;
    } catch (error) {
      log.error(`YandexDisk: Failed to get public resource meta for ${publicKey}`, error.response?.data || error.message);
      throw error;
    }
  }

  async downloadPublicResource(publicKey, relativePath = null, localPath) {
    try {
      const params = { public_key: publicKey };
      if (relativePath) params.path = relativePath;

      const { data } = await axios.get('https://cloud-api.yandex.net/v1/disk/public/resources/download', {
        params
      });
      
      const response = await axios.get(data.href, { responseType: 'arraybuffer' });
      await fs.writeFile(localPath, response.data);
      return true;
    } catch (error) {
      log.error(`YandexDisk: Failed to download public resource ${publicKey}`, error.response?.data || error.message);
      throw error;
    }
  }

  async savePublicResourceToDisk(token, publicKey, relativePath = null, saveName = null) {
    try {
      const params = { public_key: publicKey };
      if (relativePath) params.path = relativePath;
      if (saveName) params.name = saveName;

      const response = await axios.post('https://cloud-api.yandex.net/v1/disk/public/resources/save-to-disk', null, {
        params,
        headers: { Authorization: `OAuth ${token}` }
      });
      return response.data;
    } catch (error) {
      log.error(`YandexDisk: Failed to save public resource to disk ${publicKey}`, error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = YandexDiskService;
