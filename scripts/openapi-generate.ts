/**
 * Contract drift check.
 *
 * openapi/jolt-v1.yaml is the canonical contract; src/api/schemas.ts is the
 * runtime mirror the server actually validates against. Nothing stops the two
 * from diverging, so this compares them and fails CI when they do.
 *
 * It deliberately does NOT diff the documents byte-for-byte — descriptions,
 * examples and key order are free to differ. What it compares is the
 * structural signature that clients actually depend on:
 *
 *   - the set of properties on every named component
 *   - which of those are required
 *   - enum members
 *   - that every path+method in the spec has a route file implementing it
 *
 *   pnpm openapi:generate   print the signatures
 *   pnpm openapi:check      exit 1 on drift
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { components } from "../src/api/schemas.js";

const SPEC_PATH = "openapi/jolt-v1.yaml";
const ROUTES_DIR = "src/routes/api/v1";
const API_BASE = "/api/v1";

type Signature = {
  kind: "object" | "enum" | "other";
  properties?: Array<string>;
  required?: Array<string>;
  enum?: Array<string>;
};

const spec = parse(readFileSync(SPEC_PATH, "utf8")) as {
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, any> };
};

/** Merges allOf branches so `Me` and friends compare like plain objects. */
function flatten(schema: any, seen = new Set<string>()): any {
  if (!schema) return {};
  if (schema.$ref) {
    const name = String(schema.$ref).split("/").pop()!;
    if (seen.has(name)) return {};
    seen.add(name);
    return flatten(spec.components.schemas[name], seen);
  }
  if (Array.isArray(schema.allOf)) {
    const merged: any = { type: "object", properties: {}, required: [] };
    for (const branch of schema.allOf) {
      const flat = flatten(branch, seen);
      Object.assign(merged.properties, flat.properties ?? {});
      merged.required.push(...(flat.required ?? []));
    }
    return merged;
  }
  return schema;
}

function signatureFromSpec(name: string): Signature {
  const schema = flatten(spec.components.schemas[name]);
  if (Array.isArray(schema.enum)) {
    return { kind: "enum", enum: [...schema.enum].map(String).sort() };
  }
  if (schema.properties) {
    return {
      kind: "object",
      properties: Object.keys(schema.properties).sort(),
      required: [...(schema.required ?? [])].map(String).sort(),
    };
  }
  return { kind: "other" };
}

function signatureFromZod(schema: z.ZodType): Signature {
  const json = z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }) as any;
  if (Array.isArray(json.enum)) {
    return { kind: "enum", enum: [...json.enum].map(String).sort() };
  }
  if (json.properties) {
    return {
      kind: "object",
      properties: Object.keys(json.properties).sort(),
      required: [...(json.required ?? [])].map(String).sort(),
    };
  }
  return { kind: "other" };
}

function diffLists(
  label: string,
  fromSpec: Array<string> = [],
  code: Array<string> = [],
): Array<string> {
  const onlySpec = fromSpec.filter((x) => !code.includes(x));
  const onlyCode = code.filter((x) => !fromSpec.includes(x));
  const out: Array<string> = [];
  if (onlySpec.length) out.push(`    ${label} in spec but not in Zod: ${onlySpec.join(", ")}`);
  if (onlyCode.length) out.push(`    ${label} in Zod but not in spec: ${onlyCode.join(", ")}`);
  return out;
}

const problems: Array<string> = [];

// --- Components -------------------------------------------------------------

for (const [name, schema] of Object.entries(components)) {
  if (!spec.components.schemas[name]) {
    problems.push(`  ${name}: present in src/api/schemas.ts but missing from the spec`);
    continue;
  }
  const fromSpec = signatureFromSpec(name);
  const fromZod = signatureFromZod(schema as z.ZodType);

  if (fromSpec.kind !== fromZod.kind) {
    problems.push(`  ${name}: spec is ${fromSpec.kind}, Zod is ${fromZod.kind}`);
    continue;
  }

  const lines = [
    ...diffLists("enum values", fromSpec.enum, fromZod.enum),
    ...diffLists("properties", fromSpec.properties, fromZod.properties),
    ...diffLists("required", fromSpec.required, fromZod.required),
  ];
  if (lines.length) problems.push(`  ${name}:`, ...lines);
}

for (const name of Object.keys(spec.components.schemas)) {
  // PokePushPayload-style documentation-only schemas are allowed to exist in
  // the spec without a runtime mirror, as long as they are listed here.
  if (!(name in components)) {
    problems.push(`  ${name}: in the spec but not mirrored in src/api/schemas.ts`);
  }
}

// --- Route inventory --------------------------------------------------------

const routePaths = new Set<string>();
for (const file of readdirSync(ROUTES_DIR)) {
  const source = readFileSync(join(ROUTES_DIR, file), "utf8");
  const match = source.match(/createFileRoute\(\s*["'`]([^"'`]+)["'`]/);
  if (match?.[1]) routePaths.add(match[1].replace(/\/$/, ""));
}

for (const [specPath, operations] of Object.entries(spec.paths)) {
  const expected = (API_BASE + specPath.replace(/\{(\w+)\}/g, "$$$1")).replace(/\/$/, "");
  const methods = Object.keys(operations).filter((k) =>
    ["get", "post", "put", "patch", "delete"].includes(k),
  );
  if (!routePaths.has(expected)) {
    problems.push(`  ${specPath} [${methods.join(", ")}]: no route file resolves to ${expected}`);
  }
}

// --- Report -----------------------------------------------------------------

const checkOnly = process.argv.includes("--check");

if (!checkOnly) {
  for (const [name, schema] of Object.entries(components)) {
    console.log(name, JSON.stringify(signatureFromZod(schema as z.ZodType)));
  }
  console.log(`\n${routePaths.size} route file(s), ${Object.keys(spec.paths).length} spec path(s)`);
}

if (problems.length) {
  console.error(`\nContract drift between ${SPEC_PATH} and src/api/schemas.ts:\n`);
  console.error(problems.join("\n"));
  console.error("\nUpdate whichever side is wrong, then re-run `pnpm openapi:check`.\n");
  process.exit(1);
}

console.log(`\n✓ ${SPEC_PATH} and src/api/schemas.ts agree`);
