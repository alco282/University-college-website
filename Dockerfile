# ==============================================================================
# Stage 1: Build React Frontend Client
# ==============================================================================
FROM node:20-bookworm-slim AS client-builder

# Patch OS-level packages at build time (ASVS-adjacent hardening: base image
# CVEs are otherwise only patched whenever the upstream `node:20-alpine` tag
# is rebuilt, which can lag behind Alpine's own security advisories).
RUN apt-get update && \
    apt-get upgrade -y && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app/client

# CRA only exposes REACT_APP_* variables that exist during the frontend build.
# The Turnstile sitekey is public; the secret key is never passed to this stage.
ARG REACT_APP_TURNSTILE_SITE_KEY
ARG REACT_COUNTRY_STATE_CITY_REFRESH=0
ENV REACT_APP_TURNSTILE_SITE_KEY=$REACT_APP_TURNSTILE_SITE_KEY \
    REACT_COUNTRY_STATE_CITY_REFRESH=$REACT_COUNTRY_STATE_CITY_REFRESH

COPY client/package*.json ./
# Install frontend dependencies from the committed package manifest.
RUN npm install --audit=false --fund=false

COPY client/ ./

# Vendor the complete react-country-state-city dataset inside the image at
# build time. The host machine does not need Node.js/npm installed.
# The vendor script is idempotent: it reuses a complete local dataset if one
# is already present, and otherwise downloads/verifies the JSON files before
# the React production build.
RUN npm run vendor:geo-data
RUN npm run build

# ==============================================================================
# Stage 2: Build Backend Dependencies
# ==============================================================================
FROM node:20-bookworm-slim AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libvips-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --audit=false --fund=false

COPY . .
# Provision the multilingual ONNX moderation model into the image. Runtime
# inference is fully local; no request is allowed to download model data.
RUN npm run setup:moderation
RUN npm prune --production

# ==============================================================================
# Stage 3: Production Runtime Container
# ==============================================================================
FROM node:20-bookworm-slim AS runner

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    tini \
    wget \
    libvips42 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN mkdir -p /app/uploads && \
    chown -R node:node /app

# Copy only what the runtime actually needs — deliberately NOT a blanket
# `COPY . .`. This means .env, .git, client/src, tests, and any other file
# present in the local working directory at build time can never end up in
# the shipped image, even if .dockerignore had a gap (defense in depth).
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/src ./src
COPY --chown=node:node --from=builder /app/models ./models
COPY --chown=node:node --from=builder /app/schema.sql ./schema.sql

# Compiled React frontend build from Stage 1 (static assets only, no source
# or node_modules from the client build tree).
COPY --chown=node:node --from=client-builder /app/client/build ./client/build
COPY --chown=node:node --from=client-builder /app/client/public/geo-data ./client/public/geo-data

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:5000/api/health || exit 1

EXPOSE 5000

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "src/server.js"]

# ------------------------------------------------------------------------------
# Supply-chain note: for maximum integrity, pin the base image to a specific
# content digest rather than the mutable `node:20-alpine` tag, e.g.:
#   FROM node:20-alpine@sha256:<digest-you-have-verified>
# This repository doesn't have live registry access from this environment to
# fetch/verify a current digest, so the tag is left as-is here — resolve and
# pin the digest as part of your CI pipeline before first production deploy,
# and re-pin on your normal patch cadence.
# ------------------------------------------------------------------------------
