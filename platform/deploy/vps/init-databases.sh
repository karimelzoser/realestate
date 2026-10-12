#!/bin/sh
set -eu
# Only freshly generated 64-character hexadecimal passwords enter this init SQL.
# It is mounted only into this project's new PostgreSQL volume; never an existing DB.
for value in "$PRENEURA_MIGRATOR_PASSWORD" "$PRENEURA_APP_PASSWORD" "$PRENEURA_IDP_PASSWORD"; do
  case "$value" in *[!0-9a-f]*) echo 'Database passwords must be generated hex values' >&2; exit 1;; esac
  test "${#value}" -eq 64 || exit 1
done
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE realestate_os_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$PRENEURA_MIGRATOR_PASSWORD';
CREATE ROLE realestate_os_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$PRENEURA_APP_PASSWORD';
CREATE ROLE realestate_os_idp LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$PRENEURA_IDP_PASSWORD';
CREATE DATABASE realestate_os OWNER realestate_os_migrator;
CREATE DATABASE realestate_os_identity OWNER realestate_os_idp;
REVOKE ALL ON DATABASE realestate_os FROM PUBLIC;
GRANT CONNECT ON DATABASE realestate_os TO realestate_os_app;
REVOKE ALL ON DATABASE realestate_os_identity FROM PUBLIC;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname realestate_os <<'SQL'
GRANT USAGE ON SCHEMA public TO realestate_os_app;
ALTER DEFAULT PRIVILEGES FOR ROLE realestate_os_migrator IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO realestate_os_app;
ALTER DEFAULT PRIVILEGES FOR ROLE realestate_os_migrator IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO realestate_os_app;
SQL
