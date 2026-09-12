import { describe, expect, test } from "bun:test";

const CLI = new URL("../../apps/cli/src/main.ts", import.meta.url).pathname;

async function runCli(
  args: readonly string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([process.execPath, CLI, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { HOME: "/tmp", LANG: "C.UTF-8", NO_COLOR: "1", PATH: "/usr/bin:/bin" },
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("CLI", () => {
  test("advertises its guarded mutation boundary", async () => {
    const output = await runCli(["--help"]);
    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain("Planning is read-only");
    expect(output.stdout).toContain("only four allowlisted scalar GNOME settings");
    expect(output.stderr).toBe("");
  });

  test("validates the built-in profile as JSON", async () => {
    const output = await runCli(["profile", "validate", "--json"]);
    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({
      apiVersion: "deskcompat.dev/cli/v1alpha1",
      ok: true,
      command: "profile validate",
    });
    expect(output.stderr).toBe("");
  });

  test("emits only JSON on stdout for usage errors", async () => {
    const output = await runCli(["unknown", "--json"]);
    expect(output.exitCode).toBe(2);
    expect(JSON.parse(output.stdout)).toMatchObject({
      ok: false,
      command: "invocation",
      diagnostics: [{ code: "INVALID_INVOCATION" }],
    });
    expect(output.stderr).toBe("");
  });

  test("honors JSON mode for help and version", async () => {
    const help = await runCli(["--help", "--json"]);
    expect(JSON.parse(help.stdout)).toMatchObject({ command: "help", ok: true });
    const version = await runCli(["--version", "--json"]);
    expect(JSON.parse(version.stdout)).toMatchObject({ command: "version", ok: true });
  });
});
