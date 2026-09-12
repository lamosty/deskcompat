#!/usr/bin/env bun

import { ProfileLoadError, TransactionError } from "@deskcompat/core";
import type { Diagnostic } from "@deskcompat/schema";
import { GSettingsDriverError } from "@deskcompat/ubuntu-gnome";
import { CliUsageError, parseArguments } from "./arguments.ts";
import { apply, CliCommandError } from "./commands/apply.ts";
import { doctor } from "./commands/doctor.ts";
import { history } from "./commands/history.ts";
import { plan } from "./commands/plan.ts";
import { recover } from "./commands/recover.ts";
import { revert } from "./commands/revert.ts";
import { status } from "./commands/status.ts";
import { validateProfile } from "./commands/validate-profile.ts";
import { assertUnprivileged, CliEnvironmentError } from "./environment.ts";
import {
  result,
  writeDiagnostics,
  writeDoctor,
  writeHistory,
  writeJson,
  writePlan,
  writeStatus,
  writeTransaction,
} from "./output/render.ts";
import { DESKCOMPAT_VERSION } from "./version.ts";

const HELP = `DeskCompat ${DESKCOMPAT_VERSION}

Safe macOS muscle-memory compatibility for Ubuntu GNOME.

Usage:
  deskcompat doctor [--json]
  deskcompat profile validate [--profile PATH] [--json]
  deskcompat plan [--profile PATH] [--only MODULE,...] [--json]
  deskcompat apply --plan PATH [--json]
  deskcompat status [--json]
  deskcompat history [--json]
  deskcompat revert --transaction ID [--json]
  deskcompat recover --transaction ID [--json]
  deskcompat --version

Planning is read-only. This pre-alpha can apply and revert only four allowlisted scalar GNOME settings;
mutations are explicit, journaled operations over a validated plan and never accept arbitrary shell commands.
`;

function exitCodeFor(diagnostics: readonly Diagnostic[]): number {
  if (diagnostics.some(({ severity }) => severity === "blocker")) return 3;
  if (diagnostics.some(({ severity }) => severity === "error")) return 2;
  return 0;
}

async function main(): Promise<void> {
  const parsed = parseArguments(Bun.argv.slice(2));
  if (parsed.command === "help") {
    if (parsed.json) writeJson(result("help", { text: HELP }, []));
    else process.stdout.write(HELP);
    return;
  }
  if (parsed.command === "version") {
    if (parsed.json) writeJson(result("version", { version: DESKCOMPAT_VERSION }, []));
    else process.stdout.write(`${DESKCOMPAT_VERSION}\n`);
    return;
  }
  assertUnprivileged();

  if (parsed.command === "plan") {
    const commandResult = await plan(parsed.profilePath, parsed.only);
    if (parsed.json) writeJson(commandResult);
    else if (commandResult.data) writePlan(commandResult.data);
    process.exitCode = exitCodeFor(commandResult.diagnostics);
    return;
  }

  if (parsed.command === "apply") {
    const commandResult = await apply(parsed.planPath ?? "");
    if (parsed.json) writeJson(commandResult);
    else if (commandResult.data) writeTransaction("apply", commandResult.data);
    process.exitCode = exitCodeFor(commandResult.diagnostics);
    return;
  }

  if (parsed.command === "status") {
    const commandResult = await status();
    if (parsed.json) writeJson(commandResult);
    else if (commandResult.data) {
      writeStatus(commandResult.data.ownership, commandResult.data.resources);
      writeDiagnostics(commandResult.diagnostics);
    }
    process.exitCode = exitCodeFor(commandResult.diagnostics);
    return;
  }

  if (parsed.command === "history") {
    const commandResult = await history();
    if (parsed.json) writeJson(commandResult);
    else if (commandResult.data) writeHistory(commandResult.data.transactions);
    process.exitCode = exitCodeFor(commandResult.diagnostics);
    return;
  }

  if (parsed.command === "revert" || parsed.command === "recover") {
    const commandResult =
      parsed.command === "revert"
        ? await revert(parsed.transactionId ?? "")
        : await recover(parsed.transactionId ?? "");
    if (parsed.json) writeJson(commandResult);
    else if (commandResult.data) writeTransaction(parsed.command, commandResult.data);
    process.exitCode = exitCodeFor(commandResult.diagnostics);
    return;
  }

  if (parsed.command === "doctor") {
    const commandResult = await doctor();
    if (parsed.json) writeJson(commandResult);
    else if (commandResult.data) writeDoctor(commandResult.data, commandResult.diagnostics);
    process.exitCode = exitCodeFor(commandResult.diagnostics);
    return;
  }

  const commandResult = await validateProfile(parsed.profilePath);
  if (parsed.json) writeJson(commandResult);
  else {
    process.stdout.write(`${commandResult.ok ? "OK" : "BLOCKED"}: ${commandResult.command}\n`);
    writeDiagnostics(commandResult.diagnostics);
  }
  process.exitCode = exitCodeFor(commandResult.diagnostics);
}

try {
  await main();
} catch (error) {
  const json = Bun.argv.includes("--json");
  const diagnostic: Diagnostic =
    error instanceof CliUsageError
      ? { code: "INVALID_INVOCATION", severity: "error", message: error.message }
      : error instanceof ProfileLoadError
        ? { code: error.code, severity: "error", message: error.message }
        : error instanceof CliEnvironmentError
          ? { code: error.code, severity: "blocker", message: error.message }
          : error instanceof CliCommandError
            ? { code: error.code, severity: "error", message: error.message }
            : error instanceof TransactionError
              ? {
                  code: error.code,
                  severity: "error",
                  message: "DeskCompat could not complete the requested transaction.",
                  remediation: "Review the transaction status and run recover if required.",
                }
              : error instanceof GSettingsDriverError
                ? {
                    code: error.code,
                    severity: "error",
                    message:
                      "The GNOME settings driver could not complete the requested operation.",
                  }
                : {
                    code: "UNEXPECTED_FAILURE",
                    severity: "error",
                    message: "DeskCompat could not complete the requested operation.",
                    remediation:
                      "Retry with a supported environment and report the diagnostic code.",
                  };

  if (json) writeJson(result("invocation", undefined, [diagnostic]));
  else writeDiagnostics([diagnostic]);
  process.exitCode = exitCodeFor([diagnostic]);
}
