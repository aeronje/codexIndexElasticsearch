import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { parse } from "csv-parse/sync";

const NORMALIZED_KEYS = [
  "timestamp",
  "session_id",
  "turn_id",
  "speaker",
  "role",
  "phase",
  "message",
  "file_names",
  "urls",
  "source_file"
];

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

export function canonicalRecordPayload(record) {
  return NORMALIZED_KEYS.map((key) => [key, record[key] ?? ""]);
}

export function createRecordKey(record) {
  return sha256(Buffer.from(JSON.stringify(canonicalRecordPayload(record)), "utf8"));
}

function normalizeRow(row, columns, logicalRow) {
  const record = {
    timestamp: String(row[columns.timestamp] ?? ""),
    session_id: String(row[columns.sessionId] ?? ""),
    turn_id: String(row[columns.turnId] ?? ""),
    speaker: String(row[columns.speaker] ?? ""),
    role: String(row[columns.role] ?? ""),
    phase: String(row[columns.phase] ?? ""),
    message: String(row[columns.message] ?? ""),
    file_names: String(row[columns.fileNames] ?? ""),
    urls: String(row[columns.urls] ?? ""),
    source_file: String(row[columns.sourceFile] ?? ""),
    logical_row: logicalRow
  };
  if (!record.timestamp || Number.isNaN(Date.parse(record.timestamp))) {
    throw new Error(`CSV logical row ${logicalRow} has an invalid timestamp: ${record.timestamp || "<empty>"}`);
  }
  if (!record.message.trim()) throw new Error(`CSV logical row ${logicalRow} has an empty message.`);
  record.record_key = createRecordKey(record);
  return record;
}

export function loadCsvSource(config) {
  const buffer = readFileSync(config.sourceCsv);
  const sourceSha256 = sha256(buffer);
  const rows = parse(buffer, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: false
  });
  if (rows.length === 0) throw new Error("The configured CSV contains no data records.");
  const headers = Object.keys(rows[0]);
  const missingHeaders = Object.values(config.columns).filter((header) => !headers.includes(header));
  if (missingHeaders.length) throw new Error(`CSV is missing configured headers: ${missingHeaders.join(", ")}`);

  const records = rows.map((row, index) => normalizeRow(row, config.columns, index + 2));
  const keys = new Set();
  for (const record of records) {
    if (keys.has(record.record_key)) throw new Error(`Duplicate normalized record detected at logical row ${record.logical_row}.`);
    keys.add(record.record_key);
  }
  const stats = statSync(config.sourceCsv);
  return {
    sourcePath: config.sourceCsv,
    sourceSha256,
    sourceBytes: stats.size,
    sourceModifiedUtc: stats.mtime.toISOString(),
    headers,
    records
  };
}

export function comparableRecord(record) {
  return Object.fromEntries(canonicalRecordPayload(record));
}
