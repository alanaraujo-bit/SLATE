import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type Database } from "@slate/db";
import { projects, qualityGates, workItems } from "@slate/db/schema";
import {
  ConclusaoRecusada,
  ItemNaoEncontrado,
  buscarItem,
  concluir,
  definirCriterio,
  definirStatus,
} from "./operacoes";

/**
 * Testes de integração da CLI contra Postgres real.
 *
 * Rodam contra um projeto descartável, criado e removido pelo próprio teste, no
 * mesmo banco de homologação. Substituir o banco por mocks testaria os mocks:
 * as regras que importam aqui — recusa de conclusão, cascata, restrições —
 * dependem do comportamento real do banco, e é justamente isso que precisa ser
 * verificado (mandato §29).
 *
 * Sem DATABASE_URL a suíte é pulada em vez de falhar, para que quem não tem
 * acesso ao banco ainda consiga rodar o resto dos testes.
 */

const URL_BANCO = process.env.DATABASE_URL;
const SLUG_TESTE = `teste-cli-${Date.now()}`;

const suite = URL_BANCO ? describe : describe.skip;

suite("operações da CLI", () => {
  let db: Database;
  let projectId: string;

  beforeAll(async () => {
    db = createDb(URL_BANCO!);

    const [projeto] = await db
      .insert(projects)
      .values({ slug: SLUG_TESTE, name: "Projeto de teste", version: "0.0.0" })
      .returning();
    projectId = projeto!.id;

    const [marco] = await db
      .insert(workItems)
      .values({
        projectId,
        kind: "MILESTONE",
        key: "M1",
        title: "Marco de teste",
        status: "PLANNED",
      })
      .returning();

    await db.insert(workItems).values([
      {
        projectId,
        parentId: marco!.id,
        kind: "TASK",
        key: "M1-T1",
        title: "Tarefa com critérios",
        status: "PLANNED",
      },
      {
        projectId,
        parentId: marco!.id,
        kind: "TASK",
        key: "M1-T2",
        title: "Tarefa sem critérios",
        status: "PLANNED",
      },
    ]);

    const t1 = await buscarItem(db, projectId, "M1-T1");
    await db.insert(qualityGates).values([
      { workItemId: t1.id, key: "c1", title: "Critério um" },
      { workItemId: t1.id, key: "c2", title: "Critério dois" },
    ]);
  });

  afterAll(async () => {
    if (projectId) {
      // A remoção em cascata leva junto itens, critérios e eventos.
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  });

  describe("buscarItem", () => {
    it("encontra um item pela chave", async () => {
      const item = await buscarItem(db, projectId, "M1-T1");
      expect(item.title).toBe("Tarefa com critérios");
    });

    it("falha de forma identificável quando a chave não existe", async () => {
      await expect(buscarItem(db, projectId, "NAO-EXISTE")).rejects.toBeInstanceOf(
        ItemNaoEncontrado,
      );
    });
  });

  describe("definirStatus", () => {
    it("muda o status e devolve o anterior", async () => {
      const r = await definirStatus(db, projectId, "M1-T2", "IN_PROGRESS");
      expect(r.anterior).toBe("PLANNED");
      expect(r.atual).toBe("IN_PROGRESS");
    });

    it("carimba a data de início ao começar", async () => {
      const item = await buscarItem(db, projectId, "M1-T2");
      expect(item.startedAt).not.toBeNull();
    });

    it("registra um evento de atividade em português", async () => {
      const eventos = await db.query.activityEvents.findMany({
        where: (e, { eq: igual }) => igual(e.projectId, projectId),
      });
      expect(eventos.length).toBeGreaterThan(0);
      expect(eventos.some((e) => e.title.includes("Em andamento"))).toBe(true);
    });
  });

  describe("concluir", () => {
    it("recusa enquanto houver critério pendente", async () => {
      await expect(concluir(db, projectId, "M1-T1")).rejects.toBeInstanceOf(
        ConclusaoRecusada,
      );
    });

    it("a recusa diz qual é o problema", async () => {
      await expect(concluir(db, projectId, "M1-T1")).rejects.toThrow(/critério/i);
    });

    it("não altera o status quando recusa", async () => {
      const antes = await buscarItem(db, projectId, "M1-T1");
      await concluir(db, projectId, "M1-T1").catch(() => {});
      const depois = await buscarItem(db, projectId, "M1-T1");
      expect(depois.status).toBe(antes.status);
    });

    it("continua recusando com apenas parte dos critérios aprovados", async () => {
      await definirCriterio(db, projectId, "M1-T1", "c1", "PASSED");
      await expect(concluir(db, projectId, "M1-T1")).rejects.toBeInstanceOf(
        ConclusaoRecusada,
      );
    });

    it("recusa quando um critério foi reprovado", async () => {
      await definirCriterio(db, projectId, "M1-T1", "c2", "FAILED");
      await expect(concluir(db, projectId, "M1-T1")).rejects.toThrow(/reprovado/i);
    });

    it("conclui quando todos os critérios passam", async () => {
      await definirCriterio(db, projectId, "M1-T1", "c2", "PASSED");
      const r = await concluir(db, projectId, "M1-T1");
      expect(r.atual).toBe("COMPLETED");

      const item = await buscarItem(db, projectId, "M1-T1");
      expect(item.completedAt).not.toBeNull();
    });

    it("conclui um item sem critérios", async () => {
      const r = await concluir(db, projectId, "M1-T2");
      expect(r.atual).toBe("COMPLETED");
    });

    it("recusa um pai enquanto um filho não estiver concluído", async () => {
      // Reabrir um filho precisa impedir a conclusão do pai; é o que garante
      // que um ramo não seja declarado pronto por cima de trabalho aberto.
      await definirStatus(db, projectId, "M1-T2", "REOPENED");
      await expect(concluir(db, projectId, "M1")).rejects.toBeInstanceOf(
        ConclusaoRecusada,
      );
    });

    it("conclui o pai quando todos os filhos estão concluídos", async () => {
      await definirStatus(db, projectId, "M1-T2", "COMPLETED");
      const r = await concluir(db, projectId, "M1");
      expect(r.atual).toBe("COMPLETED");
    });
  });

  describe("reabertura", () => {
    it("limpa a data de conclusão ao reabrir", async () => {
      await definirStatus(db, projectId, "M1-T1", "REOPENED");
      const item = await buscarItem(db, projectId, "M1-T1");
      expect(item.completedAt).toBeNull();
      expect(item.status).toBe("REOPENED");
    });
  });

  describe("definirCriterio", () => {
    it("falha quando o critério não existe no item", async () => {
      await expect(
        definirCriterio(db, projectId, "M1-T1", "inexistente", "PASSED"),
      ).rejects.toThrow(/não existe/i);
    });

    it("guarda a evidência informada", async () => {
      await definirCriterio(db, projectId, "M1-T1", "c1", "PASSED", "prova aqui");
      const item = await buscarItem(db, projectId, "M1-T1");
      const criterios = await db
        .select()
        .from(qualityGates)
        .where(eq(qualityGates.workItemId, item.id));
      expect(criterios.find((c) => c.key === "c1")?.evidence).toBe("prova aqui");
    });
  });
});
