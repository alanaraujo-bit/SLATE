# Centro de Controle do SLATE
#
# Roda localmente por decisao do operador (D-007). Este Dockerfile fica para
# o caso de a ferramenta precisar ser hospedada, e porque ja foi validado.
#
# An explicit Dockerfile rather than a buildpack: the pnpm workspace needs a
# specific Node and pnpm pairing, and buildpack autodetection resolved an old
# corepack that cannot activate pnpm 11. Pinning both removes that whole class
# of failure.

# ---- deps -------------------------------------------------------------------
FROM node:24-alpine AS deps
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /repo

# Only the manifests, so the install layer caches independently of source.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/control-center/package.json apps/control-center/
COPY packages/db/package.json packages/db/
COPY packages/roadmap-cli/package.json packages/roadmap-cli/

RUN pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/control-center/node_modules ./apps/control-center/node_modules
COPY --from=deps /repo/packages/db/node_modules ./packages/db/node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @slate/control-center exec next build

# ---- runtime ----------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Run unprivileged.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# `standalone` emits the traced server plus only the node_modules it reaches.
COPY --from=build --chown=nextjs:nodejs /repo/apps/control-center/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/control-center/.next/static ./apps/control-center/.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "apps/control-center/server.js"]
