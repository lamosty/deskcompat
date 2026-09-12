import { TransactionStore } from "@deskcompat/core";
import type { CliResult, TransactionRecord } from "@deskcompat/schema";
import { result } from "../output/render.ts";

export interface HistoryData {
  readonly transactions: readonly TransactionRecord[];
}

/**
 * List only records in DeskCompat's own state directory. Filenames are treated as
 * untrusted input and are passed through TransactionStore's strict identifier
 * validation; no arbitrary path supplied by a user is ever opened here.
 */
export async function listTransactions(store: TransactionStore): Promise<TransactionRecord[]> {
  return store.listTransactions();
}

export interface HistoryDependencies {
  readonly store?: TransactionStore;
}

export async function history(
  dependencies: HistoryDependencies = {},
): Promise<CliResult<HistoryData>> {
  const transactions = await listTransactions(dependencies.store ?? new TransactionStore());
  return result("history", { transactions }, []);
}
