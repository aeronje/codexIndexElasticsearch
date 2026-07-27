import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const REQUIRED_COLUMN_KEYS = [
  "timestamp",
  "sessionId",
  "turnId",
  "speaker",
  "role",
  "phase",
  "message",
  "fileNames",
  "urls",
  "sourceFile"
];

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

export function loadConfig(configPath = "config.json") {
  const absoluteConfigPath = resolve(configPath);
  if (!existsSync(absoluteConfigPath)) {
    throw new Error(`Config file not found: ${absoluteConfigPath}`);
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(absoluteConfigPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to parse config JSON: ${error.message}`);
  }

  if (raw.configVersion !== 2) throw new Error("configVersion must be 2.");
  const configDirectory = dirname(absoluteConfigPath);
  const sourceCsvValue = requireString(raw.sourceCsv, "sourceCsv");
  const sourceCsv = isAbsolute(sourceCsvValue)
    ? sourceCsvValue
    : resolve(configDirectory, sourceCsvValue);
  if (!existsSync(sourceCsv)) throw new Error(`Configured sourceCsv not found: ${sourceCsv}`);

  const indexAlias = requireString(raw.indexAlias, "indexAlias").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(indexAlias)) {
    throw new Error("indexAlias must contain only lowercase letters, numbers, dots, underscores, or hyphens.");
  }

  if (!raw.columns || typeof raw.columns !== "object") throw new Error("columns mapping is required.");
  const columns = {};
  for (const key of REQUIRED_COLUMN_KEYS) {
    columns[key] = requireString(raw.columns[key], `columns.${key}`);
  }
  if (new Set(Object.values(columns)).size !== REQUIRED_COLUMN_KEYS.length) {
    throw new Error("Each configured CSV column must map to a distinct header.");
  }

  const elasticsearch = raw.elasticsearch ?? {};
  const search = raw.search ?? {};
  const defaultLimit = Number(search.defaultLimit ?? 10);
  const maximumLimit = Number(search.maximumLimit ?? 50);
  const defaultContextRows = Number(search.defaultContextRows ?? 1);
  if (!Number.isInteger(defaultLimit) || defaultLimit < 1) throw new Error("search.defaultLimit must be a positive integer.");
  if (!Number.isInteger(maximumLimit) || maximumLimit < defaultLimit || maximumLimit > 500) {
    throw new Error("search.maximumLimit must be an integer between defaultLimit and 500.");
  }
  if (!Number.isInteger(defaultContextRows) || defaultContextRows < 0 || defaultContextRows > 5) {
    throw new Error("search.defaultContextRows must be an integer from 0 to 5.");
  }

  return {
    configPath: absoluteConfigPath,
    configDirectory,
    sourceCsv,
    indexAlias,
    columns,
    elasticsearch: {
      node: requireString(elasticsearch.node, "elasticsearch.node")
    },
    search: { defaultLimit, maximumLimit, defaultContextRows }
  };
}

export { REQUIRED_COLUMN_KEYS };
