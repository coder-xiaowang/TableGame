import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { cacheName, updatePoem } from "./update-daily-poem.mjs";

const poem = { content: " 晚来天欲雪，能饮一杯无？ ", author: "白居易", origin: "问刘十九" };
const today = new Date("2026-11-26T15:59:59Z");
const tomorrow = new Date("2026-11-26T16:00:01Z");
const ok = () => Response.json(poem);

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "poem-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, file: path.join(directory, cacheName) };
}

test("one selection per Beijing date, including repeat invocations and the UTC date boundary", async t => {
  const { directory, file } = await fixture(t);
  let calls = 0;
  let current = today;
  const options = { now: () => current, fetchPoem(url, { signal }) {
    assert.equal(url, "https://v1.jinrishici.com/all.json");
    assert.ok(signal instanceof AbortSignal);
    calls++;
    return ok();
  } };
  await updatePoem(directory, options);
  const first = await readFile(file, "utf8");
  assert.deepEqual(JSON.parse(first), { date: "2026-11-26", ...poem, content: poem.content.trim() });
  await updatePoem(directory, options);
  assert.equal(await readFile(file, "utf8"), first);
  assert.equal(calls, 1);
  current = tomorrow;
  await updatePoem(directory, options);
  assert.equal(calls, 2);
  assert.equal(JSON.parse(await readFile(file, "utf8")).date, "2026-11-27");
});

test("failed first fetch leaves no cache; later failures retain the original dated file until a successful retry", async t => {
  const { directory, file } = await fixture(t);
  const timeout = () => { throw new Error("timeout"); };
  await assert.rejects(updatePoem(directory, { fetchPoem: timeout }));
  assert.deepEqual(await readdir(directory), []);
  await updatePoem(directory, { now: () => today, fetchPoem: ok });
  const before = await readFile(file, "utf8");
  for (const fetchPoem of [timeout, () => new Response("", {status: 503}), () => new Response("bad json"),
    ...Object.keys(poem).map(key => () => Response.json({ ...poem, [key]: " " }))]) {
    await assert.rejects(updatePoem(directory, { now: () => tomorrow, fetchPoem }));
    assert.equal(await readFile(file, "utf8"), before);
  }
  await updatePoem(directory, { now: () => tomorrow, fetchPoem: ok });
  assert.equal(JSON.parse(await readFile(file, "utf8")).date, "2026-11-27");
  assert.deepEqual(await readdir(directory), [cacheName]);
});

test("invalid cache can recover; runtime data cannot be generated inside the repository", async t => {
  const { directory, file } = await fixture(t);
  await writeFile(file, "{");
  await updatePoem(directory, { now: () => today, fetchPoem: ok });
  assert.equal(JSON.parse(await readFile(file, "utf8")).author, "白居易");
  await assert.rejects(updatePoem(fileURLToPath(new URL("../", import.meta.url))), /Git/);
});

test("homepage reads only the same-origin cache, uses its original date, and preserves its HTML fallback", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const page = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(page, /晚来天欲雪，能饮一杯无？/);
  assert.match(page, /白居易《问刘十九》/);
  const scenarios = [
    [Response.json({ ...poem, date: "2024-02-29" }), true],
    [new Response("", { status: 404 }), false],
    [Response.json({ ...poem, date: "2026-02-31" }), false],
    [Response.json({ ...poem, author: null, date: "2024-02-29" }), false]
  ];
  for (const [response, valid] of scenarios) {
    const elements = new Map();
    const document = { querySelector(key) {
      if (!elements.has(key)) elements.set(key, {});
      return elements.get(key);
    } };
    let requested;
    await vm.runInNewContext(source, { document, fetch: url => { requested = url; return response; } });
    assert.equal(requested, "/daily-poem.json");
    assert.equal(elements.has("#dailyQuote"), valid);
    assert.equal(elements.has("#dailyQuoteDate"), valid);
    assert.equal(elements.has("#quoteSource"), valid);
    if (valid) {
      assert.equal(elements.get("#dailyQuoteDate").dateTime, "2024-02-29");
      assert.equal(elements.get("#dailyQuote").textContent, "“" + poem.content + "”");
      assert.equal(elements.get("#quoteSource").textContent, "— 白居易《问刘十九》");
    }
  }
});
