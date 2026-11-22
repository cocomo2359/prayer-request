// Minimal Cloudflare D1 stand-in backed by Node's built-in SQLite (node:sqlite).
// Implements only what the Worker uses: prepare().bind().first()/all()/run() and batch().
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const SCHEMA = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

export function createD1() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;'); // D1 enforces foreign keys
  raw.exec(SCHEMA);

  const plain = (row) => (row ? { ...row } : row);

  function prepare(sql) {
    const stmt = raw.prepare(sql);
    let params = [];
    const bound = {
      bind(...args) { params = args; return bound; },
      async first() { return plain(stmt.get(...params)) ?? null; },
      async all() { return { success: true, results: stmt.all(...params).map(plain) }; },
      async run() {
        const r = stmt.run(...params);
        return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
      },
      _exec() { const r = stmt.run(...params); return { success: true, meta: { changes: r.changes } }; },
    };
    return bound;
  }

  // D1 runs a batch as one transaction.
  async function batch(statements) {
    raw.exec('BEGIN');
    try {
      const out = statements.map((s) => s._exec());
      raw.exec('COMMIT');
      return out;
    } catch (err) {
      raw.exec('ROLLBACK');
      throw err;
    }
  }

  return { prepare, batch, raw };
}
