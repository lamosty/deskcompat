export type TransactionErrorCode =
  | "ACTIVE_TRANSACTION"
  | "BINDING_MISMATCH"
  | "BLOCKED_PLAN"
  | "EXPIRED_PLAN"
  | "EXTERNAL_DRIFT"
  | "INTEGRITY_FAILURE"
  | "INVALID_STATE_PATH"
  | "JOURNAL_CORRUPT"
  | "PLAN_ALREADY_PERSISTED"
  | "PLAN_NOT_FOUND"
  | "RESOURCE_UNAVAILABLE"
  | "SYMLINK_REFUSED"
  | "TRANSACTION_NOT_FOUND"
  | "UNSUPPORTED_OPERATION";

export class TransactionError extends Error {
  constructor(
    readonly code: TransactionErrorCode,
    message: string,
    readonly subject?: string,
  ) {
    super(message);
    this.name = "TransactionError";
  }
}
