import http from 'node:http';
import httpProxy from 'http-proxy';

const PORT = Number(process.env.PORT || 10000);
const CLIENT_TARGET = 'http://127.0.0.1:6274';
const PROXY_TARGET = 'http://127.0.0.1:6277';

const AUTH_USERNAME = process.env.MCP_PROXY_USERNAME;
const AUTH_PASSWORD = process.env.MCP_PROXY_PASSWORD;

function isAuthorized(req) {
  if (!AUTH_USERNAME || !AUTH_PASSWORD) {
    return true;
  }
  const expected = `Basic ${Buffer.from(`${AUTH_USERNAME}:${AUTH_PASSWORD}`).toString('base64')}`;
  return req.headers.authorization === expected;
}

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

function targetFor(url = '/') {
  if (url.startsWith('/sse') || url.startsWith('/message') || url.startsWith('/mcp')) {
    return PROXY_TARGET;
  }
  return CLIENT_TARGET;
}

const server = http.createServer((req, res) => {
  if (!isAuthorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="MCP Inspector"' });
    res.end('Unauthorized');
    return;
  }
  proxy.web(req, res, { target: targetFor(req.url ?? '/') });
});

server.on('upgrade', (req, socket, head) => {
  if (!isAuthorized(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  proxy.ws(req, socket, head, { target: targetFor(req.url ?? '/') });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Reverse proxy listening on ${PORT}`);
});
