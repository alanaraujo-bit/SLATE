import { like, sql } from "drizzle-orm";
import { createDb } from "./index";
import { activityEvents, operatorActions } from "./schema";

/**
 * Migração pontual de dados: remove o conteúdo que ficou em inglês.
 *
 * A interface passou a ser inteiramente em português por decisão do operador.
 * Títulos e descrições dos itens do plano são atualizados pelo próprio seed,
 * mas dois conjuntos de linhas não são alcançados por ele:
 *
 *  - as ações do operador, cujos códigos mudaram de ACTION-00n para AÇÃO-00n,
 *    e que ficariam duplicadas se as antigas permanecessem;
 *  - os eventos de atividade já gravados, que são registros da execução de
 *    montagem do projeto e não têm valor histórico.
 *
 * Rodar mais de uma vez é seguro: o que já foi removido simplesmente não é
 * encontrado de novo.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL não está definida.");
    process.exit(1);
  }

  const db = createDb(url);
  console.log(`Limpando conteúdo legado em ${new URL(url).host}`);

  const acoes = await db
    .delete(operatorActions)
    .where(like(operatorActions.code, "ACTION-%"))
    .returning({ code: operatorActions.code });

  const eventos = await db
    .delete(activityEvents)
    .where(sql`${activityEvents.title} !~ '[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]'`)
    .returning({ id: activityEvents.id });

  console.log(
    `Removidas ${acoes.length} ação(ões) legada(s) e ${eventos.length} evento(s) em inglês.`,
  );
  process.exit(0);
}

main().catch((erro) => {
  console.error("Falha na limpeza:", erro);
  process.exit(1);
});
