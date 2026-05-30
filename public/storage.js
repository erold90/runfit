// ============================================================================
// RunFit — Storage (localStorage + optional Cloudflare Worker backup)
// ============================================================================

const LS_PROFILE = 'runfit.profile';
const LS_SESSIONS = 'runfit.sessions';
const LS_PROGRESS = 'runfit.progress';
const LS_WEIGHTS = 'runfit.weights';
const LS_SETTINGS = 'runfit.settings';

/**
 * @typedef {Object} Profile
 * @property {string} name
 * @property {number} birthYear
 * @property {boolean} isMale
 * @property {number} weightStartKg
 * @property {number} weightCurrentKg
 * @property {number} weightTargetKg
 * @property {number} heightCm
 * @property {number} restingHr
 * @property {number} [hrMaxOverride]    Se l'utente ha test reale, sovrascrive la formula
 */

const defaultProfile = {
  name: 'Daniele',
  birthYear: 1990,
  isMale: true,
  weightStartKg: 85,
  weightCurrentKg: 85,
  weightTargetKg: 75,
  heightCm: 175,
  restingHr: 60,
  hrMaxOverride: null,
  strengthLevel: 'returning', // 'beginner' | 'returning' | 'advanced'
  strengthEnabled: true,
};

const defaultAssessment = {
  done: false,
  walkTest: null,        // { timeMin, finalHr, hrAfter1min, distanceKm, date }
  strengthTest: null,    // { pushups, squats2min, plankSec, hollowSec, date }
  results: null,         // { vo2max, vo2Cat, hrrDrop, hrrCat, strengthLevel, hrMax, z2Range }
};

const LS_ASSESSMENT = 'runfit.assessment';
export const getAssessment = () => read(LS_ASSESSMENT, defaultAssessment);
export const saveAssessment = a => write(LS_ASSESSMENT, a);

const defaultProgress = {
  currentWeek: 1,
  currentSessionIndex: 0,  // 0=A, 1=B, 2=C, 3=D, 4=E
  weeklyVolume: 3,         // 3 default, sale a 4 e poi 5 se i feedback lo permettono
  startedAt: null,
  weekFeedbacks: [],       // feedback ultima settimana per algoritmo adattivo
  volumePromotedAt: null,  // settimana in cui è avvenuta l'ultima promozione (per UI)
  // Programma FORZA (separato dalla corsa)
  strengthWeek: 1,
  strengthSessionIndex: 0, // 0=S1, 1=S2, 2=S3
};

const defaultSettings = {
  audioCoach: true,
  beeps: true,
  vibrate: true,
  keepScreenOn: true,
  cloudUrl: '',            // URL Cloudflare Worker (opzionale)
  cloudToken: '',          // Token Bearer (opzionale)
  voice: '',               // Nome voce sintesi (default it-IT)
};

// --- Read/Write helpers ----------------------------------------------------
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}
function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// --- Profile ---------------------------------------------------------------
export const getProfile = () => read(LS_PROFILE, defaultProfile);
export const saveProfile = p => write(LS_PROFILE, p);

// --- Progress (settimana corrente, posizione nel programma) ---------------
export const getProgress = () => read(LS_PROGRESS, defaultProgress);
export const saveProgress = p => write(LS_PROGRESS, p);

// --- Settings --------------------------------------------------------------
export const getSettings = () => read(LS_SETTINGS, defaultSettings);
export const saveSettings = s => write(LS_SETTINGS, s);

// --- Sessions log ----------------------------------------------------------
export function getSessions() {
  try {
    return JSON.parse(localStorage.getItem(LS_SESSIONS) || '[]');
  } catch {
    return [];
  }
}
export function saveSession(record) {
  const list = getSessions();
  list.push(record);
  localStorage.setItem(LS_SESSIONS, JSON.stringify(list));
}
export function deleteSession(id) {
  const list = getSessions().filter(s => s.id !== id);
  localStorage.setItem(LS_SESSIONS, JSON.stringify(list));
}
export function updateSession(record) {
  const list = getSessions();
  const idx = list.findIndex(s => s.id === record.id);
  if (idx === -1) return false;
  list[idx] = record;
  localStorage.setItem(LS_SESSIONS, JSON.stringify(list));
  return true;
}
export function getSession(id) {
  return getSessions().find(s => s.id === id) || null;
}

// --- Weight log ------------------------------------------------------------
export function getWeights() {
  try {
    return JSON.parse(localStorage.getItem(LS_WEIGHTS) || '[]');
  } catch {
    return [];
  }
}
export function addWeight(kg, dateISO = new Date().toISOString()) {
  const list = getWeights();
  list.push({ date: dateISO, kg });
  list.sort((a, b) => new Date(a.date) - new Date(b.date));
  localStorage.setItem(LS_WEIGHTS, JSON.stringify(list));
  // Aggiorna anche profilo
  const p = getProfile();
  p.weightCurrentKg = kg;
  saveProfile(p);
}

// --- Export/Import locale --------------------------------------------------
export function exportAllJson() {
  return JSON.stringify({
    profile: getProfile(),
    progress: getProgress(),
    sessions: getSessions(),
    weights: getWeights(),
    settings: getSettings(),
    exportedAt: new Date().toISOString(),
    version: 1,
  }, null, 2);
}
export function importAllJson(jsonStr) {
  const data = JSON.parse(jsonStr);
  if (data.profile) saveProfile(data.profile);
  if (data.progress) saveProgress(data.progress);
  if (data.sessions) localStorage.setItem(LS_SESSIONS, JSON.stringify(data.sessions));
  if (data.weights) localStorage.setItem(LS_WEIGHTS, JSON.stringify(data.weights));
  if (data.settings) saveSettings(data.settings);
}

// --- Cloud sync (Cloudflare Worker, opzionale) ----------------------------
export async function cloudPush() {
  const s = getSettings();
  if (!s.cloudUrl || !s.cloudToken) throw new Error('Cloud non configurato');
  const body = exportAllJson();
  const res = await fetch(`${s.cloudUrl}/backup`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${s.cloudToken}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  if (!res.ok) throw new Error(`Upload fallito (${res.status})`);
  return res.json();
}

export async function cloudPull() {
  const s = getSettings();
  if (!s.cloudUrl || !s.cloudToken) throw new Error('Cloud non configurato');
  const res = await fetch(`${s.cloudUrl}/backup`, {
    headers: { 'Authorization': `Bearer ${s.cloudToken}` },
  });
  if (!res.ok) throw new Error(`Download fallito (${res.status})`);
  const text = await res.text();
  importAllJson(text);
  return true;
}
