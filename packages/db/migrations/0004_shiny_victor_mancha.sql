CREATE TABLE "convites_pareamento_qr" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"agente_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"aceito_em" timestamp with time zone,
	"superficie_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "convites_pareamento_qr" ADD CONSTRAINT "convites_pareamento_qr_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convites_pareamento_qr" ADD CONSTRAINT "convites_pareamento_qr_agente_id_dispositivos_id_fk" FOREIGN KEY ("agente_id") REFERENCES "public"."dispositivos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convites_pareamento_qr" ADD CONSTRAINT "convites_pareamento_qr_superficie_id_dispositivos_id_fk" FOREIGN KEY ("superficie_id") REFERENCES "public"."dispositivos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "convites_qr_token_idx" ON "convites_pareamento_qr" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "convites_qr_agente_idx" ON "convites_pareamento_qr" USING btree ("agente_id","expira_em");