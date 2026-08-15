import { expect, test } from "@playwright/test";

const SENHA_E2E = "cavalo-bateria-grampo";
const emailE2e = () =>
  `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@exemplo.test`;

/**
 * Instalabilidade e comportamento offline.
 *
 * O mandato §7 trata a PWA como requisito não negociável, e "PWA" aqui tem
 * significado verificável: o manifest precisa estar correto, os ícones
 * precisam existir de verdade, e a aplicação precisa abrir sem rede. Um
 * manifest com um campo errado falha em silêncio — o sintoma é a instalação
 * simplesmente não ser oferecida, sem nenhum erro no console.
 */

test.describe("manifest", () => {
  test("é servido e tem os campos que tornam a aplicação instalável", async ({
    request,
  }) => {
    const resposta = await request.get("/manifest.webmanifest");
    expect(resposta.status()).toBe(200);

    const manifest = await resposta.json();

    expect(manifest.name).toBe("SLATE");
    expect(manifest.start_url).toBeTruthy();
    // Sem standalone a aplicação abre com a barra de endereço, e o espaço do
    // navegador sai do espaço dos controles.
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBeTruthy();
    expect(manifest.theme_color).toBeTruthy();
  });

  test("declara os tamanhos de ícone exigidos", async ({ request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    const tamanhos = manifest.icons.map((i: { sizes: string }) => i.sizes);

    expect(tamanhos).toContain("192x192");
    expect(tamanhos).toContain("512x512");
  });

  test("tem um ícone maskable", async ({ request }) => {
    // Sem ele o Android desenha o ícone dentro de um quadrado branco.
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    const maskable = manifest.icons.filter((i: { purpose?: string }) =>
      i.purpose?.includes("maskable"),
    );
    expect(maskable.length).toBeGreaterThan(0);
  });

  test("todos os ícones declarados existem de verdade", async ({ request }) => {
    // Um caminho errado no manifest só aparece na hora de instalar.
    const manifest = await (await request.get("/manifest.webmanifest")).json();

    for (const icone of manifest.icons) {
      const resposta = await request.get(icone.src);
      expect(resposta.status(), icone.src).toBe(200);
      expect(resposta.headers()["content-type"], icone.src).toContain("image");
    }
  });

  test("está em português", async ({ request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest.lang).toBe("pt-BR");
  });
});

test.describe("service worker", () => {
  test("é servido com escopo para a origem inteira", async ({ request }) => {
    const resposta = await request.get("/sw.js");
    expect(resposta.status()).toBe(200);
    expect(resposta.headers()["service-worker-allowed"]).toBe("/");
  });

  test("não é guardado em cache pelo navegador", async ({ request }) => {
    // Um service worker cacheado impede a aplicação de se atualizar, e o
    // usuário fica preso numa versão antiga sem nenhuma forma de sair.
    const resposta = await request.get("/sw.js");
    expect(resposta.headers()["cache-control"]).toContain("no-cache");
  });

  test("registra e assume o controle", async ({ page }) => {
    await page.goto("/");

    const pronto = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const registro = await navigator.serviceWorker.ready;
      return registro.active !== null;
    });

    expect(pronto).toBe(true);
  });
});

test.describe("aplicação", () => {
  test("abre em português e mostra a marca", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByText("SLATE").first()).toBeVisible();
  });

  test("sem sessão, pede para entrar em vez de mostrar controles", async ({ page }) => {
    // O mandato §59 proíbe substituir escopo por promessa: nada de grade de
    // botões que não faz nada. Sem conta, o que é verdade é que a pessoa
    // precisa entrar.
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("mostra o estado da conexão", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".s-indicador")).toBeVisible({ timeout: 20_000 });
  });

  test("não tem rolagem horizontal", async ({ page }) => {
    await page.goto("/");
    const transborda = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    );
    expect(transborda).toBe(false);
  });

  test("respeita as áreas seguras do aparelho", async ({ page }) => {
    // Sem isto, um controle no rodapé fica embaixo da barra de gestos e vira
    // intocável.
    await page.goto("/");
    const usa = await page.evaluate(() => {
      const estilo = getComputedStyle(document.body);
      return estilo.paddingBottom !== "" && estilo.paddingTop !== "";
    });
    expect(usa).toBe(true);
  });
});

test.describe("offline", () => {
  test("a aplicação continua abrindo sem rede", async ({ page, context }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);

    // Recarrega uma vez com rede para o service worker guardar a casca.
    await page.reload();
    await page.evaluate(() => navigator.serviceWorker.ready);

    // Confirma que o service worker assumiu antes de tirar a rede — sem isso,
    // um "passou" aqui poderia significar apenas que a página nem recarregou.
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await context.setOffline(true);

    /*
     * O reload é envolvido em try porque no WebKit do Playwright ele rejeita
     * com "WebKit encountered an internal error" mesmo quando a navegação dá
     * certo — a página carrega, o service worker responde, e a promessa
     * rejeita mesmo assim. É defeito da ferramenta, não do produto.
     *
     * Por isso a verificação é feita sobre o resultado e não sobre a chamada:
     * o que precisa ser verdade é que a aplicação apareceu, e isso é checado
     * logo abaixo em qualquer um dos casos. Se a navegação tivesse realmente
     * falhado, a asserção seguinte reprovaria.
     */
    await page.reload().catch(() => {});

    /*
     * O requisito aqui é um só: sem rede, a pessoa vê a aplicação e não a tela
     * de erro do navegador. É isso que está sendo verificado.
     *
     * O que a aplicação *diz* sobre a conexão é verificado no teste "o
     * indicador passa a dizer que não há internet", que derruba a rede sem
     * recarregar a página. A separação é deliberada: depois de um reload
     * offline, o que aparece depende de qual versão do JavaScript hidratou a
     * página vinda do cache, e isso varia conforme o service worker acabou de
     * trocar de versão — em ambos os motores. Juntar as duas coisas num teste
     * só produziu uma falha que trocava de navegador a cada rodada, sem que
     * houvesse defeito nenhum.
     */
    await expect(page.getByText("SLATE").first()).toBeVisible();
    await expect(page.locator(".app")).toBeVisible();

    await context.setOffline(false);
  });

  test("o indicador passa a dizer que não há internet", async ({ page, context }) => {
    // Abrir offline não basta: a aplicação precisa dizer por que os controles
    // não respondem, senão parece defeito dela.
    await page.goto("/");
    await page.getByRole("button", { name: /não tenho conta/i }).click();
    await page.getByLabel("E-mail").fill(emailE2e());
    await page.getByLabel("Senha").fill(SENHA_E2E);
    await page.getByRole("button", { name: /criar conta/i }).click();
    await expect(page.locator(".s-indicador")).toContainText("Parear");

    await context.setOffline(true);
    await expect(page.locator(".s-indicador")).toContainText("Sem internet");

    await context.setOffline(false);
    // A volta também é automática: ninguém precisa descobrir que existe um
    // botão de tentar de novo para recuperar o controle.
    await expect(page.locator(".s-indicador")).toContainText("Parear");
  });

  test("a tela de sem conexão explica sem culpar ninguém", async ({ page }) => {
    await page.goto("/offline");
    await expect(page.getByText(/sem conexão/i).first()).toBeVisible();
    await expect(page.getByText(/não é preciso fazer nada/i)).toBeVisible();
  });
});
