import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { apply, loadPlanFile, localPlanBinding } from "../../apps/cli/src/commands/apply.ts";
import { DESKCOMPAT_VERSION } from "../../apps/cli/src/version.ts";
import {
  buildPlan,
  sha256,
  type TransactionDriver,
  TransactionStore,
} from "../../packages/core/src/index.ts";
import type {
  GSettingsSnapshot,
  HostFacts,
  PlanBinding,
  Profile,
} from "../../packages/schema/src/index.ts";
import {
  GSETTINGS_TARGETS,
  observedToGSettingsSnapshot,
} from "../../packages/ubuntu-gnome/src/index.ts";

const resourceId = "gsettings:org.gnome.desktop.wm.preferences:button-layout" as const;
const target = GSETTINGS_TARGETS[resourceId];
const profile: Profile = {
  apiVersion: "deskcompat.dev/v1alpha1",
  kind: "Profile",
  metadata: { name: "cli-lifecycle-test" },
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
    { id: "gnome-shell", available: true },
    { id: "session-bus", available: true },
  ],
  conflicts: [],
};
const observed = (() => {
  const semantic = {
    domain: "deskcompat.gsettings-observation.v1",
    resourceId,
    status: "inherited" as const,
    effectiveRaw: "'close,minimize,maximize:'",
    effective: { type: "string" as const, value: "close,minimize,maximize:" },
    writable: true,
  };
  const { domain: _, resourceId: __, ...publicValue } = semantic;
  return { ...publicValue, digest: sha256(semantic) };
})();
const before = observedToGSettingsSnapshot(resourceId, observed);

class MemoryDriver implements TransactionDriver {
  readonly calls: string[] = [];
  private current: GSettingsSnapshot;

  constructor(snapshot: GSettingsSnapshot) {
    this.current = snapshot;
  }

  async inspect(id: typeof resourceId): Promise<GSettingsSnapshot> {
    this.calls.push(`inspect:${id}`);
    return this.current;
  }

  async apply(): Promise<{ beforeDigest: string }> {
    throw new Error("adoption fixture must not mutate");
  }

  async restore(
    _id: typeof resourceId,
    _snapshot: GSettingsSnapshot,
    _expectedCurrentDigest: string,
  ): Promise<{ beforeDigest: string }> {
    throw new Error("adoption fixture must not restore");
  }
}

async function adoptionPlan(toolVersion = DESKCOMPAT_VERSION) {
  return buildPlan({
    profile,
    facts,
    desiredSettings: [
      {
        moduleId: "windowControls",
        target,
        desired: { type: "string", value: "close,minimize,maximize:" },
        risk: "low",
      },
    ],
    selectedModules: ["windowControls"],
    inspector: { inspect: async () => observed },
    supportDiagnostics: [],
    toolVersion,
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
}

describe("CLI transaction lifecycle", () => {
  test("binds equivalent clients of the same session consistently", () => {
    const base = {
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/test/bus",
      XDG_RUNTIME_DIR: "/run/user/test",
    };
    expect(localPlanBinding(base)).toEqual(
      localPlanBinding({ ...base, WAYLAND_DISPLAY: "wayland-0" }),
    );
  });

  test("loads the CLI plan envelope and applies an adoption without live commands", async () => {
    const root = await mkdtemp("/tmp/deskcompat-cli-");
    try {
      const plan = await adoptionPlan();
      const planPath = join(root, "plan.json");
      await writeFile(
        planPath,
        JSON.stringify({
          apiVersion: "deskcompat.dev/cli/v1alpha1",
          ok: true,
          command: "plan",
          data: plan,
          diagnostics: [],
        }),
        { mode: 0o600 },
      );
      expect(await loadPlanFile(planPath)).toEqual(plan);

      const store = new TransactionStore(join(root, "state"));
      const driver = new MemoryDriver(before);
      const binding: PlanBinding = localPlanBinding({
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/test/bus",
        WAYLAND_DISPLAY: "wayland-test",
        XDG_RUNTIME_DIR: "/run/user/test",
      });
      const transaction = await apply(planPath, {
        store,
        driver,
        facts,
        binding,
        now: () => new Date("2026-01-01T00:00:30.000Z"),
      });

      expect(transaction.ok).toBe(true);
      expect(transaction.data?.status).toBe("committed");
      expect(transaction.data?.receipts[0]?.action).toBe("adopt");
      expect(driver.calls.every((call) => call.startsWith("inspect:"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refuses symlinked plan files and plans made by another tool version", async () => {
    const root = await mkdtemp("/tmp/deskcompat-cli-");
    try {
      const plan = await adoptionPlan();
      const actualPath = join(root, "actual.json");
      const symlinkPath = join(root, "plan.json");
      await writeFile(actualPath, JSON.stringify(plan), { mode: 0o600 });
      await symlink(actualPath, symlinkPath);
      await expect(loadPlanFile(symlinkPath)).rejects.toMatchObject({
        code: "PLAN_FILE_UNREADABLE",
      });

      const oldVersionPath = join(root, "old.json");
      await writeFile(oldVersionPath, JSON.stringify(await adoptionPlan("deskcompat-old")), {
        mode: 0o600,
      });
      await expect(loadPlanFile(oldVersionPath)).rejects.toMatchObject({
        code: "PLAN_TOOL_VERSION_UNSUPPORTED",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refuses plan input beyond its fixed read bound", async () => {
    const root = await mkdtemp("/tmp/deskcompat-cli-");
    try {
      const oversizedPath = join(root, "oversized.json");
      await writeFile(oversizedPath, " ".repeat(1_024 * 1_024 + 1), { mode: 0o600 });
      await expect(loadPlanFile(oversizedPath)).rejects.toMatchObject({
        code: "PLAN_FILE_UNREADABLE",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
