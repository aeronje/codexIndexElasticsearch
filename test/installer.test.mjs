import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('../scripts/elasticsearchSingleNodeInstallation.sh', import.meta.url);
const readmeUrl = new URL('../README.md', import.meta.url);
const manualUrl = new URL('../docs/manual-elasticsearch-installation.md', import.meta.url);

test('installer has guarded, pinned, idempotent single-node behavior', async () => {
  const script = await readFile(scriptUrl, 'utf8');

  assert.match(script, /set -Eeuo pipefail/);
  assert.match(script, /readonly ES_VERSION="9\.4\.2"/);
  assert.match(script, /readonly INSTALLER_VERSION="0\.4\.0"/);
  assert.match(script, /--dry-run/);
  assert.match(script, /46095ACC8548582C1A2699A9D27D666CD88E42B4/);
  assert.match(script, /6F71F525282841EEDAF851B42F59B5F99B1BE0B4/);
  assert.match(script, /discovery\.type: single-node/);
  assert.match(script, /xpack\.ml\.enabled: false/);
  assert.match(script, /xpack\.security\.enabled: false/);
  assert.match(script, /xpack\.security\.autoconfiguration\.enabled: false/);
  assert.match(script, /BEGIN SECURITY AUTO CONFIGURATION/);
  assert.match(script, /xpack\.security\.http\.ssl\.keystore\.secure_password/);
  assert.match(script, /xpack\.security\.transport\.ssl\.keystore\.secure_password/);
  assert.match(script, /xpack\.security\.transport\.ssl\.truststore\.secure_password/);
  assert.match(script, /keystore_backup=/);
  assert.match(script, /chown root:elasticsearch/);
  assert.match(script, /keystore_original_mode/);
  assert.match(script, /Keystore permissions verified/);
  assert.match(script, /hindi ito managed ng installer/);
  assert.match(script, /Hindi ko ito aagawan ng port/);
  assert.match(script, /x-elastic-product/);
  assert.match(script, /Network binding verified/);
  assert.match(script, /\[::ffff:127\.0\.0\.1\]:9200/);
  assert.match(script, /\[::1\]:9200/);
  assert.match(script, /ni-restore ko ang original/);
  assert.match(script, /LEGACY_MANAGED_BEGIN/);
  assert.match(script, /cluster\.name: \$ES_CLUSTER_NAME/);
  assert.match(script, /10-codex-index-elasticsearch\.options/);
  assert.match(script, /-Xms768m/);
  assert.match(script, /network\.host: 127\.0\.0\.1/);
  assert.match(script, /vm\.max_map_count=1048576/);
  assert.match(script, /backup_file="\$\{config_file\}\.backup/);
  assert.match(script, /http:\/\/127\.0\.0\.1:9200/);
  assert.doesNotMatch(script, /elasticsearch-reset-password/);
  assert.doesNotMatch(script, /curl[^\n]*\|[^\n]*(bash|sh)/);
});

test('public docs contain automated and manual installation paths', async () => {
  const [readme, manual] = await Promise.all([
    readFile(readmeUrl, 'utf8'),
    readFile(manualUrl, 'utf8')
  ]);

  assert.match(readme, /elasticsearchSingleNodeInstallation\.sh --dry-run/);
  assert.match(readme, /manual-elasticsearch-installation\.md/);
  assert.match(manual, /apt-cache madison elasticsearch/);
  assert.match(manual, /curl --fail http:\/\/127\.0\.0\.1:9200/);
});
