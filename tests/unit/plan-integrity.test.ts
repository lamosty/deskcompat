import { describe, expect, test } from "bun:test";
import {
  buildPlan,
  planId as calculatePlanId,
  semanticDigest as calculateSemanticDigest,
  type DesiredSetting,
  sha256,
  verifyPlanIntegrity,
} from "../../packages/core/src/index.ts";
import {
  type HostFacts,
  type ObservedSetting,
  type Plan,
  PlanSchema,
  type Profile,
} from "../../packages/schema/src/index.ts";

const profile: Profile = {
  apiVersion: "deskcompat.dev/v1alpha1",
  kind: "Profile",
  metadata: { name: "integrity-test" },
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
    { id: "dconf", available: true },
    { id: "gnome-shell", available: true },
    { id: "gsettings", available: true },
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

const observationSemantic = {
  domain: "deskcompat.gsettings-observation.v1",
  resourceId: setting.target.resourceId,
  status: "inherited" as const,
  effectiveRaw: "':close'",
  effective: { type: "string" as const, value: ":close" },
  writable: true,
};
const observation: ObservedSetting = {
  status: observationSemantic.status,
  effectiveRaw: observationSemantic.effectiveRaw,
  effective: observationSemantic.effective,
  writable: observationSemantic.writable,
  digest: sha256(observationSemantic),
};

async function changedPlan(): Promise<Plan> {
  return buildPlan({
    profile,
    facts,
    desiredSettings: [setting],
    selectedModules: ["windowControls"],
    inspector: { inspect: async () => observation },
    supportDiagnostics: [],
    toolVersion: "test",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
}

function reseal(candidate: Plan): Plan {
  const nextSemanticDigest = calculateSemanticDigest(candidate);
  const { planId: _, ...artifact } = { ...candidate, semanticDigest: nextSemanticDigest };
  return { ...artifact, planId: calculatePlanId(artifact) };
}

describe("verifyPlanIntegrity", () => {
  test("requires exactly one operation for every change resource", async () => {
    const plan = await changedPlan();
    const withoutOperation = reseal({ ...plan, operations: [] });

    expect(withoutOperation.summary.changes).toBe(1);
    expect(verifyPlanIntegrity(withoutOperation)).toBe(false);
  });

  test("rejects an operation attached to a non-change resource", async () => {
    const plan = await changedPlan();
    const resource = plan.resources[0];
    if (!resource || !("digest" in resource.observed)) throw new Error("fixture is not observed");
    const nonChange = reseal({
      ...plan,
      resources: [{ ...resource, disposition: "unchanged" }],
      summary: { adoptions: 0, changes: 0, unchanged: 1, unavailable: 0, skipped: 0 },
    });

    expect(verifyPlanIntegrity(nonChange)).toBe(false);
  });

  test("requires resource module IDs to be sorted, unique, and in scope", async () => {
    const plan = await changedPlan();
    const resource = plan.resources[0];
    if (resource?.resourceId !== "gsettings:org.gnome.desktop.wm.preferences:button-layout") {
      throw new Error("fixture has no window-controls resource");
    }
    const desired = { type: "string", value: "close,minimize,maximize:" } as const;
    const invalidModules = reseal({
      ...plan,
      scope: ["windowControls", "workspaces"],
      resources: [
        {
          ...resource,
          moduleIds: ["workspaces", "windowControls"],
          desired: [desired, desired],
          disposition: "skipped",
          observed: { status: "skipped", reasonCode: "DUPLICATE_RESOURCE_OWNER" },
        },
      ],
      operations: [],
      summary: { adoptions: 0, changes: 0, unchanged: 0, unavailable: 0, skipped: 1 },
    });

    expect(verifyPlanIntegrity(invalidModules)).toBe(false);

    const duplicateModules = reseal({
      ...plan,
      resources: [
        {
          ...resource,
          moduleIds: ["windowControls", "windowControls"],
          desired: [desired, desired],
          disposition: "skipped",
          observed: { status: "skipped", reasonCode: "DUPLICATE_RESOURCE_OWNER" },
        },
      ],
      operations: [],
      summary: { adoptions: 0, changes: 0, unchanged: 0, unavailable: 0, skipped: 1 },
    });
    expect(verifyPlanIntegrity(duplicateModules)).toBe(false);

    const outsideScope = reseal({
      ...plan,
      scope: ["windowControls"],
      resources: [
        {
          ...resource,
          moduleIds: ["windowControls", "workspaces"],
          desired: [desired, desired],
          disposition: "skipped",
          observed: { status: "skipped", reasonCode: "DUPLICATE_RESOURCE_OWNER" },
        },
      ],
      operations: [],
      summary: { adoptions: 0, changes: 0, unchanged: 0, unavailable: 0, skipped: 1 },
    });
    expect(verifyPlanIntegrity(outsideScope)).toBe(false);
  });

  test("rejects a resource-specific desired value with the wrong type", async () => {
    const plan = await changedPlan();
    const resource = plan.resources[0];
    if (!resource) throw new Error("fixture has no resource");
    const invalidDesired = {
      ...plan,
      resources: [{ ...resource, desired: [{ type: "boolean", value: true }] }],
    };

    expect(PlanSchema.safeParse(invalidDesired).success).toBe(false);
    expect(verifyPlanIntegrity(invalidDesired)).toBe(false);
  });

  test("rejects a resource-specific observed value with the wrong type", async () => {
    const plan = await changedPlan();
    const resource = plan.resources[0];
    if (!resource || !("digest" in resource.observed)) throw new Error("fixture is not observed");
    const invalidObserved = {
      ...plan,
      resources: [
        {
          ...resource,
          observed: {
            ...resource.observed,
            effective: { type: "boolean", value: true },
          },
        },
      ],
    };

    expect(PlanSchema.safeParse(invalidObserved).success).toBe(false);
    expect(verifyPlanIntegrity(invalidObserved)).toBe(false);
  });

  test("enforces compiled risk and rollback policy", async () => {
    const plan = await changedPlan();
    const operation = plan.operations[0];
    if (!operation) throw new Error("fixture has no operation");

    const wrongRisk = { ...plan, operations: [{ ...operation, risk: "desktop-session" }] };
    const wrongRollback = {
      ...plan,
      operations: [{ ...operation, rollbackQuality: "not-implemented" }],
    };

    expect(PlanSchema.safeParse(wrongRisk).success).toBe(false);
    expect(verifyPlanIntegrity(wrongRisk)).toBe(false);
    expect(PlanSchema.safeParse(wrongRollback).success).toBe(false);
    expect(verifyPlanIntegrity(wrongRollback)).toBe(false);
  });

  test("rejects a resealed unchanged disposition whose desired value differs", async () => {
    const plan = await changedPlan();
    const resource = plan.resources[0];
    if (!resource || !("digest" in resource.observed)) throw new Error("fixture is not observed");
    const tampered = reseal({
      ...plan,
      resources: [
        {
          ...resource,
          disposition: "unchanged",
          ownership: {
            status: "owned",
            moduleId: "windowControls",
            appliedDigest: resource.observed.digest,
          },
        },
      ],
      operations: [],
      summary: { adoptions: 0, changes: 0, unchanged: 1, unavailable: 0, skipped: 0 },
    });

    expect(verifyPlanIntegrity(tampered)).toBe(false);
  });

  test("rejects resealed observation and disposition tampering", async () => {
    const plan = await changedPlan();
    const resource = plan.resources[0];
    const operation = plan.operations[0];
    if (
      resource?.resourceId !== "gsettings:org.gnome.desktop.wm.preferences:button-layout" ||
      resource.observed.status !== "inherited" ||
      operation?.resourceId !== "gsettings:org.gnome.desktop.wm.preferences:button-layout"
    ) {
      throw new Error("fixture is not an inherited change");
    }
    const matchingState = {
      status: "inherited" as const,
      effectiveRaw: "'close,minimize,maximize:'",
      effective: { type: "string" as const, value: "close,minimize,maximize:" },
      writable: true,
    };
    const matchingDigest = sha256({
      domain: "deskcompat.gsettings-observation.v1",
      resourceId: resource.resourceId,
      ...matchingState,
    });
    const tampered = reseal({
      ...plan,
      resources: [
        {
          ...resource,
          observed: { ...matchingState, digest: matchingDigest },
        },
      ],
      operations: [{ ...operation, expectedBeforeDigest: matchingDigest }],
    });

    expect(verifyPlanIntegrity(tampered)).toBe(false);

    const badDigest = reseal({
      ...plan,
      resources: [
        {
          ...resource,
          observed: { ...resource.observed, effectiveRaw: "'tampered'" },
        },
      ],
    });
    expect(verifyPlanIntegrity(badDigest)).toBe(false);
  });

  test("rejects zero, negative, and overlong plan lifetimes", async () => {
    const plan = await changedPlan();
    const invalidExpirations = [
      plan.createdAt,
      "2025-12-31T23:59:59.999Z",
      "2026-01-01T01:00:00.001Z",
    ];

    for (const expiresAt of invalidExpirations) {
      expect(verifyPlanIntegrity(reseal({ ...plan, expiresAt }))).toBe(false);
    }
  });

  test("requires diagnostics to be in their severity-specific collections", async () => {
    const plan = await changedPlan();
    const invalid = {
      ...plan,
      warnings: [{ code: "MISFILED", severity: "blocker", message: "wrong collection" }],
    };

    expect(PlanSchema.safeParse(invalid).success).toBe(false);
    expect(verifyPlanIntegrity(invalid)).toBe(false);
  });
});
