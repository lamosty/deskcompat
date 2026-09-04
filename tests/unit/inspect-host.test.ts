import { describe, expect, test } from "bun:test";
import { inspectHost } from "../../packages/ubuntu-gnome/src/platform/inspect.ts";
import type {
  CommandResult,
  CommandRunner,
  CommandSpec,
} from "../../packages/ubuntu-gnome/src/internal/command-runner.ts";
import type { PlatformRuntime } from "../../packages/ubuntu-gnome/src/platform/runtime.ts";

class StaticRunner implements CommandRunner {
  async run(specification: CommandSpec): Promise<CommandResult> {
    expect(specification).toEqual({ executable: "/usr/bin/gnome-shell", args: ["--version"] });
    return { exitCode: 0, stdout: "GNOME Shell 46.2\n", stderr: "" };
  }
}

class FakeRuntime implements PlatformRuntime {
  readonly session: { currentDesktop: string; sessionType: string; hasSessionBus: boolean } = {
    currentDesktop: "ubuntu:GNOME",
    sessionType: "wayland",
    hasSessionBus: true,
  };
  readonly commandRunner = new StaticRunner();

  async readText(path: string): Promise<string | undefined> {
    return path === "/etc/os-release" ? 'ID=ubuntu\nVERSION_ID="24.04"\n' : undefined;
  }

  async exists(path: string): Promise<boolean> {
    return new Set([
      "/usr/bin/dconf",
      "/usr/bin/gsettings",
      "/usr/bin/gnome-shell",
      "/usr/local/bin/keyd",
      "/usr/local/bin/xremap",
      "/etc/udev/rules.d/99-xremap.rules",
    ]).has(path);
  }
}

describe("inspectHost", () => {
  test("returns allowlisted facts and sanitized conflict diagnostics", async () => {
    const facts = await inspectHost(new FakeRuntime());
    expect(facts.platform).toEqual({
      osId: "ubuntu",
      osVersion: "24.04",
      desktop: "gnome",
      desktopVersion: "46.2",
      sessionType: "wayland",
    });
    expect(facts.conflicts.map(({ code }) => code)).toEqual([
      "REMAPPER_RESIDUAL_RULE_DETECTED",
      "REMAPPER_XREMAP_DETECTED",
    ]);
    expect(JSON.stringify(facts)).not.toContain("ubuntu:GNOME");
  });

  test("normalizes unknown desktop values instead of echoing them", async () => {
    const runtime = new FakeRuntime();
    runtime.session.currentDesktop = "fixture-private-value";
    const facts = await inspectHost(runtime);
    expect(facts.platform.desktop).toBe("other");
    expect(JSON.stringify(facts)).not.toContain("fixture-private-value");
  });
});
