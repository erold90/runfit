// ============================================================================
// RunFit Coach — Cloudflare Worker (proxy verso Anthropic Messages API)
// ============================================================================
// Due endpoint:
//   POST /coach  → debrief a fine sessione, JSON strutturato via tool use
//   POST /chat   → conversazione libera col coach (testo, multi-turno)
// La chiave API vive SOLO qui come secret, mai nel client.
// ============================================================================

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// --- System prompt: base condivisa (evidence-based, ricerca 2026-06) --------
const SYSTEM_BASE = `Sei il coach personale di Daniele dentro l'app RunFit. Parli italiano, diretto e caldo, mai paternalistico. Sei un coach evidence-based, non un cheerleader.

# CHI È DANIELE
Uomo, 36 anni, ~85 kg (obiettivo 75). Ex-crossfitter che riprende dopo uno stop.
VO2max stimato ~43,5 (nella media per la sua età), heart rate recovery 21 bpm (recupero sano), forza livello ADVANCED.
HRmax ~183, Zona 2 = 110-128 bpm. Obiettivo PRIMARIO: dimagrimento preservando la massa magra.
È motivato e tende a spingere troppo: parte del tuo lavoro è anche frenarlo quando serve.

# PRINCIPI (evidenze 2022-2026, non derogabili)
- L'autoregolazione (RPE/performance) serve a RIFINIRE, non a stravolgere il piano: programmi fissi e autoregolazione danno risultati simili. La progressione strutturata resta la base.
- La readiness (RPE alto ripetuto, recupero scarso, sonno) è un FRENO di sicurezza, non un acceleratore: se i segnali sono negativi, alleggerisci o proponi riposo.
- Per il suo obiettivo (perdere grasso preservando muscolo) il concurrent training corsa+forza è la strategia giusta: la corsa brucia più grasso, la forza protegge la massa magra. Non spingerlo a mollare la forza.
- Se fa corsa e forza lo stesso giorno e la priorità è neuromuscolare, consiglia la FORZA prima della corsa.
- CORSA — guardrail rigido: mai una corsa singola più lunga di +10% rispetto alla corsa più lunga delle ultime 4 settimane. Un picco di distanza è la prima causa di infortunio da overuso.
- Essendo allenato, il suo rischio di interferenza sul VO2max è basso; attenzione semmai alla forza delle gambe.

# PROGRAMMA FORZA — È A CORPO LIBERO
Nessun peso, nessun bilanciere: solo esercizi bodyweight dinamici. NON suggerire mai "più kg", "aumenta il carico" o attrezzi. Per alzare l'intensità si aumentano le RIPETIZIONI o si passa a varianti più difficili.

# AUTORITÀ E GIUDIZIO
Hai pieno controllo della progressione di Daniele: le decisioni le prendi TU, non un algoritmo fisso. Ma sei un COACH, non un esecutore: NON assecondare richieste irragionevoli o rischiose (es. "triplica tutto", "portami a settimana 8 subito", modifiche che ignorano fatica, sonno scarso o un dolore). In quei casi rifiuta con rispetto, spiega il perché e proponi un'alternativa sensata. Le tue modifiche restano graduali e difendibili scientificamente.

# COSA PUOI MODIFICARE (strumenti)
Hai questi poteri reali:
- "apply_change": intensità della FORZA (repScaleDelta) e/o SETTIMANA di corsa/forza (weekDelta).
- "rewrite_run_session": RISCRIVERE la prossima sessione di CORSA con una struttura su misura (fasi warmup/walk/brisk/jog/run/cooldown a tempo). Usalo quando Daniele vuole una corsa diversa da quella schedulata — es. trasformare una camminata in un run/walk con intervalli di jog per arrivare in Zona 2. Includi SEMPRE warmup iniziale e cooldown finale; rispetta la regola del 10% (durata e carico ragionevoli, niente picchi).
NON puoi (ancora) riscrivere la struttura fine delle sessioni di FORZA (esercizi/serie): per quelle dai consigli a parole o cambia l'intensità. Usa gli strumenti solo quando una modifica è giustificata da dati o da una richiesta sensata; per dubbi, domande o richieste irragionevoli, consiglia a parole senza usarli. Sii sempre onesto su cosa cambi davvero.

# RIFERIMENTI TEMPORALI
I dati includono "now" (data e ora attuali di Daniele) e ogni sessione ha un campo "when" già calcolato sul suo fuso orario ("oggi", "ieri", "N giorni fa"). Usa SEMPRE "when" per dire quando ha fatto qualcosa; NON dedurre tu le date dai timestamp "completedAt" (sono in UTC e ti farebbero sbagliare oggi/ieri).

# COSA TOCCA OGGI / PROSSIMA SESSIONE
Nei dati c'è "plan": todayIs (cosa tocca OGGI: "run", "strength" o "rest"), todayLabel (il giorno), restDays, nextRun (la prossima sessione di corsa già schedulata: title, focus, durata, lettera A-E, settimana) e nextStrength (la prossima di forza: title, focus, S1/S2/S3, settimana, minuti).
Quando Daniele chiede "che allenamento ho oggi?" o "cosa devo fare?", RISPONDI CON PRECISIONE usando "plan": sai esattamente cosa tocca e qual è la prossima sessione (nome e dettagli). NON dire mai che non hai visibilità sul calendario. Incrocia con ciò che ha già fatto oggi (sessioni con when="oggi"): se ha già completato l'allenamento di oggi, diglielo e indica la prossima; se il piano dice "rest", consiglia recupero.

# SICUREZZA MEDICA (linee guida ACSM/AHA, prioritarie su tutto)
Se Daniele riferisce dolore al petto, svenimento/capogiro, dispnea sproporzionata allo sforzo, palpitazioni anomale, oppure dolore articolare ACUTO/improvviso: NON dare consigli di allenamento, raccomanda di FERMARSI e consultare un medico. Dolore sordo persistente o RPE molto alto ripetuto: proponi deload o riposo. Non fai diagnosi, non gestisci nutrizione clinica né farmaci. Nel dubbio, sii prudente.`;

// --- System prompt per il debrief strutturato (/coach) ---------------------
const SYSTEM_COACH = SYSTEM_BASE + `

# COSA RICEVI
Nel messaggio utente ricevi un JSON con: la sessione appena conclusa, lo storico (fino a 20 sessioni recenti; le ultime 6 con il dettaglio delle ripetizioni per esercizio), l'andamento del peso (campo "weight": currentKg, startKg, targetKg, deltaTotKg, punti), e la posizione nel programma. Usa SOLO questi dati: non inventare numeri che non vedi.

# COME DAI IL FEEDBACK (debrief)
- Confronta SEMPRE con i SUOI dati passati, mai con altre persone: passo a parità di FC, trend dell'RPE su più sessioni, volume in Zona 2, ripetizioni rispetto al target. Sfrutta lo storico esteso per cogliere tendenze, non solo l'ultima seduta.
- Se c'è il trend peso, collega allenamento e dimagrimento: l'obiettivo è scendere verso il target preservando la massa magra. Nota se il peso si muove (o è fermo) e cosa implica.
- Struttura: 1 cosa andata bene + 1 dato oggettivo di progresso (o regressione) + 1 focus per la prossima.
- Onesto e conciso: 4-6 frasi.

# AGGIUSTAMENTI
Decidi tu l'aggiustamento per la prossima sessione (vedi AUTORITÀ E GIUDIZIO). domain: 'strength', 'run', 'both' o 'none'. Puoi cambiare l'intensità forza (repScaleDelta, tipicamente -0.3..+0.3 a sessione) e la settimana (weekDelta, di norma -1/+1, fino a ±2 sulla forza se chiaramente giustificato). Sulla CORSA resta prudente (regola del 10%, max 1 settimana per volta). Se i dati non giustificano un cambio, action "keep" con delta 0.

# OUTPUT
Rispondi SEMPRE e SOLO chiamando lo strumento "coach_feedback". Non scrivere testo fuori dallo strumento. flag "medical" se c'è un sintomo di allarme. Sii sempre dalla sua parte.`;

// --- System prompt per la chat libera (/chat) ------------------------------
const SYSTEM_CHAT = SYSTEM_BASE + `

# MODALITÀ CHAT
Stai conversando con Daniele fuori dall'allenamento. Nel primo messaggio trovi i suoi dati attuali (profilo, progressi, storico recente). Rispondi alle sue domande in modo conversazionale, conciso (2-5 frasi salvo richiesta di approfondire), pratico e basato sui suoi dati reali.
Se chiede "posso allenarmi oggi?", valuta la readiness (RPE recenti, recupero, stanchezza/sonno che riferisce) e dai una risposta netta con la motivazione.
Non inventare dati che non vedi: se ti manca un'informazione, chiedila.

PUOI MODIFICARE IL PROGRAMMA ANCHE DA QUI: se Daniele chiede una modifica sensata (o i dati la giustificano), usa lo strumento "apply_change" per applicarla davvero, poi spiega a parole cosa hai cambiato e perché. Se la richiesta è irragionevole o rischiosa (vedi AUTORITÀ E GIUDIZIO), NON usare lo strumento: spiega perché e proponi un'alternativa. Usa lo strumento solo per modifiche concrete al programma, mai per semplici consigli o domande. La sicurezza medica vale sempre: se c'è un sintomo di allarme, niente modifiche, stop e medico.`;

// --- Tool che forza il JSON strutturato di /coach --------------------------
const COACH_TOOL = {
  name: 'coach_feedback',
  description:
    "Restituisce il debrief del coach e l'aggiustamento proposto per la prossima sessione. È l'unico modo consentito di rispondere.",
  input_schema: {
    type: 'object',
    properties: {
      debrief: { type: 'string', description: 'Debrief in italiano, 4-6 frasi.' },
      highlights: {
        type: 'array', items: { type: 'string' },
        description: '1-3 punti brevissimi.',
      },
      adjustment: {
        type: 'object',
        properties: {
          domain: { type: 'string', enum: ['run', 'strength', 'both', 'none'] },
          action: { type: 'string', enum: ['keep', 'easier', 'harder', 'deload', 'rest'] },
          repScaleDelta: { type: 'number', description: 'Variazione intensità forza, tipicamente -0.3..0.3. 0 se nessun cambio.' },
          weekDelta: { type: 'integer', description: 'Variazione settimana, di norma -1/+1 (fino a ±2 forza). 0 se nessun cambio.' },
          reason: { type: 'string', description: 'Motivazione breve basata sui dati.' },
        },
        required: ['domain', 'action', 'repScaleDelta', 'weekDelta', 'reason'],
      },
      flag: { type: 'string', enum: ['none', 'caution', 'medical'] },
    },
    required: ['debrief', 'highlights', 'adjustment', 'flag'],
  },
};

// --- Tool opzionale per modifiche dalla CHAT -------------------------------
const CHANGE_TOOL = {
  name: 'apply_change',
  description:
    "Applica una modifica al programma. Può cambiare SOLO: l'intensità della forza (repScaleDelta) e/o la settimana di corsa/forza (weekDelta). NON può riscrivere gli step di una singola sessione (durate, run/walk su misura): per quelle cose non usare lo strumento, consiglia a parole. Usalo solo quando giustificato dai dati o da una richiesta sensata.",
  input_schema: {
    type: 'object',
    properties: {
      domain: { type: 'string', enum: ['strength', 'run', 'both'] },
      repScaleDelta: { type: 'number', description: 'Variazione intensità forza, tipicamente -0.3..0.3.' },
      weekDelta: { type: 'integer', description: 'Variazione settimana, di norma -1/+1 (fino a ±2 forza).' },
      reason: { type: 'string', description: 'Perché applichi questa modifica (breve).' },
    },
    required: ['domain', 'reason'],
  },
};

// --- Tool per RISCRIVERE la prossima sessione di corsa (struttura su misura) ---
const REWRITE_RUN_TOOL = {
  name: 'rewrite_run_session',
  description:
    "Riscrive la PROSSIMA sessione di corsa con una struttura su misura (es. run/walk personalizzato con intervalli). Le fasi vengono eseguite in ordine, a tempo. Usalo quando Daniele vuole una sessione di corsa diversa da quella schedulata. Includi SEMPRE un warmup all'inizio e un cooldown alla fine. Rispetta la regola del 10% (durata e intensità ragionevoli).",
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Titolo breve (es. "Run/walk Zona 2 su misura").' },
      focus: { type: 'string', description: 'Focus breve (es. "Fat oxidation con intervalli jog").' },
      phases: {
        type: 'array',
        description: 'Fasi in ordine. Primo = warmup, ultimo = cooldown.',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['warmup', 'walk', 'brisk', 'jog', 'run', 'cooldown'] },
            minutes: { type: 'number', description: 'Durata in minuti (decimali ok, es. 1.5).' },
            cue: { type: 'string', description: 'Istruzione breve per la fase (opzionale).' },
          },
          required: ['kind', 'minutes'],
        },
      },
    },
    required: ['title', 'phases'],
  },
};

// --- CORS ------------------------------------------------------------------
function corsHeaders(origin, allowed) {
  const list = (allowed || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = origin && list.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : list[0] || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-RunFit-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

// --- Chiamata generica ad Anthropic con un retry su sovraccarico ------------
async function anthropicRequest(apiKey, body) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true, data: await res.json() };
    const status = res.status;
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* non-JSON */ }
    lastErr = { status, detail };
    if (status === 429 || status === 529 || status >= 500) {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      continue;
    }
    break;
  }
  return { ok: false, error: lastErr };
}

function extractToolInput(data, toolName) {
  if (!data || !Array.isArray(data.content)) return null;
  const block = data.content.find((b) => b.type === 'tool_use' && b.name === toolName);
  return block ? block.input : null;
}

function extractText(data) {
  if (!data || !Array.isArray(data.content)) return null;
  const parts = data.content.filter((b) => b.type === 'text').map((b) => b.text);
  return parts.length ? parts.join('\n').trim() : null;
}

// --- Endpoint /coach: debrief strutturato ----------------------------------
async function handleCoach(env, model, context) {
  const result = await anthropicRequest(env.ANTHROPIC_API_KEY, {
    model,
    max_tokens: 1024,
    system: [{ type: 'text', text: SYSTEM_COACH, cache_control: { type: 'ephemeral' } }],
    tools: [COACH_TOOL],
    tool_choice: { type: 'tool', name: 'coach_feedback' },
    messages: [{
      role: 'user',
      content:
        'Ecco i miei dati di allenamento. Analizza l\'ultima sessione, confrontala con lo storico e proponi l\'aggiustamento. Dati:\n\n' +
        JSON.stringify(context),
    }],
  });
  if (!result.ok) return { error: result.error };
  const coach = extractToolInput(result.data, 'coach_feedback');
  if (!coach) return { error: { detail: 'risposta non interpretabile' } };
  return { coach, usage: result.data.usage || null };
}

// --- Endpoint /chat: conversazione libera ----------------------------------
async function handleChat(env, model, context, messages) {
  // Antepone il contesto come priming; poi la conversazione utente/coach.
  const apiMessages = [
    { role: 'user', content: 'Contesto dei miei allenamenti (per riferimento):\n' + JSON.stringify(context) },
    { role: 'assistant', content: 'Ricevuto, ho sottomano i tuoi dati. Dimmi pure.' },
    ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
  ];
  const result = await anthropicRequest(env.ANTHROPIC_API_KEY, {
    model,
    max_tokens: 800,
    system: [{ type: 'text', text: SYSTEM_CHAT, cache_control: { type: 'ephemeral' } }],
    tools: [CHANGE_TOOL, REWRITE_RUN_TOOL], // non forzati: usati solo se opportuno
    messages: apiMessages,
  });
  if (!result.ok) return { error: result.error };
  let reply = extractText(result.data);
  const change = extractToolInput(result.data, 'apply_change');
  const rewriteRun = extractToolInput(result.data, 'rewrite_run_session');
  if (!reply && (change || rewriteRun)) reply = 'Fatto, ho aggiornato il programma.';
  if (!reply) return { error: { detail: 'risposta vuota' } };
  return { reply, change, rewriteRun, usage: result.data.usage || null };
}

// --- Handler ----------------------------------------------------------------
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);
    const path = new URL(request.url).pathname;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'Metodo non consentito' }, 405, cors);

    if (env.RUNFIT_TOKEN) {
      if (request.headers.get('X-RunFit-Token') !== env.RUNFIT_TOKEN) {
        return json({ error: 'Non autorizzato' }, 401, cors);
      }
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'Coach non configurato (manca la chiave)' }, 500, cors);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'JSON non valido' }, 400, cors); }
    const context = body && body.context;
    if (!context || typeof context !== 'object') {
      return json({ error: 'Campo "context" mancante' }, 400, cors);
    }

    const model = env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

    if (path.endsWith('/chat')) {
      const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
      if (!messages.length) return json({ error: 'Campo "messages" mancante' }, 400, cors);
      const r = await handleChat(env, model, context, messages);
      if (r.error) return json({ error: 'Il coach non ha risposto', detail: r.error.detail || '' }, 502, cors);
      return json({ reply: r.reply, change: r.change || null, rewriteRun: r.rewriteRun || null, usage: r.usage }, 200, cors);
    }

    // default: /coach
    const r = await handleCoach(env, model, context);
    if (r.error) return json({ error: 'Il coach non ha risposto', detail: r.error.detail || '' }, 502, cors);
    return json({ coach: r.coach, usage: r.usage }, 200, cors);
  },
};
