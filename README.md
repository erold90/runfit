# 🏃 RunFit — Allenamento corsa adattivo per dimagrimento

PWA installabile su iPhone (e qualunque dispositivo) che ti guida passo passo
durante un programma di corsa **evidence-based di 12 settimane**, pensato per chi
parte da zero e vuole **dimagrire**. Coach vocale italiano, timer preciso,
adattamento dinamico in base ai tuoi feedback e ai dati Apple Watch.

> **Stack**: HTML + CSS + Vanilla JS · Chart.js · Service Worker (PWA) · Cloudflare Worker (opzionale, backup KV) · GitHub Pages (deploy)

---

## ✨ Cosa fa

- **Programma 12 settimane** — Walk-Run progressivo (Galloway) + Zone 2 per max fat oxidation
- **3 sessioni a settimana** — A: walk-run, B: long Z2, C: fartlek/variazione
- **Coach vocale italiano** — ti dice quando correre, camminare, fare passo veloce
- **Timer preciso** con beep di countdown + vibrazione
- **Adattamento dinamico** — dopo ogni settimana decide se procedere/ripetere/saltare
- **Zone HR personalizzate** (formula Tanaka 2001 + Karvonen)
- **Stima calorie** Keytel et al. 2005 (HR-based, più accurato di MET)
- **Statistiche** — volume settimanale, RPE, FC media, peso (Chart.js)
- **Storico** sessioni con note
- **Backup cloud** opzionale via Cloudflare Worker (KV)
- **PWA** installabile, funziona offline

## 🧪 Basi scientifiche

Le scelte di programmazione si basano su:

- **Walk-Run intervals**: RCT Karstoft et al. (2013) — diabete tipo 2, -4.3 kg in 4 mesi vs 0 kg camminata continua a parità di energia spesa
- **Meta-analisi BJSM 2020** (41 studi): interval training -1.58 kg vs continuous -1.13 kg
- **Zone 2 (60-70% HRmax)**: massima ossidazione lipidica per popolazione untrained/sedentari
- **Formula Tanaka 2001** (HRmax = 208 − 0.7 × età) più accurata della 220-età
- **Couch-to-5K reso più graduale**: la versione classica perde il 50% dei principianti alla settimana 5 (5→8→20 min troppo aggressivo)
- **RPE 1-10** (CR-10 Borg): biomarker soggettivo validato per autoregolazione
- **3 sessioni/settimana**: gold standard per fat loss principianti (BJSM 2020)

Per chi parte sovrappeso: settimane 1-3 sostituiscono la corsa con **power-walk Z2**
(80% dei benefici, rischio infortunio molto più basso).

---

## 🚀 Deploy

### Frontend su GitHub Pages

```bash
# 1) Crea un nuovo repo (es. github.com/erold90/runfit)
gh repo create runfit --public --source=. --remote=origin

# 2) Push iniziale
git init
git add .
git commit -m "feat: initial commit RunFit"
git branch -M main
git push -u origin main

# 3) Abilita Pages: Settings -> Pages -> Source: GitHub Actions
# Il workflow .github/workflows/deploy.yml farà il resto.
```

L'app sarà su `https://<user>.github.io/runfit/`.

### Backup cloud (opzionale) su Cloudflare Workers

```bash
cd worker
npm install
npx wrangler login

# Crea KV namespace
npx wrangler kv namespace create BACKUP_KV
# -> copia l'ID nel wrangler.toml

# Token di autenticazione
openssl rand -hex 32                  # copia
npx wrangler secret put AUTH_TOKEN    # incolla

# Deploy
npx wrangler deploy
# -> ricevi un URL https://runfit-backup.<acct>.workers.dev
```

Poi nell'app:
- vai a **Profilo → Backup cloud**
- inserisci URL Worker + Token Bearer (quello generato sopra)
- premi **☁️ Carica su cloud**

---

## 📱 Installa su iPhone

1. Apri l'URL Pages in **Safari**
2. Condividi → **Aggiungi alla schermata Home**
3. Apri l'icona: si comporta come app nativa, fullscreen, coach vocale, offline.
4. Per il **coach vocale**: la prima volta dopo il tap su "Inizia sessione" sblocca l'audio (iOS lo richiede). Una voce italiana viene scelta automaticamente da Sistema → Accessibilità → Voci.

---

## ⌚ Integrazione Apple Watch

L'app **non** legge automaticamente Apple Health (limite tecnico del web su iOS).
Il flusso semplice e robusto è:

1. Durante la sessione, avvia **Allenamento → All'aperto** sull'Apple Watch
2. A fine sessione il Watch ti mostra **FC media** e **distanza**
3. Inserisci questi due valori nel form di feedback dell'app
4. L'app calcola calorie (Keytel) e adatta la settimana successiva

In futuro: integrazione con shortcut iOS per pushare dati con un tap.

---

## 📂 Struttura

```
runfit/
├── public/                  # ← Frontend (deployato su GitHub Pages)
│   ├── index.html
│   ├── styles.css
│   ├── app.js               # UI, viste, navigazione
│   ├── program.js           # Programma 12 sett. + algoritmo adattivo + zone HR
│   ├── coach.js             # Timer, TTS italiano, beep, wake lock, vibrate
│   ├── storage.js           # LocalStorage + cloud sync
│   ├── manifest.json        # PWA
│   ├── sw.js                # Service worker offline-first
│   └── icons/
├── worker/                  # ← Cloudflare Worker (opzionale)
│   ├── src/index.js
│   ├── wrangler.toml
│   └── package.json
├── .github/workflows/deploy.yml
└── README.md
```

---

## 🎯 Per chi usa l'app (Daniele)

Il programma è già pre-tarato sui tuoi dati:
- **Età**: 36 (da CLAUDE.md, 1990)
- **HRmax stimato**: 183 bpm (formula Tanaka)
- **Zone 2 (fat oxidation max)**: 110-128 bpm — punta qui nelle long run del giovedì
- **Peso target**: modificabile in Profilo

### Esempio settimana 1
| Giorno | Sessione | Durata | Cosa fai |
|--------|----------|--------|----------|
| Lun | A — Camminata + mini-jog | ~25 min | 6× (1'30 brisk + 30" jog) |
| Mer | B — Power walk Z2 | ~35 min | 25 min cammino veloce Z2 |
| Ven | C — Esplorazione | ~25 min | 5× (2' brisk + 30" jog) |

Riposo nei giorni in mezzo (puoi inserire 1-2 sessioni di forza/core 10 min, ma non obbligatorio).

### Adattamento
Dopo ogni sessione inserisci RPE (1-10) e FC media. A fine settimana l'app decide:
- **2+ sessioni con RPE ≥ 8** → ripete la settimana
- **2+ sessioni con RPE ≤ 4 e 100% completate** → salta 1 settimana avanti
- **Sessione con RPE ≥ 9 o < 60% completata** → torna indietro di 1 settimana (deload)

---

## 📜 Licenza

MIT — usalo, modificalo, scrivici cose sopra.
