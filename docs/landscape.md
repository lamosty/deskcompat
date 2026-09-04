# Project landscape

**Last reviewed:** 2026-09-04

This is a product-boundary map, not a leaderboard or an exhaustive directory. It is
based on official project repositories, manuals, and release pages. Capabilities and
licenses can change; verify the exact upstream version before integration or reuse.

## Adjacent projects

| Category | Representative projects | What they already do well | DeskCompat relationship |
| --- | --- | --- | --- |
| macOS-style input | [Toshy](https://github.com/RedBearAK/Toshy), [Kinto](https://github.com/rbreaves/kinto) | Broad global and application-aware Mac-style keyboard behavior, keyboard-type handling, and user-facing setup | Toshy is the closest direct incumbent and a backend or collaboration candidate. DeskCompat must not present keyboard remapping itself as novel. |
| Input engines | [keyd](https://github.com/rvaiya/keyd), [xremap](https://github.com/xremap/xremap), [keymapper](https://github.com/houmain/keymapper), [Kanata](https://github.com/jtroo/kanata) | Mature evdev/uinput mapping, layers, device filters, and varying degrees of application context | Prefer an audited upstream engine over writing another remapper. Detect competing ownership before enabling one. |
| Device and gesture tools | [Input Remapper](https://github.com/sezanzeb/input-remapper), [Fusuma](https://github.com/iberianpig/fusuma), [Touchégg](https://github.com/JoseExposito/touchegg) | Graphical device mapping or configurable multitouch gestures | Potential external owners or future backends, not functionality to duplicate casually. |
| GNOME look and feel | [WhiteSur GTK](https://github.com/vinceliuice/WhiteSur-gtk-theme), [Kiwi](https://github.com/kem-a/kiwi-kemma) | macOS-like themes, shell presentation, dock behavior, and GNOME extensions | Appearance is already well served. DeskCompat stays behavior-first and may only coordinate optional integrations later. |
| Ubuntu/workstation setup | [Omabuntu](https://github.com/omakasui/omabuntu), [Omarchy](https://github.com/omacom/omarchy) | Cohesive, opinionated developer environments with polished setup flows | Product and UX references, but not the scope: DeskCompat adopts an existing Ubuntu GNOME system instead of replacing the workstation experience. |
| Backup and declarative state | [SaveDesktop](https://github.com/vikdevelop/SaveDesktop), [chezmoi](https://github.com/twpayne/chezmoi), [Home Manager](https://github.com/nix-community/home-manager) | Broad desktop backup, dotfile management, reproducible user environments, previews, and generations | Complementary tools. DeskCompat adds domain-specific behavior, narrow ownership, and conditional per-resource undo rather than managing arbitrary home state. |
| Agent desktop control | [computer-use-linux](https://github.com/agent-sh/computer-use-linux) | General Linux desktop control through CLI and MCP | MCP access is not the differentiator. DeskCompat's future interface remains closed, typed, plan-bound, and unable to expose generic computer control. |

## The narrow gap

The reviewed market does **not** leave gaps in keyboard remapping, macOS-like themes,
fresh-machine bootstrap, general dotfile management, desktop backup, or MCP-based
computer control. DeskCompat should not compete on those claims.

Within the reviewed set, we did not find one project that combines all of these:

1. adoption of an already-customized Ubuntu GNOME machine;
2. allowlisted semantic inspection across GNOME and input components;
3. independently selectable behavior capabilities;
4. a deterministic, machine-readable plan before mutation;
5. explicit per-resource ownership and compare-before-write;
6. conditional undo that refuses to erase later external changes;
7. independently recoverable trials for input-critical changes; and
8. one bounded core contract shared by people, scripts, and a possible MCP adapter.

That yields the intended position:

> **DeskCompat is the safety-first adoption and orchestration layer for macOS muscle
> memory on an existing Ubuntu GNOME setup.**

Toshy is the most important direct comparison. DeskCompat should complement or
integrate mature input work rather than dismissing it. SaveDesktop is a complementary
backup tool, not a substitute for ownership-aware rollback. Generic configuration
managers remain appropriate for users who want broad file or package control.

## Build, integrate, detect, or decline

- **Build:** semantic profiles, allowlisted discovery, deterministic plans, ownership,
  drift handling, journals, conservative recovery, and the bounded automation API.
- **Integrate:** mature input engines and narrow GNOME extensions only after a safety
  spike and compatibility testing.
- **Detect:** other remappers, declarative managers, and settings that already own a
  target; never silently adopt them.
- **Decline:** visual cloning, arbitrary plugins or shell hooks, whole-workstation
  bootstrap, and unrestricted agent control.

Upstream projects use different licenses. Do not vendor code, mapping sets, artwork,
or configuration without reviewing the exact source and license. Prefer documented
interfaces and upstream contributions where practical.

Refresh this document when selecting a backend, changing product scope, or preparing a
public release.
