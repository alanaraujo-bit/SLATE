"use client";

import { useState } from "react";
import { Botao, Rotulo } from "@slate/design-system";
import { api, mensagemDoErro } from "@/lib/api";

type Modo = "entrar" | "cadastrar";

/**
 * Entrada e cadastro.
 *
 * Um formulário só, com um alternador. São o mesmo par de campos, e separá-los
 * em duas telas obrigaria quem errou o caminho a recomeçar do zero.
 */
export function FormularioConta({ aoEntrar }: { aoEntrar: () => void }) {
  const [modo, setModo] = useState<Modo>("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (enviando) return;

    setErro(null);
    setProblemas([]);
    setEnviando(true);

    try {
      const resultado =
        modo === "entrar"
          ? await api.entrar({ email, senha })
          : await api.cadastrar({ email, senha, nome: nome.trim() || undefined });

      if (!resultado.ok) {
        setErro(mensagemDoErro(resultado.erro));

        if (Array.isArray(resultado.detalhe)) {
          setProblemas(
            resultado.detalhe.map((p: { mensagem?: string }) => p.mensagem ?? ""),
          );
        }
        return;
      }

      // Cadastrar um e-mail já existente responde como sucesso, mas sem
      // sessão — é assim que a API evita revelar quais endereços têm conta.
      // Aqui isso vira uma orientação útil em vez de uma tela travada.
      if (modo === "cadastrar" && !("usuario" in resultado.dados)) {
        setModo("entrar");
        setErro("Se você já tem conta com esse e-mail, entre com sua senha.");
        return;
      }

      aoEntrar();
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form className="conta" onSubmit={enviar} noValidate>
      <h1 className="conta__titulo">
        {modo === "entrar" ? "Entrar no SLATE" : "Criar conta"}
      </h1>

      {modo === "cadastrar" && (
        <label className="campo">
          <span className="campo__rotulo">Nome (opcional)</span>
          <input
            className="campo__entrada"
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            autoComplete="name"
            maxLength={80}
          />
        </label>
      )}

      <label className="campo">
        <span className="campo__rotulo">E-mail</span>
        <input
          className="campo__entrada"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          // inputMode e autoCapitalize evitam o teclado do celular capitalizar
          // a primeira letra do e-mail, que é um erro comum e invisível.
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="email"
          required
        />
      </label>

      <label className="campo">
        <span className="campo__rotulo">Senha</span>
        <input
          className="campo__entrada"
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          autoComplete={modo === "entrar" ? "current-password" : "new-password"}
          required
        />
      </label>

      {erro && (
        <p className="conta__erro" role="alert">
          {erro}
        </p>
      )}

      {problemas.length > 0 && (
        <ul className="conta__problemas">
          {problemas.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <Botao
        type="submit"
        tom="acento"
        tamanho="lg"
        estado={enviando ? "loading" : "idle"}
      >
        {modo === "entrar" ? "Entrar" : "Criar conta"}
      </Botao>

      <button
        type="button"
        className="conta__alternar"
        onClick={() => {
          setModo(modo === "entrar" ? "cadastrar" : "entrar");
          setErro(null);
          setProblemas([]);
        }}
      >
        {modo === "entrar"
          ? "Não tenho conta ainda"
          : "Já tenho conta"}
      </button>

      {modo === "cadastrar" && (
        <Rotulo tamanho="xs" tom="sutil">
          {/*
            Avisado no momento do cadastro, e não escondido: sem recuperação,
            esquecer a senha custa todos os dispositivos e painéis (ADR-0005).
          */}
          A recuperação de senha por e-mail ainda não está ativa. Guarde sua senha
          em lugar seguro.
        </Rotulo>
      )}
    </form>
  );
}
