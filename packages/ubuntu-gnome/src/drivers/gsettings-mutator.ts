import {
  type GSettingsTarget,
  renderGVariant,
  type SettingInspector,
  sha256,
} from "@deskcompat/core";
import {
  type Diagnostic,
  type GSettingsOperation,
  GSettingsOperationSchema,
  type GSettingsResourceId,
  type GSettingsSnapshot,
  GSettingsSnapshotSchema,
  type ObservedSetting,
  ObservedSettingSchema,
} from "@deskcompat/schema";
import type { CommandResult, CommandRunner } from "../internal/command-runner.ts";
import { resolveGSettingsTarget } from "../modules/registry.ts";
import { GSettingsInspector } from "./gsettings-inspector.ts";
import { parseGVariant } from "./gvariant.ts";

const GSETTINGS = "/usr/bin/gsettings";
const DCONF = "/usr/bin/dconf";

/**
 * These codes are intentionally a closed vocabulary. The command runner's stderr
 * can contain usernames, paths, or messages from a desktop service, so it never
 * crosses this boundary. Callers can act on a stable code without receiving host
 * details in JSON, journal entries, or agent context.
 */
export const GSETTINGS_MUTATION_ERROR_CODES = [
  "GSETTINGS_OPERATION_INVALID",
  "GSETTINGS_RESOURCE_NOT_ALLOWLISTED",
  "GSETTINGS_BEFORE_STATE_UNAVAILABLE",
  "GSETTINGS_BEFORE_STATE_MALFORMED",
  "GSETTINGS_PRECONDITION_MISMATCH",
  "GSETTINGS_SET_FAILED",
  "GSETTINGS_VERIFY_UNAVAILABLE",
  "GSETTINGS_VERIFY_MISMATCH",
  "GSETTINGS_RESTORE_PRECONDITION_MISMATCH",
  "GSETTINGS_RESTORE_RAW_INVALID",
  "GSETTINGS_RESET_FAILED",
  "GSETTINGS_WRITE_FAILED",
  "GSETTINGS_RESTORE_VERIFY_UNAVAILABLE",
  "GSETTINGS_RESTORE_VERIFY_MISMATCH",
] as const;

export type GSettingsMutationErrorCode = (typeof GSETTINGS_MUTATION_ERROR_CODES)[number];

export interface GSettingsMutationFailure {
  readonly ok: false;
  readonly code: GSettingsMutationErrorCode;
  readonly diagnostic: Diagnostic;
  readonly resourceId?: GSettingsResourceId;
}

export interface GSettingsMutationSuccess {
  readonly ok: true;
  readonly resourceId: GSettingsResourceId;
  readonly operationId: string;
  readonly changed: boolean;
  readonly before: AvailableObservedSetting;
  readonly after: AvailableObservedSetting;
}

export type GSettingsMutationResult = GSettingsMutationSuccess | GSettingsMutationFailure;
type AvailableObservedSetting = Exclude<ObservedSetting, { readonly status: "unavailable" }>;

function gsettingsSnapshotDigest(
  resourceId: GSettingsResourceId,
  state: GSettingsSnapshot["state"],
): string {
  return sha256({
    domain: "deskcompat.gsettings-observation.v1",
    resourceId,
    ...state,
  });
}

/** Convert the private inspector representation into the transaction snapshot shape. */
export function observedToGSettingsSnapshot(
  resourceId: GSettingsResourceId,
  observed: AvailableObservedSetting,
): GSettingsSnapshot {
  const { digest: _digest, ...state } = observed;
  // The resource discriminator is checked by the schema immediately below. The
  // generic inspector state is intentionally narrowed only at that boundary.
  return GSettingsSnapshotSchema.parse({
    resourceId,
    state,
    digest: gsettingsSnapshotDigest(resourceId, state as GSettingsSnapshot["state"]),
  });
}

export interface GSettingsRestoreOptions {
  /** Digest of the value DeskCompat last verified after applying the operation. */
  readonly expectedCurrentDigest?: string;
}

function diagnostic(
  code: GSettingsMutationErrorCode,
  resourceId?: GSettingsResourceId,
): Diagnostic {
  return {
    code,
    severity: "error",
    ...(resourceId === undefined ? {} : { subject: resourceId }),
    message: `GNOME settings operation could not complete (${code}).`,
  };
}

function failure(
  code: GSettingsMutationErrorCode,
  resourceId?: GSettingsResourceId,
): GSettingsMutationFailure {
  return {
    ok: false,
    code,
    diagnostic: diagnostic(code, resourceId),
    ...(resourceId === undefined ? {} : { resourceId }),
  };
}

function observedSemanticValue(
  resourceId: GSettingsResourceId,
  value: AvailableObservedSetting,
): unknown {
  if (value.status === "inherited") {
    return {
      domain: "deskcompat.gsettings-observation.v1",
      resourceId,
      status: value.status,
      effectiveRaw: value.effectiveRaw,
      effective: value.effective,
      writable: value.writable,
    };
  }
  if (value.status === "present") {
    return {
      domain: "deskcompat.gsettings-observation.v1",
      resourceId,
      status: value.status,
      effectiveRaw: value.effectiveRaw,
      effective: value.effective,
      storedRaw: value.storedRaw,
      writable: value.writable,
    };
  }
  return undefined;
}

function sameValue(left: AvailableObservedSetting, right: AvailableObservedSetting): boolean {
  if (left.status !== right.status) return false;
  if (left.writable !== right.writable) return false;
  if (sha256(left.effective) !== sha256(right.effective)) return false;
  if (left.status === "present" && right.status === "present") {
    return left.storedRaw === right.storedRaw;
  }
  return true;
}

function expectedRestoreDigest(options?: GSettingsRestoreOptions | string): string | undefined {
  return typeof options === "string" ? options : options?.expectedCurrentDigest;
}

/**
 * @decision The mutator deliberately accepts an unknown persisted operation and
 * before-state value. Runtime validation is required at the mutation boundary,
 * because plans and transaction blobs are untrusted input even when they came from
 * DeskCompat's own state directory. All executable details are then obtained from
 * the compiled registry, never from those values.
 */
export class GSettingsMutator {
  private readonly inspector: SettingInspector;

  constructor(
    private readonly commandRunner: CommandRunner,
    inspector: SettingInspector = new GSettingsInspector(commandRunner),
  ) {
    this.inspector = inspector;
  }

  private async run(
    executable: string,
    args: readonly string[],
  ): Promise<CommandResult | undefined> {
    try {
      return await this.commandRunner.run({ executable, args });
    } catch {
      // @constraint Never expose command errors or stderr: they may contain host
      // paths, usernames, or service-provided sensitive details.
      return undefined;
    }
  }

  private parseOperation(
    input: unknown,
  ):
    | { readonly operation: GSettingsOperation; readonly target: GSettingsTarget }
    | GSettingsMutationFailure {
    const parsed = GSettingsOperationSchema.safeParse(input);
    if (!parsed.success) return failure("GSETTINGS_OPERATION_INVALID");
    const target = resolveGSettingsTarget(parsed.data.resourceId);
    if (target === undefined) {
      return failure("GSETTINGS_RESOURCE_NOT_ALLOWLISTED", parsed.data.resourceId);
    }
    return { operation: parsed.data, target };
  }

  private async inspect(
    target: GSettingsTarget,
    code:
      | "GSETTINGS_BEFORE_STATE_UNAVAILABLE"
      | "GSETTINGS_VERIFY_UNAVAILABLE"
      | "GSETTINGS_RESTORE_VERIFY_UNAVAILABLE",
  ): Promise<AvailableObservedSetting | GSettingsMutationFailure> {
    try {
      const observed = await this.inspector.inspect(target);
      return observed.status === "unavailable" ? failure(code, target.resourceId) : observed;
    } catch {
      return failure(code, target.resourceId);
    }
  }

  private validBeforeState(
    resourceId: GSettingsResourceId,
    target: GSettingsTarget,
    input: unknown,
  ): AvailableObservedSetting | GSettingsMutationFailure {
    const parsed = ObservedSettingSchema.safeParse(input);
    if (!parsed.success || parsed.data.status === "unavailable") {
      return failure("GSETTINGS_BEFORE_STATE_MALFORMED", resourceId);
    }
    const before = parsed.data;
    const effectiveRaw = parseGVariant(before.effectiveRaw, target.valueType);
    if (effectiveRaw === undefined || sha256(effectiveRaw) !== sha256(before.effective)) {
      return failure("GSETTINGS_BEFORE_STATE_MALFORMED", resourceId);
    }
    if (before.status === "present") {
      const storedRaw = parseGVariant(before.storedRaw, target.valueType);
      if (storedRaw === undefined) return failure("GSETTINGS_RESTORE_RAW_INVALID", resourceId);
    }
    const semantic = observedSemanticValue(resourceId, before);
    if (semantic === undefined || sha256(semantic) !== before.digest) {
      return failure("GSETTINGS_BEFORE_STATE_MALFORMED", resourceId);
    }
    return before;
  }

  private validSnapshotState(
    resourceId: GSettingsResourceId,
    target: GSettingsTarget,
    input: unknown,
  ): AvailableObservedSetting | GSettingsMutationFailure {
    const parsed = GSettingsSnapshotSchema.safeParse(input);
    if (!parsed.success || parsed.data.resourceId !== resourceId) {
      return failure("GSETTINGS_BEFORE_STATE_MALFORMED", resourceId);
    }
    if (parsed.data.digest !== gsettingsSnapshotDigest(resourceId, parsed.data.state)) {
      return failure("GSETTINGS_BEFORE_STATE_MALFORMED", resourceId);
    }
    return this.validBeforeState(resourceId, target, {
      ...parsed.data.state,
      digest: parsed.data.digest,
    });
  }

  private success(
    operation: GSettingsOperation,
    before: AvailableObservedSetting,
    after: AvailableObservedSetting,
    changed: boolean,
  ): GSettingsMutationSuccess {
    return {
      ok: true,
      resourceId: operation.resourceId,
      operationId: operation.id,
      changed,
      before,
      after,
    };
  }

  /** Apply one validated operation and verify its typed effective value. */
  async apply(input: unknown): Promise<GSettingsMutationResult> {
    const resolved = this.parseOperation(input);
    if ("ok" in resolved) return resolved;
    const { operation, target } = resolved;
    const before = await this.inspect(target, "GSETTINGS_BEFORE_STATE_UNAVAILABLE");
    if ("ok" in before) return before;
    if (before.digest !== operation.expectedBeforeDigest) {
      return failure("GSETTINGS_PRECONDITION_MISMATCH", operation.resourceId);
    }
    if (sha256(before.effective) === sha256(operation.desired)) {
      return this.success(operation, before, before, false);
    }

    const command = await this.run(GSETTINGS, [
      "set",
      target.schema,
      target.key,
      renderGVariant(operation.desired),
    ]);
    if (command === undefined || command.exitCode !== 0) {
      return failure("GSETTINGS_SET_FAILED", operation.resourceId);
    }
    const after = await this.inspect(target, "GSETTINGS_VERIFY_UNAVAILABLE");
    if ("ok" in after) return after;
    if (sha256(after.effective) !== sha256(operation.desired)) {
      return failure("GSETTINGS_VERIFY_MISMATCH", operation.resourceId);
    }
    return this.success(operation, before, after, true);
  }

  /** Alias used by transaction drivers that call the side effect a set. */
  async set(input: unknown): Promise<GSettingsMutationResult> {
    return this.apply(input);
  }

  /**
   * Restore the exact raw baseline captured before an operation. An inherited
   * value is reset (not rewritten as a guessed default); an explicit value is
   * restored with its original dconf representation. The optional current digest
   * provides compare-before-write protection for compensation.
   */
  async restore(
    operationInput: unknown,
    beforeInput: unknown,
    options?: GSettingsRestoreOptions | string,
  ): Promise<GSettingsMutationResult> {
    const resolved = this.parseOperation(operationInput);
    if ("ok" in resolved) return resolved;
    const { operation, target } = resolved;
    return this.restoreResolved(operation, target, beforeInput, options);
  }

  private async restoreResolved(
    operation: GSettingsOperation,
    target: GSettingsTarget,
    beforeInput: unknown,
    options?: GSettingsRestoreOptions | string,
  ): Promise<GSettingsMutationResult> {
    const before = GSettingsSnapshotSchema.safeParse(beforeInput).success
      ? this.validSnapshotState(operation.resourceId, target, beforeInput)
      : this.validBeforeState(operation.resourceId, target, beforeInput);
    if ("ok" in before) return before;
    if (before.digest !== operation.expectedBeforeDigest) {
      return failure("GSETTINGS_PRECONDITION_MISMATCH", operation.resourceId);
    }

    const current = await this.inspect(target, "GSETTINGS_RESTORE_VERIFY_UNAVAILABLE");
    if ("ok" in current) return current;
    const expectedCurrent = expectedRestoreDigest(options);
    if (expectedCurrent !== undefined && current.digest !== expectedCurrent) {
      return failure("GSETTINGS_RESTORE_PRECONDITION_MISMATCH", operation.resourceId);
    }
    if (sameValue(current, before)) {
      return this.success(operation, current, current, false);
    }

    let command: CommandResult | undefined;
    if (before.status === "inherited") {
      command = await this.run(DCONF, ["reset", target.dconfPath]);
    } else {
      // The raw value was parsed above. Passing it as one argv item prevents any
      // shell interpretation even when a string contains spaces or punctuation.
      command = await this.run(DCONF, ["write", target.dconfPath, before.storedRaw]);
    }
    if (command === undefined || command.exitCode !== 0) {
      return failure(
        before.status === "inherited" ? "GSETTINGS_RESET_FAILED" : "GSETTINGS_WRITE_FAILED",
        operation.resourceId,
      );
    }

    const after = await this.inspect(target, "GSETTINGS_RESTORE_VERIFY_UNAVAILABLE");
    if ("ok" in after) return after;
    if (!sameValue(after, before)) {
      return failure("GSETTINGS_RESTORE_VERIFY_MISMATCH", operation.resourceId);
    }
    return this.success(operation, current, after, true);
  }

  /** Restore directly from a transaction snapshot without manufacturing a plan operation. */
  async restoreSnapshot(
    resourceIdInput: unknown,
    beforeInput: unknown,
    expectedCurrentDigest: string,
  ): Promise<GSettingsMutationResult> {
    const target = resolveGSettingsTarget(resourceIdInput);
    if (target === undefined) return failure("GSETTINGS_RESOURCE_NOT_ALLOWLISTED");
    const resourceId = target.resourceId;
    const before = this.validSnapshotState(resourceId, target, beforeInput);
    if ("ok" in before) return before;
    const operation = this.restoreOperation(resourceId, before);
    return this.restoreResolved(operation, target, before, { expectedCurrentDigest });
  }

  private restoreOperation(
    resourceId: GSettingsResourceId,
    before: AvailableObservedSetting,
  ): GSettingsOperation {
    const desired =
      resourceId === "gsettings:org.gnome.mutter:dynamic-workspaces"
        ? { type: "boolean", value: false as const }
        : resourceId === "gsettings:org.gnome.desktop.wm.preferences:num-workspaces"
          ? before.effective.type === "int32"
            ? before.effective
            : { type: "int32", value: 1 as const }
          : resourceId === "gsettings:org.gnome.mutter:workspaces-only-on-primary"
            ? { type: "boolean", value: false as const }
            : { type: "string", value: "close,minimize,maximize:" as const };
    const operationIdentity = {
      kind: "gsettings.set" as const,
      moduleId:
        resourceId === "gsettings:org.gnome.desktop.wm.preferences:button-layout"
          ? ("windowControls" as const)
          : ("workspaces" as const),
      resourceId,
      desired,
    };
    return {
      ...operationIdentity,
      id: `op_${sha256(operationIdentity)}`,
      privilege: "user",
      risk:
        resourceId === "gsettings:org.gnome.desktop.wm.preferences:button-layout"
          ? "low"
          : "desktop-session",
      rollbackQuality: "exact-if-unchanged",
      dependsOn: [],
      expectedBeforeDigest: before.digest,
    } as GSettingsOperation;
  }

  /** Alias for callers that use compensation terminology. */
  async revert(
    operationInput: unknown,
    beforeInput: unknown,
    options?: GSettingsRestoreOptions | string,
  ): Promise<GSettingsMutationResult> {
    return this.restore(operationInput, beforeInput, options);
  }
}

export function createGSettingsMutator(
  commandRunner: CommandRunner,
  inspector?: SettingInspector,
): GSettingsMutator {
  return new GSettingsMutator(commandRunner, inspector);
}

export interface GSettingsMutationReceipt {
  /** Observation checked by the driver immediately before its write. */
  readonly beforeDigest: string;
}

export class GSettingsDriverError extends Error {
  constructor(
    readonly code: GSettingsMutationErrorCode,
    readonly resourceId?: GSettingsResourceId,
  ) {
    super(`GNOME settings driver failed (${code}).`);
    this.name = "GSettingsDriverError";
  }
}

function throwFailure(result: GSettingsMutationFailure): never {
  throw new GSettingsDriverError(result.code, result.resourceId);
}

/**
 * Adapter for the core transaction kernel. It keeps the kernel's snapshot protocol
 * separate from the lower-level mutator API while retaining one implementation of
 * command construction, validation, compare-before-write, and verification.
 *
 * The method shapes intentionally match `TransactionDriver` structurally. Keeping
 * this package independent of core's transaction implementation avoids a runtime
 * import cycle; the core kernel can type-check this class against its interface.
 */
export class GSettingsTransactionDriver {
  private readonly inspector: SettingInspector;
  private readonly mutator: GSettingsMutator;

  constructor(
    commandRunner: CommandRunner,
    inspector: SettingInspector = new GSettingsInspector(commandRunner),
  ) {
    this.inspector = inspector;
    this.mutator = new GSettingsMutator(commandRunner, inspector);
  }

  async inspect(resourceIdInput: unknown): Promise<GSettingsSnapshot> {
    const target = resolveGSettingsTarget(resourceIdInput);
    if (target === undefined) throw new GSettingsDriverError("GSETTINGS_RESOURCE_NOT_ALLOWLISTED");
    let observed: ObservedSetting;
    try {
      observed = await this.inspector.inspect(target);
    } catch {
      throw new GSettingsDriverError("GSETTINGS_BEFORE_STATE_UNAVAILABLE", target.resourceId);
    }
    if (observed.status === "unavailable") {
      throw new GSettingsDriverError("GSETTINGS_BEFORE_STATE_UNAVAILABLE", target.resourceId);
    }
    try {
      return observedToGSettingsSnapshot(target.resourceId, observed);
    } catch {
      throw new GSettingsDriverError("GSETTINGS_BEFORE_STATE_MALFORMED", target.resourceId);
    }
  }

  async apply(
    operationInput: unknown,
    expectedBeforeInput: unknown,
  ): Promise<GSettingsMutationReceipt> {
    const parsedOperation = GSettingsOperationSchema.safeParse(operationInput);
    if (!parsedOperation.success) throw new GSettingsDriverError("GSETTINGS_OPERATION_INVALID");
    const operation = parsedOperation.data;
    const target = resolveGSettingsTarget(operation.resourceId);
    if (target === undefined) {
      throw new GSettingsDriverError("GSETTINGS_RESOURCE_NOT_ALLOWLISTED", operation.resourceId);
    }
    const expectedBefore = this.validatedSnapshot(operation.resourceId, expectedBeforeInput);
    if (expectedBefore.digest !== operation.expectedBeforeDigest) {
      throw new GSettingsDriverError("GSETTINGS_PRECONDITION_MISMATCH", operation.resourceId);
    }
    const result = await this.mutator.apply(operation);
    if (!result.ok) throwFailure(result);
    if (result.before.digest !== expectedBefore.digest) {
      throw new GSettingsDriverError("GSETTINGS_PRECONDITION_MISMATCH", operation.resourceId);
    }
    return { beforeDigest: result.before.digest };
  }

  async restore(
    resourceIdInput: unknown,
    beforeInput: unknown,
    expectedCurrentDigest: string,
  ): Promise<GSettingsMutationReceipt> {
    const target = resolveGSettingsTarget(resourceIdInput);
    if (target === undefined) throw new GSettingsDriverError("GSETTINGS_RESOURCE_NOT_ALLOWLISTED");
    const before = this.validatedSnapshot(target.resourceId, beforeInput);
    const result = await this.mutator.restoreSnapshot(
      target.resourceId,
      before,
      expectedCurrentDigest,
    );
    if (!result.ok) throwFailure(result);
    return { beforeDigest: result.before.digest };
  }

  private validatedSnapshot(resourceId: GSettingsResourceId, input: unknown): GSettingsSnapshot {
    const parsed = GSettingsSnapshotSchema.safeParse(input);
    if (!parsed.success || parsed.data.resourceId !== resourceId) {
      throw new GSettingsDriverError("GSETTINGS_BEFORE_STATE_MALFORMED", resourceId);
    }
    if (parsed.data.digest !== gsettingsSnapshotDigest(resourceId, parsed.data.state)) {
      throw new GSettingsDriverError("GSETTINGS_BEFORE_STATE_MALFORMED", resourceId);
    }
    return parsed.data;
  }
}

export { GSettingsTransactionDriver as GSettingsDriver };

export function createGSettingsTransactionDriver(
  commandRunner: CommandRunner,
  inspector?: SettingInspector,
): GSettingsTransactionDriver {
  return new GSettingsTransactionDriver(commandRunner, inspector);
}

export const createGSettingsDriver = createGSettingsTransactionDriver;
