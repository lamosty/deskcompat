import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import {
  buildPlan,
  enumerateTransactionSteps,
  gsettingsSnapshotDigest,
  type MutationReceipt,
  sha256,
  type TransactionDriver,
  TransactionEngine,
  TransactionJournal,
  TransactionStore,
} from "../../packages/core/src/index.ts";
import type {
  GSettingsOperation,
  GSettingsResourceId,
  GSettingsSnapshot,
  GSettingsValue,
  HostFacts,
  ObservedSetting,
  PlanBinding,
  Profile,
} from "../../packages/schema/src/index.ts";

const resourceId = "gsettings:org.gnome.desktop.wm.preferences:button-layout" as const;
const desired = "close,minimize,maximize:";
const binding: PlanBinding = {
  effectiveUid: typeof process.getuid === "function" ? process.getuid() : 1000,
  sessionDigest: "c".repeat(64),
};
const profile: Profile = {
  apiVersion: "deskcompat.dev/v1alpha1",
  kind: "Profile",
  metadata: { name: "transaction-engine" },
  spec: { modules: { windowControls: { state: "managed", preset: "macos-standard" } } },
};
const facts: HostFacts = {
  platform: {
    osId: "ubuntu",
    osVersion: "24.04",
    desktop: "gnome",
    desktopVersion: "46.0",
    sessionType: "wayland",
  },
  capabilities: [
    { id: "dconf", available: true },
    { id: "gsettings", available: true },
    { id: "session-bus", available: true },
  ],
  conflicts: [],
};

function settingSnapshot(
  value: string,
  status: "present" | "inherited" = "present",
): GSettingsSnapshot {
  const effective = { type: "string" as const, value };
  const state =
    status === "present"
      ? {
          status,
          effectiveRaw: `'${value}'`,
          effective,
          storedRaw: `'${value}'`,
          writable: true,
        }
      : { status, effectiveRaw: `'${value}'`, effective, writable: true };
  return { resourceId, state, digest: gsettingsSnapshotDigest(resourceId, state) };
}

async function makePlan(
  before: GSettingsSnapshot,
  ownership: ReadonlyArray<{
    resourceId: typeof resourceId;
    moduleId: "windowControls";
    appliedDigest: string;
  }> = [],
) {
  const observation: ObservedSetting = { ...before.state, digest: before.digest };
  return buildPlan({
    profile,
    facts,
    desiredSettings: [
      {
        moduleId: "windowControls",
        target: {
          resourceId,
          schema: "org.gnome.desktop.wm.preferences",
          key: "button-layout",
          dconfPath: "/org/gnome/desktop/wm/preferences/button-layout",
          valueType: "string",
        },
        desired: { type: "string", value: desired },
        risk: "low",
      },
    ],
    selectedModules: ["windowControls"],
    inspector: { inspect: async () => observation },
    ownership,
    supportDiagnostics: [],
    toolVersion: "test",
    now: new Date("2026-01-01T00:00:00Z"),
    ttlMs: 60_000,
  });
}

class MemoryDriver implements TransactionDriver {
  restoreFails = false;
  applyCalls = 0;
  restoreCalls = 0;

  constructor(public current: GSettingsSnapshot) {}

  async inspect(requested: GSettingsResourceId): Promise<GSettingsSnapshot> {
    if (requested !== resourceId) throw new Error("unknown resource");
    return structuredClone(this.current);
  }

  async apply(
    operation: GSettingsOperation,
    expectedBefore: GSettingsSnapshot,
  ): Promise<MutationReceipt> {
    this.applyCalls += 1;
    if (this.current.digest !== expectedBefore.digest) return { beforeDigest: this.current.digest };
    this.current = this.fromValue(operation.desired);
    return { beforeDigest: expectedBefore.digest };
  }

  async restore(
    requested: GSettingsResourceId,
    before: GSettingsSnapshot,
    expectedCurrentDigest: string,
  ): Promise<MutationReceipt> {
    this.restoreCalls += 1;
    if (requested !== resourceId) throw new Error("unknown resource");
    if (this.restoreFails) throw new Error("injected restore failure");
    const observed = this.current.digest;
    if (observed === expectedCurrentDigest) this.current = structuredClone(before);
    return { beforeDigest: observed };
  }

  externalChange(value: string): void {
    this.current = settingSnapshot(value);
  }

  private fromValue(value: GSettingsValue): GSettingsSnapshot {
    if (value.type !== "string") throw new Error("unexpected test value");
    return settingSnapshot(value.value);
  }
}

async function setup(before: GSettingsSnapshot) {
  const root = await mkdtemp("/tmp/deskcompat-engine-");
  const store = new TransactionStore(join(root, "state"));
  const engine = new TransactionEngine(store);
  const plan = await makePlan(before);
  await engine.persistPlan(plan, binding, new Date("2026-01-01T00:00:01Z"));
  return { store, engine, plan };
}

const clock = () => new Date("2026-01-01T00:00:30Z");

describe("TransactionEngine", () => {
  test("explicitly adopts an already-matching managed resource", async () => {
    const before = settingSnapshot(desired, "inherited");
    const { store, engine, plan } = await setup(before);
    const adoption = plan.operations[0];
    if (adoption?.kind !== "resource.adopt") {
      throw new Error("Expected an explicit resource adoption operation");
    }
    expect(enumerateTransactionSteps(plan)).toEqual([
      {
        action: "adopt",
        operationId: adoption.id,
        resourceId,
        moduleId: "windowControls",
        expectedBeforeDigest: before.digest,
      },
    ]);
    const driver = new MemoryDriver(before);
    const result = await engine.applyPlan({
      planId: plan.planId,
      binding,
      driver,
      currentFacts: facts,
      now: clock,
    });
    expect(result.status).toBe("committed");
    expect(result.receipts).toMatchObject([
      { action: "adopt", resourceId, ownershipWasNew: true, beforeDigest: before.digest },
    ]);
    expect(driver.applyCalls).toBe(0);
    const ownership = await store.loadOwnership();
    expect(ownership.resources).toMatchObject([
      {
        resourceId,
        origin: "adopted",
        baselineDigest: before.digest,
        appliedDigest: before.digest,
        acquiredByTransactionId: result.transactionId,
      },
    ]);
    const events = await new TransactionJournal(store, result.transactionId, clock).read();
    expect(events.map(({ event }) => event)).toContain("resource_acquired");

    const reverted = await engine.revertTransaction({
      transactionId: result.transactionId,
      binding,
      driver,
      now: clock,
    });
    expect(reverted.status).toBe("reverted");
    expect((await store.loadOwnership()).resources).toEqual([]);
  });

  test("rejects ownership acquired after an adoption plan was reviewed", async () => {
    const before = settingSnapshot(desired);
    const { store, engine, plan } = await setup(before);
    const baselineBlobDigest = await store.saveSnapshot(before);
    const otherTransaction = `tx_${"9".repeat(64)}`;
    await store.saveOwnership({
      apiVersion: "deskcompat.dev/ownership/v1alpha1",
      resources: [
        {
          resourceId,
          moduleId: "windowControls",
          origin: "adopted",
          baselineBlobDigest,
          baselineDigest: before.digest,
          appliedDigest: before.digest,
          acquiredByTransactionId: otherTransaction,
          lastTransactionId: otherTransaction,
          acquiredAt: "2026-01-01T00:00:10.000Z",
          updatedAt: "2026-01-01T00:00:10.000Z",
        },
      ],
    });
    const driver = new MemoryDriver(before);

    const result = await engine.applyPlan({
      planId: plan.planId,
      binding,
      driver,
      currentFacts: facts,
      now: clock,
    });

    expect(result.status).toBe("conflicted");
    expect(result.receipts).toEqual([]);
    expect(driver.applyCalls).toBe(0);
  });

  test("revalidates target state even when an owned plan has no operations", async () => {
    const before = settingSnapshot(desired);
    const root = await mkdtemp("/tmp/deskcompat-engine-");
    const store = new TransactionStore(join(root, "state"));
    const baselineBlobDigest = await store.saveSnapshot(before);
    const owningTransaction = `tx_${"8".repeat(64)}`;
    const ownership = {
      apiVersion: "deskcompat.dev/ownership/v1alpha1" as const,
      resources: [
        {
          resourceId,
          moduleId: "windowControls" as const,
          origin: "adopted" as const,
          baselineBlobDigest,
          baselineDigest: before.digest,
          appliedDigest: before.digest,
          acquiredByTransactionId: owningTransaction,
          lastTransactionId: owningTransaction,
          acquiredAt: "2026-01-01T00:00:10.000Z",
          updatedAt: "2026-01-01T00:00:10.000Z",
        },
      ],
    };
    await store.saveOwnership(ownership);
    const plan = await makePlan(before, ownership.resources);
    expect(plan.operations).toEqual([]);
    const engine = new TransactionEngine(store);
    await engine.persistPlan(plan, binding, new Date("2026-01-01T00:00:15Z"));
    const driver = new MemoryDriver(before);
    driver.externalChange("external-value");

    const result = await engine.applyPlan({
      planId: plan.planId,
      binding,
      driver,
      currentFacts: facts,
      now: clock,
    });

    expect(result.status).toBe("failed");
    expect(driver.applyCalls).toBe(0);
  });

  test("applies, verifies, records the exact baseline, and conditionally reverts", async () => {
    const before = settingSnapshot(":close", "inherited");
    const { store, engine, plan } = await setup(before);
    const driver = new MemoryDriver(before);
    const applied = await engine.applyPlan({
      planId: plan.planId,
      binding,
      driver,
      currentFacts: facts,
      now: clock,
    });
    expect(applied.status).toBe("committed");
    expect(driver.current.state).toMatchObject({
      status: "present",
      effective: { value: desired },
    });
    const receipt = applied.receipts[0];
    expect(receipt?.beforeDigest).toBe(before.digest);
    expect(await store.loadSnapshot(receipt?.beforeBlobDigest ?? "")).toEqual(before);

    const reverted = await engine.revertTransaction({
      transactionId: applied.transactionId,
      binding,
      driver,
      now: clock,
    });
    expect(reverted.status).toBe("reverted");
    expect(driver.current).toEqual(before);
    expect((await store.loadOwnership()).resources).toEqual([]);
  });

  test("preserves an external change instead of overwriting it", async () => {
    const before = settingSnapshot(":close");
    const { engine, plan } = await setup(before);
    const driver = new MemoryDriver(before);
    const applied = await engine.applyPlan({
      planId: plan.planId,
      binding,
      driver,
      currentFacts: facts,
      now: clock,
    });
    driver.externalChange("external-value");
    const externalDigest = driver.current.digest;

    const reverted = await engine.revertTransaction({
      transactionId: applied.transactionId,
      binding,
      driver,
      now: clock,
    });
    expect(reverted.status).toBe("conflicted");
    expect(reverted.conflicts).toEqual([resourceId]);
    expect(driver.current.digest).toBe(externalDigest);
  });

  test("does not silently release an adopted resource that drifted externally", async () => {
    const before = settingSnapshot(desired);
    const { store, engine, plan } = await setup(before);
    const driver = new MemoryDriver(before);
    const adopted = await engine.applyPlan({
      planId: plan.planId,
      binding,
      driver,
      currentFacts: facts,
      now: clock,
    });
    driver.externalChange("external-value");
    const reverted = await engine.revertTransaction({
      transactionId: adopted.transactionId,
      binding,
      driver,
      now: clock,
    });
    expect(reverted.status).toBe("conflicted");
    expect((await store.loadOwnership()).resources).toHaveLength(1);
  });

  test("compensates a verified effect after injected failure", async () => {
    const before = settingSnapshot(":close");
    const { engine, plan } = await setup(before);
    const driver = new MemoryDriver(before);
    const failed = await engine.applyPlan({
      planId: plan.planId,
      binding,
      driver,
      currentFacts: facts,
      now: clock,
      failureInjector: (point) => {
        if (point === "after_operation_applied") throw new Error("injected");
      },
    });
    expect(failed.status).toBe("failed");
    expect(driver.current).toEqual(before);
    expect(driver.restoreCalls).toBe(1);
  });

  test("recovers a previously uncompensated effect from its durable receipts", async () => {
    const before = settingSnapshot(":close");
    const { engine, plan } = await setup(before);
    const driver = new MemoryDriver(before);
    driver.restoreFails = true;
    const interrupted = await engine.applyPlan({
      planId: plan.planId,
      binding,
      driver,
      currentFacts: facts,
      now: clock,
      failureInjector: (point) => {
        if (point === "after_operation_applied") throw new Error("injected");
      },
    });
    expect(interrupted.status).toBe("recovery-required");
    expect(sha256(driver.current.state.effective)).toBe(sha256({ type: "string", value: desired }));

    driver.restoreFails = false;
    const recovered = await engine.recoverTransaction({
      transactionId: interrupted.transactionId,
      binding,
      driver,
      now: clock,
    });
    expect(recovered.status).toBe("reverted");
    expect(driver.current).toEqual(before);
  });

  test("recovers a verified effect from a durable applied event without a manifest receipt", async () => {
    const before = settingSnapshot(":close");
    const { store, engine, plan } = await setup(before);
    const driver = new MemoryDriver(before);
    driver.restoreFails = true;
    const interrupted = await engine.applyPlan({
      planId: plan.planId,
      binding,
      driver,
      currentFacts: facts,
      now: clock,
      failureInjector: (point) => {
        if (point === "after_operation_applied") throw new Error("injected");
      },
    });
    expect(interrupted.status).toBe("recovery-required");

    // Model a process death after fsyncing operation_applied but before copying the
    // receipt into the transaction manifest.
    await store.saveTransaction({ ...interrupted, receipts: [] });
    driver.restoreFails = false;
    const recovered = await engine.recoverTransaction({
      transactionId: interrupted.transactionId,
      binding,
      driver,
      now: clock,
    });

    expect(recovered.status).toBe("reverted");
    expect(recovered.receipts).toHaveLength(1);
    expect(driver.current).toEqual(before);
  });

  test("does not attribute an intent-only desired value to DeskCompat during recovery", async () => {
    const before = settingSnapshot(":close");
    const { engine, plan } = await setup(before);
    const driver = new MemoryDriver(before);
    const interrupted = await engine.applyPlan({
      planId: plan.planId,
      binding,
      driver,
      currentFacts: facts,
      now: clock,
      failureInjector: (point) => {
        if (point === "after_operation_intent") throw new Error("injected");
      },
    });
    expect(interrupted.status).toBe("failed");

    // Another actor happens to write the planned value after DeskCompat recorded
    // intent but before recovery. Intent is not durable proof of authorship.
    driver.externalChange(desired);
    const externalDigest = driver.current.digest;
    const recovered = await engine.recoverTransaction({
      transactionId: interrupted.transactionId,
      binding,
      driver,
      now: clock,
    });

    expect(recovered.status).toBe("conflicted");
    expect(recovered.conflicts).toEqual([resourceId]);
    expect(driver.current.digest).toBe(externalDigest);
    expect(driver.restoreCalls).toBe(0);
  });

  for (const failurePoint of ["after_compensation_intent", "after_driver_restore"] as const) {
    test(`recovers a revert interrupted ${failurePoint}`, async () => {
      const before = settingSnapshot(":close");
      const { store, engine, plan } = await setup(before);
      const driver = new MemoryDriver(before);
      const applied = await engine.applyPlan({
        planId: plan.planId,
        binding,
        driver,
        currentFacts: facts,
        now: clock,
      });
      expect(applied.status).toBe("committed");

      const interruptedRevert = await engine.revertTransaction({
        transactionId: applied.transactionId,
        binding,
        driver,
        now: clock,
        failureInjector: (point) => {
          if (point === failurePoint) throw new Error("injected");
        },
      });
      expect(interruptedRevert.mode).toBe("revert");
      expect(interruptedRevert.status).toBe("recovery-required");
      expect((await store.loadOwnership()).resources).toHaveLength(1);

      // Recovery must use the durable linked apply transaction even if a process
      // death prevented the revert manifest from copying its receipts.
      await store.saveTransaction({ ...interruptedRevert, receipts: [] });

      const recovered = await engine.recoverTransaction({
        transactionId: interruptedRevert.transactionId,
        binding,
        driver,
        now: clock,
      });
      expect(recovered.status).toBe("reverted");
      expect(recovered.receipts).toEqual(applied.receipts);
      expect(driver.current).toEqual(before);
      expect((await store.loadOwnership()).resources).toEqual([]);
    });
  }

  test("does not recover a revert after ownership advanced", async () => {
    const before = settingSnapshot(":close");
    const { store, engine, plan } = await setup(before);
    const driver = new MemoryDriver(before);
    const applied = await engine.applyPlan({
      planId: plan.planId,
      binding,
      driver,
      currentFacts: facts,
      now: clock,
    });
    const ownership = await store.loadOwnership();
    const advancedTransactionId = `tx_${"7".repeat(64)}` as const;
    await store.saveOwnership({
      ...ownership,
      resources: ownership.resources.map((entry) => ({
        ...entry,
        lastTransactionId: advancedTransactionId,
      })),
    });

    const conflictedRevert = await engine.revertTransaction({
      transactionId: applied.transactionId,
      binding,
      driver,
      now: clock,
    });
    expect(conflictedRevert.status).toBe("conflicted");
    expect(driver.restoreCalls).toBe(0);

    const recovered = await engine.recoverTransaction({
      transactionId: conflictedRevert.transactionId,
      binding,
      driver,
      now: clock,
    });
    expect(recovered.status).toBe("conflicted");
    expect(recovered.conflicts).toEqual([resourceId]);
    expect(driver.restoreCalls).toBe(0);
    expect(driver.current.state.effective).toEqual({ type: "string", value: desired });
  });

  test("checks the session binding before returning a terminal recovery target", async () => {
    const before = settingSnapshot(":close");
    const { engine, plan } = await setup(before);
    const driver = new MemoryDriver(before);
    const committed = await engine.applyPlan({
      planId: plan.planId,
      binding,
      driver,
      currentFacts: facts,
      now: clock,
    });

    await expect(
      engine.recoverTransaction({
        transactionId: committed.transactionId,
        binding: { ...binding, sessionDigest: "e".repeat(64) },
        driver,
        now: clock,
      }),
    ).rejects.toMatchObject({ code: "BINDING_MISMATCH" });
  });

  test("rejects stale host facts and another session binding before mutation", async () => {
    const before = settingSnapshot(":close");
    const { engine, plan } = await setup(before);
    const driver = new MemoryDriver(before);
    await expect(
      engine.applyPlan({
        planId: plan.planId,
        binding,
        driver,
        currentFacts: { ...facts, platform: { ...facts.platform, desktopVersion: "47" } },
        now: clock,
      }),
    ).rejects.toMatchObject({ code: "EXTERNAL_DRIFT" });
    await expect(
      engine.applyPlan({
        planId: plan.planId,
        binding: { ...binding, sessionDigest: "e".repeat(64) },
        driver,
        currentFacts: facts,
        now: clock,
      }),
    ).rejects.toMatchObject({ code: "BINDING_MISMATCH" });
    expect(driver.applyCalls).toBe(0);
  });
});
