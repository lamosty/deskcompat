import { describe, expect, test } from "bun:test";
import { ProfileSchema } from "../../packages/schema/src/profile.ts";
import { resolveProfile } from "../../packages/ubuntu-gnome/src/modules/registry.ts";

const profile = ProfileSchema.parse({
  apiVersion: "deskcompat.dev/v1alpha1",
  kind: "Profile",
  metadata: { name: "test" },
  spec: {
    modules: {
      workspaces: { state: "managed", count: 6, allMonitors: true },
      windowControls: { state: "managed", preset: "macos-standard" },
      keyboard: { state: "managed", preset: "macos-pc" },
    },
  },
});

describe("resolveProfile", () => {
  test("resolves portable intent to allowlisted resources", () => {
    const resolved = resolveProfile(profile, new Set(["workspaces"]));
    expect(resolved.desiredSettings).toHaveLength(3);
    expect(resolved.desiredSettings.map(({ target }) => target.schema)).toEqual([
      "org.gnome.mutter",
      "org.gnome.desktop.wm.preferences",
      "org.gnome.mutter",
    ]);
    expect(resolved.diagnostics).toEqual([]);
  });

  test("blocks the keyboard module until recovery exists", () => {
    const resolved = resolveProfile(profile, new Set(["keyboard"]));
    expect(resolved.desiredSettings).toEqual([]);
    expect(resolved.diagnostics.map(({ code }) => code)).toEqual([
      "KEYBOARD_MODULE_NOT_IMPLEMENTED",
    ]);
  });
});
