// The table during a round (mockups "your turn", "show 3 sets", "arrange", "PC — table").

import { type DragEvent, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { TableView } from '../game/protocol';
import {
  canDeclare,
  type Card as CardT,
  isOpeningCard,
  openingPoints,
  rankAbove,
  rankBelow,
  rankLabel,
  valuePoints,
} from '../rules';
import { Card, CardBack, type CardSize } from './Card';
import { cardText } from './cards';
import {
  addToSet,
  allCards,
  dropResult,
  type HandModel,
  moveBefore,
  newSet,
  pureSetCount,
  setLabel,
  jokersLeft,
  sortLoose,
  toHand,
  unusedNow,
} from './hand';
import { eventText, nameOf, signed } from './text';
import { useTouchDrag } from './touchDrag';
import type { TableConnection } from './useTable';

interface GameProps {
  view: TableView;
  conn: TableConnection;
  fourColor: boolean;
  wide: boolean;
  onOpenPlayer: (id: string) => void;
  onOpenMenu: () => void;
}

const canDrag = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches;

export function Game({ view, conn, fourColor, wide, onOpenPlayer, onOpenMenu }: GameProps) {
  const round = view.round!;
  const me = view.players.find((p) => p.id === view.you);
  const hand = conn.hand;
  const joker = round.joker;
  const myTurn = round.turn === view.you;
  const waiting = !!round.show || !!round.awaitingPick || !!round.opening;
  const seen = !!me?.seen;
  const shown = !!me?.shown;

  // ---------- Selection (tap order is shown on the cards) ----------
  const [selection, setSelection] = useState<string[]>([]);
  const held = useMemo(() => new Set(hand ? allCards(hand).map((c) => c.id) : []), [hand]);
  const sel = selection.filter((id) => held.has(id));
  const toggle = (id: string) =>
    setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.filter((x) => held.has(x)), id]));
  const clearSel = () => setSelection([]);
  const inSets = useMemo(() => new Set(hand ? hand.sets.flat().map((c) => c.id) : []), [hand]);
  const selInSet = sel.some((id) => inSets.has(id));

  // Declare needs a second tap (it ends the round).
  const [confirmDeclare, setConfirmDeclare] = useState(false);
  useEffect(() => {
    if (!confirmDeclare) return;
    const t = setTimeout(() => setConfirmDeclare(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDeclare]);

  const dragging = useRef<string[]>([]);
  const draggable = canDrag();
  // Touch drag (phones): the drop handler needs this render's hand, so it's set further down.
  const touchDropRef = useRef<(ids: string[], target: string | null) => void>(() => {});
  const touch = useTouchDrag((ids, target) => touchDropRef.current(ids, target));

  if (!hand || !me) {
    return (
      <div className="game watching">
        <TopBar view={view} pill={`${nameOf(view, round.turn)}'s turn`} onOpenPlayer={onOpenPlayer} onOpenMenu={onOpenMenu} />
        <p className="watching-note">A round is being played. You can join when it ends.</p>
      </div>
    );
  }

  const apply = (next: HandModel) => {
    conn.arrange(next);
    clearSel();
  };

  // ---------- What can I do right now? ----------
  const canDraw = myTurn && round.stage === 'draw' && !waiting;
  const canDiscard = myTurn && round.stage === 'discard' && !waiting;
  const pure = pureSetCount(hand);
  const canShowNow = myTurn && !waiting && !shown && pure >= 3;

  const putDown: CardT | null =
    round.stage === 'discard'
      ? sel.length === 1
        ? (allCards(hand).find((c) => c.id === sel[0]) ?? null)
        : hand.loose.length === 1
          ? (hand.loose[0] as CardT)
          : null
      : null;
  const declareCheck = (() => {
    if (!seen || !myTurn || waiting) return null;
    if (round.stage === 'draw') {
      // Before drawing, only offer it when it would work (rare: all 21 cards already in sets).
      const c = canDeclare(hand.sets, hand.loose, joker);
      return c.ok ? c : null;
    }
    if (!putDown) {
      return hand.loose.length > 1
        ? { ok: false, reason: 'Put all cards but one into sets' }
        : { ok: false, reason: 'Choose the card to put down' };
    }
    const after = toHand(hand, [putDown.id]);
    return canDeclare(after.sets, after.loose.filter((c) => c.id !== putDown.id), joker);
  })();

  const discard = (id: string) => {
    if (conn.send({ type: 'discard', cardId: id })) clearSel();
  };
  const declare = () => {
    if (!confirmDeclare) return setConfirmDeclare(true);
    setConfirmDeclare(false);
    conn.send(round.stage === 'discard' && putDown ? { type: 'declare', discardId: putDown.id } : { type: 'declare' });
  };

  // ---------- Drag and drop (PC) ----------
  const startDrag = (id: string) => (e: DragEvent) => {
    dragging.current = sel.includes(id) && sel.length > 1 ? sel : [id];
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const dropOn = (fn: (ids: string[]) => void) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ids = dragging.current;
    dragging.current = [];
    if (ids.length) fn(ids);
  };
  const dropOnCard = (targetId: string) =>
    dropOn((ids) => {
      let next = hand;
      for (const id of ids) next = moveBefore(next, id, targetId);
      apply(next);
    });
  const allowDrop = (e: DragEvent) => e.preventDefault();

  // ---------- Touch drag (phones): hold a card, then drag ----------
  const dragIds = (id: string) => (sel.includes(id) && sel.length > 1 ? sel : [id]);
  touchDropRef.current = (ids, target) => {
    const r = dropResult(hand, ids, target, canDiscard);
    if (r?.kind === 'arrange') apply(r.hand);
    else if (r?.kind === 'discard') discard(r.cardId);
  };
  const dragged = new Set(touch.drag?.ids ?? []);
  const slotProps = (c: CardT, size: 'sm' | 'lg') => ({
    className: `slot slot-${size}${dragged.has(c.id) ? ' is-dragging' : ''}`,
    'data-drop': `card:${c.id}`,
    onPointerDown: (e: ReactPointerEvent) => touch.begin(e, c.id, dragIds(c.id)),
  });
  const ghostCard = touch.drag ? allCards(hand).find((c) => c.id === touch.drag!.cardId) : undefined;

  // ---------- Pieces ----------
  const cardProps = (c: CardT, size: CardSize) => ({
    card: c,
    size,
    joker,
    fourColor,
    selected: sel.indexOf(c.id) + 1,
    onTap: () => {
      if (!touch.swallowClick()) toggle(c.id);
    },
    draggable,
    onDragStart: draggable ? startDrag(c.id) : undefined,
    onDrop: draggable ? dropOnCard(c.id) : undefined,
  });

  const pill = waiting
    ? round.opening
      ? 'Before play: show A♠ / 2♣?'
      : round.show
      ? 'Checking shown sets'
      : `${nameOf(view, round.awaitingPick)} ${round.awaitingPick === view.you ? 'pick' : 'is picking'} the joker`
    : myTurn
      ? round.stage === 'draw'
        ? 'Your turn · draw a card'
        : 'Your turn · discard 1 card'
      : `${nameOf(view, round.turn)}'s turn`;

  const lastEvent = round.events.at(-1);
  const myValue = joker ? valuePoints(allCards(hand), joker).points : 0;
  const unused = joker ? unusedNow(hand, joker) : null;

  return (
    <div className={`game${wide ? ' is-wide' : ''}`}>
      <TopBar view={view} pill={pill} gold={myTurn && !waiting} onOpenPlayer={onOpenPlayer} onOpenMenu={onOpenMenu} />

      <div className="game-body">
        <div className="game-main">
          {/* Middle row: piles, joker, actions */}
          <div className="table-row">
            <div className="stock-spot">
              <StockStack
                count={round.stockCount}
                canDraw={canDraw}
                onDraw={() => conn.send({ type: 'draw', from: 'stock' })}
              />
              <span className="spot-label">Stock · {round.stockCount}</span>
              {canDraw && <span className="spot-hint">Tap to draw</span>}
            </div>

            <JokerPanel view={view} joker={joker} fourColor={fourColor} myValue={myValue} />

            <DiscardPile
              cards={round.discardRecent}
              total={round.discardCount}
              joker={joker}
              fourColor={fourColor}
              canTake={canDraw}
              onTake={() => conn.send({ type: 'draw', from: 'discard' })}
              dropTarget={canDiscard && draggable}
              onDragOver={canDiscard ? allowDrop : undefined}
              onDrop={canDiscard ? dropOn((ids) => ids.length === 1 && discard(ids[0] as string)) : undefined}
            />

            <div className="actions" aria-live="polite">
              {round.opening && <OpeningBox view={view} conn={conn} hand={hand} />}
              {round.show && round.show.by === view.you && (
                <p className="hint">Waiting for {round.show.waitingFor.map((id) => nameOf(view, id)).join(', ')} to check your sets</p>
              )}
              {!waiting && canShowNow && (
                <div className="show-ready">
                  <strong>3 sets ready</strong>
                  <span>Everyone checks them, then you see the joker.</span>
                  <button type="button" className="btn btn-gold" onClick={() => conn.send({ type: 'show' })}>
                    Show to everyone
                  </button>
                </div>
              )}
              {canDiscard && sel.length === 1 && putDown && (
                <button type="button" className="btn btn-gold" onClick={() => discard(putDown.id)}>
                  Discard {cardText(putDown)}
                </button>
              )}
              {canDiscard && sel.length === 0 && !canShowNow && <p className="hint">Tap a card, then Discard</p>}
              {canDraw && sel.length === 0 && !canShowNow && <p className="hint">Draw from the stock, or take the top card of the pile</p>}
              {declareCheck && (
                <button
                  type="button"
                  className={`btn ${confirmDeclare ? 'btn-gold' : 'btn-outline'}`}
                  onClick={declare}
                  disabled={!declareCheck.ok}
                  title={declareCheck.ok ? undefined : declareCheck.reason}
                >
                  {confirmDeclare ? 'Tap again to declare' : 'Declare'}
                </button>
              )}
              {declareCheck && !declareCheck.ok && round.stage === 'discard' && sel.length === 0 && (
                <p className="hint small">{declareCheck.reason}</p>
              )}
              {!myTurn && !waiting && lastEvent && !wide && <p className="hint">{eventText(view, lastEvent)}</p>}
              {sel.length > 0 && (
                <div className="sel-tools">
                  <span className="sel-count">{sel.length} selected</span>
                  <button type="button" className="btn btn-small" onClick={() => apply(newSet(hand, sel))}>
                    New set
                  </button>
                  {selInSet && (
                    <button type="button" className="btn btn-small" onClick={() => apply(toHand(hand, sel))}>
                      Break set
                    </button>
                  )}
                  <button type="button" className="btn btn-small btn-ghost" onClick={clearSel}>
                    Clear
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Sets */}
          <section className="zone zone-sets" aria-label="Your sets">
            <div className="zone-head">
              SETS
              <br />
              {hand.sets.length}
            </div>
            <div className="sets-row" onDragOver={draggable ? allowDrop : undefined}>
              {hand.sets.map((set, i) => {
                const label = setLabel(set, joker);
                return (
                  <div
                    key={set[0]?.id ?? i}
                    className={`set set-${label.tone}`}
                    data-drop={`set:${i}`}
                    onDragOver={draggable ? allowDrop : undefined}
                    onDrop={draggable ? dropOn((ids) => apply(addToSet(hand, i, ids))) : undefined}
                  >
                    <div className="set-head">
                      <span className="set-label" title={label.text}>
                        {label.tone === 'bad' ? '! ' : '✓ '}
                        {label.short}
                      </span>
                      {sel.length > 0 && (
                        <button type="button" className="set-add" onClick={() => apply(addToSet(hand, i, sel))}>
                          + Add
                        </button>
                      )}
                    </div>
                    <div className="set-cards">
                      {set.map((c) => (
                        <span key={c.id} {...slotProps(c, 'sm')}>
                          <Card {...cardProps(c, 'sm')} />
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                className="new-set"
                data-drop="newset"
                onClick={() => sel.length && apply(newSet(hand, sel))}
                disabled={sel.length === 0 && !draggable}
                onDragOver={draggable ? allowDrop : undefined}
                onDrop={draggable ? dropOn((ids) => apply(newSet(hand, ids))) : undefined}
              >
                <span aria-hidden="true">+</span>
                <span>New set</span>
              </button>
            </div>
          </section>

          {/* Cards in hand */}
          <section
            className="zone zone-hand"
            data-drop="hand"
            aria-label="Cards in hand"
            onDragOver={draggable ? allowDrop : undefined}
            onDrop={draggable ? dropOn((ids) => apply(toHand(hand, ids))) : undefined}
          >
            <div className="zone-head">
              IN HAND
              <br />
              {hand.loose.length}
            </div>
            <div className="hand-row">
              {hand.loose.map((c) => (
                <span key={c.id} {...slotProps(c, 'lg')}>
                  <Card {...cardProps(c, 'lg')} />
                </span>
              ))}
            </div>
            <div className="hand-side">
              <span className="counter" title={seen ? 'Card points you would pay if someone declared now' : undefined}>
                {seen && unused ? (
                  <>
                    Unused <strong>{unused.points}</strong>
                  </>
                ) : (
                  <>
                    Pure sets <strong>{Math.min(pure, 3)}/3</strong>
                  </>
                )}
              </span>
              {joker && hand.loose.length > 1 && (
                <button type="button" className="sort-btn" onClick={() => apply(jokersLeft(hand, joker))} aria-label="Move jokers to the left">
                  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 6l-6 6 6 6M19 6l-6 6 6 6" />
                  </svg>
                  <span>Jokers</span>
                </button>
              )}
              <button type="button" className="sort-btn" onClick={() => apply(sortLoose(hand))}>
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" />
                </svg>
                <span>Sort</span>
              </button>
            </div>
          </section>
        </div>

        {wide && <SidePanel view={view} />}
      </div>

      {touch.drag && ghostCard && (
        <div ref={touch.ghostRef} className="drag-ghost" aria-hidden="true">
          <span className="drag-ghost-card">
            <Card card={ghostCard} size="lg" joker={joker} fourColor={fourColor} />
            {touch.drag.ids.length > 1 && <span className="drag-count">{touch.drag.ids.length}</span>}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------- Top bar ----------

export function TopBar({
  view,
  pill,
  gold,
  onOpenPlayer,
  onOpenMenu,
}: {
  view: TableView;
  pill: string;
  gold?: boolean;
  onOpenPlayer: (id: string) => void;
  onOpenMenu: () => void;
}) {
  const turn = view.round?.turn;
  return (
    <header className="topbar">
      <div key={gold ? 'mine' : 'other'} className={`pill${gold ? ' pill-gold pill-pulse' : ''}`}>
        {pill}
      </div>
      <div className="topbar-space" />
      <nav className="chips" aria-label="Players">
        {view.players
          .filter((p) => p.id !== view.you)
          .map((p) => (
            <button
              type="button"
              key={p.id}
              className={`chip${p.id === turn ? ' is-turn' : ''}${p.connected ? '' : ' is-offline'}`}
              onClick={() => onOpenPlayer(p.id)}
              aria-label={`${p.name}${p.seen ? ', has seen the joker' : ''}${p.connected ? '' : ', offline'}. Show their sets`}
            >
              <span>{p.name}</span>
              {p.seen && <EyeIcon />}
              {!p.connected && <span className="chip-off">offline</span>}
            </button>
          ))}
      </nav>
      <button type="button" className="icon-btn" aria-label="Menu" onClick={onOpenMenu}>
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
    </header>
  );
}

function EyeIcon() {
  return (
    <svg role="img" aria-label="Has seen the joker" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// ---------- Before play: show A♠ / 2♣ (2026-10-31) ----------

function OpeningBox({ view, conn, hand }: { view: TableView; conn: TableConnection; hand: HandModel }) {
  const waitingFor = view.round!.opening!.waitingFor;
  const others = waitingFor.filter((id) => id !== view.you).map((id) => nameOf(view, id));
  const shows = view.round!.openingShows.map((o) => (
    <span key={o.by} className="opening-shown">
      {eventText(view, { by: o.by, kind: 'openingShow', cards: o.cards, points: o.points })}
    </span>
  ));
  if (!view.you || !waitingFor.includes(view.you)) {
    return (
      <>
        {shows}
        <p className="hint">Waiting for {others.join(', ')} to show A♠ / 2♣ or skip</p>
      </>
    );
  }
  const mine = allCards(hand)
    .filter(isOpeningCard)
    .sort((x, y) => x.rank - y.rank); // A♠ first, then 2♣
  const pts = openingPoints(mine);
  return (
    <div className="show-ready">
      {shows}
      {mine.length > 0 ? (
        <>
          <strong>You have {mine.map(cardText).join(' ')}</strong>
          <span>Show them: everyone pays you {pts} now.</span>
          <button type="button" className="btn btn-gold" onClick={() => conn.send({ type: 'opening', show: true })}>
            Show · +{pts} each
          </button>
          <button type="button" className="btn btn-small btn-ghost" onClick={() => conn.send({ type: 'opening', show: false })}>
            Don't show
          </button>
        </>
      ) : (
        <>
          <strong>No A♠ or 2♣</strong>
          <span>Tap Ready to start play.</span>
          <button type="button" className="btn btn-gold" onClick={() => conn.send({ type: 'opening', show: false })}>
            Ready
          </button>
        </>
      )}
    </div>
  );
}

// ---------- Stock, joker and the discard pile ----------

function StockStack({ count, canDraw, onDraw }: { count: number; canDraw: boolean; onDraw: () => void }) {
  return (
    <span className="stock-stack">
      {count > 2 && <span className="card card-md card-back stack-under stack-2" aria-hidden="true" />}
      {count > 1 && <span className="card card-md card-back stack-under stack-1" aria-hidden="true" />}
      <CardBack
        size="md"
        label={canDraw ? `Draw from the stock, ${count} cards` : `Stock, ${count} cards`}
        onTap={canDraw ? onDraw : undefined}
        raised={canDraw}
      />
    </span>
  );
}

/** Small stable number from a card id, so a card keeps its spot and angle in the pile. */
function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** The discard pile in the middle of the table, thrown roughly like on a real table. */
function DiscardPile({
  cards,
  total,
  joker,
  fourColor,
  canTake,
  onTake,
  dropTarget,
  onDragOver,
  onDrop,
}: {
  cards: CardT[];
  total: number;
  joker: CardT | null;
  fourColor: boolean;
  canTake: boolean;
  onTake: () => void;
  dropTarget: boolean;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
}) {
  return (
    <div className={`mat${dropTarget ? ' is-drop' : ''}`} data-drop="pile" onDragOver={onDragOver} onDrop={onDrop}>
      {cards.length === 0 && <span className="mat-empty">Discard pile is empty</span>}
      {cards.map((c, i) => {
        const top = i === cards.length - 1;
        const a = hash(c.id);
        const b = hash(c.id + '*');
        // Older throws spread out; the top card lands near the middle.
        const spread = top ? 0.12 : 1;
        const x = (a - 0.5) * 2.6 * spread; // in card widths
        const y = (b - 0.5) * 0.35 * spread; // in card heights
        const rot = (hash(c.id + '/') - 0.5) * (top ? 12 : 40);
        return (
          <span
            key={c.id}
            className={`mat-card${top && canTake ? ' pile-take' : ''}`}
            style={{ transform: `translate(calc(-50% + ${x} * var(--md-w)), calc(-50% + ${y} * var(--md-h))) rotate(${rot}deg)`, zIndex: i }}
          >
            <Card card={c} size="md" joker={joker} fourColor={fourColor} onTap={top && canTake ? onTake : undefined} />
          </span>
        );
      })}
      <span className="sr-only">Discard pile, {total} cards</span>
    </div>
  );
}

function JokerPanel({ view, joker, fourColor, myValue }: { view: TableView; joker: CardT | null; fourColor: boolean; myValue: number }) {
  const round = view.round!;
  if (joker) {
    const low = cardText({ rank: rankBelow(joker.rank), suit: joker.suit });
    const high = cardText({ rank: rankAbove(joker.rank), suit: joker.suit });
    return (
      <div className="joker-panel">
        <span className="joker-card">
          <Card card={joker} size="md" joker={null} fourColor={fourColor} />
        </span>
        <div className="joker-text">
          <span className="joker-kicker">JOKER</span>
          <strong>{cardText(joker)}</strong>
          <span>
            Wild: all {rankLabel(joker.rank)}s, {low}, {high}
          </span>
          <span>Your value: {myValue}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="joker-panel">
      <span className="card card-md card-hidden" role="img" aria-label="Joker hidden">
        ?
      </span>
      <div className="joker-text">
        <span className="joker-kicker">JOKER</span>
        <strong>Hidden</strong>
        <span>{round.jokerPicked ? `Picked by ${nameOf(view, round.pickedBy)}` : 'Not picked yet'}</span>
        <span>Show 3 pure sets to see it</span>
      </div>
    </div>
  );
}

// ---------- PC side panel ----------

function SidePanel({ view }: { view: TableView }) {
  const events = view.round?.events ?? [];
  return (
    <aside className="side">
      <section>
        <h2>This round</h2>
        {events.length === 0 && <p className="muted">Nothing yet</p>}
        <ol className="log">
          {events
            .slice()
            .reverse()
            .map((e, i) => (
              <li key={events.length - i}>{eventText(view, e)}</li>
            ))}
        </ol>
      </section>
      <section>
        <h2>Total so far</h2>
        <ul className="totals">
          {view.players.map((p) => (
            <li key={p.id}>
              <span>{p.id === view.you ? 'You' : p.name}</span>
              <span>{signed(p.total)}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
