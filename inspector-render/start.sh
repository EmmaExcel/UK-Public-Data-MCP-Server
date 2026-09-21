#!/bin/sh
set -e

export MCP_PROXY_FULL_ADDRESS="${MCP_PROXY_FULL_ADDRESS:-${RENDER_EXTERNAL_URL:-http://localhost:${PORT}}}"
export MCP_PROXY_AUTH_TOKEN="${MCP_PROXY_AUTH_TOKEN:-uk-public-data-demo}"
export DANGEROUSLY_OMIT_AUTH="${DANGEROUSLY_OMIT_AUTH:-true}"

mcp-inspector &
INSPECTOR_PID=$!

wait_for_port() {
  node -e "
    const net = require('net');
    const socket = net.connect(Number(process.argv[1]), '127.0.0.1');
    socket.on('connect', () => process.exit(0));
    socket.on('error', () => process.exit(1));
  " "$1"
}

echo "Waiting for Inspector on 6274/6277..."
until wait_for_port 6274 && wait_for_port 6277; do
  sleep 0.2
done

echo "Starting reverse proxy on port ${PORT}..."
exec node proxy.mjs
