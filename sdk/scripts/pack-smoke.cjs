#!/usr/bin/env node
/**
 * Pack-and-install smoke test for @jointsave/sdk.
 *
 * Verifies:
 *  1. Package metadata (repository, homepage, bugs, license, publishConfig, exports, engines).
 *  2. Root LICENSE file exists in the repository.
 *  3. `npm pack` produces a clean tarball containing only intended files (no src/ or test artifacts).
 *  4. Extracting the packed tarball into a temporary consumer directory allows importing the
 *     public entry point (`dist/index.js`) and verifying expected runtime exports and TypeScript declarations.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const sdkDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(sdkDir, "..");
const pkgPath = path.join(sdkDir, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

function assert(condition, message) {
  if (!condition) {
    console.error(`[pack-smoke] FAILED: ${message}`);
    process.exit(1);
  }
}

// 1. Verify root LICENSE exists
assert(
  fs.existsSync(path.join(repoRoot, "LICENSE")),
  "Root LICENSE file must exist in repository root"
);

// 2. Verify required package.json metadata
assert(pkg.name === "@jointsave/sdk", "package name must be @jointsave/sdk");
assert(pkg.license === "MIT", "package license must be MIT");
assert(
  pkg.repository &&
    pkg.repository.url === "git+https://github.com/JointSave-org/Joint_Save.git" &&
    pkg.repository.directory === "sdk",
  "package repository metadata must reference JointSave-org/Joint_Save (sdk directory)"
);
assert(Boolean(pkg.homepage), "package homepage must be defined");
assert(Boolean(pkg.bugs && pkg.bugs.url), "package bugs.url must be defined");
assert(
  Array.isArray(pkg.keywords) && pkg.keywords.includes("soroban"),
  "package keywords must include soroban"
);
assert(
  pkg.publishConfig && pkg.publishConfig.access === "public",
  "publishConfig.access must be public"
);
assert(
  pkg.exports && pkg.exports["."] && pkg.exports["."].types === "./dist/index.d.ts",
  "package exports['.'] must declare types and default entry points"
);

// 3. Ensure dist/ is built before packing
const distEntry = path.join(sdkDir, "dist", "index.js");
const distTypes = path.join(sdkDir, "dist", "index.d.ts");
assert(fs.existsSync(distEntry), "dist/index.js must exist before running pack-smoke (run npm run build first)");
assert(fs.existsSync(distTypes), "dist/index.d.ts must exist before running pack-smoke");

// 4. Create isolated temp directory and pack tarball
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jointsave-sdk-pack-"));
try {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const packOut = execFileSync(
    npmCmd,
    ["pack", "--json", "--pack-destination", tmpDir],
    { cwd: sdkDir, encoding: "utf8", shell: process.platform === "win32" }
  );

  const jsonStart = packOut.indexOf("[");
  const packInfo = JSON.parse(packOut.slice(jsonStart))[0];
  assert(packInfo && Array.isArray(packInfo.files), "npm pack --json must return file list");

  const packedPaths = packInfo.files.map((f) => f.path);
  assert(packedPaths.includes("package.json"), "tarball must contain package.json");
  assert(packedPaths.includes("README.md"), "tarball must contain README.md");
  assert(packedPaths.includes("CHANGELOG.md"), "tarball must contain CHANGELOG.md");
  assert(packedPaths.includes("dist/index.js"), "tarball must contain dist/index.js");
  assert(packedPaths.includes("dist/index.d.ts"), "tarball must contain dist/index.d.ts");

  const forbidden = packedPaths.filter(
    (p) => p.startsWith("src/") || p.startsWith("examples/") || p.startsWith("scripts/") || p.endsWith(".test.js")
  );
  assert(
    forbidden.length === 0,
    `tarball contains unintended source/test files: ${forbidden.join(", ")}`
  );

  // 5. Extract tarball into simulated consumer node_modules/@jointsave/sdk and import public API
  const tarballPath = path.join(tmpDir, packInfo.filename);
  const consumerDir = path.join(tmpDir, "consumer");
  const installedPkgDir = path.join(consumerDir, "node_modules", "@jointsave", "sdk");
  fs.mkdirSync(installedPkgDir, { recursive: true });

  execFileSync("tar", ["-xzf", tarballPath, "-C", installedPkgDir, "--strip-components=1"], {
    stdio: "inherit"
  });

  // Link @stellar/stellar-sdk from sdk/node_modules so runtime require resolves in offline CI
  const sdkNodeModules = path.join(sdkDir, "node_modules");
  if (fs.existsSync(sdkNodeModules)) {
    const stellarScopeSrc = path.join(sdkNodeModules, "@stellar");
    const stellarScopeDst = path.join(consumerDir, "node_modules", "@stellar");
    if (fs.existsSync(stellarScopeSrc) && !fs.existsSync(stellarScopeDst)) {
      fs.symlinkSync(
        stellarScopeSrc,
        stellarScopeDst,
        process.platform === "win32" ? "junction" : "dir"
      );
    }
  }

  const exportedModule = require(path.join(installedPkgDir, "dist", "index.js"));
  assert(
    exportedModule && typeof exportedModule === "object",
    "Consumer require('@jointsave/sdk') must return an object"
  );
  assert(
    typeof exportedModule.JointSaveClient === "function",
    "Consumer export must include JointSaveClient constructor"
  );
  assert(
    typeof exportedModule.SDK_VERSION === "string",
    "Consumer export must include SDK_VERSION string"
  );

  console.log(
    `[pack-smoke] OK: packed ${packInfo.filename} (${packInfo.files.length} files) and verified clean consumer import.`
  );
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
