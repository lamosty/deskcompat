import { describe, expect, test } from "bun:test";
import {
  buildPlan,
  type DesiredSetting,
  type SettingInspector,
  sha256,
  verifyPlanIntegrity,
} from "../../packages/core/src/index.ts";
import type { HostFacts, ObservedSetting, Profile } from "../../packages/schema/src/index.ts";

const profile: Profile = {
  apiVersion: "deskcompat.dev/v1alpha1",
  kind: "Profile",
  metadata: { name: "test" },
  spec: { modules: { windowControls: { state: "managed", preset: "macos-standard" } } },
};

const facts: HostFacts = {
  platform: {
    osId: "ubuntu",
    osVersion: "24.04",
    desktop: "gnome",
    desktopVersion: "46.0",
    sessionType: "wayland",
  },
  capabilities: [
    { id: "gsettings", available: true },
    { id: "dconf", available: true },
    { id: "session-bus", available: true },
  ],
  conflicts: [],
};

const setting: DesiredSetting = {
  moduleId: "windowControls",
  target: {
    resourceId: "gsettings:org.gnome.desktop.wm.preferences:button-layout",
    schema: "org.gnome.desktop.wm.preferences",
    key: "button-layout",
    dconfPath: "/org/gnome/desktop/wm/preferences/button-layout",
    valueType: "string",
  },
  desired: { type: "string", value: "close,minimize,maximize:" },
  risk: "low",
};

class FixedInspector implements SettingInspector {
  calls = 0;

  constructor(private readonly observation: ObservedSetting) {}

  async inspect(): Promise<ObservedSetting> {
    this.calls += 1;
    return this.observation;
  }
}

const observation = (effectiveRaw: string): ObservedSetting => {
  const semantic = {
    status: "inherited" as const,
    effectiveRaw,
    effective: { type: "string" as const, value: effectiveRaw.slice(1, -1) },
    writable: true,
  };
  return { ...semantic, digest: sha256(semantic) };
};

describe("buildPlan", () => {
  test("is semantically deterministic", async () => {
    const first = await buildPlan({
      profile,
      facts,
      desiredSettings: [setting],
      selectedModules: ["windowControls"],
      inspector: new FixedInspector(observation("':close'")),
      supportDiagnostics: [],
      toolVersion: "test",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = await buildPlan({
      profile,
      facts: { ...facts, capabilities: [...facts.capabilities].reverse() },
      desiredSettings: [setting],
      selectedModules: ["windowControls"],
      inspector: new FixedInspector(observation("':close'")),
      supportDiagnostics: [],
      toolVersion: "test",
      now: new Date("2026-02-01T00:00:00.000Z"),
    });

    expect(first.semanticDigest).toBe(second.semanticDigest);
    expect(first.planId).not.toBe(second.planId);
    expect(first.operations).toEqual(second.operations);
    expect(first.createdAt).not.toBe(second.createdAt);
    expect(verifyPlanIntegrity(first)).toBe(true);
    expect(first).toMatchSnapshot();
  });

  test("does not plan an already matching effective value", async () => {
    const plan = await buildPlan({
      profile,
      facts,
      desiredSettings: [setting],
      selectedModules: ["windowControls"],
      inspector: new FixedInspector(observation("'close,minimize,maximize:'")),
      supportDiagnostics: [],
      toolVersion: "test",
    });
    expect(plan.summary).toEqual({ changes: 0, unchanged: 1, unavailable: 0, skipped: 0 });
  });

  test("does not change identity when diagnostic prose changes", async () => {
    const base = {
      profile,
      facts,
      desiredSettings: [setting],
      selectedModules: ["windowControls"],
      inspector: new FixedInspector(observation("':close'")),
      toolVersion: "test",
      now: new Date("2026-01-01T00:00:00.000Z"),
    } as const;
    const first = await buildPlan({
      ...base,
      supportDiagnostics: [{ code: "EXAMPLE_WARNING", severity: "warning", message: "First" }],
    });
    const second = await buildPlan({
      ...base,
      inspector: new FixedInspector(observation("':close'")),
      supportDiagnostics: [{ code: "EXAMPLE_WARNING", severity: "warning", message: "Second" }],
    });
    expect(first.semanticDigest).toBe(second.semanticDigest);
    expect(first.planId).not.toBe(second.planId);
  });

  test("binds selected module scope into semantic identity", async () => {
    const shared = {
      profile,
      facts,
      desiredSettings: [setting],
      inspector: new FixedInspector(observation("'close,minimize,maximize:'")),
      supportDiagnostics: [],
      toolVersion: "test",
      now: new Date("2026-01-01T00:00:00.000Z"),
    } as const;
    const windowPlan = await buildPlan({ ...shared, selectedModules: ["windowControls"] });
    const workspacePlan = await buildPlan({
      ...shared,
      desiredSettings: [],
      inspector: new FixedInspector(observation("'close,minimize,maximize:'")),
      selectedModules: ["workspaces"],
    });
    expect(windowPlan.semanticDigest).not.toBe(workspacePlan.semanticDigest);
  });

  test("binds unchanged observations into semantic identity", async () => {
    const shared = {
      profile,
      facts,
      desiredSettings: [setting],
      selectedModules: ["windowControls"],
      supportDiagnostics: [],
      toolVersion: "test",
      now: new Date("2026-01-01T00:00:00.000Z"),
    } as const;
    const inherited = await buildPlan({
      ...shared,
      inspector: new FixedInspector(observation("'close,minimize,maximize:'")),
    });
    const explicitSemantic = {
      status: "present" as const,
      effectiveRaw: "'close,minimize,maximize:'",
      effective: { type: "string" as const, value: "close,minimize,maximize:" },
      storedRaw: "'close,minimize,maximize:'",
      writable: true,
    };
    const explicit = await buildPlan({
      ...shared,
      inspector: new FixedInspector({
        ...explicitSemantic,
        digest: sha256(explicitSemantic),
      }),
    });
    expect(inherited.semanticDigest).not.toBe(explicit.semanticDigest);
  });

  test("performs no resource inspection on an unsupported host", async () => {
    const inspector = new FixedInspector(observation("':close'"));
    const plan = await buildPlan({
      profile,
      facts,
      desiredSettings: [setting],
      selectedModules: ["windowControls"],
      inspector,
      supportDiagnostics: [
        {
          code: "UNSUPPORTED_DESKTOP",
          severity: "blocker",
          message: "Unsupported",
        },
      ],
      allowInspection: false,
      toolVersion: "test",
    });
    expect(inspector.calls).toBe(0);
    expect(plan.operations).toEqual([]);
  });

  test("blocks duplicate ownership", async () => {
    const inspector = new FixedInspector(observation("':close'"));
    const plan = await buildPlan({
      profile,
      facts,
      desiredSettings: [setting, { ...setting, moduleId: "workspaces" }],
      selectedModules: ["windowControls", "workspaces"],
      inspector,
      supportDiagnostics: [],
      toolVersion: "test",
    });
    expect(plan.blockers.map(({ code }) => code)).toContain("DUPLICATE_RESOURCE_OWNER");
    expect(plan.operations).toEqual([]);
    expect(inspector.calls).toBe(0);
  });

  test("rejects a tampered plan artifact", async () => {
    const plan = await buildPlan({
      profile,
      facts,
      desiredSettings: [setting],
      selectedModules: ["windowControls"],
      inspector: new FixedInspector(observation("':close'")),
      supportDiagnostics: [],
      toolVersion: "test",
    });
    expect(verifyPlanIntegrity({ ...plan, expiresAt: "2099-01-01T00:00:00.000Z" })).toBe(false);
  });
});
