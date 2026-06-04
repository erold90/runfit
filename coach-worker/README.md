# RunFit Coach — Worker proxy

Proxy Cloudflare Worker che fa da intermediario tra la PWA RunFit e l'Anthropic Messages API.
La chiave API vive **solo** qui come secret, mai nel codice client (pubblico su GitHub Pages).

## Cosa fa
- Riceve `POST /coach` con `{ "context": {...} }` (profilo + storico + sessione dal localStorage).
- Aggiunge il system prompt fisso (coach evidence-based) e forza un JSON strutturato via **tool use**.
- Chiama **claude-haiku-4-5** e restituisce `{ coach: {...}, usage: {...} }`.

## Risposta (`coach`)
```json
{
  "debrief": "testo 4-6 frasi",
  "highlights": ["...", "..."],
  "adjustment": {
    "domain": "run|strength|none",
    "action": "keep|easier|harder|deload|rest",
    "repScaleDelta": 0.0,
    "weekDelta": 0,
    "reason": "..."
  },
  "flag": "none|caution|medical"
}
```
L'app applica l'`adjustment` **solo entro i limiti** (repScaleDelta ±0.15, weekDelta ±1) usando l'algoritmo deterministico come guardrail.

## Sviluppo locale
1. La chiave è in `.dev.vars` (gitignored).
2. `npm run dev` (o `wrangler dev`) → endpoint su `http://localhost:8787`.
3. Test:
```bash
curl -s http://localhost:8787/coach \
  -H "Content-Type: application/json" \
  -H "X-RunFit-Token: dev-local-token-cambiami-in-produzione" \
  -H "Origin: http://localhost:8000" \
  -d '{"context":{"profile":{"age":36,"sex":"M"},"lastSession":{"type":"strength"}}}' | jq
```

## Deploy in produzione
```bash
# 1. Imposta i secret (NON in chiaro nel repo)
wrangler secret put ANTHROPIC_API_KEY     # incolla la chiave NUOVA (ruotata)
wrangler secret put RUNFIT_TOKEN          # openssl rand -hex 32

# 2. Deploy
wrangler deploy
# → https://runfit-coach.<account>.workers.dev
```

⚠️ **Prima del go-live pubblico ruota la chiave API** (quella usata in sviluppo è transitata in chat).
Aggiorna gli `ALLOWED_ORIGINS` in `wrangler.toml` se l'URL della PWA cambia.

## Costi
Haiku 4.5, ~3k token input / ~600 output per debrief ≈ **$0,003** a chiamata. Trascurabile per uso personale.
Il `cache_control` sul system prompt si attiva solo per prefissi ≥ 4096 token (soglia Haiku): a questo volume probabilmente non scatta, ma è innocuo e pronto se il prompt cresce.

## Sicurezza
- Chiave API: secret del Worker, mai nel client.
- `RUNFIT_TOKEN`: header condiviso per evitare che terzi usino il proxy a tue spese.
- CORS limitato agli `ALLOWED_ORIGINS`.
- Per un rate-limit per-utente persistente serve un KV namespace (TODO se necessario).
