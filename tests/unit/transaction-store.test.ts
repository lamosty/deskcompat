import { describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  acquireMutationLock,
  buildPlan,
  gsettingsSnapshotDigest,
  type LockRuntime,
  resolveStateRoot,
  TransactionError,
  TransactionJournal,
  TransactionStore,
} from "../../packages/core/src/index.ts";
import type {
  GSettingsSnapshot,
  HostFacts,
  LockOwner,
  ObservedSetting,
  PlanBinding,
  Profile,
} from "../../packages/schema/src/index.ts";

const profile: Profile = {
  apiVersion: "deskcompat.dev/v1alpha1",
  kind: "Profile",
  metadata: { name: "transaction-store" },
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
const binding: PlanBinding = {
  effectiveUid: typeof process.getuid === "function" ? process.getuid() : 1000,
  sessionDigest: "a".repeat(64),
};

function snapshot(value = ":close"): GSettingsSnapshot {
  const resourceId = "gsettings:org.gnome.desktop.wm.preferences:button-layout" as const;
  const state = {
    status: "present" as const,
    effectiveRaw: `'${value}'`,
    storedRaw: `'${value}'`,
    effective: { type: "string" as const, value },
    writable: true,
  };
  return { resourceId, state, digest: gsettingsSnapshotDigest(resourceId, state) };
}

async function planFor(observation: GSettingsSnapshot) {
  const publicObservation: ObservedSetting = {
    ...observation.state,
    digest: observation.digest,
  };
  return buildPlan({
    profile,
    facts,
    desiredSettings: [
      {
        moduleId: "windowControls",
        target: {
          resourceId: observation.resourceId,
          schema: "org.gnome.desktop.wm.preferences",
          key: "button-layout",
          dconfPath: "/org/gnome/desktop/wm/preferences/button-layout",
          valueType: "string",
        },
        desired: { type: "string", value: "close,minimize,maximize:" },
        risk: "low",
      },
    ],
    selectedModules: ["windowControls"],
    inspector: { inspect: async () => publicObservation },
    supportDiagnostics: [],
    toolVersion: "test",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
}

describe("transaction persistence", () => {
  test("resolves the XDG state root and falls back to HOME", () => {
    expect(resolveStateRoot({ XDG_STATE_HOME: "/state", HOME: "/home/example" })).toBe(
      "/state/deskcompat",
    );
    expect(resolveStateRoot({ XDG_STATE_HOME: "relative", HOME: "/home/example" })).toBe(
      "/home/example/.local/state/deskcompat",
    );
    expect(() => resolveStateRoot({})).toThrow(TransactionError);
  });

  test("reads absent ownership without creating application state", async () => {
    const parent = await mkdtemp("/tmp/deskcompat-read-state-");
    const root = join(parent, "absent");
    const store = new TransactionStore(root);

    expect(await store.readOwnership()).toEqual({
      apiVersion: "deskcompat.dev/ownership/v1alpha1",
      resources: [],
    });
    expect(await store.listTransactions()).toEqual([]);
    await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("does not share mutable absent ownership and refuses a symlinked read root", async () => {
    const parent = await mkdtemp("/tmp/deskcompat-read-state-");
    const first = new TransactionStore(join(parent, "first"));
    const firstResult = await first.readOwnership();
    firstResult.resources.push({} as never);
    expect((await new TransactionStore(join(parent, "second")).readOwnership()).resources).toEqual(
      [],
    );

    const actual = join(parent, "actual");
    await mkdir(actual, { mode: 0o700 });
    const linked = join(parent, "linked");
    await symlink(actual, linked);
    const linkedStore = new TransactionStore(linked);
    await expect(linkedStore.readOwnership()).rejects.toMatchObject({ code: "SYMLINK_REFUSED" });
    await expect(linkedStore.listTransactions()).rejects.toMatchObject({
      code: "SYMLINK_REFUSED",
    });
  });

  test("persists immutable plans and content-addressed snapshots privately", async () => {
    const root = await mkdtemp("/tmp/deskcompat-store-");
    const store = new TransactionStore(join(root, "state"));
    const before = snapshot();
    const plan = await planFor(before);
    const savedAt = new Date("2026-01-01T00:01:00.000Z");
    const persisted = await store.savePlan(plan, binding, savedAt);
    expect(await store.loadPlan(plan.planId)).toEqual(persisted);
    expect(await store.savePlan(plan, binding, savedAt)).toEqual(persisted);
    expect(await store.savePlan(plan, binding, new Date("2026-01-01T00:02:00.000Z"))).toEqual(
      persisted,
    );

    const blob = await store.saveSnapshot(before);
    expect(await store.loadSnapshot(blob)).toEqual(before);
    expect((await lstat(store.root)).mode & 0o777).toBe(0o700);
    expect((await lstat(store.planPath(plan.planId))).mode & 0o777).toBe(0o600);
    expect((await lstat(join(store.blobsDirectory, `${blob}.json`))).mode & 0o777).toBe(0o600);
  });

  test("atomically preserves one immutable plan under concurrent distinct bindings", async () => {
    const root = await mkdtemp("/tmp/deskcompat-plan-race-");
    const store = new TransactionStore(join(root, "state"));
    const plan = await planFor(snapshot());
    const alternateBinding: PlanBinding = { ...binding, sessionDigest: "b".repeat(64) };
    const results = await Promise.allSettled([
      store.savePlan(plan, binding, new Date("2026-01-01T00:01:00.000Z")),
      store.savePlan(plan, alternateBinding, new Date("2026-01-01T00:01:00.000Z")),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejection = results.find(({ status }) => status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: { code: "PLAN_ALREADY_PERSISTED" },
    });
    const persisted = await store.loadPlan(plan.planId);
    const winner = results.find(({ status }) => status === "fulfilled");
    expect(winner).toMatchObject({ status: "fulfilled", value: persisted });
  });

  test("rejects symlink state roots and tampered artifacts", async () => {
    const root = await mkdtemp("/tmp/deskcompat-symlink-");
    const actual = join(root, "actual");
    await mkdir(actual);
    const linked = join(root, "linked");
    await symlink(actual, linked);
    await expect(new TransactionStore(join(linked, "child")).initialize()).rejects.toMatchObject({
      code: "SYMLINK_REFUSED",
    });

    const store = new TransactionStore(join(root, "valid"));
    const plan = await planFor(snapshot());
    await store.savePlan(plan, binding, new Date("2026-01-01T00:01:00.000Z"));
    const path = store.planPath(plan.planId);
    const artifact = JSON.parse(await readFile(path, "utf8"));
    artifact.binding.sessionDigest = "b".repeat(64);
    await writeFile(path, JSON.stringify(artifact), { mode: 0o600 });
    await chmod(path, 0o600);
    await expect(store.loadPlan(plan.planId)).rejects.toMatchObject({ code: "INTEGRITY_FAILURE" });
  });

  test("preserves a valid journal prefix across a torn final append", async () => {
    const root = await mkdtemp("/tmp/deskcompat-journal-");
    const store = new TransactionStore(join(root, "state"));
    const id = `tx_${"1".repeat(64)}`;
    const journal = new TransactionJournal(store, id, () => new Date("2026-01-01T00:00:00Z"));
    await journal.append({
      event: "transaction_started",
      mode: "apply",
      planId: `pln_${"2".repeat(64)}`,
    });
    await journal.append({ event: "transaction_state", status: "preparing" });
    expect((await journal.read()).map(({ sequence }) => sequence)).toEqual([1, 2]);

    await writeFile(store.journalPath(id), '{"partial":', { flag: "a" });
    expect((await journal.read()).map(({ sequence }) => sequence)).toEqual([1, 2]);
    await journal.append({ event: "transaction_state", status: "committed" });
    expect((await journal.read()).map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    expect(await readFile(store.journalPath(id), "utf8")).not.toContain("partial");
  });

  test("rejects corruption in a complete journal record", async () => {
    const root = await mkdtemp("/tmp/deskcompat-journal-corrupt-");
    const store = new TransactionStore(join(root, "state"));
    const id = `tx_${"3".repeat(64)}`;
    const journal = new TransactionJournal(store, id, () => new Date("2026-01-01T00:00:00Z"));
    await journal.append({
      event: "transaction_started",
      mode: "apply",
      planId: `pln_${"4".repeat(64)}`,
    });
    await writeFile(store.journalPath(id), "not-json\n", { flag: "a" });
    await writeFile(store.journalPath(id), '{"partial":', { flag: "a" });
    await expect(journal.read()).rejects.toMatchObject({ code: "JOURNAL_CORRUPT" });
  });

  test("rejects oversized private state before parsing", async () => {
    const root = await mkdtemp("/tmp/deskcompat-state-size-");
    const store = new TransactionStore(join(root, "state"));
    await store.initialize();
    await writeFile(store.ownershipPath, "{}", { mode: 0o600 });
    await truncate(store.ownershipPath, 16 * 1024 * 1024 + 1);
    await expect(store.readOwnership()).rejects.toMatchObject({ code: "INTEGRITY_FAILURE" });
  });

  test("rejects a transaction record whose embedded identity differs from its path", async () => {
    const root = await mkdtemp("/tmp/deskcompat-transaction-id-");
    const store = new TransactionStore(join(root, "state"));
    await store.initialize();
    const requestedId = `tx_${"5".repeat(64)}`;
    const embeddedId = `tx_${"6".repeat(64)}`;
    await writeFile(
      store.transactionPath(requestedId),
      JSON.stringify({
        apiVersion: "deskcompat.dev/transaction/v1alpha1",
        transactionId: embeddedId,
        mode: "apply",
        status: "preparing",
        planId: `pln_${"7".repeat(64)}`,
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        receipts: [],
        conflicts: [],
      }),
      { mode: 0o600 },
    );
    await expect(store.loadTransaction(requestedId)).rejects.toMatchObject({
      code: "INTEGRITY_FAILURE",
    });
  });
});

describe("mutation lock", () => {
  test("refuses a live owner and replaces a stale owner", async () => {
    const root = await mkdtemp("/tmp/deskcompat-lock-");
    const store = new TransactionStore(join(root, "state"));
    const identity = { pid: 123, bootId: "boot", processStartTime: "456" };
    let existingAlive = true;
    const runtime: LockRuntime = {
      owner: async () => identity,
      isAlive: async (_owner: LockOwner) => existingAlive,
      now: () => new Date("2026-01-01T00:00:00Z"),
    };
    const first = await acquireMutationLock(store, runtime);
    await expect(acquireMutationLock(store, runtime)).rejects.toMatchObject({
      code: "ACTIVE_TRANSACTION",
    });
    existingAlive = false;
    const replacement = await acquireMutationLock(store, runtime);
    expect(replacement.owner.lockId).not.toBe(first.owner.lockId);
    await replacement.release();
  });
});
