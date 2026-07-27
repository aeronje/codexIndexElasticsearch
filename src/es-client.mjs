import { Client } from "@elastic/elasticsearch";

export function createElasticsearchClient(config) {
  return new Client({ node: config.elasticsearch.node });
}
