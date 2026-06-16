// Minimal Cloudflare Pages Functions types.
// No package install needed — Cloudflare provides the real runtime/types at build time;
// this file is for editor IntelliSense only.

declare global {
  interface KVNamespace {
    get(key: string): Promise<string | null>;
    put(
      key: string,
      value: string,
      options?: { expirationTtl?: number; expiration?: number },
    ): Promise<void>;
    delete(key: string): Promise<void>;
  }

  // Minimal D1 (SQLite) stubs for the dual-write scaffold (functions/_lib/d1.ts).
  // Same intent as the KV stub: editor/CI IntelliSense only; the real types come
  // from the Cloudflare runtime at build time. Mirrors @cloudflare/workers-types.
  interface D1Result<T = Record<string, unknown>> {
    results: T[];
    success: boolean;
    meta: {
      changes?: number;
      last_row_id?: number;
      rows_read?: number;
      rows_written?: number;
      duration?: number;
      [k: string]: unknown;
    };
  }
  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = unknown>(colName?: string): Promise<T | null>;
    run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
    all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
    raw<T = unknown>(): Promise<T[]>;
  }
  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch<T = Record<string, unknown>>(
      statements: D1PreparedStatement[],
    ): Promise<D1Result<T>[]>;
    exec(query: string): Promise<{ count: number; duration: number }>;
  }

  interface EventContext<Env, Params extends string = string, Data = Record<string, unknown>> {
    request: Request;
    env: Env;
    params: Record<Params, string>;
    waitUntil(promise: Promise<unknown>): void;
    next(input?: Request | string, init?: RequestInit): Promise<Response>;
    data: Data;
  }

  type PagesFunction<
    Env = unknown,
    Params extends string = string,
    Data = Record<string, unknown>,
  > = (
    context: EventContext<Env, Params, Data>,
  ) => Response | Promise<Response>;
}

export {};
