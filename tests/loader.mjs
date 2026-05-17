// Minimal ESM resolve hook: the codebase uses extensionless relative
// imports (Cloudflare's bundler resolves them; Node does not). This
// loader appends .ts (or /index.ts) so the REAL source runs unmodified
// under `node --import ./tests/loader.mjs`. No dependencies.
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

async function exists(url) {
  try {
    await stat(fileURLToPath(url));
    return true;
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.[mc]?[jt]s$/.test(specifier) &&
    !specifier.endsWith(".json")
  ) {
    const base = new URL(specifier, context.parentURL);
    for (const cand of [base.href + ".ts", base.href + "/index.ts"]) {
      if (await exists(cand)) {
        return nextResolve(cand, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
