import { sha256, type GSettingsTarget, type SettingInspector } from "@deskcompat/core";
import type { ObservedSetting } from "@deskcompat/schema";
import type { CommandResult, CommandRunner } from "../internal/command-runner.ts";
import { parseGVariant, rangeMatchesType } from "./gvariant.ts";

const GSETTINGS = "/usr/bin/gsettings";
const DCONF = "/usr/bin/dconf";

function withoutFinalNewline(value: string): string {
  return value.replace(/[\r\n]+$/, "");
}

export class GSettingsInspector implements SettingInspector {
  constructor(private readonly commandRunner: CommandRunner) {}

  private async run(
    executable: string,
    args: readonly string[],
  ): Promise<CommandResult | undefined> {
    try {
      return await this.commandRunner.run({ executable, args });
    } catch {
      return undefined;
    }
  }

  async inspect(target: GSettingsTarget): Promise<ObservedSetting> {
    const range = await this.run(GSETTINGS, ["range", target.schema, target.key]);
    if (!range) return { status: "unavailable", reasonCode: "GSETTINGS_COMMAND_FAILED" };
    if (range.exitCode !== 0) {
      return { status: "unavailable", reasonCode: "GSETTINGS_RANGE_FAILED" };
    }
    if (!rangeMatchesType(withoutFinalNewline(range.stdout), target.valueType)) {
      return { status: "unavailable", reasonCode: "GSETTINGS_TYPE_MISMATCH" };
    }

    // @decision Read the stored value on both sides of the effective-value read. This
    // cannot make separate dconf/GSettings APIs atomic, but it detects ordinary races
    // instead of signing a precondition for a pair of values that never coexisted.
    const before = await this.run(DCONF, ["read", target.dconfPath]);
    if (!before) return { status: "unavailable", reasonCode: "DCONF_COMMAND_FAILED" };
    if (before.exitCode !== 0) return { status: "unavailable", reasonCode: "DCONF_READ_FAILED" };

    const effective = await this.run(GSETTINGS, ["get", target.schema, target.key]);
    if (!effective) return { status: "unavailable", reasonCode: "GSETTINGS_COMMAND_FAILED" };
    if (effective.exitCode !== 0) {
      return { status: "unavailable", reasonCode: "GSETTINGS_READ_FAILED" };
    }

    const after = await this.run(DCONF, ["read", target.dconfPath]);
    if (!after) return { status: "unavailable", reasonCode: "DCONF_COMMAND_FAILED" };
    if (after.exitCode !== 0) return { status: "unavailable", reasonCode: "DCONF_READ_FAILED" };

    const storedRaw = withoutFinalNewline(after.stdout);
    if (withoutFinalNewline(before.stdout) !== storedRaw) {
      return { status: "unavailable", reasonCode: "GSETTINGS_OBSERVATION_UNSTABLE" };
    }

    const effectiveRaw = withoutFinalNewline(effective.stdout);
    const effectiveValue = parseGVariant(effectiveRaw, target.valueType);
    if (!effectiveValue) {
      return { status: "unavailable", reasonCode: "GSETTINGS_VALUE_INVALID" };
    }
    if (storedRaw.length > 0 && !parseGVariant(storedRaw, target.valueType)) {
      return { status: "unavailable", reasonCode: "DCONF_VALUE_INVALID" };
    }

    const writableResult = await this.run(GSETTINGS, ["writable", target.schema, target.key]);
    if (!writableResult) {
      return { status: "unavailable", reasonCode: "GSETTINGS_COMMAND_FAILED" };
    }
    const writableRaw = withoutFinalNewline(writableResult.stdout);
    if (writableResult.exitCode !== 0 || (writableRaw !== "true" && writableRaw !== "false")) {
      return { status: "unavailable", reasonCode: "GSETTINGS_WRITABLE_CHECK_FAILED" };
    }
    const writable = writableRaw === "true";

    if (storedRaw.length === 0) {
      const semanticValue = {
        domain: "deskcompat.gsettings-observation.v1",
        resourceId: target.resourceId,
        status: "inherited" as const,
        effectiveRaw,
        effective: effectiveValue,
        writable,
      };
      const { domain: _, resourceId: __, ...publicValue } = semanticValue;
      return { ...publicValue, digest: sha256(semanticValue) };
    }

    const semanticValue = {
      domain: "deskcompat.gsettings-observation.v1",
      resourceId: target.resourceId,
      status: "present" as const,
      effectiveRaw,
      effective: effectiveValue,
      storedRaw,
      writable,
    };
    const { domain: _, resourceId: __, ...publicValue } = semanticValue;
    return { ...publicValue, digest: sha256(semanticValue) };
  }
}
