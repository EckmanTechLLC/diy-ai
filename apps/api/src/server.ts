import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { MigrationSafetyError, openDb } from './db';

const config = loadConfig();
let db;
try {
  db = openDb(config.databasePath);
} catch (err) {
  if (err instanceof MigrationSafetyError) {
    console.error(`Startup aborted: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
const app = createApp(db, { webOrigin: config.webOrigin });

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  const which = config.scratch ? 'SCRATCH database (not your real data)' : 'main database';
  console.log(`API listening on http://${info.address}:${info.port} - using ${which}: ${config.databasePath}`);
});
