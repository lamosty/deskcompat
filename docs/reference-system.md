# Reference system and adoption matrix

DeskCompat starts from one real, long-lived Ubuntu workstation that has been
incrementally tuned for macOS muscle memory. This document records the useful
behavioural evidence without turning that machine's exact state into a public
profile.

The reference system is evidence, not a specification. Personal preferences,
hardware bindings, stale experiments, and unrelated administration settings
must not become defaults merely because they exist on the reference machine.

## Sanitized environment

- Ubuntu 24.04 on x86-64
- GNOME Shell 46 on Wayland
- A PC-layout keyboard and a multilingual layout that requires AltGr
- Pointer devices with back/forward side buttons
- More than one display
- GNOME Files with Sushi installed for Space-bar previews
- Adwaita interface, icon, and cursor themes

The setup is primarily behavioural. It is **not** evidence for shipping a
macOS visual theme, proprietary artwork, fonts, icons, or wallpapers.

## Evidence sources

DeskCompat may inspect only narrow, documented sources for these capabilities:

- typed GNOME settings from allowlisted schemas and keys;
- `/etc/keyd/*.conf` and narrowly scoped keyd service overrides;
- known GNOME extension metadata and allowlisted extension settings;
- known user configuration files, such as a terminal configuration, only when
  a module has a dedicated parser;
- input-device capabilities exposed by the kernel, without exporting stable
  device identifiers;
- files installed at known Sushi viewer/helper locations;
- the running state of known remapping services.

Raw dconf dumps, arbitrary home-directory searches, process environments,
window titles, command histories, and generic system configuration are not
valid adoption inputs. See [Privacy boundaries](privacy-boundaries.md).

## Classification and risk

Classifications:

- **Portable** — useful intent that can be represented independently of one
  machine.
- **Personal** — a legitimate preference, but not a reasonable default.
- **Hardware** — depends on a locally selected device or topology.
- **Infrastructure** — administration unrelated to desktop compatibility.
- **Conflict** — an obsolete, competing, or ambiguous implementation.

Risk tiers:

- **R1 — user setting:** a typed, user-session setting with straightforward
  snapshot and restoration.
- **R2 — session integration:** an extension, application integration, or user
  file that can impair the desktop session.
- **R3 — privileged input:** root-owned input interception, udev, or a service
  that can temporarily make a keyboard or pointer unusable.
- **R4 — system infrastructure:** login, boot, network, security, or general
  server configuration. DeskCompat must not manage it.

Feasibility uses **high**, **medium**, and **low** for deterministic detection,
application, and exact restoration. A high-risk capability can still have high
technical feasibility; risk determines the required approval and recovery
controls.

## Module and adoption matrix

| Observed capability | Classification | Candidate module | Risk | Detect / apply / revert | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Command and Option positions adapted for macOS muscle memory | Portable + hardware | `keyboard.modifiers` | R3 | high / medium / medium | Detect in Phase 0; apply only after privileged-input trials exist |
| AltGr preserved for multilingual typing | Portable + personal | `keyboard.altgr` | R3 | high / medium / medium | Explicit option; infer from active layouts but never silently change it |
| Command-style editing, document, tab, zoom, and app-switching shortcuts | Portable | `keyboard.shortcuts` | R3 | high / medium / medium | Each binding must be independently configurable |
| Approximate hide and quit behaviour implemented with minimize and close-window actions | Portable, imperfect | `keyboard.shortcuts` | R3 | high / medium / medium | Describe the semantic difference; do not claim full macOS equivalence |
| Application-aware terminal shortcuts | Portable | `keyboard.app-overrides` | R2–R3 | high / medium / medium | Support known applications through declarative matchers |
| keyd socket access and service resilience overrides | Portable implementation | `backend.keyd` | R3 | high / medium / medium | Internal backend concern, not profile data |
| Side buttons switch workspaces and gain a Command-modified browser action | Portable + hardware | `mouse.side-buttons` | R3 | high / medium / medium | Require interactive device and button selection |
| Pointer hotplug restarts the remapping service | Hardware | `backend.evdev-hotplug` | R3 | high / medium / medium | Add only with deduplication, service hardening, and rollback tests |
| Fixed workspace count | Portable + personal | `workspaces` | R1 | high / high / high | Phase 0 detection and Phase 2 guarded apply; never assume the observed count |
| Workspaces span all monitors | Portable + personal | `workspaces.monitors` | R1 | high / high / high | Opt-in setting |
| Workspace navigation and move-window shortcuts | Portable | `workspaces.shortcuts` | R1 | high / high / high | Good early guarded-apply module |
| Application switcher includes applications from every workspace | Portable + personal | `switcher` | R1 | high / high / high | Opt-in preset value |
| Half, quarter, center, restore, and maximize tiling | Portable | `windows.tiling` | R2 | high / medium / high | Version-gate the GNOME extension dependency |
| Native edge tiling disabled in favour of the extension | Portable dependency | `windows.tiling` | R1 | high / high / high | Apply only as part of a complete tiling plan |
| Command+Space opens overview and search | Portable | `overview.shortcut` | R1 | high / high / high | Good early guarded-apply module |
| Middle-clicking the top panel opens overview | Portable | `overview.panel-middle-click` | R2 | high / medium / high | Optional extension; verify Shell compatibility |
| Window controls appear on the left | Portable | `windows.controls` | R1 | high / high / high | Good early guarded-apply module |
| Dock placement, hiding, opacity, indicators, and click action are customized | Personal, partly portable | `dock` | R1–R2 | high / high / high | Optional module; presets provide initial values only |
| Pinned dock applications | Personal | `dock.favorites` | R1 | high / high / high | Machine-local only; never export by default |
| Shell chrome adjusted by a third-party extension | Personal | `shell.chrome` | R2 | high / medium / high | Later optional module, not part of essentials |
| Cursor size, text scale, clock, hot corners, and pointer-location feedback customized | Personal + accessibility | `interface` | R1 | high / high / high | Adopt only after item-by-item user review |
| Multiple keyboard layouts and custom layout-switch shortcuts | Personal | `keyboard.layouts` | R2 | high / high / high | Never assume a language; preserve a working fallback layout |
| Natural scrolling, tap-to-click, and two-finger scrolling configured | Portable + hardware | `touchpad` | R1 | high / high / high | Offer only when a touchpad capability is detected |
| Mouse scrolling and acceleration differ from touchpad behaviour | Personal + hardware | `mouse.pointer` | R1 | high / high / high | Explicit opt-in, not inherited from a touchpad preset |
| GNOME Files defaults to list view | Personal | `files` | R1 | high / high / high | Small optional module |
| Space-bar preview extended with a legacy RAW-photo handler | Portable | `preview.kukni` | R2 | high / medium / high | Detect legacy and duplicate MIME handlers before installing |
| Focused and unfocused GTK window shadows normalized | Portable workaround | `appearance.window-shadows` | R2 | high / medium / high | Optional and toolkit-version-gated |
| A preferred terminal is registered as the desktop default | Personal + portable | `terminal.default` | R1 | high / high / high | Refer to a desktop ID or capability, not a private executable path |
| Terminal shortcuts and middle-click behaviour adapted | Portable + personal | `terminal.integration` | R2 | high / low / medium | Manage a dedicated include/snippet; never replace the whole config |
| Terminal theme, fonts, pane workflow, remote control, and clipboard policy customized | Personal + security-sensitive | none | R2–R3 | high / low / low | Never auto-adopt |
| Screenshot shortcut customized | Portable + personal | `screenshots.shortcuts` | R1 | high / high / high | Optional binding |
| Night light, idle, lock, and power policy customized | Personal / policy | none initially | R1–R2 | high / high / high | Outside the macOS-compatibility profile |
| User and login-screen display topology configured | Hardware | none | R4 | high / low / low | Detect only; never apply automatically |
| Media-production, microphone, display-control, and recovery commands bound to keys | Personal + infrastructure | none | R3–R4 | high / low / low | Report only as unmanaged conflicts; never import commands |
| Bluetooth and adapter-specific udev/service workarounds | Hardware + infrastructure | none | R3–R4 | high / low / low | Out of scope |
| Another remapper remains installed but disabled | Conflict | `doctor.conflicts` | R3 | high / not applicable / not applicable | Warn in Phase 0; do not uninstall automatically |
| An input-remapping daemon exists without an adopted preset | Conflict / unknown | `doctor.conflicts` | R3 | high / not applicable / not applicable | Phase 0 must distinguish installation from active event injection |
| A residual uinput permission rule remains from an older remapper | Conflict | `doctor.security` | R3 | high / low / medium | Warn in Phase 0; removal requires a separate approved plan |

## Preview migration requirement

A legacy Sushi viewer may already provide the same MIME types as
[Kukni](https://github.com/lamosty/kukni), a separate Linux file-preview project, under
different filenames. File absence at Kukni's current paths does not prove that
the capability is absent.

The preview module must therefore:

1. enumerate only known Sushi viewer locations;
2. compare recognized files by content hash and declared MIME types;
3. report collisions before creating a plan;
4. offer an explicit adoption or migration operation;
5. preserve the exact prior files for rollback; and
6. refuse to choose between unknown competing viewers automatically.

## Recommended delivery order

1. **Phase 0 — read-only foundation:** `doctor`, adoption inventory, conflict
   detection, sanitized structured output, and no mutation.
2. **Phase 1 — deterministic planning:** resolve independently selectable
   capabilities and show exact writes, dependencies, conflicts, and recovery
   operations without executing them.
3. **Phase 2 — guarded GNOME application:** first add the transaction and recovery
   kernel, then manage only selected workspace and window-control settings.
4. **Phase 3 — protected keyboard input:** prove conservative undo and drift handling,
   then add a selected keyboard backend with timed trials and boot recovery.
5. **Phase 4 and later:** stabilize automation; evaluate pointer and gesture input;
   then consider Files, an optional dock, terminal integration, GTK workarounds,
   legacy-aware Kukni migration, additional desktops, and additional distributions.

## Adoption rules derived from the reference system

- Adopt intent, not implementation accidents. For example, adopt “four
  workspaces” only after presenting it as a personal value, while
  “workspace-switch shortcuts” may be recognized as portable behaviour.
- Profiles contain desired behaviour; machine bindings contain selected
  devices, installed extension variants, and local paths.
- Every changed scalar, list element, and file needs an exact before-value.
- Lists such as enabled extensions and dock favourites must be merged by
  ownership rather than replaced wholesale.
- A module must expose `inspect`, `plan`, `apply`, `status`, `revert`, and
  `uninstall` semantics before it can mutate a system.
- Existing unknown files or settings are unmanaged by default. Adoption is an
  explicit approved operation, not permission to overwrite them.
- Privileged input changes require validation before activation and automatic
  rollback unless the user confirms that keyboard and pointer input still work.
- Multi-resource application is a journaled sequence with compensating recovery
  operations. DeskCompat must not claim that it is an atomic transaction or
  guarantee rollback after unrelated external changes.
