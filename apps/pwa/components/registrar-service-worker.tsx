"use client";

import { useEffect } from "react";

/**
 * Registra o service worker.
 *
 * Feito num componente cliente vazio, e não inline no layout, para que a
 * política de segurança de conteúdo não precise liberar script embutido só por
 * causa disto.
 */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Registrar depois do carregamento evita disputar largura de banda com o
    // que a pessoa está esperando ver na tela.
    const registrar = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Falhar aqui não é motivo para quebrar a aplicação: sem service
        // worker ela continua funcionando, só perde o modo offline.
      });
    };

    if (document.readyState === "complete") registrar();
    else {
      window.addEventListener("load", registrar, { once: true });
      return () => window.removeEventListener("load", registrar);
    }
  }, []);

  return null;
}
