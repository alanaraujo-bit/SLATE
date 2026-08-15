import { expect, test } from "@playwright/test";

/**
 * Fluxo real: navegador → API → banco.
 *
 * Os testes da API exercitam os endpoints diretamente. Estes exercitam o que
 * nenhum deles alcança: se o cookie de sessão realmente atravessa entre a
 * origem da PWA e a da API, se a chave do dispositivo é criada e guardada no
 * aparelho, e se a pessoa consegue chegar do zero até o código de pareamento.
 *
 * É justamente aqui que apareceria a armadilha do SameSite descrita no
 * ADR-0005 — em desenvolvimento ela não aparece porque duas portas de
 * localhost são o mesmo site, mas o teste vale como verificação de que o
 * cookie está sendo enviado e aceito.
 */

const email = () =>
  `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@exemplo.test`;

const SENHA = "cavalo-bateria-grampo";

test.describe("conta", () => {
  test("cria conta, entra e permanece conectado ao recarregar", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /não tenho conta/i }).click();
    await page.getByLabel("E-mail").fill(email());
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: /criar conta/i }).click();

    await expect(page.getByRole("button", { name: /parear este aparelho/i })).toBeVisible({
      timeout: 20_000,
    });

    // O ponto do teste: recarregar precisa manter a sessão. Se o cookie não
    // estivesse atravessando, aqui voltaria a tela de entrada.
    await page.reload();
    await expect(page.getByRole("button", { name: /parear este aparelho/i })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("avisa sobre a recuperação de senha antes de a pessoa se comprometer", async ({
    page,
  }) => {
    // Sem recuperação, esquecer a senha custa todos os dispositivos e painéis.
    // O aviso precisa estar visível no cadastro, não escondido depois.
    await page.goto("/");
    await page.getByRole("button", { name: /não tenho conta/i }).click();

    await expect(page.getByText(/recuperação de senha por e-mail ainda não/i)).toBeVisible();
  });

  test("recusa senha fraca dizendo o que está errado", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /não tenho conta/i }).click();
    await page.getByLabel("E-mail").fill(email());
    await page.getByLabel("Senha").fill("123");
    await page.getByRole("button", { name: /criar conta/i }).click();

    await expect(page.getByText(/pelo menos 8 caracteres/i)).toBeVisible({
      timeout: 20_000,
    });
  });

  test("recusa credenciais erradas sem revelar se a conta existe", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("E-mail").fill(email());
    await page.getByLabel("Senha").fill("senha-que-nao-existe");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    // A mensagem é a mesma de senha errada — é o que impede descobrir contas.
    await expect(page.getByText(/e-mail ou senha incorretos/i)).toBeVisible({
      timeout: 20_000,
    });
  });

  test("sair encerra a sessão de verdade", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /não tenho conta/i }).click();
    await page.getByLabel("E-mail").fill(email());
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: /criar conta/i }).click();

    await expect(page.getByRole("button", { name: "Sair" })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Sair" }).click();

    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();

    // Recarregar não pode ressuscitar a sessão.
    await page.reload();
    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible({
      timeout: 20_000,
    });
  });
});

test.describe("pareamento", () => {
  test("gera um código de seis dígitos para digitar no computador", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /não tenho conta/i }).click();
    await page.getByLabel("E-mail").fill(email());
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: /criar conta/i }).click();

    await page.getByRole("button", { name: /parear este aparelho/i }).click({
      timeout: 20_000,
    });

    const codigo = page.locator(".pareamento__codigo");
    await expect(codigo).toBeVisible({ timeout: 20_000 });
    await expect(codigo).toHaveText(/^\d{3} \d{3}$/);
  });

  test("mostra quanto tempo o código ainda vale", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /não tenho conta/i }).click();
    await page.getByLabel("E-mail").fill(email());
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: /criar conta/i }).click();

    await page.getByRole("button", { name: /parear este aparelho/i }).click({
      timeout: 20_000,
    });

    await expect(page.getByRole("timer")).toContainText(/expira em \d:\d{2}/i, {
      timeout: 20_000,
    });
  });

  test("a chave do dispositivo é criada e fica guardada no aparelho", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /não tenho conta/i }).click();
    await page.getByLabel("E-mail").fill(email());
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: /criar conta/i }).click();

    await page.getByRole("button", { name: /parear este aparelho/i }).click({
      timeout: 20_000,
    });
    await expect(page.locator(".pareamento__codigo")).toBeVisible({ timeout: 20_000 });

    const guardada = await page.evaluate(
      () =>
        new Promise<{ existe: boolean; extraivel: boolean | null }>((resolve) => {
          const pedido = indexedDB.open("slate-identidade", 1);

          pedido.onsuccess = () => {
            const bd = pedido.result;
            const t = bd.transaction("chaves", "readonly");
            const busca = t.objectStore("chaves").get("dispositivo");

            busca.onsuccess = () => {
              const registro = busca.result;
              resolve({
                existe: !!registro?.chavePrivada,
                extraivel: registro?.chavePrivada?.extractable ?? null,
              });
              bd.close();
            };

            busca.onerror = () => resolve({ existe: false, extraivel: null });
          };

          pedido.onerror = () => resolve({ existe: false, extraivel: null });
        }),
    );

    expect(guardada.existe).toBe(true);
    // Não extraível é o que impede um script injetado de copiar a identidade
    // deste aparelho (ADR-0004 §1).
    expect(guardada.extraivel).toBe(false);
  });
});

test.describe("servidor indisponível", () => {
  test("explica em vez de mostrar a tela de entrada", async ({ page }) => {
    // Sem este estado, uma API fora do ar apareceria como login, e a pessoa
    // tentaria entrar repetidamente sem entender por que nada acontece.
    await page.route("**/contas/eu", (rota) => rota.abort());

    await page.goto("/");
    await expect(page.getByText(/servidor fora de alcance/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: /tentar de novo/i })).toBeVisible();
  });
});
