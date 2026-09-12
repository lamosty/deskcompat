import {
  HostFactsSchema,
  type Capability,
  type Diagnostic,
  type HostFacts,
} from "@deskcompat/schema";
import { parseOsRelease } from "./os-release.ts";
import type { PlatformRuntime } from "./runtime.ts";

const EXECUTABLES = {
  gsettings: "/usr/bin/gsettings",
  dconf: "/usr/bin/dconf",
  "gnome-shell": "/usr/bin/gnome-shell",
  keyd: "/usr/local/bin/keyd",
  xremap: "/usr/local/bin/xremap",
  "input-remapper": "/usr/bin/input-remapper-control",
} as const;

const KNOWN_RESIDUAL_PATHS = ["/etc/udev/rules.d/99-xremap.rules"] as const;
const compareText = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

function desktopName(value: string | undefined): "gnome" | "other" | "unknown" {
  if (value?.toLowerCase().split(":").includes("gnome")) return "gnome";
  return value ? "other" : "unknown";
}

async function inspectDesktopName(
  runtime: PlatformRuntime,
  declaredDesktop: string | undefined,
  hasGnomeShell: boolean,
  hasSessionBus: boolean,
): Promise<"gnome" | "other" | "unknown"> {
  const declared = desktopName(declaredDesktop);
  if (declared !== "unknown" || !hasGnomeShell || !hasSessionBus) return declared;
  if (!(await runtime.exists("/usr/bin/gdbus"))) return "unknown";

  try {
    // @decision Some valid logind graphical sessions omit the Desktop property.
    // A successful Peer.Ping to the well-known GNOME Shell bus name establishes the
    // active desktop without inspecting process arguments, environments, or windows.
    const result = await runtime.commandRunner.run({
      executable: "/usr/bin/gdbus",
      args: [
        "call",
        "--session",
        "--dest",
        "org.gnome.Shell",
        "--object-path",
        "/org/gnome/Shell",
        "--method",
        "org.freedesktop.DBus.Peer.Ping",
      ],
      maxOutputBytes: 256,
    });
    return result.exitCode === 0 ? "gnome" : "unknown";
  } catch {
    return "unknown";
  }
}

function sessionType(value: string | undefined): "wayland" | "x11" | "other" | "unknown" {
  if (value === "wayland" || value === "x11") return value;
  return value ? "other" : "unknown";
}

async function inspectGnomeVersion(runtime: PlatformRuntime, available: boolean): Promise<string> {
  if (!available) return "unknown";
  try {
    const result = await runtime.commandRunner.run({
      executable: EXECUTABLES["gnome-shell"],
      args: ["--version"],
    });
    if (result.exitCode !== 0) return "unknown";
    return result.stdout.match(/(\d+(?:\.\d+)+|\d+)/)?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function inspectHost(runtime: PlatformRuntime): Promise<HostFacts> {
  const osRelease = parseOsRelease((await runtime.readText("/etc/os-release", 64 * 1024)) ?? "");
  const session = await runtime.inspectSession();
  const capabilities: Capability[] = [];

  for (const [id, path] of Object.entries(EXECUTABLES)) {
    capabilities.push({ id: id as Capability["id"], available: await runtime.exists(path) });
  }
  capabilities.push({ id: "session-bus", available: session.hasSessionBus });
  capabilities.sort((left, right) => compareText(left.id, right.id));

  const hasCapability = (id: Capability["id"]): boolean =>
    capabilities.some((capability) => capability.id === id && capability.available);
  const activeDesktop = await inspectDesktopName(
    runtime,
    session.currentDesktop,
    hasCapability("gnome-shell"),
    hasCapability("session-bus"),
  );
  const conflicts: Diagnostic[] = [];

  if (hasCapability("xremap")) {
    conflicts.push({
      code: "REMAPPER_XREMAP_DETECTED",
      severity: "warning",
      subject: "input.remappers",
      reasonCode: "XREMAP_INSTALLED",
      message: "xremap is installed and could conflict with future input modules.",
      remediation: "Keep input modules unmanaged until the active remapper is understood.",
    });
  }
  if (hasCapability("input-remapper")) {
    conflicts.push({
      code: "REMAPPER_INPUT_REMAPPER_DETECTED",
      severity: "warning",
      subject: "input.remappers",
      reasonCode: "INPUT_REMAPPER_INSTALLED",
      message: "Input Remapper is installed and could conflict with future input modules.",
      remediation: "Keep input modules unmanaged until the active remapper is understood.",
    });
  }
  for (const path of KNOWN_RESIDUAL_PATHS) {
    if (await runtime.exists(path)) {
      conflicts.push({
        code: "REMAPPER_RESIDUAL_RULE_DETECTED",
        severity: "warning",
        subject: "input.remappers",
        reasonCode: "XREMAP_RULE_PRESENT",
        message: "A rule associated with another input remapper is present.",
        remediation: "Review it manually; DeskCompat will not remove it automatically.",
      });
    }
  }
  conflicts.sort((left, right) => compareText(left.code, right.code));

  return HostFactsSchema.parse({
    platform: {
      osId: osRelease.ID === undefined ? "unknown" : osRelease.ID === "ubuntu" ? "ubuntu" : "other",
      osVersion:
        osRelease.VERSION_ID === undefined
          ? "unknown"
          : osRelease.VERSION_ID === "24.04"
            ? "24.04"
            : "other",
      desktop: activeDesktop,
      desktopVersion: await inspectGnomeVersion(runtime, hasCapability("gnome-shell")),
      sessionType: sessionType(session.sessionType),
    },
    capabilities,
    conflicts,
  });
}
