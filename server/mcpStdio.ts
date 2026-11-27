import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ADM_TOOL_CATALOG, createAdmMcpServer, type ToolExecutor } from './mcpToolsRegistry.ts';

dotenv.config();

function resolveAgentCredentials() {
  const serverUrl = (
    process.env.ADM_SERVER_URL ||
    `http://127.0.0.1:${process.env.APP_PORT || process.env.PORT || 3000}`
  ).replace(/\/+$/, '');

  let agentToken = (process.env.ADM_AGENT_TOKEN || '').trim();
  if (!agentToken) {
    const candidateDirs = [
      process.env.ADM_DATA_DIR,
      '/data',
      path.join(process.cwd(), 'server_data'),
      path.join(process.cwd(), 'mock_user_data'),
    ].filter(Boolean) as string[];

    for (const dir of candidateDirs) {
      const authFile = path.join(dir, 'server_auth.json');
      try {
        if (fs.existsSync(authFile)) {
          const parsed = JSON.parse(fs.readFileSync(authFile, 'utf8'));
          if (parsed?.agentToken) {
            agentToken = String(parsed.agentToken);
            break;
          }
        }
      } catch {}
    }
  }
  return { serverUrl, agentToken };
}

async function main() {
  const { serverUrl, agentToken } = resolveAgentCredentials();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (agentToken) {
    headers.Authorization = `Bearer ${agentToken}`;
  }

  let cachedPlaybook = '# Anime Dub Manager Curator Playbook\nCall get_overview or read /api/v1/playbook on the ADM server.';
  try {
    const res = await axios.get(`${serverUrl}/api/v1/playbook`, { headers, timeout: 4000 });
    if (typeof res.data === 'string' && res.data.trim()) {
      cachedPlaybook = res.data;
    }
  } catch {
    // Server may still be starting; requests below will resolve dynamically
  }

  const executor: ToolExecutor = {
    async execute(toolName: string, args: Record<string, any>) {
      const res = await axios.post(`${serverUrl}/api/v1/tools/${encodeURIComponent(toolName)}`, args || {}, {
        headers,
        timeout: 180000,
      });
      if (!res.data?.success) {
        throw new Error(res.data?.error || `Tool "${toolName}" failed`);
      }
      return res.data.data;
    },
    getPlaybook() {
      return cachedPlaybook;
    },
    listTools() {
      return ADM_TOOL_CATALOG;
    },
  };

  const server = createAdmMcpServer(executor);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[ADM MCP stdio] Fatal error:', err?.message || err);
  process.exit(1);
});
