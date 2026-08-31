# design-frames-service — two build inputs, now three published images:
#   1. the service itself (vanilla JS, no bundler, no build step) — the
#      `vanilla` stage below. REST API + the /site review surface only.
#   2. webapp/ — a Vite/React Module-Federation remote (scope "fuzex", exposes
#      ./DesignFramesApp) that DOES need a build step, built once here
#      (`webapp-builder`) and consumed by the `webapp-mfe` stage below.
#
# webapp/'s remote used to be served BY server.js itself
# (DESIGN_FRAMES_WEBAPP_DIR route, `serveWebappAsset`) — a Node/Express-style
# static-file serving stage, the one deviation in the family from the
# nginx-serving-stage standard every other MF remote uses (FuzeAgent,
# FuzeBI's frontend-mfe, FuzeService, FuzeContact, FuzeSales, ...). That
# deviation is why the federation gate's layer-4 (nginx conf) extractor could
# not read this repo and carved it out of enforcement. Migrated here: the
# `webapp-mfe` stage below is the family-standard nginx:alpine image, and
# server.js no longer serves /apps/fuzex/ at all (removed, not left as dead
# code the two serving paths could drift against).
#
# webapp/'s own package.json/.nvmrc pin Node >=24 (the family's MF-remote
# toolchain floor — see FuzeFront CLAUDE.md "Toolchain baseline"), so the
# builder stage uses node:24-alpine regardless of the vanilla stage's line.
#
# webapp/'s dependency on the private @izzywdev/fuzefront-design-system
# (GitHub Packages) needs a read:packages token at `npm install` time.
# Supplied via a BuildKit secret mount (`--mount=type=secret,id=github_token`)
# so the token never lands in an image layer or the build cache — webapp/.npmrc
# already reads it as ${GITHUB_TOKEN}.
FROM node:24-alpine AS webapp-builder
WORKDIR /webapp
COPY webapp/package.json webapp/.npmrc ./
RUN --mount=type=secret,id=github_token \
    export GITHUB_TOKEN="$(cat /run/secrets/github_token 2>/dev/null || true)" && \
    npm install --no-audit --no-fund
COPY webapp/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# webapp-mfe — the family-standard nginx-serving stage for the
# Module-Federation remote. NOT the default build target: `docker build .`
# with no `--target` still produces only the unchanged `vanilla` image at the
# bottom of this file (this stage is unreferenced by it, so BuildKit never
# even builds it); producing this image requires `--target webapp-mfe`
# (wired in design-frames-service-ci.yml / release.yml), mirroring how
# `postgres-tier` below is opted into.
#
# webapp/vite.config.ts sets `base: '/apps/fuzex/'` and `assetsDir: ''`, so
# the build emits remoteEntry.js and every chunk flat at the root of dist/ —
# so, matching FuzeAgent's and FuzeBI's frontend-mfe images, the FLAT build
# output is copied straight to the nginx docroot and webapp/nginx.conf
# aliases the /apps/fuzex/ URL prefix back onto it (see nginx.conf's comment
# for why this must be `alias`, not a nested output directory — the two must
# agree or requests 404 behind a 200 remoteEntry.js).
# nginx-unprivileged, NOT nginx:alpine. The stock image runs its master process
# as root, which Semgrep's dockerfile.security.missing-user flags as an error --
# correctly: a compromise of the process is then a compromise of the container.
#
# `USER nginx` alone on the stock image does not work and would ship a broken
# container: an unprivileged process cannot bind :80, and cannot write
# /var/run/nginx.pid or /var/cache/nginx. The unprivileged image is built for
# this -- it runs as uid 101 and listens on 8080 -- so the port moves with it,
# here and in deploy/helm/fuzex/templates/webapp-mfe.yaml. Those two must agree.
FROM nginxinc/nginx-unprivileged:alpine AS webapp-mfe
COPY webapp/nginx.conf /etc/nginx/conf.d/default.conf
# NOT under conf.d/: the base image auto-includes conf.d/*.conf inside the
# http block, so a snippet there would be applied globally AND again at each
# explicit include below -- emitting every header twice.
COPY webapp/common-headers.conf /etc/nginx/common-headers.conf
COPY --from=webapp-builder /webapp/dist /usr/share/nginx/html

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null 2>&1 || exit 1

# Explicit, though nginxinc/nginx-unprivileged already runs as this uid.
# Semgrep's dockerfile.security.missing-user reads THIS file, not the base
# image metadata, so without the line the invariant is invisible to it --
# and more importantly invisible to a future edit that swaps the base back
# to nginx:alpine and silently restores root.
USER 101

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]

# ---------------------------------------------------------------------------
# Postgres LIFECYCLE TIER (services/design-frames-service/backend/ +
# services/design-frames-service/db/) — see ../docs/postgres-tier.md.
# Isolated Express+pg+TypeScript process, its OWN port (4410,
# backend/src/index.ts), never mounted into or served by the vanilla
# server.js above. NOT the default build target: `docker build .` with no
# `--target` still produces only the unchanged vanilla image below (the
# stages here are unreferenced by it, so BuildKit never even builds them);
# producing this tier requires `--target postgres-tier` (wired in
# design-frames-service-ci.yml / release.yml).
#
# node:24-alpine, not node:20 — backend/package.json AND this service's own
# top-level package.json both already declare `engines.node: >=24.0.0`. This
# does not touch the vanilla runtime stage below, which stays on its own
# line per its own comment ("bumping the runtime line is a separate,
# repo-wide toolchain decision") — the bump here is scoped to this new,
# separately-published tier only.
#
# backend/package.json depends on the LOCAL workspace package @fuzex/identity
# via `file:../../../packages/identity` (packages/identity/, repo root) —
# OUTSIDE this Dockerfile's own build context (services/design-frames-service/),
# so it cannot be `COPY`-ed directly. Supplied as the Buildx ADDITIONAL build
# context named "identity" (`--build-context identity=./packages/identity`,
# resolved relative to the invoking command's cwd — the repo-root checkout in
# both design-frames-service-ci.yml and release.yml — NOT relative to the
# primary `context` above).
# The stages below recreate the repo's own relative directory depth
# (.../services/design-frames-service/backend sits 3 levels below
# packages/identity) so `file:../../../packages/identity` resolves inside the
# image exactly as it does in the checkout, with no edit to that package.json.
FROM node:24-alpine AS identity-builder
WORKDIR /build/packages/identity
COPY --from=identity package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY --from=identity . .
RUN npm run build

FROM node:24-alpine AS backend-builder
WORKDIR /build/services/design-frames-service/backend
COPY backend/package.json backend/package-lock.json ./
COPY --from=identity-builder /build/packages/identity /build/packages/identity
# --install-links: copies the local @fuzex/identity package.json's declared
# `files` (dist/, package.json, README.md) into node_modules instead of
# symlinking to /build/packages/identity — a symlink would dangle once this
# stage's absolute paths are left behind by the final COPY --from below.
RUN npm install --no-audit --no-fund --install-links
COPY backend/ ./
# NOT `npm prune --omit=dev` — verified (locally, outside Docker, since this
# sandbox has no daemon) that `npm prune` re-resolves the LOCAL `file:`
# dependency `@fuzex/identity` back into a relative SYMLINK, discarding the
# `--install-links` copy above. That symlink
# (node_modules/@fuzex/identity -> ../../../../../packages/identity) only
# resolves inside THIS stage, where /build/packages/identity still exists —
# it dangles the moment node_modules is copied into the final stage below,
# and `require('@fuzex/identity')` (backend/src/lib/identity.ts) then throws
# MODULE_NOT_FOUND at boot, before the app ever binds its port. A fresh
# `--omit=dev --install-links` install (rather than pruning the existing
# one) keeps the real copy.
RUN npm run build \
    && rm -rf node_modules \
    && npm install --no-audit --no-fund --omit=dev --install-links

# Final stage for the Postgres lifecycle tier — ONE image, shared by BOTH the
# backend Deployment (`node backend/dist/index.js`, port 4410) AND the
# db-migration Job (`db/migrate.sh` against DATABASE_URL — see
# ../db/README.md "pre-sync Argo/Helm Job"), so this adds exactly ONE new
# published image, not two. `bash` + `postgresql-client` are the only extra
# runtime deps migrate.sh needs — it is otherwise dependency-free (no
# node_modules, no pg client library; see db/README.md).
FROM node:24-alpine AS postgres-tier
RUN apk add --no-cache bash postgresql-client
WORKDIR /app
COPY --from=backend-builder /build/services/design-frames-service/backend/dist ./backend/dist
COPY --from=backend-builder /build/services/design-frames-service/backend/node_modules ./backend/node_modules
COPY --from=backend-builder /build/services/design-frames-service/backend/package.json ./backend/package.json
# The dual-write projection (docs/postgres-tier.md step 3): backend/src/lib/
# {fileStore,manifestSchema,stampLib}.ts each `require()` a sibling of THIS
# service's own ../lib/{store,schema,stamp}.js at a computed runtime path
# (`path.join(__dirname, '..', '..', '..', 'lib', '<file>.js')` — 3 levels up
# from backend/dist/lib/, i.e. THIS image's /app/lib/, mirroring the repo's
# own layout, services/design-frames-service/{backend,lib}/ as siblings).
# None of the three touch the filesystem at require()-time (verified by
# reading lib/store.js — DATA_DIR is only a resolved path constant), so this
# copy alone is enough to boot; actual dual-write reads/writes need
# DESIGN_FRAMES_DATA_DIR to point at the SAME data volume the frontend
# Deployment mounts (wired in deploy/helm/fuzex/templates/postgres-tier-deployment.yaml).
COPY lib/ ./lib/
COPY db/migrate.sh ./db/migrate.sh
COPY db/migrations ./db/migrations
RUN chmod +x ./db/migrate.sh

ENV DESIGN_FRAMES_HOST=0.0.0.0
ENV DESIGN_FRAMES_PG_PORT=4410
# Matches the vanilla stage's own default below and .Values.persistence.mountPath
# — the dual-write projection's fallback when the Deployment doesn't override it.
ENV DESIGN_FRAMES_DATA_DIR=/data/features
EXPOSE 4410
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.DESIGN_FRAMES_PG_PORT||4410)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
# Default command runs the API; the migration Job (Helm) overrides `command`
# to run db/migrate.sh instead — see
# deploy/helm/fuzex/templates/db-migrate-job.yaml.
CMD ["node", "backend/dist/index.js"]

# Runtime stays on node:20-alpine (unchanged): the service's own package.json
# declares `engines.node: >=18.0.0` and the rest of this repo's CI still runs
# on the Node 20 line (see ci.yml, design-frames-service-ci.yml) — server.js
# itself needs no Node 24 feature, only the webapp build tooling does, and
# that's isolated to the builder stage above. Bumping the runtime line is a
# separate, repo-wide toolchain decision, not bundled into this change.
#
# No longer copies webapp-builder's output: the Module-Federation remote is
# served by the `webapp-mfe` (nginx) image above now, not by this process.
# This stage is REST API + the public /site review surface only.
FROM node:24-alpine
WORKDIR /app
# node:24, was node:20. This stage now installs a REAL dependency
# (@izzywdev/fuzefront-service-auth, the machine-token verifier from issue #26)
# whose package.json declares `engines.node: >=24.0.0` — and this service's OWN
# package.json has declared `>=24.0.0` for some time, so the node:20 line was
# already contradicting it. The earlier comment deferred this bump as "a
# separate, repo-wide toolchain decision"; it stops being separable the moment
# the runtime has a dependency it does not satisfy.
COPY package.json .npmrc ./
# .npmrc IS copied and the token IS mounted, both newly required: the auth
# package lives on GitHub Packages under @izzywdev, not on registry.npmjs.org.
# Without these the install resolves it against the public registry and 404s.
#
# A BuildKit secret, NOT an ARG: an ARG is baked into image history and
# `docker history` would print the token. The secret exists only for this RUN.
RUN --mount=type=secret,id=github_token \
    export GITHUB_TOKEN="$(cat /run/secrets/github_token 2>/dev/null || true)" && \
    npm install --omit=dev --no-audit --no-fund
# NOT `|| true`. This install used to swallow its own failure, which was
# survivable only while `dependencies` was empty — every failure mode was a
# no-op. It no longer is: a swallowed failure now yields an image with no
# node_modules, and server.js's `require('@izzywdev/fuzefront-service-auth')`
# throws MODULE_NOT_FOUND at boot, before the port is ever bound. Fail the BUILD
# instead, where it is visible.
COPY . .

ENV DESIGN_FRAMES_HOST=0.0.0.0
ENV DESIGN_FRAMES_PORT=4400
ENV DESIGN_FRAMES_DATA_DIR=/data/features
RUN mkdir -p /data/features && chown -R node:node /data/features /app
VOLUME ["/data/features"]

EXPOSE 4400
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.DESIGN_FRAMES_PORT||4400)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "server.js"]
