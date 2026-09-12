# ---- build -----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci --workspace @ai-commerce/web --include-workspace-root

COPY apps/web ./apps/web

# The API base path is baked in at build time; the nginx config proxies it to the API.
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

WORKDIR /app/apps/web
RUN npm run build

# ---- runtime ---------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

RUN apk add --no-cache curl
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
