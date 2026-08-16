import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Gera o service worker com uma versão de cache própria de cada build.
 *
 * Existe por causa de um defeito real, encontrado ao ver a aplicação abrir
 * offline mostrando uma tela de duas versões atrás.
 *
 * O navegador só reinstala um service worker quando o **arquivo dele** muda.
 * Com uma versão de cache fixa no código, o arquivo permanecia idêntico entre
 * builds: o service worker antigo continuava ativo, servindo a casca antiga do
 * cache, e a pessoa ficava presa numa versão anterior sem nenhuma forma óbvia
 * de sair — offline, inclusive, que é justamente quando ela não pode
 * simplesmente limpar os dados do site.
 *
 * Com a versão derivada do conteúdo do modelo mais o instante do build, cada
 * publicação produz um arquivo diferente, o navegador percebe, reinstala e
 * troca a casca guardada.
 */

const aqui = dirname(fileURLToPath(import.meta.url));
const modelo = readFileSync(resolve(aqui, "sw-modelo.js"), "utf8");

/*
 * O hash do conteúdo cobre mudanças de lógica; o instante cobre mudanças da
 * aplicação em volta, que não aparecem neste arquivo mas mudam a casca. Sem a
 * segunda parte, alterar só uma tela deixaria o service worker idêntico e o
 * cache velho de pé.
 */
const impressao = createHash("sha256").update(modelo).digest("hex").slice(0, 8);

/*
 * O service worker de desenvolvimento é outro, e precisa ser.
 *
 * O cache de ativos assume URL com hash no nome — verdade no build, mentira no
 * `next dev`, onde `page.js` continua `page.js` a cada recompilação. Guardar
 * ali serve o pacote antigo junto com a casca nova, e a aplicação fica presa
 * carregando. O marcador entra na versão para que trocar de modo troque o
 * arquivo, e o navegador reinstale em vez de manter o anterior de pé.
 */
const desenvolvimento = process.argv.includes("--dev");
const versao = `slate-${impressao}-${desenvolvimento ? "dev-" : ""}${Date.now().toString(36)}`;

const saida = modelo
  .replace(/const VERSAO = "[^"]*";/, `const VERSAO = ${JSON.stringify(versao)};`)
  .replace(/const DESENVOLVIMENTO = false;/, `const DESENVOLVIMENTO = ${desenvolvimento};`);

if (saida === modelo || !saida.includes(`const DESENVOLVIMENTO = ${desenvolvimento};`)) {
  console.error(
    "Não encontrei as declarações de VERSAO e DESENVOLVIMENTO no modelo. " +
      "Sem substituição, o cache não seria invalidado entre builds.",
  );
  process.exit(1);
}

writeFileSync(resolve(aqui, "..", "public", "sw.js"), saida, "utf8");
console.log(`sw.js gerado com versão ${versao}`);
