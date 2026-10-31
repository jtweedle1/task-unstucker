// Serves the AI proxy inside `vite dev` / `vite preview`, so local development matches
// production without a separate server. Reads secrets from .env.local via loadEnv.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { handleAiRequest, type ProxyEnv } from './handler.ts';

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64_000) break; // the handler rejects oversized bodies anyway
    chunks.push(chunk as Buffer);
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v);
  }
  headers.set('x-forwarded-for', req.socket.remoteAddress ?? 'local');
  return new Request(`http://localhost${req.url ?? '/'}`, {
    method: req.method ?? 'GET',
    headers,
    ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
  });
}

export function aiProxyPlugin(): Plugin {
  let env: ProxyEnv = {};
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const response = await handleAiRequest(await toRequest(req), env);
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(await response.text());
  };
  // Must return nothing: Vite treats a returned function as a post-middleware hook.
  const mount = (server: {
    middlewares: {
      use: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => unknown;
    };
  }): void => {
    server.middlewares.use('/api/ai', (req, res) => void handle(req, res));
  };
  return {
    name: 'task-unstucker-ai-proxy',
    configResolved(config) {
      const loaded = loadEnv(config.mode, config.root, '');
      env = {
        ANTHROPIC_API_KEY: loaded.ANTHROPIC_API_KEY,
        AI_MODEL: loaded.AI_MODEL,
        APP_ACCESS_CODE: loaded.APP_ACCESS_CODE,
      };
    },
    configureServer: mount,
    configurePreviewServer: mount,
  };
}
