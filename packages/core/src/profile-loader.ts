import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { ProfileSchema, type Profile } from "@deskcompat/schema";

const MAX_PROFILE_BYTES = 64 * 1024;

type ProfileLoadErrorCode =
  | "PROFILE_NOT_FOUND"
  | "PROFILE_NOT_REGULAR"
  | "PROFILE_TOO_LARGE"
  | "PROFILE_READ_FAILED"
  | "PROFILE_INVALID";

export class ProfileLoadError extends Error {
  constructor(
    readonly code: ProfileLoadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProfileLoadError";
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

/**
 * @constraint Profiles may come from agents or untrusted repositories. Open with
 * O_NOFOLLOW and O_NONBLOCK, verify a regular file after opening, and bound the read
 * itself rather than trusting path metadata before a separate read.
 */
async function readBoundedRegularFile(path: string): Promise<string> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") {
      throw new ProfileLoadError("PROFILE_NOT_FOUND", "Profile file was not found");
    }
    if (code === "ELOOP") {
      throw new ProfileLoadError("PROFILE_NOT_REGULAR", "Profile must not be a symbolic link");
    }
    throw new ProfileLoadError("PROFILE_READ_FAILED", "Profile file could not be opened safely");
  }

  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new ProfileLoadError("PROFILE_NOT_REGULAR", "Profile must be a regular file");
    }
    if (metadata.size > MAX_PROFILE_BYTES) {
      throw new ProfileLoadError("PROFILE_TOO_LARGE", "Profile exceeds the 64 KiB limit");
    }

    const buffer = Buffer.alloc(MAX_PROFILE_BYTES + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_PROFILE_BYTES) {
      throw new ProfileLoadError("PROFILE_TOO_LARGE", "Profile exceeds the 64 KiB limit");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset));
  } catch (error) {
    if (error instanceof ProfileLoadError) throw error;
    throw new ProfileLoadError("PROFILE_READ_FAILED", "Profile file could not be read safely");
  } finally {
    await handle.close();
  }
}

export async function loadProfile(path: string): Promise<Profile> {
  try {
    return ProfileSchema.parse(Bun.TOML.parse(await readBoundedRegularFile(path)));
  } catch (error) {
    if (error instanceof ProfileLoadError) throw error;
    throw new ProfileLoadError("PROFILE_INVALID", "Profile is not valid DeskCompat TOML");
  }
}
