import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchBody } from "../src/query.mjs";

test("strict search uses analyzed fields and metadata filters", () => {
  const body = buildSearchBody("PTO birthday", {
    operator: "and",
    speaker: "assistant",
    from: "2026-01-01"
  });
  const multiMatch = body.query.bool.must[0].multi_match;
  assert.equal(multiMatch.operator, "and");
  assert.deepEqual(multiMatch.fields, ["message^5", "file_names^2", "urls"]);
  assert.deepEqual(body.query.bool.filter[0], { term: { speaker: "assistant" } });
  assert.deepEqual(body.query.bool.filter[1], { range: { timestamp: { gte: "2026-01-01" } } });
});

test("phrase and fuzzy modes are explicit", () => {
  const phrase = buildSearchBody("approved birthday", { phrase: true });
  assert.equal(phrase.query.bool.must[0].match_phrase.message.query, "approved birthday");
  const fuzzy = buildSearchBody("birthdya", { fuzzy: true });
  assert.equal(fuzzy.query.bool.must[0].multi_match.fuzziness, "AUTO");
});
