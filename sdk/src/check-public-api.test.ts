import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = path.resolve(__dirname, "..", "scripts", "check-public-api.cjs");

function runGuard(dts: string, denylist: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jointsave-api-"));
  const dtsPath = path.join(dir, "index.d.ts");
  const denylistPath = path.join(dir, "denylist.json");
  fs.writeFileSync(dtsPath, dts);
  fs.writeFileSync(denylistPath, JSON.stringify(denylist));
  return execFileSync(
    process.execPath,
    [script, "--dts", dtsPath, "--denylist", denylistPath],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
}

describe("public API guard", () => {
  it("passes when only public symbols are exported", () => {
    const output = runGuard(
      'export declare const SDK_VERSION = "0.1.0";\n',
      ["internal"],
    );
    expect(output).toContain("Public API OK");
  });

  it("passes for re-exported public symbols", () => {
    const output = runGuard(
      'export { SDK_VERSION } from "./version";\n',
      ["internal"],
    );
    expect(output).toContain("Public API OK");
  });

  it("fails when an internal symbol is exported from the root", () => {
    expect(() =>
      runGuard(
        'export declare function internal(): void;\nexport { SDK_VERSION } from "./version";\n',
        ["internal"],
      ),
    ).toThrow();
  });
});
