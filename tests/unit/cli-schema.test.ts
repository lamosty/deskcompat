import { describe, expect, test } from "bun:test";
import { CliResultSchema } from "../../packages/schema/src/cli.ts";

describe("CliResultSchema", () => {
  test("rejects a payload that does not match its command", () => {
    expect(
      CliResultSchema.safeParse({
        apiVersion: "deskcompat.dev/cli/v1alpha1",
        ok: true,
        command: "doctor",
        data: { metadata: { name: "not-host-facts" } },
        diagnostics: [],
      }).success,
    ).toBe(false);
  });

  test("rejects unknown command names", () => {
    expect(
      CliResultSchema.safeParse({
        apiVersion: "deskcompat.dev/cli/v1alpha1",
        ok: false,
        command: "arbitrary",
        diagnostics: [],
      }).success,
    ).toBe(false);
  });
});
