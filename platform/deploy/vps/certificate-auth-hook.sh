#!/bin/sh
set -eu
umask 077
test "$CERTBOT_IDENTIFIER" = 'realestate-test.aipreneura.com' || exit 1
# The connected DNS tool writes this exact challenge, verifies authoritative
# propagation, then creates the marker. No account API token is put in GitHub.
printf '%s\n' "$CERTBOT_IDENTIFIER" > /challenges/identifier
printf '%s\n' "$CERTBOT_VALIDATION" > /challenges/validation
attempt=0
while [ ! -f /challenges/ready ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 600 ]; then echo 'DNS authorization marker timed out' >&2; exit 1; fi
  sleep 1
done
