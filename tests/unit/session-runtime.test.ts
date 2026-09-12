import { describe, expect, test } from "bun:test";
import type {
  CommandResult,
  CommandRunner,
  CommandSpec,
} from "../../packages/ubuntu-gnome/src/internal/command-runner.ts";
import { LivePlatformRuntime } from "../../packages/ubuntu-gnome/src/platform/runtime.ts";

class QueueRunner implements CommandRunner {
  readonly specifications: CommandSpec[] = [];

  constructor(private readonly results: CommandResult[]) {}

  async run(specification: CommandSpec): Promise<CommandResult> {
    this.specifications.push(specification);
    const next = this.results.shift();
    if (!next) throw new Error("No fake result queued");
    return next;
  }
}

const success = (stdout: string): CommandResult => ({ exitCode: 0, stdout, stderr: "" });

describe("LivePlatformRuntime session discovery", () => {
  test("keeps explicit graphical session environment without querying logind", async () => {
    const runtime = new LivePlatformRuntime({
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/fixture",
      XDG_CURRENT_DESKTOP: "ubuntu:GNOME",
      XDG_SESSION_TYPE: "wayland",
    });
    const runner = new QueueRunner([]);
    Object.assign(runtime, { commandRunner: runner });

    expect(await runtime.inspectSession()).toEqual({
      currentDesktop: "ubuntu:GNOME",
      sessionType: "wayland",
      hasSessionBus: true,
    });
    expect(runner.specifications).toEqual([]);
  });

  test("recovers categorical session context for a detached local agent", async () => {
    const runtime = new LivePlatformRuntime({
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/fixture",
    });
    const runner = new QueueRunner([
      success("session-fixture\n"),
      success("Remote=no\nDesktop=ubuntu:GNOME\nType=wayland\nClass=user\nState=active\n"),
    ]);
    Object.assign(runtime, {
      commandRunner: runner,
      exists: async (path: string) => path === "/usr/bin/loginctl",
    });

    expect(await runtime.inspectSession()).toEqual({
      currentDesktop: "ubuntu:GNOME",
      sessionType: "wayland",
      hasSessionBus: true,
    });
    expect(runner.specifications).toHaveLength(2);
    expect(runner.specifications[0]).toMatchObject({
      executable: "/usr/bin/loginctl",
      args: ["show-user", expect.any(String), "--property=Display", "--value"],
    });
  });

  test("rejects remote or inactive sessions", async () => {
    const runtime = new LivePlatformRuntime({ DBUS_SESSION_BUS_ADDRESS: "unix:path=/fixture" });
    const runner = new QueueRunner([
      success("session-fixture\n"),
      success("Remote=yes\nDesktop=GNOME\nType=wayland\nClass=user\nState=active\n"),
    ]);
    Object.assign(runtime, {
      commandRunner: runner,
      exists: async () => true,
    });

    expect(await runtime.inspectSession()).toEqual({ hasSessionBus: true });
  });
});
