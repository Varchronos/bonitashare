# bonitashare

pnpm monorepo:

- `apps/api`: Fastify API (uploads, sessions, downloads)
- `apps/worker`: BullMQ file-processing worker (thumbnails, reconcile sweep)
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
- `docker compose -f docker-compose.prod.yml build` builds the production images. They can't boot yet,
  because there is no prod env or infra.
