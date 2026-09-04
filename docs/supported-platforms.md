# Supported platforms

## Current project status

DeskCompat is an implementation-stage, read-only pre-alpha and has no released,
verified support matrix yet. The table below distinguishes the v0.1 target from
future candidates; it is not a claim that installation is currently safe.

## v0.1 target

| Component | Target | Status |
|---|---|---|
| Distribution | Ubuntu 24.04 LTS | Detection implemented; mutation unavailable |
| Desktop | GNOME 46 | Detection implemented; mutation unavailable |
| Session | Wayland | Detection implemented; mutation unavailable |
| Init/service manager | systemd | Future input milestone |
| Settings backend | GSettings/dconf | Read-only inspection implemented |
| Input backend | One audited, tested backend | Decision required before input implementation |
| Keyboard | Conventional PC keyboard; international/AltGr preservation must be tested | Planned for v0.1 |

A platform is supported only after clean-install, repeat-apply, revert, interrupted-
apply, reboot-recovery, and uninstall tests pass on that exact combination. “Likely to
work” is not a support tier.

## v0.1 module target

| Module | v0.1 intent |
|---|---|
| System inspection and conflict detection | Included |
| GNOME workspaces | Included |
| GNOME window controls | Included |
| macOS-style keyboard essentials | Included after protected input trials pass |
| Mouse side buttons and evdev daemon | Future |
| Dock and overview extensions | Future |
| Terminal-specific behaviour | Future unless the selected input backend provides it safely |
| [Kukni](https://github.com/lamosty/kukni) integration | Future, optional, separate project |
| Appearance/themes | Out of initial scope |

The built-in profile remains modular: users may leave any supported module unmanaged.

## Explicitly unsupported in v0.1

- X11 sessions.
- Ubuntu versions other than 24.04.
- GNOME major versions other than 46.
- Fedora, Debian, Arch, KDE Plasma, Hyprland, and other desktops.
- macOS or Windows as a host.
- Installing Ubuntu on Mac-specific hardware, including driver or firmware enablement.
- Headless systems, containers, remote graphical sessions, and multi-user kiosk setups.
- Arbitrary keyboard backends or simultaneous input remappers.
- GDM, GRUB, kernel, networking, SSH, display-manager, or login-screen changes.

Unsupported does not necessarily mean DeskCompat refuses all read-only inspection. It
means the planner must not emit mutating operations for that environment.

## Prerequisites

The current doctor verifies the platform and core settings tools. Before v0.1 is
complete it must verify the remaining input and service prerequisites rather than
assuming them:

- exact `/etc/os-release` identity and version;
- GNOME Shell version;
- an active Wayland graphical session for the invoking user;
- access to the correct session D-Bus and dconf database;
- required absolute-path executables and compatible versions;
- availability of systemd and the configured input backend;
- absence of conflicting remappers or overlapping owned resources;
- installed DeskCompat admin/recovery components before privileged planning.

Missing packages are blockers with explicit remediation. The apply engine does not run
apt or remove packages.

## Future candidates

The next likely platform target is another Ubuntu/GNOME release. It is added only with
a named maintainer, fixtures, CI/VM coverage, upgrade tests, and recovery documentation.

Other GNOME distributions may reuse many resource drivers, but no public platform
adapter API will be stabilized from that assumption alone. KDE and macOS require
substantially different settings and privilege boundaries and are not v1 prerequisites.

Community reports for unsupported systems should include only an explicitly generated,
reviewed, redacted diagnostic bundle. DeskCompat will not collect telemetry by default.
