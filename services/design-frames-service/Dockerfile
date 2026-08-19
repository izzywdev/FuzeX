# design-frames-service — two build inputs now:
#   1. the service itself (vanilla JS, no bundler, no build step)
#   2. webapp/ — a Vite/React Module-Federation remote (scope "fuzex", exposes
#      ./DesignFramesApp) that DOES need a build step. Stage 1 builds it to
#      dist/ and stage 2 copies the built assets in; server.js serves them at
#      /apps/fuzex/ (see the DESIGN_FRAMES_WEBAPP_DIR route).
#
# webapp/'s own package.json/.nvmrc pin Node >=24 (the family's MF-remote
# toolchain floor — see FuzeFront CLAUDE.md "Toolchain baseline"), so the
# builder stage uses node:24-alpine regardless of the runtime stage's line.
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

# Runtime is node:24-alpine, matching the builder. The comment here used to
# justify staying on node:20 because the service declared `engines.node >=18`
# and this repo's CI ran the Node 20 line — both of those premises are gone:
# services/design-frames-service/package.json now declares `>=24.0.0`, .nvmrc is
# 24, and .fuze/manifest.json's `toolchain` block names `node:24-alpine` as the
# family's Docker base. An image running below its own manifest's `engines` floor
# is a disagreement nothing checks, so it is settled here rather than left as a
# "separate decision" that never gets made.
FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund || true
COPY . .
# Built Module-Federation remote (webapp/'s dist/) — served at /apps/fuzex/ by
# server.js's DESIGN_FRAMES_WEBAPP_DIR route, same-origin, no CORS needed.
COPY --from=webapp-builder /webapp/dist ./webapp-dist

ENV DESIGN_FRAMES_HOST=0.0.0.0
ENV DESIGN_FRAMES_PORT=4400
ENV DESIGN_FRAMES_DATA_DIR=/data/features
ENV DESIGN_FRAMES_WEBAPP_DIR=/app/webapp-dist
RUN mkdir -p /data/features && chown -R node:node /data/features /app
VOLUME ["/data/features"]

EXPOSE 4400
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.DESIGN_FRAMES_PORT||4400)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "server.js"]
