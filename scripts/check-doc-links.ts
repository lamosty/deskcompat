import { exists } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const markdownFiles: string[] = [];

for await (const entry of new Bun.Glob("**/*.md").scan({ cwd: root, onlyFiles: true })) {
  if (entry.startsWith("node_modules/") || entry.startsWith(".git/")) continue;
  markdownFiles.push(entry);
}

const failures: string[] = [];
const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g;
for (const relativeFile of markdownFiles.sort()) {
  const contents = await Bun.file(resolve(root, relativeFile)).text();
  for (const match of contents.matchAll(markdownLink)) {
    const destination = match[1]?.trim();
    if (!destination || destination.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(destination)) {
      continue;
    }
    const path = decodeURIComponent(destination.split("#", 1)[0] ?? "");
    if (!(await exists(resolve(root, dirname(relativeFile), path)))) {
      failures.push(`${relativeFile}: missing ${destination}`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
}
