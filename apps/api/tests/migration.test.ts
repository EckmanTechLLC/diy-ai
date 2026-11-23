// Data migration 0005: a project's single circuit becomes a row of `circuits`. Proven on an in-memory database
// built from migrations 0-4 and upgraded with the real migrator. Never touches a database file.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, describe, expect, it } from 'vitest';
import { FIXTURES } from '@diy-ai/core/fixtures';

const folder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');
const journal = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };

const tmp = mkdtempSync(resolve(tmpdir(), 'diy-ai-mig-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
/** A migrations folder holding only the first `n` real migrations (a temporary copy; the real folder is never written). */
function foldersUpTo(n: number): string {
  const dir = resolve(tmp, `migrations-${n}`);
  mkdirSync(resolve(dir, 'meta'), { recursive: true });
  writeFileSync(resolve(dir, 'meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: journalFull.entries.slice(0, n) }));
  for (const e of journal.entries.slice(0, n)) copyFileSync(resolve(folder, `${e.tag}.sql`), resolve(dir, `${e.tag}.sql`));
  return dir;
}
const journalFull = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8'));
const folder05 = foldersUpTo(6);
const folder06 = foldersUpTo(7);

/** An in-memory database at the schema of migrations 0-4, with drizzle's bookkeeping saying so. */
function oldDatabase() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const old = journal.entries.slice(0, 5);
  for (const e of old)
    for (const stmt of readFileSync(resolve(folder, `${e.tag}.sql`), 'utf8').split('--> statement-breakpoint')) sqlite.exec(stmt);
  sqlite.exec('CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
  sqlite.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)').run('old', old[4]!.when);
  return sqlite;
}

const j = (v: unknown) => JSON.stringify(v);
const finding = { ruleId: 'wire-colour-role', severity: 'warning', message: 'm', involved: ['a'], citation: { edition: 'nec-2023', section: null, confirmed: false } };
const blocks = [{ type: 'switch_lights', count: 3, switchLabel: 'Switch', switchBoxLabel: 'Switch box', lightLabel: 'Light', lightBoxLabel: 'Light box' }];
const titled = (title: string) => ({ ...FIXTURES[1]!, title });

interface Seed {
  id: string;
  owner: string;
  circuit: unknown | null;
  origin: unknown | null;
  findings: unknown | null;
  expectName: string | null; // null: the project has no circuit
}
const seeds: Seed[] = [
  { id: 'p-template', owner: 'local', circuit: FIXTURES[0], origin: { kind: 'template', templateId: 'single_pole_switch', params: { breakerAmps: 15 } }, findings: null, expectName: FIXTURES[0]!.title },
  { id: 'p-blocks', owner: 'local', circuit: FIXTURES[1], origin: { kind: 'blocks', breakerAmps: 15, name: 'Basement lights', blocks }, findings: [finding], expectName: 'Basement lights' },
  { id: 'p-custom', owner: 'local', circuit: FIXTURES[2], origin: { kind: 'custom', verified: false }, findings: [], expectName: FIXTURES[2]!.title },
  { id: 'p-none', owner: 'local', circuit: null, origin: null, findings: null, expectName: null },
  { id: 'p-example', owner: 'local', circuit: FIXTURES[3], origin: null, findings: null, expectName: FIXTURES[3]!.title },
  { id: 'p-blank-name', owner: 'local', circuit: titled('Fallback title'), origin: { kind: 'blocks', breakerAmps: 20, name: '  ', blocks }, findings: null, expectName: 'Fallback title' },
  { id: 'p-no-title', owner: 'local', circuit: titled(''), origin: null, findings: null, expectName: 'Circuit 1' },
  { id: 'p-long', owner: 'local', circuit: FIXTURES[1], origin: { kind: 'blocks', breakerAmps: 15, name: 'x'.repeat(100), blocks }, findings: null, expectName: 'x'.repeat(80) },
  { id: 'p-foreign', owner: 'someone-else', circuit: FIXTURES[0], origin: { kind: 'custom', verified: false }, findings: [finding], expectName: FIXTURES[0]!.title },
];

function seed(sqlite: Database.Database) {
  const insertProject = sqlite.prepare(
    'INSERT INTO projects (id, owner_id, name, description, circuit, circuit_origin, circuit_findings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  seeds.forEach((s, i) =>
    insertProject.run(s.id, s.owner, `Project ${s.id}`, 'notes', s.circuit === null ? null : j(s.circuit), s.origin === null ? null : j(s.origin), s.findings === null ? null : j(s.findings), 100 + i, 200 + i),
  );
  const insertMessage = sqlite.prepare(
    'INSERT INTO messages (id, project_id, role, content, kind, reply, origin, error_code, findings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  insertMessage.run('m1', 'p-blocks', 'user', 'basement lights', null, null, null, null, null, 1);
  insertMessage.run('m2', 'p-blocks', 'assistant', 'Done.', 'circuit', j({ kind: 'circuit' }), j({ kind: 'blocks', breakerAmps: 15, name: 'Basement lights', blocks }), null, j([finding]), 2);
  insertMessage.run('m3', 'p-custom', 'assistant', 'Failed.', 'error', null, null, 'rules_failed', j([finding]), 3);
  insertMessage.run('m4', 'p-none', 'user', 'hello', null, null, null, null, null, 4);
  sqlite.prepare('INSERT INTO llm_endpoints (id, owner_id, label, base_url, model, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('e1', 'local', 'L', 'http://x', 'm', 5);
  sqlite.prepare('INSERT INTO settings (owner_id, key, value, updated_at) VALUES (?, ?, ?, ?)').run('local', 'k', 'v', 6);
}

const dump = (sqlite: Database.Database, sql: string) => sqlite.prepare(sql).all() as Record<string, unknown>[];

describe('migration 0005: circuits table', () => {
  it('moves every project circuit into circuits, byte-equal, and loses nothing else', () => {
    const sqlite = oldDatabase();
    seed(sqlite);
    const before = {
      projects: dump(sqlite, 'SELECT * FROM projects ORDER BY id'),
      messages: dump(sqlite, 'SELECT * FROM messages ORDER BY id'),
      endpoints: dump(sqlite, 'SELECT * FROM llm_endpoints'),
      settings: dump(sqlite, 'SELECT * FROM settings'),
    };
    expect(before.projects).toHaveLength(seeds.length);

    migrate(drizzle(sqlite), { migrationsFolder: folder05 });

    const rows = dump(sqlite, 'SELECT * FROM circuits');
    const withCircuit = seeds.filter((s) => s.circuit !== null);
    expect(rows).toHaveLength(withCircuit.length);
    for (const s of seeds) {
      const mine = rows.filter((r) => r.project_id === s.id);
      const old = before.projects.find((p) => p.id === s.id)!;
      if (s.expectName === null) {
        expect(mine, s.id).toHaveLength(0);
        continue;
      }
      expect(mine, s.id).toHaveLength(1);
      const r = mine[0]!;
      expect(r.name, s.id).toBe(s.expectName);
      expect(r.position).toBe(0);
      expect(typeof r.id).toBe('string');
      expect((r.id as string).length).toBeGreaterThan(8);
      // byte-equal as stored JSON text, and equal as parsed JSON
      expect(r.circuit, s.id).toBe(old.circuit);
      expect(JSON.parse(r.circuit as string)).toEqual(s.circuit);
      expect(r.origin, s.id).toBe(old.circuit_origin);
      expect(r.findings, s.id).toBe(old.circuit_findings);
      expect(r.origin === null ? null : JSON.parse(r.origin as string)).toEqual(s.origin);
      expect(r.findings === null ? null : JSON.parse(r.findings as string)).toEqual(s.findings);
      expect(r.created_at).toBe(old.created_at);
      expect(r.updated_at).toBe(old.updated_at);
    }
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);

    // the three template / blocks / custom origins are all among the migrated circuits
    expect(rows.map((r) => (r.origin === null ? 'none' : (JSON.parse(r.origin as string) as { kind: string }).kind)).sort()).toEqual(
      ['blocks', 'blocks', 'blocks', 'custom', 'custom', 'none', 'none', 'template'].sort(),
    );

    // projects lose exactly the three circuit columns and keep every other value
    const cols = dump(sqlite, 'PRAGMA table_info(projects)').map((c) => c.name);
    expect(cols).toEqual(['id', 'owner_id', 'name', 'description', 'created_at', 'updated_at']);
    expect(dump(sqlite, 'SELECT * FROM projects ORDER BY id')).toEqual(
      before.projects.map(({ circuit: _a, circuit_origin: _b, circuit_findings: _c, ...rest }) => rest),
    );

    // messages intact; only the new circuit_id column (null) is added
    expect(dump(sqlite, 'SELECT * FROM messages ORDER BY id')).toEqual(before.messages.map((m) => ({ ...m, circuit_id: null })));
    expect(dump(sqlite, 'SELECT * FROM llm_endpoints')).toEqual(before.endpoints);
    expect(dump(sqlite, 'SELECT * FROM settings')).toEqual(before.settings);

    // constraints: index present, foreign keys consistent, message circuit_id is set null on delete, circuits cascade with the project
    expect(dump(sqlite, "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'circuits_project_id_position_idx'")).toHaveLength(1);
    expect(dump(sqlite, 'PRAGMA foreign_key_check')).toEqual([]);
    const blocksCircuit = rows.find((r) => r.project_id === 'p-blocks')!.id;
    sqlite.prepare('UPDATE messages SET circuit_id = ? WHERE id = ?').run(blocksCircuit, 'm2');
    sqlite.prepare('DELETE FROM circuits WHERE id = ?').run(blocksCircuit);
    expect(dump(sqlite, "SELECT circuit_id FROM messages WHERE id = 'm2'")).toEqual([{ circuit_id: null }]);
    sqlite.prepare("DELETE FROM projects WHERE id = 'p-custom'").run();
    expect(dump(sqlite, "SELECT id FROM circuits WHERE project_id = 'p-custom'")).toEqual([]);
  });

  it('migrating an old database with no projects, and a fresh database, both end at the same schema', () => {
    const empty = oldDatabase();
    migrate(drizzle(empty), { migrationsFolder: folder05 });
    const fresh = new Database(':memory:');
    migrate(drizzle(fresh), { migrationsFolder: folder05 });
    const shape = (s: Database.Database) => dump(s, "SELECT name, sql FROM sqlite_master WHERE name NOT LIKE '\\_\\_%' ESCAPE '\\' ORDER BY name").map((r) => r.name);
    expect(shape(empty)).toEqual(shape(fresh));
    expect(dump(empty, 'SELECT * FROM circuits')).toEqual([]);
  });

  it('migrations 0-4 are the five earlier journal entries, and 0005 is the sixth', () => {
    expect(journal.entries.map((e) => e.tag.slice(0, 4)).slice(0, 6)).toEqual(['0000', '0001', '0002', '0003', '0004', '0005']);
  });
});

describe('migration 0006: plan storage', () => {
  const NEW = { projects: ['inventory', 'plan_options', 'plan_built_at'], circuits: ['plan'], messages: ['plan'] };

  /** A database at migrations 0-5 (real migrator on a trimmed copy), seeded through the 0005 schema. */
  function databaseAt0005() {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    migrate(drizzle(sqlite), { migrationsFolder: folder05 });
    const p = sqlite.prepare('INSERT INTO projects (id, owner_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    p.run('p1', 'local', 'One', 'notes', 1, 2);
    p.run('p2', 'someone-else', 'Two', '', 3, 4);
    p.run('p3', 'local', 'Empty', '', 5, 6);
    const c = sqlite.prepare('INSERT INTO circuits (id, project_id, name, position, circuit, origin, findings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    c.run('c1', 'p1', 'Basement lights', 0, j(FIXTURES[1]), j({ kind: 'blocks', breakerAmps: 15, name: 'Basement lights', blocks }), j([finding]), 10, 11);
    c.run('c2', 'p1', 'Second', 1, j(FIXTURES[2]), j({ kind: 'custom', verified: false }), null, 12, 13);
    c.run('c3', 'p2', 'Theirs', 0, j(FIXTURES[0]), null, null, 14, 15);
    const m = sqlite.prepare('INSERT INTO messages (id, project_id, role, content, kind, reply, origin, circuit_id, error_code, findings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    m.run('m1', 'p1', 'user', 'basement lights', null, null, null, null, null, null, 1);
    m.run('m2', 'p1', 'assistant', 'Done.', 'circuit', j({ kind: 'circuit' }), j({ kind: 'blocks', breakerAmps: 15, name: 'Basement lights', blocks }), 'c1', null, j([finding]), 2);
    m.run('m3', 'p2', 'assistant', 'Failed.', 'error', null, null, null, 'rules_failed', j([finding]), 3);
    return sqlite;
  }

  it('every existing row is unchanged and the new columns are null', () => {
    const sqlite = databaseAt0005();
    const before = { projects: dump(sqlite, 'SELECT * FROM projects ORDER BY id'), circuits: dump(sqlite, 'SELECT * FROM circuits ORDER BY id'), messages: dump(sqlite, 'SELECT * FROM messages ORDER BY id') };
    expect(before.projects).toHaveLength(3);
    expect(before.circuits).toHaveLength(3);
    expect(before.messages).toHaveLength(3);

    migrate(drizzle(sqlite), { migrationsFolder: folder06 });

    const withNew = (rows: Record<string, unknown>[], cols: string[]) => rows.map((r) => ({ ...r, ...Object.fromEntries(cols.map((c) => [c, null])) }));
    expect(dump(sqlite, 'SELECT * FROM projects ORDER BY id')).toEqual(withNew(before.projects, NEW.projects));
    expect(dump(sqlite, 'SELECT * FROM circuits ORDER BY id')).toEqual(withNew(before.circuits, NEW.circuits));
    expect(dump(sqlite, 'SELECT * FROM messages ORDER BY id')).toEqual(withNew(before.messages, NEW.messages));
    for (const [table, cols] of Object.entries(NEW)) {
      const names = dump(sqlite, `PRAGMA table_info(${table})`).map((c) => c.name);
      for (const col of cols) expect(names, `${table}.${col}`).toContain(col);
      for (const col of cols) expect(dump(sqlite, `PRAGMA table_info(${table})`).find((c) => c.name === col)!.notnull, `${table}.${col} nullable`).toBe(0);
    }
    expect(dump(sqlite, 'PRAGMA foreign_key_check')).toEqual([]);
    expect(dump(sqlite, 'SELECT COUNT(*) AS n FROM __drizzle_migrations')).toEqual([{ n: 7 }]);
  });

  it('is purely additive: only ADD COLUMN statements, no drops, no data statements', () => {
    const sql = readFileSync(resolve(folder, `${journal.entries[6]!.tag}.sql`), 'utf8');
    const stmts = sql.split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);
    expect(stmts).toHaveLength(5);
    for (const x of stmts) expect(x).toMatch(/^ALTER TABLE `\w+` ADD `\w+` (text|integer);?$/);
    expect(sql).not.toMatch(/DROP|INSERT|UPDATE|DELETE/i);
  });

  it('the seventh journal entry is 0006 and migrations 0-5 are byte-unchanged', () => {
    expect(journal.entries.length).toBeGreaterThanOrEqual(7);
    expect(journal.entries[6]!.tag.slice(0, 4)).toBe('0006');
    const sha = (f: string) => createHash('sha256').update(readFileSync(resolve(folder, f))).digest('hex');
    expect(journal.entries.slice(0, 6).map((e) => sha(`${e.tag}.sql`))).toEqual([
      '476255ea26ae01e87b1454e3c4be5b7c3d08779a5e7de86b33468beb0df11a3b',
      '990fb49c5d23d72bbd1c2fbd80d05981ddccde23db3b7714014a38460a139e19',
      'c52f7225a7a1f44031fc5c0f057352e054c53efaec9d0ff0240e566f6230dcc6',
      '08b1078dd44bdeaf81066f077c7bebf28be871fa04cc5f9fec54e28b5cb3fefb',
      '49bdccc0d3d3cd6ee40f06a5a8c8cb9b8486c0e91f1a8b8ef68ab17842addbd8',
      '965ecaf535438a67dc3cb9ada3aa32323f51943dc0619e17ce9190036e5435e8',
    ]);
  });
});

describe('migration 0007: cable lengths', () => {
  const sha = (f: string) => createHash('sha256').update(readFileSync(resolve(folder, f))).digest('hex');

  /** A database at migrations 0-6 (real migrator on a trimmed copy), seeded through the 0006 schema. */
  function databaseAt0006() {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    migrate(drizzle(sqlite), { migrationsFolder: folder06 });
    sqlite.prepare('INSERT INTO projects (id, owner_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('p1', 'local', 'One', 'notes', 1, 2);
    const c = sqlite.prepare('INSERT INTO circuits (id, project_id, name, position, circuit, origin, findings, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    c.run('c1', 'p1', 'Basement lights', 0, j(FIXTURES[1]), j({ kind: 'blocks', breakerAmps: 15, name: 'Basement lights', blocks }), j([finding]), j({ protection: { gfci: 'none', afci: true } }), 10, 11);
    c.run('c2', 'p1', 'Second', 1, j(FIXTURES[2]), j({ kind: 'custom', verified: false }), null, null, 12, 13);
    sqlite.prepare('INSERT INTO messages (id, project_id, role, content, kind, circuit_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('m1', 'p1', 'assistant', 'Done.', 'circuit', 'c1', 2);
    return sqlite;
  }

  it('existing rows are unchanged and the new column is null', () => {
    const sqlite = databaseAt0006();
    const before = { projects: dump(sqlite, 'SELECT * FROM projects'), circuits: dump(sqlite, 'SELECT * FROM circuits ORDER BY id'), messages: dump(sqlite, 'SELECT * FROM messages') };
    expect(before.circuits).toHaveLength(2);

    migrate(drizzle(sqlite), { migrationsFolder: folder });

    expect(dump(sqlite, 'SELECT * FROM circuits ORDER BY id')).toEqual(before.circuits.map((r) => ({ ...r, cable_lengths: null })));
    expect(dump(sqlite, 'SELECT * FROM projects')).toEqual(before.projects);
    expect(dump(sqlite, 'SELECT * FROM messages')).toEqual(before.messages);
    const col = dump(sqlite, 'PRAGMA table_info(circuits)').find((x) => x.name === 'cable_lengths')!;
    expect(col).toMatchObject({ type: 'TEXT', notnull: 0 });
    expect(dump(sqlite, 'PRAGMA foreign_key_check')).toEqual([]);
    expect(dump(sqlite, 'SELECT COUNT(*) AS n FROM __drizzle_migrations')).toEqual([{ n: 8 }]);
  });

  it('is one additive column and nothing else', () => {
    const sql = readFileSync(resolve(folder, `${journal.entries[7]!.tag}.sql`), 'utf8');
    const stmts = sql.split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);
    expect(stmts).toEqual(['ALTER TABLE `circuits` ADD `cable_lengths` text;']);
    expect(sql).not.toMatch(/DROP|INSERT|UPDATE|DELETE/i);
  });

  it('the eighth journal entry is 0007 and migration 0006 is byte-unchanged', () => {
    expect(journal.entries.length).toBeGreaterThanOrEqual(8);
    expect(journal.entries[7]!.tag.slice(0, 4)).toBe('0007');
    expect(sha(`${journal.entries[6]!.tag}.sql`)).toBe('848e67d5315b8697bff3a7d562816cc6469a7b4b03b5154ecb97ef20ea9f6746');
  });
});
