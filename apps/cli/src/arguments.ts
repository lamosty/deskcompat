import type { ModuleId } from "@deskcompat/schema";

const MODULE_IDS = new Set<ModuleId>(["workspaces", "windowControls", "keyboard"]);

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export interface ParsedArguments {
  readonly command: "doctor" | "profile-validate" | "plan" | "help" | "version";
  readonly json: boolean;
  readonly profilePath?: string;
  readonly only?: ReadonlySet<ModuleId>;
}

function optionValue(args: readonly string[], index: number, name: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new CliUsageError(`${name} requires a value`);
  }
  return value;
}

export function parseArguments(args: readonly string[]): ParsedArguments {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return { command: "help", json: args.includes("--json") };
  }
  if (args.includes("--version") || args.includes("-V")) {
    return { command: "version", json: args.includes("--json") };
  }

  let command: ParsedArguments["command"];
  let cursor: number;
  if (args[0] === "doctor" || args[0] === "plan") {
    command = args[0];
    cursor = 1;
  } else if (args[0] === "profile" && args[1] === "validate") {
    command = "profile-validate";
    cursor = 2;
  } else {
    throw new CliUsageError("Unknown command");
  }

  let json = false;
  let profilePath: string | undefined;
  let only: ReadonlySet<ModuleId> | undefined;

  while (cursor < args.length) {
    const argument = args[cursor];
    if (argument === "--json") {
      json = true;
      cursor += 1;
      continue;
    }
    if (argument === "--profile") {
      profilePath = optionValue(args, cursor, "--profile");
      cursor += 2;
      continue;
    }
    if (argument === "--only") {
      const requested = optionValue(args, cursor, "--only").split(",");
      if (requested.length === 0 || requested.some((entry) => !MODULE_IDS.has(entry as ModuleId))) {
        throw new CliUsageError("--only contains an unknown module");
      }
      only = new Set(requested as ModuleId[]);
      cursor += 2;
      continue;
    }
    throw new CliUsageError("Unknown option");
  }

  if (command === "doctor" && (profilePath !== undefined || only !== undefined)) {
    throw new CliUsageError("doctor does not accept profile options");
  }
  if (command === "profile-validate" && only !== undefined) {
    throw new CliUsageError("profile validate does not accept --only");
  }

  return {
    command,
    json,
    ...(profilePath === undefined ? {} : { profilePath }),
    ...(only === undefined ? {} : { only }),
  };
}
