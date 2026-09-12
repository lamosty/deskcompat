import { describe, expect, test } from "bun:test";
import {
  planFactsDigest,
  planIncludesInputCapabilities,
  selectedProfileDigest,
} from "../../packages/core/src/index.ts";
import type { HostFacts, Profile } from "../../packages/schema/src/index.ts";

const profile: Profile = {
  apiVersion: "deskcompat.dev/v1alpha1",
  kind: "Profile",
  metadata: { name: "fixture" },
  spec: {
    modules: {
      windowControls: { state: "managed", preset: "macos-standard" },
      keyboard: { state: "unmanaged", preset: "macos-pc" },
    },
  },
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
    { id: "gsettings", available: true },
    { id: "dconf", available: true },
    { id: "session-bus", available: true },
  ],
  conflicts: [],
};

describe("planner fingerprints", () => {
  test("normalizes capability ordering", () => {
    expect(planFactsDigest(facts, false)).toBe(
      planFactsDigest({ ...facts, capabilities: [...facts.capabilities].reverse() }, false),
    );
  });

  test("binds only selected profile intent", () => {
    expect(selectedProfileDigest(profile, ["windowControls"])).toBe(
      selectedProfileDigest(
        {
          ...profile,
          metadata: { name: "different-display-name" },
          spec: {
            modules: {
              ...profile.spec.modules,
              keyboard: { state: "managed", preset: "macos-pc" },
            },
          },
        },
        ["windowControls"],
      ),
    );
  });

  test("includes input facts only for a selected managed keyboard", () => {
    expect(planIncludesInputCapabilities(profile, ["windowControls"])).toBe(false);
    expect(planIncludesInputCapabilities(profile, ["keyboard"])).toBe(false);
    expect(
      planIncludesInputCapabilities(
        {
          ...profile,
          spec: {
            modules: {
              ...profile.spec.modules,
              keyboard: { state: "managed", preset: "macos-pc" },
            },
          },
        },
        ["keyboard"],
      ),
    ).toBe(true);
  });
});
