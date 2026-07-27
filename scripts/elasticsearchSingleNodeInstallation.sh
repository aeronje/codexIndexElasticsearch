#!/usr/bin/env bash

# Tested ko ito sa Ubuntu 20.04, isang Debian-family distro. Malaki ang
# posibilidad na gumana ito sa ibang Debian-based distro, pero may mga command
# o package name na kailangang palitan. Balikan ang README.md para makita ang
# manual commands, saka i-refactor ayon sa distro at OS ninyo.

set -Eeuo pipefail

readonly ES_VERSION="9.4.2"
readonly INSTALLER_VERSION="0.4.0"
readonly ES_MAJOR="9"
readonly ES_CLUSTER_NAME="codex-index-elasticsearch"
readonly NODE_MAJOR="24"
readonly MINIMUM_NODE_MAJOR="20"
readonly ELASTIC_KEY_FINGERPRINT="46095ACC8548582C1A2699A9D27D666CD88E42B4"
readonly NODESOURCE_KEY_FINGERPRINT="6F71F525282841EEDAF851B42F59B5F99B1BE0B4"
readonly MANAGED_BEGIN="# BEGIN codexIndexElasticsearch single-node settings"
readonly MANAGED_END="# END codexIndexElasticsearch single-node settings"
readonly LEGACY_MANAGED_BEGIN="# BEGIN csv-evidence-search single-node settings"
readonly LEGACY_MANAGED_END="# END csv-evidence-search single-node settings"

DRY_RUN=false
ASSUME_YES=false
NEW_ES_INSTALL=false
SUDO=()
TEMP_DIR=""

say() { printf '%s\n' "$*"; }
info() { printf '[INFO] %s\n' "$*"; }
ok() { printf '[OK] %s\n' "$*"; }
warn() { printf '[BABALA] %s\n' "$*" >&2; }
die() { printf '[HINTO] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Paggamit:
  bash scripts/elasticsearchSingleNodeInstallation.sh [options]

Options:
  --dry-run         Ipakita ang checks at plan; walang babaguhin.
  --yes             Huwag nang humingi ng confirmation.
  --help             Ipakita ang tulong na ito.

Target: localhost-only Elasticsearch 9.4.2, walang auth/TLS, 768 MiB heap, walang ML.
EOF
}

run() {
  if $DRY_RUN; then
    printf '[DRY-RUN]'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

sudo_run() {
  run "${SUDO[@]}" "$@"
}

cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
}
trap cleanup EXIT

for argument in "$@"; do
  case "$argument" in
    --dry-run) DRY_RUN=true ;;
    --yes) ASSUME_YES=true ;;
    --help|-h) usage; exit 0 ;;
    *) die "Hindi ko kilala ang option na: $argument" ;;
  esac
done

say "============================================================"
say "codexIndexElasticsearch - Single-Node Installation"
say "============================================================"
say "Installer version: $INSTALLER_VERSION"
say "Tested ito sa Ubuntu 20.04, isang Debian-family distro."
say "Sa ibang distro o OS, tingnan ang manual commands sa README.md"
say "at i-refactor ang package at service commands bago patakbuhin."
say

[[ -r /etc/os-release ]] || die "Hindi mabasa ang /etc/os-release."
# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "debian" && "${ID:-}" != "ubuntu" && " ${ID_LIKE:-} " != *" debian "* ]]; then
  die "Debian-family lang ang automatic installer na ito. Gamitin ang manual guide para sa ${PRETTY_NAME:-unknown OS}."
fi
command -v apt-get >/dev/null 2>&1 || die "Walang apt-get; manual installation ang gamitin."
command -v dpkg >/dev/null 2>&1 || die "Walang dpkg; manual installation ang gamitin."
command -v systemctl >/dev/null 2>&1 || die "Kailangan ng systemd/systemctl ang installer na ito."

architecture="$(dpkg --print-architecture)"
[[ "$architecture" == "amd64" ]] || die "amd64 lang muna ang tested target; nakita ko ang $architecture."

if [[ "$(id -u)" -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 || die "Kailangan ang sudo para sa packages at system config."
  SUDO=(sudo)
fi

info "OS: ${PRETTY_NAME:-unknown}"
info "Architecture: $architecture"
info "CPU: $(lscpu 2>/dev/null | awk -F: '/Model name/{sub(/^[ \t]+/, "", $2); print $2; exit}' || true)"
info "Memory: $(free -h | awk '/^Mem:/{print $2 " total, " $7 " available"}')"
info "Disk sa /: $(df -h / | awk 'NR==2{print $4 " available"}')"

if grep -qw sse4_2 /proc/cpuinfo 2>/dev/null; then
  ok "May SSE4.2 ang CPU. Idi-disable pa rin ang ML dahil search-only ang single node natin."
else
  warn "Walang SSE4.2. Ilalapat ang xpack.ml.enabled: false para gumana sa lumang CPU."
fi

current_map_count="$(sysctl -n vm.max_map_count 2>/dev/null || printf 'unknown')"
info "vm.max_map_count ngayon: $current_map_count; recommended target sa Elasticsearch 9.x: 1048576"

if command -v node >/dev/null 2>&1; then
  node_version="$(node --version)"
  node_major="${node_version#v}"
  node_major="${node_major%%.*}"
  if (( node_major >= MINIMUM_NODE_MAJOR )); then
    ok "Node.js $node_version ay pasado. Ang updated target noong July 2026 ay Node.js 24.x, pero puwede na ito para sa single-node CLI."
  else
    warn "Node.js $node_version ay luma; kailangan natin ng Node.js 20 pataas. Ia-upgrade ko sa Node.js 24.x."
  fi
else
  node_major=0
  say "Wala ka pang Node.js; install ko na muna ang Node.js 24.x."
fi

if command -v dpkg-query >/dev/null 2>&1 && dpkg-query -W -f='${Status}' elasticsearch 2>/dev/null | grep -q 'install ok installed'; then
  installed_es_version="$(dpkg-query -W -f='${Version}' elasticsearch | cut -d- -f1)"
  installed_es_major="${installed_es_version%%.*}"
  [[ "$installed_es_major" == "$ES_MAJOR" ]] || die "May Elasticsearch $installed_es_version na. Hindi ako gagawa ng silent major upgrade; sundin ang upgrade guide."
  ok "Elasticsearch $installed_es_version ay naka-install. Ang updated target noong July 2026 ay $ES_VERSION, pero puwede ang 9.x para sa single node."
else
  NEW_ES_INSTALL=true
  info "Wala pang Elasticsearch; ilalapat ko ang $ES_VERSION."
fi

say
say "Gagawin ng installer:"
say "  1. Ilalapat ang kulang na base packages at Node.js 24.x kung kailangan."
say "  2. Ive-verify ang Elastic signing-key fingerprint at mag-i-install ng Elasticsearch $ES_VERSION."
say "  3. Ise-set ang local-only single node, 768 MiB heap, ML off, at vm.max_map_count=1048576."
say "  4. Idi-disable ang auth/TLS at itatali ang HTTP endpoint sa 127.0.0.1 lang."
say "  5. I-e-enable at sisimulan ang elasticsearch.service."

if $DRY_RUN; then
  say
  ok "Dry-run lang ito: walang package, config, service, o security setting na binago."
  exit 0
fi

if ! $ASSUME_YES; then
  printf '\nItuloy ang installation? [y/N] '
  read -r answer
  [[ "$answer" =~ ^[Yy]$ ]] || die "Kinansela; walang binago."
fi

if (( ${#SUDO[@]} > 0 )); then
  "${SUDO[@]}" -v
fi
TEMP_DIR="$(mktemp -d)"

if ! $NEW_ES_INSTALL; then
  if ! "${SUDO[@]}" grep -Fq "$MANAGED_BEGIN" /etc/elasticsearch/elasticsearch.yml \
    && ! "${SUDO[@]}" grep -Fq "$LEGACY_MANAGED_BEGIN" /etc/elasticsearch/elasticsearch.yml; then
    die "May existing Elasticsearch pero hindi ito managed ng installer na ito. Hindi ko idi-disable ang security o papalitan ang config nang tahimik."
  fi
  ok "Existing Elasticsearch config ay kinilala bilang managed rerun."
fi

info "Ina-update ang APT metadata at base packages."
sudo_run apt-get update
sudo_run env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg apt-transport-https iproute2

port_9200_listeners="$(ss -H -ltn 2>/dev/null | awk '$4 ~ /:9200$/ {print $4}' || true)"
if [[ -n "$port_9200_listeners" ]] && ! "${SUDO[@]}" systemctl is-active --quiet elasticsearch.service; then
  die "May ibang listener na sa TCP 9200: $port_9200_listeners. Hindi ko ito aagawan ng port."
fi

if (( node_major < MINIMUM_NODE_MAJOR )); then
  info "Inaayos ang official NodeSource repository para sa Node.js ${NODE_MAJOR}.x."
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o "$TEMP_DIR/nodesource.key"
  actual_nodesource_fingerprint="$(gpg --show-keys --with-colons "$TEMP_DIR/nodesource.key" | awk -F: '$1 == "fpr" {print $10; exit}')"
  [[ "$actual_nodesource_fingerprint" == "$NODESOURCE_KEY_FINGERPRINT" ]] \
    || die "Hindi tugma ang NodeSource key fingerprint. Expected $NODESOURCE_KEY_FINGERPRINT, nakuha $actual_nodesource_fingerprint."
  gpg --dearmor --yes --output "$TEMP_DIR/nodesource.gpg" "$TEMP_DIR/nodesource.key"
  sudo_run install -o root -g root -m 0644 "$TEMP_DIR/nodesource.gpg" /usr/share/keyrings/nodesource.gpg
  cat >"$TEMP_DIR/nodesource.sources" <<EOF
Types: deb
URIs: https://deb.nodesource.com/node_${NODE_MAJOR}.x
Suites: nodistro
Components: main
Architectures: $architecture
Signed-By: /usr/share/keyrings/nodesource.gpg
EOF
  sudo_run install -o root -g root -m 0644 "$TEMP_DIR/nodesource.sources" /etc/apt/sources.list.d/nodesource.sources
  sudo_run apt-get update
  sudo_run env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi

installed_node_version="$(node --version 2>/dev/null || true)"
installed_node_major="${installed_node_version#v}"
installed_node_major="${installed_node_major%%.*}"
[[ "$installed_node_major" =~ ^[0-9]+$ ]] && (( installed_node_major >= MINIMUM_NODE_MAJOR )) \
  || die "Hindi naging available ang Node.js 20 pataas pagkatapos ng installation."
ok "Node.js $installed_node_version ay handa."

if $NEW_ES_INSTALL; then
  info "Dina-download at vine-verify ang Elastic signing key."
  curl -fsSL https://artifacts.elastic.co/GPG-KEY-elasticsearch -o "$TEMP_DIR/elasticsearch.key"
  actual_fingerprint="$(gpg --show-keys --with-colons "$TEMP_DIR/elasticsearch.key" | awk -F: '$1 == "fpr" {print $10; exit}')"
  [[ "$actual_fingerprint" == "$ELASTIC_KEY_FINGERPRINT" ]] \
    || die "Hindi tugma ang Elastic key fingerprint. Expected $ELASTIC_KEY_FINGERPRINT, nakuha $actual_fingerprint."
  gpg --dearmor --yes --output "$TEMP_DIR/elasticsearch-keyring.gpg" "$TEMP_DIR/elasticsearch.key"
  sudo_run install -o root -g root -m 0644 "$TEMP_DIR/elasticsearch-keyring.gpg" /usr/share/keyrings/elasticsearch-keyring.gpg

  printf '%s\n' "deb [signed-by=/usr/share/keyrings/elasticsearch-keyring.gpg] https://artifacts.elastic.co/packages/${ES_MAJOR}.x/apt stable main" >"$TEMP_DIR/elastic-${ES_MAJOR}.x.list"
  sudo_run install -o root -g root -m 0644 "$TEMP_DIR/elastic-${ES_MAJOR}.x.list" "/etc/apt/sources.list.d/elastic-${ES_MAJOR}.x.list"
  sudo_run apt-get update

  if ! apt-cache madison elasticsearch | awk '{print $3}' | cut -d- -f1 | grep -Fxq "$ES_VERSION"; then
    die "Hindi available ang pinned Elasticsearch $ES_VERSION sa repository. Huwag manghula ng version; tingnan ang README manual check."
  fi
  sudo_run env DEBIAN_FRONTEND=noninteractive apt-get install -y "elasticsearch=$ES_VERSION"
fi

info "Ise-set ang recommended vm.max_map_count=1048576."
printf '%s\n' 'vm.max_map_count=1048576' >"$TEMP_DIR/99-elasticsearch-single-node.conf"
sudo_run install -o root -g root -m 0644 "$TEMP_DIR/99-elasticsearch-single-node.conf" /etc/sysctl.d/99-elasticsearch-single-node.conf
sudo_run sysctl -w vm.max_map_count=1048576

config_file=/etc/elasticsearch/elasticsearch.yml
"${SUDO[@]}" test -f "$config_file" || die "Hindi nakita ang $config_file pagkatapos ng package installation."
backup_file=""

reconcile_elasticsearch_config() {
  local pass_name="$1"
  local original="$TEMP_DIR/elasticsearch.${pass_name}.original.yml"
  local reconciled="$TEMP_DIR/elasticsearch.${pass_name}.yml"

  backup_file="${config_file}.backup.$(date -u +%Y%m%dT%H%M%SZ).${pass_name}"
  sudo_run cp --preserve=mode,ownership,timestamps "$config_file" "$backup_file"
  info "Backup ng Elasticsearch config: $backup_file"

  "${SUDO[@]}" cat "$config_file" >"$original"
  awk -v begin="$MANAGED_BEGIN" -v end="$MANAGED_END" -v legacy_begin="$LEGACY_MANAGED_BEGIN" -v legacy_end="$LEGACY_MANAGED_END" '
    /BEGIN SECURITY AUTO CONFIGURATION/ {security_auto=1; print "# codexIndexElasticsearch removed Elastic security auto-configuration block"; next}
    /END SECURITY AUTO CONFIGURATION/ && security_auto {security_auto=0; next}
    security_auto {next}
    $0 == begin || $0 == legacy_begin {managed=1; next}
    $0 == end || $0 == legacy_end {managed=0; next}
    !managed {
      if ($0 ~ /^[[:space:]]*(cluster\.name|node\.name|network\.host|http\.host|http\.port|discovery\.type|discovery\.seed_hosts|cluster\.initial_master_nodes|xpack\.ml\.enabled|xpack\.security\.enabled|xpack\.security\.autoconfiguration\.enabled):/) {
        print "# codexIndexElasticsearch disabled: " $0
      } else {
        print
      }
    }
  ' "$original" >"$reconciled"

  cat >>"$reconciled" <<EOF

$MANAGED_BEGIN
cluster.name: $ES_CLUSTER_NAME
node.name: "$(hostname -s)"
network.host: 127.0.0.1
http.host: 127.0.0.1
http.port: 9200
discovery.type: single-node
xpack.ml.enabled: false
xpack.security.enabled: false
xpack.security.autoconfiguration.enabled: false
$MANAGED_END
EOF
  sudo_run install -o root -g elasticsearch -m 0660 "$reconciled" "$config_file"
}

wait_for_elasticsearch() {
  local ready=false
  local http_code
  local _attempt
  local headers="$TEMP_DIR/elasticsearch-health.headers"
  local body="$TEMP_DIR/elasticsearch-health.json"

  for _attempt in $(seq 1 90); do
    http_code="$(curl -sS -D "$headers" -o "$body" -w '%{http_code}' http://127.0.0.1:9200 2>/dev/null || true)"
    if [[ "$http_code" == "200" ]] \
      && grep -Eiq '^x-elastic-product:[[:space:]]*Elasticsearch' "$headers" \
      && grep -Eq '"number"[[:space:]]*:[[:space:]]*"9\.[0-9]+\.[0-9]+' "$body"; then
      ready=true
      break
    fi
    sleep 2
  done

  if ! $ready; then
    warn "Hindi naging ready ang Elasticsearch sa loob ng 3 minuto. Heto ang huling service logs:"
    "${SUDO[@]}" journalctl -u elasticsearch.service -n 80 --no-pager || true
    die "Walang verified Elasticsearch 9 response. Ayusin muna ang startup error; config backup: $backup_file"
  fi
}

verify_localhost_binding() {
  local listeners
  local listener
  local unexpected=""
  listeners="$(ss -H -ltn 2>/dev/null | awk '$4 ~ /:9200$/ {print $4}')"
  [[ -n "$listeners" ]] || die "Walang TCP listener sa port 9200 kahit pumasa ang HTTP check."
  while IFS= read -r listener; do
    case "$listener" in
      127.0.0.1:9200|'[::1]:9200'|'[::ffff:127.0.0.1]:9200') ;;
      *) unexpected+="${unexpected:+, }$listener" ;;
    esac
  done <<<"$listeners"
  [[ -z "$unexpected" ]] \
    || die "May non-localhost Elasticsearch listener: $unexpected. Hindi ligtas ang no-auth mode."
  ok "Network binding verified bilang loopback-only: $(tr '\n' ' ' <<<"$listeners")"
}

reconcile_elasticsearch_config before-first-start

keystore_tool=/usr/share/elasticsearch/bin/elasticsearch-keystore
[[ -x "$keystore_tool" ]] || die "Hindi nakita ang Elasticsearch keystore tool: $keystore_tool"
keystore_file=/etc/elasticsearch/elasticsearch.keystore
"${SUDO[@]}" test -f "$keystore_file" || die "Hindi nakita ang Elasticsearch keystore: $keystore_file"
keystore_entries="$("${SUDO[@]}" env ES_PATH_CONF=/etc/elasticsearch "$keystore_tool" list)"
security_keystore_entries=(
  xpack.security.http.ssl.keystore.secure_password
  xpack.security.transport.ssl.keystore.secure_password
  xpack.security.transport.ssl.truststore.secure_password
)
keystore_cleanup_needed=false
for secure_setting in "${security_keystore_entries[@]}"; do
  if grep -Fxq "$secure_setting" <<<"$keystore_entries"; then
    keystore_cleanup_needed=true
    break
  fi
done

if $keystore_cleanup_needed; then
  keystore_original_owner="$("${SUDO[@]}" stat -c '%U:%G' "$keystore_file")"
  keystore_original_mode="$("${SUDO[@]}" stat -c '%a' "$keystore_file")"
  [[ "$keystore_original_owner" == "root:elasticsearch" ]] \
    || die "Unexpected keystore owner: $keystore_original_owner; hindi ko ito babaguhin nang tahimik."
  keystore_backup="${keystore_file}.backup.$(date -u +%Y%m%dT%H%M%SZ)"
  sudo_run cp --preserve=mode,ownership,timestamps "$keystore_file" "$keystore_backup"
  info "Backup ng Elasticsearch keystore: $keystore_backup"
  for secure_setting in "${security_keystore_entries[@]}"; do
    if grep -Fxq "$secure_setting" <<<"$keystore_entries"; then
      info "Inaalis ang unused TLS keystore entry: $secure_setting"
      if ! sudo_run env ES_PATH_CONF=/etc/elasticsearch "$keystore_tool" remove "$secure_setting"; then
        sudo_run cp --preserve=mode,ownership,timestamps "$keystore_backup" "$keystore_file"
        die "Hindi nalinis ang Elasticsearch keystore; ibinalik ko ang backup na $keystore_backup."
      fi
    fi
  done
  keystore_entries_after="$("${SUDO[@]}" env ES_PATH_CONF=/etc/elasticsearch "$keystore_tool" list)"
  for secure_setting in "${security_keystore_entries[@]}"; do
    if grep -Fxq "$secure_setting" <<<"$keystore_entries_after"; then
      sudo_run cp --preserve=mode,ownership,timestamps "$keystore_backup" "$keystore_file"
      die "Naiwan ang $secure_setting; ibinalik ko ang original keystore."
    fi
  done
  if ! sudo_run chown root:elasticsearch "$keystore_file" \
    || ! sudo_run chmod "$keystore_original_mode" "$keystore_file"; then
    sudo_run cp --preserve=mode,ownership,timestamps "$keystore_backup" "$keystore_file"
    die "Hindi naibalik ang keystore metadata; ni-restore ko ang original keystore."
  fi
  keystore_owner="$("${SUDO[@]}" stat -c '%U:%G' "$keystore_file")"
  keystore_mode="$("${SUDO[@]}" stat -c '%a' "$keystore_file")"
  if [[ "$keystore_owner" != "$keystore_original_owner" || "$keystore_mode" != "$keystore_original_mode" ]]; then
    sudo_run cp --preserve=mode,ownership,timestamps "$keystore_backup" "$keystore_file"
    die "Mali ang final keystore metadata; ni-restore ko ang original. Backup: $keystore_backup"
  fi
  ok "Keystore permissions verified: $keystore_owner mode $keystore_mode."
fi

legacy_heap_file=/etc/elasticsearch/jvm.options.d/10-csv-evidence-search.options
heap_file=/etc/elasticsearch/jvm.options.d/10-codex-index-elasticsearch.options
if "${SUDO[@]}" test -f "$legacy_heap_file"; then
  legacy_heap_content="$("${SUDO[@]}" cat "$legacy_heap_file")"
  [[ "$legacy_heap_content" == $'-Xms768m\n-Xmx768m' ]] \
    || die "May legacy heap file na may custom content: $legacy_heap_file. Hindi ko ito buburahin nang tahimik."
  legacy_heap_backup="${legacy_heap_file}.backup.$(date -u +%Y%m%dT%H%M%SZ)"
  sudo_run cp --preserve=mode,ownership,timestamps "$legacy_heap_file" "$legacy_heap_backup"
  sudo_run rm -- "$legacy_heap_file"
  info "Na-migrate ang legacy heap file; backup: $legacy_heap_backup"
fi
printf '%s\n' '-Xms768m' '-Xmx768m' >"$TEMP_DIR/10-codex-index-elasticsearch.options"
sudo_run install -d -o root -g elasticsearch -m 0750 /etc/elasticsearch/jvm.options.d
sudo_run install -o root -g elasticsearch -m 0660 "$TEMP_DIR/10-codex-index-elasticsearch.options" "$heap_file"

info "Ine-enable at sinisimulan ang Elasticsearch. Maaaring abutin ito ng ilang minuto sa lumang makina."
sudo_run systemctl daemon-reload
sudo_run systemctl enable elasticsearch.service
if ! sudo_run systemctl restart elasticsearch.service; then
  warn "Bumagsak ang elasticsearch.service. Heto ang huling application logs:"
  "${SUDO[@]}" tail -n 120 "/var/log/elasticsearch/${ES_CLUSTER_NAME}.log" 2>/dev/null || true
  die "Hindi natapos ang startup; ayusin ang fatal error bago ulitin ang installer."
fi
wait_for_elasticsearch
verify_localhost_binding
ok "Elasticsearch ay sumasagot nang walang credentials sa http://127.0.0.1:9200."
warn "Localhost-only ito. Huwag ilipat sa 0.0.0.0, LAN, tunnel, proxy, o public port habang disabled ang security."

say
say "============================================================"
ok "Tapos na ang local-only Elasticsearch single-node installation."
say "Walang credentials o certificate na kailangan."
say "Susunod: patakbuhin ang node src/cli.mjs doctor"
say "============================================================"
