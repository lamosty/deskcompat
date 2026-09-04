import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProfile } from "../../packages/core/src/profile-loader.ts";

let fixtureDirectory = "";

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "deskcompat-profile-test-"));
});

afterAll(async () => {
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
});

describe("loadProfile", () => {
  test("reads and validates a bounded regular TOML file", async () => {
    const path = join(fixtureDirectory, "valid.toml");
    await writeFile(
      path,
      `apiVersion = "deskcompat.dev/v1alpha1"
kind = "Profile"
[metadata]
name = "fixture"
[spec.modules.windowControls]
state = "managed"
preset = "macos-standard"
`,
    );
    expect(await loadProfile(path)).toMatchObject({ metadata: { name: "fixture" } });
  });

  test("rejects symbolic links and non-regular files", async () => {
    const target = join(fixtureDirectory, "target.toml");
    const link = join(fixtureDirectory, "link.toml");
    const directory = join(fixtureDirectory, "directory.toml");
    await writeFile(target, "not relevant");
    await symlink(target, link);
    await mkdir(directory);

    await expect(loadProfile(link)).rejects.toMatchObject({ code: "PROFILE_NOT_REGULAR" });
    await expect(loadProfile(directory)).rejects.toMatchObject({ code: "PROFILE_NOT_REGULAR" });
  });

  test("rejects input larger than the fixed limit", async () => {
    const path = join(fixtureDirectory, "large.toml");
    await writeFile(path, "x".repeat(64 * 1024 + 1));
    await expect(loadProfile(path)).rejects.toMatchObject({ code: "PROFILE_TOO_LARGE" });
  });
});
