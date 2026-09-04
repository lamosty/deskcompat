import type { CliResult, Profile } from "@deskcompat/schema";
import { result } from "../output/render.ts";
import { selectedProfile } from "./profile.ts";

export async function validateProfile(path?: string): Promise<CliResult<Profile>> {
  const profile = await selectedProfile(path);
  return result("profile validate", profile, []);
}
