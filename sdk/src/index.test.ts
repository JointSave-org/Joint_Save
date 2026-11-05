import { describe, expect, it } from "vitest";
import { SDK_VERSION } from "./index";

describe("@jointsave/sdk", () => {
  it("exposes a semver version from the package root", () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
