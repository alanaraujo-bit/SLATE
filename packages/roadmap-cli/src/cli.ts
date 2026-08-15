#!/usr/bin/env node
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { desc, eq } from "drizzle-orm";
import { createDb } from "@slate/db";
import {
  activityEvents,
  deployments,
  projects,
  qualityGates,
  workItems,
  type GateStatus,
  type WorkStatus,
} from "@slate/db/schema";
import { overallProgress, toPercent, type WorkItemInput } from "@slate/db/progress";
import {
  ConclusaoRecusada,
  ItemNaoEncontrado,
  buscarItem,
  concluir,
  definirCriterio,
  definirExecucao,
  definirStatus,
  registrarEvento,
} from "./operacoes";

/**
 * O caminho de escrita do plano (mandato §24).
 *
 * Esta é uma casca fina: toda a lógica de verdade vive em `operacoes.ts`, para
 * que possa ser testada contra um banco real sem passar pelo processamento de
 * argumentos. O que sobra aqui é ler a linha de comando e imprimir resultado.
 */

/**
 * Carrega DATABASE_URL do arquivo de ambiente mais próximo, para a CLI
 * funcionar de qualquer diretório sem ninguém exportar nada. Variável já
 * definida no ambiente sempre vence, para que CI e execuções pontuais possam
 * sobrescrever.
 */
function carregarAmbiente() {
  if (process.env.DATABASE_URL) return;

  const aqui = dirname(fileURLToPath(import.meta.url));
  const candidatos = [
    resolve(aqui, "..", ".env"),
    resolve(aqui, "..", "..", "..", "apps", "control-center", ".env.local"),
    resolve(aqui, "..", "..", "..", ".env"),
  ];

  for (const candidato of candidatos) {
    if (!existsSync(candidato)) continue;
    try {
      process.loadEnvFile(candidato);
      if (process.env.DATABASE_URL) return;
    } catch {
      /* tenta o próximo */
    }
  }
}

carregarAmbiente();

const USO = `
slate-roadmap — controle do plano de trabalho do SLATE

  start <chave>                   Marca EM ANDAMENTO e define a execução atual
  status <chave> <STATUS>         Define um status explícito
  testing <chave>                 Marca EM TESTE
  validating <chave>              Marca VALIDANDO
  complete <chave>                Marca CONCLUÍDO (recusado se houver pendência)
  reopen <chave> [--reason <t>]   Regressão: CONCLUÍDO → REABERTO
  block <chave> [--operator]      Marca BLOQUEADO ou PRECISA DE VOCÊ

  gate <chave> <critério> --pass|--fail|--na [--evidence <texto>]
  exec [--operation <t>] [--branch <b>] [--commit <sha>] [--env <e>] [--item <chave>]
  event --type <t> --title <t> [--detail <d>] [--severity INFO|SUCCESS|WARNING|ERROR]
  deploy --env <e> --target <t> [--url <u>] [--commit <sha>] [--status <s>]
  report                          Mostra o progresso calculado

Opções: --project <slug> (padrão: slate)
Requer DATABASE_URL.
`;

const STATUS_VALIDOS: WorkStatus[] = [
  "PLANNED",
  "READY",
  "IN_PROGRESS",
  "TESTING",
  "VALIDATING",
  "BLOCKED_EXTERNAL",
  "OPERATOR_REQUIRED",
  "COMPLETED",
  "REOPENED",
];

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: "string", default: "slate" },
      reason: { type: "string" },
      evidence: { type: "string" },
      operation: { type: "string" },
      branch: { type: "string" },
      commit: { type: "string" },
      env: { type: "string" },
      item: { type: "string" },
      type: { type: "string" },
      title: { type: "string" },
      detail: { type: "string" },
      severity: { type: "string" },
      target: { type: "string" },
      url: { type: "string" },
      status: { type: "string" },
      pass: { type: "boolean" },
      fail: { type: "boolean" },
      na: { type: "boolean" },
      operator: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  const [comando, ...resto] = positionals;

  if (values.help || !comando) {
    console.log(USO);
    process.exit(comando ? 0 : 1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL não está definida.");
    process.exit(1);
  }

  const db = createDb(url);
  const slug = values.project ?? "slate";

  const [projeto] = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);

  if (!projeto) {
    console.error(`Projeto '${slug}' não encontrado. Rode a carga inicial antes.`);
    process.exit(1);
  }
  const projectId = projeto.id;

  const mostrarMudanca = (r: { anterior: WorkStatus; atual: WorkStatus }, chave: string) =>
    console.log(`${chave}: ${r.anterior} → ${r.atual}`);

  switch (comando) {
    case "start": {
      const chave = exigir(resto[0], "chave");
      const r = await definirStatus(db, projectId, chave, "IN_PROGRESS");
      await definirExecucao(db, projectId, {
        workItemId: r.item.id,
        operacao: values.operation ?? r.item.title,
        branch: values.branch ?? null,
        commit: values.commit ?? null,
        ambiente: values.env ?? null,
      });
      mostrarMudanca(r, chave);
      break;
    }

    case "status": {
      const chave = exigir(resto[0], "chave");
      const bruto = exigir(resto[1], "STATUS").toUpperCase() as WorkStatus;
      if (!STATUS_VALIDOS.includes(bruto)) {
        console.error(`Status inválido '${bruto}'. Use um de: ${STATUS_VALIDOS.join(", ")}`);
        process.exit(1);
      }
      mostrarMudanca(await definirStatus(db, projectId, chave, bruto, values.reason), chave);
      break;
    }

    case "testing":
    case "validating": {
      const chave = exigir(resto[0], "chave");
      const alvo: WorkStatus = comando === "testing" ? "TESTING" : "VALIDATING";
      mostrarMudanca(await definirStatus(db, projectId, chave, alvo), chave);
      break;
    }

    case "block": {
      const chave = exigir(resto[0], "chave");
      const alvo: WorkStatus = values.operator ? "OPERATOR_REQUIRED" : "BLOCKED_EXTERNAL";
      mostrarMudanca(await definirStatus(db, projectId, chave, alvo, values.reason), chave);
      break;
    }

    case "reopen": {
      const chave = exigir(resto[0], "chave");
      mostrarMudanca(
        await definirStatus(db, projectId, chave, "REOPENED", values.reason),
        chave,
      );
      console.log("O progresso geral vai cair de acordo.");
      break;
    }

    case "complete": {
      const chave = exigir(resto[0], "chave");
      mostrarMudanca(await concluir(db, projectId, chave), chave);
      break;
    }

    case "gate": {
      const chave = exigir(resto[0], "chave");
      const criterio = exigir(resto[1], "critério");

      const alvo: GateStatus | null = values.pass
        ? "PASSED"
        : values.fail
          ? "FAILED"
          : values.na
            ? "NOT_APPLICABLE"
            : null;

      if (!alvo) {
        console.error("Informe um de: --pass, --fail ou --na.");
        process.exit(1);
      }

      const r = await definirCriterio(
        db,
        projectId,
        chave,
        criterio,
        alvo,
        values.evidence,
      );
      console.log(`${chave}/${criterio}: ${r.anterior} → ${r.atual}`);
      break;
    }

    case "exec": {
      const item = values.item ? await buscarItem(db, projectId, values.item) : undefined;
      await definirExecucao(db, projectId, {
        workItemId: item?.id,
        operacao: values.operation ?? null,
        branch: values.branch ?? null,
        commit: values.commit ?? null,
        ambiente: values.env ?? null,
      });
      console.log("Execução atual atualizada.");
      break;
    }

    case "event": {
      const item = values.item ? await buscarItem(db, projectId, values.item) : undefined;
      await registrarEvento(
        db,
        projectId,
        values.type ?? "nota",
        exigir(values.title, "--title"),
        {
          detalhe: values.detail,
          severidade: (values.severity?.toUpperCase() as "INFO") ?? "INFO",
          workItemId: item?.id,
        },
      );
      console.log("Evento registrado.");
      break;
    }

    case "deploy": {
      const ambiente = exigir(values.env, "--env");
      const alvo = values.target ?? "control-center";
      await db.insert(deployments).values({
        projectId,
        environment: ambiente,
        provider: "vercel",
        target: alvo,
        url: values.url ?? null,
        commitSha: values.commit ?? null,
        status: (values.status?.toUpperCase() as "READY") ?? "READY",
      });
      await registrarEvento(
        db,
        projectId,
        "deployment.created",
        `Publicado ${alvo} em ${ambiente}`,
        { detalhe: values.url, severidade: "SUCCESS" },
      );
      console.log("Publicação registrada.");
      break;
    }

    case "report": {
      const itens = await db
        .select()
        .from(workItems)
        .where(eq(workItems.projectId, projectId));

      const criterios = await db.select().from(qualityGates);
      const porItem = new Map<string, { status: GateStatus; weight: number }[]>();
      for (const c of criterios) {
        const balde = porItem.get(c.workItemId);
        const entrada = { status: c.status, weight: c.weight };
        if (balde) balde.push(entrada);
        else porItem.set(c.workItemId, [entrada]);
      }

      const entradas: WorkItemInput[] = itens.map((i) => ({
        id: i.id,
        parentId: i.parentId,
        status: i.status,
        weight: i.weight,
        gates: porItem.get(i.id),
      }));

      const pct = String(toPercent(overallProgress(entradas))).replace(".", ",");
      console.log(`\nSLATE — progresso geral: ${pct}%`);
      console.log(
        `${itens.length} itens de trabalho, ` +
          `${itens.filter((i) => i.status === "COMPLETED").length} concluídos.\n`,
      );

      const recentes = await db
        .select()
        .from(activityEvents)
        .where(eq(activityEvents.projectId, projectId))
        .orderBy(desc(activityEvents.createdAt))
        .limit(5);

      if (recentes.length > 0) {
        console.log("Atividade recente:");
        for (const e of recentes) console.log(`  · ${e.title}`);
      }
      break;
    }

    default:
      console.error(`Comando desconhecido: '${comando}'.`);
      console.log(USO);
      process.exit(1);
  }

  process.exit(0);
}

function exigir(valor: string | undefined, nome: string): string {
  if (!valor) {
    console.error(`Falta o argumento obrigatório: ${nome}`);
    process.exit(1);
  }
  return valor;
}

main().catch((erro) => {
  // As recusas são resultado esperado, não falha do programa: merecem uma
  // mensagem útil em vez de um stack trace.
  if (erro instanceof ConclusaoRecusada) {
    console.error(`Recusando concluir ${erro.chave}:`);
    for (const motivo of erro.motivos) console.error(`  · ${motivo}`);
    console.error(
      "\nResolva isso primeiro. Marcar como concluído assim mesmo tornaria o " +
        "percentual publicado uma mentira (mandato §57).",
    );
    process.exit(1);
  }

  if (erro instanceof ItemNaoEncontrado) {
    console.error(erro.message);
    process.exit(1);
  }

  console.error(erro);
  process.exit(1);
});
