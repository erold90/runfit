// ============================================================================
// RunFit — Programma scientifico walk-run 12 settimane + adattamento dinamico
// ============================================================================
// Basi scientifiche:
//   - Walk-Run intervals (Galloway, RCT Karstoft 2013 -4.3kg/4mesi)
//   - Zone 2 training per max fat oxidation (60-70% HRmax, formula Tanaka 2001)
//   - Progressione più graduale di Couch-to-5K (evita salto settimana 5)
//   - Sostituzione jog -> power-walk Z2 per chi pesa molto, fino a settimana 3
//   - 3 sessioni/settimana (gold standard fat loss principianti, BJSM 2020)
// ============================================================================

/**
 * Una fase di allenamento.
 * @typedef {Object} Phase
 * @property {'warmup'|'walk'|'brisk'|'jog'|'run'|'cooldown'|'rest'} type
 * @property {number} seconds       Durata in secondi
 * @property {number} targetZone    Zona HR target (1-5)
 * @property {string} cue           Testo audio coach
 */

/**
 * Una sessione (singolo allenamento).
 * @typedef {Object} Session
 * @property {string} id
 * @property {string} title
 * @property {string} focus         Es. 'Endurance base', 'Fat oxidation', 'Fartlek'
 * @property {Phase[]} phases
 * @property {number} totalSeconds
 */

/**
 * Una settimana = 3 sessioni A/B/C.
 * @typedef {Object} Week
 * @property {number} index
 * @property {string} title
 * @property {string} description
 * @property {string} milestone
 * @property {Session[]} sessions
 */

// --- Helpers per costruire fasi --------------------------------------------

const sec = (m, s = 0) => m * 60 + s;

const warmup = (mins = 5) => ({
  type: 'warmup',
  seconds: sec(mins),
  targetZone: 1,
  cue: `Riscaldamento: cammina rilassato per ${mins} minuti. Respira profondo.`,
});

const cooldown = (mins = 5) => ({
  type: 'cooldown',
  seconds: sec(mins),
  targetZone: 1,
  cue: `Defaticamento: cammina lentamente per ${mins} minuti. Ottimo lavoro.`,
});

const walk = (mins, s = 0, cue = 'Cammina rilassato, recupera il respiro.') => ({
  type: 'walk',
  seconds: sec(mins, s),
  targetZone: 1,
  cue,
});

const brisk = (mins, s = 0, cue = 'Passo veloce: cammina come se fossi in ritardo.') => ({
  type: 'brisk',
  seconds: sec(mins, s),
  targetZone: 2,
  cue,
});

const jog = (mins, s = 0, cue = 'Corsa leggera. Mantieni respiro controllato, dovresti riuscire a parlare a frasi brevi.') => ({
  type: 'jog',
  seconds: sec(mins, s),
  targetZone: 3,
  cue,
});

const run = (mins, s = 0, cue = 'Corsa sostenuta. Ritmo impegnativo ma controllato.') => ({
  type: 'run',
  seconds: sec(mins, s),
  targetZone: 4,
  cue,
});

const repeat = (n, phases) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(...phases.map(p => ({ ...p })));
  return out;
};

const buildSession = (id, title, focus, middlePhases) => {
  const phases = [warmup(5), ...middlePhases, cooldown(5)];
  const totalSeconds = phases.reduce((s, p) => s + p.seconds, 0);
  return { id, title, focus, phases, totalSeconds };
};

// --- Programma 12 settimane ------------------------------------------------
// Logica: 3 sessioni/settimana
//   A = Walk-Run progressivo (cuore del programma)
//   B = Long Z2 / fat oxidation (più lunga, intensità più bassa)
//   C = Variazione: fartlek leggero / brisk walk lungo / forza+core

export const PROGRAM = [
  // ---- FASE 1: ADATTAMENTO (settimane 1-4) ---------------------------------
  {
    index: 1,
    title: 'Settimana 1 — Inizia da qui',
    description: 'Il corpo deve abituarsi al carico. Niente eroismi: respira sempre.',
    milestone: 'Primi 30 secondi di corsa consecutivi',
    sessions: [
      buildSession('w1-a', 'Sessione A — Camminata + mini-jog',
        'Adattamento articolare',
        repeat(6, [brisk(1, 30), jog(0, 30, 'Mini corsetta: 30 secondi soltanto, ritmo da chiacchierata interrotta.')])),
      buildSession('w1-b', 'Sessione B — Power walk Zona 2',
        'Fat oxidation base',
        [brisk(25, 0, 'Cammina veloce per 25 minuti consecutivi. Frequenza cardiaca in Zona 2.')]),
      buildSession('w1-c', 'Sessione C — Esplorazione',
        'Tecnica + ascolto',
        repeat(5, [brisk(2), jog(0, 30, 'Trotto leggerissimo per 30 secondi.')])),
    ],
  },
  {
    index: 2,
    title: 'Settimana 2 — Costruisci la base',
    description: 'I muscoli iniziano a ricordare. Aumentiamo leggermente la corsa.',
    milestone: '1 minuto di corsa continuo',
    sessions: [
      buildSession('w2-a', 'Sessione A — 1\' jog / 2\' walk',
        'Capacità aerobica',
        repeat(7, [jog(1, 0), brisk(2)])),
      buildSession('w2-b', 'Sessione B — Long walk + scatti',
        'Fat oxidation',
        [brisk(15), ...repeat(4, [jog(0, 30), brisk(1, 30)]), brisk(5)]),
      buildSession('w2-c', 'Sessione C — Walk-Run alternato',
        'Resistenza',
        repeat(5, [jog(1), walk(1, 30, 'Camminata lenta per recupero attivo.')])),
    ],
  },
  {
    index: 3,
    title: 'Settimana 3 — Più corsa, meno pausa',
    description: 'Le gambe sono più forti. Ora alzeremo gradualmente la quota di corsa.',
    milestone: '2 minuti di corsa continui',
    sessions: [
      buildSession('w3-a', 'Sessione A — 1.5\' jog / 1.5\' walk',
        'Aerobico',
        repeat(7, [jog(1, 30), brisk(1, 30)])),
      buildSession('w3-b', 'Sessione B — Long Zone 2',
        'Massima ossidazione grassi',
        [brisk(10), ...repeat(5, [jog(1), brisk(2)]), brisk(5)]),
      buildSession('w3-c', 'Sessione C — Pyramid',
        'Varietà di stimolo',
        [jog(1), brisk(2), jog(1, 30), brisk(2), jog(2), brisk(2), jog(1, 30), brisk(2), jog(1)]),
    ],
  },
  {
    index: 4,
    title: 'Settimana 4 — Soglia di consolidamento',
    description: 'Sei in pista. Confermiamo i progressi prima di alzare il livello.',
    milestone: '3 minuti di corsa continui',
    sessions: [
      buildSession('w4-a', 'Sessione A — 2\' jog / 2\' walk',
        'Aerobico',
        repeat(6, [jog(2), brisk(2)])),
      buildSession('w4-b', 'Sessione B — Long Zone 2 estesa',
        'Fat oxidation',
        [brisk(8), ...repeat(4, [jog(2), brisk(2, 30)]), brisk(4)]),
      buildSession('w4-c', 'Sessione C — Progressivo',
        'Endurance progressiva',
        [jog(1), brisk(2), jog(2), brisk(2), jog(3), brisk(2), jog(2), brisk(2), jog(1)]),
    ],
  },
  // ---- FASE 2: COSTRUZIONE (settimane 5-8) ---------------------------------
  {
    index: 5,
    title: 'Settimana 5 — Allungamento intervalli',
    description: 'Progressione delicata: NON saltiamo come Couch-to-5K, +1 minuto alla volta.',
    milestone: '4 minuti di corsa continui',
    sessions: [
      buildSession('w5-a', 'Sessione A — 3\' jog / 2\' walk',
        'Aerobico',
        repeat(5, [jog(3), brisk(2)])),
      buildSession('w5-b', 'Sessione B — 4-3-2 piramide',
        'Endurance + fat oxidation',
        [jog(2), brisk(2), jog(3), brisk(2), jog(4), brisk(2, 30), jog(3), brisk(2), jog(2)]),
      buildSession('w5-c', 'Sessione C — Long walk-jog Z2',
        'Recupero attivo',
        [brisk(10), ...repeat(4, [jog(2), brisk(2)]), brisk(5)]),
    ],
  },
  {
    index: 6,
    title: 'Settimana 6 — Resistere oltre il fiato',
    description: 'Imparerai che dopo il primo affanno arriva il "secondo respiro".',
    milestone: '5 minuti di corsa continui',
    sessions: [
      buildSession('w6-a', 'Sessione A — 4\' jog / 2\' walk',
        'Aerobico',
        repeat(4, [jog(4), brisk(2)])),
      buildSession('w6-b', 'Sessione B — 5+5+5',
        'Endurance',
        [jog(5), brisk(2, 30), jog(5), brisk(2, 30), jog(5)]),
      buildSession('w6-c', 'Sessione C — Walk-jog libero',
        'Volume Z2',
        [...repeat(6, [jog(3), brisk(2)])]),
    ],
  },
  {
    index: 7,
    title: 'Settimana 7 — Quasi corridore',
    description: 'Tratti di corsa più lunghi. Il dimagrimento sta accelerando: il corpo è più efficiente.',
    milestone: '8 minuti di corsa continui',
    sessions: [
      buildSession('w7-a', 'Sessione A — 5\' jog / 2\' walk',
        'Aerobico+',
        repeat(4, [jog(5), brisk(2)])),
      buildSession('w7-b', 'Sessione B — 8+5+5',
        'Endurance',
        [jog(8), brisk(2, 30), jog(5), brisk(2, 30), jog(5)]),
      buildSession('w7-c', 'Sessione C — Fartlek leggero',
        'Variazione ritmo',
        [jog(3), run(0, 30), jog(2), run(0, 30), jog(2), run(0, 45), jog(2), run(0, 30), jog(3), brisk(3)]),
    ],
  },
  {
    index: 8,
    title: 'Settimana 8 — Soglia dei 10 minuti',
    description: 'Confine simbolico. Da qui in poi è quasi tutta corsa.',
    milestone: '10 minuti di corsa continui',
    sessions: [
      buildSession('w8-a', 'Sessione A — 10\' jog / 3\' walk',
        'Resistenza',
        repeat(2, [jog(10), brisk(3)])),
      buildSession('w8-b', 'Sessione B — Long Z2 continuo',
        'Fat oxidation max',
        [jog(12), brisk(3), jog(8)]),
      buildSession('w8-c', 'Sessione C — Tempo pyramid',
        'Varietà',
        [jog(5), run(2), jog(3), run(2), jog(5), brisk(3)]),
    ],
  },
  // ---- FASE 3: CONSOLIDAMENTO (settimane 9-12) -----------------------------
  {
    index: 9,
    title: 'Settimana 9 — Corsa continua',
    description: 'Per la prima volta tratti di corsa lunghi senza pausa.',
    milestone: '15 minuti di corsa continui',
    sessions: [
      buildSession('w9-a', 'Sessione A — 15\' jog / 3\' walk / 10\' jog',
        'Endurance',
        [jog(15), brisk(3), jog(10)]),
      buildSession('w9-b', 'Sessione B — Z2 lungo',
        'Fat oxidation',
        [jog(20), brisk(3), jog(7)]),
      buildSession('w9-c', 'Sessione C — Fartlek strutturato',
        'Soglia',
        [jog(5), ...repeat(4, [run(1), jog(2)]), jog(3)]),
    ],
  },
  {
    index: 10,
    title: 'Settimana 10 — Verso i 5 km',
    description: 'Stai sviluppando vera resistenza. Dimagrimento ora dipende anche da alimentazione.',
    milestone: '20 minuti di corsa continui',
    sessions: [
      buildSession('w10-a', 'Sessione A — 20\' jog continuo',
        'Endurance',
        [jog(20), brisk(3), jog(5)]),
      buildSession('w10-b', 'Sessione B — Long Z2 30\'',
        'Fat oxidation max',
        [jog(30)]),
      buildSession('w10-c', 'Sessione C — Tempo run',
        'Soglia',
        [jog(8), run(5), jog(5), run(3), jog(4)]),
    ],
  },
  {
    index: 11,
    title: 'Settimana 11 — Quasi al traguardo',
    description: 'Ultime due settimane: rifinisci la condizione.',
    milestone: '25 minuti di corsa continui',
    sessions: [
      buildSession('w11-a', 'Sessione A — 25\' jog continuo',
        'Endurance',
        [jog(25), brisk(3)]),
      buildSession('w11-b', 'Sessione B — 35\' Z2',
        'Fat oxidation',
        [jog(35)]),
      buildSession('w11-c', 'Sessione C — Intervalli Z3-Z4',
        'Capacità lattacida',
        [jog(8), ...repeat(5, [run(1, 30), jog(1, 30)]), jog(3)]),
    ],
  },
  {
    index: 12,
    title: 'Settimana 12 — Mantenimento',
    description: 'Ce l\'hai fatta. Da qui parte la fase di consolidamento per il dimagrimento a lungo termine.',
    milestone: '30 minuti di corsa continui — primi 5K',
    sessions: [
      buildSession('w12-a', 'Sessione A — 30\' jog (primi 5K)',
        'Test 5K',
        [jog(30)]),
      buildSession('w12-b', 'Sessione B — Long run Z2 40\'',
        'Mantenimento',
        [jog(40)]),
      buildSession('w12-c', 'Sessione C — Mixed run',
        'Mantenimento',
        [jog(10), run(3), jog(10), run(2), jog(8)]),
    ],
  },
];

// ============================================================================
// SESSIONI EXTRA — generate dinamicamente quando il volume sale a 4 o 5
// ============================================================================
// D = Long Zone 2 (max fat oxidation), durata scala con la settimana
// E = Easy recovery shakeout (sblocco/recupero, solo al volume 5)
// ============================================================================

/**
 * Genera la sessione D (Long Zone 2) in base alla settimana corrente.
 * Si attiva quando weeklyVolume >= 4.
 */
export function buildSessionD(weekIndex) {
  // Durata Z2 scalata: parte da 25 min e cresce con la settimana
  const z2Minutes = Math.min(45, 20 + Math.floor(weekIndex * 2)); // sett 6 -> 32', sett 12 -> 44'
  // Per chi è ancora nelle settimane di walk-run (1-5), usiamo brisk-walk Z2 invece di jog
  const useJog = weekIndex >= 5;
  const middle = useJog
    ? [jog(z2Minutes, 0, `Corsa lenta in Zona 2 per ${z2Minutes} minuti. Ritmo da chiacchierata completa, ${'massima ossidazione dei grassi'}.`)]
    : [brisk(z2Minutes, 0, `Cammina veloce in Zona 2 per ${z2Minutes} minuti. Frequenza cardiaca 110-128 bpm.`)];
  const phases = [warmup(5), ...middle, cooldown(5)];
  const totalSeconds = phases.reduce((s, p) => s + p.seconds, 0);
  return {
    id: `w${weekIndex}-d`,
    title: 'Sessione D — Long Zone 2',
    focus: 'Max fat oxidation',
    phases,
    totalSeconds,
  };
}

/**
 * Genera la sessione E (Easy Recovery) in base alla settimana corrente.
 * Si attiva quando weeklyVolume >= 5.
 */
export function buildSessionE(weekIndex) {
  // Sessione corta di recupero, sempre Z1-Z2
  const totalMid = weekIndex <= 4 ? 15 : 20;
  const useJog = weekIndex >= 6;
  const middle = useJog
    ? [
        brisk(3, 0, 'Inizia con passo veloce per attivare le gambe.'),
        jog(totalMid - 6, 0, `Corsa lentissima per ${totalMid - 6} minuti, ritmo da sblocco.`),
        brisk(3, 0, 'Chiudi con passo veloce per defaticare gradualmente.'),
      ]
    : [brisk(totalMid, 0, `Camminata veloce sciolta per ${totalMid} minuti, niente sforzi.`)];
  const phases = [warmup(5), ...middle, cooldown(5)];
  const totalSeconds = phases.reduce((s, p) => s + p.seconds, 0);
  return {
    id: `w${weekIndex}-e`,
    title: 'Sessione E — Easy recovery',
    focus: 'Recupero attivo',
    phases,
    totalSeconds,
  };
}

/**
 * Restituisce TUTTE le sessioni della settimana in base al volume corrente.
 * @param {number} weekIndex 1-12
 * @param {number} weeklyVolume 3, 4 o 5
 */
export function getWeekSessions(weekIndex, weeklyVolume = 3) {
  const week = PROGRAM[weekIndex - 1];
  const base = [...week.sessions];
  if (weeklyVolume >= 4) base.push(buildSessionD(weekIndex));
  if (weeklyVolume >= 5) base.push(buildSessionE(weekIndex));
  return base;
}

// ============================================================================
// AUTO-PROMOZIONE VOLUME SETTIMANALE
// ============================================================================
/**
 * Decide se aumentare/diminuire/mantenere il volume settimanale.
 * Si chiama quando si chiude una settimana (dopo l'ultima sessione).
 *
 * Trigger di promozione (3 -> 4):
 *   - settimana corrente >= 5 (almeno 4 settimane di adattamento articolare)
 *   - ultime 2 settimane: RPE medio <= 5.5 E completion media >= 95%
 *   - nessuna sessione interrotta nelle ultime 2 settimane
 *
 * Trigger promozione (4 -> 5):
 *   - settimana corrente >= 8 (almeno 2 settimane di volume 4 consolidato)
 *   - ultime 2 settimane: RPE medio <= 6 E completion media >= 95%
 *
 * Trigger deload (-1 sessione):
 *   - ultime 2 settimane: RPE medio >= 7.5 O almeno 1 sessione con RPE>=9 o completion<0.7
 *
 * Floor: 3. Ceiling: 5.
 *
 * @param {Object} args { currentVolume, currentWeek, sessions } sessions = storico
 * @returns {Object} { newVolume, reason, changed }
 */
export function evaluateVolumeChange({ currentVolume, currentWeek, sessions }) {
  if (!sessions || sessions.length === 0) {
    return { newVolume: currentVolume, reason: null, changed: false };
  }

  // Ordina cronologicamente
  const sorted = [...sessions].sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));

  // Prendi le sessioni delle ultime 2 settimane "vere" (per data, non per indice di programma)
  const cutoff = Date.now() - 16 * 24 * 60 * 60 * 1000; // 16 giorni
  const recent = sorted.filter(s => new Date(s.completedAt).getTime() >= cutoff);
  if (recent.length < 4) {
    return { newVolume: currentVolume, reason: 'dati-insufficienti', changed: false };
  }

  const avgRpe = recent.reduce((s, x) => s + (x.rpe || 0), 0) / recent.length;
  const avgCompletion = recent.reduce((s, x) => s + (x.completion || 0), 0) / recent.length;
  const anyHard = recent.some(x => (x.rpe || 0) >= 9 || (x.completion || 0) < 0.7);
  const anyMedHard = recent.some(x => (x.rpe || 0) >= 8 || (x.completion || 0) < 0.8);

  // 1) Deload trigger (priorità)
  if (anyHard || avgRpe >= 7.5) {
    if (currentVolume > 3) {
      return {
        newVolume: currentVolume - 1,
        reason: 'deload',
        message: `Volume ridotto a ${currentVolume - 1} sessioni: nelle ultime due settimane hai mostrato segnali di affaticamento (RPE medio ${avgRpe.toFixed(1)}).`,
        changed: true,
      };
    }
    return { newVolume: 3, reason: 'deload-floor', changed: false };
  }

  // 2) Promozione 3 -> 4
  if (currentVolume === 3 && currentWeek >= 5) {
    if (avgRpe <= 5.5 && avgCompletion >= 0.95 && !anyMedHard) {
      return {
        newVolume: 4,
        reason: 'promote-3-to-4',
        message: `🎉 Promosso a 4 sessioni/settimana! RPE medio ${avgRpe.toFixed(1)}, completion ${Math.round(avgCompletion * 100)}%. Aggiungo una Long Zone 2 (massima ossidazione grassi).`,
        changed: true,
      };
    }
  }

  // 3) Promozione 4 -> 5
  if (currentVolume === 4 && currentWeek >= 8) {
    if (avgRpe <= 6.0 && avgCompletion >= 0.95 && !anyMedHard) {
      return {
        newVolume: 5,
        reason: 'promote-4-to-5',
        message: `🚀 Promosso a 5 sessioni/settimana! Aggiungo una Easy Recovery di sblocco. Sei un atleta vero adesso.`,
        changed: true,
      };
    }
  }

  return { newVolume: currentVolume, reason: 'maintain', changed: false };
}

// --- Algoritmo adattivo ----------------------------------------------------
/**
 * Decide cosa fare dopo una sessione completata.
 * @param {Object} feedback     { rpe (1-10), completion (0-1), avgHr, targetZoneRange }
 * @returns {'advance'|'maintain'|'repeat'|'deload'}
 */
export function adaptDecision(feedback) {
  const { rpe, completion, avgHr, targetZoneRange } = feedback;
  // Allarme: troppo sforzo o sessione interrotta
  if (rpe >= 9 || completion < 0.6) return 'deload';
  if (rpe >= 8 || completion < 0.8) return 'repeat';
  // HR fuori zona target oltre il 20% (segnale troppo veloce)
  if (avgHr && targetZoneRange && avgHr > targetZoneRange.max + 10) return 'repeat';
  // Troppo facile = pronto a saltare
  if (rpe <= 4 && completion >= 0.95) return 'advance';
  // Default
  return 'maintain';
}

/**
 * Restituisce indice settimana successiva in base al feedback dell'ultima settimana
 * (decisione su media delle 3 sessioni)
 */
export function nextWeekIndex(currentWeek, weekFeedbacks) {
  if (!weekFeedbacks.length) return Math.min(currentWeek + 1, 12);
  const decisions = weekFeedbacks.map(adaptDecision);
  const hasDeload = decisions.includes('deload');
  const repeats = decisions.filter(d => d === 'repeat').length;
  const advances = decisions.filter(d => d === 'advance').length;

  if (hasDeload) return Math.max(currentWeek - 1, 1);
  if (repeats >= 2) return currentWeek;          // ripeti settimana
  if (advances >= 2 && repeats === 0) return Math.min(currentWeek + 2, 12); // salta avanti
  return Math.min(currentWeek + 1, 12);
}

// --- Zone cardiache (formula Tanaka 2001) ---------------------------------
export function calcHrMax(age) {
  return Math.round(208 - 0.7 * age);
}

export function calcZones(age, restingHr = 60) {
  const hrMax = calcHrMax(age);
  // Formula Karvonen: %HRR + restingHr
  const hrr = hrMax - restingHr;
  const zone = (lowPct, highPct) => ({
    min: Math.round(restingHr + hrr * lowPct),
    max: Math.round(restingHr + hrr * highPct),
  });
  return {
    hrMax,
    z1: { ...zone(0.50, 0.60), label: 'Recupero attivo', color: '#9ca3af' },
    z2: { ...zone(0.60, 0.70), label: 'Fat oxidation max', color: '#10b981' },
    z3: { ...zone(0.70, 0.80), label: 'Aerobico', color: '#3b82f6' },
    z4: { ...zone(0.80, 0.90), label: 'Soglia anaerobica', color: '#f59e0b' },
    z5: { ...zone(0.90, 1.00), label: 'VO2 max', color: '#ef4444' },
  };
}

// --- Calorie (Keytel et al. 2005) -----------------------------------------
// Più accurata di MET per chi monitora HR
export function kcalKeytel({ avgHr, weightKg, age, durationMin, isMale = true }) {
  if (!avgHr || !weightKg || !age || !durationMin) return null;
  const kcalPerMin = isMale
    ? (-55.0969 + 0.6309 * avgHr + 0.1988 * weightKg + 0.2017 * age) / 4.184
    : (-20.4022 + 0.4472 * avgHr - 0.1263 * weightKg + 0.074 * age) / 4.184;
  return Math.max(0, Math.round(kcalPerMin * durationMin));
}

// --- Stima calorie senza HR (MET-based, fallback) -------------------------
export function kcalFromMET(phaseType, durationMin, weightKg) {
  const MET = {
    warmup: 3.0,
    walk: 3.0,
    brisk: 5.0,
    jog: 7.0,
    run: 9.8,
    cooldown: 3.0,
    rest: 1.5,
  };
  const met = MET[phaseType] ?? 4;
  return Math.round(met * weightKg * (durationMin / 60));
}
