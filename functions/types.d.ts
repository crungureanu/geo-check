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
