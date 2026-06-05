// ============================================================================
// RunFit — Modulo Forza Dinamica (Strength + Conditioning bodyweight)
// ============================================================================
// Programma 8 settimane × 3 sessioni/settimana, bodyweight, ~12-18 min ciascuna.
// Tutti esercizi dinamici (no statici prolungati tipo plank lungo).
// Pensato per ex-crossfitter "returning": memoria muscolare presente, ma
// resistenza aerobica e capacità di recupero ridotte → intensità moderata,
// rest adeguati, no AMRAP estremi che brucerebbero il sistema corsa.
//
// 3 SESSIONI/SETTIMANA:
//   S1 — STRENGTH       (4 esercizi × 3 set, rest 60-75s, focus forza)
//   S2 — CONDITIONING   (4 esercizi × 3 set, rest 30-45s, intensità più alta)
//   S3 — MIX            (4 esercizi × 3 set, rest 45-60s, varietà di stimolo)
//
// Apple Watch: avviare "Allenamento di forza" o "HIIT" (per S2/S3).
//   Tracking: HR, HR max, calorie attive, durata.
//
// Livello partenza:
//   beginner   → fase 0 sett 1-2, fase 1 sett 3-4, ecc.
//   returning  → SKIP 2 settimane (parte da fase 1) — ex crossfitter fermo
//   advanced   → SKIP 4 settimane (parte da fase 2)
// ============================================================================

// CATALOGO ESERCIZI (tutti bodyweight, tutti dinamici)
// gifUrl: animazione dimostrativa da fitnessprogramer.com (verificata HTTP 200)
const CATALOG = {
  // Lower body — squat pattern
  airSquat: {
    name: 'Air squat',
    icon: '🦵',
    muscle: 'Quadricipiti + glutei',
    formTip: 'Piedi larghezza spalle, peso sui talloni, scendi fino a cosce parallele. Esecuzione fluida e controllata.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/05/bodyweight-squat-full-version.gif',
  },
  squatJump: {
    name: 'Squat jump',
    icon: '🚀',
    muscle: 'Quadricipiti + glutei + esplosività',
    formTip: 'Air squat poi salto verso l\'alto. Atterra morbido sui piedi piegando le ginocchia, ricicla subito nel prossimo squat.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/02/Jump-Squat.gif',
  },
  reverseLunge: {
    name: 'Affondi indietro alternati',
    icon: '🚶',
    muscle: 'Quadricipiti + glutei + stabilità',
    formTip: 'Un passo lungo indietro, ginocchio posteriore sfiora terra, torna su con potenza. Alterna le gambe.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2022/08/bodyweight-reverse-lunge.gif',
  },
  jumpingLunge: {
    name: 'Jumping lunge (power lunge)',
    icon: '⚡',
    muscle: 'Esplosività + glutei',
    formTip: 'Affondo, poi salto scambiando le gambe in aria, atterri nell\'affondo opposto. Mantieni il busto eretto.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2023/09/power-lunge.gif',
  },

  // Upper body — push pattern
  pushup: {
    name: 'Piegamenti',
    icon: '💪',
    muscle: 'Petto + spalle + tricipiti',
    formTip: 'Corpo dritto come una tavola, mani sotto le spalle, scendi fino a sfiorare il pavimento, spingi su.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/02/Push-Up.gif',
  },
  pushupKnee: {
    name: 'Piegamenti ginocchia',
    icon: '💪',
    muscle: 'Petto + spalle + tricipiti',
    formTip: 'Solo se le standard non escono pulite. Ginocchia a terra, corpo dritto dalle ginocchia in su.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2022/01/Kneeling-Push-up.gif',
  },
  plankToPushup: {
    name: 'Plank to push-up',
    icon: '🔄',
    muscle: 'Petto + core + spalle',
    formTip: 'Da plank avambracci, sali su una mano alla volta in posizione di push-up, poi scendi una mano alla volta.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/02/plank.gif', // fallback al plank base
  },
  diveBomber: {
    name: 'Dive bomber (Hindu push-up)',
    icon: '🌊',
    muscle: 'Spalle + petto + flessibilità',
    formTip: 'Da downward dog, "tuffati" in avanti verso il pavimento e risali in cobra. Movimento fluido onda.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/02/Pike-to-Cobra.gif',
  },

  // Hip hinge / posterior chain
  glutebridgeDyn: {
    name: 'Ponte glutei dinamico',
    icon: '🍑',
    muscle: 'Glutei + femorali',
    formTip: 'Sdraiato, ginocchia piegate, spingi pelvi su contraendo glutei in cima per 1 sec, scendi controllato. Niente pause.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/02/Glute-Bridge-.gif',
  },
  singleLegBridge: {
    name: 'Ponte glutei singola gamba',
    icon: '🦵',
    muscle: 'Glutei singolarmente + stabilità',
    formTip: 'Una gamba sollevata, spingi su solo con l\'altro tallone. Glutei alti, blocca lì 1 secondo.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/06/Single-Leg-Bridge.gif',
  },

  // Core dinamico (no plank statico lungo)
  hollowRock: {
    name: 'Hollow hold/rocks',
    icon: '🥥',
    muscle: 'Core profondo',
    formTip: 'Schiena bassa premuta a terra, gambe e braccia tese sollevate. Dondola avanti e indietro mantenendo la "scodella".',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/02/HollowHold.png',
  },
  sitUp: {
    name: 'Sit-up',
    icon: '⬆️',
    muscle: 'Addominali frontali',
    formTip: 'Schiena curvilinea, sali fino a 90° col bacino, scendi controllando senza sbattere a terra.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/02/Sit-ups.gif',
  },
  vUp: {
    name: 'V-up (Jackknife sit-up)',
    icon: 'V',
    muscle: 'Addominali totali',
    formTip: 'Dalla posizione supina, solleva contemporaneamente gambe tese e busto formando una V. Tocca le mani con i piedi.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/02/Jackknife-Sit-ups.gif',
  },
  flutterKick: {
    name: 'Flutter kicks',
    icon: '〰️',
    muscle: 'Addominali bassi',
    formTip: 'Sdraiato, gambe sollevate ~15 cm da terra, alternale su-giù come a nuoto a stile libero.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/02/Flutter-Kicks.gif',
  },

  // Conditioning / cardio integrato
  burpee: {
    name: 'Burpee',
    icon: '🔥',
    muscle: 'Total body + cardio',
    formTip: 'Da in piedi: giù in plank, push-up, salta i piedi sotto, salto in alto. Movimento continuo.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/02/burpees.gif',
  },
  burpeeNoJump: {
    name: 'Burpee senza salto',
    icon: '🔥',
    muscle: 'Total body',
    formTip: 'Stessa sequenza ma senza salto finale: in piedi, mani a terra, piedi indietro, push-up, piedi avanti, sali.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/02/burpees.gif', // stesso pattern visivo
  },
  mountainClimber: {
    name: 'Mountain climber',
    icon: '⛰️',
    muscle: 'Core + cardio + spalle',
    formTip: 'In plank alto, alterna le ginocchia al petto rapidamente. Mantieni il bacino basso.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/02/Mountain-climber.gif',
  },
  bearCrawl: {
    name: 'Bear crawl (avanti+indietro)',
    icon: '🐻',
    muscle: 'Total body + coordinazione',
    formTip: 'A quattro zampe ma ginocchia 1-2 cm da terra. Avanza opposti mano-piede per 3-4 metri, torna indietro.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/02/Bear-Crawl.gif',
  },
  skaterJump: {
    name: 'Skater jumps',
    icon: '⛸️',
    muscle: 'Glutei laterali + esplosività',
    formTip: 'Salta lateralmente da una gamba all\'altra atterrando in mezzo-squat. Slancio con le braccia.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/02/Skater.gif',
  },
  highKnees: {
    name: 'High knees',
    icon: '🏃',
    muscle: 'Cardio + flessori anca',
    formTip: 'Corri sul posto portando le ginocchia all\'altezza dell\'anca. Cadenza alta.',
    gifUrl: 'https://fitnessprogramer.com/wp-content/uploads/2021/08/High-Knee-Run.gif',
  },
};

// SCHEMA PROGRESSIONE: 4 fasi (0=base, 3=avanzato)
// Ogni esercizio specifica le 4 fasi con set/reps/rest
const PROGRESSION = {
  // S1 — Strength
  S1: {
    squat: {
      0: { ex: 'airSquat', sets: 3, reps: 12, restSec: 60 },
      1: { ex: 'airSquat', sets: 3, reps: 18, restSec: 60 },
      2: { ex: 'squatJump', sets: 3, reps: 8, restSec: 75 },
      3: { ex: 'squatJump', sets: 3, reps: 12, restSec: 75 },
    },
    push: {
      0: { ex: 'pushupKnee', sets: 3, reps: 10, restSec: 60 },
      1: { ex: 'pushup', sets: 3, reps: 6, restSec: 60 },
      2: { ex: 'pushup', sets: 3, reps: 10, restSec: 75 },
      3: { ex: 'plankToPushup', sets: 3, reps: 8, restSec: 75 },
    },
    hinge: {
      0: { ex: 'glutebridgeDyn', sets: 3, reps: 12, restSec: 45 },
      1: { ex: 'glutebridgeDyn', sets: 3, reps: 16, restSec: 45 },
      2: { ex: 'singleLegBridge', sets: 3, reps: 8, restSec: 60 },
      3: { ex: 'singleLegBridge', sets: 3, reps: 12, restSec: 60 },
    },
    core: {
      0: { ex: 'hollowRock', sets: 3, reps: 12, restSec: 45 },
      1: { ex: 'hollowRock', sets: 3, reps: 16, restSec: 45 },
      2: { ex: 'vUp', sets: 3, reps: 10, restSec: 60 },
      3: { ex: 'vUp', sets: 3, reps: 14, restSec: 60 },
    },
  },

  // S2 — Conditioning (rest ridotto, esercizi più esplosivi)
  S2: {
    lower: {
      0: { ex: 'reverseLunge', sets: 3, reps: 16, restSec: 45 }, // 8/lato
      1: { ex: 'reverseLunge', sets: 3, reps: 20, restSec: 45 },
      2: { ex: 'jumpingLunge', sets: 3, reps: 16, restSec: 60 },
      3: { ex: 'jumpingLunge', sets: 3, reps: 20, restSec: 60 },
    },
    push: {
      0: { ex: 'pushupKnee', sets: 3, reps: 12, restSec: 45 },
      1: { ex: 'pushup', sets: 3, reps: 8, restSec: 45 },
      2: { ex: 'pushup', sets: 3, reps: 12, restSec: 60 },
      3: { ex: 'plankToPushup', sets: 3, reps: 10, restSec: 60 },
    },
    cardio: {
      0: { ex: 'mountainClimber', sets: 3, reps: 30, restSec: 30 }, // totali
      1: { ex: 'mountainClimber', sets: 3, reps: 40, restSec: 30 },
      2: { ex: 'burpeeNoJump', sets: 3, reps: 8, restSec: 45 },
      3: { ex: 'burpee', sets: 3, reps: 10, restSec: 45 },
    },
    core: {
      0: { ex: 'sitUp', sets: 3, reps: 12, restSec: 45 },
      1: { ex: 'sitUp', sets: 3, reps: 16, restSec: 45 },
      2: { ex: 'flutterKick', sets: 3, reps: 30, restSec: 45 }, // 30 colpi totali
      3: { ex: 'flutterKick', sets: 3, reps: 40, restSec: 45 },
    },
  },

  // S3 — Mix
  S3: {
    lower: {
      0: { ex: 'airSquat', sets: 3, reps: 15, restSec: 60 },
      1: { ex: 'squatJump', sets: 3, reps: 8, restSec: 60 },
      2: { ex: 'skaterJump', sets: 3, reps: 16, restSec: 60 }, // totali
      3: { ex: 'skaterJump', sets: 3, reps: 24, restSec: 60 },
    },
    cardio: {
      0: { ex: 'highKnees', sets: 3, reps: 40, restSec: 30 },
      1: { ex: 'mountainClimber', sets: 3, reps: 30, restSec: 45 },
      2: { ex: 'burpeeNoJump', sets: 3, reps: 6, restSec: 60 },
      3: { ex: 'burpee', sets: 3, reps: 8, restSec: 60 },
    },
    push: {
      0: { ex: 'pushupKnee', sets: 3, reps: 10, restSec: 60 },
      1: { ex: 'pushup', sets: 3, reps: 8, restSec: 60 },
      2: { ex: 'diveBomber', sets: 3, reps: 6, restSec: 60 },
      3: { ex: 'diveBomber', sets: 3, reps: 10, restSec: 60 },
    },
    core: {
      0: { ex: 'hollowRock', sets: 3, reps: 10, restSec: 45 },
      1: { ex: 'vUp', sets: 3, reps: 10, restSec: 45 },
      2: { ex: 'bearCrawl', sets: 3, reps: 4, restSec: 60 }, // 4 "andate" avanti+indietro
      3: { ex: 'bearCrawl', sets: 3, reps: 6, restSec: 60 },
    },
  },
};

// --- Catalogo esposto per le sessioni di forza su misura del coach ----------
/** Elenco compatto degli esercizi disponibili (per far scegliere il coach). */
export function strengthCatalog() {
  return Object.entries(CATALOG).map(([key, v]) => ({ key, name: v.name, muscle: v.muscle }));
}

/** Costruisce un esercizio completo da una chiave del catalogo + parametri. */
export function exerciseFromKey(key, sets, reps, restSec) {
  const ex = CATALOG[key];
  if (!ex) return null;
  return {
    key, name: ex.name, icon: ex.icon, muscle: ex.muscle,
    formTip: ex.formTip, gifUrl: ex.gifUrl,
    sets: Math.max(1, Math.min(6, Math.round(sets) || 3)),
    reps: Math.max(1, Math.min(100, Math.round(reps) || 10)),
    baseReps: Math.max(1, Math.min(100, Math.round(reps) || 10)),
    restSec: Math.max(15, Math.min(180, Math.round(restSec) || 60)),
  };
}

/** Costruisce una sessione di forza su misura da item {exerciseKey,sets,reps,restSec}. */
export function buildCustomStrengthSession(title, focus, items) {
  if (!Array.isArray(items) || !items.length) return null;
  const exercises = items
    .slice(0, 8)
    .map(it => exerciseFromKey(it.exerciseKey, it.sets, it.reps, it.restSec))
    .filter(Boolean);
  if (!exercises.length) return null;
  return {
    id: 'str-custom', title, focus, exercises,
    estimatedMinutes: estimateMinutes(exercises), custom: true,
  };
}

// Mappa livello -> offset di fase
const LEVEL_OFFSET = { beginner: 0, returning: 1, advanced: 2 };

function phaseFromWeek(week, level = 'beginner') {
  const offset = LEVEL_OFFSET[level] ?? 0;
  let phase = 0;
  if (week <= 2) phase = 0;
  else if (week <= 4) phase = 1;
  else if (week <= 6) phase = 2;
  else phase = 3;
  return Math.min(3, phase + offset);
}

function buildBlock(progressionBlock, week, level, repScale = 1) {
  const phase = phaseFromWeek(week, level);
  const cfg = progressionBlock[phase];
  const ex = CATALOG[cfg.ex];
  // repScale = moltiplicatore di intensità adattivo (reps) — vedi recomputeStrengthState
  const reps = Math.max(1, Math.round(cfg.reps * repScale));
  return {
    key: cfg.ex,
    name: ex.name,
    icon: ex.icon,
    muscle: ex.muscle,
    formTip: ex.formTip,
    gifUrl: ex.gifUrl,
    sets: cfg.sets,
    reps,
    baseReps: cfg.reps,   // reps "di listino" della fase, prima dello scaling
    restSec: cfg.restSec,
  };
}

function buildSession(id, title, focus, sessionProgression, week, level, repScale = 1) {
  const exercises = Object.keys(sessionProgression).map(slot =>
    buildBlock(sessionProgression[slot], week, level, repScale)
  );
  return {
    id,
    title,
    focus,
    exercises,
    estimatedMinutes: estimateMinutes(exercises),
    week,
    level,
    repScale,
  };
}

function estimateMinutes(exercises) {
  let secs = 90; // warmup mobility ~1.5 min
  for (const ex of exercises) {
    const workPerSet = ex.reps * 2; // ~2 sec per rep
    secs += ex.sets * workPerSet + (ex.sets - 1) * ex.restSec;
    secs += 30; // transizione
  }
  return Math.max(8, Math.round(secs / 60));
}

// ----------------------------------------------------------------------------
// API PUBBLICA
// ----------------------------------------------------------------------------
export const STRENGTH_TOTAL_WEEKS = 8;

export function buildStrengthSessionS1(week, level = 'beginner', repScale = 1) {
  return buildSession(`strength-w${week}-s1`, 'Forza S1 — Strength',
    'Forza pura, esecuzione controllata', PROGRESSION.S1, week, level, repScale);
}
export function buildStrengthSessionS2(week, level = 'beginner', repScale = 1) {
  return buildSession(`strength-w${week}-s2`, 'Forza S2 — Conditioning',
    'Intensità più alta, rest brevi', PROGRESSION.S2, week, level, repScale);
}
export function buildStrengthSessionS3(week, level = 'beginner', repScale = 1) {
  return buildSession(`strength-w${week}-s3`, 'Forza S3 — Mix dinamico',
    'Esplosività + cardio integrato', PROGRESSION.S3, week, level, repScale);
}

/** Le 3 sessioni della settimana corrente */
export function getStrengthWeekSessions(week, level = 'beginner', repScale = 1) {
  const w = Math.min(Math.max(week, 1), STRENGTH_TOTAL_WEEKS);
  return [
    buildStrengthSessionS1(w, level, repScale),
    buildStrengthSessionS2(w, level, repScale),
    buildStrengthSessionS3(w, level, repScale),
  ];
}

export function strengthWeekTip(week, level = 'beginner') {
  const adj = LEVEL_OFFSET[level];
  const effective = Math.min(8, week + adj * 2);
  const tips = {
    1: 'Riprendi confidenza con i pattern di movimento. Qualità > quantità.',
    2: 'Aggiungi qualche rep se ne hai. La memoria muscolare sta tornando.',
    3: 'Senti le gambe più solide? Bene, l\'esplosività riparte da qui.',
    4: 'Salti e burpee in entrata: rispetta il battito, no fiato a 200.',
    5: 'Settimana dura. Dormi 7+ ore o questa fase NON paga.',
    6: 'Stai recuperando forza pre-detraining. Notalo, è importante.',
    7: 'Volume più alto. Se l\'RPE cresce, riduci a 2 set invece di 3.',
    8: 'Ultima del ciclo. Dopo ricomincia da settimana 5 con varianti più avanzate.',
  };
  return tips[effective] || tips[8];
}

export function nextStrengthWeek(currentWeek, lastFeedback) {
  if (currentWeek >= STRENGTH_TOTAL_WEEKS) return 5; // ricicla dalla 5
  if (lastFeedback) {
    const { rpe = 6, completedSets = 0, totalSets = 12, repRatio = 1 } = lastFeedback;
    const completion = totalSets > 0 ? completedSets / totalSets : 1;
    if (rpe >= 9 || completion < 0.6) return Math.max(1, currentWeek);   // troppo duro → ripeti
    // Salta una settimana (= sale di fase) se è andata troppo facile:
    //   RPE molto basso, OPPURE molte più reps del target con fatica contenuta
    const veryEasy = rpe <= 4 && completion >= 0.95;
    const easyHighReps = repRatio >= 1.35 && rpe <= 6 && completion >= 0.95;
    if (veryEasy || easyHighReps) return Math.min(STRENGTH_TOTAL_WEEKS, currentWeek + 2);
  }
  return currentWeek + 1;
}

// ----------------------------------------------------------------------------
// ADATTAMENTO REPS — rapporto reps effettive/target + replay della progressione
// ----------------------------------------------------------------------------
export const STRENGTH_START_WEEK = 1; // tutti partono da settimana 1 (la fase dipende dal livello)
const REP_SCALE_MIN = 0.7;
const REP_SCALE_MAX = 1.7;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Media del rapporto reps effettive/target su tutte le serie loggate (null se non disponibile). */
export function sessionRepRatio(completedSetsLog) {
  if (!Array.isArray(completedSetsLog) || !completedSetsLog.length) return null;
  const ratios = completedSetsLog
    .filter(s => s && s.targetReps > 0 && s.actualReps != null)
    .map(s => s.actualReps / s.targetReps);
  if (!ratios.length) return null;
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

/** Quanto spostare il moltiplicatore di intensità (reps) in base a una singola sessione. */
function repScaleDelta({ rpe = 6, completion = 1, repRatio = 1 }) {
  if (completion < 0.6) return -0.10;               // mollata a metà → alleggerisci
  if (completion >= 0.85) {
    if (rpe <= 4 && repRatio >= 1.2) return 0.12;   // facilissima + molte reps extra
    if (rpe <= 6 && repRatio >= 1.15) return 0.07;  // comoda + reps sopra target
    if (rpe <= 6 && repRatio >= 1.0) return 0.03;   // gestita bene
    if (rpe >= 9 || repRatio < 0.8) return -0.10;   // durissima o reps crollate
    if (rpe >= 8 || repRatio < 0.9) return -0.05;
  }
  return 0;
}

/**
 * Replay deterministico di TUTTE le sessioni di forza (in ordine cronologico)
 * per ricalcolare lo stato di progressione. Unica fonte di verità: modificare
 * o eliminare una sessione nello storico e ri-eseguire questa funzione riallinea
 * settimana, indice sessione e intensità (repScale).
 *
 * @param {Array} strengthSessions  record di tipo 'strength'
 * @param {string} level            'beginner' | 'returning' | 'advanced'
 * @returns {{strengthWeek:number, strengthSessionIndex:number, strengthRepScale:number}}
 */
export function recomputeStrengthState(strengthSessions, level = 'beginner', startWeek = STRENGTH_START_WEEK) {
  let week = startWeek;
  let idx = 0;            // 0=S1, 1=S2, 2=S3
  let repScale = 1.0;

  const ordered = (strengthSessions || []).slice()
    .sort((a, b) => new Date(a.completedAt || 0) - new Date(b.completedAt || 0));

  for (const s of ordered) {
    const totalSets = s.totalSets || 0;
    const completedSets = s.completedSets || 0;
    const completion = totalSets > 0 ? completedSets / totalSets : 1;
    const repRatio = sessionRepRatio(s.completedSetsLog) ?? 1;
    const rpe = s.rpe ?? 6;

    // 1) Intensità reps (leva fine, ogni sessione)
    repScale = clamp(repScale + repScaleDelta({ rpe, completion, repRatio }), REP_SCALE_MIN, REP_SCALE_MAX);

    // 2) Avanzamento posizione (leva grossa: cambia esercizi/varianti)
    if (idx < 2) {
      idx++;
    } else {
      const prevPhase = phaseFromWeek(week, level);
      week = nextStrengthWeek(week, { rpe, completedSets, totalSets, repRatio });
      idx = 0;
      // Salendo di fase gli esercizi diventano più duri: ritara l'intensità verso 1
      const newPhase = phaseFromWeek(week, level);
      if (newPhase > prevPhase) repScale = clamp(1 + (repScale - 1) * 0.4, REP_SCALE_MIN, REP_SCALE_MAX);
    }
  }

  return {
    strengthWeek: week,
    strengthSessionIndex: idx,
    strengthRepScale: Math.round(repScale * 100) / 100,
  };
}
