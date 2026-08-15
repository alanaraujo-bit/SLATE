import { expect, test } from "@playwright/test";

/**
 * Validação ponta a ponta do Centro de Controle.
 *
 * Verifica as propriedades que realmente importam — que o progresso é real,
 * que a página reflete o estado vivo do banco, que o canal em tempo real
 * funciona e que a interface está em português — em vez de verificar pixels.
 */

test.describe("saúde", () => {
  test("reporta um banco de dados acessível", async ({ request }) => {
    const resposta = await request.get("/api/health");
    expect(resposta.status()).toBe(200);

    const corpo = await resposta.json();
    expect(corpo.status).toBe("ok");
    expect(corpo.config.present).toBe(true);
    expect(corpo.config.parses).toBe(true);
    expect(corpo.database.reachable).toBe(true);

    // A credencial nunca pode aparecer numa resposta de diagnóstico.
    const texto = JSON.stringify(corpo);
    expect(texto).not.toContain("postgresql://");
    expect(texto).not.toMatch(/:[^:@/]+@/);
  });
});

test.describe("API do plano", () => {
  test("serve um plano calculado a partir de linhas reais", async ({ request }) => {
    const resposta = await request.get("/api/snapshot");
    expect(resposta.status()).toBe(200);

    const snapshot = await resposta.json();

    expect(snapshot.project.name).toBe("SLATE");
    expect(snapshot.tree.length).toBeGreaterThan(0);
    expect(snapshot.totals.items).toBeGreaterThan(50);

    // O progresso precisa ser uma fração real, e não pode estar completo
    // enquanto há trabalho restante — a desonestia que o mandato §57 proíbe.
    expect(snapshot.overall).toBeGreaterThan(0);
    expect(snapshot.overall).toBeLessThan(1);
    expect(snapshot.totals.completedLeaves).toBeLessThan(snapshot.totals.leaves);
  });

  test("um ramo incompleto nunca aparece como concluído", async ({ request }) => {
    const snapshot = await (await request.get("/api/snapshot")).json();

    const verificar = (no: {
      progress: number;
      status: string;
      children: Array<{ progress: number; status: string; children: unknown[] }>;
    }) => {
      if (no.children.length > 0) {
        const todosConcluidos = no.children.every((f) => f.status === "COMPLETED");
        if (!todosConcluidos) {
          expect(no.progress).toBeLessThan(1);
        }
      }
      for (const filho of no.children) verificar(filho as never);
    };

    for (const fase of snapshot.tree) verificar(fase);
  });
});

test.describe("painel", () => {
  test("renderiza o plano com o percentual calculado em destaque", async ({ page }) => {
    await page.goto("/");

    // Especificamente o subtítulo da marca: o mesmo texto também é o nome do
    // marco P0-M3, então um getByText solto casa duas vezes.
    await expect(page.locator(".brand__sub")).toHaveText(
      "Centro de Controle de Desenvolvimento",
    );

    const destaque = page.locator(".headline__value");
    await expect(destaque).toBeVisible();
    // Percentual em formato brasileiro, com vírgula decimal.
    await expect(destaque).toHaveText(/^\d+,\d%$/);

    await expect(page.getByText("Fundação e Inteligência do Projeto")).toBeVisible();
    await expect(page.getByText("Plataforma Central")).toBeVisible();
  });

  test("a interface está em português", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");

    for (const rotulo of [
      "Progresso geral",
      "Itens de trabalho",
      "Tarefas concluídas",
      "Critérios aprovados",
      "Execução atual",
      "Ações que dependem de você",
      "Atividade",
    ]) {
      await expect(page.getByText(rotulo).first()).toBeVisible();
    }
  });

  test("detalha um marco em profundidade", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("button", { name: /Fundação e Inteligência do Projeto/ }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: /Centro de Controle de Desenvolvimento/ }).first(),
    ).toBeVisible();
  });

  test("mostra as ações do operador com o passo a passo", async ({ page }) => {
    await page.goto("/");

    const acao = page.getByRole("button", { name: /AÇÃO-001/ });
    await expect(acao).toBeVisible();

    await acao.click();
    await expect(page.getByText(/gh auth refresh/)).toBeVisible();
  });

  test("chega ao estado de conexão ao vivo", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".link-state")).toHaveAttribute("data-state", "live", {
      timeout: 20_000,
    });
  });

  test("não tem rolagem horizontal no celular", async ({ page }) => {
    await page.goto("/");

    const transborda = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    );
    expect(transborda).toBe(false);
  });
});

test.describe("tempo real", () => {
  test("uma queda breve do fluxo não vira alarme falso", async ({ page, context }) => {
    await page.goto("/");
    await expect(page.locator(".link-state")).toHaveAttribute("data-state", "live", {
      timeout: 20_000,
    });

    // Queda de rede de verdade. Interceptar a rota não serve aqui: isso só
    // afeta requisições novas, e a conexão SSE já aberta seguiria entregando —
    // o teste passaria sem exercitar nada.
    await context.setOffline(true);

    // O fluxo se encerra de propósito de tempos em tempos e a rede engasga.
    // Uma interrupção curta precisa passar despercebida, senão uma página
    // saudável parece instável.
    await page.waitForTimeout(5000);
    await expect(page.locator(".link-state")).toHaveAttribute("data-state", "live");

    await context.setOffline(false);
  });

  /*
   * Os casos de queda prolongada e de recuperação viviam aqui e foram movidos
   * para `lib/estado-conexao.test.ts`.
   *
   * O motivo não é que falhavam: é que não verificavam de forma confiável o
   * que diziam verificar. `setOffline` nem sempre corta uma conexão SSE já
   * aberta, então às vezes exercitavam a regra e às vezes exercitavam nada,
   * falhando sem haver defeito. Como teste unitário a mesma regra é verificada
   * nos limites exatos, incluindo casos que o navegador não conseguia produzir
   * — silêncio negativo por relógio adiantado, e a garantia de que o estado
   * nunca melhora sozinho enquanto nada chega.
   *
   * O que sobrou aqui é o que realmente precisa de navegador.
   */

  test("o fluxo entrega um evento de atualização", async ({ page }) => {
    await page.goto("/");

    const recebeu = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const fonte = new EventSource("/api/stream");
          const limite = setTimeout(() => {
            fonte.close();
            resolve(false);
          }, 20_000);

          fonte.addEventListener("snapshot", () => {
            clearTimeout(limite);
            fonte.close();
            resolve(true);
          });
        }),
    );

    expect(recebeu).toBe(true);
  });
});
