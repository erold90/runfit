// ============================================================================
// RunFit — App principale
// ============================================================================

import {
  PROGRAM, calcZones, calcHrMax, kcalKeytel, kcalFromMET,
  nextWeekIndex, getWeekSessions, evaluateVolumeChange,
} from './program.js';
import {
  getProfile, saveProfile,
  getProgress, saveProgress,
  getSessions, saveSession, deleteSession, updateSession,
  getWeights, addWeight,
  getSettings, saveSettings,
  getAssessment, saveAssessment,
  exportAllJson, importAllJson,
  cloudPush, cloudPull,
  coachContext,
} from './storage.js';
import {
  calcVO2maxRockport, vo2maxCategory,
  hrrCategory, strengthAssessment,
  calibrate, suggestedZ2Pace,
} from './assessment.js';
import { SessionRunner, StrengthRunner, speak, loadVoices } from './coach.js';
import {
  getStrengthWeekSessions, strengthWeekTip,
  STRENGTH_TOTAL_WEEKS, recomputeStrengthState, sessionRepRatio,
  strengthCatalog, buildCustomStrengthSession,
} from './strength.js';

// --- DOM helpers -----------------------------------------------------------
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
};

const fmtTime = s => {
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
};

const fmtDate = iso => {
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtDateShort = iso => {
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
};

// --- State -----------------------------------------------------------------
let currentRunner = null;
let currentStrength = null;
let currentView = 'home';
let statsMode = 'run';   // Stats: 'run' (corsa) | 'strength' (forza)
let lastRenderDay = null; // giorno (toDateString) dell'ultimo render: per auto-aggiornare a mezzanotte

// --- Profile helpers -------------------------------------------------------
function getAge() {
  const p = getProfile();
  return new Date().getFullYear() - p.birthYear;
}

function getHrMax() {
  const p = getProfile();
  return p.hrMaxOverride || calcHrMax(getAge());
}

function getZones() {
  const p = getProfile();
  return calcZones(getAge(), p.restingHr);
}

function zoneRangeForType(phaseType) {
  const z = getZones();
  const map = {
    warmup: z.z1, walk: z.z1, brisk: z.z2, jog: z.z3, run: z.z4, cooldown: z.z1,
  };
  return map[phaseType] || z.z2;
}

// --- Tabs / Router ---------------------------------------------------------
function setView(name) {
  currentView = name;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
  // FAB Coach: visibile solo se attivo e non già in chat / sessione attiva
  const fab = document.getElementById('coach-fab');
  if (fab) {
    const show = (getSettings().coachEnabled === true) && ['home', 'history', 'stats'].includes(name);
    fab.hidden = !show;
  }
  // In chat nascondi la tabbar (la vista usa tutto lo schermo)
  document.body.classList.toggle('coach-active', name === 'coach');
  const renderer = {
    home: renderHome,
    workout: renderWorkout,
    history: renderHistory,
    stats: renderStats,
    profile: renderProfile,
    coach: renderCoachChat,
  }[name];
  if (renderer) renderer();
  lastRenderDay = new Date().toDateString();
}

// --- View: Home ------------------------------------------------------------
function renderHome() {
  const container = $('#view-home');
  container.innerHTML = '';

  const progress = getProgress();
  const week = PROGRAM[progress.currentWeek - 1];
  const weeklyVolume = progress.weeklyVolume || 3;
  const weekSessions = getWeekSessions(progress.currentWeek, weeklyVolume);
  // Se l'indice è oltre il volume corrente (es. dopo un deload), riporta a 0
  if (progress.currentSessionIndex >= weekSessions.length) {
    progress.currentSessionIndex = 0;
    saveProgress(progress);
  }
  // Sessione di corsa: usa la versione su misura del coach se presente
  const session = progress.customRunSession || weekSessions[progress.currentSessionIndex];
  const sessions = getSessions();
  const weights = getWeights();
  const profile = getProfile();
  const guidedPlanOn = getSettings().guidedPlan !== false;
  // Sessioni completate OGGI (giorno locale) — per una Home consapevole
  const sameLocalDay = (iso) => {
    if (!iso) return false;
    const d = new Date(iso), n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  };
  const sessionsToday = sessions.filter(s => sameLocalDay(s.completedAt));

  // Streak: giorni consecutivi (i riposi pianificati fanno da ponte)
  const streak = computeStreak(sessions, getSettings().restDays || [0]);
  const totalSessions = sessions.length;
  const totalSeconds = sessions.reduce((s, x) => s + (x.durationSec || 0), 0);
  const totalKcal = sessions.reduce((s, x) => s + (x.kcal || 0), 0);
  const totalKm = sessions.reduce((s, x) => s + (x.km || 0), 0);

  // Greeting
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Buongiorno' : hour < 19 ? 'Buon pomeriggio' : 'Buonasera';

  container.appendChild(el('div', { class: 'hero' },
    el('div', { class: 'hero-greet' }, `${greet}, ${profile.name}.`),
    el('div', { class: 'hero-title' }, week.title),
    el('div', { class: 'hero-desc' }, week.description),
    el('div', { class: 'hero-milestone' },
      el('span', { class: 'milestone-label' }, 'Obiettivo settimana'),
      el('span', { class: 'milestone-value' }, week.milestone),
    ),
  ));

  // Card "Oggi" — piano del giorno (alterna corsa/forza, rispetta i giorni di riposo)
  const settings = getSettings();
  if (guidedPlanOn) {
    container.appendChild(buildTodayCard(progress, profile, session, sessionsToday));
  }

  // Banner Test Iniziale (se non ancora fatto)
  const assessment = getAssessment();
  if (!assessment.done) {
    container.appendChild(el('div', { class: 'card assessment-banner', onclick: () => startAssessmentWizard() },
      el('div', { class: 'assessment-banner-icon' }, '🏁'),
      el('div', { class: 'assessment-banner-content' },
        el('div', { class: 'assessment-banner-title' }, 'Test iniziale — calibra l\'app sui tuoi dati reali'),
        el('div', { class: 'assessment-banner-desc' }, 'Walk test + strength test in 30 minuti. L\'app userà i risultati per personalizzare zone HR, settimana di partenza e volume.'),
      ),
      el('div', { class: 'assessment-banner-arrow' }, '→'),
    ));
  }

  // Card prossima sessione (solo modalità libera — in guidata guida la card "Oggi")
  const sessionLetter = ['A', 'B', 'C', 'D', 'E'][progress.currentSessionIndex] || '?';
  if (!guidedPlanOn) {
  const next = el('div', { class: 'card session-next' },
    el('div', { class: 'card-label' }, `Prossima sessione · ${sessionLetter} · ${progress.currentSessionIndex + 1}/${weeklyVolume} della settimana`),
    el('div', { class: 'card-title' }, session.title),
    el('div', { class: 'card-meta' },
      el('span', {}, `${Math.round(session.totalSeconds / 60)} min`),
      el('span', { class: 'dot' }, '·'),
      el('span', {}, session.focus),
    ),
    el('div', { class: 'card-actions' },
      el('button', {
        class: 'btn btn-primary',
        onclick: () => startSession(session),
      }, 'Inizia sessione'),
      el('button', {
        class: 'btn btn-ghost',
        onclick: () => showSessionPreview(session),
      }, 'Anteprima'),
    ),
  );
  container.appendChild(next);
  }

  // KPI grid
  const kpi = el('div', { class: 'kpi-grid' },
    kpiCard('Streak', `${streak} ${streak === 1 ? 'giorno' : 'giorni'}`, '🔥'),
    kpiCard('Sessioni', totalSessions, '✓'),
    kpiCard('Tempo totale', fmtMinutes(totalSeconds), '⏱'),
    kpiCard('Calorie totali', `${totalKcal.toLocaleString('it-IT')} kcal`, '🔋'),
  );
  container.appendChild(kpi);

  // Peso
  if (weights.length > 0) {
    const first = weights[0].kg;
    const last = weights[weights.length - 1].kg;
    const delta = (last - first).toFixed(1);
    const target = profile.weightTargetKg;
    const remaining = (last - target).toFixed(1);
    container.appendChild(el('div', { class: 'card weight-card' },
      el('div', { class: 'card-label' }, 'Andamento peso'),
      el('div', { class: 'weight-row' },
        el('div', { class: 'weight-current' }, `${last} kg`),
        el('div', { class: `weight-delta ${delta <= 0 ? 'positive' : 'negative'}` },
          `${delta > 0 ? '+' : ''}${delta} kg`),
      ),
      el('div', { class: 'weight-meta' },
        remaining > 0
          ? `Mancano ${remaining} kg al target di ${target} kg`
          : `🎯 Target raggiunto! (${target} kg)`,
      ),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: showWeightModal }, 'Aggiungi pesata'),
    ));
  } else {
    container.appendChild(el('div', { class: 'card empty-card' },
      el('div', {}, 'Registra il tuo peso per tracciare il dimagrimento.'),
      el('button', { class: 'btn btn-primary btn-sm', onclick: showWeightModal }, 'Aggiungi prima pesata'),
    ));
  }

  // Card FORZA (solo modalità libera — in guidata la card "Oggi" gestisce tutto)
  if (profile.strengthEnabled !== false && !guidedPlanOn) {
    const sLevel = profile.strengthLevel || 'returning';
    const sWeek = progress.strengthWeek || 1;
    const sIdx = progress.strengthSessionIndex || 0;
    const sScale = progress.strengthRepScale || 1;
    const strengthSessions = getStrengthWeekSessions(sWeek, sLevel, sScale);
    const sSession = progress.customStrengthSession || strengthSessions[sIdx];
    const sLetter = progress.customStrengthSession ? 'su misura' : ['S1', 'S2', 'S3'][sIdx];

    container.appendChild(el('div', { class: 'card strength-card' },
      el('div', { class: 'card-label strength-label' }, `💪 Forza · ${sLetter} · ${sIdx + 1}/3 della settimana`),
      el('div', { class: 'card-title' }, sSession.title),
      el('div', { class: 'card-meta' },
        el('span', {}, `~${sSession.estimatedMinutes} min`),
        el('span', { class: 'dot' }, '·'),
        el('span', {}, sSession.focus),
        el('span', { class: 'dot' }, '·'),
        el('span', {}, `Settimana ${sWeek}/${STRENGTH_TOTAL_WEEKS}`),
      ),
      el('div', { class: 'strength-tip' }, strengthWeekTip(sWeek, sLevel)),
      el('div', { class: 'card-actions' },
        el('button', {
          class: 'btn btn-strength',
          onclick: () => startStrengthSession(sSession),
        }, 'Inizia forza'),
        el('button', {
          class: 'btn btn-ghost',
          onclick: () => showStrengthPreview(sSession),
        }, 'Anteprima'),
      ),
      // Chip selettore S1/S2/S3
      el('div', { class: 'chip-row strength-chips' },
        ...strengthSessions.map((s, i) => el('button', {
          class: `chip ${i === sIdx ? 'chip-active chip-strength' : ''}`,
          onclick: () => {
            const pr = getProgress();
            pr.strengthSessionIndex = i;
            saveProgress(pr);
            renderHome();
          },
        }, `${['S1','S2','S3'][i]} · ${s.estimatedMinutes}'`)),
      ),
    ));
  }

  // Card volume settimanale + adattamento (solo modalità libera)
  if (!guidedPlanOn) {
  container.appendChild(el('div', { class: 'card volume-card' },
    el('div', { class: 'card-label' }, 'Volume settimanale'),
    el('div', { class: 'volume-row' },
      el('div', { class: 'volume-value' }, `${weeklyVolume}`),
      el('div', { class: 'volume-label' }, `sessioni / settimana`),
    ),
    el('div', { class: 'volume-help' }, volumeHelpText(weeklyVolume, progress.currentWeek)),
    el('div', { class: 'volume-progress' },
      ...[3, 4, 5].map(lvl => el('div', {
        class: `volume-step ${weeklyVolume >= lvl ? 'reached' : ''} ${weeklyVolume === lvl ? 'current' : ''}`,
      }, `${lvl}`)),
    ),
  ));

  // Selettore sessione settimana (chip) — include sessione D ed E se sbloccate
  container.appendChild(el('div', { class: 'card week-sessions' },
    el('div', { class: 'card-label' }, `Tutte le sessioni — ${week.title.replace(/ — .+/, '')}`),
    el('div', { class: 'chip-row' },
      ...weekSessions.map((s, i) => el('button', {
        class: `chip ${i === progress.currentSessionIndex ? 'chip-active' : ''}`,
        onclick: () => {
          const pr = getProgress();
          pr.currentSessionIndex = i;
          saveProgress(pr);
          renderHome();
        },
      }, `${['A', 'B', 'C', 'D', 'E'][i]} · ${Math.round(s.totalSeconds / 60)}'`)),
    ),
  ));
  }
}

// --- Piano del giorno -------------------------------------------------------
const DOW_FULL = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const DOW_SHORT = { 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Gio', 5: 'Ven', 6: 'Sab', 0: 'Dom' };
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // settimana all'italiana: Lun → Dom

// Decide cosa "tocca" oggi: riposo, oppure corsa/forza alternati tra i giorni attivi.
function getTodayPlan(settings, strengthEnabled) {
  const restDays = settings.restDays || [0];
  const dow = new Date().getDay();
  const label = DOW_FULL[dow];
  if (restDays.includes(dow)) return { type: 'rest', dow, label };
  if (!strengthEnabled) return { type: 'run', dow, label };
  const activeDays = DOW_ORDER.filter(d => !restDays.includes(d));
  const idx = activeDays.indexOf(dow);
  // 1° giorno attivo della settimana = corsa, poi alterna corsa/forza
  return { type: idx % 2 === 0 ? 'run' : 'strength', dow, label };
}

// Prossimo giorno di ALLENAMENTO (salta i riposi), a partire da domani.
// Stessa logica di alternanza di getTodayPlan, ma proiettata in avanti.
function getNextTrainingDay(settings, strengthEnabled, fromOffset = 1) {
  const restDays = settings.restDays || [0];
  const activeDays = DOW_ORDER.filter(d => !restDays.includes(d));
  const today = new Date();
  for (let i = fromOffset; i <= 8; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const dow = d.getDay();
    if (restDays.includes(dow)) continue;
    const type = !strengthEnabled ? 'run' : (activeDays.indexOf(dow) % 2 === 0 ? 'run' : 'strength');
    return { type, dow, dayOffset: i, label: i === 1 ? 'Domani' : DOW_FULL[dow] };
  }
  return null;
}

// Card-anteprima della prossima sessione (giorno + dettagli), per la Home "fatto".
function nextSessionPreview(progress, profile, runSession) {
  const settings = getSettings();
  const strengthEnabled = profile.strengthEnabled !== false;
  const next = getNextTrainingDay(settings, strengthEnabled);
  if (!next) return null;

  if (next.type === 'run') {
    return el('div', { class: 'today-next' },
      el('div', { class: 'today-next-label' }, `${next.label} · 🏃 Corsa`),
      el('div', { class: 'today-next-title' }, runSession.title),
      el('div', { class: 'today-next-desc' }, `${Math.round(runSession.totalSeconds / 60)} min · ${runSession.focus}`),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => showSessionPreview(runSession) }, 'Vedi dettagli'),
    );
  }
  const sIdx = progress.strengthSessionIndex || 0;
  const custom = progress.customStrengthSession;
  const str = custom || getStrengthWeekSessions(progress.strengthWeek || 1, profile.strengthLevel || 'returning', progress.strengthRepScale || 1)[sIdx];
  return el('div', { class: 'today-next' },
    el('div', { class: 'today-next-label' }, `${next.label} · 💪 Forza${custom ? ' · su misura' : ''}`),
    el('div', { class: 'today-next-title' }, str.title),
    el('div', { class: 'today-next-desc' }, `~${str.estimatedMinutes} min · ${str.focus}`),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => showStrengthPreview(str) }, 'Vedi dettagli'),
  );
}

function buildTodayCard(progress, profile, runSession, sessionsToday = []) {
  const settings = getSettings();
  const strengthEnabled = profile.strengthEnabled !== false;
  const plan = getTodayPlan(settings, strengthEnabled);
  const doneToday = sessionsToday || [];

  // Riga riepilogo di una sessione fatta oggi
  const doneLine = (s) => el('div', { class: 'today-done-line' },
    el('span', { class: 'today-done-ic' }, s.type === 'strength' ? '💪' : '🏃'),
    el('span', {}, `${s.title} · ${s.durationMin || Math.round((s.durationSec || 0) / 60)} min` +
      `${s.rpe ? ' · RPE ' + s.rpe : ''}${s.km ? ' · ' + s.km + ' km' : ''}`),
  );

  // Pulsanti "allena ancora" (avvio libero delle due modalità)
  const trainMoreButtons = () => {
    const btns = [el('button', { class: 'btn btn-ghost btn-sm', onclick: () => startSession(runSession) }, '🏃 Corsa')];
    if (strengthEnabled) {
      const sIdx = progress.strengthSessionIndex || 0;
      const sSession = progress.customStrengthSession || getStrengthWeekSessions(progress.strengthWeek || 1, profile.strengthLevel || 'returning', progress.strengthRepScale || 1)[sIdx];
      btns.push(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => startStrengthSession(sSession) }, '💪 Forza'));
    }
    return btns;
  };

  // --- CASO 1: già allenato oggi → card "fatto", niente pressione ---
  if (doneToday.length) {
    return el('div', { class: 'card today-card today-done' },
      el('div', { class: 'today-head' },
        el('span', { class: 'today-icon' }, '✅'),
        el('div', {},
          el('div', { class: 'today-label' }, `Oggi · ${plan.label}`),
          el('div', { class: 'today-title' }, doneToday.length > 1 ? 'Allenamenti di oggi fatti' : 'Allenamento di oggi fatto'),
        ),
      ),
      el('div', { class: 'today-done-list' }, ...doneToday.map(doneLine)),
      el('div', { class: 'today-desc' }, plan.type === 'rest'
        ? 'Oggi era riposo e ti sei mosso comunque. Ascolta il recupero.'
        : 'Bel lavoro. Ora recupera: è lì che arrivano i risultati.'),
      nextSessionPreview(progress, profile, runSession),
      el('div', { class: 'today-more' },
        el('span', { class: 'today-more-label' }, 'Vuoi fare altro?'),
        el('div', { class: 'card-actions' }, ...trainMoreButtons()),
      ),
    );
  }

  // --- CASO 2: riposo e non allenato ---
  if (plan.type === 'rest') {
    return el('div', { class: 'card today-card today-rest' },
      el('div', { class: 'today-head' },
        el('span', { class: 'today-icon' }, '🛌'),
        el('div', {},
          el('div', { class: 'today-label' }, `Oggi · ${plan.label}`),
          el('div', { class: 'today-title' }, 'Riposo'),
        ),
      ),
      el('div', { class: 'today-desc' },
        'È nel recupero che arrivano i risultati. Recupero attivo permesso: una camminata leggera va benissimo, ma niente corsa né forza.'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => setView('profile') }, 'Cambia giorni di riposo'),
    );
  }

  // --- CASO 3: forza da fare ---
  if (plan.type === 'strength') {
    const sIdx = progress.strengthSessionIndex || 0;
    const customStr = progress.customStrengthSession;
    // Onora la sessione su misura del coach, come fa la corsa (riga ~134) e il
    // coach stesso (buildCoachContext): così card, anteprima e coach concordano.
    const sSession = customStr || getStrengthWeekSessions(progress.strengthWeek || 1, profile.strengthLevel || 'returning', progress.strengthRepScale || 1)[sIdx];
    const sessLabel = customStr ? 'su misura' : ['S1', 'S2', 'S3'][sIdx];
    return el('div', { class: 'card today-card today-strength' },
      el('div', { class: 'today-head' },
        el('span', { class: 'today-icon' }, '💪'),
        el('div', {},
          el('div', { class: 'today-label' }, `Oggi · ${plan.label} — tocca FORZA`),
          el('div', { class: 'today-title' }, sSession.title),
        ),
      ),
      el('div', { class: 'today-desc' }, `~${sSession.estimatedMinutes} min · ${sSession.focus} · ${sessLabel}`),
      customStr ? el('div', { class: 'today-custom-note' },
        el('span', {}, '🤖 Su misura per te, scelta dal coach'),
      ) : null,
      el('div', { class: 'card-actions' },
        el('button', { class: 'btn btn-strength', onclick: () => startStrengthSession(sSession) }, 'Inizia forza'),
        el('button', { class: 'btn btn-ghost', onclick: () => showStrengthPreview(sSession) }, 'Anteprima'),
      ),
    );
  }

  // --- CASO 4: corsa da fare ---
  const letter = ['A', 'B', 'C', 'D', 'E'][progress.currentSessionIndex] || '?';
  return el('div', { class: 'card today-card today-run' },
    el('div', { class: 'today-head' },
      el('span', { class: 'today-icon' }, '🏃'),
      el('div', {},
        el('div', { class: 'today-label' }, `Oggi · ${plan.label} — tocca CORSA`),
        el('div', { class: 'today-title' }, runSession.title),
      ),
    ),
    el('div', { class: 'today-desc' }, `${Math.round(runSession.totalSeconds / 60)} min · ${runSession.focus} · ${letter}`),
    el('div', { class: 'card-actions' },
      el('button', { class: 'btn btn-primary', onclick: () => startSession(runSession) }, 'Inizia sessione'),
      el('button', { class: 'btn btn-ghost', onclick: () => showSessionPreview(runSession) }, 'Anteprima'),
    ),
  );
}

function volumeHelpText(volume, week) {
  if (volume === 3) {
    if (week < 5) return `Default per principianti. Dalla settimana 5, se i tuoi RPE saranno ≤ 5.5 con sessioni complete, l'app passerà a 4 sessioni/settimana.`;
    return `Sei pronto per il salto: continua a inserire FC media e RPE — quando i dati saranno costantemente buoni, sblocchi la 4ª sessione (Long Zone 2).`;
  }
  if (volume === 4) {
    if (week < 8) return `4 sessioni sbloccate: la D è una Long Zone 2 per max ossidazione grassi. Dalla settimana 8, se RPE medio ≤ 6, sblocchi la 5ª.`;
    return `Continua così: quando i dati confermeranno che gestisci 4 sessioni senza fatica, sblocchi la 5ª (Easy Recovery).`;
  }
  return `Volume massimo: 5 sessioni/settimana. L'app continua a monitorare i tuoi dati: se accumuli affaticamento, scenderà automaticamente a 4 per farti recuperare.`;
}

function kpiCard(label, value, icon) {
  return el('div', { class: 'kpi' },
    el('div', { class: 'kpi-icon' }, icon),
    el('div', { class: 'kpi-value' }, String(value)),
    el('div', { class: 'kpi-label' }, label),
  );
}

// --- Icone SVG (sostituiscono le emoji: coerenti, scalabili, leggibili) -----
const STAT_ICONS = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/>',
  flame: '<path d="M12 3c.8 2.8 3.5 3.9 3.5 7.5a3.5 3.5 0 0 1-7 0c0-1 .4-1.9.9-2.5.4 1 .9 1.4 1.6 1.6C10.5 8 11 5.2 12 3Z"/>',
  ruler: '<path d="M4 8.5 8.5 4 20 15.5 15.5 20Z"/><path d="m8 9 1.5 1.5M10.5 6.5 12 8M11 12l1.5 1.5M13.5 9.5 15 11"/>',
  gauge: '<path d="M12 13.5a1.8 1.8 0 0 0 1.5-2.9L12 8.5"/><path d="M5 18a8 8 0 1 1 14 0"/>',
  heart: '<path d="M12 20s-7-4.6-7-10a3.8 3.8 0 0 1 7-2 3.8 3.8 0 0 1 7 2c0 5.4-7 10-7 10Z"/>',
  scale: '<path d="M12 4v16M7 8h10"/><path d="M7 8 4 14a3 3 0 0 0 6 0Z"/><path d="M17 8l-3 6a3 3 0 0 0 6 0Z"/>',
  zap: '<path d="M13 3 5 13h6l-1 8 8-10h-6Z"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowRight: '<path d="M5 12h14"/>',
};

function svgIcon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = STAT_ICONS[name] || '';
  return svg;
}

// KPI con icona SVG (al posto delle emoji)
function statKpi(label, value, iconName) {
  return el('div', { class: 'kpi' },
    el('div', { class: 'kpi-icon' }, svgIcon(iconName, 22)),
    el('div', { class: 'kpi-value' }, String(value)),
    el('div', { class: 'kpi-label' }, label),
  );
}

// Confronta la media della prima metà con quella della seconda metà di una serie
function halfTrend(values) {
  if (!values || values.length < 2) return null;
  const mid = Math.floor(values.length / 2);
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
  const older = avg(values.slice(0, mid || 1));
  const newer = avg(values.slice(mid));
  return { delta: newer - older, older, newer };
}

// Blocco "stat" usato quando i dati sono troppo pochi per un grafico sensato
function bigStat(label, value, hint) {
  return el('div', { class: 'card stat-block' },
    el('div', { class: 'card-label' }, label),
    el('div', { class: 'stat-big' }, value),
    hint ? el('div', { class: 'chart-hint' }, hint) : null,
  );
}

function fmtMinutes(seconds) {
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Streak = giorni di allenamento consecutivi. I giorni di RIPOSO pianificato
// (restDays) fanno da "ponte": non incrementano ma non rompono la catena, così
// riposare quando previsto non penalizza la costanza.
function computeStreak(sessions, restDays = [0]) {
  if (!sessions.length) return 0;
  const trained = new Set(sessions.map(s => new Date(s.completedAt).toDateString()));
  const isTrained = d => trained.has(d.toDateString());
  const isRest = d => restDays.includes(d.getDay());

  const day = new Date();
  day.setHours(0, 0, 0, 0);
  // Se oggi non è ancora allenato e non è un giorno di riposo, parti da ieri
  // (non rompere la catena prima di poterti allenare nel corso della giornata)
  if (!isTrained(day) && !isRest(day)) day.setDate(day.getDate() - 1);

  let streak = 0;
  for (let i = 0; i < 400; i++) {
    if (isTrained(day)) streak++;
    else if (!isRest(day)) break; // giorno feriale saltato → catena interrotta
    // se è riposo pianificato: ponte, continua senza incrementare
    day.setDate(day.getDate() - 1);
  }
  return streak;
}

// --- View: Workout (sessione attiva) --------------------------------------
function showSessionPreview(session) {
  const modal = $('#modal');
  modal.innerHTML = '';
  modal.classList.add('open');
  modal.appendChild(el('div', { class: 'modal-content' },
    el('div', { class: 'modal-header' },
      el('h2', {}, session.title),
      el('button', { class: 'icon-btn', onclick: () => modal.classList.remove('open') }, '×'),
    ),
    el('div', { class: 'modal-body' },
      el('div', { class: 'session-focus' }, session.focus),
      (getSettings().outAndBack === true ? (() => {
        const t = new SessionRunner(session, { outAndBack: true }).turnaroundSec;
        return t ? el('div', { class: 'preview-turn-hint' },
          `🔄 Andata/ritorno attivo: ti avviserò a ~${fmtTime(t)} di invertire, così finisci dove sei partito.`) : null;
      })() : null),
      el('div', { class: 'phases-list' },
        ...session.phases.map((p, i) => el('div', { class: `phase-item phase-${p.type}` },
          el('div', { class: 'phase-num' }, String(i + 1)),
          el('div', { class: 'phase-info' },
            el('div', { class: 'phase-name' }, phaseTypeLabel(p.type)),
            el('div', { class: 'phase-cue' }, p.cue || ''),
          ),
          el('div', { class: 'phase-time' }, fmtTime(p.seconds)),
        )),
      ),
      el('button', {
        class: 'btn btn-primary btn-block',
        onclick: () => { modal.classList.remove('open'); startSession(session); },
      }, 'Inizia ora'),
    ),
  ));
}

function phaseTypeLabel(type) {
  return {
    warmup: 'Riscaldamento',
    walk: 'Camminata',
    brisk: 'Passo veloce',
    jog: 'Corsa leggera',
    run: 'Corsa sostenuta',
    cooldown: 'Defaticamento',
    rest: 'Riposo',
  }[type] || type;
}

function startSession(session) {
  setView('workout');
  document.body.classList.add('session-active');
  // Sblocca audio (richiesto da iOS dopo gesto utente)
  speak('Pronti?');
  currentRunner = new SessionRunner(session, { outAndBack: getSettings().outAndBack === true });
  renderActiveSession(session);
  currentRunner.start();
}

function renderActiveSession(session) {
  const container = $('#view-workout');
  container.innerHTML = '';

  const phaseLabel = el('div', { class: 'phase-label' }, phaseTypeLabel(session.phases[0].type));
  const phaseCue   = el('div', { class: 'phase-cue-big' }, session.phases[0].cue || '');
  const timerBig   = el('div', { class: 'timer-big' }, fmtTime(session.phases[0].seconds));
  const phaseProgress = el('div', { class: 'phase-progress' });
  const phaseProgressBar = el('div', { class: 'phase-progress-bar' });
  phaseProgress.appendChild(phaseProgressBar);

  const totalProgress = el('div', { class: 'total-progress' });
  const totalProgressBar = el('div', { class: 'total-progress-bar' });
  totalProgress.appendChild(totalProgressBar);

  const totalInfo = el('div', { class: 'total-info' },
    el('span', { class: 'total-elapsed' }, '0:00'),
    el('span', {}, ' / '),
    el('span', {}, fmtTime(session.totalSeconds)),
  );

  const nextPhase = el('div', { class: 'next-phase' },
    session.phases[1] ? `Dopo: ${phaseTypeLabel(session.phases[1].type)} · ${fmtTime(session.phases[1].seconds)}` : 'Ultima fase!',
  );

  const zoneInfo = el('div', { class: 'zone-info' });
  updateZoneInfo(zoneInfo, session.phases[0].type);

  // Banner "torna indietro" (modalità andata/ritorno)
  const turnBanner = el('div', { class: 'turn-banner' }, '🔄 Torna indietro — verso casa');
  turnBanner.style.display = 'none';

  // Controlli — pulsante Pausa centrale grande, laterali più piccoli
  const btnPause = el('button', { class: 'btn btn-primary btn-control' }, '⏸ Pausa');
  const btnSkip = el('button', { class: 'btn btn-ghost btn-control', onclick: () => currentRunner.skipPhase() }, '⏭');
  const btnStop = el('button', { class: 'btn btn-ghost btn-control btn-danger', onclick: confirmStop }, '✕');

  btnPause.addEventListener('click', () => {
    currentRunner.toggle();
    btnPause.textContent = currentRunner.running ? '⏸ Pausa' : '▶ Riprendi';
  });

  container.appendChild(el('div', { class: 'workout-screen' },
    el('div', { class: 'workout-header' },
      el('div', { class: 'session-title-small' }, session.title),
      el('div', { class: 'session-focus-small' }, session.focus),
    ),
    el('div', { class: `phase-display phase-${session.phases[0].type}`, id: 'phaseDisplay' },
      phaseLabel,
      timerBig,
      phaseProgress,
      phaseCue,
      zoneInfo,
    ),
    turnBanner,
    nextPhase,
    totalProgress,
    totalInfo,
    el('div', { class: 'controls' }, btnSkip, btnPause, btnStop),
    el('div', { class: 'controls-legend' },
      el('span', {}, 'Salta'),
      el('span', {}, 'Pausa/Riprendi'),
      el('span', {}, 'Termina'),
    ),
  ));

  // Listener
  currentRunner.addEventListener('tick', e => {
    const d = e.detail;
    const phase = currentRunner.currentPhase;
    timerBig.textContent = fmtTime(d.phaseRemaining);
    const phasePct = ((phase.seconds - d.phaseRemaining) / phase.seconds) * 100;
    phaseProgressBar.style.width = `${phasePct}%`;
    totalProgressBar.style.width = `${d.progressPct}%`;
    totalInfo.firstChild.textContent = fmtTime(d.totalElapsed);
  });

  currentRunner.addEventListener('phaseStart', e => {
    const phase = e.detail.phase;
    const display = $('#phaseDisplay');
    display.className = `phase-display phase-${phase.type}`;
    phaseLabel.textContent = phaseTypeLabel(phase.type);
    phaseCue.textContent = phase.cue || '';
    timerBig.textContent = fmtTime(phase.seconds);
    phaseProgressBar.style.width = '0%';
    const idx = currentRunner.phaseIndex;
    const nxt = session.phases[idx + 1];
    nextPhase.textContent = nxt
      ? `Dopo: ${phaseTypeLabel(nxt.type)} · ${fmtTime(nxt.seconds)}`
      : 'Ultima fase!';
    updateZoneInfo(zoneInfo, phase.type);
  });

  currentRunner.addEventListener('turnaround', () => {
    turnBanner.style.display = '';
    toast('🔄 Metà percorso: torna indietro verso casa');
    setTimeout(() => { turnBanner.style.display = 'none'; }, 15000);
  });

  currentRunner.addEventListener('finish', () => {
    document.body.classList.remove('session-active');
    showFeedbackForm(session);
  });
}

function updateZoneInfo(zoneInfoEl, phaseType) {
  const z = zoneRangeForType(phaseType);
  zoneInfoEl.innerHTML = '';
  zoneInfoEl.appendChild(el('div', { class: 'zone-target', style: `color: ${z.color}` },
    el('span', { class: 'zone-label-small' }, 'Target HR'),
    el('span', { class: 'zone-range' }, `${z.min}–${z.max} bpm`),
    el('span', { class: 'zone-name' }, z.label),
  ));
}

function confirmStop() {
  if (confirm('Vuoi davvero terminare la sessione?')) {
    currentRunner.stop();
    document.body.classList.remove('session-active');
    showFeedbackForm(currentRunner.session, true);
  }
}

// --- Feedback dopo sessione -----------------------------------------------
// Campi allineati al riassunto Apple Watch Series 9 "Corsa all'aperto":
//   ESSENZIALI: RPE, FC media, FC max, calorie attive, distanza, passo medio
//   AVANZATI:   tempo in Zone 2/3/4, cadenza, dislivello, lunghezza passo,
//               oscillazione verticale, ground contact, potenza
function showFeedbackForm(session, interrupted = false) {
  const container = $('#view-workout');
  container.innerHTML = '';

  const completion = interrupted
    ? currentRunner.totalElapsed / session.totalSeconds
    : 1;

  // Stato form
  const state = {
    rpe: 6,
    avgHr: '', maxHr: '',
    activeKcal: '',
    km: '', paceMinPerKm: '',
    timeZ2: '', timeZ3: '',
    cadence: '', strideM: '',
    elevationGain: '',
    verticalOsc: '', groundContact: '',
    runningPowerW: '',
    notes: '',
  };

  const rpeDisplay = el('div', { class: 'rpe-display' }, '6');
  const rpeLabel = el('div', { class: 'rpe-label' }, rpeText(6));
  const rpeSlider = el('input', {
    type: 'range', min: '1', max: '10', value: '6', class: 'rpe-slider',
  });
  rpeSlider.addEventListener('input', e => {
    state.rpe = parseInt(e.target.value);
    rpeDisplay.textContent = state.rpe;
    rpeLabel.textContent = rpeText(state.rpe);
  });

  // Helper per generare input numerici "compatti"
  const numInput = (key, placeholder, opts = {}) => {
    const i = el('input', {
      type: opts.type || 'number',
      inputmode: opts.inputmode || 'decimal',
      step: opts.step || '0.1',
      min: '0',
      placeholder,
      class: 'feedback-input',
      ...(opts.max ? { max: opts.max } : {}),
    });
    i.addEventListener('input', e => { state[key] = e.target.value; });
    return i;
  };

  // Sezione essenziali — campi che il Watch mostra in 2 swipe a fine sessione
  const essentials = el('div', { class: 'feedback-grid' },
    fieldWrap('FC media', numInput('avgHr', '145', { type: 'number', inputmode: 'numeric', step: '1', max: '220' }), 'bpm'),
    fieldWrap('FC max', numInput('maxHr', '168', { type: 'number', inputmode: 'numeric', step: '1', max: '220' }), 'bpm'),
    fieldWrap('Calorie attive', numInput('activeKcal', '180', { type: 'number', inputmode: 'numeric', step: '1' }), 'kcal'),
    fieldWrap('Distanza', numInput('km', '3.2', { step: '0.01' }), 'km'),
    fieldWrap('Passo medio', paceInput(state), 'min/km'),
  );

  // Sezione opzionali (collapsible) — NON servono all'algoritmo
  const advancedContent = el('div', { class: 'feedback-grid advanced-grid' },
    fieldWrap('Dislivello', numInput('elevationGain', '12', { type: 'number', inputmode: 'numeric', step: '1' }), 'm'),
    fieldWrap('Cadenza media', numInput('cadence', '165', { type: 'number', inputmode: 'numeric', step: '1' }), 'spm'),
    fieldWrap('Tempo Z2', numInput('timeZ2', '8', { type: 'number', inputmode: 'numeric', step: '1' }), 'min'),
    fieldWrap('Tempo Z3', numInput('timeZ3', '5', { type: 'number', inputmode: 'numeric', step: '1' }), 'min'),
    fieldWrap('Lunghezza passo', numInput('strideM', '1.05', { step: '0.01' }), 'm'),
    fieldWrap('Oscillaz. vert.', numInput('verticalOsc', '8.5', { step: '0.1' }), 'cm'),
    fieldWrap('Tempo a terra', numInput('groundContact', '280', { type: 'number', inputmode: 'numeric', step: '1' }), 'ms'),
    fieldWrap('Potenza media', numInput('runningPowerW', '220', { type: 'number', inputmode: 'numeric', step: '1' }), 'W'),
  );
  const advancedToggle = el('button', {
    class: 'advanced-toggle',
    type: 'button',
  }, '▼ Dati extra (opzionali — non servono all\'algoritmo)');
  let advancedOpen = false;
  advancedContent.style.display = 'none';
  advancedToggle.addEventListener('click', () => {
    advancedOpen = !advancedOpen;
    advancedContent.style.display = advancedOpen ? 'grid' : 'none';
    advancedToggle.textContent = (advancedOpen ? '▲ Nascondi extra' : '▼ Dati extra (opzionali — non servono all\'algoritmo)');
  });

  const notesInput = el('textarea', {
    placeholder: 'Note libere (umore, condizioni, percezioni)…',
    class: 'feedback-input', rows: '3',
  });
  notesInput.addEventListener('input', e => { state.notes = e.target.value; });

  container.appendChild(el('div', { class: 'feedback-screen' },
    el('div', { class: 'feedback-header' },
      el('div', { class: 'feedback-trophy' }, interrupted ? '⏸' : '🎉'),
      el('h2', {}, interrupted ? 'Sessione interrotta' : 'Sessione completata!'),
      el('div', { class: 'feedback-sub' }, `${Math.round(currentRunner.totalElapsed / 60)} min · ${Math.round(completion * 100)}% completata`),
    ),
    el('div', { class: 'feedback-section' },
      el('label', { class: 'feedback-label' }, 'Quanta fatica? (RPE 1-10)'),
      el('div', { class: 'rpe-row' }, rpeDisplay, rpeLabel),
      rpeSlider,
      el('div', { class: 'rpe-scale' },
        el('span', {}, '1 facile'),
        el('span', {}, '5 medio'),
        el('span', {}, '10 max'),
      ),
    ),
    el('div', { class: 'feedback-section' },
      el('label', { class: 'feedback-label' }, '📲 Dati dall\'Apple Watch (essenziali)'),
      el('div', { class: 'feedback-hint' }, 'Apri Salute o Fitness sul telefono e copia da lì — è più rapido che digitare dal polso.'),
      essentials,
    ),
    el('div', { class: 'feedback-section' },
      advancedToggle,
      advancedContent,
    ),
    el('div', { class: 'feedback-section' },
      el('label', { class: 'feedback-label' }, 'Note'),
      notesInput,
    ),
    el('button', {
      class: 'btn btn-primary btn-block btn-large',
      onclick: () => saveFeedbackAndAdvance({
        session, completion, interrupted,
        rpe: state.rpe,
        avgHr: parseIntOrNull(state.avgHr),
        maxHr: parseIntOrNull(state.maxHr),
        activeKcal: parseIntOrNull(state.activeKcal),
        km: parseFloatOrNull(state.km),
        paceSecPerKm: parsePaceToSec(state.paceMinPerKm),
        timeInZoneSec: {
          z2: minToSec(parseFloatOrNull(state.timeZ2)),
          z3: minToSec(parseFloatOrNull(state.timeZ3)),
        },
        cadence: parseIntOrNull(state.cadence),
        strideM: parseFloatOrNull(state.strideM),
        elevationGain: parseIntOrNull(state.elevationGain),
        verticalOsc: parseFloatOrNull(state.verticalOsc),
        groundContact: parseIntOrNull(state.groundContact),
        runningPowerW: parseIntOrNull(state.runningPowerW),
        notes: state.notes,
      }),
    }, 'Salva e continua'),
  ));
}

// Helper visivi e parser per il form Apple Watch
function fieldWrap(label, inputEl, unit) {
  return el('div', { class: 'field-mini' },
    el('label', { class: 'field-mini-label' }, label),
    el('div', { class: 'field-mini-input' },
      inputEl,
      unit ? el('span', { class: 'field-mini-unit' }, unit) : null,
    ),
  );
}

function paceInput(state) {
  const i = el('input', {
    type: 'text',
    inputmode: 'decimal',
    placeholder: '9:19 o 9,19',
    class: 'feedback-input',
    pattern: '[0-9:.,]*',
  });
  i.addEventListener('input', e => { state.paceMinPerKm = e.target.value; });
  return i;
}

// Interpreta il passo come minuti:secondi (formato Apple Watch 9'19").
// Sul tastierino numerico iOS è disponibile solo la virgola: la trattiamo
// come separatore mm:ss, esattamente come i due punti. Quindi "9,19" = 9:19 = 559s.
function parsePaceToSec(str) {
  if (!str) return null;
  str = String(str).trim().replace(',', ':').replace('.', ':');
  if (str.includes(':')) {
    const parts = str.split(':');
    const mins = parseInt(parts[0], 10) || 0;
    let secStr = (parts[1] || '').trim();
    // "9:5" -> 9:05 (una cifra = decine di secondi, come mostra il watch)
    if (secStr.length === 1) secStr = secStr + '0';
    const secs = parseInt(secStr, 10) || 0;
    return mins * 60 + secs;
  }
  if (/^\d+$/.test(str)) return parseInt(str, 10) * 60; // "9" -> 9:00
  return null;
}

function parseIntOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function parseFloatOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function minToSec(min) {
  return min == null ? null : Math.round(min * 60);
}

function rpeText(v) {
  if (v <= 2) return 'Riposo';
  if (v <= 4) return 'Leggero — chiacchierabile';
  if (v <= 6) return 'Moderato — frasi intere';
  if (v <= 7) return 'Sostenuto — frasi brevi';
  if (v <= 8) return 'Duro — parole singole';
  return 'Massimale — non si parla';
}

function saveFeedbackAndAdvance(args) {
  const {
    session, completion, interrupted,
    rpe, avgHr, maxHr, activeKcal,
    km, paceSecPerKm, timeInZoneSec,
    cadence, strideM, elevationGain,
    verticalOsc, groundContact, runningPowerW,
    notes,
  } = args;
  const profile = getProfile();
  const progress = getProgress();
  const durationSec = currentRunner.totalElapsed;
  const durationMin = durationSec / 60;

  // Calorie: priorità ai dati Watch, poi Keytel (HR-based), poi MET fallback
  let kcal;
  let kcalSource;
  if (activeKcal) {
    kcal = activeKcal;
    kcalSource = 'apple-watch';
  } else if (avgHr) {
    kcal = kcalKeytel({
      avgHr, weightKg: profile.weightCurrentKg, age: getAge(),
      durationMin, isMale: profile.isMale,
    });
    kcalSource = 'keytel';
  } else {
    let total = 0;
    let elapsed = 0;
    for (const phase of session.phases) {
      const phaseMin = Math.min(phase.seconds, Math.max(0, durationSec - elapsed)) / 60;
      total += kcalFromMET(phase.type, phaseMin, profile.weightCurrentKg);
      elapsed += phase.seconds;
      if (elapsed >= durationSec) break;
    }
    kcal = total;
    kcalSource = 'met';
  }

  // Determina range zona target dominante della sessione
  const zones = getZones();
  const targetRange = { min: zones.z2.min, max: zones.z3.max };

  const record = {
    id: `s-${Date.now()}`,
    completedAt: new Date().toISOString(),
    week: progress.currentWeek,
    sessionIndex: progress.currentSessionIndex,
    sessionId: session.id,
    title: session.title,
    focus: session.focus,
    durationSec, durationMin: Math.round(durationMin * 10) / 10,
    completion: Math.round(completion * 100) / 100,
    // Soggettivo
    rpe, notes,
    // Apple Watch — base
    avgHr, maxHr, km,
    paceSecPerKm,         // secondi/km
    elevationGain,
    // Apple Watch — tempo in zone
    timeInZoneSec,        // { z2, z3 }
    // Apple Watch — forma di corsa
    cadence, strideM, verticalOsc, groundContact, runningPowerW,
    // Calorie
    kcal, kcalSource,
    interrupted,
  };
  saveSession(record);

  // Consuma la sessione di corsa su misura del coach: dopo averla completata si
  // torna al programma normale.
  if (progress.customRunSession) progress.customRunSession = null;

  // Aggiorna feedback settimanale (per algoritmo adattivo)
  const fb = {
    rpe, completion, avgHr,
    targetZoneRange: targetRange,
  };
  progress.weekFeedbacks = [...(progress.weekFeedbacks || []), fb];

  // Avanzamento posizione: prossima sessione, se ultima della settimana applica algoritmo
  const volume = progress.weeklyVolume || 3;
  let volumeChangeMessage = null;

  if (progress.currentSessionIndex < volume - 1) {
    progress.currentSessionIndex++;
  } else {
    // Chiusura settimana: 1) avanza settimana col vecchio algoritmo, 2) valuta nuovo volume
    const newWeek = nextWeekIndex(progress.currentWeek, progress.weekFeedbacks);
    progress.currentWeek = newWeek;
    progress.currentSessionIndex = 0;
    progress.weekFeedbacks = []; // reset

    // Auto-promozione / deload volume in base allo storico completo
    const allSessions = getSessions();
    const volEval = evaluateVolumeChange({
      currentVolume: volume,
      currentWeek: newWeek,
      sessions: allSessions,
    });
    if (volEval.changed) {
      progress.weeklyVolume = volEval.newVolume;
      progress.volumePromotedAt = newWeek;
      volumeChangeMessage = volEval.message;
    }
  }
  saveProgress(progress);

  // Schermata risultati
  showResultsScreen(record, volumeChangeMessage);
}

function showResultsScreen(record, volumeChangeMessage = null) {
  const container = $('#view-workout');
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'results-screen' },
    el('div', { class: 'results-trophy' }, '🏆'),
    el('h2', {}, 'Ben fatto!'),
    el('div', { class: 'results-grid' },
      kpiCard('Tempo', `${record.durationMin}'`, '⏱'),
      kpiCard('Calorie', `${record.kcal || '—'}`, '🔋'),
      kpiCard('RPE', record.rpe, '💪'),
      kpiCard('FC media', record.avgHr || '—', '❤️'),
    ),
    volumeChangeMessage ? el('div', { class: 'volume-change-banner' },
      el('div', { class: 'vc-icon' }, '📣'),
      el('div', { class: 'vc-text' }, volumeChangeMessage),
    ) : null,
    el('div', { class: 'results-actions' },
      el('button', { class: 'btn btn-primary', onclick: () => setView('home') }, 'Torna alla Home'),
      el('button', { class: 'btn btn-ghost', onclick: () => setView('stats') }, 'Vedi statistiche'),
    ),
  ));
  mountCoachDebrief();
}

// ============================================================================
// ASSESSMENT WIZARD — test iniziale
// ============================================================================
let assessmentState = null;

function startAssessmentWizard() {
  assessmentState = {
    step: 0,
    walkTest: {},
    strengthTest: {},
  };
  renderAssessmentStep();
}

function renderAssessmentStep() {
  const modal = $('#modal');
  modal.innerHTML = '';
  modal.classList.add('open', 'assessment-modal');
  const close = () => { modal.classList.remove('open', 'assessment-modal'); assessmentState = null; };

  const step = assessmentState.step;
  let content;

  if (step === 0) {
    // Introduzione
    content = el('div', {},
      el('div', { class: 'assessment-step-num' }, 'Passo 1 di 4'),
      el('h2', {}, '🏁 Test iniziale'),
      el('div', { class: 'help-text' },
        'In 2 giorni separati farai due test scientificamente validati. ' +
        'L\'app calcolerà VO₂max stimato, soglie cardiache reali e livello forza, ' +
        'poi calibrerà programma e settimana di partenza.',
      ),
      el('div', { class: 'assessment-tests-overview' },
        testOverviewCard('📏', 'Rockport Walk Test', '~20 min', 'Cammina 1 miglio (1.609 km) il più veloce possibile camminando. Niente corsa. Apple Watch traccia HR e tempo.'),
        testOverviewCard('💪', 'Strength Assessment', '~15 min', '4 esercizi a tempo: squat (2 min), push-up (1 min), plank (max), hollow hold (max). Forma corretta.'),
      ),
      el('div', { class: 'help-text', style: 'margin-top: 16px;' },
        '⚠️ Fai i due test in giorni diversi. Riposa almeno 24h prima del walk test. Niente caffè 3h prima.',
      ),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn-ghost', onclick: close }, 'Annulla'),
        el('button', { class: 'btn btn-primary', onclick: () => { assessmentState.step = 1; renderAssessmentStep(); } }, 'Cominciamo →'),
      ),
    );
  }
  else if (step === 1) {
    // Istruzioni walk test
    content = el('div', {},
      el('div', { class: 'assessment-step-num' }, 'Passo 2 di 4 — Walk Test'),
      el('h2', {}, '📏 Rockport 1-Mile Walk Test'),
      el('div', { class: 'assessment-instructions' },
        el('div', { class: 'instr-step' },
          el('span', { class: 'instr-num' }, '1'),
          el('div', {}, 'Trova un percorso pianeggiante (pista, lungomare, strada lunga). Misura 1 miglio = 1609 metri. Oppure usa Apple Watch per il GPS.'),
        ),
        el('div', { class: 'instr-step' },
          el('span', { class: 'instr-num' }, '2'),
          el('div', {}, 'Avvia sul Watch "Camminata all\'aperto". Riscaldati 5 min con cammino normale.'),
        ),
        el('div', { class: 'instr-step' },
          el('span', { class: 'instr-num' }, '3'),
          el('div', {}, 'Inizia il miglio cronometrato: cammina il più veloce possibile MA SENZA CORRERE (un piede sempre a terra).'),
        ),
        el('div', { class: 'instr-step' },
          el('span', { class: 'instr-num' }, '4'),
          el('div', {}, 'Al traguardo: ferma SUBITO l\'allenamento sul Watch. Segna l\'HR finale.'),
        ),
        el('div', { class: 'instr-step' },
          el('span', { class: 'instr-num' }, '5'),
          el('div', {}, 'Resta fermo in piedi 60 secondi, poi rilegga HR (è l\'HRR — heart rate recovery).'),
        ),
      ),
      el('div', { class: 'help-text' },
        'Quando hai finito il test, torna qui e inserisci i 3 numeri.',
      ),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn-ghost', onclick: close }, 'Esci, lo farò dopo'),
        el('button', { class: 'btn btn-primary', onclick: () => { assessmentState.step = 2; renderAssessmentStep(); } }, 'Ho fatto il test →'),
      ),
    );
  }
  else if (step === 2) {
    // Input walk test
    const state = assessmentState.walkTest;
    const timeMinInput = inputField('Tempo (min:sec)', state.timeStr || '', v => state.timeStr = v, 'text', '15:30');
    const hrFinalInput = inputField('FC finale (bpm)', state.finalHr || '', v => state.finalHr = parseInt(v) || null, 'number', '155');
    const hrAfterInput = inputField('FC dopo 60s di riposo (bpm)', state.hrAfter1min || '', v => state.hrAfter1min = parseInt(v) || null, 'number', '125');
    content = el('div', {},
      el('div', { class: 'assessment-step-num' }, 'Passo 2 di 4 — Risultati Walk Test'),
      el('h2', {}, '📏 Inserisci i risultati'),
      timeMinInput, hrFinalInput, hrAfterInput,
      el('div', { class: 'help-text' },
        'I 3 numeri li trovi sul Watch a fine sessione (durata, FC finale) e dopo 1 minuto (FC recovery).',
      ),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn-ghost', onclick: () => { assessmentState.step = 1; renderAssessmentStep(); } }, '← Indietro'),
        el('button', {
          class: 'btn btn-primary',
          onclick: () => {
            const parsed = parseTimeMinSec(state.timeStr);
            if (!parsed || !state.finalHr || !state.hrAfter1min) {
              toast('Inserisci tutti e 3 i valori');
              return;
            }
            state.timeMin = parsed;
            assessmentState.step = 3;
            renderAssessmentStep();
          },
        }, 'Avanti →'),
      ),
    );
  }
  else if (step === 3) {
    // Istruzioni + input strength test (singola schermata, l'utente esegue fuori)
    const state = assessmentState.strengthTest;
    content = el('div', {},
      el('div', { class: 'assessment-step-num' }, 'Passo 3 di 4 — Strength Test'),
      el('h2', {}, '💪 4 esercizi a tempo'),
      el('div', { class: 'help-text' },
        'Cronometrati con il telefono o il Watch. Tra un esercizio e l\'altro riposa 2 minuti. Forma sempre corretta — niente rep "sporche".',
      ),
      el('div', { class: 'strength-test-list' },
        strengthTestRow('🦵', 'Squat (2 min)', 'Quanti squat puoi fare in 2 minuti, profondità cosce parallele.',
          inputField('', state.squats2min || '', v => state.squats2min = parseInt(v) || null, 'number', '40')),
        strengthTestRow('💪', 'Push-up (1 min)', 'Standard sui piedi se possibile, ginocchia altrimenti.',
          inputField('', state.pushupsMin || '', v => state.pushupsMin = parseInt(v) || null, 'number', '18')),
        strengthTestRow('🧘', 'Plank (max)', 'Tempo massimo in posizione di plank avambracci, corpo dritto.',
          inputField('Secondi', state.plankSec || '', v => state.plankSec = parseInt(v) || null, 'number', '60')),
        strengthTestRow('🥥', 'Hollow hold (max)', 'Schiena premuta a terra, gambe e braccia tese sollevate. Tempo massimo.',
          inputField('Secondi', state.hollowSec || '', v => state.hollowSec = parseInt(v) || null, 'number', '30')),
      ),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn-ghost', onclick: () => { assessmentState.step = 2; renderAssessmentStep(); } }, '← Indietro'),
        el('button', {
          class: 'btn btn-primary',
          onclick: () => {
            if (state.squats2min == null || state.pushupsMin == null || state.plankSec == null) {
              toast('Inserisci almeno squat, push-up, plank');
              return;
            }
            assessmentState.step = 4;
            renderAssessmentStep();
          },
        }, 'Calcola risultati →'),
      ),
    );
  }
  else if (step === 4) {
    // Risultati + calibrazione
    const profile = getProfile();
    const age = new Date().getFullYear() - profile.birthYear;
    const wt = assessmentState.walkTest;
    const st = assessmentState.strengthTest;

    const vo2 = calcVO2maxRockport({
      weightKg: profile.weightCurrentKg, age,
      isMale: profile.isMale, timeMin: wt.timeMin, finalHr: wt.finalHr,
    });
    const vo2Cat = vo2maxCategory(vo2, age, profile.isMale);
    const hrrDrop = wt.finalHr - wt.hrAfter1min;
    const hrrCat = hrrCategory(hrrDrop);
    const strAssess = strengthAssessment({
      pushupsMin: st.pushupsMin,
      squats2min: st.squats2min,
      plankSec: st.plankSec,
      isMale: profile.isMale,
    });
    const calib = calibrate({
      vo2max: vo2, vo2Cat, hrrDrop, hrrCat,
      strengthLevel: strAssess.level, age,
      isMale: profile.isMale, restingHr: profile.restingHr,
    });
    const pace = suggestedZ2Pace(vo2);

    content = el('div', { class: 'assessment-results' },
      el('div', { class: 'assessment-step-num' }, 'Passo 4 di 4 — Risultati'),
      el('h2', {}, '🎯 Il tuo profilo fitness'),

      // VO2max
      el('div', { class: 'result-card', style: `border-left-color: ${vo2Cat?.color || '#10b981'}` },
        el('div', { class: 'result-label' }, 'VO₂max stimato (Rockport)'),
        el('div', { class: 'result-value' }, `${vo2 ?? '—'} ml/kg/min`),
        el('div', { class: 'result-cat', style: `color: ${vo2Cat?.color}` }, vo2Cat?.label || ''),
        el('div', { class: 'result-help' }, `Sei nel ${vo2Cat?.percentile}° percentile per ${profile.isMale ? 'uomini' : 'donne'} ${ageBracket(age)} anni.`),
      ),

      // HRR
      el('div', { class: 'result-card', style: `border-left-color: ${hrrCat?.color || '#3b82f6'}` },
        el('div', { class: 'result-label' }, 'HR Recovery 1 min'),
        el('div', { class: 'result-value' }, `-${hrrDrop} bpm`),
        el('div', { class: 'result-cat', style: `color: ${hrrCat?.color}` }, hrrCat?.label || ''),
        el('div', { class: 'result-help' }, hrrCat?.risk || ''),
      ),

      // Strength
      el('div', { class: 'result-card', style: `border-left-color: ${strAssess.level === 'advanced' ? '#a855f7' : strAssess.level === 'returning' ? '#10b981' : '#f59e0b'}` },
        el('div', { class: 'result-label' }, 'Livello forza'),
        el('div', { class: 'result-value' }, strAssess.label),
        el('div', { class: 'result-help' }, `Score medio: ${strAssess.avg}/4 (push-up: ${strAssess.score.push}, squat: ${strAssess.score.squat}, plank: ${strAssess.score.plank})`),
      ),

      // Pace target Z2
      pace ? el('div', { class: 'result-card', style: 'border-left-color: #10b981' },
        el('div', { class: 'result-label' }, 'Passo target Zone 2 (fat-burning)'),
        el('div', { class: 'result-value' }, `${formatPaceMinKm(pace.minPerKm.min)} – ${formatPaceMinKm(pace.minPerKm.max)} min/km`),
        el('div', { class: 'result-help' }, `Velocità ${pace.kmh.min}-${pace.kmh.max} km/h. Per la corsa lenta delle sessioni Long Z2.`),
      ) : null,

      // Calibration summary
      el('div', { class: 'result-card calibration-summary' },
        el('div', { class: 'result-label' }, '⚙️ Calibrazione consigliata'),
        el('div', { class: 'calib-item' }, `Programma corsa: parti da settimana ${calib.runWeek}`),
        el('div', { class: 'calib-item' }, `Volume settimanale: ${calib.weeklyVolume} sessioni/settimana`),
        el('div', { class: 'calib-item' }, `Programma forza: livello ${calib.strengthLevel}, settimana ${calib.strengthWeek}`),
        el('div', { class: 'calib-item' }, `Zone 2 cardiaca: ${calib.z2Range.min}-${calib.z2Range.max} bpm`),
        el('div', { class: 'calib-item' }, `HRmax di riferimento: ${calib.hrMax} bpm`),
      ),

      el('div', { class: 'btn-row', style: 'margin-top: 20px;' },
        el('button', { class: 'btn btn-ghost', onclick: close }, 'Salva senza calibrare'),
        el('button', {
          class: 'btn btn-primary',
          onclick: () => applyCalibration({ vo2, vo2Cat, hrrDrop, hrrCat, strAssess, calib, walkTest: wt, strengthTest: st }),
        }, 'Applica calibrazione →'),
      ),
    );
  }

  modal.appendChild(el('div', { class: 'modal-content assessment-content' },
    el('div', { class: 'modal-body' }, content),
  ));
}

function applyCalibration({ vo2, vo2Cat, hrrDrop, hrrCat, strAssess, calib, walkTest, strengthTest }) {
  // Salva assessment
  saveAssessment({
    done: true,
    walkTest: { ...walkTest, date: new Date().toISOString() },
    strengthTest: { ...strengthTest, date: new Date().toISOString() },
    results: {
      vo2max: vo2,
      vo2Cat,
      hrrDrop,
      hrrCat,
      strengthLevel: strAssess.level,
      strengthScore: strAssess,
      hrMax: calib.hrMax,
      z2Range: calib.z2Range,
      paceZ2: suggestedZ2Pace(vo2),
    },
  });

  // Aggiorna profilo
  const profile = getProfile();
  profile.strengthLevel = calib.strengthLevel;
  profile.strengthEnabled = calib.strengthEnabled;
  saveProfile(profile);

  // Aggiorna progress
  const progress = getProgress();
  progress.currentWeek = calib.runWeek;
  progress.currentSessionIndex = 0;
  progress.weeklyVolume = calib.weeklyVolume;
  progress.strengthWeek = calib.strengthWeek;
  progress.strengthSessionIndex = 0;
  saveProgress(progress);

  $('#modal').classList.remove('open', 'assessment-modal');
  toast('🎯 Calibrazione applicata!');
  setView('home');
}

function testOverviewCard(icon, title, dur, desc) {
  return el('div', { class: 'test-overview-card' },
    el('div', { class: 'toc-icon' }, icon),
    el('div', { class: 'toc-content' },
      el('div', { class: 'toc-title' }, title),
      el('div', { class: 'toc-dur' }, dur),
      el('div', { class: 'toc-desc' }, desc),
    ),
  );
}

function strengthTestRow(icon, name, desc, inputEl) {
  return el('div', { class: 'strength-test-row' },
    el('div', { class: 'strength-test-icon' }, icon),
    el('div', { class: 'strength-test-info' },
      el('div', { class: 'strength-test-name' }, name),
      el('div', { class: 'strength-test-desc' }, desc),
    ),
    el('div', { class: 'strength-test-input' }, inputEl),
  );
}

function inputField(label, value, onchange, type = 'text', placeholder = '') {
  const i = el('input', {
    type, value: value ?? '', placeholder,
    class: 'feedback-input',
    inputmode: type === 'number' ? 'numeric' : 'text',
  });
  i.addEventListener('input', e => onchange(e.target.value));
  return label
    ? el('div', { class: 'field' }, el('label', { class: 'feedback-label' }, label), i)
    : i;
}

function parseTimeMinSec(str) {
  if (!str) return null;
  if (str.includes(':')) {
    const [m, s] = str.split(':').map(n => parseInt(n) || 0);
    return m + s / 60;
  }
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
}

function formatPaceMinKm(v) {
  const m = Math.floor(v);
  const s = Math.round((v - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function ageBracket(age) {
  if (age < 30) return '20-29';
  if (age < 40) return '30-39';
  if (age < 50) return '40-49';
  if (age < 60) return '50-59';
  return '60+';
}

// ============================================================================
// STRENGTH — preview, runner, feedback
// ============================================================================
function showStrengthPreview(session) {
  const modal = $('#modal');
  modal.innerHTML = '';
  modal.classList.add('open');
  modal.appendChild(el('div', { class: 'modal-content' },
    el('div', { class: 'modal-header' },
      el('h2', {}, session.title),
      el('button', { class: 'icon-btn', onclick: () => modal.classList.remove('open') }, '×'),
    ),
    el('div', { class: 'modal-body' },
      el('div', { class: 'session-focus' }, `${session.focus} · ~${session.estimatedMinutes} min`),
      el('div', { class: 'phases-list' },
        ...session.exercises.map((ex, i) => el('div', { class: 'exercise-item' },
          ex.gifUrl
            ? el('img', { class: 'exercise-gif-thumb', src: ex.gifUrl, alt: ex.name, loading: 'lazy' })
            : el('div', { class: 'exercise-icon' }, ex.icon || '💪'),
          el('div', { class: 'exercise-info' },
            el('div', { class: 'exercise-name' }, ex.name),
            el('div', { class: 'exercise-muscle' }, ex.muscle),
            el('div', { class: 'exercise-form' }, ex.formTip),
          ),
          el('div', { class: 'exercise-spec' },
            el('div', { class: 'exercise-sets' }, `${ex.sets}×${ex.reps}`),
            el('div', { class: 'exercise-rest' }, `rest ${ex.restSec}s`),
          ),
        )),
      ),
      el('button', {
        class: 'btn btn-strength btn-block',
        onclick: () => { modal.classList.remove('open'); startStrengthSession(session); },
      }, 'Inizia ora'),
    ),
  ));
}

function startStrengthSession(session) {
  setView('workout');
  document.body.classList.add('session-active');
  document.body.classList.add('session-strength'); // tema viola
  speak('Pronti per la forza?');
  currentStrength = new StrengthRunner(session);
  renderStrengthScreen(session);
}

function renderStrengthScreen(session) {
  const container = $('#view-workout');
  container.innerHTML = '';

  // Stato visivo
  const phaseLabel = el('div', { class: 'phase-label' }, 'Esercizio 1');
  const exerciseName = el('div', { class: 'strength-ex-name' }, session.exercises[0].name);
  const variantSub = el('div', { class: 'strength-ex-variant' }, session.exercises[0].muscle);
  const formTipEl = el('div', { class: 'strength-form-tip' }, session.exercises[0].formTip);
  // GIF dimostrativa grande
  const gifEl = el('img', {
    class: 'strength-gif',
    src: session.exercises[0].gifUrl || '',
    alt: session.exercises[0].name,
    loading: 'eager',
  });
  if (!session.exercises[0].gifUrl) gifEl.style.display = 'none';
  const bigCounter = el('div', { class: 'strength-big-counter' }, `${session.exercises[0].reps}`);
  const counterLabel = el('div', { class: 'strength-counter-label' }, 'ripetizioni');
  const setNumberEl = el('div', { class: 'strength-set-info' }, `Serie 1 / ${session.exercises[0].sets}`);
  // Indicatore del lato per gli esercizi unilaterali (bulgarian, split squat, ponte monopodalico…)
  const sideEl = el('div', { class: 'strength-side' }, 'Lato sinistro');
  if (!session.exercises[0].unilateral) sideEl.style.display = 'none';

  const restDisplay = el('div', { class: 'strength-rest-display' });
  restDisplay.style.display = 'none';

  const totalProgress = el('div', { class: 'total-progress' });
  const totalProgressBar = el('div', { class: 'total-progress-bar' });
  totalProgress.appendChild(totalProgressBar);
  const totalInfo = el('div', { class: 'total-info' },
    el('span', { class: 'sets-done' }, `0 / ${currentStrength.totalSets} serie`),
  );

  // Pulsante principale: "Serie fatta" (cambia in "Salta rest" durante rest)
  const mainBtn = el('button', { class: 'btn btn-strength btn-control' }, '✓ Serie fatta');
  const repInput = el('input', {
    type: 'number',
    inputmode: 'numeric',
    placeholder: `${session.exercises[0].reps}`,
    class: 'feedback-input strength-rep-input',
    min: '0', max: '200',
  });
  const stopBtn = el('button', {
    class: 'btn btn-ghost btn-control btn-danger',
    onclick: confirmStopStrength,
  }, '✕');

  mainBtn.addEventListener('click', () => {
    if (currentStrength.state === 'restActive') {
      currentStrength.skipRest();
      return;
    }
    const actualReps = repInput.value ? parseInt(repInput.value) : currentStrength.currentExercise.reps;
    currentStrength.setDone(actualReps);
    repInput.value = '';
  });

  container.appendChild(el('div', { class: 'workout-screen' },
    el('div', { class: 'workout-header' },
      el('div', { class: 'session-title-small' }, session.title),
      el('div', { class: 'session-focus-small' }, session.focus),
    ),
    el('div', { class: 'phase-display phase-strength' },
      phaseLabel,
      exerciseName,
      variantSub,
      gifEl,
      bigCounter, counterLabel,
      setNumberEl,
      sideEl,
      formTipEl,
      restDisplay,
    ),
    el('div', { class: 'strength-rep-row' },
      el('label', { class: 'strength-rep-label' }, 'Quante ne hai fatte?'),
      repInput,
    ),
    totalProgress, totalInfo,
    el('div', { class: 'controls' }, stopBtn, mainBtn, el('div')),
    el('div', { class: 'controls-legend' },
      el('span', {}, 'Termina'),
      el('span', {}, 'Tap quando hai finito la serie'),
      el('span', {}, ''),
    ),
  ));

  // Listeners
  currentStrength.addEventListener('setComplete', e => {
    totalInfo.firstChild.textContent = `${currentStrength.completedCount} / ${currentStrength.totalSets} serie`;
    totalProgressBar.style.width = `${currentStrength.progressPct}%`;
  });
  currentStrength.addEventListener('restStart', e => {
    mainBtn.textContent = '⏭ Salta riposo';
    restDisplay.style.display = 'block';
    repInput.style.display = 'none';
    // Cambio lato: stesso esercizio/serie, secondo lato in arrivo
    if (e.detail.switchSide) {
      restDisplay.textContent = `Cambia lato: ${e.detail.seconds}s`;
      phaseLabel.textContent = 'Cambia lato!';
      counterLabel.textContent = 'prossimo lato';
      sideEl.style.display = '';
      sideEl.textContent = currentStrength.sideLabel; // "Lato destro"
      sideEl.classList.add('strength-side-switch');
      bigCounter.textContent = `${currentStrength.currentExercise.reps}`;
      return;
    }
    restDisplay.textContent = `Riposo: ${e.detail.seconds}s`;
    // Anticipa il PROSSIMO esercizio/serie durante il riposo (era fermo su quello finito)
    const nx = currentStrength.currentExercise;
    const nextSet = currentStrength.setIndex + 1;
    phaseLabel.textContent = `Riposo · poi esercizio ${currentStrength.exerciseIndex + 1} / ${session.exercises.length}`;
    exerciseName.textContent = nx.name;
    variantSub.textContent = nx.muscle;
    formTipEl.textContent = nx.formTip;
    bigCounter.textContent = `${nx.reps}`;
    counterLabel.textContent = 'prossime ripetizioni';
    setNumberEl.textContent = `Serie ${nextSet} / ${nx.sets}`;
    if (nx.unilateral) { sideEl.style.display = ''; sideEl.textContent = 'Lato sinistro'; sideEl.classList.remove('strength-side-switch'); }
    else { sideEl.style.display = 'none'; }
    if (nx.gifUrl) { gifEl.src = nx.gifUrl; gifEl.alt = nx.name; gifEl.style.display = ''; }
    else { gifEl.style.display = 'none'; }
  });
  currentStrength.addEventListener('tick', e => {
    restDisplay.textContent = `Riposo: ${e.detail.restRemaining}s`;
  });
  currentStrength.addEventListener('setStart', e => {
    const ex = e.detail.exercise;
    mainBtn.textContent = '✓ Serie fatta';
    restDisplay.style.display = 'none';
    repInput.style.display = '';
    phaseLabel.textContent = `Esercizio ${currentStrength.exerciseIndex + 1} / ${session.exercises.length}`;
    exerciseName.textContent = ex.name;
    variantSub.textContent = ex.muscle;
    formTipEl.textContent = ex.formTip;
    bigCounter.textContent = `${ex.reps}`;
    counterLabel.textContent = 'ripetizioni';
    setNumberEl.textContent = `Serie ${e.detail.setNumber} / ${ex.sets}`;
    if (e.detail.sideLabel) {
      sideEl.style.display = '';
      sideEl.textContent = e.detail.sideLabel;
      sideEl.classList.remove('strength-side-switch');
    } else {
      sideEl.style.display = 'none';
    }
    repInput.setAttribute('placeholder', `${ex.reps}`);
    // Aggiorna GIF dimostrativa
    if (ex.gifUrl) {
      gifEl.src = ex.gifUrl;
      gifEl.alt = ex.name;
      gifEl.style.display = '';
    } else {
      gifEl.style.display = 'none';
    }
  });
  currentStrength.addEventListener('finish', () => {
    document.body.classList.remove('session-active');
    document.body.classList.remove('session-strength');
    showStrengthFeedbackForm(session);
  });
}

function confirmStopStrength() {
  if (confirm('Vuoi davvero terminare la sessione di forza?')) {
    currentStrength.stop();
    document.body.classList.remove('session-active');
    document.body.classList.remove('session-strength');
    showStrengthFeedbackForm(currentStrength.session, true);
  }
}

function showStrengthFeedbackForm(session, interrupted = false) {
  const container = $('#view-workout');
  container.innerHTML = '';

  const completedSets = currentStrength.completedCount;
  const totalSets = currentStrength.totalSets;
  const completion = completedSets / totalSets;
  const durationSec = currentStrength.totalDurationSec;

  const state = {
    rpe: 6,
    avgHr: '', maxHr: '',
    activeKcal: '',
    notes: '',
  };

  const rpeDisplay = el('div', { class: 'rpe-display' }, '6');
  const rpeLabel = el('div', { class: 'rpe-label' }, rpeText(6));
  const rpeSlider = el('input', {
    type: 'range', min: '1', max: '10', value: '6', class: 'rpe-slider',
  });
  rpeSlider.addEventListener('input', e => {
    state.rpe = parseInt(e.target.value);
    rpeDisplay.textContent = state.rpe;
    rpeLabel.textContent = rpeText(state.rpe);
  });

  const numInput = (key, placeholder, opts = {}) => {
    const i = el('input', {
      type: opts.type || 'number',
      inputmode: opts.inputmode || 'numeric',
      step: opts.step || '1', min: '0',
      placeholder, class: 'feedback-input',
    });
    i.addEventListener('input', e => { state[key] = e.target.value; });
    return i;
  };

  const notesInput = el('textarea', {
    placeholder: 'Note (es. "12 rep invece di 10", "burpee duri")…',
    class: 'feedback-input', rows: '3',
  });
  notesInput.addEventListener('input', e => { state.notes = e.target.value; });

  container.appendChild(el('div', { class: 'feedback-screen' },
    el('div', { class: 'feedback-header' },
      el('div', { class: 'feedback-trophy' }, interrupted ? '⏸' : '💪'),
      el('h2', {}, interrupted ? 'Sessione interrotta' : 'Forza completata!'),
      el('div', { class: 'feedback-sub' }, `${Math.round(durationSec / 60)} min · ${completedSets}/${totalSets} serie · ${Math.round(completion * 100)}%`),
    ),
    el('div', { class: 'feedback-section' },
      el('label', { class: 'feedback-label' }, 'Quanta fatica? (RPE 1-10)'),
      el('div', { class: 'rpe-row' }, rpeDisplay, rpeLabel),
      rpeSlider,
      el('div', { class: 'rpe-scale' },
        el('span', {}, '1 facile'),
        el('span', {}, '5 medio'),
        el('span', {}, '10 max'),
      ),
    ),
    el('div', { class: 'feedback-section' },
      el('label', { class: 'feedback-label' }, '📲 Dati Apple Watch — Allenamento di forza'),
      el('div', { class: 'feedback-hint' }, 'Apri Fitness su iPhone: lì trovi FC media, max e calorie attive per Functional/Traditional Strength Training.'),
      el('div', { class: 'feedback-grid' },
        fieldWrap('FC media', numInput('avgHr', '125', { max: '220' }), 'bpm'),
        fieldWrap('FC max', numInput('maxHr', '155', { max: '220' }), 'bpm'),
        fieldWrap('Calorie attive', numInput('activeKcal', '90'), 'kcal'),
      ),
    ),
    el('div', { class: 'feedback-section' },
      el('label', { class: 'feedback-label' }, 'Note'),
      notesInput,
    ),
    el('button', {
      class: 'btn btn-strength btn-block btn-large',
      onclick: () => saveStrengthFeedback({
        session, interrupted, completion,
        rpe: state.rpe,
        avgHr: parseIntOrNull(state.avgHr),
        maxHr: parseIntOrNull(state.maxHr),
        activeKcal: parseIntOrNull(state.activeKcal),
        notes: state.notes,
        completedSets,
        totalSets,
        durationSec,
        completedSetsLog: currentStrength.completedSets,
      }),
    }, 'Salva e continua'),
  ));
}

function saveStrengthFeedback(args) {
  const {
    session, interrupted, completion, rpe, avgHr, maxHr, activeKcal,
    notes, completedSets, totalSets, durationSec, completedSetsLog,
  } = args;
  const profile = getProfile();
  const progress = getProgress();
  const durationMin = durationSec / 60;

  // Calorie: priorità Apple Watch, fallback Keytel, fallback stima ~6 MET
  let kcal;
  let kcalSource;
  if (activeKcal) {
    kcal = activeKcal;
    kcalSource = 'apple-watch';
  } else if (avgHr) {
    kcal = kcalKeytel({
      avgHr, weightKg: profile.weightCurrentKg, age: getAge(),
      durationMin, isMale: profile.isMale,
    });
    kcalSource = 'keytel';
  } else {
    // MET medio per forza dinamica bodyweight ~6
    kcal = Math.round(6 * profile.weightCurrentKg * (durationMin / 60));
    kcalSource = 'met';
  }

  const record = {
    id: `s-${Date.now()}`,
    completedAt: new Date().toISOString(),
    type: 'strength',
    week: progress.strengthWeek,
    sessionIndex: progress.strengthSessionIndex,
    sessionId: session.id,
    title: session.title,
    focus: session.focus,
    durationSec,
    durationMin: Math.round(durationMin * 10) / 10,
    completion: Math.round(completion * 100) / 100,
    rpe, avgHr, maxHr, notes,
    completedSets, totalSets,
    completedSetsLog,
    kcal, kcalSource,
    interrupted,
  };
  saveSession(record);

  // Consuma la sessione di forza su misura del coach: dopo averla fatta si torna al programma
  const pr0 = getProgress();
  if (pr0.customStrengthSession) { pr0.customStrengthSession = null; saveProgress(pr0); }

  // Ricalcola la progressione forza dall'intero log (settimana, sessione, intensità reps).
  // Un'unica fonte di verità: vale sia qui sia dopo una modifica/eliminazione nello storico.
  applyStrengthProgress();

  showStrengthResultsScreen(record);
}

// Replay deterministico: rilegge tutte le sessioni di forza e riallinea il progress.
// Ritorna lo stato calcolato (week, sessionIndex, repScale) per eventuali toast.
function applyStrengthProgress() {
  const profile = getProfile();
  const progress = getProgress();
  const strengthSessions = getSessions().filter(s => s.type === 'strength');
  const state = recomputeStrengthState(strengthSessions, profile.strengthLevel || 'returning');
  // I bias del coach AI sono persistenti e si sommano DOPO il replay deterministico,
  // così non vengono sovrascritti dal ricalcolo dal log. Il coach ha pieno controllo
  // (entro limiti ampi anti-rottura), l'algoritmo resta come base/fallback offline.
  const rsBias = progress.coachRepScaleBias || 0;
  const wkBias = progress.coachWeekBias || 0;
  progress.strengthWeek = Math.min(8, Math.max(1, state.strengthWeek + wkBias));
  progress.strengthSessionIndex = state.strengthSessionIndex;
  progress.strengthRepScale = Math.min(2.0, Math.max(0.5, state.strengthRepScale + rsBias));
  saveProgress(progress);
  return { ...state, strengthWeek: progress.strengthWeek, strengthRepScale: progress.strengthRepScale };
}

// ============================================================================
// AI COACH — chiamata al Worker, applicazione ibrida, UI debrief
// ============================================================================

/** Contesto per il coach arricchito col piano del giorno e le prossime sessioni. */
function buildCoachContext() {
  const ctx = coachContext();
  try {
    const progress = getProgress();
    const profile = getProfile();
    const settings = getSettings();
    const strengthEnabled = profile.strengthEnabled !== false;
    const plan = getTodayPlan(settings, strengthEnabled);
    const weeklyVolume = progress.weeklyVolume || 3;
    const runSessions = getWeekSessions(progress.currentWeek, weeklyVolume);
    const runIdx = progress.currentSessionIndex || 0;
    const runS = progress.customRunSession || runSessions[runIdx];
    const sIdx = progress.strengthSessionIndex || 0;
    const strS = strengthEnabled
      ? (progress.customStrengthSession || getStrengthWeekSessions(progress.strengthWeek || 1, profile.strengthLevel || 'returning', progress.strengthRepScale || 1)[sIdx])
      : null;
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
    ctx.plan = {
      todayIs: plan.type,            // 'run' | 'strength' | 'rest'
      todayLabel: plan.label,
      restDays: (settings.restDays || []).map(d => dayNames[d]),
      guided: settings.guidedPlan !== false,
      customRunActive: !!progress.customRunSession,
      customStrengthActive: !!progress.customStrengthSession,
      nextRun: runS ? {
        title: runS.title, focus: runS.focus,
        durationMin: Math.round(runS.totalSeconds / 60),
        letter: progress.customRunSession ? 'su misura' : (['A', 'B', 'C', 'D', 'E'][runIdx]),
        week: progress.currentWeek,
        // Fasi REALI della sessione che partirà (custom o standard): mai inventare
        phases: Array.isArray(runS.phases)
          ? runS.phases.map(p => `${p.type} ${Math.round(p.seconds / 60)}min`) : undefined,
      } : null,
      nextStrength: strS ? {
        title: strS.title, focus: strS.focus,
        session: progress.customStrengthSession ? 'su misura' : ['S1', 'S2', 'S3'][sIdx],
        week: progress.strengthWeek, estimatedMinutes: strS.estimatedMinutes,
        // Esercizi REALI della sessione che partirà (custom o standard): mai inventare
        exercises: Array.isArray(strS.exercises)
          ? strS.exercises.map(e => `${e.name} ${e.sets}×${e.reps}${e.unilateral ? ' per lato' : ''}`) : undefined,
      } : null,
    };
    // Catalogo esercizi forza disponibili (per le riscritture del coach)
    ctx.strengthCatalog = strengthCatalog();
  } catch { /* best effort: il piano è un extra */ }
  return ctx;
}

/** Chiama il Worker coach (debrief). Ritorna {data}, {skipped} o {error}. Mai lancia. */
async function fetchCoach() {
  const s = getSettings();
  if (!s.coachEnabled || !s.coachUrl) return { skipped: true };
  try {
    const url = s.coachUrl.replace(/\/+$/, '') + '/coach';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(s.coachToken ? { 'X-RunFit-Token': s.coachToken } : {}),
      },
      body: JSON.stringify({ context: buildCoachContext() }),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json();
    if (!data || !data.debrief) return { error: 'risposta vuota' };
    return { data };
  } catch (e) {
    return { error: (e && e.message) || 'rete' };
  }
}

/**
 * Applica l'aggiustamento del coach. Il coach ha pieno controllo della
 * progressione (al posto dei guardrail rigidi dell'algoritmo); restano solo
 * limiti AMPI anti-rottura. Il vero freno è il giudizio del coach (system prompt).
 * - forza: repScaleDelta (intensità, ±0.4/chiamata) + weekDelta (settimana, ±2)
 *   accumulati in bias persistenti → ricalcolo.
 * - corsa: weekDelta sulla settimana corsa (±1/chiamata, più prudente: impatto).
 * - flag "medical": nessuna modifica.
 * Ritorna un riepilogo di cosa è stato applicato (o null).
 */
function applyCoachAdjustment(adj, flag) {
  if (!adj || flag === 'medical') return null;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const dom = adj.domain || 'none';
  const progress = getProgress();
  const parts = [];

  if (dom === 'strength' || dom === 'both') {
    const delta = clamp(Number(adj.repScaleDelta) || 0, -0.4, 0.4);
    const wk = clamp(parseInt(adj.weekDelta) || 0, -2, 2);
    if (delta) progress.coachRepScaleBias = clamp((progress.coachRepScaleBias || 0) + delta, -0.5, 1.0);
    if (wk) progress.coachWeekBias = clamp((progress.coachWeekBias || 0) + wk, -4, 6);
    if (delta || wk) parts.push('strength');
  }
  if (dom === 'run' || dom === 'both') {
    const wk = clamp(parseInt(adj.weekDelta) || 0, -1, 1); // corsa: 1 settimana/volta (regola 10%)
    if (wk) {
      progress.currentWeek = clamp((progress.currentWeek || 1) + wk, 1, 12);
      progress.currentSessionIndex = 0;
      parts.push('run');
    }
  }
  saveProgress(progress);

  let strengthState = null;
  if (parts.includes('strength')) strengthState = applyStrengthProgress();
  if (!parts.length) return null;
  return {
    domain: parts.length > 1 ? 'both' : parts[0],
    repScalePct: strengthState ? Math.round(strengthState.strengthRepScale * 100) : null,
    strengthWeek: strengthState ? strengthState.strengthWeek : null,
    runWeek: parts.includes('run') ? getProgress().currentWeek : null,
  };
}

/**
 * Applica una RISCRITTURA della prossima sessione di corsa proposta dal coach.
 * Valida le fasi e salva una sessione custom in progress.customRunSession (usata
 * dalla Home/SessionRunner al posto di quella generata; consumata dopo l'uso).
 * Ritorna la sessione custom o null se non valida.
 */
function applyRunRewrite(rw) {
  if (!rw || !Array.isArray(rw.phases) || !rw.phases.length) return null;
  const KINDS = ['warmup', 'walk', 'brisk', 'jog', 'run', 'cooldown'];
  const ZONE = { warmup: 1, cooldown: 1, walk: 1, brisk: 2, jog: 3, run: 4 };
  const CUE = {
    warmup: 'Riscaldamento: cammina rilassato. Respira profondo.',
    cooldown: 'Defaticamento: cammina lentamente. Ottimo lavoro.',
    walk: 'Cammina rilassato, recupera il respiro.',
    brisk: 'Passo veloce: cammina come se fossi in ritardo.',
    jog: 'Corsa leggera: respiro controllato, parla a frasi brevi.',
    run: 'Corsa sostenuta ma controllata.',
  };
  const phases = rw.phases
    .filter(p => p && KINDS.includes(p.kind) && Number(p.minutes) > 0)
    .slice(0, 40)
    .map(p => ({
      type: p.kind,
      seconds: Math.min(60 * 60, Math.round(Number(p.minutes) * 60)),
      targetZone: ZONE[p.kind],
      cue: (p.cue && String(p.cue).slice(0, 140)) || CUE[p.kind],
    }));
  if (!phases.length) return null;
  const totalSeconds = phases.reduce((s, p) => s + p.seconds, 0);
  if (totalSeconds < 300 || totalSeconds > 5400) return null; // 5-90 min, anti-assurdità
  const custom = {
    id: 'run-custom-' + Date.now(),
    title: (rw.title || 'Corsa su misura').toString().slice(0, 60),
    focus: (rw.focus || 'Personalizzata dal coach').toString().slice(0, 60),
    phases, totalSeconds, custom: true,
  };
  const progress = getProgress();
  progress.customRunSession = custom;
  saveProgress(progress);
  return custom;
}

/**
 * Applica una RISCRITTURA della prossima sessione di forza proposta dal coach.
 * Risolve gli esercizi dal catalogo, valida e salva progress.customStrengthSession.
 * Ritorna la sessione custom o null.
 */
function applyStrengthRewrite(rw) {
  if (!rw || !Array.isArray(rw.exercises) || !rw.exercises.length) return null;
  const custom = buildCustomStrengthSession(
    (rw.title || 'Forza su misura').toString().slice(0, 60),
    (rw.focus || 'Personalizzata dal coach').toString().slice(0, 60),
    rw.exercises,
  );
  if (!custom) return null;
  custom.id = 'str-custom-' + Date.now();
  const progress = getProgress();
  progress.customStrengthSession = custom;
  saveProgress(progress);
  return custom;
}

/** Frase leggibile di cosa ha cambiato il coach (per debrief/chat). */
function coachChangeSummary(applied, rewriteRun, rewriteStr) {
  const bits = [];
  if (applied) {
    if (applied.repScalePct != null) bits.push(`intensità forza ${applied.repScalePct}%`);
    if (applied.strengthWeek != null && (applied.domain === 'strength' || applied.domain === 'both')) bits.push(`settimana forza ${applied.strengthWeek}`);
    if (applied.runWeek != null) bits.push(`settimana corsa ${applied.runWeek}`);
  }
  if (rewriteRun) bits.push(`prossima corsa riscritta: "${rewriteRun.title}" (${Math.round(rewriteRun.totalSeconds / 60)} min)`);
  if (rewriteStr) bits.push(`prossima forza riscritta: "${rewriteStr.title}" (${rewriteStr.exercises.length} esercizi)`);
  return bits.length ? '✓ Aggiornato: ' + bits.join(' · ') : null;
}

const PHASE_LABEL = {
  warmup: 'Riscaldamento', cooldown: 'Defaticamento', walk: 'Cammina',
  brisk: 'Cammino veloce', jog: 'Jog', run: 'Corsa',
};

/**
 * Testo leggibile (multiriga) della/e sessione/i create dal coach, così Daniele
 * le VEDE in chat o nel debrief invece di un semplice "✓ Aggiornato".
 */
function rewriteDetailText(rewriteRun, rewriteStr) {
  const blocks = [];
  if (rewriteRun && Array.isArray(rewriteRun.phases)) {
    const phs = rewriteRun.phases
      .map(p => `• ${PHASE_LABEL[p.type] || p.type} — ${Math.round(p.seconds / 60)} min`).join('\n');
    blocks.push(`🏃 ${rewriteRun.title}\n${phs}`);
  }
  if (rewriteStr && Array.isArray(rewriteStr.exercises)) {
    const exs = rewriteStr.exercises
      .map(e => `• ${e.name} — ${e.sets}×${e.reps}`).join('\n');
    blocks.push(`💪 ${rewriteStr.title}\n${exs}`);
  }
  return blocks.length ? blocks.join('\n\n') : null;
}

function flagBadge(flag) {
  if (flag === 'medical') return el('span', { class: 'coach-flag coach-flag-medical' }, '⚠️ Attenzione medica');
  if (flag === 'caution') return el('span', { class: 'coach-flag coach-flag-caution' }, '⏸ Cautela');
  return null;
}

// --- Chat libera col coach -------------------------------------------------
let coachChat = []; // {role:'user'|'assistant', content, pending?}

function renderCoachChat() {
  const container = $('#view-coach');
  container.innerHTML = '';
  const s = getSettings();

  const header = el('div', { class: 'chat-header' },
    el('button', { class: 'btn btn-ghost btn-back', onclick: () => setView('home') }, '‹ Home'),
    el('div', { class: 'chat-title' }, '🤖 Coach'),
    el('button', { class: 'icon-btn', title: 'Nuova conversazione', onclick: () => { coachChat = []; renderCoachChat(); } }, '🗑'),
  );

  if (!s.coachEnabled || !s.coachUrl) {
    container.appendChild(el('div', { class: 'chat-view' }, header,
      el('div', { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, '🤖'),
        el('div', {}, 'Attiva il Coach AI in Profilo per poterci chattare.'),
        el('button', { class: 'btn btn-primary', onclick: () => setView('profile') }, 'Vai al Profilo'),
      )));
    return;
  }

  const msgs = el('div', { class: 'chat-messages' });
  if (!coachChat.length) {
    msgs.appendChild(el('div', { class: 'chat-intro' },
      'Ciao Daniele! Chiedimi quello che vuoi — "posso allenarmi oggi?", "come sto andando?", dubbi su un esercizio, un fastidio. Vedo i tuoi dati.'));
  }
  coachChat.forEach(m => msgs.appendChild(
    el('div', { class: `chat-msg chat-${m.role}${m.pending ? ' chat-pending' : ''}` }, m.content)));

  const input = el('textarea', { class: 'chat-input', rows: '1', placeholder: 'Scrivi al coach…' });
  const send = () => {
    const text = input.value.trim();
    if (!text || coachChat.some(m => m.pending)) return;
    input.value = '';
    sendChatMessage(text);
  };
  const sendBtn = el('button', { class: 'btn btn-primary chat-send', onclick: send }, '➤');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  container.appendChild(el('div', { class: 'chat-view' },
    header, msgs,
    el('div', { class: 'chat-inputbar' }, input, sendBtn),
  ));
  requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
}

async function sendChatMessage(text) {
  coachChat.push({ role: 'user', content: text });
  coachChat.push({ role: 'assistant', content: 'sto pensando…', pending: true });
  renderCoachChat();
  const s = getSettings();
  let reply;
  try {
    const url = s.coachUrl.replace(/\/+$/, '') + '/chat';
    const payloadMsgs = coachChat.filter(m => !m.pending).map(m => ({ role: m.role, content: m.content }));
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(s.coachToken ? { 'X-RunFit-Token': s.coachToken } : {}) },
      body: JSON.stringify({ context: buildCoachContext(), messages: payloadMsgs }),
    });
    const data = await res.json().catch(() => ({}));
    reply = res.ok && data.reply ? data.reply : `⚠️ ${data.error || 'errore'}${data.detail ? ': ' + data.detail : ''}`;
    // Il coach può modificare il programma dalla chat: intensità/settimana e/o
    // riscrivere la prossima sessione di corsa o di forza
    if (res.ok && (data.change || data.rewriteRun || data.rewriteStrength)) {
      const applied = data.change ? applyCoachAdjustment(data.change, data.flag) : null;
      const rewriteRun = data.rewriteRun ? applyRunRewrite(data.rewriteRun) : null;
      const rewriteStr = data.rewriteStrength ? applyStrengthRewrite(data.rewriteStrength) : null;
      const summary = coachChangeSummary(applied, rewriteRun, rewriteStr);
      if (summary) reply += '\n\n' + summary;
      const detail = rewriteDetailText(rewriteRun, rewriteStr);
      if (detail) reply += '\n\n' + detail;
    } else if (res.ok && data.truncated) {
      // Risposta interrotta dal limite di token senza che i tool partissero
      reply += '\n\n⚠️ Risposta interrotta. Chiedimi una cosa per volta (es. solo la forza) e te la preparo per intero.';
    }
  } catch {
    reply = '⚠️ Coach non raggiungibile (sei offline?).';
  }
  coachChat = coachChat.filter(m => !m.pending);
  coachChat.push({ role: 'assistant', content: reply });
  renderCoachChat();
}

/** Test di connessione al Worker dal Profilo. */
function testCoachConnection() {
  toast('🤖 Contatto il coach…');
  fetchCoach().then(r => {
    if (r.skipped) toast('Coach non configurato (URL mancante?)');
    else if (r.error) toast(`Errore: ${r.error}`);
    else toast('✓ Coach raggiungibile!');
  });
}

/** Inserisce la card del coach nella schermata risultati e avvia il fetch. */
function mountCoachDebrief() {
  const s = getSettings();
  if (!s.coachEnabled || !s.coachUrl) return;
  const screen = document.querySelector('#view-workout .results-screen');
  if (!screen) return;
  const actions = screen.querySelector('.results-actions');
  const card = el('div', { class: 'coach-card coach-loading' },
    el('div', { class: 'coach-head' },
      el('span', { class: 'coach-avatar' }, '🤖'),
      el('span', { class: 'coach-title' }, 'Il coach sta analizzando…'),
    ),
  );
  if (actions) screen.insertBefore(card, actions);
  else screen.appendChild(card);

  fetchCoach().then(r => {
    if (r.skipped) { card.remove(); return; }
    if (r.error || !r.data) {
      card.className = 'coach-card coach-error';
      card.innerHTML = '';
      card.appendChild(el('div', { class: 'coach-head' },
        el('span', { class: 'coach-avatar' }, '🤖'),
        el('span', { class: 'coach-title' }, 'Coach non disponibile'),
      ));
      card.appendChild(el('div', { class: 'coach-sub' },
        'Debrief AI non raggiungibile (offline o errore). L\'allenamento è salvato e la progressione aggiornata comunque.'));
      return;
    }
    const d = r.data;
    // Il coach valuta E prepara le prossime sessioni: applica le sue azioni
    const applied = d.change ? applyCoachAdjustment(d.change, null) : null;
    const rewriteRun = d.rewriteRun ? applyRunRewrite(d.rewriteRun) : null;
    const rewriteStr = d.rewriteStrength ? applyStrengthRewrite(d.rewriteStrength) : null;
    card.className = 'coach-card';
    card.innerHTML = '';
    card.appendChild(el('div', { class: 'coach-head' },
      el('span', { class: 'coach-avatar' }, '🤖'),
      el('span', { class: 'coach-title' }, 'Il tuo coach'),
    ));
    card.appendChild(el('div', { class: 'coach-debrief' }, d.debrief || ''));
    const summary = coachChangeSummary(applied, rewriteRun, rewriteStr);
    if (summary) {
      card.appendChild(el('div', { class: 'coach-applied' }, summary));
    }
    const detail = rewriteDetailText(rewriteRun, rewriteStr);
    if (detail) {
      card.appendChild(el('div', { class: 'coach-session-detail' }, detail));
    }
  });
}

function showStrengthResultsScreen(record) {
  const container = $('#view-workout');
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'results-screen' },
    el('div', { class: 'results-trophy' }, '💪'),
    el('h2', {}, 'Forza completata!'),
    el('div', { class: 'results-grid' },
      kpiCard('Tempo', `${record.durationMin}'`, '⏱'),
      kpiCard('Serie', `${record.completedSets}/${record.totalSets}`, '✓'),
      kpiCard('Calorie', `${record.kcal || '—'}`, '🔋'),
      kpiCard('RPE', record.rpe, '💪'),
    ),
    el('div', { class: 'results-actions' },
      el('button', { class: 'btn btn-strength', onclick: () => setView('home') }, 'Torna alla Home'),
      el('button', { class: 'btn btn-ghost', onclick: () => setView('stats') }, 'Vedi statistiche'),
    ),
  ));
  mountCoachDebrief();
}

function renderWorkout() {
  // Se non c'è una sessione attiva, mostra splash invito
  if (!currentRunner || !currentRunner.running) {
    const container = $('#view-workout');
    if (!container.children.length) {
      container.appendChild(el('div', { class: 'empty-state' },
        el('div', {}, 'Nessuna sessione attiva.'),
        el('button', { class: 'btn btn-primary', onclick: () => setView('home') }, 'Vai alla Home'),
      ));
    }
  }
}

// --- View: Storico ---------------------------------------------------------
function renderHistory() {
  const container = $('#view-history');
  container.innerHTML = '';
  const sessions = getSessions().slice().reverse();
  if (!sessions.length) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '📋'),
      el('div', {}, 'Ancora nessuna sessione. La prima sessione apparirà qui.'),
    ));
    return;
  }
  container.appendChild(el('h2', { class: 'view-title' }, 'Storico sessioni'));
  // Raggruppa per settimana
  const byWeek = {};
  sessions.forEach(s => {
    const w = `S${s.week}`;
    (byWeek[w] = byWeek[w] || []).push(s);
  });
  for (const [w, list] of Object.entries(byWeek)) {
    container.appendChild(el('div', { class: 'history-week' },
      el('div', { class: 'history-week-title' }, w),
      ...list.map(historyCard),
    ));
  }
}

function historyCard(s) {
  const isStrength = s.type === 'strength';
  const pace = s.paceSecPerKm ? fmtPace(s.paceSecPerKm) : null;
  return el('div', { class: `card history-card ${isStrength ? 'history-strength' : 'history-run'}` },
    el('div', { class: 'history-card-top' },
      el('span', { class: 'history-badge' }, isStrength ? '💪 Forza' : '🏃 Corsa'),
      el('span', { class: 'history-card-date' }, fmtDate(s.completedAt)),
    ),
    el('div', { class: 'history-card-body', onclick: () => showSessionEditor(s) },
      el('div', { class: 'history-card-title' }, s.title),
      el('div', { class: 'history-card-stats' },
        el('span', {}, `${s.durationMin}'`),
        el('span', { class: 'dot' }, '·'),
        el('span', {}, `RPE ${s.rpe}`),
        isStrength && s.totalSets ? el('span', { class: 'dot' }, '·') : null,
        isStrength && s.totalSets ? el('span', {}, `${s.completedSets || 0}/${s.totalSets} serie`) : null,
        s.avgHr ? el('span', { class: 'dot' }, '·') : null,
        s.avgHr ? el('span', {}, `${s.avgHr}${s.maxHr ? '/' + s.maxHr : ''} bpm`) : null,
        s.kcal ? el('span', { class: 'dot' }, '·') : null,
        s.kcal ? el('span', { title: s.kcalSource === 'apple-watch' ? 'Da Apple Watch' : 'Stima' }, `${s.kcal} kcal${s.kcalSource === 'apple-watch' ? ' ⌚' : ''}`) : null,
        s.km ? el('span', { class: 'dot' }, '·') : null,
        s.km ? el('span', {}, `${s.km} km`) : null,
        pace ? el('span', { class: 'dot' }, '·') : null,
        pace ? el('span', {}, `${pace}/km`) : null,
        s.cadence ? el('span', { class: 'dot' }, '·') : null,
        s.cadence ? el('span', {}, `${s.cadence} spm`) : null,
        s.elevationGain ? el('span', { class: 'dot' }, '·') : null,
        s.elevationGain ? el('span', {}, `↗ ${s.elevationGain}m`) : null,
      ),
      s.notes ? el('div', { class: 'history-card-notes' }, s.notes) : null,
      el('div', { class: 'history-card-hint' }, 'Tocca per dettagli e modifica'),
    ),
    el('button', {
      class: 'icon-btn history-delete',
      onclick: (e) => {
        e.stopPropagation();
        if (confirm('Eliminare questa sessione?')) {
          deleteSession(s.id);
          if (s.type === 'strength') applyStrengthProgress(); // riallinea la progressione
          renderHistory();
        }
      },
    }, '🗑'),
  );
}

// --- Dettaglio + modifica sessione (con ricalcolo derivati) ----------------
function showSessionEditor(s) {
  const isStrength = s.type === 'strength';
  const container = $('#view-history');
  container.innerHTML = '';

  // Stato precompilato dai valori salvati
  const st = {
    rpe: s.rpe || 6,
    durationMin: s.durationMin != null ? String(s.durationMin) : '',
    avgHr: s.avgHr != null ? String(s.avgHr) : '',
    maxHr: s.maxHr != null ? String(s.maxHr) : '',
    activeKcal: s.kcalSource === 'apple-watch' && s.kcal != null ? String(s.kcal) : '',
    km: s.km != null ? String(s.km) : '',
    paceMinPerKm: s.paceSecPerKm ? fmtPace(s.paceSecPerKm) : '',
    elevationGain: s.elevationGain != null ? String(s.elevationGain) : '',
    cadence: s.cadence != null ? String(s.cadence) : '',
    strideM: s.strideM != null ? String(s.strideM) : '',
    timeZ2: s.timeInZoneSec?.z2 != null ? String(Math.round(s.timeInZoneSec.z2 / 60)) : '',
    timeZ3: s.timeInZoneSec?.z3 != null ? String(Math.round(s.timeInZoneSec.z3 / 60)) : '',
    notes: s.notes || '',
  };

  // Input numerico con valore iniziale
  const numInput = (key, opts = {}) => {
    const i = el('input', {
      type: opts.type || 'number',
      inputmode: opts.inputmode || 'decimal',
      step: opts.step || '0.1', min: '0',
      value: st[key], class: 'feedback-input',
      ...(opts.max ? { max: opts.max } : {}),
    });
    i.addEventListener('input', e => { st[key] = e.target.value; });
    return i;
  };
  // Input passo con valore iniziale (riusa parsePaceToSec, accetta virgola)
  const paceField = () => {
    const i = el('input', {
      type: 'text', inputmode: 'decimal', placeholder: '9:19 o 9,19',
      value: st.paceMinPerKm, class: 'feedback-input', pattern: '[0-9:.,]*',
    });
    i.addEventListener('input', e => { st.paceMinPerKm = e.target.value; });
    return i;
  };

  const rpeDisplay = el('div', { class: 'rpe-display' }, String(st.rpe));
  const rpeLabel = el('div', { class: 'rpe-label' }, rpeText(st.rpe));
  const rpeSlider = el('input', { type: 'range', min: '1', max: '10', value: String(st.rpe), class: 'rpe-slider' });
  rpeSlider.addEventListener('input', e => {
    st.rpe = parseInt(e.target.value);
    rpeDisplay.textContent = st.rpe;
    rpeLabel.textContent = rpeText(st.rpe);
  });

  const notesInput = el('textarea', { class: 'feedback-input', rows: '3', placeholder: 'Note libere…' }, );
  notesInput.value = st.notes;
  notesInput.addEventListener('input', e => { st.notes = e.target.value; });

  // --- Ripetizioni per esercizio (solo forza) — editabili, muovono l'algoritmo ---
  const repsLog = isStrength && Array.isArray(s.completedSetsLog)
    ? s.completedSetsLog.map(x => ({ ...x }))
    : null;
  let repsSection = null;
  if (repsLog && repsLog.length) {
    // Raggruppa le serie per esercizio mantenendo l'ordine di esecuzione
    const groups = [];
    const byKey = {};
    repsLog.forEach((entry, i) => {
      let g = byKey[entry.exerciseKey];
      if (!g) { g = byKey[entry.exerciseKey] = { name: entry.exerciseName, items: [] }; groups.push(g); }
      g.items.push({ entry, i });
    });
    const ratioBadge = el('span', { class: 'reps-ratio-badge' });
    const refreshRatio = () => {
      const r = sessionRepRatio(repsLog);
      ratioBadge.textContent = r != null ? `media ${Math.round(r * 100)}% del target` : '';
    };
    repsSection = el('div', { class: 'feedback-section' },
      el('label', { class: 'feedback-label' }, '🏋️ Ripetizioni per esercizio', ratioBadge),
      el('div', { class: 'feedback-hint' }, 'Correggi le reps reali serie per serie: l\'algoritmo ritara settimana e intensità delle prossime sessioni in base a quanto superi il target.'),
      ...groups.map(g => el('div', { class: 'reps-edit-group' },
        el('div', { class: 'reps-edit-ex' }, g.name),
        el('div', { class: 'reps-edit-rows' },
          ...g.items.map(({ entry, i }) => {
            const inp = el('input', {
              type: 'number', inputmode: 'numeric', min: '0', max: '500', step: '1',
              value: entry.actualReps != null ? String(entry.actualReps) : '',
              class: 'feedback-input reps-edit-input',
            });
            inp.addEventListener('input', e => {
              const v = parseInt(e.target.value);
              repsLog[i].actualReps = Number.isFinite(v) ? v : null;
              refreshRatio();
            });
            return el('div', { class: 'reps-edit-cell' },
              el('span', { class: 'reps-edit-set' }, entry.side ? `S${entry.setNumber} ${entry.side}` : `S${entry.setNumber}`),
              inp,
              el('span', { class: 'reps-edit-target' }, `/ ${entry.targetReps}`),
            );
          }),
        ),
      )),
    );
    refreshRatio();
  }

  // ESSENZIALI: gli unici che servono (FC media → algoritmo; gli altri per le statistiche)
  const essentialFields = isStrength
    ? el('div', { class: 'feedback-grid' },
        fieldWrap('Durata', numInput('durationMin', { type: 'number', inputmode: 'numeric', step: '1' }), 'min'),
        fieldWrap('FC media', numInput('avgHr', { type: 'number', inputmode: 'numeric', step: '1', max: '220' }), 'bpm'),
        fieldWrap('Calorie attive', numInput('activeKcal', { type: 'number', inputmode: 'numeric', step: '1' }), 'kcal'),
      )
    : el('div', { class: 'feedback-grid' },
        fieldWrap('Durata', numInput('durationMin', { type: 'number', inputmode: 'numeric', step: '1' }), 'min'),
        fieldWrap('FC media', numInput('avgHr', { type: 'number', inputmode: 'numeric', step: '1', max: '220' }), 'bpm'),
        fieldWrap('FC max', numInput('maxHr', { type: 'number', inputmode: 'numeric', step: '1', max: '220' }), 'bpm'),
        fieldWrap('Calorie attive', numInput('activeKcal', { type: 'number', inputmode: 'numeric', step: '1' }), 'kcal'),
        fieldWrap('Distanza', numInput('km', { step: '0.01' }), 'km'),
        fieldWrap('Passo medio', paceField(), 'min/km'),
      );

  // OPZIONALI: non servono all'algoritmo, nascosti dietro toggle
  const optionalGrid = isStrength ? null : el('div', { class: 'feedback-grid advanced-grid' },
    fieldWrap('Dislivello', numInput('elevationGain', { type: 'number', inputmode: 'numeric', step: '1' }), 'm'),
    fieldWrap('Cadenza', numInput('cadence', { type: 'number', inputmode: 'numeric', step: '1' }), 'spm'),
    fieldWrap('Tempo Z2', numInput('timeZ2', { type: 'number', inputmode: 'numeric', step: '1' }), 'min'),
    fieldWrap('Tempo Z3', numInput('timeZ3', { type: 'number', inputmode: 'numeric', step: '1' }), 'min'),
  );
  let optionalSection = null;
  if (optionalGrid) {
    const optToggle = el('button', { class: 'advanced-toggle', type: 'button' },
      '▼ Dati extra (opzionali — non servono all\'algoritmo)');
    let open = false;
    optionalGrid.style.display = 'none';
    optToggle.addEventListener('click', () => {
      open = !open;
      optionalGrid.style.display = open ? 'grid' : 'none';
      optToggle.textContent = open ? '▲ Nascondi extra' : '▼ Dati extra (opzionali — non servono all\'algoritmo)';
    });
    optionalSection = el('div', { class: 'feedback-section' }, optToggle, optionalGrid);
  }

  container.appendChild(el('div', { class: 'feedback-screen editor-screen' },
    el('div', { class: 'editor-topbar' },
      el('button', { class: 'btn btn-ghost btn-back', onclick: () => { setView('history'); } }, '‹ Storico'),
      el('div', { class: 'editor-title' }, 'Modifica sessione'),
    ),
    el('div', { class: 'editor-meta' },
      el('div', { class: 'editor-meta-title' }, s.title),
      el('div', { class: 'editor-meta-sub' }, `${isStrength ? '💪 Forza' : '🏃 Corsa'} · ${fmtDate(s.completedAt)} · S${s.week}`),
    ),
    el('div', { class: 'feedback-section' },
      el('label', { class: 'feedback-label' }, 'Fatica (RPE 1-10)'),
      el('div', { class: 'feedback-hint' }, 'È il dato che muove l\'algoritmo: metti la TUA percezione onesta.'),
      el('div', { class: 'rpe-row' }, rpeDisplay, rpeLabel),
      rpeSlider,
    ),
    el('div', { class: 'feedback-section' },
      el('label', { class: 'feedback-label' }, '📊 Dati essenziali'),
      el('div', { class: 'feedback-hint' }, 'Passo, calorie e zone vengono ricalcolati al salvataggio.'),
      essentialFields,
    ),
    repsSection,
    optionalSection,
    el('div', { class: 'feedback-section' },
      el('label', { class: 'feedback-label' }, 'Note'),
      notesInput,
    ),
    el('div', { class: 'editor-actions' },
      el('button', { class: 'btn btn-ghost', onclick: () => setView('history') }, 'Annulla'),
      el('button', { class: 'btn btn-primary', onclick: () => {
        const updated = recomputeSessionRecord(s, st, repsLog);
        updateSession(updated);
        if (isStrength) {
          const state = applyStrengthProgress();
          toast(`💪 Progressione aggiornata · settimana ${state.strengthWeek}, intensità ${Math.round(state.strengthRepScale * 100)}%`);
        }
        setView('history');
      } }, 'Salva modifiche'),
    ),
  ));
}

// Ricalcola i campi derivati (passo, calorie, durata, zone) dai valori grezzi
function recomputeSessionRecord(orig, st, repsLog = null) {
  const profile = getProfile();
  const durationMin = parseFloatOrNull(st.durationMin) != null ? parseFloatOrNull(st.durationMin) : orig.durationMin;
  const durationSec = Math.round((durationMin || 0) * 60) || orig.durationSec;
  const avgHr = parseIntOrNull(st.avgHr);
  const maxHr = parseIntOrNull(st.maxHr);
  const activeKcal = parseIntOrNull(st.activeKcal);

  // Ricalcolo calorie: Apple Watch > Keytel (HR) > mantieni stima precedente
  let kcal, kcalSource;
  if (activeKcal) {
    kcal = activeKcal; kcalSource = 'apple-watch';
  } else if (avgHr) {
    kcal = kcalKeytel({
      avgHr, weightKg: profile.weightCurrentKg, age: getAge(),
      durationMin: durationMin || orig.durationMin, isMale: profile.isMale,
    });
    kcalSource = 'keytel';
  } else {
    kcal = orig.kcal; kcalSource = orig.kcalSource;
  }

  return {
    ...orig,
    rpe: st.rpe,
    notes: st.notes,
    durationSec,
    durationMin: Math.round((durationMin || 0) * 10) / 10,
    avgHr, maxHr,
    km: parseFloatOrNull(st.km),
    paceSecPerKm: parsePaceToSec(st.paceMinPerKm),
    elevationGain: parseIntOrNull(st.elevationGain),
    cadence: parseIntOrNull(st.cadence),
    strideM: parseFloatOrNull(st.strideM),
    timeInZoneSec: {
      z2: minToSec(parseFloatOrNull(st.timeZ2)),
      z3: minToSec(parseFloatOrNull(st.timeZ3)),
    },
    kcal, kcalSource,
    // Reps modificate (se passate): aggiorna il log e ricaches il numero di serie completate
    ...(repsLog ? { completedSetsLog: repsLog, completedSets: repsLog.length } : {}),
    editedAt: new Date().toISOString(),
  };
}

function fmtPace(secPerKm) {
  if (!secPerKm) return '—';
  const m = Math.floor(secPerKm / 60);
  const s = secPerKm % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// --- View: Statistiche ----------------------------------------------------
// Blocco VERDETTO in cima: legge i dati e dice a colpo d'occhio come va,
// con segnali chiave (peso, FC, passo, Zona 2). Risolve il "data-dump".
function renderStatsInsight(sessions, weights, profile) {
  const signals = [];

  // Peso: l'obiettivo. Giù = bene.
  if (weights.length) {
    const cur = weights[weights.length - 1].kg;
    const start = (profile.weightStartKg ?? weights[0].kg);
    const d = +(cur - start).toFixed(1);
    if (Math.abs(d) >= 0.1) {
      signals.push({ key: 'weight', label: 'Peso',
        value: (d < 0 ? '−' : '+') + Math.abs(d).toFixed(1) + ' kg',
        dir: d < 0 ? 'good' : 'bad' });
    }
  }

  // FC media sulle CORSE con cardio (non la forza). Giù = cuore più efficiente.
  const th = halfTrend(sessions.filter(s => s.type === 'run' && s.avgHr).map(s => s.avgHr));
  if (th && Math.abs(th.delta) >= 1) {
    signals.push({ key: 'hr', label: 'FC media',
      value: (th.delta < 0 ? '−' : '+') + Math.abs(Math.round(th.delta)) + ' bpm',
      dir: th.delta < 0 ? 'good' : 'bad' });
  }

  // Passo (sec/km). Giù = più veloce.
  const tp = halfTrend(sessions.filter(s => s.paceSecPerKm).map(s => s.paceSecPerKm));
  if (tp && Math.abs(tp.delta) >= 3) {
    signals.push({ key: 'pace', label: 'Passo',
      value: (tp.delta < 0 ? '−' : '+') + Math.abs(Math.round(tp.delta)) + ' s/km',
      dir: tp.delta < 0 ? 'good' : 'bad' });
  }

  // Zona 2 nell'ultima settimana. Più = meglio (zona brucia-grassi).
  const z2Sessions = sessions.filter(s => s.timeInZoneSec?.z2);
  if (z2Sessions.length) {
    const lastWeek = Math.max(...z2Sessions.map(s => s.week || 1));
    const z2min = Math.round(z2Sessions.filter(s => (s.week || 1) === lastWeek)
      .reduce((sum, s) => sum + s.timeInZoneSec.z2 / 60, 0));
    if (z2min > 0) signals.push({ key: 'z2', label: 'Zona 2 (sett.)', value: z2min + ' min', dir: 'good' });
  }

  const good = signals.filter(s => s.dir === 'good').length;
  const weightUpAtStart = signals.some(s => s.key === 'weight' && s.dir === 'bad') && weights.length <= 6;

  let verdict, vclass;
  if (good >= 2) { verdict = 'Stai migliorando'; vclass = 'good'; }
  else if (good === 1) { verdict = 'Sulla strada giusta'; vclass = 'good'; }
  else if (sessions.length < 3) { verdict = 'Buon avvio'; vclass = 'neutral'; }
  else { verdict = 'Tieni la rotta'; vclass = 'neutral'; }

  let sub;
  if (weightUpAtStart) sub = 'Il peso sale all\'inizio (acqua e glicogeno muscolare): è fisiologico, si inverte nelle prossime settimane.';
  else if (good >= 1) sub = 'I segnali chiave vanno nella direzione giusta. Continua col carico attuale.';
  else sub = 'I trend si formano con più sessioni: la costanza viene prima dell\'intensità.';

  const signalRow = el('div', { class: 'insight-signals' },
    ...signals.map(s => {
      const arrow = s.key === 'z2' ? 'arrowUp' : (s.dir === 'good' ? 'arrowDown' : 'arrowUp');
      return el('div', { class: 'signal signal-' + s.dir },
        svgIcon(arrow, 14),
        el('span', { class: 'signal-label' }, s.label),
        el('span', { class: 'signal-value' }, s.value));
    }),
  );

  return el('div', { class: 'insight insight-' + vclass },
    el('div', { class: 'insight-head' },
      el('span', { class: 'insight-badge' }, svgIcon(vclass === 'good' ? 'arrowUp' : 'arrowRight', 18)),
      el('span', { class: 'insight-verdict' }, verdict),
    ),
    el('div', { class: 'insight-sub' }, sub),
    signals.length ? signalRow : null,
  );
}

function renderStats() {
  const container = $('#view-stats');
  container.innerHTML = '';
  const sessions = getSessions();
  if (!sessions.length) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '📊'),
      el('div', {}, 'Le statistiche compariranno dopo la prima sessione.'),
    ));
    return;
  }

  const profile = getProfile();
  const weights = getWeights();
  const runSessions = sessions.filter(s => s.type !== 'strength');
  const strSessions = sessions.filter(s => s.type === 'strength');

  container.appendChild(el('h2', { class: 'view-title' }, 'Statistiche & Progressione'));

  // 1) VERDETTO in cima (panoramica generale)
  container.appendChild(renderStatsInsight(sessions, weights, profile));

  // 2) TOGGLE Corsa | Forza — i numeri di corsa e forza non vanno mischiati
  container.appendChild(el('div', { class: 'stats-toggle' },
    el('button', { class: 'stats-toggle-btn' + (statsMode === 'run' ? ' active' : ''),
      onclick: () => { statsMode = 'run'; renderStats(); } }, '🏃 Corsa'),
    el('button', { class: 'stats-toggle-btn' + (statsMode === 'strength' ? ' active' : ''),
      onclick: () => { statsMode = 'strength'; renderStats(); } }, '💪 Forza'),
  ));

  // Helper: card con canvas (drawCharts() la popola per id)
  const chartCard = (label, canvasId, hint) => el('div', { class: 'card chart-card' },
    el('div', { class: 'card-label' }, label),
    hint ? el('div', { class: 'chart-hint' }, hint) : null,
    el('canvas', { id: canvasId, height: '200' }),
  );

  const modeSessions = statsMode === 'strength' ? strSessions : runSessions;
  if (!modeSessions.length) {
    container.appendChild(el('div', { class: 'card' }, el('div', { class: 'chart-hint' },
      statsMode === 'strength' ? 'Nessuna sessione di forza registrata ancora.' : 'Nessuna corsa registrata ancora.')));
    requestAnimationFrame(() => drawCharts(sessions, statsMode));
    return;
  }

  if (statsMode === 'run') {
    // KPI corsa
    const runSec = runSessions.reduce((s, x) => s + (x.durationSec || 0), 0);
    const totalKm = runSessions.reduce((s, x) => s + (x.km || 0), 0);
    const paceVals = runSessions.filter(s => s.paceSecPerKm).map(s => s.paceSecPerKm);
    const avgPace = paceVals.length ? Math.round(paceVals.reduce((a, b) => a + b, 0) / paceVals.length) : null;
    const hrVals = runSessions.filter(s => s.avgHr).map(s => s.avgHr);
    const avgHr = hrVals.length ? Math.round(hrVals.reduce((a, b) => a + b, 0) / hrVals.length) : null;
    container.appendChild(el('div', { class: 'kpi-grid' },
      statKpi('Tempo corsa', fmtMinutes(runSec), 'clock'),
      statKpi('Distanza', `${totalKm.toFixed(1)} km`, 'ruler'),
      statKpi('Passo medio', avgPace ? fmtPace(avgPace) : '—', 'gauge'),
      statKpi('FC media', avgHr ? `${avgHr} bpm` : '—', 'heart'),
    ));

    // Peso (obiettivo, generale)
    if (weights.length > 1) container.appendChild(chartCard('Andamento peso', 'chart-weight'));
    else if (weights.length === 1) container.appendChild(bigStat('Peso', `${weights[0].kg.toFixed(1)} kg`,
      `Target ${profile.weightTargetKg} kg. Registra il peso più volte per il trend.`));

    // Zona 2 (solo corse)
    const byWeekZ2 = {};
    runSessions.filter(s => s.timeInZoneSec?.z2).forEach(s => { byWeekZ2[s.week] = (byWeekZ2[s.week] || 0) + s.timeInZoneSec.z2 / 60; });
    const z2Weeks = Object.keys(byWeekZ2);
    if (z2Weeks.length >= 2) container.appendChild(chartCard('Volume Zona 2 per settimana (min)', 'chart-z2',
      'Tempo nella zona 110-128 bpm: la zona regina per bruciare grasso.'));
    else if (z2Weeks.length === 1) container.appendChild(bigStat('Zona 2 questa settimana', `${Math.round(byWeekZ2[z2Weeks[0]])} min`,
      'Minuti nella zona brucia-grassi (110-128 bpm). Il confronto arriva la prossima settimana.'));

    // Volume corsa settimanale
    const byWeekMin = {};
    runSessions.forEach(s => { byWeekMin[s.week] = (byWeekMin[s.week] || 0) + (s.durationMin || 0); });
    const weekKeys = Object.keys(byWeekMin);
    if (weekKeys.length >= 2) container.appendChild(chartCard('Volume corsa settimanale (min)', 'chart-volume'));
    else if (weekKeys.length === 1) container.appendChild(bigStat(`Corsa settimana ${weekKeys[0]}`, `${Math.round(byWeekMin[weekKeys[0]])} min`,
      'Minuti corsi. La prossima settimana si affiancherà per il confronto.'));

    // Passo
    const paceCount = paceVals.length;
    if (paceCount >= 3) container.appendChild(chartCard('Passo medio (min/km)', 'chart-pace',
      'La linea che scende vuol dire che stai diventando più veloce.'));
    else if (paceCount >= 1) container.appendChild(bigStat('Passo (ultima corsa)', fmtPace([...runSessions].reverse().find(s => s.paceSecPerKm).paceSecPerKm) + '/km',
      'Servono almeno 3 corse per il trend del passo.'));

    // FC media (solo corse)
    if (hrVals.length >= 3) container.appendChild(chartCard('Frequenza cardiaca media (corsa)', 'chart-hr',
      'A parità di passo, una FC più bassa significa cuore più efficiente.'));
    else if (hrVals.length >= 1) container.appendChild(bigStat('FC media (ultima corsa)', `${[...runSessions].reverse().find(s => s.avgHr).avgHr} bpm`,
      'Servono almeno 3 corse per il trend cardiaco.'));

    // Cadenza
    const cadCount = runSessions.filter(s => s.cadence).length;
    if (cadCount >= 3) container.appendChild(chartCard('Cadenza media (passi/min)', 'chart-cad',
      'Target 170-180 spm per ridurre l\'impatto al ginocchio.'));
    else if (cadCount >= 1) container.appendChild(bigStat('Cadenza (ultima corsa)', `${[...runSessions].reverse().find(s => s.cadence).cadence} spm`,
      'Target 170-180 spm. Servono 3 corse per il trend.'));
  } else {
    // ===== FORZA =====
    const strSec = strSessions.reduce((s, x) => s + (x.durationSec || 0), 0);
    const totSets = strSessions.reduce((s, x) => s + (x.completedSets || x.totalSets || 0), 0);
    const rpeVals = strSessions.map(s => s.rpe).filter(Boolean);
    const avgRpeStr = rpeVals.length ? (rpeVals.reduce((a, b) => a + b, 0) / rpeVals.length).toFixed(1) : '—';
    container.appendChild(el('div', { class: 'kpi-grid' },
      statKpi('Sessioni forza', String(strSessions.length), 'clock'),
      statKpi('Serie totali', String(totSets), 'gauge'),
      statKpi('RPE medio', avgRpeStr, 'flame'),
      statKpi('Durata media', strSessions.length ? `${Math.round(strSec / 60 / strSessions.length)} min` : '—', 'clock'),
    ));

    // Volume forza settimanale (min)
    const byWeekStr = {};
    strSessions.forEach(s => { byWeekStr[s.week] = (byWeekStr[s.week] || 0) + (s.durationMin || 0); });
    const strWeeks = Object.keys(byWeekStr);
    if (strWeeks.length >= 2) container.appendChild(chartCard('Volume forza settimanale (min)', 'chart-str-volume'));
    else if (strWeeks.length === 1) container.appendChild(bigStat(`Forza settimana ${strWeeks[0]}`, `${Math.round(byWeekStr[strWeeks[0]])} min`,
      'Minuti di forza. Il confronto settimanale arriva con la prossima settimana.'));

    // RPE forza
    if (strSessions.length >= 3) container.appendChild(chartCard('RPE per sessione (forza)', 'chart-str-rpe',
      'Sforzo percepito 1-10. Stabile = carico ben gestito.'));
    else container.appendChild(bigStat('RPE forza', rpeVals.length ? `Media ${avgRpeStr}` : '—',
      'Servono almeno 3 sessioni di forza per il trend.'));

    // Ripetizioni vs target (% media per sessione)
    const ratioSessions = strSessions.filter(s => Array.isArray(s.completedSetsLog) && s.completedSetsLog.length);
    if (ratioSessions.length >= 2) container.appendChild(chartCard('Ripetizioni vs target (%)', 'chart-str-ratio',
      '100% = hai centrato il target. Sopra = stai superando il programma.'));
    else if (ratioSessions.length === 1) {
      const r = sessionRepRatio(ratioSessions[0].completedSetsLog);
      container.appendChild(bigStat('Ripetizioni vs target', r != null ? `${Math.round(r * 100)}%` : '—',
        'Quanto superi il target di ripetizioni. Il trend arriva con più sessioni.'));
    }
  }

  // Disegna i grafici delle card effettivamente presenti
  requestAnimationFrame(() => drawCharts(sessions, statsMode));
}

function drawCharts(sessions, mode = 'run') {
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js non caricato');
    return;
  }
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#10b981';
  const text = css.getPropertyValue('--text').trim() || '#e2e8f0';
  const muted = css.getPropertyValue('--text-muted').trim() || '#94a3b8';
  Chart.defaults.color = text;
  Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';

  // Corsa e forza separate: ogni grafico usa solo le sessioni della sua modalità
  const runSessions = sessions.filter(s => s.type !== 'strength');
  const strSessions = sessions.filter(s => s.type === 'strength');

  // ===== Grafici FORZA =====
  const ctxStrVol = $('#chart-str-volume')?.getContext('2d');
  if (ctxStrVol) {
    const byWeek = {};
    strSessions.forEach(s => { byWeek[s.week] = (byWeek[s.week] || 0) + (s.durationMin || 0); });
    const labels = Object.keys(byWeek).sort((a, b) => a - b);
    new Chart(ctxStrVol, {
      type: 'bar',
      data: { labels: labels.map(w => `Sett. ${w}`), datasets: [{ label: 'min forza', data: labels.map(w => Math.round(byWeek[w])), backgroundColor: '#8b5cf6cc', borderRadius: 6 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    });
  }
  const ctxStrRpe = $('#chart-str-rpe')?.getContext('2d');
  if (ctxStrRpe) {
    new Chart(ctxStrRpe, {
      type: 'line',
      data: { labels: strSessions.map(s => fmtDateShort(s.completedAt)), datasets: [{ label: 'RPE', data: strSessions.map(s => s.rpe), borderColor: '#f59e0b', backgroundColor: '#f59e0b22', tension: 0.3, fill: true, pointRadius: 4 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 10 } } },
    });
  }
  const ctxStrRatio = $('#chart-str-ratio')?.getContext('2d');
  if (ctxStrRatio) {
    const withRatio = strSessions.filter(s => Array.isArray(s.completedSetsLog) && s.completedSetsLog.length);
    new Chart(ctxStrRatio, {
      type: 'line',
      data: {
        labels: withRatio.map(s => fmtDateShort(s.completedAt)),
        datasets: [
          { label: '% del target', data: withRatio.map(s => Math.round((sessionRepRatio(s.completedSetsLog) || 1) * 100)), borderColor: accent, backgroundColor: accent + '22', tension: 0.3, fill: true, pointRadius: 4 },
          { label: 'Target 100%', data: withRatio.map(() => 100), borderColor: muted, borderDash: [6, 4], pointRadius: 0, fill: false },
        ],
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    });
  }

  // ===== Grafici CORSA (solo sessioni di corsa) =====
  // Volume corsa settimanale
  const byWeek = {};
  runSessions.forEach(s => { byWeek[s.week] = (byWeek[s.week] || 0) + s.durationMin; });
  const weekLabels = Object.keys(byWeek).sort((a, b) => a - b);
  const ctx1 = $('#chart-volume')?.getContext('2d');
  if (ctx1) {
    new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: weekLabels.map(w => `Sett. ${w}`),
        datasets: [{
          label: 'Minuti',
          data: weekLabels.map(w => Math.round(byWeek[w])),
          backgroundColor: accent + 'cc',
          borderRadius: 6,
        }],
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    });
  }

  // FC (solo corse)
  const ctx3 = $('#chart-hr')?.getContext('2d');
  if (ctx3) {
    const withHr = runSessions.filter(s => s.avgHr);
    new Chart(ctx3, {
      type: 'line',
      data: {
        labels: withHr.map(s => fmtDateShort(s.completedAt)),
        datasets: [{
          label: 'FC media (bpm)',
          data: withHr.map(s => s.avgHr),
          borderColor: '#ef4444',
          backgroundColor: '#ef444422',
          tension: 0.3, fill: true, pointRadius: 4,
        }],
      },
      options: { plugins: { legend: { display: false } } },
    });
  }

  // Pace (in min/km, asse Y in min decimali per leggibilità)
  const ctxPace = $('#chart-pace')?.getContext('2d');
  if (ctxPace) {
    const withPace = runSessions.filter(s => s.paceSecPerKm);
    new Chart(ctxPace, {
      type: 'line',
      data: {
        labels: withPace.map(s => fmtDateShort(s.completedAt)),
        datasets: [{
          label: 'min/km',
          data: withPace.map(s => +(s.paceSecPerKm / 60).toFixed(2)),
          borderColor: '#8b5cf6',
          backgroundColor: '#8b5cf622',
          tension: 0.3, fill: true, pointRadius: 4,
        }],
      },
      options: {
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: c => fmtPace(Math.round(c.parsed.y * 60)) + '/km' } },
        },
        scales: { y: { reverse: true, title: { display: true, text: 'min/km (più basso = più veloce)' } } },
      },
    });
  }

  // Volume Zone 2 (solo corse)
  const ctxZ2 = $('#chart-z2')?.getContext('2d');
  if (ctxZ2) {
    const byWeekZ2 = {};
    runSessions.filter(s => s.timeInZoneSec?.z2).forEach(s => {
      byWeekZ2[s.week] = (byWeekZ2[s.week] || 0) + (s.timeInZoneSec.z2 / 60);
    });
    const z2Labels = Object.keys(byWeekZ2).sort((a, b) => a - b);
    new Chart(ctxZ2, {
      type: 'bar',
      data: {
        labels: z2Labels.map(w => `Sett. ${w}`),
        datasets: [{
          label: 'min Z2',
          data: z2Labels.map(w => Math.round(byWeekZ2[w])),
          backgroundColor: '#10b981cc',
          borderRadius: 6,
        }],
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    });
  }

  // Cadenza (solo corse)
  const ctxCad = $('#chart-cad')?.getContext('2d');
  if (ctxCad) {
    const withCad = runSessions.filter(s => s.cadence);
    new Chart(ctxCad, {
      type: 'line',
      data: {
        labels: withCad.map(s => fmtDateShort(s.completedAt)),
        datasets: [
          {
            label: 'Cadenza (spm)',
            data: withCad.map(s => s.cadence),
            borderColor: '#3b82f6',
            backgroundColor: '#3b82f622',
            tension: 0.3, fill: true, pointRadius: 4,
          },
          {
            label: 'Target 170 spm',
            data: withCad.map(() => 170),
            borderColor: muted,
            borderDash: [6, 4], pointRadius: 0, fill: false,
          },
        ],
      },
    });
  }

  // Peso
  const weights = getWeights();
  const ctx4 = $('#chart-weight')?.getContext('2d');
  if (ctx4 && weights.length > 1) {
    const profile = getProfile();
    new Chart(ctx4, {
      type: 'line',
      data: {
        labels: weights.map(w => fmtDateShort(w.date)),
        datasets: [
          {
            label: 'Peso (kg)',
            data: weights.map(w => w.kg),
            borderColor: accent,
            backgroundColor: accent + '22',
            tension: 0.3, fill: true, pointRadius: 4,
          },
          {
            label: 'Target',
            data: weights.map(() => profile.weightTargetKg),
            borderColor: muted,
            borderDash: [6, 4], pointRadius: 0, fill: false,
          },
        ],
      },
    });
  }
}

// --- View: Profilo --------------------------------------------------------
function renderProfile() {
  const container = $('#view-profile');
  container.innerHTML = '';
  const profile = getProfile();
  const settings = getSettings();
  const zones = getZones();

  container.appendChild(el('h2', { class: 'view-title' }, 'Profilo & Impostazioni'));

  // Card Assessment
  const assessment = getAssessment();
  if (assessment.done && assessment.results) {
    const r = assessment.results;
    container.appendChild(el('div', { class: 'card' },
      el('div', { class: 'card-label' }, '🏁 Test iniziale completato'),
      el('div', { class: 'help-text' },
        `VO₂max: ${r.vo2max} (${r.vo2Cat?.label}) · HRR: -${r.hrrDrop} bpm (${r.hrrCat?.label}) · Forza: ${r.strengthLevel}`,
      ),
      el('button', { class: 'btn btn-ghost', onclick: () => startAssessmentWizard() }, '↺ Rifai il test'),
    ));
  } else {
    container.appendChild(el('div', { class: 'card' },
      el('div', { class: 'card-label' }, '🏁 Test iniziale'),
      el('div', { class: 'help-text' }, 'Non ancora completato. Falli per calibrare l\'app sui tuoi dati reali.'),
      el('button', { class: 'btn btn-primary', onclick: () => startAssessmentWizard() }, 'Fai il test'),
    ));
  }

  // Profilo
  const nameInput = field('Nome', profile.name, (v) => updateProfile({ name: v }));
  const yearInput = field('Anno di nascita', profile.birthYear, (v) => updateProfile({ birthYear: parseInt(v) }), 'number');
  const sexSelect = selectField('Sesso', profile.isMale ? 'M' : 'F', [
    { value: 'M', label: 'Uomo' }, { value: 'F', label: 'Donna' },
  ], (v) => updateProfile({ isMale: v === 'M' }));
  const heightInput = field('Altezza (cm)', profile.heightCm, (v) => updateProfile({ heightCm: parseFloat(v) }), 'number');
  const wStartInput = field('Peso di partenza (kg)', profile.weightStartKg, (v) => updateProfile({ weightStartKg: parseFloat(v) }), 'number');
  const wCurInput = field('Peso attuale (kg)', profile.weightCurrentKg, (v) => updateProfile({ weightCurrentKg: parseFloat(v) }), 'number');
  const wTgtInput = field('Peso target (kg)', profile.weightTargetKg, (v) => updateProfile({ weightTargetKg: parseFloat(v) }), 'number');
  const restHrInput = field('FC a riposo (bpm)', profile.restingHr, (v) => updateProfile({ restingHr: parseInt(v) }), 'number');
  const hrMaxInput = field(`FC max (override — formula: ${calcHrMax(getAge())})`, profile.hrMaxOverride || '', (v) => updateProfile({ hrMaxOverride: v ? parseInt(v) : null }), 'number');

  container.appendChild(el('div', { class: 'card' },
    el('div', { class: 'card-label' }, 'Dati personali'),
    nameInput, yearInput, sexSelect, heightInput,
    wStartInput, wCurInput, wTgtInput, restHrInput, hrMaxInput,
  ));

  // Modulo Forza
  container.appendChild(el('div', { class: 'card' },
    el('div', { class: 'card-label' }, '💪 Modulo Forza'),
    el('div', { class: 'help-text' }, 'Programma 8 settimane × 3 sessioni dinamiche bodyweight. Tutti esercizi senza pesi.'),
    selectField('Livello di partenza forza', profile.strengthLevel || 'returning', [
      { value: 'beginner', label: 'Beginner — mai allenato' },
      { value: 'returning', label: 'Returning — ex allenato, fermo da tempo' },
      { value: 'advanced', label: 'Advanced — allenato regolarmente' },
    ], v => updateProfile({ strengthLevel: v })),
    toggleField('Modulo forza attivo nella Home', profile.strengthEnabled !== false, v => updateProfile({ strengthEnabled: v })),
    el('div', { class: 'help-text' }, `Sei in settimana ${getProgress().strengthWeek || 1}/${STRENGTH_TOTAL_WEEKS} forza, sessione ${['S1','S2','S3'][getProgress().strengthSessionIndex || 0]}, intensità ${Math.round((getProgress().strengthRepScale || 1) * 100)}% del target. L'intensità si adatta da sola in base alle reps che registri.`),
    el('button', { class: 'btn btn-ghost', onclick: () => {
      if (confirm('Vuoi tornare alla settimana 1 della forza? (azzera anche l\'intensità adattiva)')) {
        const pr = getProgress();
        pr.strengthWeek = 1;
        pr.strengthSessionIndex = 0;
        pr.strengthRepScale = 1;
        saveProgress(pr);
        renderProfile();
        toast('Programma forza resettato');
      }
    } }, '↺ Ricomincia programma forza'),
  ));

  // Pianificazione settimanale (giorni di riposo + piano "Oggi")
  container.appendChild(el('div', { class: 'card' },
    el('div', { class: 'card-label' }, '📅 Pianificazione settimanale'),
    toggleField('Mostra il piano "Oggi" nella Home', settings.guidedPlan !== false, v => { updateSettings({ guidedPlan: v }); renderProfile(); }),
    el('div', { class: 'help-text' }, 'Tocca i giorni in cui vuoi RIPOSARE (evidenziati in rosso). Negli altri giorni l\'app alterna automaticamente corsa e forza, partendo dalla corsa.'),
    restDaysSelector(settings),
    el('div', { class: 'help-text' }, planSummaryText(settings, profile)),
    toggleField('Corsa andata/ritorno (avviso "torna indietro")', settings.outAndBack === true, v => updateSettings({ outAndBack: v })),
    el('div', { class: 'help-text' }, 'Se attivo: durante la corsa, raggiunta metà della distanza stimata, la voce ti dice di tornare indietro così finisci dove sei partito. Tiene conto di fasi e velocità diverse (riscaldamento, jog, defaticamento).'),
  ));

  // Coach AI (opzionale)
  container.appendChild(el('div', { class: 'card' },
    el('div', { class: 'card-label' }, '🤖 Coach AI'),
    el('div', { class: 'help-text' }, 'A fine sessione un coach Claude analizza i tuoi dati, ti dà un debrief e adatta l\'intensità della forza. Richiede il Worker coach attivo (vedi coach-worker/). I dati di allenamento vengono inviati al tuo Worker.'),
    toggleField('Attiva il coach AI', settings.coachEnabled === true, v => { updateSettings({ coachEnabled: v }); renderProfile(); }),
    settings.coachEnabled ? field('URL del Worker', settings.coachUrl || '', v => updateSettings({ coachUrl: v.trim() }), 'text') : null,
    settings.coachEnabled ? field('Token (X-RunFit-Token)', settings.coachToken || '', v => updateSettings({ coachToken: v.trim() }), 'text') : null,
    settings.coachEnabled ? el('button', { class: 'btn btn-ghost', onclick: testCoachConnection }, '🔌 Prova connessione') : null,
  ));

  // Zone HR
  container.appendChild(el('div', { class: 'card zones-card' },
    el('div', { class: 'card-label' }, `Zone cardiache — FC max ${zones.hrMax} bpm`),
    ...['z1','z2','z3','z4','z5'].map(k => el('div', { class: 'zone-row', style: `--zc:${zones[k].color}` },
      el('div', { class: 'zone-name-row' }, k.toUpperCase()),
      el('div', { class: 'zone-range-row' }, `${zones[k].min}–${zones[k].max} bpm`),
      el('div', { class: 'zone-label-row' }, zones[k].label),
    )),
  ));

  // Impostazioni
  container.appendChild(el('div', { class: 'card' },
    el('div', { class: 'card-label' }, 'Audio & schermo'),
    toggleField('Coach vocale italiano', settings.audioCoach, v => updateSettings({ audioCoach: v })),
    toggleField('Beep sonori', settings.beeps, v => updateSettings({ beeps: v })),
    toggleField('Vibrazione', settings.vibrate, v => updateSettings({ vibrate: v })),
    toggleField('Tieni schermo acceso', settings.keepScreenOn, v => updateSettings({ keepScreenOn: v })),
  ));

  // Aggiornamenti app (svuota cache SW + ricarica)
  container.appendChild(el('div', { class: 'card' },
    el('div', { class: 'card-label' }, '🔄 Aggiornamenti app'),
    el('div', { class: 'help-text' }, 'Se dopo un nuovo aggiornamento l\'app sembra vecchia, svuota la cache e ricarica all\'ultima versione (equivale a forzare la chiusura della PWA).'),
    el('button', { class: 'btn btn-primary btn-block', onclick: forceAppRefresh }, '🔄 Svuota cache e ricarica'),
  ));

  // Cloud sync
  container.appendChild(el('div', { class: 'card' },
    el('div', { class: 'card-label' }, 'Backup cloud (opzionale)'),
    el('div', { class: 'help-text' }, 'Configura un Cloudflare Worker per sincronizzare tra dispositivi.'),
    field('URL Worker', settings.cloudUrl, v => updateSettings({ cloudUrl: v.replace(/\/$/, '') })),
    field('Token Bearer', settings.cloudToken, v => updateSettings({ cloudToken: v }), 'password'),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn btn-ghost', onclick: doCloudPush }, '☁️ Carica su cloud'),
      el('button', { class: 'btn btn-ghost', onclick: doCloudPull }, '📥 Scarica dal cloud'),
    ),
  ));

  // Export/Import
  container.appendChild(el('div', { class: 'card' },
    el('div', { class: 'card-label' }, 'Esporta/Importa dati'),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn btn-ghost', onclick: doExport }, '⬇ Esporta JSON'),
      el('button', { class: 'btn btn-ghost', onclick: doImport }, '⬆ Importa JSON'),
      el('button', { class: 'btn btn-ghost btn-danger', onclick: doReset }, '🗑 Resetta tutto'),
    ),
  ));

  // Programma & Volume
  const curProgress = getProgress();
  container.appendChild(el('div', { class: 'card' },
    el('div', { class: 'card-label' }, 'Programma'),
    el('div', { class: 'help-text' }, `Sei in settimana ${curProgress.currentWeek}/12, sessione ${['A','B','C','D','E'][curProgress.currentSessionIndex]}, volume ${curProgress.weeklyVolume || 3}/settimana.`),
    selectField('Volume settimanale (override)', String(curProgress.weeklyVolume || 3), [
      { value: '3', label: '3 sessioni (default principianti)' },
      { value: '4', label: '4 sessioni (con Long Z2)' },
      { value: '5', label: '5 sessioni (con Easy Recovery)' },
    ], v => {
      const pr = getProgress();
      pr.weeklyVolume = parseInt(v);
      saveProgress(pr);
      toast(`Volume impostato a ${v} sessioni/settimana`);
    }),
    el('div', { class: 'help-text' }, 'Se imposti manualmente il volume, l\'app continuerà comunque a valutarlo in base ai tuoi RPE/FC dopo ogni settimana.'),
    el('button', { class: 'btn btn-ghost', onclick: () => {
      if (confirm('Vuoi tornare alla settimana 1?')) {
        saveProgress({ currentWeek: 1, currentSessionIndex: 0, weekFeedbacks: [], startedAt: null, weeklyVolume: 3, volumePromotedAt: null });
        renderProfile();
      }
    } }, '↺ Ricomincia programma'),
  ));
}

// Selettore giorni di riposo: chip rossa = riposo, chip neutra = allenamento
function restDaysSelector(settings) {
  const restDays = settings.restDays || [0];
  const row = el('div', { class: 'chip-row rest-days-row' });
  DOW_ORDER.forEach(d => {
    const isRest = restDays.includes(d);
    row.appendChild(el('button', {
      class: `chip ${isRest ? 'chip-rest' : ''}`,
      onclick: () => {
        const s = getSettings();
        let rd = (s.restDays || [0]).slice();
        if (rd.includes(d)) rd = rd.filter(x => x !== d);
        else rd.push(d);
        if (rd.length >= 7) { toast('Tieni almeno un giorno di allenamento'); return; }
        updateSettings({ restDays: rd });
        renderProfile();
      },
    }, DOW_SHORT[d]));
  });
  return row;
}

// Riassunto testuale del piano settimanale risultante
function planSummaryText(settings, profile) {
  const restDays = settings.restDays || [0];
  const strengthEnabled = profile.strengthEnabled !== false;
  const active = DOW_ORDER.filter(d => !restDays.includes(d));
  const restLabels = DOW_ORDER.filter(d => restDays.includes(d)).map(d => DOW_SHORT[d]);
  if (!strengthEnabled) {
    return `Piano: ${active.length} giorni di corsa. Riposo: ${restLabels.join(', ') || 'nessuno'}.`;
  }
  const parts = active.map((d, i) => `${DOW_SHORT[d]} ${i % 2 === 0 ? '🏃' : '💪'}`);
  return `Piano: ${parts.join(' · ')} · Riposo: ${restLabels.join(', ') || 'nessuno'}.`;
}

function field(label, value, onchange, type = 'text') {
  const input = el('input', { type, value: value ?? '', class: 'feedback-input' });
  input.addEventListener('change', e => onchange(e.target.value));
  return el('div', { class: 'field' },
    el('label', { class: 'feedback-label' }, label),
    input,
  );
}

function selectField(label, value, options, onchange) {
  const sel = el('select', { class: 'feedback-input' },
    ...options.map(o => el('option', { value: o.value, ...(o.value === value ? { selected: '' } : {}) }, o.label)),
  );
  sel.addEventListener('change', e => onchange(e.target.value));
  return el('div', { class: 'field' },
    el('label', { class: 'feedback-label' }, label),
    sel,
  );
}

function toggleField(label, value, onchange) {
  const wrap = el('label', { class: 'toggle-field' },
    el('span', {}, label),
  );
  const input = el('input', { type: 'checkbox' });
  if (value) input.setAttribute('checked', '');
  input.addEventListener('change', e => onchange(e.target.checked));
  const slider = el('span', { class: 'toggle-slider' });
  wrap.appendChild(input);
  wrap.appendChild(slider);
  return wrap;
}

function updateProfile(patch) {
  const p = getProfile();
  saveProfile({ ...p, ...patch });
}
function updateSettings(patch) {
  const s = getSettings();
  saveSettings({ ...s, ...patch });
}

// --- Cloud sync actions ----------------------------------------------------
async function doCloudPush() {
  try { await cloudPush(); toast('Backup caricato ☁️'); }
  catch (e) { toast(`Errore: ${e.message}`); }
}
async function doCloudPull() {
  try { await cloudPull(); toast('Dati scaricati 📥'); renderProfile(); }
  catch (e) { toast(`Errore: ${e.message}`); }
}
function doExport() {
  const blob = new Blob([exportAllJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `runfit-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  URL.revokeObjectURL(url);
}
function doImport() {
  const input = el('input', { type: 'file', accept: 'application/json' });
  input.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try { importAllJson(ev.target.result); toast('Dati importati'); renderProfile(); }
      catch (err) { toast(`Errore: ${err.message}`); }
    };
    reader.readAsText(file);
  });
  input.click();
}
function doReset() {
  if (!confirm('Vuoi cancellare TUTTI i dati? Operazione irreversibile.')) return;
  if (!confirm('Sei davvero sicuro? Verranno persi sessioni e progressi.')) return;
  ['runfit.profile','runfit.sessions','runfit.progress','runfit.weights','runfit.settings']
    .forEach(k => localStorage.removeItem(k));
  location.reload();
}

// --- Modali --------------------------------------------------------------
function showWeightModal() {
  const modal = $('#modal');
  modal.innerHTML = '';
  modal.classList.add('open');
  const input = el('input', { type: 'number', step: '0.1', placeholder: 'Es. 84.5', class: 'feedback-input' });
  input.focus();
  modal.appendChild(el('div', { class: 'modal-content' },
    el('div', { class: 'modal-header' },
      el('h2', {}, 'Registra peso'),
      el('button', { class: 'icon-btn', onclick: () => modal.classList.remove('open') }, '×'),
    ),
    el('div', { class: 'modal-body' },
      el('label', { class: 'feedback-label' }, 'Peso attuale (kg)'),
      input,
      el('button', {
        class: 'btn btn-primary btn-block',
        onclick: () => {
          const v = parseFloat(input.value);
          if (isNaN(v) || v < 30 || v > 250) { toast('Valore non valido'); return; }
          addWeight(v);
          modal.classList.remove('open');
          renderHome();
        },
      }, 'Salva'),
    ),
  ));
}

// --- Forza aggiornamento: deregistra SW, svuota cache, ricarica ------------
async function forceAppRefresh() {
  if (!confirm('Svuotare la cache e ricaricare l\'app all\'ultima versione?')) return;
  toast('🔄 Aggiornamento in corso…');
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch { /* best effort */ }
  // URL con cache-bust per saltare anche la cache HTTP del browser
  location.replace(location.pathname + '?u=' + Date.now());
}

// --- Toast -----------------------------------------------------------------
function toast(msg) {
  const t = el('div', { class: 'toast' }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('visible'), 10);
  setTimeout(() => {
    t.classList.remove('visible');
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

// --- Init ------------------------------------------------------------------
async function init() {
  await loadVoices();
  // Tabs
  $$('.tab').forEach(t => {
    t.addEventListener('click', () => setView(t.dataset.view));
  });
  // FAB Coach
  const fab = document.getElementById('coach-fab');
  if (fab) fab.addEventListener('click', () => setView('coach'));
  // PWA install prompt (silenziato)
  window.addEventListener('beforeinstallprompt', e => e.preventDefault());
  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  // Auto-aggiornamento al cambio giorno: se torni nell'app dopo la mezzanotte,
  // la vista corrente si rigenera col giorno reale (niente più "fermo a ieri").
  const refreshIfNewDay = () => {
    if (document.visibilityState === 'hidden') return;
    if (lastRenderDay && lastRenderDay !== new Date().toDateString()) setView(currentView);
  };
  document.addEventListener('visibilitychange', refreshIfNewDay);
  window.addEventListener('focus', refreshIfNewDay);
  window.addEventListener('pageshow', refreshIfNewDay);
  setView('home');
}
document.addEventListener('DOMContentLoaded', init);
