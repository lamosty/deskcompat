import {
  type Diagnostic,
  GSETTINGS_OPERATION_POLICIES,
  type GSettingsResourceId,
  type GSettingsValue,
  MAX_PLAN_TTL_MS,
  type ModuleId,
  type Operation,
  type Plan,
  PlanSchema,
  RESOURCE_ADOPT_OPERATION_POLICIES,
} from "@deskcompat/schema";
import { sha256 } from "../canonical-json.ts";

type PlanBody = Pick<
  Plan,
  | "apiVersion"
  | "profileDigest"
  | "factsDigest"
  | "toolVersion"
  | "supportTarget"
  | "scope"
  | "resources"
  | "operations"
  | "blockers"
  | "warnings"
  | "summary"
>;

type PlanArtifact = Omit<Plan, "planId">;
type AvailableObservation = Extract<
  Plan["resources"][number]["observed"],
  { status: "present" | "inherited" }
>;

function diagnosticIdentity(diagnostic: Diagnostic): unknown {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    subject: diagnostic.subject ?? null,
    reasonCode: diagnostic.reasonCode ?? null,
    relatedSubjects: diagnostic.relatedSubjects ?? [],
  };
}

function diagnosticSortKey(diagnostic: Diagnostic): string {
  return [diagnostic.code, diagnostic.subject ?? "", diagnostic.reasonCode ?? ""].join(":");
}

export function operationId(operation: {
  readonly kind: Operation["kind"];
  readonly moduleId: ModuleId;
  readonly resourceId: GSettingsResourceId;
  readonly desired: GSettingsValue;
}): string {
  return `op_${sha256({
    kind: operation.kind,
    moduleId: operation.moduleId,
    resourceId: operation.resourceId,
    desired: operation.desired,
  })}`;
}

export function semanticDigest(plan: PlanBody): string {
  return `sem_${sha256({
    domain: "deskcompat.semantic-plan.v1alpha1",
    apiVersion: plan.apiVersion,
    profileDigest: plan.profileDigest,
    factsDigest: plan.factsDigest,
    toolVersion: plan.toolVersion,
    supportTarget: plan.supportTarget,
    scope: plan.scope,
    resources: plan.resources,
    operations: plan.operations,
    blockers: plan.blockers.map(diagnosticIdentity),
    warnings: plan.warnings.map(diagnosticIdentity),
    summary: plan.summary,
  })}`;
}

export function planId(plan: PlanArtifact): string {
  return `pln_${sha256({ domain: "deskcompat.plan-artifact.v1alpha1", ...plan })}`;
}

function isSortedUnique(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous >= current) return false;
  }
  return new Set(values).size === values.length;
}

function isSorted(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous > current) return false;
  }
  return true;
}

function hasDependencyCycle(operations: readonly Operation[]): boolean {
  const dependencies = new Map(operations.map(({ id, dependsOn }) => [id, dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return operations.some(({ id }) => visit(id));
}

function isAvailableObservation(
  observed: Plan["resources"][number]["observed"],
): observed is AvailableObservation {
  return observed.status === "present" || observed.status === "inherited";
}

function observationDigest(
  resourceId: GSettingsResourceId,
  observed: AvailableObservation,
): string {
  const { digest: _, ...state } = observed;
  return sha256({
    domain: "deskcompat.gsettings-observation.v1",
    resourceId,
    ...state,
  });
}

function hasBlocker(plan: Plan, code: string, subject: string): boolean {
  return plan.blockers.some(
    (diagnostic) => diagnostic.code === code && diagnostic.subject === subject,
  );
}

function operationPolicyMatches(operation: Operation): boolean {
  if (operation.kind === "gsettings.set") {
    const policy = GSETTINGS_OPERATION_POLICIES[operation.resourceId];
    return (
      operation.moduleId === policy.moduleId &&
      operation.risk === policy.risk &&
      operation.rollbackQuality === policy.rollbackQuality
    );
  }
  const policy = RESOURCE_ADOPT_OPERATION_POLICIES[operation.resourceId];
  return (
    operation.moduleId === policy.moduleId &&
    operation.risk === policy.risk &&
    operation.rollbackQuality === policy.rollbackQuality
  );
}

/**
 * @constraint Schema validity and deterministic hashes detect corruption; they do
 * not constitute user authorization or a cryptographic approval boundary. A future
 * apply path must independently enforce its user/session binding and privilege policy.
 *
 * @constraint Cross-field checks bind every operation to one resource assertion,
 * verify observation preconditions, ownership disposition, deterministic ordering,
 * summary counts, dependency closure, and the bounded lifetime of the artifact.
 */
export function verifyPlanIntegrity(candidate: unknown): candidate is Plan {
  const parsed = PlanSchema.safeParse(candidate);
  if (!parsed.success) return false;
  const plan = parsed.data;

  if (!isSortedUnique(plan.scope)) return false;
  if (!isSortedUnique(plan.resources.map(({ resourceId }) => resourceId))) return false;
  if (!isSortedUnique(plan.operations.map(({ resourceId }) => resourceId))) return false;
  if (!isSorted(plan.blockers.map(diagnosticSortKey))) return false;
  if (!isSorted(plan.warnings.map(diagnosticSortKey))) return false;
  if (plan.blockers.some(({ severity }) => severity !== "blocker")) return false;
  if (plan.warnings.some(({ severity }) => severity !== "warning")) return false;

  const createdAt = Date.parse(plan.createdAt);
  const expiresAt = Date.parse(plan.expiresAt);
  const ttl = expiresAt - createdAt;
  if (ttl <= 0 || ttl > MAX_PLAN_TTL_MS) return false;

  const scope = new Set<ModuleId>(plan.scope);
  const operationsByResource = new Map(
    plan.operations.map((operation) => [operation.resourceId, operation] as const),
  );
  const operationIds = new Set(plan.operations.map(({ id }) => id));
  if (operationIds.size !== plan.operations.length) return false;

  for (const resource of plan.resources) {
    if (!isSortedUnique(resource.moduleIds)) return false;
    if (resource.moduleIds.some((moduleId) => !scope.has(moduleId))) return false;
    if (resource.desired.length !== resource.moduleIds.length) return false;

    const policy = GSETTINGS_OPERATION_POLICIES[resource.resourceId];
    if (!resource.moduleIds.includes(policy.moduleId)) return false;
    const operation = operationsByResource.get(resource.resourceId);
    const observed = resource.observed;
    const available = isAvailableObservation(observed);
    if (available && observed.digest !== observationDigest(resource.resourceId, observed)) {
      return false;
    }

    if (resource.disposition === "adopt") {
      if (
        operation?.kind !== "resource.adopt" ||
        !available ||
        resource.ownership.status !== "unowned" ||
        resource.moduleIds.length !== 1 ||
        resource.desired.length !== 1 ||
        sha256(resource.desired[0]) !== sha256(observed.effective)
      ) {
        return false;
      }
    } else if (resource.disposition === "change") {
      if (
        operation?.kind !== "gsettings.set" ||
        !available ||
        !observed.writable ||
        resource.moduleIds.length !== 1 ||
        resource.desired.length !== 1 ||
        sha256(resource.desired[0]) === sha256(observed.effective)
      ) {
        return false;
      }
      if (
        resource.ownership.status === "owned" &&
        (resource.ownership.moduleId !== resource.moduleIds[0] ||
          resource.ownership.appliedDigest !== observed.digest)
      ) {
        return false;
      }
    } else if (resource.disposition === "unchanged") {
      if (
        operation ||
        !available ||
        resource.ownership.status !== "owned" ||
        resource.ownership.moduleId !== resource.moduleIds[0] ||
        resource.ownership.appliedDigest !== observed.digest ||
        resource.desired.length !== 1 ||
        sha256(resource.desired[0]) !== sha256(observed.effective)
      ) {
        return false;
      }
    } else if (resource.disposition === "unavailable") {
      if (operation || observed.status !== "unavailable") return false;
    } else {
      if (operation) return false;
      if (observed.status === "skipped") {
        if (resource.moduleIds.length > 1) {
          if (
            observed.reasonCode !== "DUPLICATE_RESOURCE_OWNER" ||
            !hasBlocker(plan, "DUPLICATE_RESOURCE_OWNER", resource.resourceId)
          ) {
            return false;
          }
        } else if (
          observed.reasonCode !== "UNSUPPORTED_HOST" &&
          observed.reasonCode !== "DUPLICATE_OWNERSHIP_RECORDS"
        ) {
          return false;
        }
      } else if (available && resource.ownership.status === "owned") {
        const wrongModule = resource.ownership.moduleId !== resource.moduleIds[0];
        const drifted = resource.ownership.appliedDigest !== observed.digest;
        if (
          wrongModule !==
            hasBlocker(plan, "RESOURCE_OWNED_BY_ANOTHER_MODULE", resource.resourceId) ||
          (!wrongModule &&
            drifted !== hasBlocker(plan, "RESOURCE_OWNERSHIP_DRIFT", resource.resourceId)) ||
          (!wrongModule && !drifted)
        ) {
          return false;
        }
      } else {
        return false;
      }
    }
  }

  for (const operation of plan.operations) {
    if (!operationPolicyMatches(operation)) return false;
    if (operation.id !== operationId(operation)) return false;
    if (!isSortedUnique(operation.dependsOn)) return false;
    // @constraint The v0.1 executor is intentionally linear and does not yet enforce
    // dependency edges. Reject such artifacts rather than validating metadata that
    // mutation would then ignore.
    if (operation.dependsOn.length > 0) return false;
    if (operation.dependsOn.some((dependency) => !operationIds.has(dependency))) return false;
    if (operation.dependsOn.includes(operation.id)) return false;

    const resource = plan.resources.find(({ resourceId }) => resourceId === operation.resourceId);
    if (!resource || !isAvailableObservation(resource.observed)) return false;
    if (resource.observed.digest !== operation.expectedBeforeDigest) return false;
    if (!resource.moduleIds.includes(operation.moduleId)) return false;
    if (!resource.desired.some((desired) => sha256(desired) === sha256(operation.desired))) {
      return false;
    }
    if (
      (operation.kind === "resource.adopt" && resource.disposition !== "adopt") ||
      (operation.kind === "gsettings.set" && resource.disposition !== "change")
    ) {
      return false;
    }
  }
  if (hasDependencyCycle(plan.operations)) return false;

  const counts = {
    adoptions: plan.resources.filter(({ disposition }) => disposition === "adopt").length,
    changes: plan.resources.filter(({ disposition }) => disposition === "change").length,
    unchanged: plan.resources.filter(({ disposition }) => disposition === "unchanged").length,
    unavailable: plan.resources.filter(({ disposition }) => disposition === "unavailable").length,
    skipped: plan.resources.filter(({ disposition }) => disposition === "skipped").length,
  };
  if (sha256(counts) !== sha256(plan.summary)) return false;
  if (plan.operations.length !== plan.summary.changes + plan.summary.adoptions) return false;

  const { planId: claimedPlanId, ...artifact } = plan;
  if (planId(artifact) !== claimedPlanId) return false;
  if (semanticDigest(plan) !== plan.semanticDigest) return false;
  return true;
}
