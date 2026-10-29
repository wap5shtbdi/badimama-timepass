# Marriage (21-card rummy) — family web app spec

Status: v0.8, 2026-10-27. All rules confirmed, including the table-server decisions (section 10). Screens built (section 11). Rules confirmed by Vikram unless marked OPEN.
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

## 6. Settlement (confirmed)
- Card values: A, K, Q, J = 10 each; 2–10 = face value.
- Jokers (all 7s, 6♥, 8♥ in the example) are removed before summing.
- Card points = sum ÷ 10, rounded half down (23 → 2, 25 → 2, 26 → 3), capped at 10.
- Each non-declarer pays the declarer: card points + declarer's value points − own value points.
  - Example: declarer 10 value pts. Mom: card pts 3, value 2 → pays 11.
- Only UNUSED cards are summed: cards not in a valid set, jokers excluded (confirmed).
- Every non-declarer's cards are ARRANGED AUTOMATICALLY into the valid sets that leave the fewest unused points, then counted (confirmed 2026-10-27). How they arranged them on screen doesn't matter. Validity follows the player: no wildcards if they haven't seen the joker. The result screen shows this arrangement. Code: `src/rules/arrange.ts` (exact search, checked against an exhaustive search in tests).
- If the result is negative, the declarer pays that player the difference (confirmed). Example: Dad card pts 2, declarer value 3, Dad value 15 → 2 + 3 − 15 = −10 → declarer pays Dad 10.
- All rules confirmed as of v0.5; no OPEN items.

## 6b. Edge cases found while coding the rules engine (all confirmed 2026-10-27)
- 7♥ 7♥ = 8.
- 6♥ 6♥ 7♥ 8♥ = 12 (marriage + single 6♥). General rule: score the grouping with the most points.
  - Derived, not yet confirmed: 6♥ 7♥ 7♥ 8♥ = 13 (marriage + single 7♥ beats 6♥ + 7♥7♥ + 8♥ = 12).
- Ace/King jokers wrap: joker A♥ → K♥ and 2♥ are value cards/jokers; joker K♥ → Q♥ and A♥.
- A set made only of jokers (e.g. 6♥ 7♠ 8♥) IS allowed after seeing the joker (corrected by Vikram).
  - It does NOT count toward the minimum 3 (confirmed). Base logic (Vikram): "to be able to see or use a joker you must have 3 sets."
- MINIMUM-3 RULE, FINAL (confirmed 2026-10-27, supersedes earlier answers):
  - The 3 sets may not use jokers. Only natural sets count: pure sequences and identical trails.
  - Natural sets made of joker cards still count: 6♥7♥8♥ (pure sequence), 6♥6♥6♥ (trail of surrounding cards), 7♠7♠7♠.
  - Do NOT count: sequences that need a joker (4♠ 5♠ + 7♣), mixed-suit trails (with or without joker), all-joker sets.
  - A player may break one of these sets only if they still have 3 in place (e.g. after making another pure set).
  - Same test as for showing: the 3 sets you show are the 3 sets you must keep (any 3 natural sets).

## 7. Technical decisions (confirmed 2026-10-27)
- Installable web app (PWA): home-screen icon, full screen, landscape. Works on Android Chrome and PC. No APK for v1.
  - APK later possible via Bubblewrap (TWA wrapper, @bubblewrap/cli 1.27.0, Oct 2026) without code changes.
  - Play Store not viable short-term: new personal developer accounts need a 12-tester, 14-day closed test.
- Server-authoritative: the server holds the deck and every hand; clients get their own hand + everyone's sets, never others' loose cards.
- Stack: TypeScript everywhere; shared rules module (src/rules) used by server and UI.
  - Server: Cloudflare Worker + one Durable Object per table, WebSocket hibernation API (plain DOs, not PartyServer, which its README calls work in progress).
  - Client: React + Vite, Cloudflare Vite plugin (page + server in one Worker); partysocket for auto-reconnect.
  - Touch drag: custom pointer-event code; tap-to-select is the primary method on phones. (@dnd-kit/core last release Dec 2024; @dnd-kit/react is pre-1.0.)
  - BUILT 2026-10-29 (Vikram chose option A): press and hold a card ~0.3 s, it lifts (short buzz on Android), drag it: onto a card (lands just before it; onto a set's card from outside that set it joins the set in order), onto a set, New set, the hand (goes to the end), or the pile (discards; only one card, only after drawing). A quick tap still selects; a quick swipe still scrolls. Dragging a selected card moves the whole selection. Code: src/client/touchDrag.ts + dropResult in hand.ts. Checked with real touch events in Chromium; hold time to be tuned on real phones.
  - Versions checked 2026-10-27: react 19.3.1, vite 8.3.5, @cloudflare/vite-plugin 1.65.0, wrangler 4.154.0, partysocket 1.3.0, typescript 7.0.2, vitest 5.0.5.
  - Server tests run in the Workers runtime with @cloudflare/vitest-plugin 1.4.9 (renamed from @cloudflare/vitest-pool-workers on 2026-08-19; the old package only supports Vitest 4). Worker types come from `wrangler types` (run automatically on npm install), not @cloudflare/workers-types.
  - compatibility_date 2026-10-23: since 2026-04-07 the runtime answers WebSocket close frames itself. Attachments per socket max 16 KiB (we store only the player id).
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
  - CHANGED 2026-10-29 (bug reported by Vikram): until YOU have seen the joker, you only see other players' pure sequences and trails. Their other sets (joker sets, mixed trails, unfinished groups) would give the joker away, so the server doesn't send them; you see "+ N more sets, hidden until you've seen the joker". After you've seen it, you see all their sets.
  - Server sends other players' sets to everyone, never their in-hand cards.
- Minimum-3 rule (confirmed): once a player has seen the joker, the game blocks any move that would leave them with fewer than 3 valid sets. Message shown; move undone.
  - SUPERSEDED: see "MINIMUM-3 RULE, FINAL" in section 6b. Only natural sets (no jokers) count.
- Jokers can NEVER complete a suited (identical) trail: K♣ K♣ + 7♠ is not a valid set (confirmed).
  - BUG FIXED 2026-10-27: ONE natural card + jokers (K♦ 7♣ 6♥) was wrongly rejected by this check. It is a joker sequence (J♦ Q♦ K♦ / Q♦ K♦ A♦) and is now valid, consistent with all-joker sets and K♣ K♦ + joker being valid. Doesn't count toward the minimum 3. Shown as "! No jokers in a suited trail".
  - A joker CAN complete a mixed-suit trail (K♣ K♦ + 7♠) (confirmed). Valid set, but doesn't count toward the minimum 3.

## 9. Hosting options (verified 2026-10-27)
- Render free web service: spins down after 15 min with no HTTP request or WebSocket message (changelog 2026-02-24). In-memory game lost on spin-down.
- Cloudflare Workers + Durable Objects, Free plan: SQLite backend; 100k requests/day; WebSocket hibernation avoids duration charges; incoming WS messages billed 20:1. One Durable Object per table, state persisted.

## 10. Table server (built 2026-10-27)
Code: `src/game/engine.ts` (all game logic, pure TS), `src/game/protocol.ts` (messages), `src/server/` (Worker + Durable Object).

### How it works
- `POST /api/tables` → new table, 4-character code (alphabet without 0/O/1/I/L, so it can be read out on a call). `GET /api/tables/CODE` → table info. `GET /api/tables/CODE/ws` → WebSocket.
- One Durable Object per table (SQLite-backed, Free plan). Whole game state saved after every accepted move; reloaded when the object wakes from hibernation.
- WebSocket hibernation API: idle tables use no compute. "ping" is answered with "pong" without waking the object.
- Identity: each device makes a secret token (kept in localStorage) and sends `hello {token, name}`. Same token = same seat and cards after a reconnect or a dead phone. Others only ever see a public player id; tokens are never sent out.
- Every change sends each player their own view: own cards; everyone's sets; card counts; discard top; stock count; the joker only if they've seen it. Never other players' loose cards, the stock order, or tokens (tested).
- A rejected move changes nothing (applied to a copy) and the error goes only to that player.
- Shuffling uses the platform's cryptographic random source.

### Server decisions (confirmed by Vikram 2026-10-27)
- Showing: only on your own turn, before or after drawing. After everyone acknowledges (and the first shower picks the joker), the same player's turn continues.
- Stock runs out: the discard pile minus its top card is shuffled into a new stock.
- Scoring: the other players' cards are arranged automatically before unused cards are counted (see section 6).
- Taking the discard: no restrictions.
- Dealer: the player who declared the last round deals the next one; the player after the dealer plays first. First round: the host (first player) deals. If the last declarer has left, the first player deals. An abandoned round (nobody declared) is dealt again by the same dealer.
- New players can join only in the lobby or between rounds; a returning player (same device) can rejoin any time.
- Host-only "abandon round" (back to the lobby, no scoring) as an escape if someone can't continue; otherwise the game waits (confirmed).
- Running totals per player = sum of settlements across rounds.
- Tables are never deleted (a few KB each). Anyone with the site can create a table; no login.

## 11. Screens (built 2026-10-27)
Code: `src/client/` (React). Pure logic in `hand.ts` / `cards.ts` (unit-tested in `test/hand.test.ts`).

### What's there
- Home: name, New table, Join with code, "Back to table XXXX". Links `/t/CODE` open a table directly (asks for a name the first time).
- Lobby (portrait OK): code, Share invite (Android share sheet, else WhatsApp link), Copy link, 5 seats, host starts with 2+ players.
- v2 table (confirmed 2026-10-27, canvas page "v2"): stock in its own spot (small stack of backs), joker in its own outlined box, the discard pile in the middle of the screen on a dark oval mat, thrown roughly: the top card plus 4 earlier throws, each with a fixed position and angle (from the card id, so nothing jumps); only the top card can be taken. Sort is an outlined pill button. "To hand" is now "Break set" and only appears when a selected card is in a set.
- "« Jokers" button (requested 2026-10-29), above Sort, only once you've seen the joker: moves the jokers in your hand to the left (grouped by rank, then suit); the other cards keep their order. Sets aren't touched.
- Leaving between rounds: "Leave table" on the result screen (second tap confirms). Coming back on the same device restores the same player id, so the running total is kept (confirmed).
- Table (landscape): turn banner; player chips (gold ring = whose turn, eye = has seen the joker, "offline"); tap a name to see their sets. Stock and discard glow when you can draw. Joker panel (hidden / picked by X / the joker with jokers and value cards and your value points).
- Arranging: tap cards (numbered in tap order) → New set / + Add on a set / To hand / Clear; Sort; each set shows a live label (short form on the table, full form in dialogs). On PC, cards can also be dragged onto a set, New set, the hand, another card, or the discard pile.
- Counter: "Pure sets n/3" before seeing the joker; afterwards "Unused N" = card points you'd pay now (same automatic arrangement as the real scoring).
- Show → everyone gets the check dialog ("OK, I've seen them", who has checked) → first shower picks from 16 face-down cards → "You can see the joker now".
- Declare: needs a second tap ("Tap again to declare"); enabled only when the server would accept it, otherwise the reason is shown.
- Result: per player saw joker / value points / unused points with the sum / the payment as a sum ("3 + 10 − 2 = 11"); tap a name for their hand as scored (losers: automatic arrangement); Scoreboard; host starts the next round.
- PC (wide screen): side panel "This round" (last 12 actions) and "Total so far".
- Menu: Play full screen (also locks landscape on Android), four-colour deck on/off (remembered per device), Install on this phone (when Chrome offers it), Leave table (lobby/between rounds), host: Stop this round.
- Portrait phone during a game: "Turn your phone sideways" screen with a full-screen button.
- Your-turn alerts (2026-10-27): when the turn passes to you, when someone shows (you need to check), and when you must pick the joker. Android: vibration + a short chime. iPhone: chime only (websites can't vibrate on iPhone: Safari has no vibration API, and the switch-control haptic workaround needs a real tap and was shut off in iOS 26.5). Plus a pulsing turn banner and "● Your turn" in the browser tab title. Sound and vibration are switches in the menu (remembered per device). Browsers allow sound/vibration only after the person has tapped the page once since opening it; the chime respects the iPhone silent switch.
- iPhone home screen: Safari → Share → Add to Home Screen (iOS 26+ opens it as a web app). iPhone has no full screen or landscape lock for websites: turn off Portrait Orientation Lock and turn the phone. Name under the icon "Marriage"; status bar blends into the green.
- Connection: reconnects automatically (also straight away when the phone wakes up); moves are never queued while offline (a stale move could land later), the screen says "Reconnecting…" instead. Keep-alive ping every 25 s, answered without waking the server.
- Installable (PWA): manifest (full screen, landscape, icons incl. maskable), service worker only for the install prompt and an offline start page; game traffic is never cached.

### Checked (2026-10-27, headless Chromium 153)
- Real game with 3 players (2 touch phones 844×390, 1 PC 1280×720) against the built app in the local Workers runtime: create, join by link, start, draw, discard, take the discard, make a set by tapping, see another player's sets, sort, reload mid-game (same seat and cards), portrait hint, menu. No console errors. Same run passes with `npm run dev`.
- Show / acknowledge / pick / seen joker / declare / result screens: real engine views fed to the real app; buttons send the right messages.
- 7 sets of 3 fit on an 844-px-wide phone; on 740 px the "New set" button scrolls into view.

### Not done / known limits
- Not yet tried on a real Android phone, nor the install prompt (needs the deployed https site).
- "Show" shows your first 3 pure sets; there's no picker (any 3 count, SPEC 6b).
- Alerts and the iPhone home-screen setup not yet tried on real phones (checked in headless Chromium only; no Safari engine available here).
