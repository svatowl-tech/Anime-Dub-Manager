import path from 'path';
import fsSync from 'fs';

export interface ServerRuntimeConfig {
  rootDir: string;
  isServerMode: boolean;
  dataDir: string;
  aiEnvDir: string;
  port: number;
  host: string;
  accessToken: string;
  agentToken: string;
  curatorTelegramChatId: string;
  publicBaseUrl: string;
}

export function resolveServerConfig(rootDir: string): ServerRuntimeConfig {
  if (process.argv.includes('--prod') && !process.env.NODE_ENV) {
    process.env.NODE_ENV = 'production';
  }
  const isServerMode =
    process.env.ADM_SERVER_MODE === 'true' ||
    process.env.ADM_SERVER_MODE === '1' ||
    process.argv.includes('--server');

  const portArgIdx = process.argv.indexOf('--port');
  const portEqArg = process.argv.find((arg) => arg.startsWith('--port='));
  const rawCliPort = portEqArg
    ? portEqArg.slice('--port='.length)
    : portArgIdx !== -1
      ? process.argv[portArgIdx + 1]
      : undefined;
  const cliPort = rawCliPort !== undefined ? Number(rawCliPort) : NaN;
  const rawEnvPort =
    process.env.APP_PORT ||
    (process.env.PORT && process.env.PORT !== '8080' ? process.env.PORT : undefined);
  const envPort = rawEnvPort !== undefined ? Number(rawEnvPort) : NaN;
  const port =
    !Number.isNaN(cliPort) && cliPort > 0
      ? cliPort
      : !Number.isNaN(envPort) && envPort > 0
        ? envPort
        : 3000;

  let dataDir = (process.env.ADM_DATA_DIR || '').trim();
  if (!dataDir) {
    if (isServerMode) {
      dataDir = fsSync.existsSync('/data') ? '/data' : path.join(rootDir, 'server_data');
    } else {
      dataDir = path.join(rootDir, 'mock_user_data');
    }
  }
  dataDir = path.resolve(dataDir);

  let aiEnvDir = (process.env.ADM_AI_ENV_DIR || '').trim();
  if (!aiEnvDir) {
    if (fsSync.existsSync('/opt/ai_env')) {
      aiEnvDir = '/opt/ai_env';
    } else {
      aiEnvDir = path.join(dataDir, 'ai_env');
    }
  }

  // Propagate resolved paths so shared CJS services pick them up consistently
  process.env.ADM_DATA_DIR = dataDir;
  process.env.ADM_AI_ENV_DIR = aiEnvDir;

  return {
    rootDir,
    isServerMode,
    dataDir,
    aiEnvDir,
    port,
    host: process.env.ADM_HOST || '0.0.0.0',
    accessToken: (process.env.ADM_ACCESS_TOKEN || '').trim(),
    agentToken: (process.env.ADM_AGENT_TOKEN || '').trim(),
    curatorTelegramChatId: (process.env.ADM_CURATOR_TELEGRAM_CHAT_ID || '').trim(),
    publicBaseUrl: (process.env.APP_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  };
}
