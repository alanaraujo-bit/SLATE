# API do SLATE
#
# Multi-estágio para que a imagem final não carregue o compilador nem as
# dependências de desenvolvimento — o que reduz tanto o tamanho quanto a
# superfície exposta.

# ---- dependências -----------------------------------------------------------
FROM node:24-alpine AS deps
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY services/api/package.json services/api/
COPY packages/db/package.json packages/db/
COPY packages/identidade/package.json packages/identidade/
COPY packages/protocol/package.json packages/protocol/

RUN pnpm install --frozen-lockfile

# ---- runtime ----------------------------------------------------------------
FROM node:24-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /repo

ENV NODE_ENV=production
ENV PORT=4500

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/services/api/node_modules ./services/api/node_modules
COPY --from=deps /repo/packages/db/node_modules ./packages/db/node_modules

COPY pnpm-workspace.yaml package.json ./
COPY services/api ./services/api
COPY packages/db ./packages/db
COPY packages/identidade ./packages/identidade
COPY packages/protocol ./packages/protocol

RUN addgroup -g 1001 -S nodejs && adduser -S slate -u 1001
USER slate

EXPOSE 4500

# O executor é chamado pelo caminho, e não por `pnpm exec`.
#
# `pnpm exec` dentro do contêiner tenta rodar `pnpm install` antes de executar,
# e a instalação falha num ambiente que já tem as dependências no lugar e roda
# sem privilégio de escrita. O sintoma era o contêiner reiniciando em laço com
# um erro sobre install, sem nenhuma menção ao servidor.
CMD ["./services/api/node_modules/.bin/tsx", "services/api/src/main.ts"]
