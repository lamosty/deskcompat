import { expect, test } from "bun:test";
import { macosEssentialsProfile } from "../../apps/cli/src/built-in-profile.ts";
import { loadProfile } from "../../packages/core/src/profile-loader.ts";

test("the packaged TOML profile is the compiled built-in profile", async () => {
  const path = new URL("../../profiles/macos-essentials.toml", import.meta.url).pathname;
  expect(await loadProfile(path)).toEqual(macosEssentialsProfile);
});
