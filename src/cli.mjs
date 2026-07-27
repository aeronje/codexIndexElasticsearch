#!/usr/bin/env node
import { loadConfig } from "./config.mjs";
import { createElasticsearchClient } from "./es-client.mjs";
import {
  configCheckCommand,
  doctorCommand,
  importCommand,
  searchCommand,
  statusCommand,
  verifyCommand
} from "./commands.mjs";

const VALUE_OPTIONS = new Set([
  "config", "limit", "context", "speaker", "role", "phase", "session", "from", "to", "record-key"
]);
const BOOLEAN_OPTIONS = new Set(["fuzzy", "phrase", "no-fallback", "show-query", "any-term"]);

function parseArguments(argv) {
  const command = argv[0];
  const options = {};
  const positional = [];
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    if (VALUE_OPTIONS.has(name)) {
      const value = argv[++index];
      if (value === undefined) throw new Error(`--${name} requires a value.`);
      options[name] = value;
    } else if (BOOLEAN_OPTIONS.has(name)) {
      options[name] = true;
    } else {
      throw new Error(`Unknown option: --${name}`);
    }
  }
  return { command, options, positional };
}

function usage() {
  return `codex-index-elasticsearch

Usage:
  node src/cli.mjs config-check [--config config.json]
  node src/cli.mjs doctor [--config config.json]
  node src/cli.mjs import [--config config.json]
  node src/cli.mjs status [--config config.json]
  node src/cli.mjs search "terms" [filters]
  node src/cli.mjs verify --record-key <sha256>

Search options:
  --limit N --context N --speaker VALUE --role VALUE --phase VALUE
  --session VALUE --from ISO_DATE --to ISO_DATE --fuzzy --phrase
  --any-term --no-fallback --show-query`;
}

async function main() {
  const { command, options, positional } = parseArguments(process.argv.slice(2));
  if (!command || ["help", "--help", "-h"].includes(command)) {
    console.log(usage());
    return;
  }
  const config = loadConfig(options.config ?? "config.json");
  if (command === "config-check") {
    console.log(JSON.stringify(await configCheckCommand(config), null, 2));
    return;
  }

  const client = createElasticsearchClient(config);
  try {
    let result;
    if (command === "doctor") result = await doctorCommand(config, client);
    else if (command === "import") result = await importCommand(config, client);
    else if (command === "status") result = await statusCommand(config, client);
    else if (command === "search") {
      const query = positional.join(" ").trim();
      result = await searchCommand(config, client, query, {
        limit: options.limit === undefined ? undefined : Number(options.limit),
        context: options.context === undefined ? undefined : Number(options.context),
        speaker: options.speaker,
        role: options.role,
        phase: options.phase,
        session: options.session,
        from: options.from,
        to: options.to,
        fuzzy: options.fuzzy === true,
        phrase: options.phrase === true,
        allTerms: options["any-term"] !== true,
        noFallback: options["no-fallback"] === true,
        showQuery: options["show-query"] === true
      });
    } else if (command === "verify") {
      result = await verifyCommand(config, client, options["record-key"] ?? positional[0]);
    } else {
      throw new Error(`Unknown command: ${command}\n\n${usage()}`);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "error", message: error.message }, null, 2));
  process.exitCode = 1;
});
