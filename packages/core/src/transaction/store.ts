import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type GSettingsSnapshot,
  GSettingsSnapshotSchema,
  type OwnershipIndex,
  OwnershipIndexSchema,
  PERSISTED_PLAN_API_VERSION,
  type PersistedPlan,
  PersistedPlanSchema,
  type Plan,
  type PlanBinding,
  type TransactionRecord,
  TransactionRecordSchema,
} from "@deskcompat/schema";
import { canonicalJson, sha256 } from "../canonical-json.ts";
import { verifyPlanIntegrity } from "../planner/plan-integrity.ts";
import { TransactionError } from "./errors.ts";
import {
  assertPrivateDirectory,
  atomicCreatePrivateJson,
  atomicWritePrivateJson,
  ensurePrivateDirectory,
  pathExists,
  readPrivateJson,
  resolveStateRoot,
} from "./filesystem.ts";
import { validateSnapshot } from "./snapshot.ts";

function emptyOwnership(): OwnershipIndex {
  return {
    apiVersion: "deskcompat.dev/ownership/v1alpha1",
    resources: [],
  };
}

function persistedPlanIntegrity(value: Omit<PersistedPlan, "integrityDigest">): string {
  return sha256({ domain: "deskcompat.persisted-plan.v1alpha1", ...value });
}

export class TransactionStore {
  readonly root: string;
  readonly plansDirectory: string;
  readonly blobsDirectory: string;
  readonly transactionsDirectory: string;
  readonly ownershipPath: string;
  readonly locksDirectory: string;

  constructor(root = resolveStateRoot()) {
    this.root = root;
    this.plansDirectory = join(root, "plans");
    this.blobsDirectory = join(root, "blobs");
    this.transactionsDirectory = join(root, "transactions");
    this.ownershipPath = join(root, "ownership.json");
    this.locksDirectory = join(root, "locks");
  }

  async initialize(): Promise<void> {
    await ensurePrivateDirectory(this.root);
    for (const path of [
      this.plansDirectory,
      this.blobsDirectory,
      this.transactionsDirectory,
      this.locksDirectory,
    ]) {
      await ensurePrivateDirectory(path);
    }
  }

  planPath(planId: string): string {
    if (!/^pln_[a-f0-9]{64}$/.test(planId)) {
      throw new TransactionError("INTEGRITY_FAILURE", "Invalid plan identifier", planId);
    }
    return join(this.plansDirectory, `${planId}.json`);
  }

  transactionPath(transactionId: string): string {
    if (!/^tx_[a-f0-9]{64}$/.test(transactionId)) {
      throw new TransactionError("INTEGRITY_FAILURE", "Invalid transaction identifier");
    }
    return join(this.transactionsDirectory, `${transactionId}.json`);
  }

  journalPath(transactionId: string): string {
    if (!/^tx_[a-f0-9]{64}$/.test(transactionId)) {
      throw new TransactionError("INTEGRITY_FAILURE", "Invalid transaction identifier");
    }
    return join(this.transactionsDirectory, `${transactionId}.ndjson`);
  }

  async savePlan(plan: Plan, binding: PlanBinding, savedAt = new Date()): Promise<PersistedPlan> {
    await this.initialize();
    const candidatePlanId = plan.planId;
    if (!verifyPlanIntegrity(plan)) {
      throw new TransactionError(
        "INTEGRITY_FAILURE",
        "Cannot persist an invalid plan",
        candidatePlanId,
      );
    }
    const body = {
      apiVersion: PERSISTED_PLAN_API_VERSION,
      plan,
      binding,
      savedAt: savedAt.toISOString(),
    } as const;
    const persisted = PersistedPlanSchema.parse({
      ...body,
      integrityDigest: persistedPlanIntegrity(body),
    });
    const path = this.planPath(plan.planId);
    const created = await atomicCreatePrivateJson(path, persisted);
    if (!created) {
      const existing = await this.loadPlan(plan.planId);
      if (
        canonicalJson(existing.plan) === canonicalJson(persisted.plan) &&
        canonicalJson(existing.binding) === canonicalJson(persisted.binding)
      ) {
        return existing;
      }
      throw new TransactionError(
        "PLAN_ALREADY_PERSISTED",
        "A different immutable artifact already exists for this plan ID",
        plan.planId,
      );
    }
    return persisted;
  }

  async loadPlan(planId: string): Promise<PersistedPlan> {
    await this.initialize();
    const path = this.planPath(planId);
    if (!(await pathExists(path))) {
      throw new TransactionError("PLAN_NOT_FOUND", "Persisted plan was not found", planId);
    }
    const persisted = PersistedPlanSchema.parse(await readPrivateJson(path));
    const { integrityDigest, ...body } = persisted;
    if (
      persisted.plan.planId !== planId ||
      integrityDigest !== persistedPlanIntegrity(body) ||
      !verifyPlanIntegrity(persisted.plan)
    ) {
      throw new TransactionError(
        "INTEGRITY_FAILURE",
        "Persisted plan integrity check failed",
        planId,
      );
    }
    return persisted;
  }

  async saveSnapshot(snapshotCandidate: unknown): Promise<string> {
    await this.initialize();
    const snapshot = validateSnapshot(snapshotCandidate);
    const blobDigest = sha256({ domain: "deskcompat.recovery-blob.v1", snapshot });
    const path = join(this.blobsDirectory, `${blobDigest}.json`);
    if (await pathExists(path)) {
      const existing = GSettingsSnapshotSchema.parse(await readPrivateJson(path));
      if (canonicalJson(existing) !== canonicalJson(snapshot)) {
        throw new TransactionError("INTEGRITY_FAILURE", "Recovery blob digest collision");
      }
      validateSnapshot(existing);
      return blobDigest;
    }
    await atomicWritePrivateJson(path, snapshot);
    return blobDigest;
  }

  async loadSnapshot(blobDigest: string): Promise<GSettingsSnapshot> {
    if (!/^[a-f0-9]{64}$/.test(blobDigest)) {
      throw new TransactionError("INTEGRITY_FAILURE", "Invalid recovery blob identifier");
    }
    const path = join(this.blobsDirectory, `${blobDigest}.json`);
    const snapshot = validateSnapshot(await readPrivateJson(path));
    const actual = sha256({ domain: "deskcompat.recovery-blob.v1", snapshot });
    if (actual !== blobDigest) {
      throw new TransactionError("INTEGRITY_FAILURE", "Recovery blob integrity check failed");
    }
    return snapshot;
  }

  async loadOwnership(): Promise<OwnershipIndex> {
    await this.initialize();
    return this.readOwnership();
  }

  /** Read managed state without creating directories or changing permissions. */
  async readOwnership(): Promise<OwnershipIndex> {
    if (!(await pathExists(this.root))) return emptyOwnership();
    await assertPrivateDirectory(this.root);
    if (!(await pathExists(this.ownershipPath))) return emptyOwnership();
    const index = OwnershipIndexSchema.parse(await readPrivateJson(this.ownershipPath));
    const resourceIds = index.resources.map(({ resourceId }) => resourceId);
    if (
      new Set(resourceIds).size !== resourceIds.length ||
      resourceIds.some((value, index) => index > 0 && value <= (resourceIds[index - 1] ?? ""))
    ) {
      throw new TransactionError("INTEGRITY_FAILURE", "Ownership index is not canonical");
    }
    return index;
  }

  async saveOwnership(indexCandidate: unknown): Promise<OwnershipIndex> {
    const index = OwnershipIndexSchema.parse(indexCandidate);
    const sorted: OwnershipIndex = {
      ...index,
      resources: [...index.resources].sort((left, right) =>
        left.resourceId < right.resourceId ? -1 : left.resourceId > right.resourceId ? 1 : 0,
      ),
    };
    if (
      new Set(sorted.resources.map(({ resourceId }) => resourceId)).size !== sorted.resources.length
    ) {
      throw new TransactionError("INTEGRITY_FAILURE", "Duplicate ownership resource");
    }
    await atomicWritePrivateJson(this.ownershipPath, sorted);
    return sorted;
  }

  async saveTransaction(recordCandidate: unknown): Promise<TransactionRecord> {
    await this.initialize();
    const record = TransactionRecordSchema.parse(recordCandidate);
    await atomicWritePrivateJson(this.transactionPath(record.transactionId), record);
    return record;
  }

  async loadTransaction(transactionId: string): Promise<TransactionRecord> {
    const path = this.transactionPath(transactionId);
    if (!(await pathExists(path))) {
      throw new TransactionError(
        "TRANSACTION_NOT_FOUND",
        "Transaction record was not found",
        transactionId,
      );
    }
    const record = TransactionRecordSchema.parse(await readPrivateJson(path));
    if (record.transactionId !== transactionId) {
      throw new TransactionError(
        "INTEGRITY_FAILURE",
        "Transaction record identity does not match its path",
        transactionId,
      );
    }
    return record;
  }

  /** List existing transaction records without creating application state. */
  async listTransactions(): Promise<TransactionRecord[]> {
    if (!(await pathExists(this.root))) return [];
    await assertPrivateDirectory(this.root);
    if (!(await pathExists(this.transactionsDirectory))) return [];
    await assertPrivateDirectory(this.transactionsDirectory);
    const entries = await readdir(this.transactionsDirectory, { withFileTypes: true });
    const ids = entries
      .filter((entry) => entry.isFile() && /^tx_[a-f0-9]{64}\.json$/.test(entry.name))
      .map((entry) => entry.name.slice(0, -5))
      .sort();
    if (ids.length > 10_000) {
      throw new TransactionError("INTEGRITY_FAILURE", "Transaction history is unbounded");
    }
    const records: TransactionRecord[] = [];
    for (const id of ids) records.push(await this.loadTransaction(id));
    return records.sort((left, right) =>
      right.startedAt === left.startedAt
        ? right.transactionId.localeCompare(left.transactionId)
        : right.startedAt.localeCompare(left.startedAt),
    );
  }
}
