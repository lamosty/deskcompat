import { describe, expect, test } from "bun:test";
import {
  operationId,
  renderGVariant,
  type SettingInspector,
  sha256,
} from "../../packages/core/src/index.ts";
import type { GSettingsOperation, ObservedSetting } from "../../packages/schema/src/index.ts";
import {
  type GSettingsMutationErrorCode,
  type GSettingsMutationResult,
  GSettingsMutator,
} from "../../packages/ubuntu-gnome/src/drivers/gsettings-mutator.ts";
import type {
  CommandResult,
  CommandRunner,
  CommandSpec,
} from "../../packages/ubuntu-gnome/src/internal/command-runner.ts";
import { GSETTINGS_TARGETS } from "../../packages/ubuntu-gnome/src/modules/registry.ts";

const target = GSETTINGS_TARGETS["gsettings:org.gnome.desktop.wm.preferences:button-layout"];
type AvailableObserved = Exclude<ObservedSetting, { status: "unavailable" }>;
const desired = { type: "string", value: "close,minimize,maximize:" } as const;
const appliedRaw = renderGVariant(desired);

function availableObserved(
  status: "inherited" | "present",
  effectiveRaw: string,
  storedRaw?: string,
): AvailableObserved {
  const common = {
    domain: "deskcompat.gsettings-observation.v1",
    resourceId: target.resourceId,
    status,
    effectiveRaw,
    effective: { type: "string", value: effectiveRaw.slice(1, -1) },
    writable: true,
  } as const;
  const semantic =
    status === "present" ? { ...common, storedRaw: storedRaw ?? effectiveRaw } : common;
  const { domain: _domain, resourceId: _resourceId, ...publicValue } = semantic;
  return { ...publicValue, digest: sha256(semantic) } as AvailableObserved;
}

const beforeInherited = availableObserved("inherited", "':close'");
const beforePresent = availableObserved("present", "':close'", "':close'");
const afterApplied = availableObserved("present", appliedRaw, appliedRaw);

function operation(expectedBeforeDigest = beforeInherited.digest): GSettingsOperation {
  const identity = {
    kind: "gsettings.set" as const,
    moduleId: "windowControls" as const,
    resourceId: target.resourceId,
    desired,
  };
  return {
    ...identity,
    id: operationId(identity),
    privilege: "user",
    risk: "low",
    rollbackQuality: "exact-if-unchanged",
    dependsOn: [],
    expectedBeforeDigest,
  };
}

const success = (stdout = ""): CommandResult => ({ exitCode: 0, stdout, stderr: "" });

class QueueRunner implements CommandRunner {
  readonly specifications: CommandSpec[] = [];

  constructor(private readonly results: CommandResult[]) {}

  async run(specification: CommandSpec): Promise<CommandResult> {
    this.specifications.push(specification);
    const result = this.results.shift();
    if (result === undefined) throw new Error("No fake command result queued");
    return result;
  }
}

class QueueInspector implements SettingInspector {
  constructor(private readonly results: ObservedSetting[]) {}

  async inspect(): Promise<ObservedSetting> {
    const result = this.results.shift();
    if (result === undefined) throw new Error("No fake observation queued");
    return result;
  }
}

function expectFailure(result: GSettingsMutationResult, code: GSettingsMutationErrorCode): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.code).toBe(code);
  expect(result.diagnostic.message).not.toContain("/home/");
}

describe("GSettingsMutator", () => {
  test("sets a typed desired GVariant and verifies it", async () => {
    const runner = new QueueRunner([success()]);
    const mutator = new GSettingsMutator(
      runner,
      new QueueInspector([beforeInherited, afterApplied]),
    );

    const result = await mutator.apply(operation());

    expect(result.ok).toBe(true);
    expect(runner.specifications).toEqual([
      {
        executable: "/usr/bin/gsettings",
        args: ["set", target.schema, target.key, appliedRaw],
      },
    ]);
    if (result.ok) {
      expect(result.changed).toBe(true);
      expect(result.after).toEqual(afterApplied);
    }
  });

  test("reports set failure without leaking command output", async () => {
    const runner = new QueueRunner([{ exitCode: 1, stdout: "", stderr: "private /home/user" }]);
    const result = await new GSettingsMutator(runner, new QueueInspector([beforeInherited])).apply(
      operation(),
    );
    expectFailure(result, "GSETTINGS_SET_FAILED");
  });

  test("reports a verification mismatch after a successful set", async () => {
    const runner = new QueueRunner([success()]);
    const wrong = availableObserved("present", "':close'", "':close'");
    const result = await new GSettingsMutator(
      runner,
      new QueueInspector([beforeInherited, wrong]),
    ).apply(operation());
    expectFailure(result, "GSETTINGS_VERIFY_MISMATCH");
  });

  test("restores an inherited baseline with dconf reset", async () => {
    const runner = new QueueRunner([success()]);
    const result = await new GSettingsMutator(
      runner,
      new QueueInspector([afterApplied, beforeInherited]),
    ).restore(operation(), beforeInherited, { expectedCurrentDigest: afterApplied.digest });
    expect(result.ok).toBe(true);
    expect(runner.specifications).toEqual([
      {
        executable: "/usr/bin/dconf",
        args: ["reset", target.dconfPath],
      },
    ]);
  });

  test("restores an explicit raw baseline with dconf write", async () => {
    const runner = new QueueRunner([success()]);
    const result = await new GSettingsMutator(
      runner,
      new QueueInspector([afterApplied, beforePresent]),
    ).restore(operation(beforePresent.digest), beforePresent, afterApplied.digest);
    expect(result.ok).toBe(true);
    expect(runner.specifications).toEqual([
      {
        executable: "/usr/bin/dconf",
        args: ["write", target.dconfPath, "':close'"],
      },
    ]);
  });

  test("rejects malformed or unavailable before state before any command", async () => {
    const runner = new QueueRunner([]);
    const malformed = { ...beforePresent, storedRaw: "not-a-gvariant" };
    const malformedResult = await new GSettingsMutator(
      runner,
      new QueueInspector([afterApplied]),
    ).restore(operation(), malformed);
    expectFailure(malformedResult, "GSETTINGS_RESTORE_RAW_INVALID");

    const unavailableResult = await new GSettingsMutator(
      runner,
      new QueueInspector([{ status: "unavailable", reasonCode: "GSETTINGS_READ_FAILED" }]),
    ).apply(operation());
    expectFailure(unavailableResult, "GSETTINGS_BEFORE_STATE_UNAVAILABLE");
    expect(runner.specifications).toHaveLength(0);
  });

  test("refuses an operation whose precondition no longer matches", async () => {
    const runner = new QueueRunner([]);
    const result = await new GSettingsMutator(runner, new QueueInspector([beforePresent])).apply(
      operation(),
    );
    expectFailure(result, "GSETTINGS_PRECONDITION_MISMATCH");
    expect(runner.specifications).toHaveLength(0);
  });

  test("never accepts a target outside the compiled allowlist", async () => {
    const runner = new QueueRunner([]);
    const invalid = {
      ...operation(),
      resourceId: "gsettings:org.example:private-key",
    };
    const result = await new GSettingsMutator(runner, new QueueInspector([])).apply(invalid);
    expectFailure(result, "GSETTINGS_OPERATION_INVALID");
    expect(runner.specifications).toHaveLength(0);
  });
});
