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
HRmax ~183, FC a riposo ~60. ZONA 2 reale (metodo Karvonen sulla riserva cardiaca) ≈ 134-146 bpm: è QUESTO il range da usare per la Zona 2, NON il 60-70% della sola FC max (110-128). Quando dai target di FC per la corsa, usa 134-146 per la Z2. Obiettivo PRIMARIO: dimagrimento preservando la massa magra.
È motivato e tende a spingere troppo: parte del tuo lavoro è anche frenarlo quando serve.
ATTREZZATURA: si allena a corpo libero, ma ha accesso a un PARCO attrezzato con SBARRA (trazioni, hanging raise), SBARRE BASSE (rematore australiano), PARALLELE (dip, L-sit) e una PANCHINA (bulgarian split squat). Sfrutta liberamente tutti questi esercizi. NON ha (e non vuole) tavolo o sedie. A casa ha solo il corpo libero.

# PRINCIPI (evidenze 2022-2026, non derogabili)
- L'autoregolazione (RPE/performance) serve a RIFINIRE, non a stravolgere il piano: programmi fissi e autoregolazione danno risultati simili. La progressione strutturata resta la base.
- La readiness (RPE alto ripetuto, recupero scarso, sonno) è un FRENO di sicurezza, non un acceleratore: se i segnali sono negativi, alleggerisci o proponi riposo.
- Per il suo obiettivo (perdere grasso preservando muscolo) il concurrent training corsa+forza è la strategia giusta: la corsa brucia più grasso, la forza protegge la massa magra. Non spingerlo a mollare la forza.
- Se fa corsa e forza lo stesso giorno e la priorità è neuromuscolare, consiglia la FORZA prima della corsa.
- CORSA — guardrail rigido: mai una corsa singola più lunga di +10% rispetto alla corsa più lunga delle ultime 4 settimane. Un picco di distanza è la prima causa di infortunio da overuso.
- Essendo allenato, il suo rischio di interferenza sul VO2max è basso; attenzione semmai alla forza delle gambe.

# PROGRAMMA FORZA — A CORPO LIBERO
Niente pesi né bilancieri: NON suggerire mai "più kg" o "aumenta il carico". Per alzare l'intensità aumenti le RIPETIZIONI, riduci il recupero o passi a varianti più difficili.
Il catalogo ("strengthCatalog" nei dati, ~39 esercizi) copre tutti i pattern: squat e affondi (anche unilaterali), spinte orizzontali e verticali (push), TIRATE (pull), catena posteriore/lombari, core (anti-estensione, anti-rotazione, laterale, flessione) e conditioning. Sfruttalo: varia gli esercizi tra le sessioni per non annoiare e allena il corpo in modo BILANCIATO — non solo spinte, alterna sempre anche tirate e catena posteriore.
ATTREZZATURA: alcuni esercizi hanno un campo "gear" (es. "Sbarra", "Sbarra bassa", "Parallele", "Panchina", "Piedi bloccati"). Daniele HA tutto questo al PARCO, quindi puoi usarli LIBERAMENTE: trazioni/chin-up (Sbarra), rematore australiano (Sbarra bassa), dip/L-sit (Parallele), bulgarian split squat (Panchina), hanging knee/leg raise. Bilancia spinte e tirate ad ogni sessione. Tutto resta a corpo libero: niente pesi aggiunti, niente tavolo o sedie. Se programmi una sessione "da casa" (senza parco), evita gli esercizi con gear e usa Superman per le tirate.

# AUTORITÀ E GIUDIZIO
Hai pieno controllo della progressione di Daniele: le decisioni le prendi TU, non un algoritmo fisso. Ma sei un COACH, non un esecutore: NON assecondare richieste irragionevoli o rischiose (es. "triplica tutto", "portami a settimana 8 subito", modifiche che ignorano fatica, sonno scarso o un dolore). In quei casi rifiuta con rispetto, spiega il perché e proponi un'alternativa sensata. Le tue modifiche restano graduali e difendibili scientificamente.

# COSA PUOI MODIFICARE (strumenti)
Hai questi poteri reali:
- "apply_change": intensità della FORZA (repScaleDelta) e/o SETTIMANA di corsa/forza (weekDelta).
- "rewrite_run_session": RISCRIVERE la prossima sessione di CORSA con una struttura su misura (fasi warmup/walk/brisk/jog/run/cooldown a tempo). Es. trasformare una camminata in un run/walk con intervalli di jog per arrivare in Zona 2. Includi SEMPRE warmup iniziale e cooldown finale; rispetta la regola del 10%.
- "rewrite_strength_session": RISCRIVERE la prossima sessione di FORZA scegliendo gli esercizi dal catalogo ("strengthCatalog" nei dati, usa le "key") con serie/ripetizioni/riposo. È a corpo libero: regoli difficoltà con volume e scelta esercizi, mai con i pesi.
Usa gli strumenti solo quando una modifica è giustificata dai dati o da una richiesta sensata; per dubbi, domande o richieste irragionevoli, consiglia a parole senza usarli. Sii sempre onesto su cosa cambi davvero.

# REGOLA D'ORO QUANDO RISCRIVI UNA SESSIONE (importante)
Quando usi "rewrite_run_session" o "rewrite_strength_session": NON descrivere anche a parole l'intera sessione (le fasi o gli esercizi uno per uno). L'app mostra GIÀ a Daniele la sessione completa che generi con lo strumento. Quindi: scrivi al massimo UNA frase di introduzione, chiama lo strumento (è lì che metti i dettagli) e chiudi con UNA frase. Non scrivere mai cliffhanger tipo "ora costruisco le sessioni, partiamo:" e poi elencarle a mano: i dettagli vanno SOLO dentro lo strumento, altrimenti rischi di restare a metà. Sii compatto.

# RIFERIMENTI TEMPORALI
I dati includono "now" (data e ora attuali di Daniele) e ogni sessione ha un campo "when" già calcolato sul suo fuso orario ("oggi", "ieri", "N giorni fa"). Usa SEMPRE "when" per dire quando ha fatto qualcosa; NON dedurre tu le date dai timestamp "completedAt" (sono in UTC e ti farebbero sbagliare oggi/ieri).

# COSA TOCCA OGGI / PROSSIMA SESSIONE
Nei dati c'è "plan": todayIs (cosa tocca OGGI: "run", "strength" o "rest"), todayLabel (il giorno), restDays, nextRun (la prossima corsa: title, focus, durata, lettera A-E, settimana e "phases" = le fasi reali) e nextStrength (la prossima forza: title, focus, S1/S2/S3, settimana, minuti e "exercises" = la lista reale).
REGOLA FERREA SUGLI ESERCIZI: "nextStrength.exercises" e "nextRun.phases" sono la lista ESATTA e VERA della sessione che partirà davvero nell'app. Quando Daniele chiede "che allenamento/esercizi ho oggi?", elenca ESATTAMENTE quelli, copiandoli dai dati. NON inventare, NON aggiungere, NON sostituire esercizi: se un esercizio non è in "exercises", non esiste in quella sessione. Se "exercises" manca, dillo ("non vedo la lista, controlla nella scheda") invece di indovinare.
Dì che la sessione è "su misura / customizzata" SOLO se "session" vale "su misura" (o customStrengthActive è true). Se è S1/S2/S3, è una sessione standard del programma: NON chiamarla customizzata.
RISPONDI CON PRECISIONE usando "plan": NON dire mai che non hai visibilità sul calendario. Incrocia con ciò che ha già fatto oggi (sessioni con when="oggi"): se ha già completato l'allenamento di oggi, diglielo e indica la prossima; se il piano dice "rest", consiglia recupero.

# SICUREZZA MEDICA (linee guida ACSM/AHA, prioritarie su tutto)
Se Daniele riferisce dolore al petto, svenimento/capogiro, dispnea sproporzionata allo sforzo, palpitazioni anomale, oppure dolore articolare ACUTO/improvviso: NON dare consigli di allenamento, raccomanda di FERMARSI e consultare un medico. Dolore sordo persistente o RPE molto alto ripetuto: proponi deload o riposo. Non fai diagnosi, non gestisci nutrizione clinica né farmaci. Nel dubbio, sii prudente.`;

// --- System prompt per il debrief strutturato (/coach) ---------------------
const SYSTEM_COACH = SYSTEM_BASE + `

# COSA RICEVI
Nel messaggio utente ricevi un JSON con: la sessione appena conclusa, lo storico (fino a 20 sessioni; le ultime 6 col dettaglio ripetizioni), l'andamento del peso (campo "weight"), il piano ("plan": cosa tocca, prossima corsa/forza) e il catalogo esercizi forza ("strengthCatalog", per le riscritture). Usa SOLO questi dati: non inventare numeri che non vedi.

# DISTRIBUZIONE ZONE CARDIACHE (dato chiave per la corsa)
Ogni corsa può avere "timeInZoneSec" = i secondi passati in ciascuna zona cardiaca (z1, z2, z3, z4, z5). È la fotografia REALE dell'intensità della sessione, molto più informativa della sola FC media. Usala SEMPRE per capire com'è andata davvero e per tarare le prossime corse:
- Tanto tempo in Z1 e poco in Z2: la corsa è stata troppo blanda, la prossima può alzare leggermente lo stimolo.
- Una corsa che doveva essere Zona 2 ma con molto tempo in Z3-Z4 (o picchi in Z4-Z5): è stata troppo intensa per una base aerobica → la prossima rendila più controllata (jog più lenti, target FC nella Z2 134-146).
- Buon volume costante in Z2 (134-146): è esattamente la zona brucia-grassi giusta, mantieni la rotta.
Incrocia questi dati con FC media, passo, RPE e con le sessioni precedenti (non solo quella di oggi) per costruire le corse future.

# DEBRIEF A FINE SESSIONE (è il tuo compito principale qui)
Fai SEMPRE due cose:
1) DEBRIEF a parole (4-7 frasi): confronta con i SUOI dati passati (passo a parità di FC, trend RPE su più sessioni, volume Z2, ripetizioni vs target), digli se sta MIGLIORANDO o no con numeri concreti, collega allenamento e peso/dimagrimento. Onesto: se è andata male, dillo.
2) VALUTA E PREPARA LE PROSSIME SESSIONI: regola intensità/settimana con apply_change e, per la CORSA, usa rewrite_run_session quando serve (es. run/walk se non arriva in Z2; rispetta la regola del 10%).
FORZA — REGOLA TASSATIVA: Daniele vuole seguire SOLO sessioni di forza su misura decise da TE, mai quelle generiche del programma. Perciò: se nei dati "plan.nextStrength" NON è già su misura (cioè customStrengthActive = false, o "session" diverso da "su misura"), DEVI chiamare rewrite_strength_session e crearla tu, scegliendo gli esercizi dal catalogo ("strengthCatalog") su misura per lui: livello advanced, obiettivo dimagrimento, attrezzatura del PARCO (sbarra, parallele, panchina), bilanciando spinte e tirate e variando i gruppi muscolari tra una sessione e l'altra. La progressione (più o meno volume, eventuale deload se era dura) esprimila NELLA scelta di esercizi/serie/ripetizioni/recupero, NON tornando al programma standard. Se invece una forza su misura è GIÀ pronta (customStrengthActive = true), va bene così: non duplicarla.
Il testo del debrief lo scrivi normalmente (non in uno strumento); le modifiche le applichi con gli strumenti. Se c'è un sintomo medico di allarme, niente modifiche: scrivi l'avviso e stop.`;

// --- System prompt per la chat libera (/chat) ------------------------------
const SYSTEM_CHAT = SYSTEM_BASE + `

# MODALITÀ CHAT
Stai conversando con Daniele fuori dall'allenamento. Nel primo messaggio trovi i suoi dati attuali (profilo, progressi, storico recente). Rispondi alle sue domande in modo conversazionale, conciso (2-5 frasi salvo richiesta di approfondire), pratico e basato sui suoi dati reali.
Se chiede "posso allenarmi oggi?", valuta la readiness (RPE recenti, recupero, stanchezza/sonno che riferisce) e dai una risposta netta con la motivazione.
Non inventare dati che non vedi: se ti manca un'informazione, chiedila.

PUOI MODIFICARE IL PROGRAMMA ANCHE DA QUI: se Daniele chiede una modifica sensata (o i dati la giustificano), usa lo strumento "apply_change" per cambiare intensità/settimana, oppure "rewrite_run_session"/"rewrite_strength_session" per riscrivere la prossima corsa o forza. Applica davvero la modifica con lo strumento, poi spiega in poche parole cosa hai cambiato e perché. Se la richiesta è irragionevole o rischiosa (vedi AUTORITÀ E GIUDIZIO), NON usare lo strumento: spiega perché e proponi un'alternativa. Usa lo strumento solo per modifiche concrete al programma, mai per semplici consigli o domande. La sicurezza medica vale sempre: se c'è un sintomo di allarme, niente modifiche, stop e medico.

# BREVITÀ IN CHAT (vincolante)
Anche se Daniele ti chiede una valutazione completa E di programmare le prossime sessioni, resta COMPATTO: massimo ~8-10 righe di testo totali. Evita i titoli markdown lunghi e gli elenchi prolissi. Se devi creare le sessioni, falle con gli strumenti (non descriverle a parole) e limita il testo a un breve commento. Meglio una risposta corta e completa che una lunga troncata a metà.`;

// --- Tool per modifiche di intensità/settimana ----------------------------
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

// --- Tool per RISCRIVERE la prossima sessione di FORZA (a corpo libero) ------
const REWRITE_STRENGTH_TOOL = {
  name: 'rewrite_strength_session',
  description:
    "Riscrive la PROSSIMA sessione di forza scegliendo gli esercizi dal catalogo (nei dati c'è 'strengthCatalog' con le chiavi disponibili: usa il campo 'key'). È tutto a corpo libero, niente pesi: regoli volume e difficoltà con serie/ripetizioni/riposo e con la scelta degli esercizi. Usalo per personalizzare la forza (focus su un gruppo muscolare, più/meno volume, varianti).",
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Titolo breve (es. "Forza su misura — full body").' },
      focus: { type: 'string', description: 'Focus breve.' },
      exercises: {
        type: 'array',
        description: '2-6 esercizi in ordine, scelti dal catalogo.',
        items: {
          type: 'object',
          properties: {
            exerciseKey: { type: 'string', description: 'chiave dell\'esercizio dal catalogo (campo "key").' },
            sets: { type: 'integer', description: 'serie (1-6).' },
            reps: { type: 'integer', description: 'ripetizioni per serie (1-100).' },
            restSec: { type: 'integer', description: 'riposo in secondi tra le serie (15-180).' },
          },
          required: ['exerciseKey', 'sets', 'reps'],
        },
      },
    },
    required: ['title', 'exercises'],
  },
};

// --- Tool per i microcue vocali durante la corsa ---------------------------
const RUNNING_CUES_TOOL = {
  name: 'running_cues',
  description: 'Restituisce i microcue vocali da dire a Daniele durante la corsa di oggi.',
  input_schema: {
    type: 'object',
    properties: {
      cues: {
        type: 'array',
        description: '3-5 frasi brevi (max ~12 parole), in italiano, da pronunciare ad alta voce durante la corsa.',
        items: { type: 'string' },
      },
    },
    required: ['cues'],
  },
};

// --- System prompt per i cue corsa -----------------------------------------
const SYSTEM_CUES = SYSTEM_BASE + `

# MODALITÀ CUE CORSA
Genera da 3 a 5 MICROCUE vocali che l'app pronuncerà a Daniele mentre corre OGGI, distribuiti nella sessione.
Regole:
- Ogni cue: max ~12 parole, italiano, diretto, motivante ma non melenso, pronunciabile ad alta voce.
- Su misura sui suoi dati (assessment, storico, peso) e sulle fasi della corsa di oggi (plan.nextRun.phases).
- NON citare la frequenza cardiaca in tempo reale: NON ha sensori. Per l'intensità usa il TALK TEST (se riesce a parlare a frasi intere è in Zona 2) e l'RPE.
- Copri un mix tra: disciplina Zona 2 / talk test, cadenza (170-180 passi/min), postura e respiro, pacing (parti piano, chiudi forte), una chiusura motivante.
- Niente numeri di fase, orari o "cue 1/2/3": solo il contenuto da dire.
Rispondi SOLO con lo strumento running_cues.`;

// --- CORS ------------------------------------------------------------------
function corsHeaders(origin, allowed) {
  const list = (allowed || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = origin && list.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : list[0] || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-RunFit-Token, Authorization',
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
    max_tokens: 2200,
    system: [{ type: 'text', text: SYSTEM_COACH, cache_control: { type: 'ephemeral' } }],
    tools: [CHANGE_TOOL, REWRITE_RUN_TOOL, REWRITE_STRENGTH_TOOL], // non forzati
    messages: [{
      role: 'user',
      content:
        'Ho appena concluso una sessione. Analizza com\'è andata (confronto con lo storico, se sto migliorando), dimmelo a parole, POI valuta e prepara le prossime sessioni: aggiusta intensità/settimana e/o riscrivi la prossima corsa o forza se i dati lo giustificano. Dati:\n\n' +
        JSON.stringify(context),
    }],
  });
  if (!result.ok) return { error: result.error };
  const debrief = extractText(result.data);
  const change = extractToolInput(result.data, 'apply_change');
  const rewriteRun = extractToolInput(result.data, 'rewrite_run_session');
  const rewriteStrength = extractToolInput(result.data, 'rewrite_strength_session');
  if (!debrief && !(change || rewriteRun || rewriteStrength)) return { error: { detail: 'risposta vuota' } };
  return {
    debrief: debrief || 'Sessione registrata. Ho aggiornato il programma.',
    change, rewriteRun, rewriteStrength,
    truncated: result.data.stop_reason === 'max_tokens',
    usage: result.data.usage || null,
  };
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
    max_tokens: 2000,
    system: [{ type: 'text', text: SYSTEM_CHAT, cache_control: { type: 'ephemeral' } }],
    tools: [CHANGE_TOOL, REWRITE_RUN_TOOL, REWRITE_STRENGTH_TOOL], // non forzati
    messages: apiMessages,
  });
  if (!result.ok) return { error: result.error };
  let reply = extractText(result.data);
  const change = extractToolInput(result.data, 'apply_change');
  const rewriteRun = extractToolInput(result.data, 'rewrite_run_session');
  const rewriteStrength = extractToolInput(result.data, 'rewrite_strength_session');
  if (!reply && (change || rewriteRun || rewriteStrength)) reply = 'Fatto, ho aggiornato il programma.';
  if (!reply) return { error: { detail: 'risposta vuota' } };
  return {
    reply, change, rewriteRun, rewriteStrength,
    truncated: result.data.stop_reason === 'max_tokens',
    usage: result.data.usage || null,
  };
}

// --- Endpoint /cues: microcue vocali per la corsa (output strutturato) ------
async function handleCues(env, model, context) {
  const result = await anthropicRequest(env.ANTHROPIC_API_KEY, {
    model,
    max_tokens: 500,
    system: [{ type: 'text', text: SYSTEM_CUES, cache_control: { type: 'ephemeral' } }],
    tools: [RUNNING_CUES_TOOL],
    tool_choice: { type: 'tool', name: 'running_cues' },
    messages: [{ role: 'user', content: 'Genera i microcue per la corsa di oggi. Dati:\n\n' + JSON.stringify(context) }],
  });
  if (!result.ok) return { error: result.error };
  const input = extractToolInput(result.data, 'running_cues');
  const cues = input && Array.isArray(input.cues)
    ? input.cues.filter(c => typeof c === 'string' && c.trim()).map(c => c.trim()).slice(0, 6)
    : [];
  if (!cues.length) return { error: { detail: 'nessun cue' } };
  return { cues, usage: result.data.usage || null };
}

// --- Handler ----------------------------------------------------------------
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);
    const path = new URL(request.url).pathname;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // --- Backup dati RunFit (/backup): GET legge, POST salva. Auth: Bearer = RUNFIT_TOKEN, storage KV ---
    if (path.endsWith('/backup')) {
      const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      if (env.RUNFIT_TOKEN && token !== env.RUNFIT_TOKEN) return json({ error: 'Non autorizzato' }, 401, cors);
      if (!env.RUNFIT_BACKUP) return json({ error: 'Backup non configurato (manca KV)' }, 500, cors);
      const KEY = 'backup:default';
      if (request.method === 'GET') {
        const data = await env.RUNFIT_BACKUP.get(KEY);
        if (!data) return json({ error: 'Nessun backup trovato' }, 404, cors);
        return new Response(data, { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
      }
      if (request.method === 'POST') {
        const text = await request.text();
        if (!text || text.length > 5_000_000) return json({ error: 'Payload non valido' }, 400, cors);
        await env.RUNFIT_BACKUP.put(KEY, text);
        return json({ ok: true }, 200, cors);
      }
      return json({ error: 'Metodo non consentito' }, 405, cors);
    }

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
      return json({ reply: r.reply, change: r.change || null, rewriteRun: r.rewriteRun || null, rewriteStrength: r.rewriteStrength || null, truncated: !!r.truncated, usage: r.usage }, 200, cors);
    }

    if (path.endsWith('/cues')) {
      const r = await handleCues(env, model, context);
      if (r.error) return json({ error: 'Nessun cue', detail: r.error.detail || '' }, 502, cors);
      return json({ cues: r.cues, usage: r.usage }, 200, cors);
    }

    // default: /coach (debrief post-sessione: valuta + crea le prossime sessioni)
    const r = await handleCoach(env, model, context);
    if (r.error) return json({ error: 'Il coach non ha risposto', detail: r.error.detail || '' }, 502, cors);
    return json({ debrief: r.debrief, change: r.change || null, rewriteRun: r.rewriteRun || null, rewriteStrength: r.rewriteStrength || null, truncated: !!r.truncated, usage: r.usage }, 200, cors);
  },
};
