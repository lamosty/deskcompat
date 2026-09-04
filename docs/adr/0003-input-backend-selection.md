# ADR 0003: Select the first input backend through a safety spike

- **Status:** Proposed
- **Date:** 2026-09-04
- **Decision owners:** DeskCompat maintainers

## Context

DeskCompat needs application-aware Command-style shortcuts while preserving normal
terminal control keys and international AltGr input. Mature projects already solve
parts of this problem:

- [keyd](https://github.com/rvaiya/keyd) provides a compact system-wide remapping
  engine and is proven on the reference workstation;
- [Toshy](https://github.com/RedBearAK/Toshy) focuses directly on macOS-style,
  application-aware keyboard behavior across Linux environments; and
- [xremap](https://github.com/xremap/xremap) is another capable application-aware
  remapper but is also a common source of overlapping input ownership.

DeskCompat should orchestrate a mature engine, not build a new remapper. However, the
choice affects privilege, application detection, Wayland compatibility, packaging,
international layouts, conflict detection, and independent recovery.

## Proposed evaluation

Build disposable spikes for keyd and Toshy on Ubuntu 24.04/GNOME 46/Wayland. Measure:

1. Command-style editing, browser, terminal, app-switching, and tiling behavior.
2. US plus international AltGr layouts and physical PC keyboards.
3. Existing-configuration detection without overwrite.
4. Deterministic generation into one DeskCompat-owned namespace.
5. Validation before activation and health verification afterward.
6. Timed rollback that survives CLI failure, graphical logout, and reboot.
7. Package provenance, update stability, and maintainer collaboration potential.

The spike must include failure injection and a physical-keyboard rescue checklist. A
feature comparison alone is not sufficient.

## Decision rule

Choose one backend for the first supported keyboard slice. Prefer upstream integration
and contribution over forking. If neither backend can meet independent recovery and
ownership requirements, DeskCompat will generate a reviewed configuration for manual
activation rather than automate an unsafe input change.

No input backend is selected by this ADR yet, and the current CLI performs detection
only.
