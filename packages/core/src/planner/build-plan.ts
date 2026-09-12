import {
  type Diagnostic,
  type GSettingsOperation,
  GSettingsOperationSchema,
  MAX_PLAN_TTL_MS,
  type ObservedSetting,
  type Operation,
  PLAN_API_VERSION,
  type Plan,
  PlanSchema,
  ResolvedResourceSchema,
  type ResourceAdoptOperation,
  ResourceAdoptOperationSchema,
  SUPPORT_TARGET,
} from "@deskcompat/schema";
import { sha256 } from "../canonical-json.ts";
import {
  planFactsDigest,
  planIncludesInputCapabilities,
  selectedProfileDigest,
} from "./fingerprints.ts";
import {
  planId as calculatePlanId,
  semanticDigest as calculateSemanticDigest,
  operationId,
  verifyPlanIntegrity,
} from "./plan-integrity.ts";
import type { DesiredSetting, PlannerInput, PlannerOwnership } from "./types.ts";

const DEFAULT_PLAN_TTL_MS = 15 * 60 * 1_000;
const compareText = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

function diagnosticSortKey(diagnostic: Diagnostic): string {
  return [diagnostic.code, diagnostic.subject ?? "", diagnostic.reasonCode ?? ""].join(":");
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
    rollbackQuality: "exact-if-unchanged",
    dependsOn: [],
    expectedBeforeDigest: observed.digest,
  });
}

function adoptionOperationFor(
  setting: DesiredSetting,
  observed: ObservedSetting,
): ResourceAdoptOperation {
  if (observed.status === "unavailable") {
    throw new TypeError("Cannot create an adoption operation for an unavailable setting");
  }
  const identity = {
    kind: "resource.adopt" as const,
    moduleId: setting.moduleId,
    resourceId: setting.target.resourceId,
    desired: setting.desired,
  };
  return ResourceAdoptOperationSchema.parse({
    ...identity,
    id: operationId(identity),
    privilege: "user",
    risk: "none",
    rollbackQuality: "exact-if-unchanged",
    dependsOn: [],
    expectedBeforeDigest: observed.digest,
  });
}

function publicObservation(observed: Exclude<ObservedSetting, { status: "unavailable" }>) {
  return observed.status === "present"
    ? {
        status: observed.status,
        effectiveRaw: observed.effectiveRaw,
        effective: observed.effective,
        storedRaw: observed.storedRaw,
        writable: observed.writable,
        digest: observed.digest,
      }
    : {
        status: observed.status,
        effectiveRaw: observed.effectiveRaw,
        effective: observed.effective,
        writable: observed.writable,
        digest: observed.digest,
      };
}

function ownershipAssertion(ownership: PlannerOwnership | undefined) {
  return ownership
    ? {
        status: "owned" as const,
        moduleId: ownership.moduleId,
        appliedDigest: ownership.appliedDigest,
      }
    : { status: "unowned" as const };
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

function diagnosticForOwnershipConflict(
  setting: DesiredSetting,
  code: "RESOURCE_OWNERSHIP_DRIFT" | "RESOURCE_OWNED_BY_ANOTHER_MODULE",
  ownership: PlannerOwnership,
): Diagnostic {
  const wrongModule = code === "RESOURCE_OWNED_BY_ANOTHER_MODULE";
  return {
    code,
    severity: "blocker",
    subject: setting.target.resourceId,
    reasonCode: wrongModule ? "MODULE_MISMATCH" : "APPLIED_STATE_CHANGED",
    relatedSubjects: [setting.moduleId, ownership.moduleId],
    message: wrongModule
      ? `${setting.target.resourceId} is owned by module ${ownership.moduleId}, not ${setting.moduleId}.`
      : `${setting.target.resourceId} changed after DeskCompat last applied it.`,
    remediation: wrongModule
      ? "Resolve the ownership record before applying this module."
      : "Review the external change, then explicitly reconcile or release ownership.",
  };
}

/**
 * @decision Planning is a pure description over explicit observations. The function
 * performs no mutation. The semantic digest excludes timestamps, while planId covers
 * the complete expiring artifact; identical state therefore has stable semantics but
 * each independently created plan remains a distinct immutable artifact.
 */
export async function buildPlan(input: PlannerInput): Promise<Plan> {
  const ttlMs = input.ttlMs ?? DEFAULT_PLAN_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_PLAN_TTL_MS) {
    throw new RangeError(`ttlMs must be an integer between 1 and ${MAX_PLAN_TTL_MS}`);
  }
  const scope = [...new Set(input.selectedModules)].sort(compareText);
  const includeInputCapabilities = planIncludesInputCapabilities(input.profile, scope);
  const operations: Operation[] = [];
  const resources: Plan["resources"] = [];
  const pushResource = (resource: unknown): void => {
    resources.push(ResolvedResourceSchema.parse(resource));
  };
  const diagnostics = [
    ...input.supportDiagnostics,
    ...(includeInputCapabilities ? input.facts.conflicts : []),
  ];
  if (diagnostics.some(({ severity }) => severity !== "blocker" && severity !== "warning")) {
    throw new TypeError("Plans accept only blocker and warning diagnostics");
  }
  const blockers = diagnostics.filter(({ severity }) => severity === "blocker");
  const warnings = diagnostics.filter(({ severity }) => severity === "warning");
  let unchanged = 0;
  let adoptions = 0;
  let unavailable = 0;
  let skipped = 0;

  const ownershipByResource = new Map<string, PlannerOwnership>();
  const duplicateOwnership = new Set<string>();
  for (const ownership of input.ownership ?? []) {
    if (ownershipByResource.has(ownership.resourceId)) duplicateOwnership.add(ownership.resourceId);
    else ownershipByResource.set(ownership.resourceId, ownership);
  }

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
    const currentOwnership = ownershipByResource.get(resourceId);
    const ownership = ownershipAssertion(currentOwnership);

    if (group.length > 1 || duplicateOwnership.has(resourceId)) {
      skipped += 1;
      const reasonCode =
        group.length > 1 ? "DUPLICATE_RESOURCE_OWNER" : "DUPLICATE_OWNERSHIP_RECORDS";
      blockers.push({
        code: reasonCode,
        severity: "blocker",
        subject: resourceId,
        reasonCode: "MULTIPLE_MODULES",
        relatedSubjects: moduleIds,
        message:
          group.length > 1
            ? `More than one module claims ${resourceId}.`
            : `More than one ownership record exists for ${resourceId}.`,
      });
      pushResource({
        moduleIds,
        resourceId,
        disposition: "skipped",
        ownership,
        desired,
        observed: { status: "skipped", reasonCode },
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
        ownership,
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
        ownership,
        desired,
        observed: { status: "unavailable", reasonCode: observed.reasonCode },
      });
      blockers.push(diagnosticForUnavailable(setting, observed));
      continue;
    }

    const observedResource = publicObservation(observed);
    if (currentOwnership && currentOwnership.moduleId !== setting.moduleId) {
      skipped += 1;
      blockers.push(
        diagnosticForOwnershipConflict(
          setting,
          "RESOURCE_OWNED_BY_ANOTHER_MODULE",
          currentOwnership,
        ),
      );
      pushResource({
        moduleIds,
        resourceId,
        disposition: "skipped",
        ownership,
        desired,
        observed: observedResource,
      });
      continue;
    }
    if (currentOwnership && currentOwnership.appliedDigest !== observed.digest) {
      skipped += 1;
      blockers.push(
        diagnosticForOwnershipConflict(setting, "RESOURCE_OWNERSHIP_DRIFT", currentOwnership),
      );
      pushResource({
        moduleIds,
        resourceId,
        disposition: "skipped",
        ownership,
        desired,
        observed: observedResource,
      });
      continue;
    }

    if (sha256(observed.effective) === sha256(setting.desired)) {
      if (!currentOwnership) {
        adoptions += 1;
        pushResource({
          moduleIds,
          resourceId,
          disposition: "adopt",
          ownership,
          desired,
          observed: observedResource,
        });
        operations.push(adoptionOperationFor(setting, observed));
        continue;
      }
      unchanged += 1;
      pushResource({
        moduleIds,
        resourceId,
        disposition: "unchanged",
        ownership,
        desired,
        observed: observedResource,
      });
      continue;
    }
    if (!observed.writable) {
      unavailable += 1;
      pushResource({
        moduleIds,
        resourceId,
        disposition: "unavailable",
        ownership,
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
      ownership,
      desired,
      observed: observedResource,
    });
    operations.push(operationFor(setting, observed));
  }

  operations.sort((left, right) => compareText(left.resourceId, right.resourceId));
  blockers.sort((left, right) => compareText(diagnosticSortKey(left), diagnosticSortKey(right)));
  warnings.sort((left, right) => compareText(diagnosticSortKey(left), diagnosticSortKey(right)));
  resources.sort((left, right) => compareText(left.resourceId, right.resourceId));

  const profileDigest = selectedProfileDigest(input.profile, scope);
  const factsDigest = planFactsDigest(input.facts, includeInputCapabilities);
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
    summary: {
      adoptions,
      changes: operations.filter(({ kind }) => kind === "gsettings.set").length,
      unchanged,
      unavailable,
      skipped,
    },
  };
  const createdAt = input.now ?? new Date();
  if (Number.isNaN(createdAt.getTime())) throw new RangeError("now must be a valid date");
  const expiresAt = new Date(createdAt.getTime() + ttlMs);
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
