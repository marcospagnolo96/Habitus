# 🌱 Habitus — Guida all'installazione

## Struttura file
```
habitus/
├── index.html          ← App principale
├── style.css           ← Stili
├── app.js              ← Logica app
├── firebase-config.js  ← ⚠️ DA CONFIGURARE
├── sw.js               ← Service Worker (offline)
├── manifest.json       ← PWA manifest
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

---

## STEP 1 — Crea il progetto Firebase (5 minuti)

1. Vai su **https://console.firebase.google.com**
2. Clicca **"Crea un progetto"** → dai un nome (es. "habitus-app")
3. Disabilita Google Analytics (facoltativo) → **Crea progetto**

### Abilita Authentication:
1. Nel menu laterale → **Authentication** → **Inizia**
2. Tab "Sign-in method" → abilita **Email/Password** → Salva

### Abilita Firestore:
1. Nel menu laterale → **Firestore Database** → **Crea database**
2. Scegli **"Modalità produzione"** → Seleziona regione (es. `europe-west3`) → Fatto

### Ottieni le credenziali:
1. Icona ingranaggio ⚙️ → **Impostazioni progetto**
2. Scorri fino a **"Le tue app"** → clicca icona **`</>`** (Web)
3. Dai un nome all'app (es. "Habitus Web") → **Registra app**
4. Copia l'oggetto `firebaseConfig`

---

## STEP 2 — Configura `firebase-config.js`

Apri il file `firebase-config.js` e sostituisci i valori:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",           // ← copia qui
  authDomain: "mio-progetto.firebaseapp.com",
  projectId: "mio-progetto",
  storageBucket: "mio-progetto.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123...:web:abc..."
};
```

---

## STEP 3 — Configura le regole Firestore

In Firebase Console → Firestore → **Regole**, incolla:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

→ **Pubblica**

---

## STEP 4 — Pubblica su GitHub Pages (gratis)

### Crea il repository:
1. Vai su **https://github.com** → **New repository**
2. Nome: `habitus` (o quello che vuoi)
3. Impostalo come **Public** → **Create repository**

### Carica i file:
```bash
# Se usi Git da terminale:
git init
git add .
git commit -m "First commit"
git branch -M main
git remote add origin https://github.com/TUO-USERNAME/habitus.git
git push -u origin main
```
Oppure usa il pulsante **"Upload files"** direttamente su GitHub.

### Attiva GitHub Pages:
1. Nel tuo repo → **Settings** → **Pages**
2. Source: **"Deploy from a branch"**
3. Branch: **main** → cartella: **/ (root)**
4. Clicca **Save**

La tua app sarà disponibile su:
`https://TUO-USERNAME.github.io/habitus/`

---

## STEP 5 — Installa sul telefono

### Android (Chrome):
1. Apri l'URL nel browser Chrome
2. Tocca i 3 puntini ⋮ → **"Aggiungi alla schermata Home"**
3. Conferma → L'app appare come un'app nativa!

### iPhone (Safari):
1. Apri l'URL in Safari
2. Tocca l'icona **Condividi** (quadrato con freccia)
3. **"Aggiungi alla schermata Home"** → Aggiungi

---

## Funzionalità incluse

- ✅ **Login / Registrazione** con Firebase Auth
- ✅ **3 tipi di tracking**: Sì/No, Numero con obiettivo, Timer
- ✅ **4 frequenze**: Ogni giorno, X/settimana, Giorni fissi, X/mese
- ✅ **Streak** (giorni consecutivi con fiamma 🔥)
- ✅ **Statistiche**: % completamento, heatmap 30gg, grafico settimanale
- ✅ **Multi-data**: naviga tra gli ultimi 7 giorni
- ✅ **Installabile** su iPhone e Android (PWA)
- ✅ **Dati in cloud** sincronizzati su tutti i dispositivi

---

## Tutto gratis?

| Servizio | Costo |
|---|---|
| GitHub Pages (hosting) | **Gratis** |
| Firebase Auth | **Gratis** (utenti illimitati) |
| Firestore | **Gratis** fino a 1GB + 50k letture/giorno |
| Firebase Hosting (alternativa) | **Gratis** 10GB/mese |

Per uso personale o piccolo gruppo: **tutto gratis** per sempre!
