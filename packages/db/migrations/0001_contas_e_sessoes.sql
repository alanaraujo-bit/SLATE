CREATE TYPE "public"."papel_dispositivo" AS ENUM('agent', 'surface');--> statement-breakpoint
CREATE TYPE "public"."situacao_dispositivo" AS ENUM('pendente', 'ativo', 'revogado');--> statement-breakpoint
CREATE TABLE "dispositivos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"papel" "papel_dispositivo" NOT NULL,
	"nome" text NOT NULL,
	"chave_publica" text NOT NULL,
	"algoritmo" text NOT NULL,
	"situacao" "situacao_dispositivo" DEFAULT 'pendente' NOT NULL,
	"escopos" text DEFAULT '' NOT NULL,
	"ultimo_acesso_em" timestamp with time zone,
	"revogado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pedidos_pareamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"codigo_hash" text NOT NULL,
	"chave_publica_solicitante" text NOT NULL,
	"algoritmo" text NOT NULL,
	"nome_solicitante" text NOT NULL,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"confirmado_em" timestamp with time zone,
	"bloqueado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pedidos_recuperacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"agente_usuario" text,
	"ultimo_uso_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tentativas_entrada" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chave" text NOT NULL,
	"ocorrida_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nome" text,
	"senha_hash" text NOT NULL,
	"email_verificado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispositivos" ADD CONSTRAINT "dispositivos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos_pareamento" ADD CONSTRAINT "pedidos_pareamento_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos_recuperacao" ADD CONSTRAINT "pedidos_recuperacao_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dispositivos_chave_idx" ON "dispositivos" USING btree ("chave_publica");--> statement-breakpoint
CREATE INDEX "dispositivos_usuario_idx" ON "dispositivos" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "pareamento_usuario_idx" ON "pedidos_pareamento" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recuperacao_token_idx" ON "pedidos_recuperacao" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sessoes_token_idx" ON "sessoes" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessoes_usuario_idx" ON "sessoes" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "sessoes_expiracao_idx" ON "sessoes" USING btree ("expira_em");--> statement-breakpoint
CREATE INDEX "tentativas_chave_idx" ON "tentativas_entrada" USING btree ("chave","ocorrida_em");--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_email_idx" ON "usuarios" USING btree ("email");