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
  readonly commandRunner: CommandRunner;
  inspectSession(): Promise<SessionEnvironment>;
  readText(path: string, maximumBytes: number): Promise<string | undefined>;
  exists(path: string): Promise<boolean>;
}

export class LivePlatformRuntime implements PlatformRuntime {
  readonly commandRunner: CommandRunner;
  private readonly environmentSession: SessionEnvironment;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.environmentSession = {
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

  async inspectSession(): Promise<SessionEnvironment> {
    const session = this.environmentSession;
    if (session.currentDesktop !== undefined && session.sessionType !== undefined) {
      return session;
    }
    if (!(await this.exists("/usr/bin/loginctl"))) return session;

    try {
      // @decision Local agents and user services often retain the graphical D-Bus
      // address but not XDG_CURRENT_DESKTOP/XDG_SESSION_TYPE. Query only the invoking
      // UID's active display session and reduce it to categorical facts. We never
      // enumerate sessions or expose the session ID, username, leader, or seat.
      const uid = process.getuid?.();
      if (uid === undefined) return session;
      const display = await this.commandRunner.run({
        executable: "/usr/bin/loginctl",
        args: ["show-user", String(uid), "--property=Display", "--value"],
        maxOutputBytes: 256,
      });
      const sessionId = display.stdout.trim();
      if (display.exitCode !== 0 || !/^[A-Za-z0-9_.-]{1,64}$/.test(sessionId)) return session;

      const details = await this.commandRunner.run({
        executable: "/usr/bin/loginctl",
        args: [
          "show-session",
          sessionId,
          "--property=Desktop",
          "--property=Type",
          "--property=Class",
          "--property=State",
          "--property=Remote",
          "--no-pager",
        ],
        maxOutputBytes: 2 * 1024,
      });
      if (details.exitCode !== 0) return session;
      const properties = new Map(
        details.stdout
          .split(/\r?\n/)
          .map((line) => line.split("=", 2) as [string, string])
          .filter(([key, value]) => key.length > 0 && value !== undefined),
      );
      if (
        properties.get("Class") !== "user" ||
        properties.get("State") !== "active" ||
        properties.get("Remote") !== "no"
      ) {
        return session;
      }

      const currentDesktop = properties.get("Desktop");
      const sessionType = properties.get("Type");
      return {
        ...session,
        ...(session.currentDesktop !== undefined || !currentDesktop
          ? {}
          : { currentDesktop }),
        ...(session.sessionType !== undefined || !sessionType ? {} : { sessionType }),
      };
    } catch {
      return session;
    }
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
