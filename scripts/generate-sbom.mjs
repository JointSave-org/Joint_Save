#!/usr/bin/env node
/**
 * CycloneDX 1.5 Software Bill of Materials (SBOM) generator for JointSave.
 *
 * Collects dependencies across:
 *  - frontend/package.json (npm)
 *  - sdk/package.json (npm)
 *  - smartcontract/Cargo.lock (cargo)
 *
 * Usage:
 *   node scripts/generate-sbom.mjs [--output sbom.cdx.json] [--self-test]
 */
import fs from "node:fs";
import path from "node:path";

function collectNpmComponents(pkgJsonPath, scopeLabel) {
  if (!fs.existsSync(pkgJsonPath)) return [];
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  const components = [];
  const sections = [
    ["dependencies", "required"],
    ["devDependencies", "optional"]
  ];
  for (const [field, scope] of sections) {
    const deps = pkg[field] || {};
    for (const [name, versionSpec] of Object.entries(deps)) {
      const cleanVersion = String(versionSpec).replace(/^[\^~>=<\s]+/, "") || "0.0.0";
      components.push({
        type: "library",
        group: scopeLabel,
        name,
        version: cleanVersion,
        scope,
        purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(cleanVersion)}`
      });
    }
  }
  return components;
}

function collectCargoComponents(cargoLockPath) {
  if (!fs.existsSync(cargoLockPath)) return [];
  const raw = fs.readFileSync(cargoLockPath, "utf8");
  const blocks = raw.split("[[package]]").slice(1);
  const components = [];
  for (const block of blocks) {
    const nameMatch = block.match(/^\s*name\s*=\s*"([^"]+)"/m);
    const versionMatch = block.match(/^\s*version\s*=\s*"([^"]+)"/m);
    if (nameMatch && versionMatch) {
      const name = nameMatch[1];
      const version = versionMatch[1];
      components.push({
        type: "library",
        group: "smartcontract",
        name,
        version,
        scope: "required",
        purl: `pkg:cargo/${encodeURIComponent(name)}@${encodeURIComponent(version)}`
      });
    }
  }
  return components;
}

export function buildSbom(repoRoot) {
  const components = [
    ...collectNpmComponents(path.join(repoRoot, "frontend", "package.json"), "frontend"),
    ...collectNpmComponents(path.join(repoRoot, "sdk", "package.json"), "sdk"),
    ...collectCargoComponents(path.join(repoRoot, "smartcontract", "Cargo.lock"))
  ];

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: {
        type: "application",
        name: "jointsave",
        version: "0.1.0"
      }
    },
    components
  };
}

function main() {
  const args = process.argv.slice(2);
  const repoRoot = process.cwd();
  const sbom = buildSbom(repoRoot);

  if (args.includes("--self-test")) {
    if (sbom.bomFormat !== "CycloneDX" || sbom.components.length === 0) {
      console.error("[generate-sbom] Self-test failed: SBOM contains no components.");
      process.exit(1);
    }
    console.log(
      `[generate-sbom] Self-test passed: generated CycloneDX 1.5 SBOM with ${sbom.components.length} components.`
    );
    return;
  }

  const outIdx = args.indexOf("--output");
  const outputPath = outIdx !== -1 && args[outIdx + 1] ? path.resolve(args[outIdx + 1]) : null;
  const serialized = JSON.stringify(sbom, null, 2) + "\n";

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, "utf8");
    console.log(
      `[generate-sbom] Wrote CycloneDX 1.5 SBOM (${sbom.components.length} components) to ${outputPath}`
    );
  } else {
    process.stdout.write(serialized);
  }
}

main();
