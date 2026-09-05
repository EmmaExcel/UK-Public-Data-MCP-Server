import 'dotenv/config';
import { startServer } from './server.js';

startServer().catch((error: unknown) => {
  console.error(
    'Failed to start UK public data MCP server:',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
