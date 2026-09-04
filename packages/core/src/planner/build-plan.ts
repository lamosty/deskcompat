import {
  type Diagnostic,
  type GSettingsOperation,
  GSettingsOperationSchema,
  type ObservedSetting,
  PLAN_API_VERSION,
  type Plan,
  PlanSchema,
  ResolvedResourceSchema,
  SUPPORT_TARGET,
} from "@deskcompat/schema";
import { sha256 } from "../canonical-json.ts";
import {
  planId as calculatePlanId,
  semanticDigest as calculateSemanticDigest,
  operationId,
  verifyPlanIntegrity,
} from "./plan-integrity.ts";
import type { DesiredSetting, PlannerInput } from "./types.ts";

const DEFAULT_PLAN_TTL_MS = 15 * 60 * 1_000;
const compareText = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

function relevantFacts(input: PlannerInput, includeInputCapabilities: boolean): unknown {
  const relevantCapabilityIds = includeInputCapabilities
    ? new Set([
        "dconf",
        "gnome-shell",
        "gsettings",
        "session-bus",
        "keyd",
        "xremap",
        "input-remapper",
      ])
    : new Set(["dconf", "gnome-shell", "gsettings", "session-bus"]);
  return {
    platform: input.facts.platform,
    capabilities: input.facts.capabilities
      .filter(({ id }) => relevantCapabilityIds.has(id))
      .map(({ id, available }) => ({ id, available }))
      .sort((left, right) => compareText(left.id, right.id)),
    conflictCodes: includeInputCapabilities
      ? input.facts.conflicts.map(({ code }) => code).sort(compareText)
      : [],
  };
}

function diagnosticSortKey(diagnostic: Diagnostic): string {
  return [diagnostic.code, diagnostic.subject ?? "", diagnostic.reasonCode ?? ""].join(":");
}

function selectedProfileIntent(input: PlannerInput, scope: readonly string[]): unknown {
  return {
    apiVersion: input.profile.apiVersion,
    kind: input.profile.kind,
    modules: Object.fromEntries(
      scope.map((moduleId) => [
        moduleId,
        input.profile.spec.modules[moduleId as keyof typeof input.profile.spec.modules] ?? null,
      ]),
    ),
  };
}

function operationFor(setting: DesiredSetting, observed: ObservedSetting): GSettingsOperation {
  if (observed.status === "unavailable") {
    throw new TypeError("Cannot create an operation for an unavailable setting");
  }

  const identity = {
    kind: "gsettings.set" as const,
    moduleId: setting.moduleId,
    resourceId: setting.target.resourceId,
    desired: setting.desired,
  };

  return GSettingsOperationSchema.parse({
    ...identity,
    id: operationId(identity),
    privilege: "user",
    risk: setting.risk,
    rollbackQuality: "not-implemented",
    dependsOn: [],
    expectedBeforeDigest: observed.digest,
  });
}

function diagnosticForUnavailable(setting: DesiredSetting, observed: ObservedSetting): Diagnostic {
  const reasonCode = observed.status === "unavailable" ? observed.reasonCode : "UNKNOWN";
  return {
    code: "SETTING_UNAVAILABLE",
    severity: "blocker",
    subject: setting.target.resourceId,
    reasonCode,
    relatedSubjects: [setting.moduleId],
    message: `A setting required by module ${setting.moduleId} is unavailable (${reasonCode}).`,
    remediation: "Check the supported platform and required GNOME schemas.",
  };
}

function diagnosticForUnwritable(setting: DesiredSetting): Diagnostic {
  return {
    code: "SETTING_NOT_WRITABLE",
    severity: "blocker",
    subject: setting.target.resourceId,
    reasonCode: "ADMINISTRATIVELY_LOCKED",
    relatedSubjects: [setting.moduleId],
    message: `A setting required by module ${setting.moduleId} is not writable.`,
    remediation: "Review administrator policy for the affected GNOME setting.",
  };
}

/**
 * @decision Planning is a pure description over explicit observations. The function
 * performs no mutation. The semantic digest excludes timestamps, while planId covers
 * the complete expiring artifact; identical state therefore has stable semantics but
 * each independently created plan remains a distinct immutable artifact.
 */
export async function buildPlan(input: PlannerInput): Promise<Plan> {
  const scope = [...new Set(input.selectedModules)].sort(compareText);
  const keyboardConfiguration = input.profile.spec.modules.keyboard;
  const includeInputCapabilities =
    scope.includes("keyboard") &&
    keyboardConfiguration !== undefined &&
    keyboardConfiguration.state !== "unmanaged";
  const operations: GSettingsOperation[] = [];
  const resources: Plan["resources"] = [];
  const pushResource = (resource: unknown): void => {
    resources.push(ResolvedResourceSchema.parse(resource));
  };
  const blockers = input.supportDiagnostics.filter(({ severity }) => severity === "blocker");
  const warnings = [
    ...input.supportDiagnostics.filter(({ severity }) => severity !== "blocker"),
    ...(includeInputCapabilities ? input.facts.conflicts : []),
  ];
  let unchanged = 0;
  let unavailable = 0;
  let skipped = 0;

  const groupedSettings = new Map<DesiredSetting["target"]["resourceId"], DesiredSetting[]>();
  for (const setting of input.desiredSettings) {
    const resourceId = setting.target.resourceId;
    const group = groupedSettings.get(resourceId) ?? [];
    group.push(setting);
    groupedSettings.set(resourceId, group);
  }

  for (const [resourceId, unsortedGroup] of [...groupedSettings].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const group = [...unsortedGroup].sort((left, right) =>
      compareText(left.moduleId, right.moduleId),
    );
    const moduleIds = group.map(({ moduleId }) => moduleId);
    const desired = group.map((setting) => setting.desired);

    if (group.length > 1) {
      skipped += 1;
      blockers.push({
        code: "DUPLICATE_RESOURCE_OWNER",
        severity: "blocker",
        subject: resourceId,
        reasonCode: "MULTIPLE_MODULES",
        relatedSubjects: moduleIds,
        message: `More than one module claims ${resourceId}.`,
      });
      pushResource({
        moduleIds,
        resourceId,
        disposition: "skipped",
        desired,
        observed: { status: "skipped", reasonCode: "DUPLICATE_RESOURCE_OWNER" },
      });
      continue;
    }

    const setting = group[0];
    if (!setting) continue;
    if (input.allowInspection === false) {
      skipped += 1;
      pushResource({
        moduleIds,
        resourceId,
        disposition: "skipped",
        desired,
        observed: { status: "skipped", reasonCode: "UNSUPPORTED_HOST" },
      });
      continue;
    }

    const observed = await input.inspector.inspect(setting.target);
    if (observed.status === "unavailable") {
      unavailable += 1;
      pushResource({
        moduleIds,
        resourceId,
        disposition: "unavailable",
        desired,
        observed: { status: "unavailable", reasonCode: observed.reasonCode },
      });
      blockers.push(diagnosticForUnavailable(setting, observed));
      continue;
    }

    if (sha256(observed.effective) === sha256(setting.desired)) {
      unchanged += 1;
      pushResource({
        moduleIds,
        resourceId,
        disposition: "unchanged",
        desired,
        observed: {
          status: observed.status,
          effective: observed.effective,
          writable: observed.writable,
          digest: observed.digest,
        },
      });
      continue;
    }
    if (!observed.writable) {
      unavailable += 1;
      pushResource({
        moduleIds,
        resourceId,
        disposition: "unavailable",
        desired,
        observed: { status: "unavailable", reasonCode: "SETTING_NOT_WRITABLE" },
      });
      blockers.push(diagnosticForUnwritable(setting));
      continue;
    }
    pushResource({
      moduleIds,
      resourceId,
      disposition: "change",
      desired,
      observed: {
        status: observed.status,
        effective: observed.effective,
        writable: observed.writable,
        digest: observed.digest,
      },
    });
    operations.push(operationFor(setting, observed));
  }

  operations.sort((left, right) => compareText(left.resourceId, right.resourceId));
  blockers.sort((left, right) => compareText(diagnosticSortKey(left), diagnosticSortKey(right)));
  warnings.sort((left, right) => compareText(diagnosticSortKey(left), diagnosticSortKey(right)));
  resources.sort((left, right) => compareText(left.resourceId, right.resourceId));

  const profileDigest = sha256(selectedProfileIntent(input, scope));
  const factsDigest = sha256(relevantFacts(input, includeInputCapabilities));
  const planBody = {
    apiVersion: PLAN_API_VERSION,
    profileDigest,
    factsDigest,
    toolVersion: input.toolVersion,
    supportTarget: SUPPORT_TARGET,
    scope,
    resources,
    operations,
    blockers,
    warnings,
    summary: { changes: operations.length, unchanged, unavailable, skipped },
  };
  const createdAt = input.now ?? new Date();
  const expiresAt = new Date(createdAt.getTime() + (input.ttlMs ?? DEFAULT_PLAN_TTL_MS));
  // @decision Human-facing diagnostic prose is excluded from semantic identity. Copy
  // edits preserve semanticDigest, while planId still changes with the full artifact.
  const semanticDigest = calculateSemanticDigest(planBody);
  const planArtifact = {
    ...planBody,
    semanticDigest,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const plan = PlanSchema.parse({
    ...planArtifact,
    planId: calculatePlanId(planArtifact),
  });
  if (!verifyPlanIntegrity(plan)) {
    throw new TypeError("Generated plan failed its integrity contract");
  }
  return plan;
}
