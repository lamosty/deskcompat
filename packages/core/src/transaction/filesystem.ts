import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { canonicalJson } from "../canonical-json.ts";
import { TransactionError } from "./errors.ts";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_PRIVATE_FILE_BYTES = 16 * 1024 * 1024;

async function missing(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

export async function refuseSymlink(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      throw new TransactionError("SYMLINK_REFUSED", "Refusing a symbolic-link state path");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * Validate an existing DeskCompat directory without creating or repairing it. This
 * is used by planning/status paths so a nominally read-only command never creates
 * application state or silently changes permissions.
 */
export async function assertPrivateDirectory(path: string): Promise<void> {
  if (!isAbsolute(path)) {
    throw new TransactionError("INVALID_STATE_PATH", "State paths must be absolute");
  }
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const component of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    await refuseSymlink(current);
  }
  const stat = await lstat(absolute);
  if (!stat.isDirectory()) {
    throw new TransactionError("INVALID_STATE_PATH", "Expected a state directory");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new TransactionError("INVALID_STATE_PATH", "State directory has an unexpected owner");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new TransactionError("INVALID_STATE_PATH", "State directory permissions are too broad");
  }
}

export async function ensurePrivateDirectory(path: string): Promise<void> {
  if (!isAbsolute(path)) {
    throw new TransactionError("INVALID_STATE_PATH", "State paths must be absolute");
  }
  // @constraint Walk components rather than using recursive mkdir, which could follow
  // a symlinked ancestor before the final-path check gets a chance to reject it.
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const component of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    await refuseSymlink(current);
    if (await missing(current)) {
      try {
        await mkdir(current, { mode: current === absolute ? DIRECTORY_MODE : 0o755 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    await refuseSymlink(current);
  }
  await refuseSymlink(path);
  const stat = await lstat(path);
  if (!stat.isDirectory()) {
    throw new TransactionError("INVALID_STATE_PATH", "Expected a state directory");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new TransactionError("INVALID_STATE_PATH", "State directory has an unexpected owner");
  }
  if ((stat.mode & 0o077) !== 0) await chmod(path, DIRECTORY_MODE);
}

export async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * @decision State replacement uses a same-directory temporary file, file fsync,
 * rename, and directory fsync. The containing directory is private and symlinks at
 * every DeskCompat-owned component are refused before use.
 */
export async function atomicWritePrivateFile(path: string, contents: string): Promise<void> {
  const parent = dirname(path);
  await ensurePrivateDirectory(parent);
  await refuseSymlink(path);
  const temporary = join(
    parent,
    `.${basename(path)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  const handle = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    FILE_MODE,
  );
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await refuseSymlink(path);
    await rename(temporary, path);
    await fsyncDirectory(parent);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function atomicWritePrivateJson(path: string, value: unknown): Promise<void> {
  await atomicWritePrivateFile(path, `${canonicalJson(value)}\n`);
}

/**
 * Create an immutable artifact without ever exposing a partially written target.
 * The temporary file is complete and durable before an atomic same-directory hard
 * link publishes it. A competing creator wins with EEXIST rather than being
 * overwritten.
 */
export async function atomicCreatePrivateFile(path: string, contents: string): Promise<boolean> {
  const parent = dirname(path);
  await ensurePrivateDirectory(parent);
  await refuseSymlink(path);
  const temporary = join(
    parent,
    `.${basename(path)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  const handle = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    FILE_MODE,
  );
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await handle.close();

  try {
    await link(temporary, path);
    await unlink(temporary);
    await fsyncDirectory(parent);
    return true;
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

export async function atomicCreatePrivateJson(path: string, value: unknown): Promise<boolean> {
  return atomicCreatePrivateFile(path, `${canonicalJson(value)}\n`);
}

export async function readPrivateFile(path: string): Promise<string> {
  await assertPrivateDirectory(dirname(path));
  await refuseSymlink(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new TransactionError("INVALID_STATE_PATH", "Expected a regular state file");
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new TransactionError("INVALID_STATE_PATH", "State file permissions are too broad");
    }
    if (stat.size > MAX_PRIVATE_FILE_BYTES) {
      throw new TransactionError("INTEGRITY_FAILURE", "Persisted state file exceeds size limit");
    }

    // @constraint Read at most one byte beyond the limit from the already-opened
    // descriptor, so a concurrently growing file cannot force an unbounded allocation.
    const chunks: Buffer[] = [];
    let position = 0;
    while (position <= MAX_PRIVATE_FILE_BYTES) {
      const remaining = MAX_PRIVATE_FILE_BYTES + 1 - position;
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (position > MAX_PRIVATE_FILE_BYTES) {
      throw new TransactionError("INTEGRITY_FAILURE", "Persisted state file exceeds size limit");
    }
    return Buffer.concat(chunks, position).toString("utf8");
  } finally {
    await handle.close();
  }
}

export async function readPrivateJson(path: string): Promise<unknown> {
  const raw = await readPrivateFile(path);
  try {
    return JSON.parse(raw);
  } catch {
    throw new TransactionError("INTEGRITY_FAILURE", "Persisted JSON is invalid");
  }
}

export async function pathExists(path: string): Promise<boolean> {
  return !(await missing(path));
}

export function resolveStateRoot(environment: NodeJS.ProcessEnv = process.env): string {
  const xdgStateHome = environment.XDG_STATE_HOME;
  if (xdgStateHome && isAbsolute(xdgStateHome)) return resolve(xdgStateHome, "deskcompat");
  const home = environment.HOME;
  if (!home || !isAbsolute(home)) {
    throw new TransactionError(
      "INVALID_STATE_PATH",
      "HOME must be an absolute path when XDG_STATE_HOME is unavailable",
    );
  }
  return resolve(home, ".local", "state", "deskcompat");
}
