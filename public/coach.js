// ============================================================================
// RunFit — Coach (Timer + audio Italian TTS + beeps + vibration + wake lock)
// ============================================================================

import { getSettings } from './storage.js';

// --- Web Audio: beep precisi -----------------------------------------------
let audioCtx = null;
function getCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

export function beep(freq = 800, duration = 0.18, volume = 0.3, type = 'sine') {
  const settings = getSettings();
  if (!settings.beeps) return;
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.stop(ctx.currentTime + duration);
  } catch {}
}

export function beepSequence(notes) {
  let t = 0;
  notes.forEach(n => {
    setTimeout(() => beep(n.f, n.d || 0.15, n.v || 0.3), t * 1000);
    t += (n.gap || 0.2);
  });
}

// Effetti
export const fxStart = () => beepSequence([{ f: 600 }, { f: 800 }, { f: 1200, d: 0.3 }]);
export const fxPhaseChange = () => beepSequence([{ f: 1000 }, { f: 1200 }]);
export const fxCountdown = () => beep(700, 0.1, 0.4);
export const fxFinish = () => beepSequence([
  { f: 800 }, { f: 1000 }, { f: 1200 }, { f: 1600, d: 0.5, v: 0.4 }
]);

// Sblocca/avvia il contesto audio dentro un gesto utente (iOS lo esige).
export function unlockAudio() { try { getCtx(); } catch {} }

// Tempo corrente dell'orologio audio (per la schedulazione anticipata).
export function audioNow() { try { return getCtx().currentTime; } catch { return 0; } }

// "Tum" del metronomo schedulato a un istante preciso dell'orologio audio.
// Colpo basso ma percepibile (pitch drop 170→85 Hz), morbido. Usa il contesto
// CONDIVISO già sbloccato. Schedulare in anticipo rende il battito immune al
// throttling dei timer JS quando lo schermo si spegne.
export function tumAt(when, volume = 0.4) {
  try {
    const ctx = getCtx();
    const t = Math.max(when, ctx.currentTime);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(170, t);
    osc.frequency.exponentialRampToValueAtTime(85, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.19);
  } catch {}
}
export function tum(volume = 0.4) { tumAt(audioNow(), volume); }

// Keep-alive: un loop quasi-silenzioso tiene attivo il contesto audio quando lo
// schermo si spegne / l'app va in background (iOS altrimenti sospende il Web
// Audio e il metronomo tace). Best-effort: a schermo bloccato a lungo iOS può
// comunque sospendere tutto.
let keepAliveSrc = null;
export function startAudioKeepAlive() {
  try {
    const ctx = getCtx();
    if (keepAliveSrc) return;
    const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.5), ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (i % 2000 === 0) ? 0.0003 : 0; // quasi-silenzio
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const g = ctx.createGain(); g.gain.value = 0.0012;
    src.connect(g).connect(ctx.destination);
    src.start();
    keepAliveSrc = src;
  } catch {}
}
export function stopAudioKeepAlive() {
  try { if (keepAliveSrc) { keepAliveSrc.stop(); keepAliveSrc.disconnect(); } } catch {}
  keepAliveSrc = null;
}

// --- Text-to-speech italiano -----------------------------------------------
let voicesLoaded = false;
let cachedVoice = null;

function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const settings = getSettings();
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  if (settings.voice) {
    const v = voices.find(v => v.name === settings.voice);
    if (v) return v;
  }
  // Preferisci voce italiana
  return voices.find(v => v.lang.startsWith('it')) || voices[0];
}

export function loadVoices() {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) return resolve([]);
    const voices = speechSynthesis.getVoices();
    if (voices.length) { voicesLoaded = true; return resolve(voices); }
    speechSynthesis.addEventListener('voiceschanged', () => {
      voicesLoaded = true;
      resolve(speechSynthesis.getVoices());
    }, { once: true });
  });
}

export function speak(text, opts = {}) {
  const settings = getSettings();
  if (!settings.audioCoach) return;
  if (!('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel(); // evita coda di frasi sovrapposte
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'it-IT';
    u.rate = opts.rate ?? 1.0;
    u.pitch = opts.pitch ?? 1.0;
    u.volume = opts.volume ?? 1.0;
    if (!cachedVoice) cachedVoice = pickVoice();
    if (cachedVoice) u.voice = cachedVoice;
    speechSynthesis.speak(u);
  } catch {}
}

// --- Vibrazione -------------------------------------------------------------
export function vibrate(pattern) {
  const settings = getSettings();
  if (!settings.vibrate) return;
  if (!('vibrate' in navigator)) return;
  try { navigator.vibrate(pattern); } catch {}
}

// --- Wake Lock (mantiene schermo acceso) -----------------------------------
let wakeLock = null;
export async function acquireWakeLock() {
  const settings = getSettings();
  if (!settings.keepScreenOn) return;
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {}
}
export async function releaseWakeLock() {
  if (wakeLock) {
    try { await wakeLock.release(); } catch {}
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (getSettings().keepScreenOn) acquireWakeLock();
  }
});

// ============================================================================
// STRENGTH RUNNER — gestisce sessioni di forza (esercizi × set × reps + rest)
// ============================================================================
//   stati: idle → setActive (utente esegue) → restActive (countdown rest)
//   eventi: 'tick' (rest), 'setComplete', 'exerciseComplete', 'finish'
// ============================================================================
export class StrengthRunner extends EventTarget {
  constructor(session) {
    super();
    this.session = session;
    this.exerciseIndex = 0;
    this.setIndex = 0;          // 0..sets-1
    this.completedSets = [];    // log per serie/lato: { exerciseKey, setNumber, side, targetReps, actualReps }
    this.setsCompleted = 0;     // serie COMPLETE (per gli unilaterali = entrambi i lati) → usato per il progresso
    this.side = 0;              // 0 = primo lato, 1 = secondo lato (solo esercizi unilaterali)
    this.state = 'setActive';   // 'setActive' | 'restActive' | 'done'
    this.restRemaining = 0;
    this.restTimer = null;
    this.startedAt = Date.now();
  }

  get currentExercise() { return this.session.exercises[this.exerciseIndex]; }
  get totalSets() { return this.session.exercises.reduce((s, e) => s + e.sets, 0); }
  get completedCount() { return this.setsCompleted; }
  get isUnilateral() { const e = this.currentExercise; return !!(e && e.unilateral); }
  get sideLabel() { return this.side === 0 ? 'Lato sinistro' : 'Lato destro'; }
  get progressPct() { return (this.completedCount / this.totalSets) * 100; }
  get totalDurationSec() { return Math.round((Date.now() - this.startedAt) / 1000); }

  /** Chiamato quando l'utente preme "Serie fatta" */
  setDone(actualReps) {
    if (this.state !== 'setActive') return;
    const ex = this.currentExercise;
    const reps = actualReps == null ? ex.reps : actualReps;

    // Log della serie (separato per lato negli esercizi unilaterali)
    this.completedSets.push({
      exerciseKey: ex.key,
      exerciseName: ex.name,
      setNumber: this.setIndex + 1,
      side: ex.unilateral ? (this.side === 0 ? 'sx' : 'dx') : null,
      targetReps: ex.reps,
      actualReps: reps,
    });

    // Unilaterale, primo lato appena fatto → passa al secondo lato con un breve switch
    if (ex.unilateral && this.side === 0) {
      this.side = 1;
      this.dispatchEvent(new CustomEvent('setComplete', {
        detail: { exercise: ex, setNumber: this.setIndex + 1, completedCount: this.completedCount, sideSwitch: true },
      }));
      this._startRest(Math.min(20, ex.restSec), false, true);
      return;
    }

    // Serie COMPLETA (bilaterale, oppure secondo lato di un unilaterale)
    this.side = 0;
    this.setsCompleted++;
    this.dispatchEvent(new CustomEvent('setComplete', {
      detail: { exercise: ex, setNumber: this.setIndex + 1, completedCount: this.completedCount },
    }));

    // Ultima serie dell'ultimo esercizio? finito
    const isLastSetOfExercise = this.setIndex + 1 >= ex.sets;
    const isLastExercise = this.exerciseIndex + 1 >= this.session.exercises.length;
    if (isLastSetOfExercise && isLastExercise) {
      this.state = 'done';
      fxFinish();
      vibrate([200, 100, 200, 100, 400]);
      speak('Sessione di forza completata. Ottimo lavoro!');
      this.dispatchEvent(new CustomEvent('finish'));
      return;
    }
    // Avanza
    if (isLastSetOfExercise) {
      this.exerciseIndex++;
      this.setIndex = 0;
      // Rest tra esercizi: usa il rest dell'esercizio appena finito
      this._startRest(ex.restSec, true);
    } else {
      this.setIndex++;
      this._startRest(ex.restSec, false);
    }
  }

  /** Salta il rest immediatamente */
  skipRest() {
    if (this.state !== 'restActive') return;
    clearInterval(this.restTimer);
    this.restRemaining = 0;
    this._goToSetActive();
  }

  /** Ferma tutto (per cleanup) */
  stop() {
    clearInterval(this.restTimer);
    releaseWakeLock();
    speechSynthesis.cancel();
  }

  _startRest(secs, isExerciseChange, switchSide = false) {
    this.state = 'restActive';
    this.restRemaining = secs;
    fxPhaseChange();
    vibrate(switchSide ? [200, 80, 200] : [100, 50, 100]);
    if (switchSide) {
      speak(`Cambia lato! ${secs} secondi e parti col ${this.sideLabel.toLowerCase()}.`);
    } else if (isExerciseChange) {
      const next = this.currentExercise;
      const perSide = next.unilateral ? ' per lato' : '';
      speak(`Riposo ${secs} secondi. Prossimo: ${next.name}, ${next.sets} serie da ${next.reps} ripetizioni${perSide}.`);
    } else {
      const perSide = this.currentExercise.unilateral ? ' per lato' : '';
      speak(`Riposo ${secs} secondi. Serie ${this.setIndex + 1} di ${this.currentExercise.sets} in arrivo${perSide}.`);
    }
    this.dispatchEvent(new CustomEvent('restStart', { detail: { seconds: secs, switchSide } }));
    acquireWakeLock();
    this.restTimer = setInterval(() => {
      this.restRemaining--;
      if (this.restRemaining === 3 || this.restRemaining === 2 || this.restRemaining === 1) {
        fxCountdown();
      }
      this.dispatchEvent(new CustomEvent('tick', { detail: { restRemaining: this.restRemaining } }));
      if (this.restRemaining <= 0) {
        clearInterval(this.restTimer);
        this._goToSetActive();
      }
    }, 1000);
  }

  _goToSetActive() {
    this.state = 'setActive';
    const ex = this.currentExercise;
    fxPhaseChange();
    vibrate([150]);
    if (ex.unilateral) {
      speak(`Vai! ${this.sideLabel}, ${ex.reps} ripetizioni.`);
    } else {
      speak(`Vai! Serie ${this.setIndex + 1}.`);
    }
    this.dispatchEvent(new CustomEvent('setStart', {
      detail: {
        exercise: ex, setNumber: this.setIndex + 1,
        side: ex.unilateral ? this.side : null,
        sideLabel: ex.unilateral ? this.sideLabel : null,
      },
    }));
  }
}

// --- Session runner (timer fase per fase) ----------------------------------
/**
 * Runner per una sessione di allenamento.
 * Emette eventi: 'tick', 'phaseStart', 'phaseEnd', 'pause', 'resume', 'finish'
 */
// Velocità RELATIVE per tipo di fase (camminata = 1). Servono solo a stimare
// la distanza: il punto di metà-percorso è invariante rispetto alla scala.
const PHASE_SPEED = { warmup: 0.95, walk: 1.0, brisk: 1.4, jog: 1.9, run: 2.3, cooldown: 0.8, rest: 0 };

export class SessionRunner extends EventTarget {
  constructor(session, opts = {}) {
    super();
    this.session = session;
    this.phaseIndex = 0;
    this.phaseElapsed = 0;
    this.totalElapsed = 0;
    this.running = false;
    this.timer = null;
    this.startedAt = null;
    this.pausedAt = null;
    this.totalPausedMs = 0;
    // Modalità andata/ritorno: avvisa quando hai percorso METÀ della distanza
    // stimata, così tornando indietro finisci dove sei partito.
    this.outAndBack = !!opts.outAndBack;
    this.turnaroundSec = this.outAndBack ? this._computeTurnaroundSec() : null;
    this.turnaroundFired = false;
    // Microcue vocali del coach (arrivano async dopo lo start): distribuiti
    // in modo discreto nella sessione, mai sopra i cambi fase.
    this.cues = [];
    this.cueTimes = [];
    this.cueIdx = 0;
  }

  // Imposta i cue e calcola gli istanti di consegna (distribuiti nel tempo).
  setCues(cues) {
    this.cues = Array.isArray(cues) ? cues.filter(c => typeof c === 'string' && c.trim()).slice(0, 6) : [];
    const n = this.cues.length;
    const T = this.session.totalSeconds;
    this.cueTimes = [];
    for (let i = 0; i < n; i++) this.cueTimes.push(Math.round(T * (i + 1) / (n + 1)));
    // Salta gli istanti già passati (se i cue arrivano a corsa avviata)
    const next = this.cueTimes.findIndex(t => t > this.totalElapsed);
    this.cueIdx = next < 0 ? n : next;
  }

  // Istante (secondi dall'inizio) in cui la distanza percorsa = metà del totale,
  // pesando ogni fase per la sua velocità relativa. Gestisce fasi asimmetriche
  // (es. defaticamento 7' lento vs riscaldamento 5') e velocità diverse.
  _computeTurnaroundSec() {
    const phases = this.session.phases || [];
    let total = 0;
    for (const p of phases) total += p.seconds * (PHASE_SPEED[p.type] ?? 1);
    if (total <= 0) return null;
    const half = total / 2;
    let acc = 0, elapsed = 0;
    for (const p of phases) {
      const w = PHASE_SPEED[p.type] ?? 1;
      for (let s = 0; s < p.seconds; s++) {
        acc += w; elapsed++;
        if (acc >= half) return elapsed;
      }
    }
    return Math.round(this.session.totalSeconds / 2);
  }

  get currentPhase() { return this.session.phases[this.phaseIndex]; }
  get nextPhase()    { return this.session.phases[this.phaseIndex + 1]; }
  get phaseRemaining() { return Math.max(0, this.currentPhase.seconds - this.phaseElapsed); }
  get totalRemaining() {
    return this.session.totalSeconds - this.totalElapsed;
  }
  get progressPct() {
    return Math.min(100, (this.totalElapsed / this.session.totalSeconds) * 100);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.startedAt = this.startedAt || Date.now();
    if (this.pausedAt) {
      this.totalPausedMs += Date.now() - this.pausedAt;
      this.pausedAt = null;
    }
    fxStart();
    this._announcePhase(this.currentPhase, true);
    acquireWakeLock();
    this.timer = setInterval(() => this._tick(), 1000);
    this.dispatchEvent(new CustomEvent('resume'));
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    this.pausedAt = Date.now();
    clearInterval(this.timer);
    releaseWakeLock();
    speechSynthesis.cancel();
    this.dispatchEvent(new CustomEvent('pause'));
  }

  toggle() { this.running ? this.pause() : this.start(); }

  skipPhase() {
    if (this.phaseIndex < this.session.phases.length - 1) {
      this.totalElapsed += this.phaseRemaining;
      this.phaseElapsed = 0;
      this.phaseIndex++;
      this._announcePhase(this.currentPhase, false);
      this.dispatchEvent(new CustomEvent('phaseStart', { detail: { phase: this.currentPhase } }));
    }
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    releaseWakeLock();
    speechSynthesis.cancel();
  }

  _tick() {
    this.phaseElapsed++;
    this.totalElapsed++;
    const remaining = this.phaseRemaining;

    // Countdown ultimi 3 secondi della fase
    if (remaining === 3 || remaining === 2 || remaining === 1) {
      fxCountdown();
    }

    this.dispatchEvent(new CustomEvent('tick', {
      detail: {
        phaseRemaining: remaining,
        totalElapsed: this.totalElapsed,
        totalRemaining: this.totalRemaining,
        progressPct: this.progressPct,
      },
    }));

    // Andata/ritorno: metà distanza raggiunta → "torna indietro"
    if (this.outAndBack && !this.turnaroundFired && this.turnaroundSec && this.totalElapsed >= this.turnaroundSec) {
      this.turnaroundFired = true;
      fxPhaseChange();
      vibrate([300, 120, 300, 120, 300]);
      speak('Metà percorso. Torna indietro adesso: inverti la rotta verso casa.');
      this.dispatchEvent(new CustomEvent('turnaround', { detail: { atSec: this.totalElapsed } }));
    }

    // Microcue del coach: consegna discreta, lontano dai cambi fase (>8s)
    if (this.cueIdx < this.cues.length && this.totalElapsed >= this.cueTimes[this.cueIdx]
        && this.phaseElapsed > 8 && remaining > 8) {
      speak(this.cues[this.cueIdx]);
      this.dispatchEvent(new CustomEvent('cue', { detail: { text: this.cues[this.cueIdx] } }));
      this.cueIdx++;
    }

    if (remaining <= 0) {
      this.dispatchEvent(new CustomEvent('phaseEnd', { detail: { phase: this.currentPhase } }));
      // Passa alla prossima fase
      if (this.phaseIndex < this.session.phases.length - 1) {
        this.phaseIndex++;
        this.phaseElapsed = 0;
        this._announcePhase(this.currentPhase, false);
        this.dispatchEvent(new CustomEvent('phaseStart', { detail: { phase: this.currentPhase } }));
      } else {
        // Fine sessione
        this.stop();
        fxFinish();
        speak('Sessione completata. Ottimo lavoro!');
        vibrate([200, 100, 200, 100, 400]);
        this.dispatchEvent(new CustomEvent('finish'));
      }
    }
  }

  _announcePhase(phase, isFirst) {
    fxPhaseChange();
    vibrate([100, 50, 100]);
    const typeNames = {
      warmup: 'Riscaldamento',
      walk: 'Camminata di recupero',
      brisk: 'Passo veloce',
      jog: 'Corsa leggera',
      run: 'Corsa sostenuta',
      cooldown: 'Defaticamento',
      rest: 'Pausa',
    };
    const mins = Math.floor(phase.seconds / 60);
    const secs = phase.seconds % 60;
    let duration;
    if (mins && secs) duration = `${mins} minuti e ${secs} secondi`;
    else if (mins) duration = `${mins} ${mins === 1 ? 'minuto' : 'minuti'}`;
    else duration = `${secs} secondi`;

    const intro = isFirst ? 'Iniziamo. ' : 'Cambio fase. ';
    speak(`${intro}${typeNames[phase.type]} per ${duration}. ${phase.cue || ''}`);
  }
}
