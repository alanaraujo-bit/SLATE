import type { MetadataRoute } from "next";

/**
 * Manifest da PWA.
 *
 * Gerado por código em vez de escrito como JSON estático para que os valores
 * fiquem sob checagem de tipos — um campo digitado errado num manifest falha
 * em silêncio, e o sintoma é a instalação simplesmente não ser oferecida, sem
 * nenhum erro no console.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SLATE",
    short_name: "SLATE",
    description:
      "Superfície de controle inteligente e contextual para o seu computador.",
    lang: "pt-BR",
    dir: "ltr",

    start_url: "/",
    scope: "/",

    // Sem barra de endereço: a PWA precisa parecer aplicativo, não site aberto
    // no navegador. Cada pixel de cromo do navegador é espaço tirado dos
    // controles.
    display: "standalone",
    orientation: "any",

    background_color: "#08090f",
    theme_color: "#08090f",

    categories: ["productivity", "utilities"],

    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-384.png", sizes: "384x384", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        // Sem uma entrada maskable, o Android desenha o ícone dentro de um
        // quadrado branco com bordas — o resultado parece um app mal feito.
        purpose: "maskable",
      },
    ],
  };
}
