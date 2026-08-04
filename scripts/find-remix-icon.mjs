import path from "node:path";
import { createRequire } from "node:module";
import { findRemixIcons } from "./lib/remix-icons.mjs";

function parseArgs(argv) {
  const options = { style: "line", limit: 8 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--query") options.query = argv[++index];
    else if (value === "--style") options.style = argv[++index];
    else if (value === "--limit") options.limit = Number(argv[++index]);
    else if (!options.query) options.query = value;
  }
  if (!options.query) throw new Error("用法: node scripts/find-remix-icon.mjs --query \"shield check\" [--style line|fill] [--limit 8]");
  if (!["line", "fill"].includes(options.style)) throw new Error("--style 只能是 line 或 fill");
  return options;
}

const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve("remixicon/package.json"));
const options = parseArgs(process.argv.slice(2));
const matches = await findRemixIcons({ packageRoot, ...options });
process.stdout.write(`${JSON.stringify({ query: options.query, style: options.style, matches }, null, 2)}\n`);
