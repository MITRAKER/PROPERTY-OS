import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
const repo = await readFile(new URL("../db/repo.ts", import.meta.url), "utf8");

test("cold SMS defaults to denied in both Drizzle and bootstrap SQL", () => {
  assert.match(
    schema,
    /textAllowed:\s*integer\("text_allowed"[\s\S]*?\.default\(false\)/,
    "the Drizzle schema must deny cold SMS by default",
  );
  assert.match(repo, /text_allowed INTEGER NOT NULL DEFAULT 0/);
  assert.doesNotMatch(repo, /text_allowed INTEGER NOT NULL DEFAULT 1/);
  assert.match(repo, /values\(\{\s*propertyId:\s*id,\s*workspaceId,\s*doNotContact,\s*textAllowed:\s*false\s*\}\)/);
  assert.match(repo, /values\(\{\s*propertyId,\s*workspaceId:\s*ws\(\),\s*textAllowed:\s*false,\s*\.\.\.patch\s*\}\)/);
});

test("all contact record reads include the signed-session workspace", () => {
  assert.doesNotMatch(
    repo,
    /\.from\(contacts\)\.where\(eq\(contacts\.id,/,
    "contact reads must never filter by id alone",
  );
  const scopedContactReads = repo.match(/eq\(contacts\.workspaceId,\s*(?:workspaceId|ws\(\))\)/g) ?? [];
  assert.ok(scopedContactReads.length >= 5, "expected every contact operation to carry workspace scope");
});

test("licensed listing choice is mirrored in schema and bootstrap DDL", () => {
  assert.match(schema, /listingConnections = sqliteTable\("listing_connections"/);
  assert.match(repo, /CREATE TABLE IF NOT EXISTS listing_connections/);
  assert.match(repo, /\.where\(eq\(listingConnections\.workspaceId,\s*workspaceId\)\)/);
});

