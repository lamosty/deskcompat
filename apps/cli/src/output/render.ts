import { renderGVariant } from "@deskcompat/core";
import {
  CLI_API_VERSION,
  type CliCommand,
  type CliResult,
  CliResultSchema,
  type Diagnostic,
  type HostFacts,
  type OwnershipIndex,
  type Plan,
  type TransactionRecord,
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
    `Adoptions: ${plan.summary.adoptions}; changes: ${plan.summary.changes}; unchanged: ${plan.summary.unchanged}; unavailable: ${plan.summary.unavailable}; skipped: ${plan.summary.skipped}\n`,
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
      `  ${operation.resourceId}\n    operation=${operation.id} kind=${operation.kind} risk=${operation.risk} privilege=${operation.privilege} rollback=${operation.rollbackQuality}\n`,
    );
  }
  if (plan.summary.adoptions > 0) {
    process.stdout.write(
      "Adoption records the matching value as DeskCompat's first known baseline; it does not change the GNOME value.\n",
    );
  }
  writeDiagnostics([...plan.blockers, ...plan.warnings]);
  process.stdout.write(
    "Plan preview only: apply requires this exact plan artifact and explicit invocation.\n",
  );
}

export function writeTransaction(
  command: "apply" | "revert" | "recover",
  record: TransactionRecord,
): void {
  process.stdout.write(`${command}: ${record.status}\n`);
  process.stdout.write(`Transaction: ${record.transactionId}\n`);
  process.stdout.write(`Resources: ${record.receipts.length}\n`);
  if (record.conflicts.length > 0) {
    process.stdout.write(`Conflicts: ${record.conflicts.join(", ")}\n`);
  }
}

export function transactionDiagnostics(record: TransactionRecord): Diagnostic[] {
  if (record.status === "committed" || record.status === "reverted") return [];
  const reasonCode =
    record.status === "recovery-required"
      ? "RECOVERY_REQUIRED"
      : record.status === "conflicted"
        ? "EXTERNAL_CONFLICT"
        : "TRANSACTION_FAILED";
  return [
    {
      code: `TRANSACTION_${record.status.replaceAll("-", "_").toUpperCase()}`,
      severity: record.status === "recovery-required" ? "blocker" : "error",
      subject: record.transactionId,
      reasonCode,
      message: `Transaction ended in ${record.status}; no successful completion is claimed.`,
      remediation:
        record.status === "recovery-required"
          ? "Inspect the transaction and run recover before retrying."
          : "Review status and history before retrying the operation.",
    },
  ];
}

export function writeHistory(records: readonly TransactionRecord[]): void {
  if (records.length === 0) {
    process.stdout.write("No transactions.\n");
    return;
  }
  for (const record of records) {
    process.stdout.write(
      `${record.transactionId} ${record.mode} ${record.status} ${record.startedAt}\n`,
    );
  }
}

export function writeStatus(
  ownership: OwnershipIndex,
  resources: ReadonlyArray<{
    readonly resourceId: string;
    readonly state: "aligned" | "drifted" | "unavailable";
  }>,
): void {
  process.stdout.write(`Managed resources: ${ownership.resources.length}\n`);
  for (const resource of resources) {
    process.stdout.write(`  [${resource.state}] ${resource.resourceId}\n`);
  }
}
