import { z } from "zod";
import {
  BooleanGSettingsValueSchema,
  GSettingsResourceIdSchema,
  Int32GSettingsValueSchema,
  StringGSettingsValueSchema,
} from "./operations.ts";
import { PlanSchema } from "./plan.ts";
import { ModuleIdSchema } from "./profile.ts";

export const TRANSACTION_API_VERSION = "deskcompat.dev/transaction/v1alpha1" as const;
export const PERSISTED_PLAN_API_VERSION = "deskcompat.dev/persisted-plan/v1alpha1" as const;
export const OWNERSHIP_API_VERSION = "deskcompat.dev/ownership/v1alpha1" as const;

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const TransactionIdSchema = z.string().regex(/^tx_[a-f0-9]{64}$/);
const OperationIdSchema = z.string().regex(/^op_[a-f0-9]{64}$/);

const PresentStateShape = {
  status: z.literal("present"),
  effectiveRaw: z.string(),
  storedRaw: z.string().min(1),
  writable: z.boolean(),
} as const;
const InheritedStateShape = {
  status: z.literal("inherited"),
  effectiveRaw: z.string(),
  writable: z.boolean(),
} as const;

function stateSchema<Value extends z.ZodType>(effective: Value) {
  return z.discriminatedUnion("status", [
    z.object({ ...PresentStateShape, effective }).strict(),
    z.object({ ...InheritedStateShape, effective }).strict(),
  ]);
}

/**
 * @constraint Recovery snapshots use the same closed resource vocabulary as plans.
 * Complete snapshots are private recovery material; public transaction/status output
 * contains only their digests. Reviewed plan artifacts may contain the allowlisted
 * resource's raw GVariant observation and are documented as non-share-safe.
 */
export const GSettingsSnapshotSchema = z.discriminatedUnion("resourceId", [
  z
    .object({
      resourceId: z.literal("gsettings:org.gnome.mutter:dynamic-workspaces"),
      state: stateSchema(BooleanGSettingsValueSchema),
      digest: DigestSchema,
    })
    .strict(),
  z
    .object({
      resourceId: z.literal("gsettings:org.gnome.desktop.wm.preferences:num-workspaces"),
      state: stateSchema(Int32GSettingsValueSchema),
      digest: DigestSchema,
    })
    .strict(),
  z
    .object({
      resourceId: z.literal("gsettings:org.gnome.mutter:workspaces-only-on-primary"),
      state: stateSchema(BooleanGSettingsValueSchema),
      digest: DigestSchema,
    })
    .strict(),
  z
    .object({
      resourceId: z.literal("gsettings:org.gnome.desktop.wm.preferences:button-layout"),
      state: stateSchema(StringGSettingsValueSchema),
      digest: DigestSchema,
    })
    .strict(),
]);

export const PlanBindingSchema = z
  .object({
    effectiveUid: z.number().int().nonnegative(),
    sessionDigest: DigestSchema,
  })
  .strict();

export const PersistedPlanSchema = z
  .object({
    apiVersion: z.literal(PERSISTED_PLAN_API_VERSION),
    plan: PlanSchema,
    binding: PlanBindingSchema,
    savedAt: z.string().datetime(),
    integrityDigest: DigestSchema,
  })
  .strict();

export const OwnershipEntrySchema = z
  .object({
    resourceId: GSettingsResourceIdSchema,
    moduleId: ModuleIdSchema,
    origin: z.enum(["adopted", "changed"]),
    baselineBlobDigest: DigestSchema,
    baselineDigest: DigestSchema,
    appliedDigest: DigestSchema,
    acquiredByTransactionId: TransactionIdSchema,
    lastTransactionId: TransactionIdSchema,
    acquiredAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const OwnershipIndexSchema = z
  .object({
    apiVersion: z.literal(OWNERSHIP_API_VERSION),
    resources: z.array(OwnershipEntrySchema),
  })
  .strict();

export const TransactionStatusSchema = z.enum([
  "preparing",
  "applying",
  "committed",
  "reverting",
  "reverted",
  "conflicted",
  "recovery-required",
  "failed",
]);

export const TransactionReceiptSchema = z
  .object({
    action: z.enum(["apply", "adopt"]),
    resourceId: GSettingsResourceIdSchema,
    moduleId: ModuleIdSchema,
    operationId: OperationIdSchema.optional(),
    beforeBlobDigest: DigestSchema,
    beforeDigest: DigestSchema,
    appliedDigest: DigestSchema,
    ownershipWasNew: z.boolean(),
    ownershipBefore: OwnershipEntrySchema.nullable(),
  })
  .strict();

export const TransactionRecordSchema = z
  .object({
    apiVersion: z.literal(TRANSACTION_API_VERSION),
    transactionId: TransactionIdSchema,
    mode: z.enum(["apply", "revert", "recover"]),
    status: TransactionStatusSchema,
    planId: z.string().regex(/^pln_[a-f0-9]{64}$/),
    linkedTransactionId: TransactionIdSchema.optional(),
    startedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    receipts: z.array(TransactionReceiptSchema),
    conflicts: z.array(GSettingsResourceIdSchema),
  })
  .strict();

const EventBase = {
  apiVersion: z.literal(TRANSACTION_API_VERSION),
  transactionId: TransactionIdSchema,
  sequence: z.number().int().positive(),
  timestamp: z.string().datetime(),
} as const;

export const TransactionJournalEventSchema = z.discriminatedUnion("event", [
  z
    .object({
      ...EventBase,
      event: z.literal("transaction_started"),
      mode: z.enum(["apply", "revert", "recover"]),
      planId: z.string().regex(/^pln_[a-f0-9]{64}$/),
      linkedTransactionId: TransactionIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...EventBase,
      event: z.literal("before_saved"),
      action: z.enum(["apply", "adopt"]),
      operationId: OperationIdSchema.optional(),
      resourceId: GSettingsResourceIdSchema,
      blobDigest: DigestSchema,
      observedDigest: DigestSchema,
    })
    .strict(),
  z
    .object({
      ...EventBase,
      event: z.literal("operation_intent"),
      operationId: OperationIdSchema,
      resourceId: GSettingsResourceIdSchema,
      beforeBlobDigest: DigestSchema,
      desiredDigest: DigestSchema,
    })
    .strict(),
  z
    .object({
      ...EventBase,
      event: z.literal("operation_applied"),
      operationId: OperationIdSchema,
      resourceId: GSettingsResourceIdSchema,
      appliedDigest: DigestSchema,
    })
    .strict(),
  z
    .object({
      ...EventBase,
      event: z.literal("operation_failed"),
      operationId: OperationIdSchema,
      resourceId: GSettingsResourceIdSchema,
      reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    })
    .strict(),
  z
    .object({
      ...EventBase,
      event: z.literal("resource_acquired"),
      resourceId: GSettingsResourceIdSchema,
      moduleId: ModuleIdSchema,
      origin: z.enum(["adopted", "changed"]),
      baselineBlobDigest: DigestSchema,
      appliedDigest: DigestSchema,
      ownershipWasNew: z.boolean(),
      ownershipBefore: OwnershipEntrySchema.nullable(),
    })
    .strict(),
  z
    .object({
      ...EventBase,
      event: z.literal("compensation_intent"),
      resourceId: GSettingsResourceIdSchema,
      beforeBlobDigest: DigestSchema,
      expectedAppliedDigest: DigestSchema,
    })
    .strict(),
  z
    .object({
      ...EventBase,
      event: z.enum(["compensated", "compensation_noop"]),
      resourceId: GSettingsResourceIdSchema,
      restoredDigest: DigestSchema,
    })
    .strict(),
  z
    .object({
      ...EventBase,
      event: z.literal("resource_conflict"),
      resourceId: GSettingsResourceIdSchema,
      observedDigest: DigestSchema,
      beforeDigest: DigestSchema,
      appliedDigest: DigestSchema,
    })
    .strict(),
  z
    .object({
      ...EventBase,
      event: z.literal("transaction_state"),
      status: TransactionStatusSchema,
      reasonCode: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]*$/)
        .optional(),
    })
    .strict(),
]);

export const LockOwnerSchema = z
  .object({
    lockId: DigestSchema,
    pid: z.number().int().positive(),
    bootId: z.string().min(1).max(128),
    processStartTime: z.string().regex(/^\d+$/),
    acquiredAt: z.string().datetime(),
  })
  .strict();

export type GSettingsSnapshot = z.infer<typeof GSettingsSnapshotSchema>;
export type PlanBinding = z.infer<typeof PlanBindingSchema>;
export type PersistedPlan = z.infer<typeof PersistedPlanSchema>;
export type OwnershipEntry = z.infer<typeof OwnershipEntrySchema>;
export type OwnershipIndex = z.infer<typeof OwnershipIndexSchema>;
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;
export type TransactionReceipt = z.infer<typeof TransactionReceiptSchema>;
export type TransactionRecord = z.infer<typeof TransactionRecordSchema>;
export type TransactionJournalEvent = z.infer<typeof TransactionJournalEventSchema>;
export type LockOwner = z.infer<typeof LockOwnerSchema>;
