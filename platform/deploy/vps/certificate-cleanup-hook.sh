#!/bin/sh
set -eu
umask 077
printf '%s\n' "$CERTBOT_IDENTIFIER" > /challenges/cleanup-requested
# The orchestrator removes only its own exact TXT value after fresh inventory.
# Never call a zone-wide delete endpoint for cleanup.
