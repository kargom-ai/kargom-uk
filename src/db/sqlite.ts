import { DatabaseSync } from 'node:sqlite';
import type { Db, Param, Queryable } from './db.ts';

/** Convert Postgres `$1` placeholders to SQLite numbered `?1`. */
const toSqlite = (sql: string) => sql.replace(/\$(\d+)/g, '?$1');

/**
 * SQLite adapter on node:sqlite. One connection; transactions are serialised
 * with an async mutex so two concurrent requests can never interleave inside
 * BEGIN ... COMMIT.
 */
export class SqliteDb implements Db {
  private readonly db: DatabaseSync;
  private chain: Promise<unknown> = Promise.resolve();
  private inTx = false;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }

  private q(): Queryable {
    const db = this.db;
    return {
      run: async (sql, params = []) => {
        const r = db.prepare(toSqlite(sql)).run(...(params as never[]));
        return { changes: Number(r.changes) };
      },
      get: async <T>(sql: string, params: Param[] = []) =>
        db.prepare(toSqlite(sql)).get(...(params as never[])) as T | undefined,
      all: async <T>(sql: string, params: Param[] = []) => db.prepare(toSqlite(sql)).all(...(params as never[])) as T[],
    };
  }

  run(sql: string, params?: Param[]) {
    return this.q().run(sql, params);
  }
  get<T>(sql: string, params?: Param[]) {
    return this.q().get<T>(sql, params);
  }
  all<T>(sql: string, params?: Param[]) {
    return this.q().all<T>(sql, params);
  }

  async exec(sql: string) {
    this.db.exec(sql);
  }

  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this.q()); // nested: join the outer transaction
    const next = this.chain.then(async () => {
      this.inTx = true;
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn(this.q());
        this.db.exec('COMMIT');
        return out;
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      } finally {
        this.inTx = false;
      }
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  async close() {
    this.db.close();
  }
}
