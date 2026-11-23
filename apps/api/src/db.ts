import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

const defaultMigrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

/** Number of pre-migration backups kept per database; older ones are pruned. */
export const BACKUPS_KEPT = 10;

/** Thrown when migrating is refused for safety; the message is meant to be shown to the user as is. */
export class MigrationSafetyError extends Error {}

interface JournalEntry {
  tag: string;
  when: number;
}

/**
 * Refuses obviously unfinished migrations: every journal entry must have a non-empty SQL file and every SQL
 * file must have a journal entry. This does NOT prove a migration is complete or correct (a half-written but
 * non-empty file passes); it only catches a missing, empty or unregistered one.
 */
function readJournal(folder: string): JournalEntry[] {
  const journalPath = resolve(folder, 'meta/_journal.json');
  if (!existsSync(journalPath)) throw new MigrationSafetyError(`Migration journal missing: ${journalPath}`);
  const entries = (JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: JournalEntry[] }).entries;
  const tags = new Set(entries.map((e) => e.tag));
  for (const e of entries) {
    const file = resolve(folder, `${e.tag}.sql`);
    if (!existsSync(file)) throw new MigrationSafetyError(`Journal entry "${e.tag}" has no SQL file (${file})`);
    if (statSync(file).size === 0 || readFileSync(file, 'utf8').trim() === '')
      throw new MigrationSafetyError(`Migration file is empty: ${file}`);
  }
  for (const f of readdirSync(folder))
    if (f.endsWith('.sql') && !tags.has(f.slice(0, -4)))
      throw new MigrationSafetyError(`Migration file ${resolve(folder, f)} has no entry in the journal`);
  return entries;
}

/** Journal entries drizzle would still apply: those newer than the last applied one recorded in the database. */
function pendingMigrations(sqlite: Database.Database, entries: JournalEntry[]): JournalEntry[] {
  const hasTable = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
  if (!hasTable) return entries;
  const row = sqlite.prepare('SELECT MAX(created_at) AS last FROM "__drizzle_migrations"').get() as { last: number | string | null };
  if (row.last === null) return entries;
  return entries.filter((e) => e.when > Number(row.last));
}

function hasUserTables(sqlite: Database.Database): boolean {
  return !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get();
}

/** Writes and verifies a consistent copy (WAL contents included, via VACUUM INTO) and prunes old ones. */
function backUp(sqlite: Database.Database, path: string, firstPendingTag: string): string {
  const dir = resolve(dirname(path), 'backups');
  const name = basename(path, extname(path));
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('.', '');
  const target = resolve(dir, `${name}-before-${firstPendingTag}-${stamp}.sqlite`);
  try {
    mkdirSync(dir, { recursive: true });
    sqlite.prepare('VACUUM INTO ?').run(target);
    const copy = new Database(target, { readonly: true });
    try {
      const result = copy.pragma('integrity_check', { simple: true });
      if (result !== 'ok') throw new Error(`integrity_check returned "${String(result)}"`);
    } finally {
      copy.close();
    }
  } catch (err) {
    try {
      rmSync(target, { force: true });
    } catch {
      // nothing to clean up
    }
    throw new MigrationSafetyError(
      `Cannot back up ${path} before migrating (${err instanceof Error ? err.message : String(err)}). Migration refused; the database was left unchanged.`,
    );
  }
  const mine = readdirSync(dir)
    .filter((f) => f.startsWith(`${name}-before-`) && f.endsWith('.sqlite'))
    .map((f) => ({ f, t: statSync(resolve(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t || (a.f < b.f ? 1 : -1));
  for (const old of mine.slice(BACKUPS_KEPT)) rmSync(resolve(dir, old.f), { force: true });
  return target;
}

/**
 * Opens a SQLite database (`:memory:` allowed), applies pending migrations and returns the Drizzle handle.
 * Before migrating an existing file that already has tables it takes a verified backup in `<dir>/backups/`;
 * throws MigrationSafetyError (database untouched) if the migration files look unfinished or the backup fails.
 */
export function openDb(path: string, options: { migrationsFolder?: string } = {}): Db {
  const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder;
  const inMemory = path === ':memory:';
  if (!inMemory) mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  try {
    sqlite.pragma('journal_mode = WAL');
    const pending = pendingMigrations(sqlite, readJournal(migrationsFolder));
    if (!inMemory && pending.length > 0 && hasUserTables(sqlite)) {
      const backup = backUp(sqlite, path, pending[0]!.tag);
      console.log(`Pending migrations (${pending.length}); database backed up to ${backup}`);
    }
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });
    return db;
  } catch (err) {
    sqlite.close();
    throw err;
  }
}
