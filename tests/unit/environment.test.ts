import { describe, expect, test } from "bun:test";
import { assertUnprivileged, CliEnvironmentError } from "../../apps/cli/src/environment.ts";

describe("assertUnprivileged", () => {
  test("allows an ordinary graphical user", () => {
    expect(() => assertUnprivileged(1_000)).not.toThrow();
  });

  test("rejects root execution", () => {
    expect(() => assertUnprivileged(0)).toThrow(CliEnvironmentError);
  });
});
