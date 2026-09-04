import {
  type Diagnostic,
  GSETTINGS_OPERATION_POLICIES,
  type GSettingsResourceId,
  type GSettingsValue,
  type ModuleId,
  type Operation,
  type Plan,
  PlanSchema,
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

function diagnosticIdentity(diagnostic: Diagnostic): unknown {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    subject: diagnostic.subject ?? null,
    reasonCode: diagnostic.reasonCode ?? null,
    relatedSubjects: diagnostic.relatedSubjects ?? [],
  };
}

export function operationId(operation: {
  readonly kind: "gsettings.set";
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

/**
 * @constraint Schema validity alone never authorizes a future apply. Integrity also
 * binds cross-field IDs, resource observations, ordering, dependencies, summaries,
 * semantic content, and the complete expiring artifact.
 */
export function verifyPlanIntegrity(candidate: unknown): candidate is Plan {
  const parsed = PlanSchema.safeParse(candidate);
  if (!parsed.success) return false;
  const plan = parsed.data;

  if (!isSortedUnique(plan.scope)) return false;
  if (!isSortedUnique(plan.resources.map(({ resourceId }) => resourceId))) return false;
  if (!isSortedUnique(plan.operations.map(({ resourceId }) => resourceId))) return false;

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
    const hasObservedDigest = "digest" in resource.observed;

    if (resource.disposition === "change") {
      if (!operation || !("digest" in resource.observed) || !resource.observed.writable) {
        return false;
      }
      if (resource.moduleIds.length !== 1 || resource.desired.length !== 1) return false;
    } else if (operation) {
      return false;
    }

    if (resource.disposition === "unchanged" && !hasObservedDigest) return false;
    if (resource.disposition === "unavailable" && resource.observed.status !== "unavailable") {
      return false;
    }
    if (resource.disposition === "skipped" && resource.observed.status !== "skipped") {
      return false;
    }
    if (
      resource.moduleIds.length > 1 &&
      (resource.disposition !== "skipped" ||
        resource.observed.status !== "skipped" ||
        resource.observed.reasonCode !== "DUPLICATE_RESOURCE_OWNER")
    ) {
      return false;
    }
  }

  for (const operation of plan.operations) {
    const policy = GSETTINGS_OPERATION_POLICIES[operation.resourceId];
    if (
      operation.moduleId !== policy.moduleId ||
      operation.risk !== policy.risk ||
      operation.rollbackQuality !== policy.rollbackQuality
    ) {
      return false;
    }
    if (operation.id !== operationId(operation)) return false;
    if (!isSortedUnique(operation.dependsOn)) return false;
    if (operation.dependsOn.some((dependency) => !operationIds.has(dependency))) return false;
    if (operation.dependsOn.includes(operation.id)) return false;

    const resource = plan.resources.find(({ resourceId }) => resourceId === operation.resourceId);
    if (resource?.disposition !== "change") return false;
    if (!("digest" in resource.observed)) return false;
    if (resource.observed.digest !== operation.expectedBeforeDigest) return false;
    if (!resource.moduleIds.includes(operation.moduleId)) return false;
    if (!resource.desired.some((desired) => sha256(desired) === sha256(operation.desired))) {
      return false;
    }
  }
  if (hasDependencyCycle(plan.operations)) return false;

  const counts = {
    changes: plan.resources.filter(({ disposition }) => disposition === "change").length,
    unchanged: plan.resources.filter(({ disposition }) => disposition === "unchanged").length,
    unavailable: plan.resources.filter(({ disposition }) => disposition === "unavailable").length,
    skipped: plan.resources.filter(({ disposition }) => disposition === "skipped").length,
  };
  if (sha256(counts) !== sha256(plan.summary)) return false;
  if (plan.operations.length !== plan.summary.changes) return false;

  const { planId: claimedPlanId, ...artifact } = plan;
  if (planId(artifact) !== claimedPlanId) return false;
  if (semanticDigest(plan) !== plan.semanticDigest) return false;
  return true;
}
