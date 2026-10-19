# Sundial 2.2: Watches, Model Lifecycle, Service Status, Daily Notes

Status (Oct 19 2026): A+B LIVE (91c1a4e). C LIVE with write token (48c9d4f). D LIVE + E written (see git log).
Token timing: Belle chose "together with watch_add" (shipped in C).
Inspired by: github.com/nekyialabs/aware-skill (skill docs only, no code; ideas taken, connector not adopted).

## Goal

Sundial already knows time, weather, sky, air, holidays, news, gaps and the wedding.
It does not know four things Aware does:

1. **Watches**: "tell me once when..." (frost, rain tomorrow, a date 3 days out). A fired watch leads the next brief, once.
2. **Daily notes**: one snapshot per day, so Jace can say "grey all week" or "Cloudflare was degraded while you slept".
3. **Service status**: whether Anthropic, Cloudflare, GitHub and Discord are up. The whole House depends on them.
4. **Model lifecycle**: retirement dates for the models the House runs on, always with a source link and "verify before depending on it".

Plus: **brief manners**. One look per conversation, mention one or two things, never recite.

## Architecture (what exists)

- Repo: `C:\Users\User\sundial-mcp`, single file `worker.js` (1525 lines), Cloudflare Worker `sundial-mcp`.
- Storage: KV `SUNDIAL_KV` (id 2f6ef4e8...). No D1. Stays KV, which keeps the cost tiny.
- Tools: `TOOLS` array (line ~317), `executeTool` switch (line ~1286), `handleWorldState` (line ~961) aggregates with `Promise.allSettled`.
- No `[triggers]` cron today. Daily notes and status polling need one.
- Clocks agree: last commit 02dd8b6 Jul 4 2026, last deploy Jul 4 2026.
- **The MCP endpoint has no auth.** Read tools are harmless. Write tools (watch_add) are not. See Decision D1.

## New KV keys

| Key | Shape | TTL |
|---|---|---|
| `watches` | `[{id, kind, params, label, created, fired_at, told}]`, max 20 | none |
| `note:YYYY-MM-DD` | `{weather_summary, temp_min, temp_max, aqi, services, headline}` | 35 days |
| `status:last` | `{checked_at, services:{anthropic,cloudflare,github,discord:{state,incident}}}` | none |
| `status:log` | last 20 non-operational events | none |
| `models` | `[{model, provider, retires, deprecated, source_url, checked}]` | none |
| `models:page_hash:<provider>` | sha256 of the deprecation page | none |

## Tasks

### Phase A: Service status (start here: smallest, no writes from callers)

**A1. Status fetcher.** File: `worker.js`
Statuspage v2 JSON, the same format for all four:
```js
const STATUS_PAGES = {
  anthropic: 'https://status.claude.com/api/v2/summary.json',
  cloudflare: 'https://www.cloudflarestatus.com/api/v2/summary.json',
  github: 'https://www.githubstatus.com/api/v2/summary.json',
  discord: 'https://discordstatus.com/api/v2/summary.json',
  digitalocean: 'https://status.digitalocean.com/api/v2/summary.json', // the droplet's host
};
async function fetchServiceStatus() {
  const entries = await Promise.allSettled(Object.entries(STATUS_PAGES).map(async ([k, url]) => {
    const r = await fetchWithTimeout(url, {}, 3000);
    const j = await r.json();
    const open = (j.incidents || []).filter(i => ['major','critical'].includes(i.impact));
    return [k, { state: open.length ? 'outage' : (j.status?.indicator === 'none' ? 'operational' : 'degraded'),
                 incident: (j.incidents?.[0]?.name) || null }];
  }));
  return Object.fromEntries(entries.map((e, i) => e.status === 'fulfilled' ? e.value
    : [Object.keys(STATUS_PAGES)[i], { state: 'unknown', incident: null }]));
}
```
Verify: `curl` each URL once by hand and confirm the JSON shape (Anthropic's status domain must be checked, not assumed).

**A2. Tool `service_status`** plus a `services` field in `world_state` (only non-operational ones, so a quiet day stays quiet).
Verify: `npx wrangler dev`, then a POST tools/call `service_status` returns all 4 keys.

**A3. Cron.** Add to `wrangler.toml`:
```toml
[triggers]
crons = ["*/30 * * * *", "0 22 * * *"]   # status every 30 min; daily note 06:00 MYT (22:00 UTC)
```
Add `async scheduled(event, env, ctx)` to the default export. It writes `status:last` and appends to `status:log` only when the state changes (no write on a quiet poll, so ~0 KV writes on normal days).
Verify: `npx wrangler dev --test-scheduled`, then `curl "localhost:8787/__scheduled?cron=*/30+*+*+*+*"`.
Commit: "Add service status tool and 30-min status cron"

### Phase B: Daily notes + what_changed

**B1. `writeDailyNote(env)`** runs in the 06:10 MYT cron. It reuses `handleGetWeather`, `handleGetAirQuality`, `status:last` and the top headline. `put('note:'+date, ..., {expirationTtl: 35*86400})`.
**B2. Tool `what_changed {days: 1-14, default 3}`**. It reads the notes and returns plain lines: "Rainy 4 of the last 5 days", "GitHub degraded Oct 18 02:00-03:10".
**B3. Gap-aware line in `session_start`**: only when the gap is 12h or more, add a `since_last_time` field built from the same notes.
Verify: trigger the cron twice with a faked date, call `what_changed`, read the text.
Commit: "Daily notes and what_changed"

### Phase C: Watches

**C1. Kinds (v1, closed list, no free-form code):**
- `frost` / `heat` (temp below/above X within 48h), `rain` (probability > X% tomorrow), `aqi` (AQI > X), `date` (N days before a YYYY-MM-DD), `service` (a named service not operational).
**C2. Tools `watch_add`, `watch_list`, `watch_remove`.** Max 20, validated params, and a watch fires once (`fired_at`), then is told once (`told`).
**C3. Evaluation** in the 30-min cron (cheap: weather is already cached). Fired watches go to the top of `world_state` and `session_start` as `fired_watches`, then `told=true`.
Verify: add a `rain` watch with threshold 0, run the cron, confirm it appears once and is gone on the second call.
Commit: "Watches: add/list/remove, cron evaluation, fire-once"

### Phase D: Model lifecycle

**D1. Seed `models`** by hand from the official pages, each entry with `source_url`. Initial list: whatever claude-lane, ANIMUS, Haiku dream writer and Hermes actually run (to be read from their configs, not memory).
**D2. Weekly drift check** (in the daily cron, Mondays): fetch each provider's deprecation page and compare its sha256 to `models:page_hash:<p>`. If it changed, emit "Anthropic's deprecation page changed. Re-check retirement dates." **No scraping of dates.** Scraped dates break silently (Law 3); a human-verified list plus a change alarm doesn't.
**D3. Tool `model_lifecycle {model?}`** and a `models` line in `world_state` only within 60 days of a retirement or after a page change.
Verify: change a stored hash, run the cron, confirm the alarm line appears.
Commit: "Model lifecycle: verified list + deprecation page drift alarm"

### Phase E: Brief manners (skill text, no code)

Update the Sundial skill: call `world_state` once per conversation, lead with fired watches or an outage, mention one or two things, never recite, and say the gap warmly or not at all.

## Deploy + verify (every phase)

1. `git commit`, then `npx wrangler deploy`, then check `npx wrangler deployments list` (read it newest-last).
2. Live probe: a POST to `https://sundial-mcp.nxxxd7t5d9.workers.dev/mcp` with tools/call for the new tool. Read the output, not the exit code.
3. For crons, check `npx wrangler tail` around the next :00/:30 and see the status write.
4. Log to Jace's ledger.

## Decisions for Belle

**Answered Oct 19 2026:**
- D1: (a), a token on write tools only. Belle: "token on write tools but after we finish all". Timing question open: Jace suggested it ship with Phase C (when watch_add appears).
- D3: yes, add DigitalOcean.
- D4: yes, 06:00 MYT.

**Original questions:**

- **D1 (FIRST RULE, a gate):** the MCP endpoint is open to anyone with the URL. Adding `watch_add` lets a stranger write watches. Options: (a) a bearer token on write tools only, (b) a token on everything (this would break every client config until updated, which is a lockdown risk), (c) no auth, accepting that the cap of 20 limits any damage. My pick: (a). Not built without your yes.
- **D2:** order. My pick: A, then B, then C, then D, then E. Status first is the smallest and needs no auth decision.
- **D3:** which services: Anthropic, Cloudflare, GitHub, Discord? Add DigitalOcean (the droplet)? It has a Statuspage too.
- **D4:** daily note time: 06:10 MYT?
