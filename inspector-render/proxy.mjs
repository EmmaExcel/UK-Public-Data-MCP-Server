import http from 'node:http';
import httpProxy from 'http-proxy';

const PORT = Number(process.env.PORT || 10000);
const CLIENT_TARGET = 'http://127.0.0.1:6274';
const PROXY_TARGET = 'http://127.0.0.1:6277';

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
  proxy.web(req, res, { target: targetFor(req.url ?? '/') });
});

server.on('upgrade', (req, socket, head) => {
  proxy.ws(req, socket, head, { target: targetFor(req.url ?? '/') });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Reverse proxy listening on ${PORT}`);
});
