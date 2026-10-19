#!/usr/bin/env bash
# Deploys one commit on the VPS: checks it out (for the compose file), pulls that commit's images from
# GHCR and restarts what changed. CI runs it over SSH through a forced command, which passes the commit
# as SSH_ORIGINAL_COMMAND; run it by hand with the commit as the argument, e.g. to roll back:
#
#   ~/bonitashare/deploy/deploy.sh <full commit sha>
#
# Rolling back restores the old code only. Migrations already applied stay applied.

# Everything runs from main(), which bash reads in full before starting: the checkout below can replace
# this file mid-run, and bash otherwise reads scripts as it goes.
main() {
    set -euo pipefail

    local sha=${SSH_ORIGINAL_COMMAND:-${1:-}}
    if [[ ! $sha =~ ^[0-9a-f]{40}$ ]]; then
        echo "usage: deploy.sh <full commit sha>" >&2
        exit 2
    fi

    cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.."

    # A deploy started while another is running waits for it instead of interleaving restarts.
    exec 9>/tmp/bonitashare-deploy.lock
    flock 9

    git fetch --quiet origin
    git checkout --quiet --detach "$sha"

    export IMAGE_PREFIX=ghcr.io/varchronos/
    export IMAGE_TAG=$sha
    local compose=(docker compose -f docker-compose.prod.yml)

    # Only these come from GHCR; postgres is built here once and redis/cloudflared are stock images.
    "${compose[@]}" pull migrate api worker web

    local web_before
    web_before=$("${compose[@]}" ps -q web)
    # migrate runs first: api and worker wait for it to succeed.
    "${compose[@]}" up -d --no-build --remove-orphans
    # cloudflared shares web's network namespace, so a recreated web leaves it attached to the old one
    # (and the site returns 502) until it is recreated too.
    if [[ $("${compose[@]}" ps -q web) != "$web_before" ]]; then
        "${compose[@]}" up -d --no-deps --force-recreate cloudflared
    fi

    # Older commits' images stay in GHCR, so the local copies only cost disk.
    docker image prune -af --filter "until=168h" >/dev/null

    echo "deployed $sha"
}

main "$@"
exit
