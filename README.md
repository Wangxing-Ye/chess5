# [chess5.ai](http://chess5.ai)

**Human vs LLM · Five Games**

A fun open-source experiment for testing how strong LLMs really are at classic board games — Chess, Go, Xiangqi, Gomoku, and Othello — with adjustable difficulty for beginners and kids, plus human-vs-model and model-vs-model play, spectating, and stats.

> **Please note:** the hosted site [chess5.ai](https://chess5.ai) may be shut down at any time. Self-host from this repository if you need a lasting copy.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS 4
- next-intl — English, 简体中文, 繁體中文, 한국어, 日本語, Français, Español (`/en`, `/zh`, `/zh-TW`, `/ko`, `/ja`, `/fr`, `/es`)
- BYOK: API keys AES-GCM encrypted in browser `localStorage`, proxied via `/api/llm/complete` (not persisted to the server database or disk)
- In-memory live match state + SQLite (`data/chess5.db`) for match records and stats

## Games


| Game    | Notes                                                                   |
| ------- | ----------------------------------------------------------------------- |
| Chess   | Standard international chess (castling, en passant, promotion)          |
| Go      | Captures + simple ko; ends after two passes (capture count, simplified) |
| Xiangqi | Custom 9×10 engine                                                      |
| Gomoku  | 15×15 free-style                                                        |
| Othello | 8×8 Reversi; flip discs; majority wins                                  |


### Chess notation (SAN)

Move history and model replies use **Standard Algebraic Notation (SAN)** from `chess.js`. Piece letters are uppercase; pawns have **no** letter prefix.


| Piece  | SAN prefix | Examples                   |
| ------ | ---------- | -------------------------- |
| Pawn   | *(none)*   | `e4`, `d5`, `exd5`, `e8=Q` |
| Knight | `N`        | `Nf3`, `Nxe5`, `Nd2+`      |
| Bishop | `B`        | `Bc4`, `Bxf7+`             |
| Rook   | `R`        | `Re1`, `Raxd1`             |
| Queen  | `Q`        | `Qh5`, `Qxf7#`             |
| King   | `K`        | `Ke2`, `O-O`, `O-O-O`      |


Notes:

- **`N` for Knight** — `K` is reserved for the King.
- **Pawns** — destination square only (`e4`); captures use file + `x` + square (`exd5`).
- **`+` / `#`** — appended only when the move gives check or checkmate (e.g. `Nd2+`, `Qxf7#`).
- **Castling** — `O-O` (kingside), `O-O-O` (queenside).

Xiangqi and other games use different formats (e.g. Xiangqi: `from` + `to` coordinates like `h3e3`).

## Arena settings

Three optional toggles when creating a match (Play page also shows which are on). They mainly change **what the model is told in the prompt** and how **model output errors** are penalized. Human moves are validated by the board UI and are **not** counted toward illegal strikes.

### Model illegal strikes

When a **model** returns a move that cannot be parsed or is not legal in the current position, that side gets **+1 illegal strike**.

- **3 strikes** on the same side → that side **loses**; reason `illegal-moves`; opponent wins.
- Shown on the play page as **Model illegal strikes** (human vs model: model side only).
- **Does not count:** API/network failures (the model never produced a move); provider refusals / safety blocks (logged, no strike).
- Implementation: `registerIllegal` in `src/lib/match/engine.ts` (`MAX_ILLEGAL = 3`).

### Tactical Guidance

When **on**, the move prompt includes a short **tactical hint** per game (e.g. Chess: play actively when safe, avoid hanging pieces). When **off**, that hint is omitted — closer to testing the model’s **raw** playing ability without coaching.

- Default: **on** (Arena).
- Affects prompt only; does not change engine rules or move validation.
- Hints: `TACTICAL_TIPS` in `src/lib/llm/prompt.ts`.

### Legal Moves Protection

When **on** (Chess, Xiangqi, Othello only), the prompt includes a **list of legal moves** for the current position (e.g. Chess: `Legal moves: e4, Nf3, …`). When **off**, the board/FEN and move format are still sent, but no legal-move list — models must infer legality themselves; illegal outputs may rise and trigger strikes faster.

- **Not available** for Go and Gomoku (no legal-move list is sent).
- Default: **on** for supported games.
- Implementation: `legalMovesProtection` in each engine’s `toPromptView` (e.g. `src/lib/games/chess.ts`).


| Setting                | Affects      | Main effect                                          |
| ---------------------- | ------------ | ---------------------------------------------------- |
| Illegal strikes        | Model output | Unparseable/illegal model moves accumulate; 3 → loss |
| Tactical Guidance      | Prompt       | “Play actively but don’t blunder” style hints        |
| Legal Moves Protection | Prompt       | Full legal-move list (Chess / Xiangqi / Othello)     |


**Stricter benchmark:** turn both prompt options **off**; illegal-strike rules still apply. **Easier, smoother games:** leave both **on**.

## Models (BYOK)

OpenAI · Anthropic · Google · xAI · Meta · Mistral · DeepSeek · Alibaba · Zhipu · MiniMax · Moonshot

## Reasoning

Arena **Reasoning** is four levels: **Off / Low / Medium / High**. Each maps to the closest provider knobs (not vendor defaults left unset).


| Arena  | OpenAI   | Meta      | xAI      | Moonshot | DeepSeek          | Alibaba                                  | Gemini    |
| ------ | -------- | --------- | -------- | -------- | ----------------- | ---------------------------------------- | --------- |
| Off    | `none`   | `minimal` | `low`    | `low`    | thinking disabled | `enable_thinking: false`                 | `MINIMAL` |
| Low    | `low`    | `low`     | `low`    | `low`    | enabled + `low`   | thinking on · budget 8 192 · max 16 384  | `LOW`     |
| Medium | `medium` | `medium`  | `medium` | `high`   | enabled + `high`  | thinking on · budget 16 384 · max 49 152 | `MEDIUM`  |
| High   | `high`   | `high`    | `high`   | `max`    | enabled + `max`   | thinking on · budget 32 768 · max 65 536 | `HIGH`    |



| Arena  | Anthropic Fable | Anthropic Opus/Sonnet      | Zhipu                                     | MiniMax M3        | MiniMax M2.x   | Mistral     |
| ------ | --------------- | -------------------------- | ----------------------------------------- | ----------------- | -------------- | ----------- |
| Off    | effort `low`    | thinking disabled          | disabled (5.1/5.2); 5.3 always on → `low` | thinking disabled | always enabled | prompt only |
| Low    | effort `low`    | adaptive + effort `low`    | enabled (+ `low` on GLM-5.2/5.3)          | adaptive          | always enabled | prompt hint |
| Medium | effort `medium` | adaptive + effort `medium` | enabled (+ `high` on GLM-5.2/5.3)         | adaptive          | always enabled | prompt hint |
| High   | effort `high`   | adaptive + effort `high`   | enabled (+ `max` on GLM-5.2/5.3)          | enabled           | always enabled | prompt hint |


When reasoning is on, OpenAI-compatible and Anthropic paths set `max_*_tokens` by Arena level: **Low 8 192 · Medium 16 384 · High 32 768**. Anthropic **Off** stays at **1024**. Providers that cannot disable thinking (Meta / xAI / Moonshot) use the Low budget at Arena Off. **Alibaba** uses explicit `thinking_budget` plus a strictly larger `max_completion_tokens` (Low 16 384 · Medium 49 152 · High 65 536) so DashScope accepts the request. Implementation: `src/lib/llm/reasoning.ts` (used from `complete.ts`). Mistral has no API knobs — only a short prompt hint via `reasoningPromptHint`. Gemini only sets `thinkingLevel` (no max-token override).

## Temperature

`temperature` controls how randomly the model samples the next token: lower values favor safer, more repeatable moves; higher values favor more varied (and sometimes weaker or illegal) play.

chess5 **intentionally omits** `temperature` on every provider request and uses each vendor’s default. Many of the Arena models are reasoning / thinking models that either **reject** non-default temperature with HTTP 400 (e.g. OpenAI GPT-5.x, Anthropic Claude 5 / recent Opus, Moonshot Kimi K3) or **ignore** sampling knobs while thinking is on (e.g. DeepSeek). Forcing a shared low temperature would break those APIs and would not be a fair cross-model comparison.

## Site-wide gates

Site-wide gates (create match / LLM RPM) use a separate code (`rate_limited`) and a real **HTTP 429**.

Current limits (per minute, per client / site-wide): `/api/llm/complete` 600 /
6000 (plus 60 per match), `/api/llm/test` 10 / 60, `POST /api/matches` 60 / 600.

Per-client buckets require a trusted client IP — see [Deployment](#deployment).

## Error codes

LLM proxy failures return **HTTP 502** with a JSON `code` so the Play UI can choose copy and retry policy.

### Shared codes (`src/lib/api/errors.ts`)


| `code`                 | Meaning                                             | Auto-retry (Play) |
| ---------------------- | --------------------------------------------------- | ----------------- |
| `rate_limited`         | **This site’s** rate / concurrency limit (HTTP 429) | 30s × 2           |
| `rate_limit`           | **Provider** RPM / burst / similar                  | 30s × 2           |
| `billing_error`        | Payment / spend / arrearage                         | no                |
| `quota_exceeded`       | Usage / free-tier quota exhausted                   | no                |
| `authentication_error` | Bad or rejected API key                             | no                |
| `permission_error`     | Key lacks access                                    | no                |
| `model_unavailable`    | Bad request / unknown model / other 4xx             | no                |
| `server_error`         | Provider 5xx, overload, or network failure          | 1s → 2s → 4s × 3  |


## Aborted

**Aborted** means matches that ended with **no winner**:

- Player left the play page (presence timeout: leave/close the play page, or keep it in the background long enough that heartbeats stop — ~60s)
- Match ended manually from the Play UI
- **Model vs model** only: still rate-limited (`rate_limit` / `rate_limited`) after two automatic retries (30s each)

**Human vs model** does not abort on rate-limit exhaustion — the Play page stays open with a warning so the human can wait and refresh.

## Develop

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm run smoke   # engine + match + DB smoke tests
npm run build
npm run lint
```

## Deployment

Rate limits are keyed on the client IP, which can only be trusted when a reverse
proxy you control rewrites the forwarding headers. Set these when deploying
behind nginx, Cloudflare, Vercel, or similar:


| Variable              | Default | Meaning                                |
| --------------------- | ------- | -------------------------------------- |
| `TRUST_PROXY_HEADERS` | off     | Honour `x-forwarded-for` / `x-real-ip` |
| `TRUSTED_PROXY_HOPS`  | `1`     | Proxies between the client and the app |


Without `TRUST_PROXY_HEADERS` every caller shares one bucket, so per-client
limits become site-wide limits. Leaving it on while *not* behind a proxy is
worse: clients can forge the header and bypass per-client limits entirely. Each
endpoint also has a global cap that applies regardless. Numeric limits are listed
under [Site-wide gates](#site-wide-gates).

## Routes

- `/[locale]` — landing
- `/[locale]/arena` — create match
- `/[locale]/play/[matchId]` — play
- `/[locale]/spectate/[matchId]` — watch (read-only, SSE)
- `/[locale]/replay/[matchId]` — replay a finished match
- `/[locale]/settings/keys` — BYOK keys
- `/[locale]/stats` — match aggregates: HvM/MvM results, think-time averages, and output failures
- `/[locale]/history` — recent matches (Watch / Replay)
- `/[locale]/terms` — terms of service

## License

MIT — see [LICENSE](./LICENSE).