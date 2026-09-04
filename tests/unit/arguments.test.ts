import { describe, expect, test } from "bun:test";
import { CliUsageError, parseArguments } from "../../apps/cli/src/arguments.ts";
import { terminalSafe } from "../../apps/cli/src/output/render.ts";

describe("parseArguments", () => {
  test("parses a scoped JSON plan", () => {
    const parsed = parseArguments([
      "plan",
      "--profile",
      "custom.toml",
      "--only",
      "workspaces,windowControls",
      "--json",
    ]);
    expect(parsed.command).toBe("plan");
    expect(parsed.profilePath).toBe("custom.toml");
    expect(parsed.only).toEqual(new Set(["workspaces", "windowControls"]));
    expect(parsed.json).toBe(true);
  });

  test("rejects unknown modules", () => {
    expect(() => parseArguments(["plan", "--only", "shell-hook"])).toThrow(CliUsageError);
  });

  test("does not accept profile options for doctor", () => {
    expect(() => parseArguments(["doctor", "--profile", "x.toml"])).toThrow(CliUsageError);
  });
});

test("terminalSafe escapes control characters", () => {
  expect(terminalSafe("before\u001b[31m\nafter")).toBe("before\\u{1b}[31m\\u{0a}after");
});
