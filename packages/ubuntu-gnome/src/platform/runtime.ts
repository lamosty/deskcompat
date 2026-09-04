import {
  BunCommandRunner,
  captureCommandEnvironment,
  type CommandRunner,
} from "../internal/command-runner.ts";

export interface SessionEnvironment {
  readonly currentDesktop?: string;
  readonly sessionType?: string;
  readonly hasSessionBus: boolean;
}

export interface PlatformRuntime {
  readonly session: SessionEnvironment;
  readonly commandRunner: CommandRunner;
  readText(path: string, maximumBytes: number): Promise<string | undefined>;
  exists(path: string): Promise<boolean>;
}

export class LivePlatformRuntime implements PlatformRuntime {
  readonly session: SessionEnvironment;
  readonly commandRunner: CommandRunner;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.session = {
      hasSessionBus: Boolean(environment.DBUS_SESSION_BUS_ADDRESS),
      ...(environment.XDG_CURRENT_DESKTOP === undefined
        ? {}
        : { currentDesktop: environment.XDG_CURRENT_DESKTOP }),
      ...(environment.XDG_SESSION_TYPE === undefined
        ? {}
        : { sessionType: environment.XDG_SESSION_TYPE }),
    };
    this.commandRunner = new BunCommandRunner(captureCommandEnvironment(environment));
  }

  async readText(path: string, maximumBytes: number): Promise<string | undefined> {
    const file = Bun.file(path);
    if (!(await file.exists()) || file.size > maximumBytes) return undefined;
    return file.text();
  }

  async exists(path: string): Promise<boolean> {
    return Bun.file(path).exists();
  }
}
