#!/usr/bin/env node
/**
 * Public API guard for @jointsave/sdk.
 *
 * Fails when a symbol that must stay internal is exported from the package
 * root (`dist/index.d.ts`), including symbols pulled in through `export *`
 * barrels. This keeps the published surface intentional.
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

/** Resolve a relative module specifier to its declaration file. */
function resolveDecl(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    `${base}.d.ts`,
    path.join(base, "index.d.ts"),
    base.replace(/\.js$/, ".d.ts"),
    base.replace(/\.mjs$/, ".d.mts"),
    base.replace(/\.cjs$/, ".d.cts"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

const exported = new Set();
const visited = new Set();
const missing = [];

function collect(file) {
  if (visited.has(file)) return;
  visited.add(file);

  const source = fs.readFileSync(file, "utf8");

  // `export declare const Foo` / `export function foo` / `export interface Bar`
  const declarationRe =
    /export\s+(?:declare\s+)?(?:const|let|var|function|class|type|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(declarationRe)) {
    exported.add(match[1]);
  }

  // `export { Foo, Bar as Baz } from "./x"`
  const namedRe =
    /export\s*\{([^}]*)\}\s*(?:from\s*["']([^"']+)["'])?/g;
  for (const match of source.matchAll(namedRe)) {
    for (const raw of match[1].split(",")) {
      const entry = raw.trim().replace(/^type\s+/, "");
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

  // `export * from "./x"` — follow the barrel so hidden names are still checked.
  const starRe = /export\s+\*\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(starRe)) {
    const target = resolveDecl(file, match[1]);
    if (target) {
      collect(target);
    } else if (!match[1].startsWith(".")) {
      // Bare package specifiers are external types; ignore.
    } else {
      missing.push(match[1]);
    }
  }
}

collect(dtsPath);

if (missing.length > 0) {
  console.error(
    `✖ Could not resolve declaration file(s): ${missing.join(", ")}`,
  );
  process.exit(1);
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
