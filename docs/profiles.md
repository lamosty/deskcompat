# Profiles

DeskCompat profiles are inert TOML documents describing portable behavior. They cannot
contain commands, executable hooks, environment variables, arbitrary paths, packages,
or device identifiers. The runtime schema is authoritative; generated JSON Schema is
available at [`schemas/profile-v1alpha1.json`](../schemas/profile-v1alpha1.json).

> [!WARNING]
> The profile API is `v1alpha1` and may change before a supported release. The current
> CLI validates and plans profiles but cannot apply them.

## Management states

Every module has an explicit state:

- `unmanaged`: claim no target resources and leave existing state alone; general
  diagnostics may still report a relevant capability or conflict;
- `managed`: plan the declared desired value; and
- `disabled`: eventually restore the original DeskCompat baseline when ownership
  exists. It is currently blocked because transaction ownership is not implemented.

Omitting a module is equivalent to expressing no intent for it. Selecting one module
with `--only` never enables adjacent modules.

## Example

```toml
apiVersion = "deskcompat.dev/v1alpha1"
kind = "Profile"

[metadata]
name = "four-workspace-example"

[spec.modules.workspaces]
state = "managed"
count = 4
allMonitors = true

[spec.modules.windowControls]
state = "managed"
preset = "macos-standard"

[spec.modules.keyboard]
state = "unmanaged"
preset = "macos-pc"
preserveRightAltGr = true
```

Workspace count and multi-monitor policy are intentionally absent from the built-in
essentials profile: they are personal preferences, not universal macOS behavior.

Validate and preview a profile:

```bash
bun run deskcompat profile validate --profile ./profile.toml
bun run deskcompat plan --profile ./profile.toml --only workspaces,windowControls
```

For predictable and bounded input, a profile path must name a regular, non-symbolic-link
file no larger than 64 KiB. DeskCompat never copies the source profile into diagnostics.
