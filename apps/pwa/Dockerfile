# PWA do SLATE

# ---- dependências -----------------------------------------------------------
FROM node:24-alpine AS deps
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/pwa/package.json apps/pwa/
COPY packages/design-system/package.json packages/design-system/
COPY packages/identidade/package.json packages/identidade/
COPY packages/protocol/package.json packages/protocol/

RUN pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/pwa/node_modules ./apps/pwa/node_modules
COPY --from=deps /repo/packages/design-system/node_modules ./packages/design-system/node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# Gera os ícones e o service worker versionado antes de compilar.
RUN pnpm --filter @slate/pwa run build

# ---- runtime ----------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=build --chown=node:node /repo/apps/pwa/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/pwa/.next/static ./apps/pwa/.next/static
COPY --from=build --chown=node:node /repo/apps/pwa/public ./apps/pwa/public

USER node
EXPOSE 3000

CMD ["node", "apps/pwa/server.js"]
