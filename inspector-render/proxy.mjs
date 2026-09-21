import http from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import httpProxy from 'http-proxy';

const PORT = Number(process.env.PORT || 10000);
const CLIENT_TARGET = 'http://127.0.0.1:6274';
const PROXY_TARGET = 'http://127.0.0.1:6277';

const INTERNAL_TOKEN = process.env.MCP_PROXY_AUTH_TOKEN || 'uk-public-data-demo';
const ALLOWED_MCP_TARGET = process.env.ALLOWED_MCP_TARGET || 'https://uk-public-data-mcp.onrender.com';

const proxy = httpProxy.createProxyServer({
  ws: true,
  xfwd: true,
  changeOrigin: true,
});

proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err);
  if (res && !res.headersSent) {
    res.writeHead(502);
    res.end('Bad gateway');
  }
});

function routeFor(path) {
  if (path === '/mcp') {
    return 'direct';
  }
  if (['/sse', '/message', '/config', '/health'].includes(path)) {
    return PROXY_TARGET;
  }
  return CLIENT_TARGET;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(res, statusCode, payload) {
  if (res.headersSent) return;
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function handleMcp(req, res) {
  try {
    const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const targetParam = requestUrl.searchParams.get('url');
    if (!targetParam) {
      sendJson(res, 400, { error: 'Missing url parameter' });
      return;
    }

    const target = new URL(targetParam);
    const allowed = new URL(ALLOWED_MCP_TARGET);
    if (target.origin !== allowed.origin) {
      sendJson(res, 400, { error: 'Target origin is not allowed' });
      return;
    }

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value) continue;
      const lowered = key.toLowerCase();
      if (['host', 'connection', 'content-length', 'authorization', 'x-mcp-proxy-auth', 'accept-encoding'].includes(lowered)) {
        continue;
      }
      headers[key] = value;
    }

    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers,
      body,
      redirect: 'follow',
    });

    const responseHeaders = {};
    for (const [key, value] of upstream.headers.entries()) {
      const lowered = key.toLowerCase();
      if (['content-encoding', 'transfer-encoding', 'connection', 'content-length'].includes(lowered)) {
        continue;
      }
      responseHeaders[key] = value;
    }

    res.writeHead(upstream.status, responseHeaders);
    if (upstream.body) {
      await pipeline(Readable.fromWeb(upstream.body), res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error('MCP forward error:', error);
    if (!res.headersSent) {
      sendJson(res, 502, { error: 'Bad gateway' });
    } else {
      res.end();
    }
  }
}

const server = http.createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];

  if (path === '/mcp') {
    void handleMcp(req, res);
    return;
  }

  const target = routeFor(path);
  if (target === PROXY_TARGET) {
    proxy.web(req, res, {
      target,
      headers: { 'x-mcp-proxy-auth': INTERNAL_TOKEN },
    });
    return;
  }

  proxy.web(req, res, { target });
});

server.on('upgrade', (req, socket, head) => {
  const path = (req.url ?? '/').split('?')[0];
  if (routeFor(path) === PROXY_TARGET) {
    proxy.ws(req, socket, head, {
      target: PROXY_TARGET,
      headers: { 'x-mcp-proxy-auth': INTERNAL_TOKEN },
    });
    return;
  }
  proxy.ws(req, socket, head, { target: CLIENT_TARGET });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Reverse proxy listening on ${PORT}`);
});
