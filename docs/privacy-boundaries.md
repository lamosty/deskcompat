# Privacy boundaries

DeskCompat inspects a deeply personal part of a computer: input behaviour,
desktop preferences, applications, and hardware. Its privacy contract must be
enforced by the deterministic core, not delegated to documentation, an AI
agent, or a best-effort redaction pass.

## Core promises

1. **Local-first and offline by default.** The core performs no telemetry,
   analytics, profile upload, remote lookup, or crash submission.
2. **Allowlisted inspection.** Each module declares the exact settings, files,
   processes, and device capabilities it may inspect.
3. **No ambient authority for agents.** The CLI and MCP server expose typed
   DeskCompat operations, not arbitrary shell execution or unrestricted file
   reads.
4. **Portable intent is separate from machine state.** Exported profiles contain
   behaviours and choices, never a raw snapshot of the computer.
5. **No silent adoption.** Detection does not transfer ownership. Existing
   configuration remains unmanaged until the user approves an exact plan.
6. **Minimum disclosure.** Human and JSON output reveal only what is needed to
   decide or verify an operation.

## Data classes

DeskCompat separates data into four classes.

### Portable profile

Safe to share after schema validation. Examples:

- module names and enabled/disabled state;
- abstract shortcuts such as `command+c -> copy`;
- workspace count when the user explicitly chooses to export it;
- semantic preferences such as natural touchpad scrolling;
- backend-independent application categories such as `terminal` or `browser`.

A portable profile must not contain executable code, shell fragments, absolute
paths, environment variables, hardware identifiers, or opaque extension data.

### Machine-local bindings

Necessary to implement a profile but not safe or useful to publish. Examples:

- the locally selected keyboard or pointer;
- an installed application desktop ID;
- a chosen backend and extension implementation;
- local ownership records and before-values;
- generated aliases for devices and displays.

Machine bindings stay in a user-private state directory. Files containing them
must use restrictive permissions. They are excluded from normal profile export,
diagnostics, and MCP resources. A binding may use a non-unique model and
capability description, but never a hardware serial or machine identifier.

### Ephemeral observations

May be read briefly to answer a specific capability question, but must not be
persisted or emitted. Examples include whether a known file is writable by the
current process or whether a known service is active.

Ephemeral observations are discarded after planning. A one-way hash is not a
safe substitute when the input has a small search space or remains a stable
fingerprint.

### Prohibited data

DeskCompat has no reason to read this data. The core, CLI, MCP server, plugins,
and diagnostic bundles must never collect it.

## Never collect

DeskCompat must never read, retain, print, transmit, or include in diagnostics:

- passwords, API keys, access tokens, private keys, recovery codes, cookies,
  browser sessions, keyrings, or credential stores;
- clipboard or primary-selection contents;
- typed keys, input-event payloads, or a history of user input;
- active-window titles, document titles, browser URLs, tab titles, or focused
  application history;
- command history, shell history, terminal scrollback, editor buffers, or agent
  conversation contents;
- arbitrary environment-variable values or process command lines;
- file contents outside a module's exact, documented configuration grammar;
- personal documents, photographs, thumbnails, preview output, or document
  metadata, including location metadata;
- raw application logs, remapper logs, journal output, or crash dumps;
- network traffic, connection history, nearby wireless devices, or location
  data;
- SSH, VPN, firewall, DNS, hosts-file, container, orchestration, or deployment
  configuration;
- hardware serial numbers, monitor EDID serials, Bluetooth addresses, network
  interface addresses, machine IDs, or stable cross-install fingerprints;
- application recents, notification history, launcher history, or application
  usage statistics.

If an implementation cannot determine whether a source may contain prohibited
data, it must not read that source.

## Never import

The adoption engine must never turn any of the following into a DeskCompat
profile or managed action:

- arbitrary shell commands, scripts, aliases, desktop-entry `Exec` values, or
  custom-keybinding command strings;
- environment variables, command substitutions, pipes, redirects, or globbed
  paths;
- raw dconf dumps or complete GNOME schemas;
- complete terminal, shell, editor, browser, or application configuration
  files;
- enabled-extension or favourite-application arrays as an owned replacement;
- login-screen, bootloader, kernel, sysctl, network, remote-access, container,
  server, or package-repository configuration;
- display topology or monitor configuration;
- udev rules and privileged services that are not generated by a specific,
  reviewed DeskCompat backend;
- unknown executables or plugins discovered in user or system directories;
- source files from unrelated configuration repositories;
- secrets even when the user places them in a field intended for ordinary
  configuration.

DeskCompat may report that an unmanaged customization exists. It must describe
the category and possible conflict without reproducing its value.

## Narrow exceptions for local operation

Some capabilities require local identification. These exceptions do not permit
export or telemetry.

### Input devices

`doctor` may inspect generic capabilities, bus class, and non-unique model IDs
to determine whether a device is a keyboard, pointer, or touchpad. Stable
serials and physical connection paths must not appear in output.

When identical devices need disambiguation, the interactive UI may ask the user
to press a harmless button. DeskCompat stores a random local alias with only a
non-unique model and capability description. If that is insufficient to
identify the same device later, DeskCompat asks the user to bind it again rather
than persist a serial or physical connection path. The portable profile refers
only to the alias's role, such as `primary_pointer`.

DeskCompat never records normal key presses or pointer movement. Event
observation is limited to an explicit, time-bounded binding flow with a visible
cancel action.

### Application matching

Application-aware shortcuts may use a reviewed desktop ID or window class at
runtime. The current window title must never be stored or sent to an agent.
Diagnostics report only whether a known matcher succeeded.

### Existing files

A module may hash a known candidate file to recognize a published DeskCompat or
upstream version. It may not upload the hash, use it as a user fingerprint, or
include unknown file contents in a report. Unknown files are represented as
`present_unmanaged`.

## Output contract

Standard output and JSON are designed to minimize disclosure, but pre-alpha users must
still review them before sharing. Profile validation can include user-authored names
and values. Before the project labels a diagnostic bundle safe to publish, dedicated
redaction and property tests must enforce that narrower contract. Future MCP output is
subject to the same requirement.

The current full `plan` and `profile validate` output is **local operational data**, not
a public diagnostic bundle. It can include selected desktop preferences, user-authored
profile values, and deterministic precondition digests. Do not post it without review.
Future support bundles must omit those fields or replace them with non-identifying
categorical results; hashing a low-entropy setting is not sufficient redaction.

Allowed example:

```json
{
  "module": "keyboard.shortcuts",
  "state": "present_unmanaged",
  "conflict": "another_input_backend_is_running",
  "risk": "R3"
}
```

Forbidden fields include raw paths, usernames, hostnames, device serials,
window titles, arbitrary commands, environment values, file excerpts, and log
lines.

Paths in user-facing explanations use symbolic locations such as `$HOME`,
`$XDG_CONFIG_HOME`, and `$XDG_DATA_HOME`. Machine-readable output should prefer
module-owned logical resource names over paths.

DeskCompat should not initially provide a “show everything” or
`--include-private` switch. Such a switch is difficult for users and agents to
reason about and makes accidental disclosure likely.

## Agent and MCP boundary

A future MCP server must be a thin adapter over the same policy-enforcing core as the
CLI. If introduced, it must:

- run locally over stdio by default;
- publish sanitized capability and plan objects only;
- expose individual typed tools rather than a generic action or command tool;
- omit raw filesystem, process, dconf, and input-event access;
- mark read-only and mutating operations accurately, while treating those
  annotations as descriptive rather than authorization;
- require an immutable plan identifier for mutation;
- reject a plan when its digest, machine state, or approval has changed;
- never let an agent manufacture user approval in a tool argument;
- never return transaction backups through MCP.

An agent may recommend intent and explain a plan. It may not inspect prohibited
data, approve its own plan, disable the recovery timer, or gain general root
access through DeskCompat.

## State, backups, and rollback

Conservative recovery sometimes requires retaining exact prior values that are
unsuitable for export. Operation records therefore:

- remain local and user-private;
- store only before-values for resources DeskCompat actually changes;
- never back up unrelated parent directories or whole dconf branches;
- distinguish public plan metadata from private restoration data;
- use authenticated integrity metadata so an agent cannot substitute a
  different restore target;
- have a documented retention and deletion policy;
- are never committed to a repository or attached to diagnostics.

A multi-resource apply is a journaled sequence, not an atomic transaction. If a
later step fails, DeskCompat attempts documented compensating operations and
reports any state it could not restore. It must not hide partial recovery behind
an unconditional success result.

If a module encounters a value outside its grammar, it records only that the
resource is unmanaged and refuses mutation unless a safe adoption path exists.

## Logging and errors

Logs contain event names, module IDs, result codes, timing, and sanitized error
categories. They do not contain observed values.

For example, log `keyboard configuration failed validation`, not the complete
configuration; log `application matcher unavailable`, not the focused window;
and log `existing target differs`, not the file contents.

Unexpected exceptions must pass through a final structured redaction layer.
Crash reporting, if ever added, is opt-in, previewed before transmission, and
disabled for input-event and restoration components.

## Extension and community-profile policy

Community profiles are declarative data validated against the same restricted
schema as built-in profiles. They cannot contain code, URLs to executable
content, package-manager commands, arbitrary paths, or post-install hooks.

Backend plugins, if introduced later, are executable software and follow the
normal signed release and package-review process. Installing a profile must
never implicitly install an unreviewed plugin.

## Verification requirements

Privacy boundaries require automated tests, including:

- fixtures containing fake secrets in every prohibited source and assertions
  that no output contains them;
- JSON-schema tests that reject paths, command strings, and unknown fields;
- property tests for path and error redaction;
- tests proving that list adoption merges only module-owned entries;
- tests proving that unknown files are not read beyond allowlisted metadata or a
  module's documented configuration grammar;
- MCP snapshots containing no private restoration data;
- diagnostic-bundle allowlist tests;
- tests that an agent cannot set an approval flag or bypass trial rollback;
- migration tests ensuring legacy integrations are detected without exposing
  their contents.

Any privacy regression blocks release. A new inspection source requires an
explicit update to this policy, a documented reason, and tests proving that its
data cannot escape its intended local boundary.
