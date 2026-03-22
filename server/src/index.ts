#!/usr/bin/env bun

/**
 * CallMe MCP Server
 *
 * Supports stdio (default) and Streamable HTTP transports for MCP.
 * Still starts the phone webhook HTTP server for Twilio/Telnyx callbacks.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  CallManager,
  type HttpRequestHandler,
  loadServerConfig,
} from './phone-call.js';
import { startNgrok, stopNgrok } from './ngrok.js';

type McpTransportMode = 'stdio' | 'sse' | 'streamable-http' | 'both';

interface RuntimeConfig {
  port: number;
  publicUrlOverride?: string;
  mcpTransport: McpTransportMode;
  mcpHttpPath: string;
}

interface StreamableSession {
  server: Server;
  transport: StreamableHTTPServerTransport;
}

function normalizeHttpPath(rawValue: string | undefined, fallback: string): string {
  const value = (rawValue || fallback).trim();
  if (!value) {
    return fallback;
  }

  const normalized = value.startsWith('/') ? value : `/${value}`;
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

function loadRuntimeConfig(): RuntimeConfig {
  const port = parseInt(process.env.CALLME_PORT || '3333', 10);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid CALLME_PORT: ${process.env.CALLME_PORT}`);
  }

  const rawTransport = (process.env.CALLME_MCP_TRANSPORT || 'stdio').toLowerCase();
  if (
    rawTransport !== 'stdio'
    && rawTransport !== 'sse'
    && rawTransport !== 'streamable-http'
    && rawTransport !== 'both'
  ) {
    throw new Error(
      `Invalid CALLME_MCP_TRANSPORT: ${rawTransport}. Expected one of: stdio, sse, streamable-http, both.`,
    );
  }

  const publicUrlOverride = process.env.CALLME_PUBLIC_URL?.trim();
  if (publicUrlOverride) {
    const parsed = new URL(publicUrlOverride);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`CALLME_PUBLIC_URL must use http or https: ${publicUrlOverride}`);
    }
  }

  const mcpHttpPath = normalizeHttpPath(process.env.CALLME_MCP_HTTP_PATH, '/mcp');

  for (const path of [mcpHttpPath]) {
    if (path === '/twiml' || path === '/health') {
      throw new Error(`MCP path conflicts with a built-in HTTP route: ${path}`);
    }
  }

  return {
    port,
    publicUrlOverride,
    mcpTransport: rawTransport === 'sse' ? 'streamable-http' : rawTransport,
    mcpHttpPath,
  };
}

function createMcpServer(callManager: CallManager): Server {
  const mcpServer = new Server(
    { name: 'callme', version: '3.0.0' },
    { capabilities: { tools: {} } },
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'initiate_call',
          description: 'Start a phone call with the user. Use when you need voice input, want to report completed work, or need real-time discussion.',
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'What you want to say to the user. Be natural and conversational.',
              },
            },
            required: ['message'],
          },
        },
        {
          name: 'continue_call',
          description: 'Continue an active call with a follow-up message.',
          inputSchema: {
            type: 'object',
            properties: {
              call_id: { type: 'string', description: 'The call ID from initiate_call' },
              message: { type: 'string', description: 'Your follow-up message' },
            },
            required: ['call_id', 'message'],
          },
        },
        {
          name: 'speak_to_user',
          description: 'Speak a message on an active call without waiting for a response. Use this to acknowledge requests or provide status updates before starting time-consuming operations.',
          inputSchema: {
            type: 'object',
            properties: {
              call_id: { type: 'string', description: 'The call ID from initiate_call' },
              message: { type: 'string', description: 'What to say to the user' },
            },
            required: ['call_id', 'message'],
          },
        },
        {
          name: 'end_call',
          description: 'End an active call with a closing message.',
          inputSchema: {
            type: 'object',
            properties: {
              call_id: { type: 'string', description: 'The call ID from initiate_call' },
              message: { type: 'string', description: 'Your closing message (say goodbye!)' },
            },
            required: ['call_id', 'message'],
          },
        },
      ],
    };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      if (request.params.name === 'initiate_call') {
        const { message } = request.params.arguments as { message: string };
        const result = await callManager.initiateCall(message);

        return {
          content: [{
            type: 'text',
            text: `Call initiated successfully.\n\nCall ID: ${result.callId}\n\nUser's response:\n${result.response}\n\nUse continue_call to ask follow-ups or end_call to hang up.`,
          }],
        };
      }

      if (request.params.name === 'continue_call') {
        const { call_id, message } = request.params.arguments as { call_id: string; message: string };
        const response = await callManager.continueCall(call_id, message);

        return {
          content: [{ type: 'text', text: `User's response:\n${response}` }],
        };
      }

      if (request.params.name === 'speak_to_user') {
        const { call_id, message } = request.params.arguments as { call_id: string; message: string };
        await callManager.speakOnly(call_id, message);

        return {
          content: [{ type: 'text', text: `Message spoken: "${message}"` }],
        };
      }

      if (request.params.name === 'end_call') {
        const { call_id, message } = request.params.arguments as { call_id: string; message: string };
        const { durationSeconds } = await callManager.endCall(call_id, message);

        return {
          content: [{ type: 'text', text: `Call ended. Duration: ${durationSeconds}s` }],
        };
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  return mcpServer;
}

function getHeaderValue(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

function writeJsonError(
  res: ServerResponse,
  statusCode: number,
  message: string,
): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message,
    },
    id: null,
  }));
}

function createWebTransportRequestHandler(
  callManager: CallManager,
  config: RuntimeConfig,
  streamableSessions: Map<string, StreamableSession>,
): HttpRequestHandler {
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const sessionId = getHeaderValue(req.headers['mcp-session-id']);
    if (url.pathname !== config.mcpHttpPath) {
      return false;
    }

    if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
      res.writeHead(405, { Allow: 'GET, POST, DELETE' });
      res.end('Method Not Allowed');
      return true;
    }

    if (req.method === 'GET' && !sessionId) {
      writeJsonError(res, 405, 'Method not allowed.');
      return true;
    }

    if (sessionId) {
      const session = streamableSessions.get(sessionId);
      if (!session) {
        writeJsonError(res, 404, 'Unknown session ID');
        return true;
      }

      await session.transport.handleRequest(req, res);
      return true;
    }

    if (req.method !== 'POST') {
      writeJsonError(res, 400, 'Bad Request: No valid session ID provided');
      return true;
    }

    let transport!: StreamableHTTPServerTransport;
    const server = createMcpServer(callManager);
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (initializedSessionId) => {
        streamableSessions.set(initializedSessionId, { server, transport });
      },
    });
    transport.onclose = () => {
      const activeSessionId = transport.sessionId;
      if (activeSessionId) {
        streamableSessions.delete(activeSessionId);
      }
    };
    transport.onerror = (error) => {
      console.error('Streamable HTTP transport error:', error);
    };
    server.onerror = (error) => {
      console.error('Streamable HTTP MCP server error:', error);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res);
    return true;
  };
}

async function closeStreamableSessions(sessions: Map<string, StreamableSession>): Promise<void> {
  await Promise.all(
    Array.from(sessions.values()).map(async ({ server, transport }) => {
      try {
        await transport.close();
      } catch (error) {
        console.error('Error closing Streamable HTTP transport:', error);
      }

      try {
        await server.close();
      } catch (error) {
        console.error('Error closing Streamable HTTP session:', error);
      }
    }),
  );
  sessions.clear();
}

function formatPublicHttpUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}`).toString();
}

async function main() {
  const runtimeConfig = loadRuntimeConfig();
  const useStdio = runtimeConfig.mcpTransport === 'stdio' || runtimeConfig.mcpTransport === 'both';
  const useWebTransport = (
    runtimeConfig.mcpTransport === 'streamable-http'
    || runtimeConfig.mcpTransport === 'both'
  );

  let publicUrl: string;
  let usingNgrok = false;

  if (runtimeConfig.publicUrlOverride) {
    publicUrl = runtimeConfig.publicUrlOverride;
    console.error(`Using configured public URL: ${publicUrl}`);
  } else {
    console.error('Starting ngrok tunnel...');
    try {
      publicUrl = await startNgrok(runtimeConfig.port);
      usingNgrok = true;
      console.error(`ngrok tunnel: ${publicUrl}`);
    } catch (error) {
      console.error('Failed to start ngrok:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }

  let serverConfig;
  try {
    serverConfig = loadServerConfig(publicUrl);
  } catch (error) {
    console.error('Configuration error:', error instanceof Error ? error.message : error);
    if (usingNgrok) {
      await stopNgrok();
    }
    process.exit(1);
  }

  const callManager = new CallManager(serverConfig);
  const streamableSessions = new Map<string, StreamableSession>();
  const requestHandler = useWebTransport
    ? createWebTransportRequestHandler(callManager, runtimeConfig, streamableSessions)
    : undefined;

  callManager.startServer({ handleRequest: requestHandler });

  let stdioServer: Server | null = null;
  if (useStdio) {
    stdioServer = createMcpServer(callManager);
    const transport = new StdioServerTransport();
    await stdioServer.connect(transport);
  }

  console.error('');
  console.error('CallMe MCP server ready');
  console.error(`Phone: ${serverConfig.phoneNumber} -> ${serverConfig.userPhoneNumber}`);
  console.error(`Providers: phone=${serverConfig.providers.phone.name}, tts=${serverConfig.providers.tts.name}, stt=${serverConfig.providers.stt.name}`);
  console.error(`MCP transport: ${runtimeConfig.mcpTransport}`);
  if (useWebTransport) {
    console.error(`MCP Streamable HTTP endpoint: ${formatPublicHttpUrl(publicUrl, runtimeConfig.mcpHttpPath)}`);
  }
  console.error('');

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    console.error('\nShutting down...');

    await closeStreamableSessions(streamableSessions);
    if (stdioServer) {
      await stdioServer.close().catch((error) => {
        console.error('Error closing stdio MCP server:', error);
      });
    }
    callManager.shutdown();
    if (usingNgrok) {
      await stopNgrok();
    }

    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
}

main().catch(async (error) => {
  console.error('Fatal error:', error);
  await stopNgrok().catch(() => undefined);
  process.exit(1);
});
