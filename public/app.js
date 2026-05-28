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
  getSessions, saveSession, deleteSession,
  getWeights, addWeight,
  getSettings, saveSettings,
  exportAllJson, importAllJson,
  cloudPush, cloudPull,
} from './storage.js';
import { SessionRunner, speak, loadVoices } from './coach.js';

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
let currentView = 'home';

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
  const renderer = {
    home: renderHome,
    workout: renderWorkout,
    history: renderHistory,
    stats: renderStats,
    profile: renderProfile,
  }[name];
  if (renderer) renderer();
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
  const session = weekSessions[progress.currentSessionIndex];
  const sessions = getSessions();
  const weights = getWeights();
  const profile = getProfile();

  // Streak: giorni consecutivi (max 1 sessione/giorno) con almeno una sessione
  const streak = computeStreak(sessions);
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

  // Card prossima sessione
  const sessionLetter = ['A', 'B', 'C', 'D', 'E'][progress.currentSessionIndex] || '?';
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

  // Card volume settimanale + adattamento
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

function fmtMinutes(seconds) {
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function computeStreak(sessions) {
  if (!sessions.length) return 0;
  const dates = [...new Set(sessions.map(s => new Date(s.completedAt).toDateString()))];
  dates.sort((a, b) => new Date(b) - new Date(a));
  let streak = 0;
  let cur = new Date();
  cur.setHours(0, 0, 0, 0);
  for (const d of dates) {
    const sd = new Date(d);
    sd.setHours(0, 0, 0, 0);
    const diff = Math.floor((cur - sd) / 86400000);
    if (diff === streak) { streak++; }
    else if (diff === streak + 1 && streak === 0) {
      // Permettiamo che la streak inizi ieri (oggi non ancora allenato)
      streak++; cur = sd;
    } else break;
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
  currentRunner = new SessionRunner(session);
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
    fieldWrap('Dislivello', numInput('elevationGain', '12', { type: 'number', inputmode: 'numeric', step: '1' }), 'm'),
  );

  // Sezione avanzati (collapsible)
  const advancedContent = el('div', { class: 'feedback-grid advanced-grid' },
    fieldWrap('Tempo Z2', numInput('timeZ2', '8', { type: 'number', inputmode: 'numeric', step: '1' }), 'min'),
    fieldWrap('Tempo Z3', numInput('timeZ3', '5', { type: 'number', inputmode: 'numeric', step: '1' }), 'min'),
    fieldWrap('Cadenza media', numInput('cadence', '165', { type: 'number', inputmode: 'numeric', step: '1' }), 'spm'),
    fieldWrap('Lunghezza passo', numInput('strideM', '1.05', { step: '0.01' }), 'm'),
    fieldWrap('Oscillaz. vert.', numInput('verticalOsc', '8.5', { step: '0.1' }), 'cm'),
    fieldWrap('Tempo a terra', numInput('groundContact', '280', { type: 'number', inputmode: 'numeric', step: '1' }), 'ms'),
    fieldWrap('Potenza media', numInput('runningPowerW', '220', { type: 'number', inputmode: 'numeric', step: '1' }), 'W'),
  );
  const advancedToggle = el('button', {
    class: 'advanced-toggle',
    type: 'button',
  }, '▼ Dettagli avanzati Apple Watch (opzionale)');
  let advancedOpen = false;
  advancedContent.style.display = 'none';
  advancedToggle.addEventListener('click', () => {
    advancedOpen = !advancedOpen;
    advancedContent.style.display = advancedOpen ? 'grid' : 'none';
    advancedToggle.textContent = (advancedOpen ? '▲ Nascondi' : '▼ Dettagli avanzati Apple Watch (opzionale)');
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
    placeholder: '6:30',
    class: 'feedback-input',
    pattern: '[0-9:.]*',
  });
  i.addEventListener('input', e => { state.paceMinPerKm = e.target.value; });
  return i;
}

function parsePaceToSec(str) {
  if (!str) return null;
  str = String(str).trim();
  // formato "5:30" o "5.30"
  let parts;
  if (str.includes(':')) parts = str.split(':');
  else if (str.includes('.')) {
    const n = parseFloat(str);
    return Math.round(n * 60); // 5.5 -> 330 sec
  } else if (/^\d+$/.test(str)) {
    return parseInt(str) * 60; // 5 -> 300 sec
  } else return null;
  const mins = parseInt(parts[0]) || 0;
  const secs = parseInt(parts[1]) || 0;
  return mins * 60 + secs;
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
  const pace = s.paceSecPerKm ? fmtPace(s.paceSecPerKm) : null;
  return el('div', { class: 'card history-card' },
    el('div', { class: 'history-card-head' },
      el('div', { class: 'history-card-title' }, s.title),
      el('div', { class: 'history-card-date' }, fmtDate(s.completedAt)),
    ),
    el('div', { class: 'history-card-stats' },
      el('span', {}, `${s.durationMin}'`),
      el('span', { class: 'dot' }, '·'),
      el('span', {}, `RPE ${s.rpe}`),
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
    el('button', {
      class: 'icon-btn history-delete',
      onclick: () => { if (confirm('Eliminare questa sessione?')) { deleteSession(s.id); renderHistory(); } },
    }, '🗑'),
  );
}

function fmtPace(secPerKm) {
  if (!secPerKm) return '—';
  const m = Math.floor(secPerKm / 60);
  const s = secPerKm % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// --- View: Statistiche ----------------------------------------------------
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

  container.appendChild(el('h2', { class: 'view-title' }, 'Statistiche & Progressione'));

  // KPI generali
  const totalSec = sessions.reduce((s, x) => s + x.durationSec, 0);
  const totalKcal = sessions.reduce((s, x) => s + (x.kcal || 0), 0);
  const totalKm = sessions.reduce((s, x) => s + (x.km || 0), 0);
  const avgRpe = (sessions.reduce((s, x) => s + x.rpe, 0) / sessions.length).toFixed(1);
  const avgHr = (() => {
    const withHr = sessions.filter(s => s.avgHr);
    if (!withHr.length) return null;
    return Math.round(withHr.reduce((s, x) => s + x.avgHr, 0) / withHr.length);
  })();

  container.appendChild(el('div', { class: 'kpi-grid' },
    kpiCard('Tempo totale', fmtMinutes(totalSec), '⏱'),
    kpiCard('Calorie', `${totalKcal.toLocaleString('it-IT')}`, '🔋'),
    kpiCard('Distanza', `${totalKm.toFixed(1)} km`, '📏'),
    kpiCard('RPE medio', avgRpe, '💪'),
  ));

  // Grafico volume settimanale
  container.appendChild(el('div', { class: 'card chart-card' },
    el('div', { class: 'card-label' }, 'Volume settimanale (minuti)'),
    el('canvas', { id: 'chart-volume', height: '200' }),
  ));

  // Grafico RPE nel tempo
  container.appendChild(el('div', { class: 'card chart-card' },
    el('div', { class: 'card-label' }, 'RPE per sessione'),
    el('canvas', { id: 'chart-rpe', height: '200' }),
  ));

  // Grafico FC media
  if (avgHr) {
    container.appendChild(el('div', { class: 'card chart-card' },
      el('div', { class: 'card-label' }, 'Frequenza cardiaca media'),
      el('canvas', { id: 'chart-hr', height: '200' }),
    ));
  }

  // Grafico Passo medio (min/km) — indicatore di efficienza/velocità
  const withPace = sessions.filter(s => s.paceSecPerKm);
  if (withPace.length > 0) {
    container.appendChild(el('div', { class: 'card chart-card' },
      el('div', { class: 'card-label' }, 'Passo medio (min/km)'),
      el('canvas', { id: 'chart-pace', height: '200' }),
    ));
  }

  // Grafico Tempo in Zona 2 — minuti totali settimanali in fat-burning
  const withZ2 = sessions.filter(s => s.timeInZoneSec?.z2);
  if (withZ2.length > 0) {
    container.appendChild(el('div', { class: 'card chart-card' },
      el('div', { class: 'card-label' }, 'Volume Zone 2 per settimana (min)'),
      el('div', { class: 'chart-hint' }, 'Tempo speso nella zona 110-128 bpm — la zona regina per dimagrire'),
      el('canvas', { id: 'chart-z2', height: '200' }),
    ));
  }

  // Grafico Cadenza media
  const withCad = sessions.filter(s => s.cadence);
  if (withCad.length > 0) {
    container.appendChild(el('div', { class: 'card chart-card' },
      el('div', { class: 'card-label' }, 'Cadenza media (passi/min)'),
      el('div', { class: 'chart-hint' }, 'Target ottimale: 170-180 spm per ridurre impatto al ginocchio'),
      el('canvas', { id: 'chart-cad', height: '200' }),
    ));
  }

  // Grafico peso
  const weights = getWeights();
  if (weights.length > 1) {
    container.appendChild(el('div', { class: 'card chart-card' },
      el('div', { class: 'card-label' }, 'Andamento peso'),
      el('canvas', { id: 'chart-weight', height: '200' }),
    ));
  }

  // Disegna grafici dopo che il DOM è pronto
  requestAnimationFrame(() => drawCharts(sessions));
}

function drawCharts(sessions) {
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

  // Volume settimanale
  const byWeek = {};
  sessions.forEach(s => {
    byWeek[s.week] = (byWeek[s.week] || 0) + s.durationMin;
  });
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

  // RPE
  const ctx2 = $('#chart-rpe')?.getContext('2d');
  if (ctx2) {
    new Chart(ctx2, {
      type: 'line',
      data: {
        labels: sessions.map(s => fmtDateShort(s.completedAt)),
        datasets: [{
          label: 'RPE',
          data: sessions.map(s => s.rpe),
          borderColor: '#f59e0b',
          backgroundColor: '#f59e0b22',
          tension: 0.3, fill: true, pointRadius: 4,
        }],
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 10 } } },
    });
  }

  // FC
  const ctx3 = $('#chart-hr')?.getContext('2d');
  if (ctx3) {
    const withHr = sessions.filter(s => s.avgHr);
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
    const withPace = sessions.filter(s => s.paceSecPerKm);
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

  // Volume Zone 2 (somma minuti Z2 per settimana di programma)
  const ctxZ2 = $('#chart-z2')?.getContext('2d');
  if (ctxZ2) {
    const byWeekZ2 = {};
    sessions.filter(s => s.timeInZoneSec?.z2).forEach(s => {
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

  // Cadenza
  const ctxCad = $('#chart-cad')?.getContext('2d');
  if (ctxCad) {
    const withCad = sessions.filter(s => s.cadence);
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
  // PWA install prompt (silenziato)
  window.addEventListener('beforeinstallprompt', e => e.preventDefault());
  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  setView('home');
}
document.addEventListener('DOMContentLoaded', init);
