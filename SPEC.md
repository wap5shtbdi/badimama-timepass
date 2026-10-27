# Marriage (21-card rummy) — family web app spec

Status: v0.5, 2026-10-27. All rules confirmed. Rules confirmed by Vikram unless marked OPEN.
Goal: playable online with parents (India, Android browser), Vikram (Paris, PC), sometimes sister. Target: playable by weekend of 2026-10-31.
Mockups: Design canvas "Marriage card game mockups" (claude.ai artifact HeghxSFRmevPtwZEn8wWdF).

## 1. Setup (confirmed)
- 3 standard decks, 156 cards, no printed jokers.
- 2–5 players, 21 cards each. Remaining cards = face-down stock; one card turned up to start the discard pile.
- Turn: draw 1 (stock or top of discard) → 22 cards → discard 1 → back to 21.

## 2. Valid sets (confirmed: 3 or more cards)
- Pure sequence: 3+ consecutive cards, same suit. Mixed-suit sequences are never valid.
  - Aces: Q-K-A valid, A-2-3 valid, K-A-2 invalid (no wrap-around).
- Trail: three identical cards (same rank AND same suit), e.g. 7♠ 7♠ 7♠.
- Before seeing the joker: only pure sequences and trails, no wildcards.
- After seeing the joker:
  - Off-suit trails also valid: same rank, different suits (7♠ 7♥ 7♦).
  - Jokers (section 3) act as wildcards in sets.

## 3. Joker (confirmed)
- A player must show 3 pure sequences or trails to see the joker.
- The FIRST player to do so picks the joker card from the stock (face down). That card stays out of play.
- Every later player who shows 3 pure sequences/trails also sees it.
- Players who have not seen it: their screen does not show which card is the joker.
- Example: picked card = 7♥.
  - Jokers (wildcards): ALL 7s (any suit) + 6♥ + 8♥.
  - Value cards (score points): only 7♥, 6♥, 8♥.

## 4. Value points (example: joker 7♥)
| Holding | Points |
|---|---|
| 7♥ | 3 |
| 6♥ or 8♥ | 2 each |
| 6♥ + 8♥ | 4 |
| 6♥ + 7♥ (or 7♥ + 8♥) | 5 (sum per card) |
| 6♥ 6♥, 8♥ 8♥ | 5 |
| 7♥ 7♥ | 8 (corrected 2026-10-27, was 5) |
| 6♥ 6♥ 7♥ 8♥ | 12 = marriage + single 6♥ |
| Marriage: 6♥ 7♥ 8♥, 6♥ 6♥ 6♥, 8♥ 8♥ 8♥ | 10 each; multiple allowed |
| 7♥ 7♥ 7♥ | impossible (third 7♥ is the picked joker, out of play) |
| Trail / tunnela of non-value cards | 0 |

- Rule of thumb: card values add up per card; pairs of the same value card = 5; marriage combos = 10.
- Players who never saw the joker STILL score the value cards they hold.
- Overlapping combos: score the grouping that gives the most points. Confirmed example: 6♥ 6♥ 7♥ = pair 6♥6♥ (5) + 7♥ (3) = 8.

## 5. Winning (confirmed)
- A player who has seen the joker arranges all 21 cards into sets of 3+ and declares.

## 6. Settlement (confirmed except OPEN-13/14)
- Card values: A, K, Q, J = 10 each; 2–10 = face value.
- Jokers (all 7s, 6♥, 8♥ in the example) are removed before summing.
- Card points = sum ÷ 10, rounded half down (23 → 2, 25 → 2, 26 → 3), capped at 10.
- Each non-declarer pays the declarer: card points + declarer's value points − own value points.
  - Example: declarer 10 value pts. Mom: card pts 3, value 2 → pays 11.
- Only UNUSED cards are summed: cards not in a valid set, jokers excluded (confirmed).
- If the result is negative, the declarer pays that player the difference (confirmed). Example: Dad card pts 2, declarer value 3, Dad value 15 → 2 + 3 − 15 = −10 → declarer pays Dad 10.
- All rules confirmed as of v0.5; no OPEN items.

## 6b. Edge cases found while coding the rules engine (all confirmed 2026-10-27)
- 7♥ 7♥ = 8.
- 6♥ 6♥ 7♥ 8♥ = 12 (marriage + single 6♥). General rule: score the grouping with the most points.
  - Derived, not yet confirmed: 6♥ 7♥ 7♥ 8♥ = 13 (marriage + single 7♥ beats 6♥ + 7♥7♥ + 8♥ = 12).
- Ace/King jokers wrap: joker A♥ → K♥ and 2♥ are value cards/jokers; joker K♥ → Q♥ and A♥.
- A set made only of jokers (e.g. 6♥ 7♠ 8♥) IS allowed after seeing the joker (corrected by Vikram).
  - Assumed, not yet confirmed: it counts toward the minimum 3 (jokers can always stand in for a sequence).

## 7. Technical decisions (confirmed 2026-10-27)
- Installable web app (PWA): home-screen icon, full screen, landscape. Works on Android Chrome and PC. No APK for v1.
  - APK later possible via Bubblewrap (TWA wrapper, @bubblewrap/cli 1.27.0, Oct 2026) without code changes.
  - Play Store not viable short-term: new personal developer accounts need a 12-tester, 14-day closed test.
- Server-authoritative: the server holds the deck and every hand; clients get their own hand + everyone's sets, never others' loose cards.
- Stack: TypeScript everywhere; shared rules module (src/rules) used by server and UI.
  - Server: Cloudflare Worker + one Durable Object per table, WebSocket hibernation API (plain DOs, not PartyServer, which its README calls work in progress).
  - Client: React + Vite, Cloudflare Vite plugin (page + server in one Worker); partysocket for auto-reconnect.
  - Touch drag: custom pointer-event code; tap-to-select is the primary method on phones. (@dnd-kit/core last release Dec 2024; @dnd-kit/react is pre-1.0.)
  - Versions checked 2026-10-27: react 19.3.1, vite 8.3.5, @cloudflare/vite-plugin 1.65.0, wrangler 4.154.0, partysocket 1.3.0, typescript 7.0.2, vitest 5.0.5.
- boardgame.io REJECTED: npm latest 0.50.2, published 2022-11-10.
- Voice: WhatsApp call alongside for v1.
- Repo: github.com/wap5shtbdi/badimama-timepass (private). Hosting: Vikram's Cloudflare account (created 2026-10-27).

## 8. UI decisions (mockups v1)
- Four-colour deck by default (♦ blue, ♣ green), switchable to classic.
- Value cards: filled gold dot; other jokers: hollow gold ring. Only shown to players who have seen the joker.
- Result screen: value points and card points shown separately per player.
- Hand split into two zones (v2, requested by Vikram): SETS (top) and IN HAND (bottom), separated by a divider.
  - Each set is its own bordered group with a label (Sequence / Trail / Marriage in gold); set cards are smaller and overlapped.
  - "New set" drop target to start a group; unused cards stay full size in the IN HAND zone.
- Arranging (v3, requested by Vikram):
  - Free reordering of cards in hand and between sets.
  - Sets can have 3+ cards. Two ways to build/extend: tap cards one after another (numbered badges show order), then "+ Add" on a set or "New set"; or drag a card onto a set / onto another card (PC; touch drag TBD).
  - Each set shows a live label: Sequence / Trail / Marriage / "Sequence + joker" / "! Not a valid set" / "! needs 3+".
  - Live "unused card points" counter.
- Show-and-acknowledge flow (v3, requested by Vikram):
  1. Player with 3 pure sequences/trails taps "Show to everyone".
  2. Every other player sees a dialog with the 3 sets and taps "OK, I've seen them"; everyone sees who has checked.
  3. When all have acknowledged, the first shower picks the joker from a spread of face-down stock cards; only they see it.
  - Every player who shows goes through this flow, not only the first (confirmed). Later showers skip step 3 and simply see the joker.
  - If someone doesn't acknowledge, the game waits (confirmed).
  - No "not right" objection button: the app validates the sets itself (assumed default; Vikram didn't object).
- Seeing others' sets (confirmed): tap a player's name to see ALL the sets they currently have, live, whether or not they have shown yet. Cards in hand are NEVER visible to others.
  - Server sends other players' sets to everyone, never their in-hand cards.
- Minimum-3 rule (confirmed): once a player has seen the joker, the game blocks any move that would leave them with fewer than 3 valid sets. Message shown; move undone.
  - Any valid set counts EXCEPT mixed-suit trails (7♠ 7♥ 7♦), with or without jokers.
  - Same-suit sequences using jokers (4♠ 5♠ + 7♣) do count (confirmed).
- Jokers can NEVER complete a suited (identical) trail: K♣ K♣ + 7♠ is not a valid set (confirmed). Shown as "! No jokers in a suited trail".
  - A joker CAN complete a mixed-suit trail (K♣ K♦ + 7♠) (confirmed). Valid set, but doesn't count toward the minimum 3.

## 9. Hosting options (verified 2026-10-27)
- Render free web service: spins down after 15 min with no HTTP request or WebSocket message (changelog 2026-02-24). In-memory game lost on spin-down.
- Cloudflare Workers + Durable Objects, Free plan: SQLite backend; 100k requests/day; WebSocket hibernation avoids duration charges; incoming WS messages billed 20:1. One Durable Object per table, state persisted.
