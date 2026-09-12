import { type TransactionDriver, TransactionStore } from "@deskcompat/core";
import type {
  CliResult,
  GSettingsResourceId,
  OwnershipIndex,
  TransactionRecord,
} from "@deskcompat/schema";
import { createLiveTransactionDriver } from "@deskcompat/ubuntu-gnome";
import { result } from "../output/render.ts";
import { listTransactions } from "./history.ts";

export interface StatusResource {
  readonly resourceId: GSettingsResourceId;
  readonly baselineDigest: string;
  readonly appliedDigest: string;
  readonly currentDigest?: string;
  readonly state: "aligned" | "drifted" | "unavailable";
}

export interface StatusData {
  readonly ownership: OwnershipIndex;
  readonly transactions: readonly TransactionRecord[];
  readonly resources: readonly StatusResource[];
}

export interface StatusDependencies {
  readonly store?: TransactionStore;
  readonly driver?: TransactionDriver;
  readonly environment?: NodeJS.ProcessEnv;
}

export async function status(
  dependencies: StatusDependencies = {},
): Promise<CliResult<StatusData>> {
  const store = dependencies.store ?? new TransactionStore();
  const ownership = await store.readOwnership();
  const transactions = await listTransactions(store);
  const driver = dependencies.driver ?? createLiveTransactionDriver(dependencies.environment);
  const resources: StatusResource[] = [];
  const diagnostics = [];
  for (const entry of ownership.resources) {
    try {
      const current = await driver.inspect(entry.resourceId);
      if (current.digest === entry.appliedDigest) {
        resources.push({
          resourceId: entry.resourceId,
          baselineDigest: entry.baselineDigest,
          appliedDigest: entry.appliedDigest,
          currentDigest: current.digest,
          state: "aligned",
        });
      } else {
        resources.push({
          resourceId: entry.resourceId,
          baselineDigest: entry.baselineDigest,
          appliedDigest: entry.appliedDigest,
          currentDigest: current.digest,
          state: "drifted",
        });
        diagnostics.push({
          code: "RESOURCE_DRIFT",
          severity: "warning" as const,
          subject: entry.resourceId,
          reasonCode: "APPLIED_DIGEST_CHANGED",
          message: "A managed GNOME setting differs from DeskCompat's last verified value.",
        });
      }
    } catch {
      resources.push({
        resourceId: entry.resourceId,
        baselineDigest: entry.baselineDigest,
        appliedDigest: entry.appliedDigest,
        state: "unavailable",
      });
      diagnostics.push({
        code: "RESOURCE_UNAVAILABLE",
        severity: "warning" as const,
        subject: entry.resourceId,
        reasonCode: "INSPECTION_FAILED",
        message: "A managed GNOME setting could not be inspected.",
      });
    }
  }
  return result("status", { ownership, transactions, resources }, diagnostics);
}
