#!/bin/sh
# Runs the container's command under `doppler run`, which fetches this service's secrets and hands
# them to the command as env vars. The service token comes from a compose secret file and is exported
# only in this process, so it never appears in the image or in `docker inspect`.
set -eu
DOPPLER_TOKEN="$(cat /run/secrets/doppler_token)"
export DOPPLER_TOKEN
# exec so tini's signals reach doppler, which forwards them to the command.
exec doppler run --no-check-version -- "$@"
