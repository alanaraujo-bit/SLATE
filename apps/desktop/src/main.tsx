import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Agente } from "./Agente";
import "./estilos.css";

const raiz = document.getElementById("raiz");
if (!raiz) throw new Error("elemento raiz não encontrado");

createRoot(raiz).render(
  <StrictMode>
    <Agente />
  </StrictMode>,
);
