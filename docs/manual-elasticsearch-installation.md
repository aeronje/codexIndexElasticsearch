# codexIndexElasticsearch manual single-node installation

These are the auditable Debian-family commands represented by
`scripts/elasticsearchSingleNodeInstallation.sh`. They were verified against
the official Elastic Debian-package procedure in July 2026. Review and adapt
package-manager, service-manager, filesystem, and architecture commands before
using another distribution or operating system.

The automated script additionally detects existing installs, verifies versions,
backs up `elasticsearch.yml`, avoids duplicate managed settings, waits for the
service, and verifies that the unauthenticated HTTP endpoint is available only
through localhost.

## 1. Base packages

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg apt-transport-https
```

## 2. Node.js 24.x when Node.js 20+ is absent

```bash
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o /tmp/nodesource.key
gpg --show-keys --with-colons /tmp/nodesource.key
# Expected primary fingerprint in July 2026:
# 6F71F525282841EEDAF851B42F59B5F99B1BE0B4
gpg --dearmor --yes --output /tmp/nodesource.gpg /tmp/nodesource.key
sudo install -o root -g root -m 0644 /tmp/nodesource.gpg /usr/share/keyrings/nodesource.gpg

sudo tee /etc/apt/sources.list.d/nodesource.sources >/dev/null <<'EOF'
Types: deb
URIs: https://deb.nodesource.com/node_24.x
Suites: nodistro
Components: main
Architectures: amd64
Signed-By: /usr/share/keyrings/nodesource.gpg
EOF

sudo apt-get update
sudo apt-get install -y nodejs
node --version
```

Node.js 24.x was the tested current target in July 2026. The CLI supports Node.js
20 or newer.

## 3. Elastic repository and pinned package

Download the key and verify its full fingerprint before trusting it:

```bash
curl -fsSL https://artifacts.elastic.co/GPG-KEY-elasticsearch -o /tmp/elasticsearch.key
gpg --show-keys --with-colons /tmp/elasticsearch.key
# Expected: 46095ACC8548582C1A2699A9D27D666CD88E42B4
gpg --dearmor --yes --output /tmp/elasticsearch-keyring.gpg /tmp/elasticsearch.key
sudo install -o root -g root -m 0644 /tmp/elasticsearch-keyring.gpg /usr/share/keyrings/elasticsearch-keyring.gpg

echo 'deb [signed-by=/usr/share/keyrings/elasticsearch-keyring.gpg] https://artifacts.elastic.co/packages/9.x/apt stable main' \
  | sudo tee /etc/apt/sources.list.d/elastic-9.x.list
sudo apt-get update
apt-cache madison elasticsearch
sudo apt-get install -y elasticsearch=9.4.2
```

Elasticsearch includes its own JDK; a separate Java package is not required.

## 4. Kernel, Elasticsearch, and heap configuration

```bash
echo 'vm.max_map_count=1048576' | sudo tee /etc/sysctl.d/99-elasticsearch-single-node.conf
sudo sysctl -w vm.max_map_count=1048576
sudo cp --preserve=mode,ownership,timestamps \
  /etc/elasticsearch/elasticsearch.yml \
  "/etc/elasticsearch/elasticsearch.yml.backup.$(date -u +%Y%m%dT%H%M%SZ)"
```

Reconcile these settings with `/etc/elasticsearch/elasticsearch.yml`; do not
create duplicate YAML keys. Remove active `cluster.initial_master_nodes` and
`discovery.seed_hosts` settings when selecting `discovery.type: single-node`:

```yaml
cluster.name: codex-index-elasticsearch
node.name: your-hostname
network.host: 127.0.0.1
http.host: 127.0.0.1
http.port: 9200
discovery.type: single-node
xpack.ml.enabled: false
xpack.security.enabled: false
xpack.security.autoconfiguration.enabled: false
```

Create `/etc/elasticsearch/jvm.options.d/10-codex-index-elasticsearch.options`:

```text
-Xms768m
-Xmx768m
```

The 768 MiB heap is deliberately conservative for the tested 4 GB host. Adapt
it to the host and keep `Xms` equal to `Xmx`.

The Debian package may add TLS passwords to the Elasticsearch keystore during
package installation even when the final design is no-auth. The package owns
this keystore as `root:elasticsearch`; back it up, remove only these generated
security entries as root, and then enforce and verify the package ownership:

```bash
keystore=/etc/elasticsearch/elasticsearch.keystore
original_mode="$(sudo stat -c '%a' "$keystore")"
sudo cp --preserve=mode,ownership,timestamps \
  "$keystore" "${keystore}.backup.$(date -u +%Y%m%dT%H%M%SZ)"
sudo env ES_PATH_CONF=/etc/elasticsearch \
  /usr/share/elasticsearch/bin/elasticsearch-keystore remove \
  xpack.security.http.ssl.keystore.secure_password \
  xpack.security.transport.ssl.keystore.secure_password \
  xpack.security.transport.ssl.truststore.secure_password
sudo chown root:elasticsearch "$keystore"
sudo chmod "$original_mode" "$keystore"
sudo stat -c '%U:%G %a %n' "$keystore"
```

The automated installer restores the backup if any removal fails.

## 5. Service and local health check

```bash
sudo systemctl daemon-reload
sudo systemctl enable elasticsearch.service
sudo systemctl restart elasticsearch.service
sudo systemctl status elasticsearch.service --no-pager
curl --fail http://127.0.0.1:9200
```

This endpoint has no authentication or TLS. Keep both `network.host` and
`http.host` bound to `127.0.0.1`. Enable security before exposing it to any
other host, network interface, tunnel, proxy, or container port mapping.

## Primary references

- [Elastic: install with a Debian package](https://www.elastic.co/docs/deploy-manage/deploy/self-managed/install-elasticsearch-with-debian-package)
- [Elastic: increase virtual memory](https://www.elastic.co/docs/deploy-manage/deploy/self-managed/vm-max-map-count)
- [Elastic: machine learning settings and SSE4.2](https://www.elastic.co/docs/reference/elasticsearch/configuration-reference/machine-learning-settings)
- [Elastic: JVM settings](https://www.elastic.co/docs/reference/elasticsearch/jvm-settings)
- [Elastic: manage and remove secure keystore settings](https://www.elastic.co/guide/en/elasticsearch/reference/current/elasticsearch-keystore.html)
- [NodeSource Debian-family distribution scripts](https://github.com/nodesource/distributions/tree/master/scripts/deb)
