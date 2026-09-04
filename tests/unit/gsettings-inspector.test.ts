import { describe, expect, test } from "bun:test";
import { GSettingsInspector } from "../../packages/ubuntu-gnome/src/drivers/gsettings-inspector.ts";
import type {
  CommandResult,
  CommandRunner,
  CommandSpec,
} from "../../packages/ubuntu-gnome/src/internal/command-runner.ts";

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

const target = {
  resourceId: "gsettings:org.gnome.desktop.wm.preferences:button-layout" as const,
  schema: "org.gnome.desktop.wm.preferences",
  key: "button-layout",
  dconfPath: "/org/gnome/desktop/wm/preferences/button-layout",
  valueType: "string" as const,
};

const success = (stdout: string): CommandResult => ({ exitCode: 0, stdout, stderr: "" });
const stableRead = (storedRaw: string): CommandResult[] => [
  success("type s\n"),
  success(storedRaw),
  success("':close'\n"),
  success(storedRaw),
  success("true\n"),
];

describe("GSettingsInspector", () => {
  test("distinguishes an inherited default from an explicit value", async () => {
    const inherited = await new GSettingsInspector(new QueueRunner(stableRead(""))).inspect(target);
    expect(inherited).toMatchObject({
      status: "inherited",
      effective: { type: "string", value: ":close" },
      writable: true,
    });

    const explicit = await new GSettingsInspector(
      new QueueRunner(stableRead("':close'\n")),
    ).inspect(target);
    expect(explicit).toMatchObject({
      status: "present",
      storedRaw: "':close'",
      writable: true,
    });
  });

  test("uses fixed executables and argument vectors", async () => {
    const runner = new QueueRunner(stableRead(""));
    await new GSettingsInspector(runner).inspect(target);
    expect(runner.specifications).toEqual([
      {
        executable: "/usr/bin/gsettings",
        args: ["range", target.schema, target.key],
      },
      { executable: "/usr/bin/dconf", args: ["read", target.dconfPath] },
      {
        executable: "/usr/bin/gsettings",
        args: ["get", target.schema, target.key],
      },
      { executable: "/usr/bin/dconf", args: ["read", target.dconfPath] },
      {
        executable: "/usr/bin/gsettings",
        args: ["writable", target.schema, target.key],
      },
    ]);
  });

  test("detects a concurrent stored-value change", async () => {
    const runner = new QueueRunner([
      success("type s\n"),
      success("':close'\n"),
      success("':close'\n"),
      success("'close:'\n"),
    ]);
    expect(await new GSettingsInspector(runner).inspect(target)).toEqual({
      status: "unavailable",
      reasonCode: "GSETTINGS_OBSERVATION_UNSTABLE",
    });
  });

  test("rejects an unexpected installed value type", async () => {
    const runner = new QueueRunner([success("type b\n")]);
    expect(await new GSettingsInspector(runner).inspect(target)).toEqual({
      status: "unavailable",
      reasonCode: "GSETTINGS_TYPE_MISMATCH",
    });
  });

  test("turns command exceptions into a stable unavailable state", async () => {
    const runner: CommandRunner = {
      run: async () => {
        throw new Error("sensitive host error that must not escape");
      },
    };
    expect(await new GSettingsInspector(runner).inspect(target)).toEqual({
      status: "unavailable",
      reasonCode: "GSETTINGS_COMMAND_FAILED",
    });
  });
});
