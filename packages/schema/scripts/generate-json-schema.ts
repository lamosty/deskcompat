import { resolve } from "node:path";
import { z } from "zod";
import { CliResultSchema } from "../src/cli.ts";
import { PlanSchema } from "../src/plan.ts";
import { ProfileSchema } from "../src/profile.ts";

const root = resolve(import.meta.dir, "../../..");
const schemas: ReadonlyArray<readonly [string, unknown]> = [
  ["profile-v1alpha1.json", z.toJSONSchema(ProfileSchema, { target: "draft-7" })],
  ["plan-v1alpha1.json", z.toJSONSchema(PlanSchema, { target: "draft-7" })],
  ["cli-output-v1alpha1.json", z.toJSONSchema(CliResultSchema, { target: "draft-7" })],
];
const check = Bun.argv.includes("--check");
let stale = false;

for (const [name, schema] of schemas) {
  const path = resolve(root, "schemas", name);
  const expected = `${JSON.stringify(schema, null, 2)}\n`;
  if (check) {
    const file = Bun.file(path);
    if (!(await file.exists()) || (await file.text()) !== expected) {
      console.error(`Generated schema is stale: schemas/${name}`);
      stale = true;
    }
  } else {
    await Bun.write(path, expected);
  }
}

if (stale) process.exitCode = 1;
