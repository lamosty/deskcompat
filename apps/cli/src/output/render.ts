import { renderGVariant } from "@deskcompat/core";
import {
  CLI_API_VERSION,
  CliResultSchema,
  type CliCommand,
  type CliResult,
  type Diagnostic,
  type HostFacts,
  type Plan,
} from "@deskcompat/schema";

export function terminalSafe(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    result +=
      code <= 0x1f || (code >= 0x7f && code <= 0x9f)
        ? `\\u{${code.toString(16).padStart(2, "0")}}`
        : character;
  }
  return result;
}

export function result<T>(
  command: CliCommand,
  data: T | undefined,
  diagnostics: readonly Diagnostic[],
): CliResult<T> {
  return {
    apiVersion: CLI_API_VERSION,
    ok: !diagnostics.some(({ severity }) => severity === "error" || severity === "blocker"),
    command,
    ...(data === undefined ? {} : { data }),
    diagnostics,
  };
}

export function writeJson(value: unknown): void {
  const validated = CliResultSchema.parse(value);
  process.stdout.write(`${JSON.stringify(validated, null, 2)}\n`);
}

export function writeDiagnostics(diagnostics: readonly Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    process.stdout.write(
      `${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${terminalSafe(diagnostic.message)}\n`,
    );
    if (diagnostic.remediation) {
      process.stdout.write(`  ${terminalSafe(diagnostic.remediation)}\n`);
    }
  }
}

export function writeDoctor(facts: HostFacts, diagnostics: readonly Diagnostic[]): void {
  const { platform } = facts;
  process.stdout.write(
    `Platform: os=${platform.osId}/${platform.osVersion} desktop=${platform.desktop}/${platform.desktopVersion} session=${platform.sessionType}\n`,
  );
  process.stdout.write("Capabilities:\n");
  for (const capability of facts.capabilities) {
    process.stdout.write(`  ${capability.id}: ${capability.available ? "available" : "missing"}\n`);
  }
  writeDiagnostics(diagnostics);
}

export function writePlan(plan: Plan): void {
  process.stdout.write(`Plan ${plan.planId}\n`);
  process.stdout.write(`Semantic digest: ${plan.semanticDigest}\n`);
  process.stdout.write(`Selected profile intent: ${plan.profileDigest.slice(0, 12)}\n`);
  process.stdout.write(`Scope: ${plan.scope.join(", ") || "none"}\n`);
  process.stdout.write(
    `Changes: ${plan.summary.changes}; unchanged: ${plan.summary.unchanged}; unavailable: ${plan.summary.unavailable}; skipped: ${plan.summary.skipped}\n`,
  );
  for (const resource of plan.resources) {
    const observed =
      "effective" in resource.observed
        ? `${resource.observed.status} ${renderGVariant(resource.observed.effective)}`
        : `${resource.observed.status} (${resource.observed.reasonCode})`;
    const desired = resource.desired.map(renderGVariant).join(" or ");
    process.stdout.write(
      `  [${resource.disposition}] ${resource.resourceId}\n    current=${terminalSafe(observed)} desired=${terminalSafe(desired)}\n`,
    );
  }
  if (plan.operations.length > 0) process.stdout.write("Prospective operations:\n");
  for (const operation of plan.operations) {
    process.stdout.write(
      `  ${operation.resourceId}\n    operation=${operation.id} risk=${operation.risk} privilege=${operation.privilege} rollback=${operation.rollbackQuality}\n`,
    );
  }
  writeDiagnostics([...plan.blockers, ...plan.warnings]);
  process.stdout.write("Read-only preview: apply is not available in this pre-alpha build.\n");
}
