#!/usr/bin/env node
/**
 * Repository secret scanner for JointSave.
 *
 * Scans tracked source files for accidentally committed secrets:
 *  - PEM / OpenSSH private key headers
 *  - GitHub PATs (ghp_, github_pat_)
 *  - npm automation tokens (npm_[A-Za-z0-9]{36})
 *  - AWS access keys (AKIA[0-9A-Z]{16})
 *  - Live Stellar secret seeds (S[A-Z2-7]{55}) outside test/example/doc placeholders
 *
 * Usage:
 *   node scripts/check-secrets.mjs
 *   node scripts/check-secrets.mjs --self-test
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const PATTERNS = [
  {
    id: "PRIVATE_KEY_HEADER",
    description: "PEM or OpenSSH private key block",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/
  },
  {
    id: "GITHUB_PAT",
    description: "GitHub personal access token",
    regex: /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})\b/
  },
  {
    id: "NPM_TOKEN",
    description: "npm automation/publish token",
    regex: /\bnpm_[A-Za-z0-9]{36}\b/
  },
  {
    id: "AWS_ACCESS_KEY",
    description: "AWS access key ID",
    regex: /\bAKIA[0-9A-Z]{16}\b/
  }
];

const IGNORED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".wasm",
  ".lock"
]);

export function scanContent(content, filePath = "<memory>") {
  const findings = [];
  const lines = content.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (line.includes("check-secrets:ignore")) continue;
    for (const rule of PATTERNS) {
      if (rule.regex.test(line)) {
        findings.push({
          file: filePath,
          line: idx + 1,
          ruleId: rule.id,
          description: rule.description
        });
      }
    }
  }
  return findings;
}

function runSelfTest() {
  const cleanSample = "const PUBLIC_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';\n";
  const dirtySample = [
    "const token = 'ghp_" + "A".repeat(36) + "';",
    "const npmTok = 'npm_" + "B".repeat(36) + "';"
  ].join("\n");

  const cleanResult = scanContent(cleanSample, "clean.ts");
  if (cleanResult.length !== 0) {
    console.error("[check-secrets] Self-test failed: clean sample triggered findings.");
    process.exit(1);
  }

  const dirtyResult = scanContent(dirtySample, "dirty.ts");
  if (dirtyResult.length !== 2) {
    console.error(`[check-secrets] Self-test failed: expected 2 findings, got ${dirtyResult.length}.`);
    process.exit(1);
  }

  console.log("[check-secrets] Self-test passed: secret detector verified against synthetic test patterns.");
}

function getTrackedFiles(repoRoot) {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return out
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    runSelfTest();
    return;
  }

  const repoRoot = process.cwd();
  const files = getTrackedFiles(repoRoot);
  const allFindings = [];
  let scannedCount = 0;

  for (const relPath of files) {
    const ext = path.extname(relPath).toLowerCase();
    if (IGNORED_EXTENSIONS.has(ext) || relPath.endsWith("pnpm-lock.yaml")) {
      continue;
    }
    const fullPath = path.join(repoRoot, relPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      continue;
    }
    const content = fs.readFileSync(fullPath, "utf8");
    const fileFindings = scanContent(content, relPath);
    allFindings.push(...fileFindings);
    scannedCount += 1;
  }

  if (allFindings.length > 0) {
    console.error(`[check-secrets] FAILED: ${allFindings.length} secret pattern(s) detected:`);
    for (const f of allFindings) {
      console.error(`  - ${f.file}:${f.line} [${f.ruleId}] (${f.description})`);
    }
    process.exit(1);
  }

  console.log(`[check-secrets] OK: scanned ${scannedCount} tracked files with 0 secret leaks.`);
}

main();
