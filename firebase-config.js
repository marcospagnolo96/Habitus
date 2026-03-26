// ══════════════════════════════════════════════════════════════
//  FIREBASE CONFIG — Sostituisci con le tue credenziali!
//  1. Vai su https://console.firebase.google.com
//  2. Crea un progetto → Aggiungi app Web
//  3. Copia l'oggetto firebaseConfig qui sotto
// ══════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAPr34UA3XH64GRMkfIsUGhDM4x_z-JcHE",
  authDomain: "habitus-5f731.firebaseapp.com",
  projectId: "habitus-5f731",
  storageBucket: "habitus-5f731.firebasestorage.app",
  messagingSenderId: "701209713865",
  appId: "1:701209713865:web:45dc4b30dec794dc428118"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
