import { loadProfile } from "@deskcompat/core";
import type { Profile } from "@deskcompat/schema";
import { macosEssentialsProfile } from "../built-in-profile.ts";

export async function selectedProfile(path?: string): Promise<Profile> {
  return path === undefined ? macosEssentialsProfile : loadProfile(path);
}
