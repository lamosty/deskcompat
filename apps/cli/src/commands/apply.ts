import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { LockRuntime } from "@deskcompat/core";
import {
  canonicalJson,
  sha256,
  type TransactionDriver,
  TransactionEngine,
  TransactionError,
  TransactionStore,
  verifyPlanIntegrity,
} from "@deskcompat/core";
import {
  type CliResult,
  CliResultSchema,
  type HostFacts,
  type Plan,
  type PlanBinding,
  PlanSchema,
  type TransactionRecord,
} from "@deskcompat/schema";
import {
  createLiveTransactionDriver,
  inspectLiveMutationEnvironment,
} from "@deskcompat/ubuntu-gnome";
import { result, transactionDiagnostics } from "../output/render.ts";
import { DESKCOMPAT_VERSION } from "../version.ts";

const MAX_PLAN_FILE_BYTES = 1_024 * 1_024;

export type CliCommandErrorCode =
  | "PLAN_FILE_UNREADABLE"
  | "PLAN_INPUT_INVALID"
  | "PLAN_INTEGRITY_INVALID"
  | "PLAN_ENVELOPE_INVALID"
  | "PLAN_TOOL_VERSION_UNSUPPORTED";

export class CliCommandError extends Error {
  constructor(readonly code: CliCommandErrorCode) {
    super(`DeskCompat could not complete the command (${code}).`);
    this.name = "CliCommandError";
  }
}

export interface ApplyCommandDependencies {
  readonly store?: TransactionStore;
  readonly driver?: TransactionDriver;
  readonly facts?: HostFacts;
  readonly binding?: PlanBinding;
  readonly now?: () => Date;
  readonly lockRuntime?: LockRuntime;
  readonly environment?: NodeJS.ProcessEnv;
}

/**
 * @decision Plans are portable artifacts and intentionally do not contain a user
 * or session identity. Apply binds the exact artifact to the invoking UID and
 * graphical session in the private state directory before the transaction starts.
 * Session material is hashed only; it is never returned in CLI output.
 */
export function localPlanBinding(environment: NodeJS.ProcessEnv = process.env): PlanBinding {
  const effectiveUid = process.getuid?.();
  if (effectiveUid === undefined) throw new CliCommandError("PLAN_INPUT_INVALID");
  const sessionDigest = sha256({
    domain: "deskcompat.session-binding.v1",
    effectiveUid,
    dbusSessionBusAddress: environment.DBUS_SESSION_BUS_ADDRESS ?? null,
  });
  return { effectiveUid, sessionDigest };
}

async function readPlanInput(path: string): Promise<unknown> {
  if (path.length === 0 || path.length > 4_096 || path.includes("\u0000")) {
    throw new CliCommandError("PLAN_FILE_UNREADABLE");
  }
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    // @constraint O_NONBLOCK prevents a hostile FIFO/device path from hanging before
    // the descriptor can be classified and rejected as non-regular.
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    throw new CliCommandError("PLAN_FILE_UNREADABLE");
  }
  let raw: string;
  try {
    // @constraint Inspect and read through the same no-follow file descriptor so a
    // path swap cannot turn the pre-check into an arbitrary symlink read.
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_PLAN_FILE_BYTES) {
      throw new CliCommandError("PLAN_FILE_UNREADABLE");
    }
    // Read through the validated descriptor into a fixed buffer. The file may grow
    // after stat(), so stat.size alone is not a safe allocation/read bound.
    const buffer = Buffer.alloc(MAX_PLAN_FILE_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_PLAN_FILE_BYTES) {
      throw new CliCommandError("PLAN_FILE_UNREADABLE");
    }
    raw = buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    throw new CliCommandError("PLAN_FILE_UNREADABLE");
  } finally {
    await handle.close();
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new CliCommandError("PLAN_INPUT_INVALID");
  }
}

/** Accept exactly the JSON emitted by `plan --json` or its raw Plan data object. */
export async function loadPlanFile(path: string): Promise<Plan> {
  const input = await readPlanInput(path);
  let candidate: unknown = input;
  const envelope = CliResultSchema.safeParse(input);
  if (envelope.success) {
    if (envelope.data.command !== "plan") throw new CliCommandError("PLAN_ENVELOPE_INVALID");
    candidate = envelope.data.data;
  }
  const plan = PlanSchema.safeParse(candidate);
  if (!plan.success) throw new CliCommandError("PLAN_INPUT_INVALID");
  if (!verifyPlanIntegrity(plan.data)) throw new CliCommandError("PLAN_INTEGRITY_INVALID");
  if (plan.data.toolVersion !== DESKCOMPAT_VERSION) {
    throw new CliCommandError("PLAN_TOOL_VERSION_UNSUPPORTED");
  }
  return plan.data;
}

async function liveApplyContext(dependencies: ApplyCommandDependencies): Promise<{
  readonly facts: HostFacts;
  readonly driver: TransactionDriver;
  readonly binding: PlanBinding;
}> {
  const live =
    dependencies.facts === undefined
      ? await inspectLiveMutationEnvironment(dependencies.environment)
      : undefined;
  const facts = dependencies.facts ?? live?.facts;
  const driver =
    dependencies.driver ?? live?.driver ?? createLiveTransactionDriver(dependencies.environment);
  if (facts === undefined) throw new CliCommandError("PLAN_INPUT_INVALID");
  const binding = dependencies.binding ?? localPlanBinding(dependencies.environment);
  // Keep this computation coupled to planner-fingerprints.ts. The engine compares
  // this digest before the first side effect, preventing a stale plan from running.
  return { facts, driver, binding };
}

export async function apply(
  path: string,
  dependencies: ApplyCommandDependencies = {},
): Promise<CliResult<TransactionRecord>> {
  const plan = await loadPlanFile(path);
  const context = await liveApplyContext(dependencies);
  const engine = new TransactionEngine(dependencies.store ?? new TransactionStore());
  try {
    await engine.persistPlan(plan, context.binding);
  } catch (error) {
    // A plan artifact is immutable. Retrying an apply may encounter its already
    // persisted copy; accept only an exact same-plan copy and let the engine still
    // enforce its original UID/session binding.
    if (!(error instanceof TransactionError) || error.code !== "PLAN_ALREADY_PERSISTED") {
      throw error;
    }
    const existing = await engine.store.loadPlan(plan.planId);
    if (canonicalJson(existing.plan) !== canonicalJson(plan)) throw error;
  }
  const transaction = await engine.applyPlan({
    planId: plan.planId,
    binding: context.binding,
    driver: context.driver,
    currentFacts: context.facts,
    ...(dependencies.now ? { now: dependencies.now } : {}),
    ...(dependencies.lockRuntime ? { lockRuntime: dependencies.lockRuntime } : {}),
  });
  return result("apply", transaction, transactionDiagnostics(transaction));
}
