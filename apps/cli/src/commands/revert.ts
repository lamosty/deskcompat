import {
  type LockRuntime,
  type TransactionDriver,
  TransactionEngine,
  TransactionStore,
} from "@deskcompat/core";
import type { CliResult, PlanBinding, TransactionRecord } from "@deskcompat/schema";
import { createLiveTransactionDriver } from "@deskcompat/ubuntu-gnome";
import { result, transactionDiagnostics } from "../output/render.ts";
import { localPlanBinding } from "./apply.ts";

export interface RevertDependencies {
  readonly store?: TransactionStore;
  readonly driver?: TransactionDriver;
  readonly binding?: PlanBinding;
  readonly now?: () => Date;
  readonly lockRuntime?: LockRuntime;
  readonly environment?: NodeJS.ProcessEnv;
}

async function execute(
  transactionId: string,
  mode: "revert" | "recover",
  dependencies: RevertDependencies,
): Promise<CliResult<TransactionRecord>> {
  const store = dependencies.store ?? new TransactionStore();
  const engine = new TransactionEngine(store);
  // The engine verifies this binding against the private persisted plan before any
  // compensation. No plan/session metadata is emitted to the CLI result.
  const binding = dependencies.binding ?? localPlanBinding(dependencies.environment);
  const driver = dependencies.driver ?? createLiveTransactionDriver(dependencies.environment);
  const shared = {
    transactionId,
    binding,
    driver,
    ...(dependencies.now ? { now: dependencies.now } : {}),
    ...(dependencies.lockRuntime ? { lockRuntime: dependencies.lockRuntime } : {}),
  } as const;
  const transaction =
    mode === "revert"
      ? await engine.revertTransaction(shared)
      : await engine.recoverTransaction(shared);
  return result(mode, transaction, transactionDiagnostics(transaction));
}

export async function revert(
  transactionId: string,
  dependencies: RevertDependencies = {},
): Promise<CliResult<TransactionRecord>> {
  return execute(transactionId, "revert", dependencies);
}

export async function recover(
  transactionId: string,
  dependencies: RevertDependencies = {},
): Promise<CliResult<TransactionRecord>> {
  return execute(transactionId, "recover", dependencies);
}
