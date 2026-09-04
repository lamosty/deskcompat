import { describe, expect, test } from "bun:test";
import {
  BunCommandRunner,
  captureCommandEnvironment,
} from "../../packages/ubuntu-gnome/src/internal/command-runner.ts";

describe("BunCommandRunner", () => {
  test("rejects PATH-based executables", async () => {
    await expect(new BunCommandRunner().run({ executable: "printf", args: [] })).rejects.toThrow(
      "absolute path",
    );
  });

  test("passes arguments directly without shell interpretation", async () => {
    const output = await new BunCommandRunner().run({
      executable: "/usr/bin/printf",
      args: ["%s", "$(not-a-command)"],
    });
    expect(output).toEqual({ exitCode: 0, stdout: "$(not-a-command)", stderr: "" });
  });

  test("captures only the explicit session environment allowlist", () => {
    expect(
      captureCommandEnvironment({
        HOME: "/fixture-home",
        XDG_CONFIG_HOME: "/fixture-config",
        UNRELATED_PRIVATE_VALUE: "fixture-private-value",
      }),
    ).toEqual({ home: "/fixture-home", xdgConfigHome: "/fixture-config" });
  });

  test("terminates a command after its deadline", async () => {
    const started = performance.now();
    const output = await new BunCommandRunner({}).run({
      executable: "/usr/bin/sleep",
      args: ["10"],
      timeoutMs: 10,
    });
    expect(output.exitCode).not.toBe(0);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
