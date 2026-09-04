export interface CommandSpec {
  readonly executable: string;
  readonly args: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunner {
  run(spec: CommandSpec): Promise<CommandResult>;
}

export interface CommandEnvironment {
  readonly dbusSessionBusAddress?: string;
  readonly home?: string;
  readonly xdgConfigHome?: string;
  readonly xdgDataHome?: string;
  readonly xdgDataDirs?: string;
  readonly xdgRuntimeDir?: string;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const FORCE_KILL_GRACE_MS = 1_000;

export function captureCommandEnvironment(environment: NodeJS.ProcessEnv): CommandEnvironment {
  return {
    ...(environment.DBUS_SESSION_BUS_ADDRESS === undefined
      ? {}
      : { dbusSessionBusAddress: environment.DBUS_SESSION_BUS_ADDRESS }),
    ...(environment.HOME === undefined ? {} : { home: environment.HOME }),
    ...(environment.XDG_CONFIG_HOME === undefined
      ? {}
      : { xdgConfigHome: environment.XDG_CONFIG_HOME }),
    ...(environment.XDG_DATA_HOME === undefined ? {} : { xdgDataHome: environment.XDG_DATA_HOME }),
    ...(environment.XDG_DATA_DIRS === undefined ? {} : { xdgDataDirs: environment.XDG_DATA_DIRS }),
    ...(environment.XDG_RUNTIME_DIR === undefined
      ? {}
      : { xdgRuntimeDir: environment.XDG_RUNTIME_DIR }),
  };
}

function childEnvironment(environment: CommandEnvironment): Record<string, string> {
  return {
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    ...(environment.dbusSessionBusAddress === undefined
      ? {}
      : { DBUS_SESSION_BUS_ADDRESS: environment.dbusSessionBusAddress }),
    ...(environment.home === undefined ? {} : { HOME: environment.home }),
    ...(environment.xdgConfigHome === undefined
      ? {}
      : { XDG_CONFIG_HOME: environment.xdgConfigHome }),
    ...(environment.xdgDataHome === undefined ? {} : { XDG_DATA_HOME: environment.xdgDataHome }),
    ...(environment.xdgDataDirs === undefined ? {} : { XDG_DATA_DIRS: environment.xdgDataDirs }),
    ...(environment.xdgRuntimeDir === undefined
      ? {}
      : { XDG_RUNTIME_DIR: environment.xdgRuntimeDir }),
  };
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  onLimit: () => void,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        onLimit();
        throw new Error("COMMAND_OUTPUT_LIMIT_EXCEEDED");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
}

/**
 * @constraint This generic process primitive is private to the Ubuntu GNOME adapter.
 * Product modules and future privileged helpers must use closed, typed operations and
 * must not export it through their public package surfaces.
 */
export class BunCommandRunner implements CommandRunner {
  constructor(
    private readonly environment: CommandEnvironment = captureCommandEnvironment(process.env),
  ) {}

  async run(spec: CommandSpec): Promise<CommandResult> {
    if (!spec.executable.startsWith("/")) {
      throw new TypeError("Command executable must be an absolute path");
    }

    const child = Bun.spawn([spec.executable, ...spec.args], {
      env: childEnvironment(this.environment),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const outputLimit = spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const terminate = (): void => child.kill(15);
    const forceTerminate = (): void => child.kill(9);
    const timeout = setTimeout(terminate, timeoutMs);
    const forceKillTimeout = setTimeout(forceTerminate, timeoutMs + FORCE_KILL_GRACE_MS);

    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        readBounded(child.stdout, outputLimit, forceTerminate),
        readBounded(child.stderr, outputLimit, forceTerminate),
      ]);
      return { exitCode, stdout, stderr };
    } finally {
      clearTimeout(timeout);
      clearTimeout(forceKillTimeout);
    }
  }
}
