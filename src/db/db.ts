/**
 * Database access. The app only talks to this interface, so the engine can be
 * swapped: SQLite (node:sqlite, built in) for local dev and tests, Postgres in
 * production (adapter in db/postgres.ts once the `pg` driver can be installed).
 *
 * SQL is written in a portable subset with Postgres-style `$1` placeholders.
 */
export type Param = string | number | bigint | null;

export interface Queryable {
  run(sql: string, params?: Param[]): Promise<{ changes: number }>;
  get<T>(sql: string, params?: Param[]): Promise<T | undefined>;
  all<T>(sql: string, params?: Param[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Run `fn` in a single serialisable transaction; rolls back if it throws. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** True when the error is a unique-constraint violation (both SQLite and Postgres). */
export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; errcode?: string; message?: string };
  return (
    err?.code === '23505' ||
    err?.errcode === 'SQLITE_CONSTRAINT_UNIQUE' ||
    /UNIQUE constraint failed|SQLITE_CONSTRAINT_PRIMARYKEY|duplicate key/i.test(err?.message ?? '')
  );
}
