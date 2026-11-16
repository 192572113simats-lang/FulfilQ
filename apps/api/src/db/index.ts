import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { Pool, PoolClient } from 'pg';
import { getConfig } from '../config.ts';

export type QueryParam = string | number | boolean | null;

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface DbExecutor {
  dialect: 'sqlite' | 'postgres';
  query<T = Record<string, unknown>>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
}

export interface DbClient extends DbExecutor {
  withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T>;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * Translates PostgreSQL-style $1, $2 placeholders to SQLite ? placeholders
 * and expands repeated references cleanly when needed.
 */
function translateSqlForSqlite(sql: string, params: QueryParam[]): { sql: string; params: QueryParam[] } {
  const mappedParams: QueryParam[] = [];
  const translated = sql.replace(/\$(\d+)/g, (_match, idxStr) => {
    const idx = Number(idxStr) - 1;
    mappedParams.push(params[idx] ?? null);
    return '?';
  });
  return { sql: translated, params: mappedParams };
}

class SqliteExecutor implements DbExecutor {
  public readonly dialect = 'sqlite' as const;
  private readonly sqlite: Database.Database;

  constructor(sqlite: Database.Database) {
    this.sqlite = sqlite;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: QueryParam[] = []
  ): Promise<QueryResult<T>> {
    const { sql: q, params: p } = translateSqlForSqlite(sql, params);
    const trimmed = q.trim().toUpperCase();
    const hasReturning = /\bRETURNING\b/i.test(q);
    if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || hasReturning) {
      const stmt = this.sqlite.prepare(q);
      const rows = stmt.all(...p) as T[];
      return { rows, rowCount: rows.length };
    }
    const stmt = this.sqlite.prepare(q);
    const info = stmt.run(...p);
    return { rows: [] as T[], rowCount: info.changes };
  }

  async exec(sql: string): Promise<void> {
    this.sqlite.exec(sql);
  }
}

class PostgresExecutor implements DbExecutor {
  public readonly dialect = 'postgres' as const;
  private readonly runner: Pool | PoolClient;

  constructor(runner: Pool | PoolClient) {
    this.runner = runner;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: QueryParam[] = []
  ): Promise<QueryResult<T>> {
    const res = await this.runner.query(sql, params);
    return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
  }

  async exec(sql: string): Promise<void> {
    await this.runner.query(sql);
  }
}

export class UnifiedDbClient implements DbClient {
  public readonly dialect: 'sqlite' | 'postgres';
  private sqlite?: Database.Database;
  private pgPool?: Pool;
  private sqliteTxChain: Promise<unknown> = Promise.resolve();

  constructor(opts?: { dialect?: 'sqlite' | 'postgres'; sqlitePath?: string; databaseUrl?: string }) {
    const cfg = getConfig();
    this.dialect = opts?.dialect ?? cfg.dbDialect;

    if (this.dialect === 'postgres') {
      this.pgPool = new Pool({
        connectionString: opts?.databaseUrl ?? cfg.databaseUrl,
        max: 20,
      });
    } else {
      const targetPath = opts?.sqlitePath ?? cfg.sqlitePath;
      if (targetPath !== ':memory:') {
        const dir = path.dirname(path.resolve(targetPath));
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }
      this.sqlite = new Database(targetPath);
      this.sqlite.pragma('journal_mode = WAL');
      this.sqlite.pragma('foreign_keys = ON');
      this.sqlite.pragma('busy_timeout = 8000');
    }
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: QueryParam[] = []
  ): Promise<QueryResult<T>> {
    if (this.dialect === 'postgres' && this.pgPool) {
      return new PostgresExecutor(this.pgPool).query<T>(sql, params);
    }
    if (this.sqlite) {
      return new SqliteExecutor(this.sqlite).query<T>(sql, params);
    }
    throw new Error('Database not initialized');
  }

  async exec(sql: string): Promise<void> {
    if (this.dialect === 'postgres' && this.pgPool) {
      await new PostgresExecutor(this.pgPool).exec(sql);
      return;
    }
    if (this.sqlite) {
      await new SqliteExecutor(this.sqlite).exec(sql);
      return;
    }
    throw new Error('Database not initialized');
  }

  async withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    if (this.dialect === 'postgres' && this.pgPool) {
      const client = await this.pgPool.connect();
      try {
        await client.query('BEGIN');
        const exec = new PostgresExecutor(client);
        const result = await fn(exec);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    if (this.sqlite) {
      const sqlite = this.sqlite;
      // Serialize async transactions on this single SQLite connection cleanly
      const run = this.sqliteTxChain.then(async () => {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const exec = new SqliteExecutor(sqlite);
          const result = await fn(exec);
          sqlite.exec('COMMIT');
          return result;
        } catch (err) {
          if (sqlite.inTransaction) {
            sqlite.exec('ROLLBACK');
          }
          throw err;
        }
      });
      this.sqliteTxChain = run.catch(() => undefined);
      return run;
    }

    throw new Error('Database not initialized');
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.query('SELECT 1 AS ok');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.end();
    }
    if (this.sqlite) {
      this.sqlite.close();
    }
  }
}

let sharedDb: UnifiedDbClient | null = null;

export function getDb(): UnifiedDbClient {
  if (!sharedDb) {
    sharedDb = new UnifiedDbClient();
  }
  return sharedDb;
}

export function setDbForTesting(client: UnifiedDbClient | null): void {
  sharedDb = client;
}
