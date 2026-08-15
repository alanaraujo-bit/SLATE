"use client";

import { useState } from "react";
import type { Snapshot } from "@/lib/snapshot";
import { T, formatarPercentual, tempoRelativo } from "@/lib/rotulos";
import { useLiveSnapshot, type LinkState } from "./use-live-snapshot";
import { Tree } from "./tree";
import { Panel, ProgressRail } from "./primitives";

export function Dashboard({ initial }: { initial: Snapshot }) {
  const { snapshot, link } = useLiveSnapshot(initial);

  return (
    <main className="shell">
      <Cabecalho snapshot={snapshot} link={link} />

      <div className="columns">
        <div className="rail">
          <Panel
            title={T.roadmap}
            flush
            action={
              <span className="mono" style={{ color: "var(--text-tertiary)" }}>
                {snapshot.totals.completedLeaves}/{snapshot.totals.leaves} {T.tarefas}
              </span>
            }
          >
            <Tree nodes={snapshot.tree} />
          </Panel>
        </div>

        <aside className="rail">
          <ExecucaoAtual snapshot={snapshot} />
          <AcoesDoOperador acoes={snapshot.operatorActions} />
          <Atividade eventos={snapshot.activity} />
          <Publicacoes publicacoes={snapshot.deployments} />
        </aside>
      </div>
    </main>
  );
}

function Cabecalho({ snapshot, link }: { snapshot: Snapshot; link: LinkState }) {
  const { totals, counts } = snapshot;

  return (
    <header>
      <div className="masthead">
        <div>
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              S
            </span>
            <div>
              <div className="brand__name">{snapshot.project.name}</div>
              <div className="brand__sub">{T.subtitulo}</div>
            </div>
          </div>
        </div>

        <div className="headline">
          <span className="headline__value">{formatarPercentual(snapshot.overall)}</span>
          <span className="headline__label">{T.progressoGeral}</span>
        </div>
      </div>

      <div style={{ marginBottom: "var(--space-5)" }}>
        <ProgressRail value={snapshot.overall} tall label={T.progressoGeral} />
      </div>

      <div className="panel" style={{ marginBottom: "var(--space-5)" }}>
        <div className="stats">
          <Indicador valor={String(totals.items)} rotulo={T.itensDeTrabalho} />
          <Indicador
            valor={`${totals.completedLeaves}/${totals.leaves}`}
            rotulo={T.tarefasConcluidas}
          />
          <Indicador
            valor={`${totals.gatesPassed}/${totals.gates}`}
            rotulo={T.criteriosAprovados}
          />
          <Indicador valor={String(counts.IN_PROGRESS)} rotulo={T.emAndamento} />
          <Indicador
            valor={String(counts.OPERATOR_REQUIRED + counts.BLOCKED_EXTERNAL)}
            rotulo={T.bloqueados}
          />
          <Indicador valor={String(counts.REOPENED)} rotulo={T.reabertos} />
        </div>
        <div
          className="panel__head"
          style={{ borderBottom: "none", borderTop: "1px solid var(--border)" }}
        >
          <IndicadorConexao link={link} />
          <span className="mono" style={{ color: "var(--text-tertiary)" }}>
            atualizado {tempoRelativo(snapshot.generatedAt)}
          </span>
        </div>
      </div>
    </header>
  );
}

function Indicador({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className="stat">
      <div className="stat__value">{valor}</div>
      <div className="stat__label">{rotulo}</div>
    </div>
  );
}

function IndicadorConexao({ link }: { link: LinkState }) {
  const texto =
    link === "live" ? T.aoVivo : link === "reconnecting" ? T.reconectando : T.semConexao;
  return (
    <span className="link-state" data-state={link}>
      <span className="link-state__dot" aria-hidden="true" />
      {texto}
      <span className="visually-hidden" role="status">
        {T.conexao}: {texto}
      </span>
    </span>
  );
}

function ExecucaoAtual({ snapshot }: { snapshot: Snapshot }) {
  const exec = snapshot.execution;

  if (!exec || (!exec.operation && !exec.itemKey)) {
    return (
      <Panel title={T.execucaoAtual}>
        <p className="notice">{T.ocioso}</p>
      </Panel>
    );
  }

  return (
    <Panel title={T.execucaoAtual}>
      <dl className="kv">
        {exec.itemKey && (
          <>
            <dt>{T.tarefa}</dt>
            <dd>
              <span className="mono" style={{ color: "var(--text-tertiary)" }}>
                {exec.itemKey}
              </span>
              <br />
              {exec.itemTitle}
            </dd>
          </>
        )}
        {exec.operation && (
          <>
            <dt>{T.operacao}</dt>
            <dd>{exec.operation}</dd>
          </>
        )}
        {exec.branch && (
          <>
            <dt>{T.branch}</dt>
            <dd className="mono">{exec.branch}</dd>
          </>
        )}
        {exec.commitSha && (
          <>
            <dt>{T.commit}</dt>
            <dd className="mono">{exec.commitSha.slice(0, 10)}</dd>
          </>
        )}
        {exec.environment && (
          <>
            <dt>{T.ambiente}</dt>
            <dd className="mono">{exec.environment}</dd>
          </>
        )}
        <dt>{T.atualizado}</dt>
        <dd>{tempoRelativo(exec.updatedAt)}</dd>
      </dl>
    </Panel>
  );
}

function AcoesDoOperador({ acoes }: { acoes: Snapshot["operatorActions"] }) {
  const abertas = acoes.filter((a) => a.status !== "RESOLVED");

  return (
    <Panel
      title={T.acoesDoOperador}
      flush
      action={
        <span
          className="mono"
          style={{ color: abertas.length ? "var(--warning)" : "var(--text-tertiary)" }}
        >
          {abertas.length} {T.abertas}
        </span>
      }
    >
      {abertas.length === 0 ? (
        <p className="notice">{T.nadaAguardando}</p>
      ) : (
        abertas.map((acao) => <LinhaAcao key={acao.code} acao={acao} />)
      )}
    </Panel>
  );
}

function LinhaAcao({ acao }: { acao: Snapshot["operatorActions"][number] }) {
  const [aberto, setAberto] = useState(false);

  return (
    <div className="action">
      <button
        type="button"
        className="action__head"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
      >
        <span>
          <span className="action__code">{acao.code}</span>
          <span className="action__title" style={{ display: "block" }}>
            {acao.title}
          </span>
        </span>
        <span
          className="chip"
          data-status={acao.projectBlocked ? "BLOCKED_EXTERNAL" : "OPERATOR_REQUIRED"}
        >
          {acao.projectBlocked ? T.bloqueiaProjeto : T.naoBloqueia}
        </span>
      </button>

      {aberto && (
        <div className="action__body">
          {acao.why && (
            <Campo rotulo={T.porQue}>
              <p>{acao.why}</p>
            </Campo>
          )}
          {acao.whatToDo && (
            <Campo rotulo={T.oQueFazer}>
              <p>{acao.whatToDo}</p>
            </Campo>
          )}
          {acao.howToValidate && (
            <Campo rotulo={T.comoValidar}>
              <p className="code-line">{acao.howToValidate}</p>
            </Campo>
          )}
          {acao.blocks && (
            <Campo rotulo={T.oQueBloqueia}>
              <p>{acao.blocks}</p>
            </Campo>
          )}
          {acao.alreadyCompleted && (
            <Campo rotulo={T.jaFeito}>
              <p>{acao.alreadyCompleted}</p>
            </Campo>
          )}
        </div>
      )}
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="action__field">
      <h4>{rotulo}</h4>
      {children}
    </div>
  );
}

function Atividade({ eventos }: { eventos: Snapshot["activity"] }) {
  return (
    <Panel title={T.atividade} flush>
      {eventos.length === 0 ? (
        <p className="notice">{T.semAtividade}</p>
      ) : (
        <ul className="feed">
          {eventos.map((evento) => (
            <li className="feed__item" data-severity={evento.severity} key={evento.id}>
              <span className="feed__dot" aria-hidden="true" />
              <div>
                <div className="feed__title">{evento.title}</div>
                {evento.detail && (
                  <div className="feed__time" style={{ color: "var(--text-secondary)" }}>
                    {evento.detail}
                  </div>
                )}
                <time className="feed__time" dateTime={evento.createdAt}>
                  {tempoRelativo(evento.createdAt)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Publicacoes({ publicacoes }: { publicacoes: Snapshot["deployments"] }) {
  return (
    <Panel title={T.implantacoes} flush>
      {publicacoes.length === 0 ? (
        <p className="notice">{T.semImplantacoes}</p>
      ) : (
        <ul className="feed">
          {publicacoes.map((pub, i) => (
            <li
              className="feed__item"
              data-severity={pub.status === "READY" ? "SUCCESS" : "WARNING"}
              key={`${pub.createdAt}-${i}`}
            >
              <span className="feed__dot" aria-hidden="true" />
              <div>
                <div className="feed__title">
                  {pub.target} → <span className="mono">{pub.environment}</span>
                </div>
                {pub.url && (
                  <a className="feed__time" href={pub.url} target="_blank" rel="noreferrer">
                    {pub.url.replace(/^https?:\/\//, "")}
                  </a>
                )}
                <time
                  className="feed__time"
                  dateTime={pub.createdAt}
                  style={{ display: "block" }}
                >
                  {tempoRelativo(pub.createdAt)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
