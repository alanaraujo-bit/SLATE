import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Contas, sessões e dispositivos (ADR-0005).
 *
 * Separado do schema do plano de trabalho porque são domínios sem relação: o
 * plano é ferramenta interna e temporária, isto é o produto.
 */

export const papelDispositivo = pgEnum("papel_dispositivo", ["agent", "surface"]);

export const situacaoDispositivo = pgEnum("situacao_dispositivo", [
  "pendente",
  "ativo",
  "revogado",
]);

export const usuarios = pgTable(
  "usuarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Guardado em minúsculas; a unicidade é sobre esta forma. */
    email: text("email").notNull(),
    nome: text("nome"),
    /** Formato `scrypt$N$r$p$sal$hash` — os parâmetros viajam junto. */
    senhaHash: text("senha_hash").notNull(),
    emailVerificadoEm: timestamp("email_verificado_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("usuarios_email_idx").on(t.email)],
);

export const sessoes = pgTable(
  "sessoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    /**
     * SHA-256 do token, nunca o token.
     *
     * Um vazamento do banco não entrega sessões utilizáveis — o atacante teria
     * o hash, e é o valor original que o cookie carrega.
     */
    tokenHash: text("token_hash").notNull(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    /** Para a pessoa reconhecer a sessão numa lista e encerrar o que não é dela. */
    agenteUsuario: text("agente_usuario"),
    ultimoUsoEm: timestamp("ultimo_uso_em", { withTimezone: true }).notNull().defaultNow(),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessoes_token_idx").on(t.tokenHash),
    index("sessoes_usuario_idx").on(t.usuarioId),
    index("sessoes_expiracao_idx").on(t.expiraEm),
  ],
);

export const dispositivos = pgTable(
  "dispositivos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    papel: papelDispositivo("papel").notNull(),
    nome: text("nome").notNull(),
    /** Chave pública em SPKI + base64url. É a identidade do dispositivo. */
    chavePublica: text("chave_publica").notNull(),
    algoritmo: text("algoritmo").notNull(),
    situacao: situacaoDispositivo("situacao").notNull().default("pendente"),
    /**
     * Escopos concedidos, separados por espaço.
     *
     * Texto e não enum: a lista de escopos cresce com o produto, e cada
     * acréscimo exigiria migração de tipo se fosse enum.
     */
    escopos: text("escopos").notNull().default(""),
    ultimoAcessoEm: timestamp("ultimo_acesso_em", { withTimezone: true }),
    revogadoEm: timestamp("revogado_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A mesma chave pública não pode existir duas vezes, nem sob contas
    // diferentes: isso permitiria a um dispositivo revogado voltar sob outra
    // conta com a mesma identidade.
    uniqueIndex("dispositivos_chave_idx").on(t.chavePublica),
    index("dispositivos_usuario_idx").on(t.usuarioId),
  ],
);

/**
 * Desafios de prova de posse usados antes de emitir acesso à sinalização.
 *
 * O nonce é guardado apenas como hash. Mesmo não sendo uma credencial de longa
 * duração, tratá-lo como segredo evita que uma leitura acidental do banco
 * permita responder a um desafio ainda aberto.
 */
export const desafiosSinalizacao = pgTable(
  "desafios_sinalizacao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dispositivoId: uuid("dispositivo_id")
      .notNull()
      .references(() => dispositivos.id, { onDelete: "cascade" }),
    nonceHash: text("nonce_hash").notNull(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    usadoEm: timestamp("usado_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("desafios_sinalizacao_nonce_idx").on(t.nonceHash),
    index("desafios_sinalizacao_dispositivo_idx").on(t.dispositivoId),
    index("desafios_sinalizacao_expiracao_idx").on(t.expiraEm),
  ],
);

/** Tokens opacos, curtos e de uso único para autenticar o upgrade WSS. */
export const tokensSinalizacao = pgTable(
  "tokens_sinalizacao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dispositivoId: uuid("dispositivo_id")
      .notNull()
      .references(() => dispositivos.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    usadoEm: timestamp("usado_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tokens_sinalizacao_token_idx").on(t.tokenHash),
    index("tokens_sinalizacao_dispositivo_idx").on(t.dispositivoId),
    index("tokens_sinalizacao_expiracao_idx").on(t.expiraEm),
  ],
);

export const pedidosPareamento = pgTable(
  "pedidos_pareamento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    /** Hash do código, pelo mesmo motivo do token de sessão. */
    codigoHash: text("codigo_hash").notNull(),
    chavePublicaSolicitante: text("chave_publica_solicitante").notNull(),
    algoritmo: text("algoritmo").notNull(),
    nomeSolicitante: text("nome_solicitante").notNull(),
    tentativas: integer("tentativas").notNull().default(0),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    confirmadoEm: timestamp("confirmado_em", { withTimezone: true }),
    confirmadoPorDispositivoId: uuid("confirmado_por_dispositivo_id").references(
      () => dispositivos.id,
      { onDelete: "set null" },
    ),
    bloqueadoEm: timestamp("bloqueado_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pareamento_usuario_idx").on(t.usuarioId)],
);

/**
 * Convite exibido como QR no computador e consumido uma única vez pelo PWA.
 * O banco guarda somente o hash do token presente no QR.
 */
export const convitesPareamentoQr = pgTable(
  "convites_pareamento_qr",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    agenteId: uuid("agente_id")
      .notNull()
      .references(() => dispositivos.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    aceitoEm: timestamp("aceito_em", { withTimezone: true }),
    superficieId: uuid("superficie_id").references(() => dispositivos.id, {
      onDelete: "set null",
    }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("convites_qr_token_idx").on(t.tokenHash),
    index("convites_qr_agente_idx").on(t.agenteId, t.expiraEm),
  ],
);

/**
 * Tentativas de entrada, para limitar força bruta.
 *
 * Guarda a chave de agrupamento — conta ou origem — e não o e-mail digitado,
 * para que a tabela não vire um registro de e-mails testados por um atacante.
 */
export const tentativasEntrada = pgTable(
  "tentativas_entrada",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chave: text("chave").notNull(),
    ocorridaEm: timestamp("ocorrida_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tentativas_chave_idx").on(t.chave, t.ocorridaEm)],
);

/** Token de recuperação de senha. O envio depende da AÇÃO-004. */
export const pedidosRecuperacao = pgTable(
  "pedidos_recuperacao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    usadoEm: timestamp("usado_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("recuperacao_token_idx").on(t.tokenHash)],
);

export type Usuario = typeof usuarios.$inferSelect;
export type Sessao = typeof sessoes.$inferSelect;
export type Dispositivo = typeof dispositivos.$inferSelect;
export type PedidoPareamento = typeof pedidosPareamento.$inferSelect;
export type ConvitePareamentoQr = typeof convitesPareamentoQr.$inferSelect;
