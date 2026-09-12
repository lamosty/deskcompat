import { randomBytes } from "node:crypto";
import type {
  GSettingsOperation,
  GSettingsResourceId,
  GSettingsSnapshot,
  HostFacts,
  ModuleId,
  OwnershipEntry,
  OwnershipIndex,
  PersistedPlan,
  Plan,
  PlanBinding,
  TransactionJournalEvent,
  TransactionReceipt,
  TransactionRecord,
  TransactionStatus,
} from "@deskcompat/schema";
import { HostFactsSchema, PlanBindingSchema, TRANSACTION_API_VERSION } from "@deskcompat/schema";
import { sha256 } from "../canonical-json.ts";
import { planFactsDigest } from "../planner/fingerprints.ts";
import type { FailureInjector, TransactionDriver } from "./driver.ts";
import { TransactionError } from "./errors.ts";
import { TransactionJournal } from "./journal.ts";
import { acquireMutationLock, type LockRuntime } from "./lock.ts";
import { validateSnapshot } from "./snapshot.ts";
import { TransactionStore } from "./store.ts";

export interface TransactionStep {
  readonly action: "apply" | "adopt";
  readonly operationId: string;
  readonly resourceId: GSettingsResourceId;
  readonly moduleId: ModuleId;
  readonly expectedBeforeDigest: string;
  readonly operation?: GSettingsOperation;
}

/**
 * @decision Adoption is executed only when the reviewed plan contains an explicit
 * resource.adopt operation. An already-owned matching resource has no operation, so
 * repeated apply remains a no-op instead of silently refreshing ownership.
 */
export function enumerateTransactionSteps(plan: Plan): TransactionStep[] {
  return plan.operations.map((operation) => ({
    action: operation.kind === "gsettings.set" ? "apply" : "adopt",
    operationId: operation.id,
    resourceId: operation.resourceId,
    moduleId: operation.moduleId,
    expectedBeforeDigest: operation.expectedBeforeDigest,
    ...(operation.kind === "gsettings.set" ? { operation } : {}),
  }));
}

export interface ApplyPlanInput {
  readonly planId: string;
  readonly binding: PlanBinding;
  readonly driver: TransactionDriver;
  readonly currentFacts: HostFacts;
  readonly now?: () => Date;
  readonly failureInjector?: FailureInjector;
  readonly lockRuntime?: LockRuntime;
}

export interface RevertTransactionInput {
  readonly transactionId: string;
  readonly binding: PlanBinding;
  readonly driver: TransactionDriver;
  readonly now?: () => Date;
  readonly failureInjector?: FailureInjector;
  readonly lockRuntime?: LockRuntime;
}

export type RecoverTransactionInput = RevertTransactionInput;

function transactionId(): string {
  return `tx_${sha256({
    domain: "deskcompat.transaction.v1",
    nonce: randomBytes(32).toString("hex"),
    pid: process.pid,
  })}`;
}

function bindingMatches(left: PlanBinding, right: PlanBinding): boolean {
  return left.effectiveUid === right.effectiveUid && left.sessionDigest === right.sessionDigest;
}

function effectiveMatches(
  snapshot: GSettingsSnapshot,
  desired: GSettingsOperation["desired"],
): boolean {
  return sha256(snapshot.state.effective) === sha256(desired);
}

class TransactionAbort extends Error {
  constructor(
    readonly status: "failed" | "conflicted" | "recovery-required",
    readonly reasonCode: string,
  ) {
    super(reasonCode);
  }
}

interface PreparedStep {
  readonly step: TransactionStep;
  readonly before: GSettingsSnapshot;
  readonly beforeBlobDigest: string;
}

interface RuntimeContext {
  readonly id: string;
  readonly journal: TransactionJournal;
  readonly driver: TransactionDriver;
  readonly failureInjector?: FailureInjector;
}

async function inject(
  context: RuntimeContext,
  point: Parameters<NonNullable<FailureInjector>>[0],
  resourceId?: GSettingsResourceId,
): Promise<void> {
  await context.failureInjector?.(point, {
    transactionId: context.id,
    ...(resourceId ? { resourceId } : {}),
  });
}

async function inspect(
  driver: TransactionDriver,
  resourceId: GSettingsResourceId,
): Promise<GSettingsSnapshot> {
  try {
    const snapshot = validateSnapshot(await driver.inspect(resourceId));
    if (snapshot.resourceId !== resourceId) {
      throw new TransactionError("INTEGRITY_FAILURE", "Driver inspected the wrong resource");
    }
    return snapshot;
  } catch (error) {
    if (error instanceof TransactionError) throw error;
    throw new TransactionError("RESOURCE_UNAVAILABLE", "Resource inspection failed", resourceId);
  }
}

function initialRecord(
  id: string,
  planId: string,
  now: Date,
  mode: TransactionRecord["mode"] = "apply",
  linkedTransactionId?: string,
): TransactionRecord {
  return {
    apiVersion: TRANSACTION_API_VERSION,
    transactionId: id,
    mode,
    status: "preparing",
    planId,
    ...(linkedTransactionId ? { linkedTransactionId } : {}),
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    receipts: [],
    conflicts: [],
  };
}

function ownershipFor(receipt: TransactionReceipt, id: string, timestamp: string): OwnershipEntry {
  const previous = receipt.ownershipBefore;
  return {
    resourceId: receipt.resourceId,
    moduleId: receipt.moduleId,
    origin: previous?.origin ?? (receipt.action === "adopt" ? "adopted" : "changed"),
    baselineBlobDigest: previous?.baselineBlobDigest ?? receipt.beforeBlobDigest,
    baselineDigest: previous?.baselineDigest ?? receipt.beforeDigest,
    appliedDigest: receipt.appliedDigest,
    acquiredByTransactionId: previous?.acquiredByTransactionId ?? id,
    lastTransactionId: id,
    acquiredAt: previous?.acquiredAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function replaceOwnership(
  original: OwnershipIndex,
  receipts: readonly TransactionReceipt[],
  id: string,
  timestamp: string,
): OwnershipIndex {
  const resources = new Map(original.resources.map((entry) => [entry.resourceId, entry]));
  for (const receipt of receipts)
    resources.set(receipt.resourceId, ownershipFor(receipt, id, timestamp));
  return { ...original, resources: [...resources.values()] };
}

async function transition(
  store: TransactionStore,
  context: RuntimeContext,
  record: TransactionRecord,
  status: TransactionStatus,
  now: Date,
  reasonCode?: string,
): Promise<TransactionRecord> {
  await context.journal.append({
    event: "transaction_state",
    status,
    ...(reasonCode ? { reasonCode } : {}),
  });
  return store.saveTransaction({ ...record, status, updatedAt: now.toISOString() });
}

async function compensateReceipts(
  store: TransactionStore,
  context: RuntimeContext,
  receipts: readonly TransactionReceipt[],
): Promise<{
  status: "reverted" | "conflicted" | "recovery-required";
  conflicts: GSettingsResourceId[];
}> {
  const conflicts: GSettingsResourceId[] = [];
  let recoveryRequired = false;
  for (const receipt of [...receipts].reverse()) {
    const before = await store.loadSnapshot(receipt.beforeBlobDigest).catch(() => undefined);
    if (!before) {
      recoveryRequired = true;
      continue;
    }
    let current: GSettingsSnapshot;
    try {
      current = await inspect(context.driver, receipt.resourceId);
    } catch {
      recoveryRequired = true;
      continue;
    }
    if (receipt.action === "adopt") {
      if (current.digest !== receipt.appliedDigest) {
        conflicts.push(receipt.resourceId);
        await context.journal.append({
          event: "resource_conflict",
          resourceId: receipt.resourceId,
          observedDigest: current.digest,
          beforeDigest: before.digest,
          appliedDigest: receipt.appliedDigest,
        });
      }
      continue;
    }
    if (current.digest === before.digest) {
      await context.journal.append({
        event: "compensation_noop",
        resourceId: receipt.resourceId,
        restoredDigest: before.digest,
      });
      continue;
    }
    if (current.digest !== receipt.appliedDigest) {
      conflicts.push(receipt.resourceId);
      await context.journal.append({
        event: "resource_conflict",
        resourceId: receipt.resourceId,
        observedDigest: current.digest,
        beforeDigest: before.digest,
        appliedDigest: receipt.appliedDigest,
      });
      continue;
    }
    await context.journal.append({
      event: "compensation_intent",
      resourceId: receipt.resourceId,
      beforeBlobDigest: receipt.beforeBlobDigest,
      expectedAppliedDigest: receipt.appliedDigest,
    });
    await inject(context, "after_compensation_intent", receipt.resourceId);
    try {
      const mutation = await context.driver.restore(receipt.resourceId, before, current.digest);
      if (mutation.beforeDigest !== current.digest) {
        throw new TransactionError("EXTERNAL_DRIFT", "Restore precondition changed");
      }
      await inject(context, "after_driver_restore", receipt.resourceId);
      const restored = await inspect(context.driver, receipt.resourceId);
      if (restored.digest !== before.digest) throw new Error("restore verification failed");
      await context.journal.append({
        event: "compensated",
        resourceId: receipt.resourceId,
        restoredDigest: restored.digest,
      });
    } catch {
      recoveryRequired = true;
    }
  }
  return {
    status: recoveryRequired
      ? "recovery-required"
      : conflicts.length > 0
        ? "conflicted"
        : "reverted",
    conflicts,
  };
}

export class TransactionEngine {
  constructor(readonly store = new TransactionStore()) {}

  async persistPlan(plan: Plan, binding: PlanBinding, savedAt?: Date): Promise<PersistedPlan> {
    return this.store.savePlan(plan, binding, savedAt);
  }

  async applyPlan(input: ApplyPlanInput): Promise<TransactionRecord> {
    const now = input.now ?? (() => new Date());
    const persisted = await this.store.loadPlan(input.planId);
    const binding = PlanBindingSchema.parse(input.binding);
    if (!bindingMatches(persisted.binding, binding)) {
      throw new TransactionError("BINDING_MISMATCH", "Plan belongs to another user or session");
    }
    const currentFacts = HostFactsSchema.parse(input.currentFacts);
    // The projection choice is itself encoded by the digest. Recomputing both closed
    // projections avoids trusting a caller-supplied digest or duplicating profile logic.
    if (
      ![planFactsDigest(currentFacts, false), planFactsDigest(currentFacts, true)].includes(
        persisted.plan.factsDigest,
      )
    ) {
      throw new TransactionError(
        "EXTERNAL_DRIFT",
        "The supported host facts changed since planning",
      );
    }
    if (persisted.plan.blockers.length > 0) {
      throw new TransactionError("BLOCKED_PLAN", "A plan with blockers cannot be applied");
    }
    if (new Date(persisted.plan.expiresAt).getTime() <= now().getTime()) {
      throw new TransactionError("EXPIRED_PLAN", "The persisted plan has expired");
    }

    const lock = await acquireMutationLock(this.store, input.lockRuntime);
    const id = transactionId();
    const journal = new TransactionJournal(this.store, id, now);
    const context: RuntimeContext = {
      id,
      journal,
      driver: input.driver,
      ...(input.failureInjector ? { failureInjector: input.failureInjector } : {}),
    };
    let record = initialRecord(id, persisted.plan.planId, now());
    let originalOwnership: OwnershipIndex | undefined;
    let ownershipWritten = false;
    const receipts: TransactionReceipt[] = [];
    try {
      await this.store.saveTransaction(record);
      await journal.append({ event: "transaction_started", mode: "apply", planId: record.planId });
      await inject(context, "after_transaction_started");
      originalOwnership = await this.store.loadOwnership();
      const ownershipByResource = new Map(
        originalOwnership.resources.map((entry) => [entry.resourceId, entry]),
      );
      const stepsByResource = new Map(
        enumerateTransactionSteps(persisted.plan).map((step) => [step.resourceId, step]),
      );
      const prepared: PreparedStep[] = [];

      // Revalidate every actionable and unchanged resource while holding the
      // mutation lock. This makes an apply of a no-op plan honest and prevents an
      // ownership record acquired after planning from being silently replaced.
      for (const resource of persisted.plan.resources) {
        if (!new Set(["adopt", "change", "unchanged"]).has(resource.disposition)) continue;
        if (!("digest" in resource.observed)) {
          throw new TransactionAbort("failed", "PLAN_OBSERVATION_MISSING");
        }
        const existing = ownershipByResource.get(resource.resourceId);
        if (
          (resource.ownership.status === "unowned" && existing !== undefined) ||
          (resource.ownership.status === "owned" &&
            (existing === undefined ||
              existing.moduleId !== resource.ownership.moduleId ||
              existing.appliedDigest !== resource.ownership.appliedDigest))
        ) {
          throw new TransactionAbort("conflicted", "OWNERSHIP_PRECONDITION_CHANGED");
        }
        const before = await inspect(input.driver, resource.resourceId);
        if (before.digest !== resource.observed.digest) {
          throw new TransactionAbort("failed", "PRECONDITION_CHANGED");
        }
        const step = stepsByResource.get(resource.resourceId);
        if (!step) continue;
        const beforeBlobDigest = await this.store.saveSnapshot(before);
        await journal.append({
          event: "before_saved",
          action: step.action,
          operationId: step.operationId,
          resourceId: step.resourceId,
          blobDigest: beforeBlobDigest,
          observedDigest: before.digest,
        });
        await inject(context, "after_before_saved", step.resourceId);
        prepared.push({ step, before, beforeBlobDigest });
      }

      record = await transition(this.store, context, record, "applying", now());
      for (const item of prepared.filter(({ step }) => step.action === "apply")) {
        const operation = item.step.operation;
        if (!operation) throw new TransactionAbort("failed", "OPERATION_MISSING");
        const immediate = await inspect(input.driver, item.step.resourceId);
        if (immediate.digest !== item.before.digest) {
          throw new TransactionAbort("failed", "PRECONDITION_CHANGED");
        }
        await journal.append({
          event: "operation_intent",
          operationId: operation.id,
          resourceId: operation.resourceId,
          beforeBlobDigest: item.beforeBlobDigest,
          desiredDigest: sha256(operation.desired),
        });
        await inject(context, "after_operation_intent", operation.resourceId);
        let applied: GSettingsSnapshot;
        try {
          const mutation = await input.driver.apply(operation, item.before);
          if (mutation.beforeDigest !== item.before.digest) {
            throw new TransactionAbort("conflicted", "COMPARE_BEFORE_WRITE_FAILED");
          }
          await inject(context, "after_driver_apply", operation.resourceId);
          applied = await inspect(input.driver, operation.resourceId);
          if (!effectiveMatches(applied, operation.desired)) {
            throw new TransactionAbort("recovery-required", "APPLY_VERIFICATION_FAILED");
          }
        } catch (error) {
          const observed = await inspect(input.driver, operation.resourceId).catch(() => undefined);
          if (observed && effectiveMatches(observed, operation.desired)) {
            applied = observed;
          } else {
            await journal.append({
              event: "operation_failed",
              operationId: operation.id,
              resourceId: operation.resourceId,
              reasonCode: "DRIVER_APPLY_FAILED",
            });
            if (observed && observed.digest !== item.before.digest) {
              throw new TransactionAbort("conflicted", "AMBIGUOUS_EXTERNAL_STATE");
            }
            if (!observed) {
              throw new TransactionAbort("recovery-required", "POST_WRITE_STATE_UNAVAILABLE");
            }
            throw error;
          }
        }
        await journal.append({
          event: "operation_applied",
          operationId: operation.id,
          resourceId: operation.resourceId,
          appliedDigest: applied.digest,
        });
        const previous = ownershipByResource.get(item.step.resourceId) ?? null;
        receipts.push({
          action: "apply",
          resourceId: item.step.resourceId,
          moduleId: item.step.moduleId,
          operationId: operation.id,
          beforeBlobDigest: item.beforeBlobDigest,
          beforeDigest: item.before.digest,
          appliedDigest: applied.digest,
          ownershipWasNew: previous === null,
          ownershipBefore: previous,
        });
        await inject(context, "after_operation_applied", operation.resourceId);
      }

      // Unchanged resources are rechecked immediately before ownership acquisition.
      for (const item of prepared.filter(({ step }) => step.action === "adopt")) {
        const current = await inspect(input.driver, item.step.resourceId);
        if (current.digest !== item.before.digest) {
          throw new TransactionAbort("failed", "ADOPTION_PRECONDITION_CHANGED");
        }
        const previous = ownershipByResource.get(item.step.resourceId) ?? null;
        receipts.push({
          action: "adopt",
          resourceId: item.step.resourceId,
          moduleId: item.step.moduleId,
          operationId: item.step.operationId,
          beforeBlobDigest: item.beforeBlobDigest,
          beforeDigest: item.before.digest,
          appliedDigest: current.digest,
          ownershipWasNew: previous === null,
          ownershipBefore: previous,
        });
      }

      for (const receipt of receipts) {
        await journal.append({
          event: "resource_acquired",
          resourceId: receipt.resourceId,
          moduleId: receipt.moduleId,
          origin:
            receipt.ownershipBefore?.origin ?? (receipt.action === "adopt" ? "adopted" : "changed"),
          baselineBlobDigest: receipt.beforeBlobDigest,
          appliedDigest: receipt.appliedDigest,
          ownershipWasNew: receipt.ownershipWasNew,
          ownershipBefore: receipt.ownershipBefore,
        });
      }
      await inject(context, "before_ownership_write");
      const timestamp = now().toISOString();
      await this.store.saveOwnership(replaceOwnership(originalOwnership, receipts, id, timestamp));
      ownershipWritten = true;
      await inject(context, "after_ownership_write");
      record = { ...record, receipts };
      record = await transition(this.store, context, record, "committed", now());
      return record;
    } catch (error) {
      const requested = error instanceof TransactionAbort ? error.status : "failed";
      const reasonCode =
        error instanceof TransactionAbort ? error.reasonCode : "TRANSACTION_APPLY_FAILED";
      record = { ...record, receipts };
      if (receipts.length > 0) {
        record = await transition(this.store, context, record, "reverting", now(), reasonCode);
        const compensated = await compensateReceipts(this.store, context, receipts);
        if (ownershipWritten && originalOwnership) {
          await this.store.saveOwnership(originalOwnership).catch(() => {
            compensated.status = "recovery-required";
          });
        }
        const status = compensated.status === "reverted" ? requested : compensated.status;
        record = { ...record, conflicts: compensated.conflicts };
        record = await transition(this.store, context, record, status, now(), reasonCode);
      } else {
        record = await transition(this.store, context, record, requested, now(), reasonCode);
      }
      return record;
    } finally {
      await lock.release();
    }
  }

  async revertTransaction(input: RevertTransactionInput): Promise<TransactionRecord> {
    const now = input.now ?? (() => new Date());
    const original = await this.store.loadTransaction(input.transactionId);
    if (original.status !== "committed") {
      throw new TransactionError(
        "INTEGRITY_FAILURE",
        "Only a committed transaction can be reverted",
      );
    }
    const persisted = await this.store.loadPlan(original.planId);
    const binding = PlanBindingSchema.parse(input.binding);
    if (!bindingMatches(persisted.binding, binding)) {
      throw new TransactionError(
        "BINDING_MISMATCH",
        "Transaction belongs to another user or session",
      );
    }
    const lock = await acquireMutationLock(this.store, input.lockRuntime);
    const id = transactionId();
    const journal = new TransactionJournal(this.store, id, now);
    const context: RuntimeContext = {
      id,
      journal,
      driver: input.driver,
      ...(input.failureInjector ? { failureInjector: input.failureInjector } : {}),
    };
    let record = initialRecord(id, original.planId, now(), "revert", original.transactionId);
    try {
      await this.store.saveTransaction(record);
      await journal.append({
        event: "transaction_started",
        mode: "revert",
        planId: original.planId,
        linkedTransactionId: original.transactionId,
      });
      record = await transition(this.store, context, record, "reverting", now());

      const ownership = await this.store.loadOwnership();
      const owned = new Map(ownership.resources.map((entry) => [entry.resourceId, entry]));
      for (const receipt of original.receipts) {
        const current = owned.get(receipt.resourceId);
        if (
          !current ||
          current.lastTransactionId !== original.transactionId ||
          current.appliedDigest !== receipt.appliedDigest
        ) {
          throw new TransactionAbort("conflicted", "OWNERSHIP_ADVANCED");
        }
      }
      const compensated = await compensateReceipts(this.store, context, original.receipts);
      const status: TransactionStatus = compensated.status;
      if (status === "reverted") {
        const resources = new Map(ownership.resources.map((entry) => [entry.resourceId, entry]));
        for (const receipt of original.receipts) {
          if (receipt.ownershipBefore) resources.set(receipt.resourceId, receipt.ownershipBefore);
          else resources.delete(receipt.resourceId);
        }
        await this.store.saveOwnership({ ...ownership, resources: [...resources.values()] });
      }
      record = { ...record, receipts: original.receipts, conflicts: compensated.conflicts };
      record = await transition(this.store, context, record, status, now());
      return record;
    } catch (error) {
      const status = error instanceof TransactionAbort ? error.status : "recovery-required";
      const reasonCode = error instanceof TransactionAbort ? error.reasonCode : "REVERT_FAILED";
      record = await transition(this.store, context, record, status, now(), reasonCode);
      return record;
    } finally {
      await lock.release();
    }
  }

  /**
   * Recover an interrupted transaction by treating an intent without a terminal
   * receipt as ambiguous. Current state is classified as desired, before, or conflict;
   * verified applied effects are then compensated in reverse order.
   */
  async recoverTransaction(input: RecoverTransactionInput): Promise<TransactionRecord> {
    const now = input.now ?? (() => new Date());
    const interrupted = await this.store.loadTransaction(input.transactionId);
    const persisted = await this.store.loadPlan(interrupted.planId);
    const binding = PlanBindingSchema.parse(input.binding);
    if (!bindingMatches(persisted.binding, binding)) {
      throw new TransactionError(
        "BINDING_MISMATCH",
        "Transaction belongs to another user or session",
      );
    }
    // @constraint Even terminal records are session-bound. Checking the binding
    // before the idempotent return prevents a caller from using recover as an
    // existence/status oracle for another local session's transaction.
    if (interrupted.status === "committed" || interrupted.status === "reverted") {
      return interrupted;
    }
    const lock = await acquireMutationLock(this.store, input.lockRuntime);
    const id = transactionId();
    const journal = new TransactionJournal(this.store, id, now);
    const context: RuntimeContext = {
      id,
      journal,
      driver: input.driver,
      ...(input.failureInjector ? { failureInjector: input.failureInjector } : {}),
    };
    let record = initialRecord(id, interrupted.planId, now(), "recover", interrupted.transactionId);
    try {
      await this.store.saveTransaction(record);
      await journal.append({
        event: "transaction_started",
        mode: "recover",
        planId: interrupted.planId,
        linkedTransactionId: interrupted.transactionId,
      });
      record = await transition(this.store, context, record, "reverting", now());

      // A revert transaction contains compensation intents, not apply intents. Its
      // durable link to the committed apply transaction is therefore the only safe
      // provenance for the effects that recovery may compensate. This also covers
      // a process death before the revert manifest had copied any receipts.
      if (interrupted.mode === "revert") {
        if (!interrupted.linkedTransactionId) {
          throw new TransactionAbort("recovery-required", "REVERT_SOURCE_MISSING");
        }
        const source = await this.store.loadTransaction(interrupted.linkedTransactionId);
        if (source.mode !== "apply" || source.status !== "committed") {
          throw new TransactionAbort("recovery-required", "REVERT_SOURCE_INVALID");
        }
        const ownership = await this.store.loadOwnership();
        const owned = new Map(ownership.resources.map((entry) => [entry.resourceId, entry]));
        const ownershipConflicts = source.receipts
          .filter((receipt) => {
            const current = owned.get(receipt.resourceId);
            return (
              !current ||
              current.lastTransactionId !== source.transactionId ||
              current.appliedDigest !== receipt.appliedDigest
            );
          })
          .map(({ resourceId }) => resourceId);
        if (ownershipConflicts.length > 0) {
          record = { ...record, receipts: source.receipts, conflicts: ownershipConflicts };
          record = await transition(
            this.store,
            context,
            record,
            "conflicted",
            now(),
            "OWNERSHIP_ADVANCED",
          );
          return record;
        }
        const compensated = await compensateReceipts(this.store, context, source.receipts);
        let status: TransactionStatus = compensated.status;
        if (status === "reverted") {
          const resources = new Map(ownership.resources.map((entry) => [entry.resourceId, entry]));
          for (const receipt of source.receipts) {
            const current = resources.get(receipt.resourceId);
            if (current?.lastTransactionId !== source.transactionId) continue;
            if (receipt.ownershipBefore) resources.set(receipt.resourceId, receipt.ownershipBefore);
            else resources.delete(receipt.resourceId);
          }
          try {
            await this.store.saveOwnership({ ...ownership, resources: [...resources.values()] });
          } catch {
            status = "recovery-required";
          }
        }
        record = {
          ...record,
          receipts: source.receipts,
          conflicts: compensated.conflicts,
        };
        record = await transition(this.store, context, record, status, now());
        return record;
      }

      if (interrupted.mode !== "apply") {
        throw new TransactionAbort("recovery-required", "RECOVERY_SOURCE_UNSUPPORTED");
      }

      const sourceEvents = await new TransactionJournal(
        this.store,
        interrupted.transactionId,
        now,
      ).read();
      const beforeByResource = new Map<
        GSettingsResourceId,
        Extract<TransactionJournalEvent, { event: "before_saved" }>
      >();
      const intentByResource = new Map<
        GSettingsResourceId,
        Extract<TransactionJournalEvent, { event: "operation_intent" }>
      >();
      const appliedByResource = new Map<
        GSettingsResourceId,
        Extract<TransactionJournalEvent, { event: "operation_applied" }>
      >();
      const adoptionByResource = new Map<
        GSettingsResourceId,
        Extract<TransactionJournalEvent, { event: "resource_acquired" }>
      >();
      for (const event of sourceEvents) {
        if (event.event === "before_saved") beforeByResource.set(event.resourceId, event);
        else if (event.event === "operation_intent") intentByResource.set(event.resourceId, event);
        else if (event.event === "operation_applied")
          appliedByResource.set(event.resourceId, event);
        else if (event.event === "resource_acquired")
          adoptionByResource.set(event.resourceId, event);
      }
      const operationByResource = new Map(
        persisted.plan.operations.map((operation) => [operation.resourceId, operation]),
      );
      const receipts = new Map(
        interrupted.receipts.map((receipt) => [receipt.resourceId, receipt]),
      );
      const conflicts: GSettingsResourceId[] = [];

      for (const resourceId of intentByResource.keys()) {
        // A durable applied event is handled below and is sufficient provenance;
        // this loop classifies only genuinely intent-only resources.
        if (receipts.has(resourceId) || appliedByResource.has(resourceId)) continue;
        const beforeEvent = beforeByResource.get(resourceId);
        const operation = operationByResource.get(resourceId);
        if (!beforeEvent || !operation) {
          throw new TransactionAbort("recovery-required", "JOURNAL_RECEIPT_INCOMPLETE");
        }
        const before = await this.store.loadSnapshot(beforeEvent.blobDigest);
        const current = await inspect(input.driver, resourceId);
        if (current.digest === before.digest) {
          await journal.append({
            event: "operation_failed",
            operationId: operation.id,
            resourceId,
            reasonCode: "INTENT_DID_NOT_APPLY",
          });
          continue;
        }

        // @constraint An intent proves only that DeskCompat was about to write.
        // If there is no subsequent durable operation_applied event, even a value
        // equal to the desired value may have been written by the user or another
        // process. Preserve it and require manual conflict resolution.
        conflicts.push(resourceId);
        await journal.append({
          event: "resource_conflict",
          resourceId,
          observedDigest: current.digest,
          beforeDigest: before.digest,
          appliedDigest: current.digest,
        });
      }

      // A crash can occur after an applied event but before the transaction manifest.
      for (const [resourceId, applied] of appliedByResource) {
        if (receipts.has(resourceId)) continue;
        const beforeEvent = beforeByResource.get(resourceId);
        const operation = operationByResource.get(resourceId);
        if (!beforeEvent || !operation) {
          throw new TransactionAbort("recovery-required", "JOURNAL_RECEIPT_INCOMPLETE");
        }
        const before = await this.store.loadSnapshot(beforeEvent.blobDigest);
        const adoption = adoptionByResource.get(resourceId);
        receipts.set(resourceId, {
          action: "apply",
          resourceId,
          moduleId: operation.moduleId,
          operationId: operation.id,
          beforeBlobDigest: beforeEvent.blobDigest,
          beforeDigest: before.digest,
          appliedDigest: applied.appliedDigest,
          ownershipWasNew: adoption?.ownershipWasNew ?? true,
          ownershipBefore: adoption?.ownershipBefore ?? null,
        });
      }

      // Adopt-only resources have no operation event but may already be in ownership.
      for (const [resourceId, adoption] of adoptionByResource) {
        if (receipts.has(resourceId)) continue;
        const beforeEvent = beforeByResource.get(resourceId);
        const resource = persisted.plan.resources.find((entry) => entry.resourceId === resourceId);
        const moduleId = resource?.moduleIds[0];
        if (!beforeEvent || !moduleId) continue;
        receipts.set(resourceId, {
          action: "adopt",
          resourceId,
          moduleId,
          beforeBlobDigest: beforeEvent.blobDigest,
          beforeDigest: beforeEvent.observedDigest,
          appliedDigest: adoption.appliedDigest,
          ownershipWasNew: adoption.ownershipWasNew,
          ownershipBefore: adoption.ownershipBefore,
        });
      }

      const orderedReceipts = persisted.plan.resources
        .map(({ resourceId }) => receipts.get(resourceId))
        .filter((receipt): receipt is TransactionReceipt => receipt !== undefined);
      const compensated = await compensateReceipts(this.store, context, orderedReceipts);
      conflicts.push(
        ...compensated.conflicts.filter((resourceId) => !conflicts.includes(resourceId)),
      );
      let status: TransactionStatus =
        compensated.status === "recovery-required"
          ? "recovery-required"
          : conflicts.length > 0
            ? "conflicted"
            : "reverted";

      if (status === "reverted") {
        const ownership = await this.store.loadOwnership();
        const resources = new Map(ownership.resources.map((entry) => [entry.resourceId, entry]));
        for (const receipt of orderedReceipts) {
          const current = resources.get(receipt.resourceId);
          if (current?.lastTransactionId !== interrupted.transactionId) continue;
          if (receipt.ownershipBefore) resources.set(receipt.resourceId, receipt.ownershipBefore);
          else resources.delete(receipt.resourceId);
        }
        try {
          await this.store.saveOwnership({ ...ownership, resources: [...resources.values()] });
        } catch {
          status = "recovery-required";
        }
      }
      record = { ...record, receipts: orderedReceipts, conflicts };
      record = await transition(this.store, context, record, status, now());
      return record;
    } catch (error) {
      const status = error instanceof TransactionAbort ? error.status : "recovery-required";
      const reasonCode = error instanceof TransactionAbort ? error.reasonCode : "RECOVERY_FAILED";
      record = await transition(this.store, context, record, status, now(), reasonCode);
      return record;
    } finally {
      await lock.release();
    }
  }
}
