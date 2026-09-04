import type { Diagnostic, HostFacts } from "@deskcompat/schema";

function majorVersion(version: string): number | undefined {
  const match = version.match(/^(\d+)/);
  return match ? Number(match[1]) : undefined;
}

export function evaluateSupport(facts: HostFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const capability = (id: HostFacts["capabilities"][number]["id"]): boolean =>
    facts.capabilities.some((entry) => entry.id === id && entry.available);

  if (facts.platform.osId !== "ubuntu" || facts.platform.osVersion !== "24.04") {
    diagnostics.push({
      code: "UNSUPPORTED_OPERATING_SYSTEM",
      severity: "blocker",
      subject: "host.platform",
      reasonCode: "OS_OR_VERSION_MISMATCH",
      message: "This build supports Ubuntu 24.04 only.",
    });
  }
  if (facts.platform.desktop === "unknown" || facts.platform.desktopVersion === "unknown") {
    diagnostics.push({
      code: "DESKTOP_CONTEXT_UNAVAILABLE",
      severity: "blocker",
      subject: "host.desktop",
      reasonCode: "GRAPHICAL_CONTEXT_MISSING",
      message: "GNOME desktop context could not be established.",
      remediation: "Run DeskCompat inside the graphical GNOME session being inspected.",
    });
  } else if (
    facts.platform.desktop !== "gnome" ||
    majorVersion(facts.platform.desktopVersion) !== 46
  ) {
    diagnostics.push({
      code: "UNSUPPORTED_DESKTOP",
      severity: "blocker",
      subject: "host.desktop",
      reasonCode: "DESKTOP_OR_VERSION_MISMATCH",
      message: "This build supports GNOME 46 only.",
    });
  }
  if (facts.platform.sessionType === "unknown") {
    diagnostics.push({
      code: "SESSION_CONTEXT_UNAVAILABLE",
      severity: "blocker",
      subject: "host.session",
      reasonCode: "GRAPHICAL_CONTEXT_MISSING",
      message: "The active graphical session context could not be established.",
      remediation: "Run DeskCompat inside the graphical GNOME Wayland session.",
    });
  } else if (facts.platform.sessionType !== "wayland") {
    diagnostics.push({
      code: "UNSUPPORTED_SESSION",
      severity: "blocker",
      subject: "host.session",
      reasonCode: "SESSION_MISMATCH",
      message: "This build supports Wayland sessions only.",
    });
  }
  if (!capability("gsettings") || !capability("dconf")) {
    diagnostics.push({
      code: "GNOME_SETTINGS_TOOLS_MISSING",
      severity: "blocker",
      subject: "host.capabilities",
      reasonCode: "REQUIRED_TOOL_MISSING",
      message: "The required GNOME settings tools are unavailable.",
    });
  }
  if (!capability("session-bus")) {
    diagnostics.push({
      code: "SESSION_BUS_UNAVAILABLE",
      severity: "blocker",
      subject: "host.capabilities",
      reasonCode: "DBUS_SESSION_MISSING",
      message: "The graphical session bus is unavailable.",
      remediation: "Run DeskCompat from a terminal or agent attached to the graphical session.",
    });
  }

  return diagnostics.sort((left, right) =>
    left.code === right.code ? 0 : left.code < right.code ? -1 : 1,
  );
}
