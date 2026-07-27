export function createIndexDefinition(source) {
  return {
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
      refresh_interval: "30s",
      analysis: {
        analyzer: {
          conversation_text: {
            type: "custom",
            tokenizer: "standard",
            filter: ["lowercase", "asciifolding"]
          }
        }
      }
    },
    mappings: {
      dynamic: "strict",
      _meta: {
        schema_version: 1,
        record_key_version: 1,
        source_sha256: source.sourceSha256,
        source_records: source.records.length,
        source_bytes: source.sourceBytes,
        source_modified_utc: source.sourceModifiedUtc,
        imported_at_utc: new Date().toISOString()
      },
      properties: {
        record_key: { type: "keyword" },
        logical_row: { type: "long" },
        timestamp: { type: "date", format: "strict_date_optional_time" },
        session_id: { type: "keyword", ignore_above: 512 },
        turn_id: { type: "keyword", ignore_above: 512 },
        speaker: { type: "keyword", ignore_above: 256 },
        role: { type: "keyword", ignore_above: 256 },
        phase: { type: "keyword", ignore_above: 256 },
        message: { type: "text", analyzer: "conversation_text" },
        file_names: {
          type: "text",
          analyzer: "conversation_text",
          fields: { keyword: { type: "keyword", ignore_above: 8191 } }
        },
        urls: { type: "text", analyzer: "conversation_text" },
        source_file: { type: "keyword", ignore_above: 8191 },
        source_csv_sha256: { type: "keyword" }
      }
    }
  };
}
