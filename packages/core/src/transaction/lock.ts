import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { type LockOwner, LockOwnerSchema } from "@deskcompat/schema";
import { sha256 } from "../canonical-json.ts";
import { TransactionError } from "./errors.ts";
import {
  atomicWritePrivateJson,
  fsyncDirectory,
  pathExists,
  readPrivateJson,
  refuseSymlink,
} from "./filesystem.ts";
import type { TransactionStore } from "./store.ts";

export interface LockRuntime {
  owner(): Promise<Omit<LockOwner, "acquiredAt" | "lockId">>;
  isAlive(owner: LockOwner): Promise<boolean>;
  now(): Date;
}

function processStartTime(stat: string): string | undefined {
  const closingParen = stat.lastIndexOf(")");
  if (closingParen < 0) return undefined;
  // Fields after comm start at proc field 3; starttime is field 22.
  return stat
    .slice(closingParen + 1)
    .trim()
    .split(/\s+/)[19];
}

export class LinuxLockRuntime implements LockRuntime {
  now(): Date {
    return new Date();
  }

  async owner(): Promise<Omit<LockOwner, "acquiredAt" | "lockId">> {
    const [bootIdRaw, stat] = await Promise.all([
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      readFile(`/proc/${process.pid}/stat`, "utf8"),
    ]);
    const start = processStartTime(stat);
    if (!start) throw new TransactionError("INTEGRITY_FAILURE", "Cannot read process identity");
    return { pid: process.pid, bootId: bootIdRaw.trim(), processStartTime: start };
  }

  async isAlive(owner: LockOwner): Promise<boolean> {
    try {
      const [bootIdRaw, stat] = await Promise.all([
        readFile("/proc/sys/kernel/random/boot_id", "utf8"),
        readFile(`/proc/${owner.pid}/stat`, "utf8"),
      ]);
      return bootIdRaw.trim() === owner.bootId && processStartTime(stat) === owner.processStartTime;
    } catch (error) {
      // Only a missing process proves that the owner is gone. Permission errors,
      // transient /proc failures, and malformed reads fail closed so a live lock is
      // never stolen merely because liveness could not be established.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      return true;
    }
  }
}

export interface MutationLock {
  readonly owner: LockOwner;
  release(): Promise<void>;
}

/**
 * @decision A fully populated temporary directory is renamed into place, so other
 * processes never observe an ownerless live lock. Stale owners are checked using boot
 * ID and process start time, preventing PID reuse from masquerading as the owner.
 */
export async function acquireMutationLock(
  store: TransactionStore,
  runtime: LockRuntime = new LinuxLockRuntime(),
): Promise<MutationLock> {
  await store.initialize();
  const lockPath = join(store.locksDirectory, "mutation.lock");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const identity = await runtime.owner();
    const owner = LockOwnerSchema.parse({
      ...identity,
      lockId: sha256({ identity, nonce: randomBytes(32).toString("hex") }),
      acquiredAt: runtime.now().toISOString(),
    });
    const temporary = join(
      store.locksDirectory,
      `.mutation.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
    );
    await mkdir(temporary, { mode: 0o700 });
    try {
      await atomicWritePrivateJson(join(temporary, "owner.json"), owner);
      try {
        await rename(temporary, lockPath);
        await fsyncDirectory(store.locksDirectory);
      } catch (error) {
        if (!new Set(["EEXIST", "ENOTEMPTY"]).has((error as NodeJS.ErrnoException).code ?? "")) {
          throw error;
        }
        await rm(temporary, { recursive: true, force: true });
        await refuseSymlink(lockPath);
        const existing = LockOwnerSchema.parse(await readPrivateJson(join(lockPath, "owner.json")));
        if (await runtime.isAlive(existing)) {
          throw new TransactionError(
            "ACTIVE_TRANSACTION",
            "Another mutating transaction is active",
          );
        }
        const stale = join(
          store.locksDirectory,
          `.stale.${existing.lockId}.${randomBytes(6).toString("hex")}`,
        );
        try {
          await rename(lockPath, stale);
          await fsyncDirectory(store.locksDirectory);
          await rm(stale, { recursive: true, force: true });
        } catch (staleError) {
          if ((staleError as NodeJS.ErrnoException).code !== "ENOENT") throw staleError;
        }
        continue;
      }

      return {
        owner,
        async release(): Promise<void> {
          await refuseSymlink(lockPath);
          if (!(await pathExists(lockPath))) return;
          const stat = await lstat(lockPath);
          if (!stat.isDirectory()) {
            throw new TransactionError("INVALID_STATE_PATH", "Mutation lock is not a directory");
          }
          const current = LockOwnerSchema.parse(
            await readPrivateJson(join(lockPath, "owner.json")),
          );
          if (current.lockId !== owner.lockId) {
            throw new TransactionError("ACTIVE_TRANSACTION", "Mutation lock ownership changed");
          }
          await rm(lockPath, { recursive: true });
          await fsyncDirectory(store.locksDirectory);
        },
      };
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }
  throw new TransactionError("ACTIVE_TRANSACTION", "Could not acquire the mutation lock");
}
