# DeskCompat

**macOS muscle-memory compatibility for Ubuntu GNOME.**

[![CI](https://github.com/lamosty/deskcompat/actions/workflows/ci.yml/badge.svg)](https://github.com/lamosty/deskcompat/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

> [!WARNING]
> DeskCompat is an early pre-alpha project with no packaged installer or supported
> release. Its first mutating slice is limited to four allowlisted GNOME workspace
> and window-control settings. Do not use it on a machine you cannot recover.

| Capability | Current status |
| --- | --- |
| Host and conflict diagnosis | Implemented, read-only |
| Strict profile validation | Implemented, `v1alpha1` |
| GNOME workspace/window planning | Implemented |
| Apply, ownership, status, revert, and recovery | Experimental scalar GNOME slice |
| Keyboard, pointer, gestures, and MCP | Not implemented |

DeskCompat is intended for people who prefer Linux but have years of macOS habits
built into their hands: Command-like shortcuts, workspace gestures, predictable
window movement, and familiar pointer behavior.

It is not another macOS theme or a replacement Linux distribution. The goal is a
small compatibility layer that can adopt an existing Ubuntu GNOME installation,
coordinate the tools already present, and eventually make selected behavior
changes safely and reversibly.

“Compatibility” means familiar interaction conventions. DeskCompat does not run
macOS applications, reproduce macOS visually, or install Linux on Apple hardware.

## Why DeskCompat?

Individual remappers, GNOME extensions, gesture daemons, and dotfile collections
already solve useful pieces of this problem. The difficult part is operating them
as one system:

- discovering what is already configured;
- explaining which component owns each behavior;
- detecting conflicts before changing anything;
- letting users choose only the capabilities they want;
- preserving enough prior state to make a conservative undo possible; and
- reporting drift instead of silently overwriting later user changes.

DeskCompat is focused on that coordination and safety boundary.

## Project principles

1. **Inspect before changing.** Discovery and planning are separate from apply.
2. **Opt in by capability.** Keyboard, pointer, gestures, workspaces, and other
   behavior groups should be independently selectable.
3. **Show the plan.** A proposed change should identify its target, current value,
   desired value, owner, required privileges, and undo strategy.
4. **Touch only what DeskCompat owns.** Existing customization is input, not debris
   to overwrite.
5. **Prefer reversible operations.** Back up prior state, verify results, and stop
   safely when preconditions no longer match.
6. **Keep humans and agents on the same contract.** A stable CLI and structured
   output should be the source of truth; an MCP surface may be added later rather
   than becoming a second implementation.
7. **Be honest about limits.** Rollback can be conservative and well tested, but no
   desktop configurator can promise recovery from every external or manual change.

## Current scope

The initial target is an **existing Ubuntu GNOME installation** used by someone
who wants selected macOS-like interaction behavior without replacing their desktop.

The first useful profile is deliberately narrow. Planning and the experimental
transaction lifecycle currently model four scalar GNOME workspace/window-control
resources. Later protected milestones will add:

- keyboard modifier and common shortcut behavior;
- workspace switching and overview behavior;
- touchpad and mouse behavior after hardware-safe recovery is proven; and
- related GNOME settings needed to keep those choices coherent.

The checked-in `macos-essentials` profile currently manages only the explicit
`macos-standard` window-control preset. Workspace count, monitor policy, and all input
behavior remain unmanaged because they are personal or recovery-sensitive choices.

Appearance may be configurable later, but visual imitation is not the product's
core. Other distributions, desktop environments, and non-macOS behavior profiles
remain possible future adapters—not promises for the first release.

## Status and source checkout

This repository is an implementation-stage pre-alpha. It should not yet be treated as
a supported system configuration product.

```bash
git clone https://github.com/lamosty/deskcompat.git
cd deskcompat
```

That checks out the source only. There are intentionally no packaged-installer or
privileged input-setup instructions yet.

### Run the development preview

Use the Bun version in `.bun-version`, and run the CLI from the graphical GNOME
Wayland session being inspected:

```bash
bun install --frozen-lockfile
bun run deskcompat doctor
bun run deskcompat profile validate --profile profiles/macos-essentials.toml
bun run deskcompat plan --profile profiles/macos-essentials.toml --only windowControls
```

`doctor`, profile validation, `plan`, `status`, and `history` do not change desktop
configuration. Planning an unowned setting that already matches produces an explicit
`resource.adopt` operation rather than silently claiming it. To exercise the
experimental lifecycle, save and review the exact JSON plan first:

```bash
bun run deskcompat plan --profile profiles/macos-essentials.toml \
  --only windowControls --json > plan.json
bun run deskcompat apply --plan plan.json
bun run deskcompat status
bun run deskcompat history
bun run deskcompat revert --transaction tx_<id>
# For an interrupted/failed transaction only:
bun run deskcompat recover --transaction tx_<id>
```

Apply accepts only a current, integrity-valid plan from the same DeskCompat build. It
binds the persisted copy to the invoking user/session, rechecks host facts, ownership,
and resource preconditions under a lock, records exact before-state privately, and
verifies each effect. Revert uses compare-before-write and reports drift instead of
overwriting it. This is a durable sequence with compensating operations—not an atomic
desktop transaction.

Add `--json` for the versioned automation envelope. The current executable contains
no `sudo`, keyboard-remapping, gesture-management, package-management, or MCP path.
JSON schemas are pre-alpha and may change. Plan and profile JSON is
**local operational data**, not a share-safe diagnostic bundle: review it before
sharing because it can contain selected settings, raw allowlisted GVariant values,
profile values, and stable digests.

Host inspection must run inside the graphical Ubuntu session. An intentional support
blocker exits with code `3`; when invoked through `bun run`, Bun may describe that
non-zero result as a script failure even though DeskCompat itself did not crash.

## Roadmap

The order matters: mutation comes only after inspection and ownership semantics are
useful on real customized systems.

- [x] Define the initial machine facts, capability model, and support target.
- [x] Implement allowlisted read-only inspection with human and JSON output.
- [x] Generate deterministic plans and flag conflicts or unsupported state.
- [x] Runtime-validate a narrow Ubuntu GNOME/macOS-muscle-memory profile.
- [x] Add guarded scalar GNOME apply with snapshots and verification.
- [x] Add conservative transaction revert and drift reporting for that slice.
- [ ] Stabilize the CLI automation contract and evaluate a thin MCP adapter.
- [ ] Consider additional profiles and platforms only after the core is reliable.

See the [product brief](docs/product.md), [architecture](docs/architecture.md),
[safety model](docs/safety-model.md), and [roadmap](docs/roadmap.md) for the product
boundaries and release gates.

## Project documentation

- [Supported platforms](docs/supported-platforms.md)
- [Project landscape and product gap](docs/landscape.md)
- [Privacy boundaries](docs/privacy-boundaries.md)
- [Profile format](docs/profiles.md)
- [Reference-system lessons](docs/reference-system.md)
- [Contributing](CONTRIBUTING.md) and [governance](GOVERNANCE.md)
- [Security reporting](SECURITY.md) and [support](SUPPORT.md)
- [License](LICENSE) and [trademarks](TRADEMARKS.md)

## Non-goals

DeskCompat is not intended to be:

- a macOS clone, theme pack, or pixel-perfect visual recreation;
- a new Linux distribution, immutable image, or desktop environment;
- a general-purpose dotfile manager or package manager;
- a reason to erase working user configuration;
- a background AI agent with unrestricted system access;
- a promise that every macOS interaction can be reproduced on every application;
  or
- a compatibility claim for Linux distributions and desktops that are not tested.

## Names and affiliation

DeskCompat is an independent open-source project. It is not affiliated with,
sponsored by, or endorsed by Apple Inc., Canonical Ltd., or the GNOME Foundation.
Names such as macOS, Mac, Ubuntu, and GNOME are used only to identify the platforms
and interaction conventions being discussed. See [TRADEMARKS.md](TRADEMARKS.md).

## License

DeskCompat is open source under the [Apache License 2.0](LICENSE). Recovery and safety
functionality will remain part of the open-source core if and when it is implemented.
