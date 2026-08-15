import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Auditoria de acessibilidade com axe-core.
 *
 * Existe para que o critério de qualidade de acessibilidade seja fechado com
 * evidência de uma ferramenta, e não com a minha palavra. O axe não prova que
 * a página é acessível — nenhuma ferramenta automática prova — mas prova que
 * as violações que ele sabe detectar não estão presentes.
 */

test.describe("acessibilidade", () => {
  test("não há violações de WCAG 2 A/AA detectáveis", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".headline__value")).toBeVisible();

    const resultado = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    // Falha imprimindo a violação inteira, para que o conserto seja óbvio sem
    // precisar reproduzir.
    expect(
      resultado.violations,
      `Violações encontradas:\n${JSON.stringify(
        resultado.violations.map((v) => ({
          id: v.id,
          impacto: v.impact,
          descricao: v.description,
          elementos: v.nodes.map((n) => n.html).slice(0, 3),
        })),
        null,
        2,
      )}`,
    ).toEqual([]);
  });

  test("os marcos abrem e fecham pelo teclado", async ({ page }) => {
    await page.goto("/");

    const primeiraFase = page.locator(".node--PHASE > .node__row").first();
    await primeiraFase.focus();
    await expect(primeiraFase).toBeFocused();

    const estadoInicial = await primeiraFase.getAttribute("aria-expanded");
    await page.keyboard.press("Enter");
    await expect(primeiraFase).not.toHaveAttribute("aria-expanded", estadoInicial ?? "");
  });

  test("o percentual é exposto como barra de progresso a leitores de tela", async ({
    page,
  }) => {
    await page.goto("/");

    const barra = page.getByRole("progressbar", { name: "Progresso geral" });
    await expect(barra).toHaveAttribute("aria-valuenow", /^\d+(\.\d+)?$/);
    await expect(barra).toHaveAttribute("aria-valuemin", "0");
    await expect(barra).toHaveAttribute("aria-valuemax", "100");
  });
});
