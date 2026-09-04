import { describe, expect, test } from "bun:test";
import { ProfileSchema } from "../../packages/schema/src/profile.ts";

const validProfile = ProfileSchema.parse({
  apiVersion: "deskcompat.dev/v1alpha1",
  kind: "Profile",
  metadata: { name: "test-profile" },
  spec: {
    modules: {
      workspaces: { state: "managed", count: 4, allMonitors: true },
      windowControls: { state: "unmanaged" },
    },
  },
});

describe("ProfileSchema", () => {
  test("accepts a bounded declarative profile", () => {
    expect(ProfileSchema.parse(validProfile)).toEqual(validProfile);
  });

  test("requires managed module values", () => {
    const candidate = {
      ...validProfile,
      spec: {
        modules: { ...validProfile.spec.modules, workspaces: { state: "managed" } },
      },
    };
    expect(ProfileSchema.safeParse(candidate).success).toBe(false);
  });

  test("rejects executable or unknown profile fields", () => {
    const candidate = { ...validProfile, run: "arbitrary-command" };
    expect(ProfileSchema.safeParse(candidate).success).toBe(false);
  });

  test("bounds workspace count", () => {
    const candidate = {
      ...validProfile,
      spec: {
        modules: {
          ...validProfile.spec.modules,
          workspaces: { state: "managed", count: 37, allMonitors: true },
        },
      },
    };
    expect(ProfileSchema.safeParse(candidate).success).toBe(false);
  });
});
