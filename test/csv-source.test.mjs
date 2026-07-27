import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.mjs";
import { createRecordKey, loadCsvSource } from "../src/csv-source.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = resolve(ROOT, "config.example.json");

test("example config and CSV validate", () => {
  const config = loadConfig(CONFIG);
  assert.equal(config.elasticsearch.node, "http://127.0.0.1:9200");
  assert.deepEqual(Object.keys(config.elasticsearch), ["node"]);
  const source = loadCsvSource(config);
  assert.equal(source.records.length, 3);
  assert.equal(source.headers.length, 10);
  assert.match(source.sourceSha256, /^[A-F0-9]{64}$/);
  assert.equal(source.records[0].record_key, createRecordKey(source.records[0]));
  assert.equal(source.records[0].logical_row, 2);
});

test("record keys change when canonical content changes", () => {
  const config = loadConfig(CONFIG);
  const source = loadCsvSource(config);
  const changed = { ...source.records[0], message: `${source.records[0].message} changed` };
  assert.notEqual(createRecordKey(source.records[0]), createRecordKey(changed));
});
