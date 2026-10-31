// Minimal D1 stand-in on node:sqlite so API tests run without workerd.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// D1 accepts ArrayBuffer for BLOB columns; node:sqlite wants a typed array.
const norm = (a: unknown[]) => a.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v));

export function makeDb() {
  const sql = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(f, dir), 'utf8'));
  const db = {
    prepare(q: string) {
      let args: unknown[] = [];
      const st = {
        bind(...a: unknown[]) { args = norm(a); return st; },
        async first() { return (sql.prepare(q).get(...(args as never[])) as never) ?? null; },
        async all() { return { results: sql.prepare(q).all(...(args as never[])) }; },
        async run() { sql.prepare(q).run(...(args as never[])); return { success: true }; }
      };
      return st;
    }
  };
  return { db: db as unknown as D1Database, sql };
}
