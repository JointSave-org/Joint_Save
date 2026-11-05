import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = path.resolve(__dirname, "..", "scripts", "check-public-api.cjs");

function runGuard(files: Record<string, string>, denylist: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jointsave-api-"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  const denylistPath = path.join(dir, "denylist.json");
  fs.writeFileSync(denylistPath, JSON.stringify(denylist));
  return execFileSync(
    process.execPath,
    [
      script,
      "--dts",
      path.join(dir, "index.d.ts"),
      "--denylist",
      denylistPath,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
}

describe("public API guard", () => {
  it("passes when only public symbols are exported", () => {
    const output = runGuard(
      {
        "index.d.ts": 'export declare const SDK_VERSION = "0.1.0";\n',
      },
      ["internal"],
    );
    expect(output).toContain("Public API OK");
  });

  it("passes for explicitly re-exported public symbols", () => {
    const output = runGuard(
      { "index.d.ts": 'export { SDK_VERSION } from "./version";\n' },
      ["internal"],
    );
    expect(output).toContain("Public API OK");
  });

  it("passes when an `export *` barrel contains only public symbols", () => {
    const output = runGuard(
      {
        "index.d.ts": 'export * from "./constants";\n',
        "constants.d.ts": "export declare const SDK_VERSION: string;\n",
      },
      ["internal"],
    );
    expect(output).toContain("Public API OK");
  });

  it("fails when an internal symbol is exported from the root", () => {
    expect(() =>
      runGuard(
        {
          "index.d.ts":
            'export declare function internal(): void;\nexport { SDK_VERSION } from "./version";\n',
        },
        ["internal"],
      ),
    ).toThrow();
  });

  it("fails when an `export *` barrel leaks an internal symbol", () => {
    expect(() =>
      runGuard(
        {
          "index.d.ts": 'export * from "./internals";\n',
          "internals.d.ts":
            "export declare const SDK_VERSION: string;\nexport declare function internal(): void;\n",
        },
        ["internal"],
      ),
    ).toThrow();
  });
});
