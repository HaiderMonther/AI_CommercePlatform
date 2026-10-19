# ---- deps ------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# The workspace lockfile covers both apps; only the API workspace is installed here.
# npm hoists almost everything to /app/node_modules; apps/api/node_modules only holds
# version conflicts, so it may not exist — create it so later stages can copy it either way.
RUN npm ci --workspace @ai-commerce/api --include-workspace-root \
  && mkdir -p apps/api/node_modules

# ---- build -----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json package-lock.json ./
COPY apps/api ./apps/api

WORKDIR /app/apps/api
# `prisma generate` writes the client into /app/node_modules/.prisma, so the runtime
# stage must take node_modules from here, not from `deps`.
RUN npx prisma generate && npm run build

# ---- runtime ---------------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production

# dumb-init reaps zombies and forwards SIGTERM so Nest shutdown hooks actually run.
RUN apk add --no-cache dumb-init curl \
  && addgroup -S nodejs -g 1001 \
  && adduser -S nestjs -u 1001

# Same layout as the workspace, so Node resolves apps/api/node_modules first and then
# the hoisted /app/node_modules.
COPY --from=build --chown=nestjs:nodejs /app/node_modules /app/node_modules
COPY --from=build --chown=nestjs:nodejs /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build --chown=nestjs:nodejs /app/apps/api/dist /app/apps/api/dist
COPY --from=build --chown=nestjs:nodejs /app/apps/api/dist-seed /app/apps/api/dist-seed
COPY --chown=nestjs:nodejs apps/api/package.json /app/apps/api/package.json
COPY --chown=nestjs:nodejs apps/api/prisma /app/apps/api/prisma

WORKDIR /app/apps/api
USER nestjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/health/live || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
