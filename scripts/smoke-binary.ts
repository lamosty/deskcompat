import { resolve } from "node:path";
import { CliResultSchema } from "../packages/schema/src/cli.ts";

const binary = resolve(Bun.argv[2] ?? "dist/deskcompat");

async function run(args: readonly string[]): Promise<{ exitCode: number; stdout: string }> {
  const child = Bun.spawn([binary, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (stderr.length > 0) throw new Error("Compiled CLI unexpectedly wrote to stderr");
  return { exitCode, stdout };
}

const version = await run(["--version"]);
if (version.exitCode !== 0 || version.stdout.trim() !== "0.0.0-dev") {
  throw new Error("Compiled CLI version smoke test failed");
}

const profile = await run(["profile", "validate", "--json"]);
if (profile.exitCode !== 0) throw new Error("Compiled CLI profile smoke test failed");
const parsed = CliResultSchema.parse(JSON.parse(profile.stdout));
if (parsed.command !== "profile validate" || !parsed.ok) {
  throw new Error("Compiled CLI returned an invalid profile result");
}
