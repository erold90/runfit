// ============================================================================
// RunFit Coach — Cloudflare Worker (proxy verso Anthropic Messages API)
// ============================================================================
// La PWA invia il contesto (profilo + storico + sessione) a POST /coach.
// Il Worker aggiunge il system prompt fisso, forza un JSON strutturato via
// tool use, chiama Claude (Haiku 4.5) e restituisce il debrief + l'aggiustamento.
// La chiave API vive SOLO qui come secret, mai nel client.
// ============================================================================

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// --- System prompt fisso (cacheable). Evidence-based, vedi ricerca 2026-06 ---
const SYSTEM_PROMPT = `Sei il coach personale di Daniele dentro l'app RunFit. Parli italiano, diretto e caldo, mai paternalistico. Sei un coach evidence-based, non un cheerleader.

# CHI È DANIELE
Uomo, 36 anni, ~85 kg (obiettivo 75). Ex-crossfitter che riprende dopo uno stop.
VO2max stimato ~43,5 (nella media per la sua età), heart rate recovery 21 bpm (recupero sano), forza livello ADVANCED.
HRmax ~183, Zona 2 = 110-128 bpm. Obiettivo PRIMARIO: dimagrimento preservando la massa magra.
È motivato e tende a spingere troppo: parte del tuo lavoro è anche frenarlo quando serve.

# COSA RICEVI
Nel messaggio utente ricevi un JSON con: la sessione appena conclusa, lo storico completo (RPE, FC, passo, km, ripetizioni per esercizio, completamento), il peso e la posizione nel programma (settimana corsa/forza, intensità repScale). Usa SOLO questi dati: non inventare numeri che non vedi.

# PRINCIPI (evidenze 2022-2026, non derogabili)
- L'autoregolazione (RPE/performance) serve a RIFINIRE la sessione, non a stravolgere il piano: i programmi fissi e l'autoregolazione danno risultati simili (meta-analisi 2022). Aggiusta in piccolo; la progressione strutturata resta la base.
- La readiness (RPE alto ripetuto, recupero scarso, sonno) è un FRENO di sicurezza, non un acceleratore: se i segnali sono negativi alleggerisci o proponi riposo. Non usarla mai come scusa per caricare di più.
- Per il suo obiettivo (perdere grasso preservando muscolo) il concurrent training corsa+forza è la strategia giusta: la corsa/aerobica brucia più grasso, la forza protegge la massa magra. Non spingerlo a mollare la forza.
- Se fa corsa e forza lo stesso giorno e la priorità è neuromuscolare, consiglia la FORZA prima della corsa (il cardio non risente dell'ordine).
- CORSA — guardrail rigido: NON proporre mai una corsa singola più lunga di +10% rispetto alla corsa più lunga delle ultime 4 settimane. Un picco di distanza è la prima causa di infortunio da overuso (rischio fino a +128% per picchi sopra il 100%). Questa regola prevale su qualunque tua proposta.
- Essendo allenato, il suo rischio di interferenza sul VO2max è basso; attenzione semmai alla forza delle gambe.

# COME DAI IL FEEDBACK (debrief)
- Confronta SEMPRE con i SUOI dati passati, mai con altre persone: passo a parità di FC, trend dell'RPE, volume in Zona 2, ripetizioni rispetto al target. Niente paragoni competitivi con terzi.
- Struttura: 1 cosa andata bene + 1 dato oggettivo di progresso (o regressione) + 1 focus per la prossima sessione.
- Onesto: se è andata male, dillo con rispetto e spiega perché.
- Conciso: 4-6 frasi. Sei un coach, non un articolo.

# PROGRAMMA FORZA — È A CORPO LIBERO
Nessun peso, nessun bilanciere: solo esercizi bodyweight dinamici. NON suggerire mai "più kg", "aumenta il carico" o attrezzi. Per alzare l'intensità si aumentano le RIPETIZIONI (è ciò che fa repScale) o si passa a varianti più difficili (è ciò che fa l'avanzamento di settimana). repScale è il moltiplicatore delle ripetizioni proposte, non del carico.

# AGGIUSTAMENTI (entro limiti rigidi)
Proponi UN aggiustamento per la prossima sessione. Limiti invalicabili: repScaleDelta tra -0.15 e +0.15; weekDelta tra -1 e +1. Se i dati non giustificano un cambio, lascia tutto invariato (action "keep"). La regola del 10% sulla corsa prevale su qualunque aggiustamento.

# SICUREZZA MEDICA (linee guida ACSM/AHA, prioritarie su tutto)
Se Daniele riferisce dolore al petto, svenimento/capogiro, dispnea sproporzionata allo sforzo, palpitazioni anomale, oppure dolore articolare ACUTO/improvviso: NON dare consigli di allenamento, raccomanda di FERMARSI e consultare un medico, e imposta flag "medical".
Dolore sordo persistente o RPE molto alto ripetuto su più sessioni: proponi deload o riposo (flag "caution").
Non fai diagnosi. Non gestisci nutrizione clinica né farmaci. Nel dubbio, sii prudente.

# OUTPUT
Rispondi SEMPRE e SOLO chiamando lo strumento "coach_feedback" con i campi richiesti. Non scrivere testo fuori dallo strumento. Sii sempre dalla sua parte.`;

// --- Tool che forza il JSON strutturato di risposta ---
const COACH_TOOL = {
  name: 'coach_feedback',
  description:
    "Restituisce il debrief del coach e l'aggiustamento proposto per la prossima sessione. È l'unico modo consentito di rispondere.",
  input_schema: {
    type: 'object',
    properties: {
      debrief: {
        type: 'string',
        description:
          'Debrief in italiano, 4-6 frasi: cosa è andato bene, un dato oggettivo di progresso/regressione vs storico, un focus per la prossima.',
      },
      highlights: {
        type: 'array',
        items: { type: 'string' },
        description: '1-3 punti brevissimi (es. "Passo -8s/km a pari FC", "RPE in calo").',
      },
      adjustment: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            enum: ['run', 'strength', 'none'],
            description: 'Ambito a cui si applica l\'aggiustamento.',
          },
          action: {
            type: 'string',
            enum: ['keep', 'easier', 'harder', 'deload', 'rest'],
            description: 'Direzione del cambio per la prossima sessione.',
          },
          repScaleDelta: {
            type: 'number',
            description: 'Variazione del moltiplicatore intensità forza, tra -0.15 e 0.15. 0 se nessun cambio.',
          },
          weekDelta: {
            type: 'integer',
            description: 'Variazione settimana di programma, tra -1 e 1. 0 se nessun cambio.',
          },
          reason: {
            type: 'string',
            description: 'Motivazione breve dell\'aggiustamento, basata sui dati.',
          },
        },
        required: ['domain', 'action', 'repScaleDelta', 'weekDelta', 'reason'],
      },
      flag: {
        type: 'string',
        enum: ['none', 'caution', 'medical'],
        description:
          'none = tutto ok; caution = segnali di affaticamento, proponi cautela; medical = sintomo di allarme, stop e consulto medico.',
      },
    },
    required: ['debrief', 'highlights', 'adjustment', 'flag'],
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

// --- Chiamata ad Anthropic con un retry su sovraccarico/errore server -------
async function callAnthropic(apiKey, model, context) {
  const payload = {
    model,
    max_tokens: 1024,
    // System come array di blocchi → consente il prompt caching del prefisso.
    // Nota: su Haiku 4.5 il caching parte solo da prefissi >= 4096 token; sotto
    // quella soglia il marker è innocuo ma non si attiva.
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    tools: [COACH_TOOL],
    tool_choice: { type: 'tool', name: 'coach_feedback' }, // forza il JSON strutturato
    messages: [
      {
        role: 'user',
        content:
          'Ecco i miei dati di allenamento. Analizza l\'ultima sessione, confrontala con lo storico e proponi l\'aggiustamento. Dati:\n\n' +
          JSON.stringify(context),
      },
    ],
  };

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) return { ok: true, data: await res.json() };

    const status = res.status;
    let detail = '';
    try {
      detail = (await res.json())?.error?.message || '';
    } catch {
      /* corpo non-JSON */
    }
    lastErr = { status, detail };

    // Riprova solo su sovraccarico/errore server transitorio
    if (status === 429 || status === 529 || status >= 500) {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      continue;
    }
    break; // errori 4xx non transitori → non ritentare
  }
  return { ok: false, error: lastErr };
}

// --- Estrae il blocco tool_use dalla risposta ------------------------------
function extractCoachOutput(data) {
  if (!data || !Array.isArray(data.content)) return null;
  const block = data.content.find(
    (b) => b.type === 'tool_use' && b.name === 'coach_feedback'
  );
  return block ? block.input : null;
}

// --- Handler ----------------------------------------------------------------
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Metodo non consentito' }, 405, cors);
    }

    // Auth: token condiviso PWA <-> Worker (se configurato)
    if (env.RUNFIT_TOKEN) {
      const token = request.headers.get('X-RunFit-Token');
      if (token !== env.RUNFIT_TOKEN) {
        return json({ error: 'Non autorizzato' }, 401, cors);
      }
    }

    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'Coach non configurato (manca la chiave)' }, 500, cors);
    }

    // Body
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'JSON non valido' }, 400, cors);
    }
    const context = body && body.context;
    if (!context || typeof context !== 'object') {
      return json({ error: 'Campo "context" mancante' }, 400, cors);
    }

    // Chiamata a Claude
    const model = env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
    const result = await callAnthropic(env.ANTHROPIC_API_KEY, model, context);

    if (!result.ok) {
      const code = result.error?.status === 401 ? 502 : 502; // non esporre 401 a valle
      return json(
        { error: 'Il coach non ha risposto', detail: result.error?.detail || '' },
        code,
        cors
      );
    }

    const coach = extractCoachOutput(result.data);
    if (!coach) {
      return json({ error: 'Risposta del coach non interpretabile' }, 502, cors);
    }

    return json(
      {
        coach,
        usage: result.data.usage || null, // per monitorare i token/costi
      },
      200,
      cors
    );
  },
};
