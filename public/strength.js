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

function buildBlock(progressionBlock, week, level) {
  const phase = phaseFromWeek(week, level);
  const cfg = progressionBlock[phase];
  const ex = CATALOG[cfg.ex];
  return {
    key: cfg.ex,
    name: ex.name,
    icon: ex.icon,
    muscle: ex.muscle,
    formTip: ex.formTip,
    gifUrl: ex.gifUrl,
    sets: cfg.sets,
    reps: cfg.reps,
    restSec: cfg.restSec,
  };
}

function buildSession(id, title, focus, sessionProgression, week, level) {
  const exercises = Object.keys(sessionProgression).map(slot =>
    buildBlock(sessionProgression[slot], week, level)
  );
  return {
    id,
    title,
    focus,
    exercises,
    estimatedMinutes: estimateMinutes(exercises),
    week,
    level,
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

export function buildStrengthSessionS1(week, level = 'beginner') {
  return buildSession(`strength-w${week}-s1`, 'Forza S1 — Strength',
    'Forza pura, esecuzione controllata', PROGRESSION.S1, week, level);
}
export function buildStrengthSessionS2(week, level = 'beginner') {
  return buildSession(`strength-w${week}-s2`, 'Forza S2 — Conditioning',
    'Intensità più alta, rest brevi', PROGRESSION.S2, week, level);
}
export function buildStrengthSessionS3(week, level = 'beginner') {
  return buildSession(`strength-w${week}-s3`, 'Forza S3 — Mix dinamico',
    'Esplosività + cardio integrato', PROGRESSION.S3, week, level);
}

/** Le 3 sessioni della settimana corrente */
export function getStrengthWeekSessions(week, level = 'beginner') {
  const w = Math.min(Math.max(week, 1), STRENGTH_TOTAL_WEEKS);
  return [
    buildStrengthSessionS1(w, level),
    buildStrengthSessionS2(w, level),
    buildStrengthSessionS3(w, level),
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
    const { rpe = 6, completedSets = 0, totalSets = 12 } = lastFeedback;
    const completion = totalSets > 0 ? completedSets / totalSets : 1;
    if (rpe >= 9 || completion < 0.6) return Math.max(1, currentWeek);
    if (rpe <= 4 && completion >= 0.95) return Math.min(STRENGTH_TOTAL_WEEKS, currentWeek + 2);
  }
  return currentWeek + 1;
}
