#!/usr/bin/env node
/**
 * Public API guard for @jointsave/sdk.
 *
 * Fails when a symbol that must stay internal is exported from the package
 * root (`dist/index.d.ts`). This keeps the published surface intentional.
 *
 * Usage:
 *   node scripts/check-public-api.cjs [--dts <path>] [--denylist <path>]
 */
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dts") out.dts = argv[++i];
    else if (arg === "--denylist") out.denylist = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(__dirname, "..");
const dtsPath = path.resolve(args.dts || path.join(root, "dist", "index.d.ts"));
const denylistPath = path.resolve(
  args.denylist || path.join(__dirname, "public-api.denylist.json"),
);

if (!fs.existsSync(dtsPath)) {
  console.error(`✖ ${dtsPath} not found. Run \`pnpm build\` first.`);
  process.exit(1);
}

if (!fs.existsSync(denylistPath)) {
  console.error(`✖ Denylist not found: ${denylistPath}`);
  process.exit(1);
}

const denylist = JSON.parse(fs.readFileSync(denylistPath, "utf8"));
if (!Array.isArray(denylist) || denylist.some((n) => typeof n !== "string")) {
  console.error("✖ Denylist must be a JSON array of strings.");
  process.exit(1);
}

const source = fs.readFileSync(dtsPath, "utf8");
const exported = new Set();

// `export declare const Foo` / `export function foo` / etc.
const declarationRe =
  /export\s+(?:declare\s+)?(?:const|let|var|function|class|type|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/g;
for (const match of source.matchAll(declarationRe)) {
  exported.add(match[1]);
}

// `export { Foo, Bar as Baz } from "./x"`
const namedRe = /export\s*\{([^}]*)\}\s*(?:from\s*["'][^"']+["'])?/g;
for (const match of source.matchAll(namedRe)) {
  for (const raw of match[1].split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const alias = entry.match(/\bas\s+([A-Za-z_$][\w$]*)/);
    if (alias) {
      exported.add(alias[1]);
    } else {
      const name = entry.match(/^([A-Za-z_$][\w$]*)/);
      if (name) exported.add(name[1]);
    }
  }
}

const violations = denylist.filter((name) => exported.has(name));
if (violations.length > 0) {
  console.error(
    `✖ Internal symbol(s) leaked into the public API: ${violations.join(", ")}`,
  );
  console.error("  Remove them from sdk/src/index.ts before publishing.");
  process.exit(1);
}

const count = exported.size;
console.log(
  `✔ Public API OK (${count} symbol${count === 1 ? "" : "s"} exported from the root)`,
);
