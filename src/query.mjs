function termsFilter(field, value) {
  return value ? { term: { [field]: value } } : null;
}

export function buildSearchBody(query, options = {}) {
  if (typeof query !== "string" || !query.trim()) throw new Error("Search query must not be empty.");
  const filters = [
    termsFilter("speaker", options.speaker),
    termsFilter("role", options.role),
    termsFilter("phase", options.phase),
    termsFilter("session_id", options.session)
  ].filter(Boolean);
  if (options.from || options.to) {
    filters.push({
      range: {
        timestamp: {
          ...(options.from ? { gte: options.from } : {}),
          ...(options.to ? { lte: options.to } : {})
        }
      }
    });
  }

  let fullText;
  if (options.phrase) {
    fullText = { match_phrase: { message: { query: query.trim() } } };
  } else {
    fullText = {
      multi_match: {
        query: query.trim(),
        fields: ["message^5", "file_names^2", "urls"],
        operator: options.operator ?? "and",
        ...(options.fuzzy ? { fuzziness: "AUTO", prefix_length: 1 } : {}),
        ...(options.minimumShouldMatch ? { minimum_should_match: options.minimumShouldMatch } : {})
      }
    };
  }

  return {
    query: { bool: { must: [fullText], filter: filters } },
    sort: ["_score", { timestamp: "desc" }],
    track_total_hits: true
  };
}
