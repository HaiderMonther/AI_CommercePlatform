# ---- deps ------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# The workspace lockfile covers both apps; only the API workspace is installed here.
RUN npm ci --workspace @ai-commerce/api --include-workspace-root

# ---- build -----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/api ./apps/api

WORKDIR /app/apps/api
RUN npx prisma generate && npm run build

# ---- runtime ---------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# dumb-init reaps zombies and forwards SIGTERM so Nest shutdown hooks actually run.
RUN apk add --no-cache dumb-init curl \
  && addgroup -S nodejs -g 1001 \
  && adduser -S nestjs -u 1001

COPY --from=deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/apps/api/dist ./dist
COPY --from=build --chown=nestjs:nodejs /app/apps/api/dist-seed ./dist-seed
COPY --from=build --chown=nestjs:nodejs /app/apps/api/node_modules ./apps/api/node_modules
COPY --chown=nestjs:nodejs apps/api/package.json ./package.json
COPY --chown=nestjs:nodejs apps/api/prisma ./prisma

USER nestjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/health/live || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
