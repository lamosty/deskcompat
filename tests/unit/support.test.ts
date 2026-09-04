import { describe, expect, test } from "bun:test";
import type { HostFacts } from "../../packages/schema/src/facts.ts";
import { evaluateSupport } from "../../packages/ubuntu-gnome/src/platform/support.ts";

const supportedFacts: HostFacts = {
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

describe("evaluateSupport", () => {
  test("accepts the exact tested platform", () => {
    expect(evaluateSupport(supportedFacts)).toEqual([]);
  });

  test("blocks an untested platform without guessing", () => {
    const facts: HostFacts = {
      ...supportedFacts,
      platform: { ...supportedFacts.platform, osVersion: "other", sessionType: "x11" },
    };
    expect(evaluateSupport(facts).map(({ code }) => code)).toEqual([
      "UNSUPPORTED_OPERATING_SYSTEM",
      "UNSUPPORTED_SESSION",
    ]);
  });
});
