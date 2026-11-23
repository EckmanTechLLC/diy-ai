// Database safeguards: verified backup before migrating, refusal on unfinished migrations, scratch config.
// Only temporary databases under the OS temp dir are used; they are removed afterwards.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { BACKUPS_KEPT, MigrationSafetyError, openDb } from '../src/db';

const realFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');
const journal = JSON.parse(readFileSync(resolve(realFolder, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'diy-ai-dbsafe-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

/** A migrations folder holding only the first `n` real migrations. */
function oldFolder(n: number): string {
  const dir = resolve(tmp, `migrations-${n}`);
  mkdirSync(resolve(dir, 'meta'), { recursive: true });
  const entries = journal.entries.slice(0, n);
  const full = JSON.parse(readFileSync(resolve(realFolder, 'meta/_journal.json'), 'utf8'));
  writeFileSync(resolve(dir, 'meta/_journal.json'), JSON.stringify({ ...full, entries: full.entries.slice(0, n) }));
  for (const e of entries) copyFileSync(resolve(realFolder, `${e.tag}.sql`), resolve(dir, `${e.tag}.sql`));
  return dir;
}

const dbPath = () => resolve(tmp, 'db/diy-ai.sqlite');
const backupsDir = () => resolve(tmp, 'db/backups');
const backups = () => (existsSync(backupsDir()) ? readdirSync(backupsDir()) : []);
const tables = (path: string) => {
  const c = new Database(path, { readonly: true });
  const t = (c.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
  c.close();
  return t;
};

/** Creates a file database at migration level 3 holding one project; returns a still-open connection. */
function seedOld(): Database.Database {
  openDb(dbPath(), { migrationsFolder: oldFolder(3) });
  const c = new Database(dbPath());
  c.pragma('journal_mode = WAL');
  c.pragma('wal_autocheckpoint = 0');
  c.prepare('INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, 1, 1)').run('p1', 'o', 'in-wal');
  return c;
}

describe('backup before migrating', () => {
  it('writes a verified backup containing the old schema and WAL-only rows, then migrates', () => {
    const c = seedOld();
    expect(existsSync(`${dbPath()}-wal`) && readFileSync(`${dbPath()}-wal`).length > 0).toBe(true);
    openDb(dbPath());
    c.close();
    const files = backups();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^diy-ai-before-0003_familiar_hardball-\d{8}T\d{9}Z\.sqlite$/);
    const b = new Database(resolve(backupsDir(), files[0]!), { readonly: true });
    expect(b.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(b.prepare('SELECT name FROM projects').all()).toEqual([{ name: 'in-wal' }]);
    expect(b.prepare("SELECT 1 FROM sqlite_master WHERE name = 'circuits'").get()).toBeUndefined();
    b.close();
    expect(tables(dbPath())).toContain('circuits');
  });

  it('takes no backup when nothing is pending', () => {
    openDb(dbPath());
    openDb(dbPath());
    expect(backups()).toEqual([]);
  });

  it('takes no backup for a brand-new empty file or in memory', () => {
    openDb(dbPath());
    expect(backups()).toEqual([]);
    openDb(':memory:');
    expect(existsSync(resolve(process.cwd(), 'backups'))).toBe(false);
  });

  it('aborts with the database unmigrated when the backup cannot be written', () => {
    seedOld().close();
    writeFileSync(backupsDir(), 'a file where the directory should be');
    expect(() => openDb(dbPath())).toThrow(MigrationSafetyError);
    expect(tables(dbPath())).not.toContain('circuits');
  });

  it('keeps only the newest 10 backups', () => {
    seedOld().close();
    mkdirSync(backupsDir(), { recursive: true });
    for (let i = 0; i < 12; i++) {
      const f = resolve(backupsDir(), `diy-ai-before-old${i}-2020010${i % 9}T000000000Z.sqlite`);
      writeFileSync(f, 'x');
      utimesSync(f, 1_600_000_000 + i, 1_600_000_000 + i);
    }
    openDb(dbPath());
    const files = backups();
    expect(files).toHaveLength(BACKUPS_KEPT);
    expect(files.some((f) => f.includes('before-0003'))).toBe(true);
    expect(files.some((f) => f.includes('before-old0-') || f.includes('before-old1-') || f.includes('before-old2-'))).toBe(false);
  });
});

describe('unfinished migrations', () => {
  const unmigrated = () => {
    seedOld().close();
    return resolve(tmp, 'broken');
  };
  const brokenFolder = () => {
    const dir = resolve(tmp, 'broken');
    mkdirSync(resolve(dir, 'meta'), { recursive: true });
    for (const e of journal.entries) copyFileSync(resolve(realFolder, `${e.tag}.sql`), resolve(dir, `${e.tag}.sql`));
    copyFileSync(resolve(realFolder, 'meta/_journal.json'), resolve(dir, 'meta/_journal.json'));
    return dir;
  };

  it('refuses a journal entry without a SQL file', () => {
    unmigrated();
    const dir = brokenFolder();
    rmSync(resolve(dir, `${journal.entries[5]!.tag}.sql`));
    expect(() => openDb(dbPath(), { migrationsFolder: dir })).toThrow(/0005_massive_paladin.*no SQL file/);
    expect(tables(dbPath())).not.toContain('circuits');
    expect(backups()).toEqual([]);
  });

  it('refuses a SQL file without a journal entry', () => {
    unmigrated();
    const dir = brokenFolder();
    writeFileSync(resolve(dir, '0006_half_written.sql'), 'ALTER TABLE x ADD y;');
    expect(() => openDb(dbPath(), { migrationsFolder: dir })).toThrow(/0006_half_written.sql.*no entry in the journal/);
    expect(tables(dbPath())).not.toContain('circuits');
  });

  it('refuses an empty SQL file', () => {
    unmigrated();
    const dir = brokenFolder();
    writeFileSync(resolve(dir, `${journal.entries[5]!.tag}.sql`), '');
    expect(() => openDb(dbPath(), { migrationsFolder: dir })).toThrow(/empty/);
    expect(tables(dbPath())).not.toContain('circuits');
  });
});

describe('scratch mode config', () => {
  it('resolves to data-scratch/diy-ai.sqlite regardless of DATABASE_PATH', () => {
    const c = loadConfig({ DIY_AI_SCRATCH: '1', DATABASE_PATH: '/somewhere/else.sqlite' });
    expect(c.scratch).toBe(true);
    expect(c.databasePath).toMatch(/apps\/api\/data-scratch\/diy-ai\.sqlite$/);
  });
  it('uses the main database otherwise', () => {
    const c = loadConfig({});
    expect(c.scratch).toBe(false);
    expect(c.databasePath).toMatch(/apps\/api\/data\/diy-ai\.sqlite$/);
  });
  it('is wired to the scratch scripts', () => {
    const pkg = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8')).scripts;
    expect(pkg['dev:scratch']).toContain('DIY_AI_SCRATCH=1');
    expect(pkg['start:scratch']).toContain('DIY_AI_SCRATCH=1');
  });
});
