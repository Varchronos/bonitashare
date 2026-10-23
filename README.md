# bonitashare

pnpm monorepo:

- `apps/api`: Fastify API (uploads, sessions, downloads)
- `apps/worker`: BullMQ file-processing worker (thumbnails, reconcile sweep, purge of deleted files)
- `apps/web`: Astro frontend
- `packages/core`: shared db, storage, queue and shutdown code, plus the drizzle migrations
- `packages/shared-types`: types shared by api and web

Everything runs in Docker for development. Run the commands below from the repo root.

Each app has its own `.env`. Copy it from the `.env.example` next to it. `apps/worker/.env` holds only
the db, redis and s3 settings. Its shared values (db, redis, s3 credentials and buckets) must match
`apps/api/.env`.

## Daily commands

### Start / stop

```sh
docker compose up -d                 # start everything (2 api replicas, worker, web, postgres, redis, storage)
docker compose down                  # stop everything (data volumes are kept)
docker compose ps                    # status and health
docker compose logs -f api worker    # follow logs (add web, postgres, ...)
docker compose restart worker        # restart one service
```

### After changing dependencies or a package.json

```sh
pnpm install
docker compose up -d --build --renew-anon-volumes api worker web
```

Each container's `node_modules` lives in an anonymous volume. Compose reuses that volume across
rebuilds unless you pass `--renew-anon-volumes` (`-V`). Without it, newly added packages, including
workspace packages like `@bonitashare/core`, show up as `ERR_MODULE_NOT_FOUND` inside the container.

### Database (drizzle, run from `packages/core`)

```sh
pnpm db:generate    # create a migration from changes to packages/core/src/db/schema.ts
pnpm db:migrate     # apply pending migrations
pnpm db:studio      # open drizzle studio from the host (reads apps/api/.env)
```

`db:generate` and `db:migrate` run inside the api container, so the stack must be up.

### Checks and builds

```sh
pnpm typecheck      # builds shared-types and core, then typechecks every package
pnpm build          # production build of all packages
```

## Notes

- In dev, api and worker run `tsx watch --conditions=development`, which loads `@bonitashare/core`
  straight from `src/`. Edits to core hot-reload without a rebuild. Production and `tsc` use core's
  `dist/`, so run `pnpm typecheck` (or `pnpm --filter @bonitashare/core dev` to rebuild on save) to
  get core changes into editor types.
- `docker compose -f docker-compose.prod.yml build` builds the production images locally.

## File deletion

Deleting a file is a soft delete that can be undone for a day. Removing it from storage happens
later, whenever the worker gets to it.

1. **Delete** (`DELETE /api/v1/files/:id`, the trash button on the upload page) adds a row to
   `file_deletions` with `purge_after = now() + 1 day`. If the file expires sooner, `purge_after` is
   its expiry instead. From that moment:
   - the share page, `/raw` and thumbnail lookups return 404 for everyone, the owner included;
   - the file is gone from the user's file list;
   - its size no longer counts toward the storage quota, but weekly upload usage stays spent
     (`upload_usage` keeps its row).

   Only finished uploads can be deleted this way. In-progress ones are cancelled through tus.
2. **Restore** (`POST /api/v1/files/:id/restore`, from the `/deleted` page) removes the row, if:
   - `purge_after` hasn't passed;
   - the file hasn't expired (checked on its own, in case the expiry changed after the delete);
   - the file still fits the storage quota. Restore takes the same per-user lock as starting an
     upload.

   If the video's HLS status is still `pending`, the restore queues the encode again. Videos already
   `done` keep their HLS, and `failed` ones aren't retried.
3. **Purge.** Every 15 minutes the worker's `purge-deleted-files` job takes up to 50 rows whose
   `purge_after` has passed. For each one it removes the original, the thumbnail and the HLS folder
   from storage, then deletes the `files` row. That also removes its `file_deletions`, `file_videos`
   and album rows. Each file is purged in one transaction that locks its `file_deletions` row, so a
   restore and a purge can't both go through. If a storage call fails, the transaction rolls back
   and the next run tries again.

Processing that is still running when a file is deleted:

- **Thumbnails and posters** finish normally, and the purge removes them along with the file.
- **Video-worker:**
  - It skips a deleted file at the start of a job and leaves its HLS status `pending`, so a restore
    knows to queue the encode again.
  - For sources over 200 MB, it checks again at every 10% of the encode and stops ffmpeg if the file
    was deleted.
  - Every video checks once more before the R2 upload and skips the upload if the file was deleted.

Not handled yet:

- Objects written after a file was purged (a thumbnail finishing at that moment) stay in their
  bucket until there's a lifecycle rule.
- Cloudflare's cache of `THUMB_PUBLIC_BASE_URL` and `HLS_PUBLIC_BASE_URL` isn't purged. Deleted
  thumbnails and HLS files may still be served to anyone who already has their random URL.
- Expired files that were never deleted aren't removed.

## Deploying

Every push to `main` runs `.github/workflows/deploy.yml`: typecheck, build the api/worker/web images
and push them to GHCR tagged with the commit, then SSH to the VPS, where `deploy/deploy.sh` checks out
that commit, pulls its images and restarts what changed (migrations run first). To roll back, run
`~/bonitashare/deploy/deploy.sh <older full commit sha>` on the VPS; migrations are not undone.

One-time setup:

1. Make a key just for deploys: `ssh-keygen -t ed25519 -N '' -f deploy_key -C github-deploy`.
2. On the VPS, add `deploy_key.pub` to `~/.ssh/authorized_keys` with a forced command, so the key can
   only deploy:
   `command="/home/admin/bonitashare/deploy/deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... github-deploy`
3. In the repo's Settings → Secrets and variables → Actions, add `DEPLOY_SSH_KEY` (contents of
   `deploy_key`), `DEPLOY_HOST` (`admin@<VPS IP>`) and `DEPLOY_KNOWN_HOSTS` (the VPS's line from your
   `~/.ssh/known_hosts`, or `ssh-keyscan -t ed25519 <VPS IP>` checked against it).
4. Let the VPS pull the images: either make the `bonitashare-api`, `-worker` and `-web` packages public
   (GitHub → Packages → package settings; they hold no secrets), or run `docker login ghcr.io` on the
   VPS with a token that has only `read:packages`.
5. The VPS fetches the commit with `git fetch`, so its checkout needs a remote it can read without
   your keys. The repo is public, so HTTPS works:
   `git remote set-url origin https://github.com/Varchronos/bonitashare.git`.
