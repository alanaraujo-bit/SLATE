import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Gera os ícones da PWA a partir de um único SVG.
 *
 * Versionado como script em vez de os PNGs serem desenhados à mão: quando a
 * marca mudar, muda um arquivo e todos os tamanhos saem coerentes. PNG
 * mantido à mão sempre acaba com um tamanho desatualizado que ninguém percebe.
 */

const aqui = dirname(fileURLToPath(import.meta.url));
const base = resolve(aqui, "..", "public", "icons");
mkdirSync(base, { recursive: true });

const svg = readFileSync(resolve(base, "slate.svg"));

// 192 e 512 são o mínimo exigido pelo manifest; 384 evita reamostragem em
// telas intermediárias. O ícone da Apple tem 180 e é servido à parte, porque o
// iOS aplica a própria máscara de cantos.
const tamanhos = [
  { arquivo: "icon-192.png", lado: 192 },
  { arquivo: "icon-384.png", lado: 384 },
  { arquivo: "icon-512.png", lado: 512 },
  { arquivo: "apple-touch-icon.png", lado: 180 },
];

for (const { arquivo, lado } of tamanhos) {
  await sharp(svg, { density: 400 })
    .resize(lado, lado)
    .png({ compressionLevel: 9 })
    .toFile(resolve(base, arquivo));
  console.log(`${arquivo} (${lado}px)`);
}

/*
 * O ícone "maskable" precisa caber na zona segura — um círculo de 80% do lado.
 * O Android recorta o ícone na forma do sistema, e desenho que encosta na
 * borda perde pedaço. 62% dá folga confortável em qualquer máscara.
 */
const conteudo = Math.round(512 * 0.62);
const margem = Math.round((512 - conteudo) / 2);

await sharp({
  create: { width: 512, height: 512, channels: 4, background: "#0d0f18" },
})
  .composite([
    {
      input: await sharp(svg, { density: 400 })
        .resize(conteudo, conteudo)
        .png()
        .toBuffer(),
      top: margem,
      left: margem,
    },
  ])
  .png({ compressionLevel: 9 })
  .toFile(resolve(base, "icon-maskable-512.png"));

console.log("icon-maskable-512.png (512px, zona segura de 62%)");
