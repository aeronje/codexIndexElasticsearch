import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.mjs";
import { loadCsvSource } from "../src/csv-source.mjs";
import { importCommand, searchCommand, statusCommand, verifyCommand } from "../src/commands.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig(resolve(ROOT, "config.example.json"));

function fakeClient({ alias = null, generations = [] } = {}) {
  const state = {
    documents: new Map(),
    created: null,
    alias,
    deleted: [],
    generations: new Set(generations)
  };
  return {
    state,
    indices: {
      async create(request) {
        state.created = request;
        state.generations.add(request.index);
      },
      async refresh() {},
      async getAlias() {
        if (!state.alias) {
          const error = new Error("not found");
          error.meta = { statusCode: 404 };
          throw error;
        }
        return { [state.alias]: { aliases: {} } };
      },
      async get() {
        return Object.fromEntries([...state.generations].map((index) => [index, {}]));
      },
      async updateAliases(request) {
        state.alias = request.actions.at(-1).add.index;
      },
      async delete({ index }) {
        state.deleted.push(index);
        state.generations.delete(index);
      }
    },
    helpers: {
      async bulk({ datasource, onDocument }) {
        let bytes = 0;
        for (const document of datasource) {
          const operation = onDocument(document);
          state.documents.set(operation.index._id, document);
          bytes += Buffer.byteLength(JSON.stringify(document));
        }
        return { total: state.documents.size, successful: state.documents.size, failed: 0, retry: 0, bytes, time: 1 };
      }
    },
    async count() { return { count: state.documents.size }; },
    async get({ id }) {
      const document = state.documents.get(id);
      if (!document) {
        const error = new Error("not found");
        error.meta = { statusCode: 404 };
        throw error;
      }
      return { _id: id, _source: document };
    }
  };
}

test("import creates a verified generation and moves the alias", async () => {
  const client = fakeClient();
  const result = await importCommand(config, client);
  assert.equal(result.status, "imported");
  assert.equal(result.records, 3);
  assert.equal(client.state.documents.size, 3);
  assert.equal(client.state.alias, result.index);
  assert.equal(client.state.created.mappings.dynamic, "strict");
  assert.equal(result.retention.predecessorIndex, null);
  assert.deepEqual(result.retention.removedIndices, []);
});

test("import retains the current generation and immediate predecessor only", async () => {
  const predecessor = "codex-archive-sessions-20260102";
  const obsolete = "codex-archive-sessions-20260101";
  const client = fakeClient({ alias: predecessor, generations: [obsolete, predecessor] });
  const result = await importCommand(config, client);

  assert.equal(result.retention.policy, "current-plus-predecessor");
  assert.equal(result.retention.currentIndex, result.index);
  assert.equal(result.retention.predecessorIndex, predecessor);
  assert.deepEqual(result.retention.removedIndices, [obsolete]);
  assert.deepEqual([...client.state.generations].sort(), [predecessor, result.index].sort());
});

test("verify reconciles Elasticsearch with the canonical CSV", async () => {
  const client = fakeClient();
  await importCommand(config, client);
  const source = loadCsvSource(config);
  const result = await verifyCommand(config, client, source.records[0].record_key);
  assert.equal(result.status, "verified");
  assert.equal(result.fieldMatches, true);
  assert.equal(result.fingerprintMatches, true);
});

test("search falls back deterministically and returns bounded context", async () => {
  const source = loadCsvSource(config);
  let searchCalls = 0;
  const client = {
    async search(request) {
      searchCalls += 1;
      if (searchCalls === 1) return { hits: { total: { value: 0 }, hits: [] } };
      if (searchCalls === 2) {
        return {
          hits: {
            total: { value: 1 },
            hits: [{ _id: source.records[1].record_key, _score: 7, _source: source.records[1] }]
          }
        };
      }
      assert.equal(request.query.bool.filter[0].term.session_id, source.records[1].session_id);
      return {
        hits: {
          total: { value: 1 },
          hits: [{ _id: source.records[0].record_key, _source: source.records[0] }]
        }
      };
    }
  };
  const result = await searchCommand(config, client, "birthday unrelated", { context: 1 });
  assert.equal(result.strategy, "fallback");
  assert.equal(result.returned, 1);
  assert.equal(result.results[0].context.length, 1);
  assert.equal(searchCalls, 3);
});

test("status compares active index metadata with the CSV", async () => {
  const source = loadCsvSource(config);
  const client = {
    indices: {
      async getAlias() { return { "codex-archive-sessions-20260101": { aliases: {} } }; },
      async getMapping() {
        return {
          "codex-archive-sessions-20260101": {
            mappings: { _meta: { source_sha256: source.sourceSha256, schema_version: 1, imported_at_utc: "2026-01-01T00:00:00.000Z" } }
          }
        };
      }
    },
    async count() { return { count: source.records.length }; }
  };
  const result = await statusCommand(config, client);
  assert.equal(result.status, "verified");
  assert.equal(result.fingerprintMatches, true);
  assert.equal(result.countMatches, true);
});
