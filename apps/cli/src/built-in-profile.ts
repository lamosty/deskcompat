import { ProfileSchema, type Profile } from "@deskcompat/schema";
import profileDocument from "../../../profiles/macos-essentials.toml";

// @decision The compiled CLI imports the checked-in profile so documentation,
// source execution, and standalone builds cannot silently drift apart.
export const macosEssentialsProfile: Profile = ProfileSchema.parse(profileDocument);
