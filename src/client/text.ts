// Words on screen built from game data.

import type { LastAction, TableView } from '../game/protocol';
import { cardText } from './cards';

export function nameOf(view: TableView, id: string | null | undefined): string {
  if (!id) return 'Someone';
  if (id === view.you) return 'You';
  return view.players.find((p) => p.id === id)?.name ?? 'Someone';
}

/** "Mom took Q♠ from the discard". */
export function eventText(view: TableView, e: LastAction): string {
  const who = nameOf(view, e.by);
  switch (e.kind) {
    case 'drewStock':
      return `${who} drew from the stock${e.reshuffled ? ' (discard pile reshuffled)' : ''}`;
    case 'drewDiscard':
      return `${who} took ${cardText(e.card)} from the discard`;
    case 'discarded':
      return `${who} threw ${cardText(e.card)}`;
    case 'showed':
      return `${who} showed 3 sets`;
    case 'sawJoker':
      return `${who} saw the joker`;
  }
}

export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
