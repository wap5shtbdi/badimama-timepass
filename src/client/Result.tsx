// Round result (mockup "round result"): value points and card points shown separately.

import { useEffect, useState } from 'react';
import type { ResultRow, TableView } from '../game/protocol';
import { Card } from './Card';
import { cardText } from './cards';
import { Modal } from './Dialogs';
import { setLabel, sortGroup } from './hand';
import { signed } from './text';
import type { TableConnection } from './useTable';

export function Result({ view, conn, fourColor, onLeave }: { view: TableView; conn: TableConnection; fourColor: boolean; onLeave: () => void }) {
  const [confirmLeave, setConfirmLeave] = useState(false);
  useEffect(() => {
    if (!confirmLeave) return;
    const t = setTimeout(() => setConfirmLeave(false), 3000);
    return () => clearTimeout(t);
  }, [confirmLeave]);
  const result = view.result!;
  const [openRow, setOpenRow] = useState<ResultRow | null>(null);
  const [scoreboard, setScoreboard] = useState(false);
  const declarer = result.rows.find((r) => r.player === result.declarer)!;
  const isHost = view.hostId === view.you;
  const host = view.players.find((p) => p.isHost);
  const nm = (r: ResultRow) => (r.player === view.you ? 'You' : r.name);
  const nameOfRow = (id: string) => result.rows.find((r) => r.player === id)?.name ?? 'Someone';

  return (
    <main className="result">
      <div className="result-head">
        <h1>
          {nm(declarer)} declared{result.how === 'pairs' ? ' with pairs' : ''}
        </h1>
        <span className="muted">
          Round {result.roundNo} · Joker was {cardText(result.joker)}
        </span>
        <span className="grow" />
        <strong className="gold">
          {nm(declarer)} {declarer.player === view.you ? 'win' : 'wins'} {declarer.net}
        </strong>
      </div>

      <div className="result-table" role="table" aria-label="Round result">
        <div className="rt-row rt-head" role="row">
          <span role="columnheader">Player</span>
          <span role="columnheader">Saw joker</span>
          <span role="columnheader">Value points</span>
          <span role="columnheader">Unused cards</span>
          <span role="columnheader" className="right">
            Pays {nm(declarer)}
          </span>
        </div>
        {result.rows.map((r) => {
          const isDeclarer = r.player === result.declarer;
          return (
            <div className="rt-row" role="row" key={r.player}>
              <span role="cell">
                <button type="button" className="link-btn" onClick={() => setOpenRow(r)}>
                  {nm(r)}
                </button>
              </span>
              <span role="cell">{r.seen ? 'Yes' : 'No'}</span>
              <span role="cell">
                {r.value}
                {r.marriages ? ` (${r.marriages} marriage${r.marriages > 1 ? 's' : ''})` : ''}
              </span>
              <span role="cell" className="stack">
                {isDeclarer ? (
                  'Declared'
                ) : r.packed ? (
                  <>
                    <span>{r.unused} pts</span>
                    <span className="muted small">{r.packed === 'pairs' ? 'packed with pairs' : 'packed'}</span>
                  </>
                ) : (
                  <>
                    <span>
                      {r.unused} pts{r.unused === 10 ? ' (max)' : ''}
                    </span>
                    <span className="muted small">sum {r.unusedSum}, jokers excluded</span>
                  </>
                )}
              </span>
              <span role="cell" className={`right strong${r.pays < 0 ? ' gold' : ''}`}>
                {isDeclarer
                  ? '—'
                  : r.pays >= 0
                    ? `${r.unused} + ${declarer.value} − ${r.value} = ${r.pays}`
                    : `gets ${-r.pays}`}
              </span>
            </div>
          );
        })}
      </div>

      {result.openingShows.length > 0 && (
        <p className="muted opening-line">
          Paid before play:{' '}
          {result.openingShows.map((o, k) => (
            <span key={k}>
              {k > 0 ? ' · ' : ''}
              {o.by === view.you ? 'You' : nameOfRow(o.by)} showed {o.cards.map(cardText).join(' ')} (+{o.points} from each)
            </span>
          ))}
        </p>
      )}

      <div className="grow" />

      <div className="result-foot">
        {view.you && (
          <button
            type="button"
            className={`btn ${confirmLeave ? 'btn-danger' : 'btn-leave'}`}
            onClick={() => (confirmLeave ? onLeave() : setConfirmLeave(true))}
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
              <path d="M10 17l-5-5 5-5" />
              <path d="M5 12h11" />
            </svg>
            {confirmLeave ? 'Tap again to leave' : 'Leave table'}
          </button>
        )}
        <span className="muted small leave-note">Your total is kept if you come back on this phone.</span>
        <span className="grow" />
        <button type="button" className="btn btn-outline" onClick={() => setScoreboard(true)}>
          Scoreboard
        </button>
        {isHost ? (
          <button type="button" className="btn btn-gold" onClick={() => conn.send({ type: 'start' })}>
            Next round
          </button>
        ) : (
          <span className="muted">Waiting for {host?.name ?? 'the host'} to start the next round</span>
        )}
      </div>

      {openRow && (
        <Modal label={`${nm(openRow)}'s hand`} onClose={() => setOpenRow(null)} wide>
          <div className="modal-head">
            <h2>{nm(openRow)}</h2>
            <span className="muted">
              {openRow.player === result.declarer
                ? result.how === 'pairs'
                  ? 'Declared with pairs'
                  : 'Declared with these sets'
                : openRow.packed
                  ? 'Packed: cards as held'
                  : 'Arranged automatically for scoring'}
            </span>
            <span className="grow" />
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setOpenRow(null)}>
              Close
            </button>
          </div>
          <div className="sets-show">
            {openRow.sets.map((s, i) => {
              const label = setLabel(s, openRow.seen ? result.joker : null);
              return (
                <div key={i} className={`set set-${label.tone}`}>
                  <div className="set-head">
                    <span className="set-label">✓ {label.text}</span>
                  </div>
                  <div className="set-cards">
                    {sortGroup(s).map((c) => (
                      <span className="slot slot-sm" key={c.id}>
                        <Card card={c} size="sm" joker={result.joker} fourColor={fourColor} />
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {openRow.loose.length > 0 && (
            <>
              <h3 className="muted small">Unused</h3>
              <div className="set-cards set-cards-open">
                {openRow.loose.map((c) => (
                  <span className="slot slot-sm" key={c.id}>
                    <Card card={c} size="sm" joker={result.joker} fourColor={fourColor} />
                  </span>
                ))}
              </div>
            </>
          )}
        </Modal>
      )}

      {scoreboard && (
        <Modal label="Scoreboard" onClose={() => setScoreboard(false)}>
          <div className="modal-head">
            <h2>Total so far</h2>
            <span className="grow" />
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setScoreboard(false)}>
              Close
            </button>
          </div>
          <ul className="totals">
            {view.players
              .slice()
              .sort((a, b) => b.total - a.total)
              .map((p) => (
                <li key={p.id}>
                  <span>{p.id === view.you ? 'You' : p.name}</span>
                  <span>{signed(p.total)}</span>
                </li>
              ))}
          </ul>
        </Modal>
      )}
    </main>
  );
}
