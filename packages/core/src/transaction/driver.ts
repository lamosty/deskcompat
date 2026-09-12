import type {
  GSettingsOperation,
  GSettingsResourceId,
  GSettingsSnapshot,
} from "@deskcompat/schema";

export interface MutationReceipt {
  /** Observation checked by the driver immediately before its write. */
  readonly beforeDigest: string;
}

/**
 * @decision The kernel depends on a resource driver, not on subprocesses or GNOME.
 * A driver must implement compare-before-write itself because an engine-level inspect
 * followed by a write would otherwise create an avoidable race window.
 */
export interface TransactionDriver {
  inspect(resourceId: GSettingsResourceId): Promise<GSettingsSnapshot>;
  apply(operation: GSettingsOperation, expectedBefore: GSettingsSnapshot): Promise<MutationReceipt>;
  restore(
    resourceId: GSettingsResourceId,
    before: GSettingsSnapshot,
    expectedCurrentDigest: string,
  ): Promise<MutationReceipt>;
}

export type FailurePoint =
  | "after_transaction_started"
  | "after_before_saved"
  | "after_operation_intent"
  | "after_driver_apply"
  | "after_operation_applied"
  | "before_ownership_write"
  | "after_ownership_write"
  | "after_compensation_intent"
  | "after_driver_restore";

export interface FailureContext {
  readonly transactionId: string;
  readonly resourceId?: GSettingsResourceId;
}

export type FailureInjector = (
  point: FailurePoint,
  context: FailureContext,
) => void | Promise<void>;
