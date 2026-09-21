import http from 'node:http';
import httpProxy from 'http-proxy';

const PORT = Number(process.env.PORT || 10000);
const CLIENT_TARGET = 'http://127.0.0.1:6274';
const PROXY_TARGET = 'http://127.0.0.1:6277';

const INTERNAL_TOKEN = process.env.MCP_PROXY_AUTH_TOKEN || 'uk-public-data-demo';

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

function proxyOptions(target) {
  const options = { target };
  if (target === PROXY_TARGET) {
    options.headers = { authorization: `Bearer ${INTERNAL_TOKEN}` };
  }
  return options;
}

const server = http.createServer((req, res) => {
  proxy.web(req, res, proxyOptions(targetFor(req.url ?? '/')));
});

server.on('upgrade', (req, socket, head) => {
  proxy.ws(req, socket, head, proxyOptions(targetFor(req.url ?? '/')));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Reverse proxy listening on ${PORT}`);
});
