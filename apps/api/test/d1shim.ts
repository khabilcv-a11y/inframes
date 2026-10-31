// Minimal D1 stand-in on node:sqlite so API tests run without workerd.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function makeDb() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(q: string) {
      let args: unknown[] = [];
      const st = {
        bind(...a: unknown[]) { args = a; return st; },
        async first() { return (sql.prepare(q).get(...(args as never[])) as never) ?? null; },
        async all() { return { results: sql.prepare(q).all(...(args as never[])) }; },
        async run() { sql.prepare(q).run(...(args as never[])); return { success: true }; }
      };
      return st;
    }
  };
  return { db: db as unknown as D1Database, sql };
}
