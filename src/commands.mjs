import { comparableRecord, loadCsvSource } from "./csv-source.mjs";
import { createIndexDefinition } from "./index-definition.mjs";
import { buildSearchBody } from "./query.mjs";

function totalHits(response) {
  return typeof response.hits.total === "number" ? response.hits.total : response.hits.total.value;
}

function sourceDocument(record, sourceSha256) {
  return { ...record, source_csv_sha256: sourceSha256 };
}

function generatedIndexName(alias) {
  return `${alias}-${new Date().toISOString().replace(/[-:.TZ]/g, "").toLowerCase()}`;
}

export async function configCheckCommand(config) {
  const source = loadCsvSource(config);
  return {
    status: "valid",
    configPath: config.configPath,
    sourceCsv: source.sourcePath,
    sourceSha256: source.sourceSha256,
    sourceBytes: source.sourceBytes,
    records: source.records.length,
    headers: source.headers,
    indexAlias: config.indexAlias,
    elasticsearchNode: config.elasticsearch.node
  };
}

export async function doctorCommand(config, client) {
  const local = await configCheckCommand(config);
  const info = await client.info();
  const health = await client.cluster.health();
  const serverMajor = Number(String(info.version.number).split(".")[0]);
  if (serverMajor !== 9) throw new Error(`This release supports Elasticsearch 9.x; server reported ${info.version.number}.`);
  return {
    status: "ready",
    local,
    elasticsearch: {
      name: info.name,
      clusterName: info.cluster_name,
      version: info.version.number,
      clusterStatus: health.status,
      nodes: health.number_of_nodes
    }
  };
}

export async function importCommand(config, client) {
  const source = loadCsvSource(config);
  const newIndex = generatedIndexName(config.indexAlias);
  const definition = createIndexDefinition(source);
  await client.indices.create({ index: newIndex, ...definition });
  const documents = source.records.map((record) => sourceDocument(record, source.sourceSha256));

  let bulkResult;
  try {
    bulkResult = await client.helpers.bulk({
      datasource: documents,
      concurrency: 1,
      flushBytes: 1_000_000,
      refreshOnCompletion: newIndex,
      onDocument(record) {
        return { index: { _index: newIndex, _id: record.record_key } };
      }
    });
    if (bulkResult.failed > 0) throw new Error(`Bulk import dropped ${bulkResult.failed} record(s).`);
    await client.indices.refresh({ index: newIndex });
    const count = await client.count({ index: newIndex });
    if (count.count !== source.records.length) {
      throw new Error(`Imported count mismatch: Elasticsearch=${count.count}, CSV=${source.records.length}.`);
    }
    await client.indices.updateAliases({
      actions: [
        { remove: { index: "*", alias: config.indexAlias, must_exist: false } },
        { add: { index: newIndex, alias: config.indexAlias, is_write_index: true } }
      ]
    });
  } catch (error) {
    try {
      await client.indices.delete({ index: newIndex });
    } catch {
      // The failed generation is disposable; retain the original error.
    }
    throw error;
  }

  return {
    status: "imported",
    sourceCsv: source.sourcePath,
    sourceSha256: source.sourceSha256,
    records: source.records.length,
    index: newIndex,
    alias: config.indexAlias,
    bulk: {
      successful: bulkResult.successful,
      failed: bulkResult.failed,
      retries: bulkResult.retry,
      bytes: bulkResult.bytes,
      elapsedMs: bulkResult.time
    },
    note: "Previous generated indices are retained until explicitly reviewed and removed."
  };
}

async function fetchContext(client, alias, hit, contextRows) {
  if (!contextRows) return [];
  const source = hit._source;
  const response = await client.search({
    index: alias,
    size: contextRows * 2 + 1,
    query: {
      bool: {
        filter: [
          { term: { session_id: source.session_id } },
          { range: { logical_row: { gte: source.logical_row - contextRows, lte: source.logical_row + contextRows } } }
        ],
        must_not: [{ ids: { values: [hit._id] } }]
      }
    },
    sort: [{ logical_row: "asc" }]
  });
  return response.hits.hits.map((contextHit) => ({ id: contextHit._id, ...contextHit._source }));
}

export async function searchCommand(config, client, query, options = {}) {
  const limit = Number(options.limit ?? config.search.defaultLimit);
  const contextRows = Number(options.context ?? config.search.defaultContextRows);
  if (!Number.isInteger(limit) || limit < 1 || limit > config.search.maximumLimit) {
    throw new Error(`limit must be an integer from 1 to ${config.search.maximumLimit}.`);
  }
  if (!Number.isInteger(contextRows) || contextRows < 0 || contextRows > 5) {
    throw new Error("context must be an integer from 0 to 5.");
  }

  const baseOptions = { ...options, operator: options.allTerms === false ? "or" : "and" };
  let strategy = options.phrase ? "phrase" : (options.fuzzy ? "strict-fuzzy" : "strict");
  let body = buildSearchBody(query, baseOptions);
  let response = await client.search({ index: config.indexAlias, size: limit, ...body });

  if (!options.phrase && totalHits(response) === 0 && options.noFallback !== true) {
    strategy = options.fuzzy ? "fallback-fuzzy" : "fallback";
    body = buildSearchBody(query, { ...baseOptions, operator: "or", minimumShouldMatch: "60%" });
    response = await client.search({ index: config.indexAlias, size: limit, ...body });
  }

  const results = [];
  for (const hit of response.hits.hits) {
    results.push({
      id: hit._id,
      score: hit._score,
      record: hit._source,
      context: await fetchContext(client, config.indexAlias, hit, contextRows)
    });
  }
  return {
    status: "ok",
    query,
    strategy,
    total: totalHits(response),
    returned: results.length,
    indexAlias: config.indexAlias,
    queryBody: options.showQuery ? body : undefined,
    results
  };
}

function isNotFound(error) {
  return error?.meta?.statusCode === 404 || error?.statusCode === 404;
}

export async function statusCommand(config, client) {
  const source = loadCsvSource(config);
  let aliases;
  try {
    aliases = await client.indices.getAlias({ name: config.indexAlias });
  } catch (error) {
    if (isNotFound(error)) {
      return {
        status: "not-indexed",
        sourceSha256: source.sourceSha256,
        sourceRecords: source.records.length,
        alias: config.indexAlias
      };
    }
    throw error;
  }
  const indexNames = Object.keys(aliases);
  const mappings = await client.indices.getMapping({ index: config.indexAlias });
  const count = await client.count({ index: config.indexAlias });
  const activeIndex = indexNames[0];
  const metadata = mappings[activeIndex]?.mappings?._meta ?? {};
  const fingerprintMatches = metadata.source_sha256 === source.sourceSha256;
  const countMatches = count.count === source.records.length;
  return {
    status: fingerprintMatches && countMatches ? "verified" : "stale",
    alias: config.indexAlias,
    indices: indexNames,
    csv: { sha256: source.sourceSha256, records: source.records.length },
    elasticsearch: {
      sha256: metadata.source_sha256 ?? null,
      records: count.count,
      mappingVersion: metadata.schema_version ?? null,
      importedAtUtc: metadata.imported_at_utc ?? null
    },
    fingerprintMatches,
    countMatches
  };
}

export async function verifyCommand(config, client, recordKey) {
  if (!/^[A-Fa-f0-9]{64}$/.test(recordKey ?? "")) throw new Error("recordKey must be a 64-character SHA-256 value.");
  const source = loadCsvSource(config);
  const csvRecord = source.records.find((record) => record.record_key === recordKey.toUpperCase());
  if (!csvRecord) {
    return { status: "missing-from-csv", recordKey: recordKey.toUpperCase(), sourceSha256: source.sourceSha256 };
  }

  let response;
  try {
    response = await client.get({ index: config.indexAlias, id: recordKey.toUpperCase() });
  } catch (error) {
    if (isNotFound(error)) {
      return { status: "missing-from-elasticsearch", recordKey: recordKey.toUpperCase(), csvRecord };
    }
    throw error;
  }
  const elasticRecord = response._source;
  const fieldMatches = JSON.stringify(comparableRecord(csvRecord)) === JSON.stringify(comparableRecord(elasticRecord));
  const fingerprintMatches = elasticRecord.source_csv_sha256 === source.sourceSha256;
  return {
    status: fieldMatches && fingerprintMatches ? "verified" : "conflict",
    recordKey: recordKey.toUpperCase(),
    fieldMatches,
    fingerprintMatches,
    csvSourceSha256: source.sourceSha256,
    elasticsearchSourceSha256: elasticRecord.source_csv_sha256,
    csvRecord,
    elasticsearchRecord: elasticRecord
  };
}
