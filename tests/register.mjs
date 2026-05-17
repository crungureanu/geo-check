// Registers the extensionless-import resolve hook. Run scripts with:
//   node --import ./tests/register.mjs tests/<script>.ts
import { register } from "node:module";
register("./loader.mjs", import.meta.url);
