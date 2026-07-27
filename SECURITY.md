# Security

## Local-only trust boundary

This project deliberately runs Elasticsearch without authentication or TLS. The
installer binds both Elasticsearch network settings to `127.0.0.1`; only
processes running on the same host can connect through port 9200.

This mode is appropriate only for a single-user, local machine. Every local user
and process on that host must be considered trusted.

## Network exposure

Never change `network.host` or `http.host` to `0.0.0.0`, a LAN address, or a
public interface while security is disabled. Do not forward port 9200 through a
router, tunnel, reverse proxy, container port mapping, or public cloud firewall.

Before adding any remote access or additional untrusted local users, enable
Elasticsearch security, authentication, and TLS and update the client
configuration as one reviewed migration.

## Source data

Codex rollout archives and generated `codexIndex.csv` files may contain personal,
confidential, or regulated information. The repository ignores CSV files by
default, but users remain responsible for access control, retention, backup,
and lawful processing.

## Query boundary

The CLI exposes structured search and verification operations. It does not accept arbitrary Elasticsearch administrative requests or destructive index commands.
