import { randomUUID } from 'crypto';
import type { Express } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { ServerAuthManager } from './authMiddleware.ts';
import type { AgentToolsEngine } from './agentToolsEngine.ts';
import { createAdmMcpServer, createDirectToolExecutor } from './mcpToolsRegistry.ts';

export function mountMcpRoutes(options: {
  app: Express;
  authManager: ServerAuthManager;
  toolsEngine: AgentToolsEngine;
}) {
  const { app, authManager, toolsEngine } = options;
  const executor = createDirectToolExecutor(toolsEngine);

  const streamableSessions = new Map<string, StreamableHTTPServerTransport>();
  const sseTransports = new Map<string, SSEServerTransport>();

  // Modern MCP Streamable HTTP endpoint (/mcp)
  app.all('/mcp', authManager.requireAgentAuth, async (req, res) => {
    try {
      const sessionIdHeader = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

      if (sessionId && streamableSessions.has(sessionId)) {
        const transport = streamableSessions.get(sessionId)!;
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (req.method === 'POST' && isInitializeRequest(req.body)) {
        const mcpServer = createAdmMcpServer(executor);
        let transport: StreamableHTTPServerTransport;
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            streamableSessions.set(sid, transport);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            streamableSessions.delete(transport.sessionId);
          }
          mcpServer.close().catch(() => {});
        };
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Stateless fallback for clients sending direct tool POSTs without an initialized session
      if (req.method === 'POST' && !sessionId) {
        const mcpServer = createAdmMcpServer(executor);
        const statelessTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        res.on('close', () => {
          statelessTransport.close().catch(() => {});
          mcpServer.close().catch(() => {});
        });
        await mcpServer.connect(statelessTransport);
        await statelessTransport.handleRequest(req, res, req.body);
        return;
      }

      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: missing or invalid mcp-session-id' },
        id: null,
      });
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: err?.message || 'Internal MCP server error' },
          id: null,
        });
      }
    }
  });

  // Legacy MCP HTTP+SSE endpoint (/sse + /messages)
  app.get('/sse', authManager.requireAgentAuth, async (req, res) => {
    try {
      const transport = new SSEServerTransport('/messages', res);
      const mcpServer = createAdmMcpServer(executor);
      sseTransports.set(transport.sessionId, transport);
      res.on('close', () => {
        sseTransports.delete(transport.sessionId);
        mcpServer.close().catch(() => {});
      });
      await mcpServer.connect(transport);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).send(err?.message || 'Failed to establish MCP SSE stream');
      }
    }
  });

  app.post('/messages', authManager.requireAgentAuth, async (req, res) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
    const transport = sseTransports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: 'MCP SSE session not found' });
      return;
    }
    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || 'Failed to process MCP message' });
      }
    }
  });
}
