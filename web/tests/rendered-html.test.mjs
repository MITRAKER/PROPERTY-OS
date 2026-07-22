import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Property OS workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Property OS \| Property Intelligence Workspace<\/title>/i);
  assert.match(html, /Good morning/);
  assert.match(html, /Who to call first/);
  assert.match(html, /Nothing sends without your OK/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/);
  // No demo/sample content should ever be baked into the shipped HTML.
  assert.doesNotMatch(html, /demoProperties|Use demo file|Mitra K\./);
  // Non-technical audience: keep engineer jargon out of the visible UI copy.
  assert.doesNotMatch(html, /Model runs|Agent activity|four coordinated agents/i);
});
