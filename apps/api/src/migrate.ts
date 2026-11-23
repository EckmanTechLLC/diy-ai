import { loadConfig } from './config';
import { MigrationSafetyError, openDb } from './db';

const { databasePath } = loadConfig();
try {
  openDb(databasePath);
} catch (err) {
  if (err instanceof MigrationSafetyError) {
    console.error(`Migration refused: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
console.log(`Migrations applied to ${databasePath}`);
