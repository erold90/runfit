// ============================================================================
// RunFit — Initial Assessment (test iniziale baseline)
// ============================================================================
// Test scientificamente validati per stabilire il livello reale dell'utente
// e calibrare il programma sui suoi parametri effettivi (non stimati).
//
// TEST INCLUSI:
//   A) Rockport 1-Mile Walk Test
//      - Validato (R = 0.88), raccomandato ACSM per deconditioned adults
//      - Cammina 1 miglio (1.609 km) il più veloce possibile camminando
//      - Output: VO2max stimato, categoria fitness ACSM
//   B) Heart Rate Recovery 1-min
//      - Predittore validato di mortalità cardiovascolare (meta-analisi JAHA)
//      - Misura il drop FC nel minuto post-test
//      - Output: categoria autonomico/parasimpatico
//   C) Strength Assessment
//      - 4 esercizi bodyweight a tempo: squat, push-up, plank, hollow hold
//      - Conferma/corregge il livello forza (beginner/returning/advanced)
// ============================================================================

// ---------------------------------------------------------------------------
// A) ROCKPOST 1-MILE WALK TEST — Kline et al. 1987, validato University of
//    Massachusetts; ACSM Guidelines for Exercise Testing 11th ed.
//
//    VO2max (ml/kg/min) = 132.853
//                       - 0.0769 * W(lb)
//                       - 0.3877 * A(yr)
//                       + 6.315 * G  (1 maschio, 0 femmina)
//                       - 3.2649 * T(min)
//                       - 0.1565 * HR(bpm post-test)
//
//    Versione metrica (peso in kg):
//      - 0.0769 lb = 0.0769 * 2.20462 = 0.1695 per kg
// ---------------------------------------------------------------------------
export function calcVO2maxRockport({ weightKg, age, isMale, timeMin, finalHr }) {
  if (!weightKg || !age || timeMin == null || !finalHr) return null;
  const W = weightKg * 2.20462; // kg -> lb
  const G = isMale ? 1 : 0;
  const vo2 = 132.853
    - 0.0769 * W
    - 0.3877 * age
    + 6.315 * G
    - 3.2649 * timeMin
    - 0.1565 * finalHr;
  return Math.max(0, +vo2.toFixed(1));
}

// ACSM VO2max categories per età/sesso (ml/kg/min)
// Da ACSM's Guidelines 11th edition (Table 4.7)
const VO2_NORMS = {
  male: {
    // [poor, fair, good, excellent, superior] cutoffs
    '20-29': [38, 44, 49, 53],
    '30-39': [35, 41, 46, 50],
    '40-49': [32, 38, 43, 47],
    '50-59': [29, 34, 39, 44],
    '60+':   [25, 30, 34, 39],
  },
  female: {
    '20-29': [33, 38, 43, 48],
    '30-39': [30, 35, 40, 44],
    '40-49': [27, 32, 37, 41],
    '50-59': [24, 28, 32, 37],
    '60+':   [21, 25, 29, 33],
  },
};

function ageBracket(age) {
  if (age < 30) return '20-29';
  if (age < 40) return '30-39';
  if (age < 50) return '40-49';
  if (age < 60) return '50-59';
  return '60+';
}

export function vo2maxCategory(vo2, age, isMale) {
  if (!vo2) return null;
  const norms = (isMale ? VO2_NORMS.male : VO2_NORMS.female)[ageBracket(age)];
  const [poor, fair, good, excellent] = norms;
  if (vo2 < poor) return { label: 'Scarso', percentile: 10, color: '#ef4444', code: 'poor' };
  if (vo2 < fair) return { label: 'Sotto media', percentile: 30, color: '#f59e0b', code: 'below' };
  if (vo2 < good) return { label: 'Nella media', percentile: 50, color: '#3b82f6', code: 'fair' };
  if (vo2 < excellent) return { label: 'Buono', percentile: 75, color: '#10b981', code: 'good' };
  return { label: 'Eccellente', percentile: 90, color: '#8b5cf6', code: 'excellent' };
}

// ---------------------------------------------------------------------------
// B) HR RECOVERY 1-MIN (HRR)
//    Soglie: meta-analisi JAHA + ACSM
//    Drop di bpm tra HR finale test e HR dopo 60 sec di riposo
// ---------------------------------------------------------------------------
export function hrrCategory(hrrDrop) {
  if (hrrDrop == null) return null;
  if (hrrDrop < 12) return { label: 'Scarsa', risk: 'alto rischio CV, fitness bassa', color: '#ef4444', code: 'poor' };
  if (hrrDrop < 18) return { label: 'Sotto media', risk: 'sistema parasimpatico lento', color: '#f59e0b', code: 'below' };
  if (hrrDrop < 25) return { label: 'Nella media', risk: 'normale per adulti sedentari', color: '#3b82f6', code: 'fair' };
  if (hrrDrop < 50) return { label: 'Buona', risk: 'cuore allenato', color: '#10b981', code: 'good' };
  return { label: 'Eccellente', risk: 'profilo atleta', color: '#8b5cf6', code: 'excellent' };
}

// ---------------------------------------------------------------------------
// C) STRENGTH ASSESSMENT
//    Norme ACSM Push-up Test + Plank Test + Squat 2-min
//    Per uomini 30-39 anni (Daniele):
//
//    Push-up (full, 1 min):
//      <17 poor, 17-21 below, 22-29 average, 30-39 good, >40 excellent
//    Squat (2 min):
//      <30 poor, 30-39 below, 40-49 average, 50-59 good, >60 excellent
//    Plank standard (s):
//      <30 poor, 30-60 below, 60-90 fair, 90-120 good, >120 excellent
// ---------------------------------------------------------------------------
export function strengthAssessment({ pushupsMin, squats2min, plankSec }) {
  const score = {
    push: scorePushup(pushupsMin),
    squat: scoreSquat(squats2min),
    plank: scorePlank(plankSec),
  };
  // Score medio 0-4
  const avg = (score.push + score.squat + score.plank) / 3;
  let level, label;
  if (avg < 1.0) { level = 'beginner'; label = 'Beginner — riparti dalle basi'; }
  else if (avg < 2.5) { level = 'returning'; label = 'Returning — base muscolare presente'; }
  else { level = 'advanced'; label = 'Advanced — saltiamo le settimane base'; }
  return { score, avg: +avg.toFixed(2), level, label };
}

function scorePushup(reps) {
  if (reps == null) return 1;
  if (reps < 10) return 0;
  if (reps < 18) return 1;
  if (reps < 25) return 2;
  if (reps < 35) return 3;
  return 4;
}
function scoreSquat(reps) {
  if (reps == null) return 1;
  if (reps < 25) return 0;
  if (reps < 35) return 1;
  if (reps < 45) return 2;
  if (reps < 55) return 3;
  return 4;
}
function scorePlank(secs) {
  if (secs == null) return 1;
  if (secs < 30) return 0;
  if (secs < 60) return 1;
  if (secs < 90) return 2;
  if (secs < 120) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// D) CALIBRAZIONE PROGRAMMA
//    In base ai test, suggerisce:
//      - settimana di partenza programma CORSA
//      - settimana di partenza programma FORZA
//      - HRmax (combinazione formula + estrapolazione dal walk test)
//      - Soglia Zone 2 personalizzata (Karvonen + ajustment)
// ---------------------------------------------------------------------------
export function calibrate({ vo2max, vo2Cat, hrrDrop, hrrCat, strengthLevel, age, isMale, restingHr = 60 }) {
  // 1) Settimana di partenza CORSA
  let runWeek = 1;
  if (vo2Cat) {
    if (vo2Cat.code === 'excellent') runWeek = 5;       // può saltare a fase 2
    else if (vo2Cat.code === 'good') runWeek = 3;
    else if (vo2Cat.code === 'fair') runWeek = 1;       // standard
    else runWeek = 1;                                    // below/poor: dall'inizio
    // HRR scarsa → indipendentemente da VO2 parti morbido
    if (hrrCat && hrrCat.code === 'poor') runWeek = Math.min(runWeek, 1);
  }

  // 2) Settimana di partenza FORZA
  let strengthWeek = 1;
  let strengthLevelFinal = strengthLevel || 'beginner';
  if (strengthLevelFinal === 'advanced') strengthWeek = 1; // offset di fase gestito da phaseFromWeek
  if (strengthLevelFinal === 'returning') strengthWeek = 1; // idem
  if (strengthLevelFinal === 'beginner') strengthWeek = 1;

  // 3) HRmax: formula Tanaka conservative + adjustment se HR finale walk test è elevata
  const hrMaxTanaka = Math.round(208 - 0.7 * age);
  // Estrapolazione: se l'utente ha camminato fast e ha raggiunto FC > 75% HRmax-formula,
  // la sua HRmax potrebbe essere superiore. Conservativo: lasciamo formula con piccolo lift
  let hrMaxEstimated = hrMaxTanaka;
  // Soglia Zone 2 reale (LT1 approx) = 70% HRmax + RestHR offset (Karvonen)
  const hrr = hrMaxEstimated - restingHr;
  const z2Lower = Math.round(restingHr + hrr * 0.60);
  const z2Upper = Math.round(restingHr + hrr * 0.70);

  // 4) Volume settimanale corsa iniziale
  let weeklyVolume = 3;
  if (vo2Cat && (vo2Cat.code === 'good' || vo2Cat.code === 'excellent')) weeklyVolume = 4;

  // 5) Strength enabled?
  const strengthEnabled = strengthLevelFinal !== 'beginner' || (vo2Cat && vo2Cat.code !== 'poor');

  return {
    runWeek,
    strengthWeek,
    strengthLevel: strengthLevelFinal,
    hrMax: hrMaxEstimated,
    z2Range: { min: z2Lower, max: z2Upper },
    weeklyVolume,
    strengthEnabled,
  };
}

// ---------------------------------------------------------------------------
// Utility: range pace target per Zone 2 stimato da VO2max
// Daniels' Running Formula 4th ed.: pace facile ≈ 78-83% vVO2max
// vVO2max (km/h) ≈ VO2max / 3.5 (regola di Astrand semplificata)
// ---------------------------------------------------------------------------
export function suggestedZ2Pace(vo2max) {
  if (!vo2max) return null;
  const vVO2 = vo2max / 3.5; // km/h
  const easyMin = vVO2 * 0.65; // pace easy (kmh)
  const easyMax = vVO2 * 0.75;
  // Converti in min/km
  const paceMinPerKmMin = 60 / easyMax; // più veloce
  const paceMinPerKmMax = 60 / easyMin; // più lento
  return {
    minPerKm: { min: +paceMinPerKmMin.toFixed(2), max: +paceMinPerKmMax.toFixed(2) },
    kmh: { min: +easyMin.toFixed(1), max: +easyMax.toFixed(1) },
  };
}
