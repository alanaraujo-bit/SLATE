CREATE TABLE "desafios_sinalizacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispositivo_id" uuid NOT NULL,
	"nonce_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens_sinalizacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispositivo_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desafios_sinalizacao" ADD CONSTRAINT "desafios_sinalizacao_dispositivo_id_dispositivos_id_fk" FOREIGN KEY ("dispositivo_id") REFERENCES "public"."dispositivos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens_sinalizacao" ADD CONSTRAINT "tokens_sinalizacao_dispositivo_id_dispositivos_id_fk" FOREIGN KEY ("dispositivo_id") REFERENCES "public"."dispositivos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "desafios_sinalizacao_nonce_idx" ON "desafios_sinalizacao" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "desafios_sinalizacao_dispositivo_idx" ON "desafios_sinalizacao" USING btree ("dispositivo_id");--> statement-breakpoint
CREATE INDEX "desafios_sinalizacao_expiracao_idx" ON "desafios_sinalizacao" USING btree ("expira_em");--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_sinalizacao_token_idx" ON "tokens_sinalizacao" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "tokens_sinalizacao_dispositivo_idx" ON "tokens_sinalizacao" USING btree ("dispositivo_id");--> statement-breakpoint
CREATE INDEX "tokens_sinalizacao_expiracao_idx" ON "tokens_sinalizacao" USING btree ("expira_em");