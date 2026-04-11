// ══════════════════════════════════════════════════════════════
//  HABITUS — app.js
//  Auth · Habits CRUD · Daily tracking · Statistics
// ══════════════════════════════════════════════════════════════

import { auth, db } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection, doc, setDoc, getDoc, getDocs,
  deleteDoc, onSnapshot, query, orderBy,
  serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── STATE ──────────────────────────────────────────────────────
let currentUser = null;
let habits = [];
let logs = {};          // { dateStr: { habitId: value } }
let selectedDate = todayStr();
let editingHabitId = null;
let selectedEmoji = '🌱';
let selectedColor = '#4ade80';
let selectedType = 'boolean';
let selectedFreq = 'daily';
let selectedDays = [];
let activeTimers = {};  // { habitId: { start, elapsed, interval } }
let logModalHabit = null;
let logTimerRunning = false;
let logTimerStart = null;
let logTimerElapsed = 0;
let logTimerInterval = null;
let statsHabitId = null;
let statsViewYear = new Date().getFullYear();
let currentChartPeriod = 'week';
let unsubHabits = null;
let unsubLogs = null;
let actionSheetHabit = null;
let showArchived = false;

// ─── THEME HANDLING ─────────────────────────────────────────────
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const iconLight = document.getElementById('icon-theme-light');
const iconDark = document.getElementById('icon-theme-dark');
const metaThemeColor = document.querySelector('meta[name="theme-color"]');

let currentTheme = localStorage.getItem('theme') || 'dark';
applyTheme(currentTheme);

if (btnThemeToggle) {
  btnThemeToggle.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(currentTheme);
  });
}

function applyTheme(theme) {
  localStorage.setItem('theme', theme);
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    if (iconLight) iconLight.classList.remove('hidden');
    if (iconDark) iconDark.classList.add('hidden');
    if (metaThemeColor) metaThemeColor.setAttribute('content', '#f8fafc');
  } else {
    document.documentElement.removeAttribute('data-theme');
    if (iconLight) iconLight.classList.add('hidden');
    if (iconDark) iconDark.classList.remove('hidden');
    if (metaThemeColor) metaThemeColor.setAttribute('content', '#0f0f14');
  }
}

// ─── UTILITIES ──────────────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2,'0');
  const s = (sec % 60).toString().padStart(2,'0');
  return `${m}:${s}`;
}
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2100);
}

// Greeting based on time
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buongiorno';
  if (h < 18) return 'Buon pomeriggio';
  return 'Buonasera';
}

// ─── CONNECTION MONITOR ──────────────────────────────────────────
// FIX: feedback visivo quando l'app va offline/torna online.
// Le write offline vengono accodate automaticamente dal Firebase SDK
// e inviate al ritorno della connessione.
function initConnectionMonitor() {
  const banner = document.createElement('div');
  banner.id = 'offline-banner';
  banner.textContent = '📵 Offline — le modifiche saranno sincronizzate al ritorno';
  banner.style.cssText = `
    display: none; position: fixed; top: 0; left: 0; right: 0;
    background: #1e1e2a; color: #fbbf24;
    border-bottom: 1px solid rgba(251,191,36,0.3);
    text-align: center; font-size: 0.8rem; font-weight: 600;
    padding: 8px 16px; z-index: 99999;
    padding-top: calc(env(safe-area-inset-top, 0px) + 8px);
  `;
  document.body.appendChild(banner);

  function setOnline() {
    banner.style.display = 'none';
    toast('🟢 Connessione ripristinata');
  }
  function setOffline() {
    banner.style.display = 'block';
  }

  window.addEventListener('online',  setOnline);
  window.addEventListener('offline', setOffline);

  // Stato iniziale (nel caso si apra già offline)
  if (!navigator.onLine) setOffline();
}

// ─── DRAG & DROP RIORDINO ABITUDINI ──────────────────────────────
// Salva su Firestore il nuovo ordine dopo un drag. Usa un campo numerico
// 'order' su ogni documento abitudine. Write batch per atomicità.
async function saveHabitsOrder(orderedIds) {
  if (!currentUser) return;
  const writes = orderedIds.map((id, i) =>
    setDoc(doc(db, 'users', currentUser.uid, 'habits', id), { order: i }, { merge: true })
  );
  try {
    await Promise.all(writes);
  } catch (err) {
    console.error('Errore salvataggio ordine:', err);
    toast('⚠️ Impossibile salvare l\'ordine. Riprova.');
  }
}

// Stato drag
let dragState = null;
// { habitId, originIndex, ghostEl, sourceCard,
//   startY, lastY, cards[], container }

function initDragOnCard(card, habit) {
  const handle = card.querySelector('.habit-emoji');
  if (!handle) return;

  let dragPressTimer = null;
  const DRAG_DELAY = 500; // ms di pressione prima di attivare il drag

  // ── Touch (mobile) ────────────────────────────────────────────
  handle.addEventListener('touchstart', e => {
    const touch = e.touches[0];
    dragPressTimer = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(30);
      handle.classList.add('drag-active');
      startDrag(touch.clientY, card, habit);
    }, DRAG_DELAY);
  }, { passive: true });

  handle.addEventListener('touchmove', () => {
    // Se l'utente scorre, cancella il drag imminente
    if (dragPressTimer) { clearTimeout(dragPressTimer); dragPressTimer = null; }
  }, { passive: true });

  handle.addEventListener('touchend', () => {
    if (dragPressTimer) { clearTimeout(dragPressTimer); dragPressTimer = null; }
    handle.classList.remove('drag-active');
  }, { passive: true });

  document.addEventListener('touchmove', onDragMove, { passive: false });
  document.addEventListener('touchend',  () => {
    handle.classList.remove('drag-active');
    onDragEnd();
  }, { passive: true });

  // ── Mouse (desktop) ───────────────────────────────────────────
  handle.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    dragPressTimer = setTimeout(() => {
      handle.classList.add('drag-active');
      startDrag(e.clientY, card, habit);
    }, DRAG_DELAY);
  });

  handle.addEventListener('mouseup', () => {
    if (dragPressTimer) { clearTimeout(dragPressTimer); dragPressTimer = null; }
    handle.classList.remove('drag-active');
  });

  handle.addEventListener('mouseleave', () => {
    if (dragPressTimer) { clearTimeout(dragPressTimer); dragPressTimer = null; }
  });

  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup',   () => {
    handle.classList.remove('drag-active');
    onDragEnd();
  });
}

function startDrag(clientY, card, habit) {
  const container = document.getElementById('habits-container');
  const cards = Array.from(container.querySelectorAll('.habit-card:not(.paused-card)'));
  const originIndex = cards.indexOf(card);
  if (originIndex === -1) return;

  // Clona la card come "ghost" flottante
  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.style.cssText = `
    position: fixed; left: ${rect.left}px; top: ${rect.top}px;
    width: ${rect.width}px; z-index: 9000;
    opacity: 0.92; pointer-events: none;
    transform: scale(1.02) rotate(1deg);
    box-shadow: 0 12px 40px rgba(0,0,0,0.5);
    transition: transform 0.1s, box-shadow 0.1s;
  `;
  document.body.appendChild(ghost);

  // Placeholder trasparente al posto della card originale
  card.style.opacity = '0.25';
  card.style.transition = 'none';

  dragState = {
    habitId: habit.id,
    originIndex,
    currentIndex: originIndex,
    ghostEl: ghost,
    sourceCard: card,
    startY: clientY,
    lastY: clientY,
    cards,
    container,
    ghostTop: rect.top,
  };
}

function onDragMove(e) {
  if (!dragState) return;
  e.preventDefault();
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const { ghostEl, ghostTop, startY, cards, sourceCard, container } = dragState;

  // Muovi il ghost
  const deltaY = clientY - startY;
  ghostEl.style.top = (ghostTop + deltaY) + 'px';
  dragState.lastY = clientY;

  // Trova su quale card siamo passati sopra
  const hoveredCard = cards.find(c => {
    if (c === sourceCard) return false;
    const r = c.getBoundingClientRect();
    return clientY >= r.top && clientY <= r.bottom;
  });

  if (!hoveredCard) return;
  const hoveredIndex = cards.indexOf(hoveredCard);
  if (hoveredIndex === dragState.currentIndex) return;

  // Riordina visivamente le card nel DOM
  dragState.currentIndex = hoveredIndex;
  const ref = hoveredIndex < cards.indexOf(sourceCard)
    ? hoveredCard
    : hoveredCard.nextSibling;
  container.insertBefore(sourceCard, ref);
  // Aggiorna l'array cards nell'ordine DOM corrente
  dragState.cards = Array.from(container.querySelectorAll('.habit-card:not(.paused-card)'));
}

function onDragEnd() {
  if (!dragState) return;
  const { ghostEl, sourceCard, cards, habitId } = dragState;

  // Rimuovi ghost e ripristina la card
  ghostEl.remove();
  sourceCard.style.opacity = '';
  sourceCard.style.transition = '';

  // Calcola il nuovo ordine dal DOM aggiornato
  const finalCards = Array.from(
    dragState.container.querySelectorAll('.habit-card:not(.paused-card)')
  );
  const orderedIds = finalCards.map(c => c.dataset.id);

  // Aggiorna lo stato locale immediatamente (ottimistico)
  const newHabits = orderedIds
    .map(id => habits.find(h => h.id === id))
    .filter(Boolean);
  // Mantieni le abitudini sospese in fondo
  const paused = habits.filter(h => h.paused);
  habits = [...newHabits, ...paused];

  dragState = null;

  // Salva su Firestore
  saveHabitsOrder(orderedIds);
}

// ─── SCHEDULING ──────────────────────────────────────────────────

// Should a habit appear today? (usata nell'UI quotidiana)
function habitScheduledFor(habit, dateString) {
  const d = new Date(dateString + 'T12:00:00');
  const dow = d.getDay(); // 0=Sun..6=Sat
  switch (habit.freq) {
    case 'daily': return true;
    case 'days':  return (habit.freqDays || []).map(Number).includes(dow);
    case 'weekly': {
      if (!habit.freqN) return true;
      // Count completions strictly BEFORE dateString in the same week
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
      const weekStart = new Date(d); weekStart.setDate(diff);
      let countBefore = 0;
      for (let i = 0; i < 7; i++) {
        const cur = new Date(weekStart); cur.setDate(weekStart.getDate() + i);
        const ds = dateStr(cur);
        if (ds >= dateString) break;
        if (isHabitLoggedOnDay(habit, ds)) countBefore++;
      }
      return countBefore < habit.freqN;
    }
    case 'monthly': {
      if (!habit.freqN) return true;
      // Count completions strictly BEFORE dateString in the same month
      const [y, m] = dateString.split('-');
      const year = parseInt(y); const month = parseInt(m) - 1;
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      let countBefore = 0;
      for (let i = 1; i <= daysInMonth; i++) {
        const cur = new Date(year, month, i);
        const ds = dateStr(cur);
        if (ds >= dateString) break;
        if (isHabitLoggedOnDay(habit, ds)) countBefore++;
      }
      return countBefore < habit.freqN;
    }
    default: return true;
  }
}
function isHabitLoggedOnDay(habit, ds) {
  const dayLogs = logs[ds];
  if (!dayLogs) return false;
  const entry = dayLogs[habit.id];
  if (entry === undefined || entry === null) return false;
  
  if (typeof entry === 'object') {
    if (entry.skip) return false;
    return true; 
  }
  return !!entry;
}

function isHabitDayGoalMet(habit, ds) {
  const dayLogs = logs[ds];
  if (!dayLogs) return false;
  const entry = dayLogs[habit.id];
  if (entry === undefined || entry === null) return false;

  const val = (typeof entry === 'object') ? entry.val : entry;
  const skip = (typeof entry === 'object') ? entry.skip : false;
  if (skip) return false;

  if (habit.type === 'boolean') return !!val;
  if (habit.type === 'number') return Number(val || 0) >= (habit.goal || 1);
  if (habit.type === 'timer') {
    const target = (habit.duration || 0) * 60;
    return target > 0 ? Number(val || 0) >= target : Number(val || 0) > 0;
  }
  return false;
}

function isHabitSkippedOnDay(habit, dateString) {
  const entry = (logs[dateString] || {})[habit.id];
  return (typeof entry === 'object' && entry !== null && entry.skip === true);
}

function getHabitNoteOnDay(habit, dateString) {
  const entry = (logs[dateString] || {})[habit.id];
  return (typeof entry === 'object' && entry !== null) ? (entry.note || '') : '';
}

function checkWeeklyGoalMet(habit, dateString) {
  if (!habit.freqN) return false;
  const d = new Date(dateString + 'T12:00:00');
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday is start of week
  const start = new Date(d); start.setDate(diff);
  let count = 0;
  for (let i = 0; i < 7; i++) {
     const cur = new Date(start); cur.setDate(start.getDate() + i);
     if (isHabitDayGoalMet(habit, dateStr(cur))) count++;
  }
  return count >= habit.freqN;
}

function checkMonthlyGoalMet(habit, dateString) {
  if (!habit.freqN) return false;
  const [y, m] = dateString.split('-');
  const year = parseInt(y); const month = parseInt(m) - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let i = 1; i <= daysInMonth; i++) {
     const cur = new Date(year, month, i);
     if (isHabitDayGoalMet(habit, dateStr(cur))) count++;
  }
  let target = Math.round((habit.freqN / 31) * daysInMonth);
  if (target < 1) target = 1;
  return count >= target;
}

// Full check (logged today OR periodic goal met)
// This is the main function used by the UI
function isHabitDone(habit, dateString) {
  if (isHabitSkippedOnDay(habit, dateString)) return false;
  
  // 1. Check if the daily goal is met for this specific day
  if (isHabitDayGoalMet(habit, dateString)) return true;
  
  // 2. For periodic habits, check if the quota for the week/month is met
  if (habit.freq === 'weekly') return checkWeeklyGoalMet(habit, dateString);
  if (habit.freq === 'monthly') return checkMonthlyGoalMet(habit, dateString);
  
  return false;
}

// ─── AUTH ────────────────────────────────────────────────────────
const authScreen = document.getElementById('auth-screen');
const appScreen  = document.getElementById('app-screen');

onAuthStateChanged(auth, user => {
  if (user) {
    currentUser = user;
    showApp();
  } else {
    currentUser = null;
    showAuth();
  }
});

function showAuth() {
  authScreen.classList.add('active');
  appScreen.classList.remove('active');
  if (unsubHabits) { unsubHabits(); unsubHabits = null; }
  if (unsubLogs)   { unsubLogs();   unsubLogs = null;   }
}
function showApp() {
  authScreen.classList.remove('active');
  appScreen.classList.add('active');
  document.getElementById('greeting').textContent = getGreeting();
  document.getElementById('user-display-name').textContent =
    currentUser.displayName || currentUser.email.split('@')[0];
  selectedDate = todayStr();
  buildDateStrip();
  // FIX: le due subscription vengono avviate indipendentemente e rimangono
  // stabili per tutta la sessione — i log non vengono più ri-sottoscritti
  // ogni volta che cambia un'abitudine.
  subscribeHabits();
  subscribeLogs();
  initConnectionMonitor();
}

// Auth tabs
document.querySelectorAll('.auth-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
    document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
    document.getElementById('auth-error').classList.add('hidden');
  });
});

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-password').value;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch(err) {
    showAuthError(err.code);
  }
});

document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass  = document.getElementById('reg-password').value;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
  } catch(err) {
    showAuthError(err.code);
  }
});

function showAuthError(code) {
  const map = {
    'auth/invalid-email':      'Email non valida.',
    'auth/user-not-found':     'Utente non trovato.',
    'auth/wrong-password':     'Password errata.',
    'auth/email-already-in-use': 'Email già registrata.',
    'auth/weak-password':      'Password troppo corta (min. 6 caratteri).',
    'auth/invalid-credential': 'Credenziali non valide.',
  };
  const el = document.getElementById('auth-error');
  el.textContent = map[code] || 'Errore. Riprova.';
  el.classList.remove('hidden');
}

document.getElementById('btn-logout').addEventListener('click', async () => {
  habits = []; logs = {};
  await signOut(auth);
});

// ─── FIRESTORE SUBSCRIPTIONS ─────────────────────────────────────
function subscribeHabits() {
  const habitsRef = collection(db, 'users', currentUser.uid, 'habits');
  // Ordiniamo lato client per supportare sia il campo 'order' (drag&drop)
  // sia il fallback su 'createdAt' per abitudini più vecchie senza campo order.
  unsubHabits = onSnapshot(habitsRef, snap => {
    habits = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ao = a.order ?? a.createdAt?.seconds ?? 0;
        const bo = b.order ?? b.createdAt?.seconds ?? 0;
        return ao - bo;
      });
    renderHabits();
    renderStatsDashboard();
    // FIX: subscribeLogs non viene più richiamata qui ad ogni snapshot habits.
    // Viene avviata una sola volta in showApp() per evitare che ogni
    // modifica/aggiunta di abitudine distrugga e ricrei la subscription ai log.
  });
}

function subscribeLogs() {
  if (unsubLogs) { unsubLogs(); unsubLogs = null; }
  const logsRef = collection(db, 'users', currentUser.uid, 'logs');
  
  console.log("Sottoscrizione log avviata per:", currentUser.uid);
  
  unsubLogs = onSnapshot(logsRef, 
    snap => {
      console.log("Snapshot log ricevuto. Documenti:", snap.size);
      // FIX: merge profondo invece di sovrascrittura totale, per non perdere
      // ottimistic updates locali ancora in volo verso Firestore.
      snap.docs.forEach(d => {
        logs[d.id] = { ...(logs[d.id] || {}), ...d.data() };
      });
      
      try {
        renderHabits();
        updateProgress();
        renderStatsDashboard(); 
        
        if (statsHabitId) {
           const detailVisible = !document.getElementById('stats-detail-view').classList.contains('hidden');
           if (detailVisible) {
             console.log("Aggiornamento stats per:", statsHabitId);
             
             // Estraiamo il mese/anno visualizzati per non resettare il calendario
             const icalTitle = document.querySelector('.ical-title');
             let vYear = null, vMonth = null;
             if (icalTitle) {
               const parts = icalTitle.textContent.split(' ');
               if (parts.length === 2) {
                 const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                                     'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
                 vMonth = monthNames.indexOf(parts[0]);
                 vYear = parseInt(parts[1]);
               }
             }
             renderStats(statsHabitId, vYear, vMonth);
           }
        }
      } catch (err) {
        console.error("Errore durante il refresh real-time:", err);
      }
    },
    err => {
      console.error("Errore Firestore Snapshot:", err);
    }
  );
}

// ─── DATE STRIP ──────────────────────────────────────────────────
function buildDateStrip() {
  const strip = document.getElementById('date-strip');
  strip.innerHTML = '';
  const days = ['Do','Lu','Ma','Me','Gi','Ve','Sa'];

  // Finestra di 30 giorni: 14 prima di oggi + oggi + 15 dopo
  const todayD = new Date(todayStr() + 'T12:00:00');
  const BEFORE = 14;
  const AFTER  = 15;

  for (let i = -BEFORE; i <= AFTER; i++) {
    const d = new Date(todayD);
    d.setDate(todayD.getDate() + i);
    const ds = dateStr(d);

    const pill = document.createElement('div');
    let pillClass = 'date-pill';
    if (ds === selectedDate)  pillClass += ' active';
    if (ds > todayStr())      pillClass += ' future-day';
    if (ds === todayStr())    pillClass += ' is-today';
    pill.className = pillClass;
    pill.dataset.date = ds;
    pill.innerHTML = `
      <span class="pill-day">${days[d.getDay()]}</span>
      <span class="pill-num">${d.getDate()}</span>`;
    pill.addEventListener('click', () => {
      selectedDate = ds;
      buildDateStrip();
      renderHabits();
      updateProgress();
    });
    strip.appendChild(pill);
  }

  // Aggiorna label data completa sopra la strip
  updateSelectedDateLabel();

  // Centra il pill selezionato
  setTimeout(() => {
    const active = strip.querySelector('.active');
    if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, 50);
}

function updateSelectedDateLabel() {
  const el = document.getElementById('selected-date-label');
  if (!el) return;
  const d = new Date(selectedDate + 'T12:00:00');
  const months = ['gennaio','febbraio','marzo','aprile','maggio','giugno',
                  'luglio','agosto','settembre','ottobre','novembre','dicembre'];
  const days   = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
  const isToday    = selectedDate === todayStr();
  const yesterday  = new Date(todayStr() + 'T12:00:00');
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = selectedDate === dateStr(yesterday);

  let label = '';
  if (isToday)         label = `Oggi, ${d.getDate()} ${months[d.getMonth()]}`;
  else if (isYesterday) label = `Ieri, ${d.getDate()} ${months[d.getMonth()]}`;
  else                  label = `${days[d.getDay()].charAt(0).toUpperCase() + days[d.getDay()].slice(1)}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;

  el.textContent = label;
}

// ─── RENDER HABITS ───────────────────────────────────────────────
function renderHabits() {
  const container = document.getElementById('habits-container');
  const emptyState = document.getElementById('empty-state');
  // Le abitudini archiviate non appaiono nella vista oggi
  const hActive = habits.filter(h => !h.paused && !h.archived && habitScheduledFor(h, selectedDate));
  const hPaused = habits.filter(h => h.paused && !h.archived);

  // Clear old cards but keep empty state
  container.querySelectorAll('.habit-card, .paused-section-header').forEach(c => c.remove());

  if (hActive.length === 0 && hPaused.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  // Active items
  hActive.forEach(habit => {
    const card = buildHabitCard(habit);
    container.appendChild(card);
  });

  // Paused items section
  if (hPaused.length > 0) {
    const header = document.createElement('div');
    header.className = 'paused-section-header';
    header.innerHTML = `<span>Abitudini Sospese</span>`;
    container.appendChild(header);

    hPaused.forEach(habit => {
      const card = buildHabitCard(habit);
      card.classList.add('paused-card');
      container.appendChild(card);
    });
  }

  buildDateStrip(); // refresh dots
}

function buildHabitCard(habit) {
  const card = document.createElement('div');
  card.className = 'habit-card';
  card.style.setProperty('--habit-color', habit.color || 'var(--accent)');
  card.dataset.id = habit.id;

  const isSkipped = isHabitSkippedOnDay(habit, selectedDate);
  const doneToday = isHabitDayGoalMet(habit, selectedDate);
  const doneGlobal = isHabitDone(habit, selectedDate);
  const entry = (logs[selectedDate] || {})[habit.id];
  const streak = computeStreak(habit);

  if (isSkipped) card.classList.add('skipped');

  // Emoji — funge anche da drag handle, mostriamo cursore grab
  const emojiEl = document.createElement('div');
  emojiEl.className = 'habit-emoji drag-handle';
  emojiEl.textContent = habit.emoji || '🌱';
  emojiEl.title = 'Tieni premuto per trascinare';

  // Info
  const info = document.createElement('div');
  info.className = 'habit-info';

  const name = document.createElement('div');
  name.className = 'habit-name';
  name.textContent = habit.name;

  const meta = document.createElement('div');
  meta.className = 'habit-meta';
  meta.innerHTML = `<span>${freqLabel(habit)}</span>`;
  if (streak > 0) {
    let sUnit = '';
    if (habit.freq === 'weekly') sUnit = ' sett';
    if (habit.freq === 'monthly') sUnit = ' mesi';
    meta.innerHTML += `<span class="habit-streak">🔥 ${streak}${sUnit}</span>`;
  }

  // LED progress last 7 days
  const leds = document.createElement('div');
  leds.className = 'habit-leds';
  const todayD = new Date(todayStr() + 'T12:00:00');
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayD);
    d.setDate(todayD.getDate() - i);
    const ds = dateStr(d);
    const dot = document.createElement('div');
    const isDone = isHabitDayGoalMet(habit, ds);
    const isSkipped = isHabitSkippedOnDay(habit, ds);
    dot.className = 'led-dot' + (isDone ? ' on' : '') + (isSkipped ? ' skip' : '');
    leds.appendChild(dot);
  }

  info.appendChild(name);
  info.appendChild(meta);
  info.appendChild(leds);

  // Action
  const action = document.createElement('div');
  action.className = 'habit-action';
  const isFuture = selectedDate > todayStr();

  if (habit.type === 'boolean') {
    const btn = document.createElement('button');
    btn.className = 'circle-action-btn' + (doneToday ? ' done' : '');
    btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
    btn.style.setProperty('--habit-color', habit.color || 'var(--accent)');
    if (isFuture) {
        btn.disabled = true; btn.style.opacity = '0.3'; btn.style.cursor = 'not-allowed';
    } else {
        btn.addEventListener('click', e => { e.stopPropagation(); toggleBoolean(habit); });
    }
    action.appendChild(btn);

  } else if (habit.type === 'number') {
    const val = (typeof entry === 'object' && entry !== null) ? (entry.val || 0) : (entry || 0);
    const btn = document.createElement('button');
    btn.className = 'circle-action-btn' + (doneToday ? ' done' : '');
    
    let fSize = '1.1rem';
    let displayVal = val;
    if (val.toString().length > 3) fSize = '0.75rem';
    else if (val.toString().length > 2) fSize = '0.9rem';

    btn.innerHTML = `<span style="font-size: ${fSize}">${displayVal}</span>`;
    btn.style.setProperty('--habit-color', habit.color || 'var(--accent)');
    if (isFuture) {
        btn.disabled = true; btn.style.opacity = '0.3'; btn.style.cursor = 'not-allowed';
    } else {
        btn.addEventListener('click', e => { e.stopPropagation(); openLogModal(habit); });
    }
    action.appendChild(btn);

  } else if (habit.type === 'timer') {
    const elapsed = (typeof entry === 'object' && entry !== null) ? (entry.val || 0) : (entry || 0);
    const btn = document.createElement('button');
    btn.className = 'circle-action-btn' + (doneToday ? ' done' : '');
    btn.innerHTML = `<span style="font-size: 0.8rem">${fmtTime(elapsed)}</span>`;
    btn.style.setProperty('--habit-color', habit.color || 'var(--accent)');
    if (isFuture) {
        btn.disabled = true; btn.style.opacity = '0.3'; btn.style.cursor = 'not-allowed';
    } else {
        btn.addEventListener('click', e => { e.stopPropagation(); openLogModal(habit); });
    }
    action.appendChild(btn);
  }

  card.appendChild(emojiEl);
  card.appendChild(info);
  card.appendChild(leds);
  card.appendChild(action);

  // Long press → Azioni (Action Sheet) — solo se non stiamo trascinando
  let pressTimer;
  const longPressHandler = () => {
    if (dragState) return; // ignora se drag in corso
    if (navigator.vibrate) navigator.vibrate(50);
    openActionSheet(habit);
  };
  card.addEventListener('touchstart', () => { pressTimer = setTimeout(longPressHandler, 600); });
  card.addEventListener('touchend',   () => clearTimeout(pressTimer));
  card.addEventListener('touchmove',  () => clearTimeout(pressTimer));
  card.addEventListener('mousedown',  () => { pressTimer = setTimeout(longPressHandler, 600); });
  card.addEventListener('mouseup',    () => clearTimeout(pressTimer));

  // Drag & drop riordino (solo abitudini attive, non sospese)
  if (!habit.paused) initDragOnCard(card, habit);

  return card;
}

function freqLabel(habit) {
  switch (habit.freq) {
    case 'daily': return 'Ogni giorno';
    case 'weekly': return `${habit.freqN || '?'}× a settimana`;
    case 'days': {
      const names = ['Do','Lu','Ma','Me','Gi','Ve','Sa'];
      return (habit.freqDays || []).map(d => names[d]).join(' · ');
    }
    case 'monthly': return `${habit.freqN || '?'}× al mese`;
    default: return '';
  }
}

// ─── PROGRESS ────────────────────────────────────────────────────
function updateProgress() {
  const todayHabits = habits.filter(h => !h.archived && habitScheduledFor(h, selectedDate));
  const done = todayHabits.filter(h => isHabitDayGoalMet(h, selectedDate)).length;
  const total = todayHabits.length;

  // Segmented bar: fill from left by count
  const track = document.getElementById('progress-track');
  track.innerHTML = '';
  const count = total || 1;
  for (let i = 0; i < count; i++) {
    const seg = document.createElement('div');
    seg.className = 'progress-segment' + (i < done ? ' done' : '');
    track.appendChild(seg);
  }
}

async function toggleBoolean(habit, targetDate = selectedDate) {
  const dayLogs = logs[targetDate] || {};
  const entry = dayLogs[habit.id];
  const currentVal = (typeof entry === 'object' && entry !== null) ? !!entry.val : !!entry;
  const newVal = !currentVal;
  
  // Feedback immediato per UI reattiva se è la data correntemente visualizzata
  if (targetDate === selectedDate) {
    const btn = document.querySelector(`.habit-card[data-id="${habit.id}"] .circle-action-btn`);
    if (btn) btn.classList.toggle('done', newVal);
  }

  // Se siamo nel dettaglio stats, aggiorniamo visivamente la cella del calendario immediatamente
  const calCell = document.querySelector(`.ical-cell[data-date="${targetDate}"]`);
  if (calCell && habit.type === 'boolean') {
    calCell.classList.toggle('ical-done', newVal);
    // Aggiungi/Rimuovi la spunta
    let check = calCell.querySelector('.ical-check');
    if (newVal && !check) {
      check = document.createElement('span');
      check.className = 'ical-check';
      check.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
      calCell.appendChild(check);
    } else if (!newVal && check) {
      check.remove();
    }
  }

  await saveLog(habit.id, newVal, targetDate);
  if (newVal && targetDate === todayStr()) toast(`${habit.emoji} ${habit.name} completata!`);
}

// ─── SAVE LOG ────────────────────────────────────────────────────
async function saveLog(habitId, valueOrUpdate, targetDate = selectedDate) {
  if (!currentUser) return;
  const logRef = doc(db, 'users', currentUser.uid, 'logs', targetDate);
  
  if (!logs[targetDate]) logs[targetDate] = {};
  const currentEntry = logs[targetDate][habitId]; // snapshot pre-modifica per rollback

  let newEntry;
  if (typeof valueOrUpdate === 'object' && valueOrUpdate !== null) {
    const base = (typeof currentEntry === 'object' && currentEntry !== null) 
                 ? currentEntry : { val: currentEntry };
    newEntry = { ...base, ...valueOrUpdate };
  } else {
    if (typeof currentEntry === 'object' && currentEntry !== null) {
      newEntry = { ...currentEntry, val: valueOrUpdate };
    } else {
      newEntry = valueOrUpdate;
    }
  }

  // Aggiornamento locale immediato (OTTIMISTICO)
  logs[targetDate][habitId] = newEntry;
  
  try {
    if (targetDate === selectedDate) {
      renderHabits();
      updateProgress();
    }
    renderStatsDashboard();
    
    const detailVisible = !document.getElementById('stats-detail-view').classList.contains('hidden');
    if (detailVisible && statsHabitId) {
      const icalTitle = document.querySelector('.ical-title');
      let vYear = null, vMonth = null;
      if (icalTitle) {
        const parts = icalTitle.textContent.split(' ');
        if (parts.length === 2) {
          const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                              'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
          vMonth = monthNames.indexOf(parts[0]);
          vYear = parseInt(parts[1]);
        }
      }
      renderStats(statsHabitId, vYear, vMonth);
    }
  } catch (e) {
    console.warn("Errore durante refresh ottimistico:", e);
  }
  
  // FIX: try/catch sulla write Firestore con rollback e feedback visivo
  try {
    await setDoc(logRef, { [habitId]: newEntry }, { merge: true });
  } catch (err) {
    console.error('saveLog — scrittura Firestore fallita:', err);
    // Rollback ottimistico: ripristina il valore precedente
    logs[targetDate][habitId] = currentEntry;
    if (targetDate === selectedDate) {
      renderHabits();
      updateProgress();
    }
    renderStatsDashboard();
    toast('⚠️ Salvataggio fallito. Controlla la connessione.');
  }
}

// ─── LOG MODAL ───────────────────────────────────────────────────
function openLogModal(habit, targetDate = selectedDate) {
  logModalHabit = habit;
  document.getElementById('log-modal-title').textContent = `${habit.emoji} ${habit.name}`;
  const body = document.getElementById('log-modal-body');
  body.innerHTML = '';

  if (habit.type === 'number') {
    const rawEntry = (logs[targetDate] || {})[habit.id];
    const current = (typeof rawEntry === 'object' && rawEntry !== null) ? (rawEntry.val ?? 0) : (rawEntry || 0);
    let val = Math.max(0, Number(current));
    const wrap = document.createElement('div');
    wrap.className = 'log-number-wrap';
    wrap.innerHTML = `
      <div class="log-number-display" style="align-items:center;">
        <input type="number" id="log-num-val" value="${val}" min="0" style="background:var(--bg3); border:2px solid var(--primary); border-radius:12px; outline:none; font-family:var(--font-display); font-size:3rem; color:var(--text); text-align:center; width:100px; padding:4px;" />
        <span class="log-number-unit" style="margin-left:12px;">${habit.unit || ''}</span>
      </div>
      <div class="log-stepper">
        <button class="step-btn" id="step-down">−</button>
        <button class="step-btn" id="step-up">+</button>
      </div>`;
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary'; saveBtn.textContent = 'Salva';
    saveBtn.addEventListener('click', async () => {
      val = Math.max(0, Number(document.getElementById('log-num-val').value) || 0);
      await saveLog(habit.id, val, targetDate);
      closeLogModal();
      toast(`${habit.emoji} Salvato: ${val} ${habit.unit || ''}`);
    });
    wrap.appendChild(saveBtn);
    body.appendChild(wrap);

    const inputObj = document.getElementById('log-num-val');
    // Impedisce la digitazione di valori negativi
    inputObj.addEventListener('input', () => {
      if (Number(inputObj.value) < 0) inputObj.value = 0;
    });
    document.getElementById('step-up').addEventListener('click', () => {
      val = Math.max(0, Number(inputObj.value) || 0);
      val++; inputObj.value = val;
    });
    document.getElementById('step-down').addEventListener('click', () => {
      val = Math.max(0, Number(inputObj.value) || 0);
      if (val > 0) { val--; inputObj.value = val; }
    });

  } else if (habit.type === 'timer') {
    const rawEntry = (logs[targetDate] || {})[habit.id];
    logTimerElapsed = Math.max(0, Number(
      (typeof rawEntry === 'object' && rawEntry !== null) ? (rawEntry.val ?? 0) : (rawEntry || 0)
    ));
    logTimerRunning = false;
    logTimerStart = null;
    if (logTimerInterval) clearInterval(logTimerInterval);
    logTimerInterval = null;

    const wrap = document.createElement('div');
    wrap.className = 'timer-log-wrap';
    const minElapsed = Math.floor(logTimerElapsed / 60);
    wrap.innerHTML = `
      <div class="log-number-display" style="align-items:center;">
        <input type="number" id="log-timer-val" value="${minElapsed}" min="0" style="background:var(--bg3); border:2px solid var(--primary); border-radius:12px; outline:none; font-family:var(--font-display); font-size:3rem; color:var(--text); text-align:center; width:100px; padding:4px;" />
        <span class="log-number-unit" style="margin-left:12px;">min</span>
      </div>
      <div class="timer-log-display" id="log-timer-disp" style="font-size: 1.2rem; opacity: 0.6; margin-top: -10px;">${fmtTime(logTimerElapsed)}</div>
      <div class="timer-controls">
        <button class="timer-ctrl-btn primary" id="log-timer-toggle">▶ Avvia</button>
        <button class="timer-ctrl-btn" id="log-timer-reset">↺ Reset</button>
      </div>`;
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary'; saveBtn.style.marginTop = '16px';
    saveBtn.textContent = 'Salva tempo';
    saveBtn.addEventListener('click', async () => {
      if (logTimerRunning) stopLogTimer();
      await saveLog(habit.id, logTimerElapsed, targetDate);
      closeLogModal();
      toast(`${habit.emoji} ${fmtTime(logTimerElapsed)} salvati!`);
    });
    wrap.appendChild(saveBtn);
    body.appendChild(wrap);

    document.getElementById('log-timer-toggle').addEventListener('click', () => {
      if (logTimerRunning) stopLogTimer(); else startLogTimer();
    });
    document.getElementById('log-timer-reset').addEventListener('click', () => {
      stopLogTimer();
      logTimerElapsed = 0;
      document.getElementById('log-timer-disp').textContent = fmtTime(0);
      document.getElementById('log-timer-val').value = 0;
    });
    document.getElementById('log-timer-val').addEventListener('input', e => {
      const m = Math.max(0, Number(e.target.value) || 0);
      e.target.value = m;
      logTimerElapsed = m * 60;
      document.getElementById('log-timer-disp').textContent = fmtTime(logTimerElapsed);
    });
  }

  document.getElementById('log-modal').classList.remove('hidden');
}

function startLogTimer() {
  logTimerRunning = true;
  logTimerStart = Date.now() - logTimerElapsed * 1000;
  document.getElementById('log-timer-toggle').textContent = '⏸ Pausa';
  logTimerInterval = setInterval(() => {
    logTimerElapsed = Math.floor((Date.now() - logTimerStart) / 1000);
    const disp = document.getElementById('log-timer-disp');
    const valInput = document.getElementById('log-timer-val');
    if (disp) disp.textContent = fmtTime(logTimerElapsed);
    if (valInput && document.activeElement !== valInput) {
      valInput.value = Math.floor(logTimerElapsed / 60);
    }
  }, 500);
}
function stopLogTimer() {
  logTimerRunning = false;
  clearInterval(logTimerInterval);
  const btn = document.getElementById('log-timer-toggle');
  if (btn) btn.textContent = '▶ Riprendi';
}

function closeLogModal() {
  document.getElementById('log-modal').classList.add('hidden');
  if (logTimerInterval) { clearInterval(logTimerInterval); logTimerInterval = null; }
  logTimerRunning = false;
}

document.getElementById('log-modal-close').addEventListener('click', closeLogModal);
document.getElementById('log-modal').querySelector('.modal-backdrop').addEventListener('click', closeLogModal);

// ─── HABIT MODAL ─────────────────────────────────────────────────
function openHabitModal(habit = null) {
  editingHabitId = habit ? habit.id : null;
  document.getElementById('modal-title').textContent = habit ? 'Modifica abitudine' : 'Nuova abitudine';

  // Reset
  document.getElementById('habit-name').value = habit ? habit.name : '';
  document.getElementById('habit-description').value = habit?.description || '';
  selectedEmoji = habit ? habit.emoji : '🌱';
  selectedColor = habit ? habit.color : '#4ade80';
  selectedType  = habit ? habit.type  : 'boolean';
  selectedFreq  = habit ? habit.freq  : 'daily';
  selectedDays  = habit ? (habit.freqDays || []) : [];

  document.getElementById('habit-goal').value     = habit?.goal || '';
  document.getElementById('habit-unit').value     = habit?.unit || '';
  document.getElementById('habit-duration').value = habit?.duration || '';
  document.getElementById('freq-weekly-n').value  = habit?.freqN || '';
  document.getElementById('freq-monthly-n').value = habit?.freqN || '';

  // Emoji
  document.querySelectorAll('.emoji-opt').forEach(el => {
    el.classList.toggle('selected', el.dataset.e === selectedEmoji);
  });
  // Color
  document.querySelectorAll('.color-opt').forEach(el => {
    el.classList.toggle('selected', el.dataset.c === selectedColor);
  });
  // Type
  document.querySelectorAll('.type-btn').forEach(el => {
    el.classList.toggle('active', el.dataset.type === selectedType);
  });
  updateTypeConfig();
  // Freq
  document.querySelectorAll('.freq-btn').forEach(el => {
    el.classList.toggle('active', el.dataset.freq === selectedFreq);
  });
  updateFreqConfig();
  // Days
  document.querySelectorAll('.day-btn').forEach(el => {
    el.classList.toggle('selected', selectedDays.map(String).includes(el.dataset.d));
  });

  // Delete e Archive btn: visibili solo in modifica
  document.getElementById('delete-habit-btn').classList.toggle('hidden', !habit);
  document.getElementById('archive-habit-btn').classList.toggle('hidden', !habit);
  if (habit) {
    document.getElementById('archive-habit-btn').textContent =
      habit.archived ? 'Ripristina abitudine' : 'Archivia abitudine';
  }

  document.getElementById('habit-modal').classList.remove('hidden');
}

function closeHabitModal() {
  document.getElementById('habit-modal').classList.add('hidden');
}

document.getElementById('btn-add-habit').addEventListener('click', () => openHabitModal());
document.getElementById('modal-close').addEventListener('click', closeHabitModal);
document.getElementById('habit-modal').querySelector('.modal-backdrop').addEventListener('click', closeHabitModal);

// Emoji pick
document.getElementById('emoji-picker').addEventListener('click', e => {
  const opt = e.target.closest('.emoji-opt');
  if (!opt) return;
  document.querySelectorAll('.emoji-opt').forEach(el => el.classList.remove('selected'));
  opt.classList.add('selected');
  selectedEmoji = opt.dataset.e;
});

// Color pick
document.getElementById('color-picker').addEventListener('click', e => {
  const opt = e.target.closest('.color-opt');
  if (!opt) return;
  document.querySelectorAll('.color-opt').forEach(el => el.classList.remove('selected'));
  opt.classList.add('selected');
  selectedColor = opt.dataset.c;
});

// Type pick
document.getElementById('type-selector').addEventListener('click', e => {
  const btn = e.target.closest('.type-btn');
  if (!btn) return;
  document.querySelectorAll('.type-btn').forEach(el => el.classList.remove('active'));
  btn.classList.add('active');
  selectedType = btn.dataset.type;
  updateTypeConfig();
});
function updateTypeConfig() {
  document.getElementById('number-config').classList.toggle('hidden', selectedType !== 'number');
  document.getElementById('timer-config').classList.toggle('hidden', selectedType !== 'timer');
}

// Freq pick
document.getElementById('freq-selector').addEventListener('click', e => {
  const btn = e.target.closest('.freq-btn');
  if (!btn) return;
  document.querySelectorAll('.freq-btn').forEach(el => el.classList.remove('active'));
  btn.classList.add('active');
  selectedFreq = btn.dataset.freq;
  updateFreqConfig();
});
function updateFreqConfig() {
  document.getElementById('freq-weekly-config').classList.toggle('hidden', selectedFreq !== 'weekly');
  document.getElementById('freq-days-config').classList.toggle('hidden', selectedFreq !== 'days');
  document.getElementById('freq-monthly-config').classList.toggle('hidden', selectedFreq !== 'monthly');
}

// Controllo visivo immediato (limite rigido)
document.getElementById('freq-weekly-n').addEventListener('input', e => {
  if (Number(e.target.value) > 7) e.target.value = 7;
});
document.getElementById('freq-monthly-n').addEventListener('input', e => {
  if (Number(e.target.value) > 31) e.target.value = 31;
});

// Days pick
document.getElementById('days-picker').addEventListener('click', e => {
  const btn = e.target.closest('.day-btn');
  if (!btn) return;
  const d = btn.dataset.d;
  if (selectedDays.includes(d)) {
    selectedDays = selectedDays.filter(x => x !== d);
    btn.classList.remove('selected');
  } else {
    selectedDays.push(d);
    btn.classList.add('selected');
  }
});

// Save habit
document.getElementById('save-habit-btn').addEventListener('click', async () => {
  const name = document.getElementById('habit-name').value.trim();
  if (!name) { toast('Inserisci un nome!'); return; }

  let fN = Number(document.getElementById(selectedFreq === 'weekly' ? 'freq-weekly-n' : 'freq-monthly-n').value) || null;
  if (selectedFreq === 'weekly' && fN > 7) fN = 7;
  if (selectedFreq === 'monthly' && fN > 31) fN = 31;

  const habitData = {
    name,
    description: document.getElementById('habit-description').value.trim() || null,
    emoji: selectedEmoji,
    color: selectedColor,
    type: selectedType,
    freq: selectedFreq,
    freqDays: selectedDays.map(Number),
    freqN: fN,
    goal: Number(document.getElementById('habit-goal').value) || null,
    unit: document.getElementById('habit-unit').value.trim() || null,
    duration: Number(document.getElementById('habit-duration').value) || null,
  };

  // FIX: try/catch su tutte le operazioni Firestore delle habits
  try {
    if (editingHabitId) {
      const ref = doc(db, 'users', currentUser.uid, 'habits', editingHabitId);
      await setDoc(ref, habitData, { merge: true });
      toast('Abitudine aggiornata!');
    } else {
      habitData.createdAt = serverTimestamp();
      const ref = doc(collection(db, 'users', currentUser.uid, 'habits'));
      await setDoc(ref, habitData);
      toast(`${selectedEmoji} Abitudine aggiunta!`);
    }
    closeHabitModal();
  } catch (err) {
    console.error('Errore salvataggio abitudine:', err);
    toast('⚠️ Salvataggio fallito. Controlla la connessione.');
  }
});

// Archive habit
document.getElementById('archive-habit-btn').addEventListener('click', async () => {
  if (!editingHabitId) return;
  const habit = habits.find(h => h.id === editingHabitId);
  if (!habit) return;
  const isArchived = habit.archived || false;
  try {
    await updateDoc(doc(db, 'users', currentUser.uid, 'habits', editingHabitId), {
      archived: !isArchived
    });
    closeHabitModal();
    toast(isArchived ? 'Abitudine ripristinata' : 'Abitudine archiviata');
  } catch (err) {
    console.error('Errore archiviazione:', err);
    toast('⚠️ Operazione fallita. Controlla la connessione.');
  }
});

// Delete habit
document.getElementById('delete-habit-btn').addEventListener('click', async () => {
  if (!editingHabitId) return;
  if (!confirm('Eliminare questa abitudine? I dati storici verranno persi.')) return;
  // FIX: try/catch su delete
  try {
    await deleteDoc(doc(db, 'users', currentUser.uid, 'habits', editingHabitId));
    closeHabitModal();
    toast('Abitudine eliminata.');
  } catch (err) {
    console.error('Errore eliminazione abitudine:', err);
    toast('⚠️ Eliminazione fallita. Controlla la connessione.');
  }
});

// ─── STREAK COMPUTATION ───────────────────────────────────────────
function computeStreak(habit) {
  let streak = 0;
  const today = new Date();
  
  if (habit.freq === 'weekly' && habit.freqN) {
    const startOfCurrentWeek = new Date(today);
    const day = startOfCurrentWeek.getDay();
    const diff = startOfCurrentWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfCurrentWeek.setDate(diff); // Monday
    
    if (checkWeeklyGoalMet(habit, dateStr(startOfCurrentWeek))) streak++;
    
    let wStart = new Date(startOfCurrentWeek);
    for (let i = 1; i < 52; i++) {
        wStart.setDate(wStart.getDate() - 7);
        if (checkWeeklyGoalMet(habit, dateStr(wStart))) streak++;
        else break;
    }
  } 
  else if (habit.freq === 'monthly' && habit.freqN) {
    let y = today.getFullYear();
    let m = today.getMonth();
    
    const curMonthDs = `${y}-${String(m+1).padStart(2,'0')}-01`;
    if (checkMonthlyGoalMet(habit, curMonthDs)) streak++;
    
    for (let i = 1; i < 12; i++) {
        m--;
        if (m < 0) { m = 11; y--; }
        const checkDs = `${y}-${String(m+1).padStart(2,'0')}-01`;
        if (checkMonthlyGoalMet(habit, checkDs)) streak++;
        else break;
    }
  } 
  else {
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const ds = dateStr(d);
      if (!habitScheduledFor(habit, ds)) continue;
      if (isHabitDayGoalMet(habit, ds)) streak++;
      else if (isHabitSkippedOnDay(habit, ds)) continue; // Salta il giorno senza rompere lo streak
      else if (i > 0) break; // Consenti a oggi di essere incompleto
      else continue;
    }
  }
  return streak;
}

function computeBestStreak(habit) {
  // Collect all dates from logs that are scheduled and logged
  const today = new Date();
  let bestStreak = 0;
  
  if (habit.freq === 'weekly' && habit.freqN) {
    // Check weekly streaks over 2 years
    let maxW = 0, curW = 0;
    for (let w = 104; w >= 0; w--) {
      const refDay = new Date(today);
      refDay.setDate(today.getDate() - w * 7);
      const day = refDay.getDay();
      const diff = refDay.getDate() - day + (day === 0 ? -6 : 1);
      refDay.setDate(diff);
      const ds = dateStr(refDay);
      if (checkWeeklyGoalMet(habit, ds)) { curW++; if (curW > maxW) maxW = curW; }
      else curW = 0;
    }
    return maxW;
  } else if (habit.freq === 'monthly' && habit.freqN) {
    let maxM = 0, curM = 0;
    let y = today.getFullYear(), m = today.getMonth();
    for (let i = 24; i >= 0; i--) {
      let ty = y, tm = m - (24 - i);
      while (tm < 0) { tm += 12; ty--; }
      const ds = `${ty}-${String(tm+1).padStart(2,'0')}-01`;
      if (checkMonthlyGoalMet(habit, ds)) { curM++; if (curM > maxM) maxM = curM; }
      else curM = 0;
    }
    return maxM;
  } else {
    let maxS = 0, curS = 0;
    for (let i = 730; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const ds = dateStr(d);
      if (!habitScheduledFor(habit, ds)) continue;
      if (isHabitDayGoalMet(habit, ds)) { curS++; if (curS > maxS) maxS = curS; }
      else if (isHabitSkippedOnDay(habit, ds)) continue; // Ignora nello streak ma non azzera
      else curS = 0;
    }
    return maxS;
  }
}

// ─── BOTTOM NAV ───────────────────────────────────────────────────
function switchTab(tabKey) {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === tabKey);
  });
  
  const todayView = document.getElementById('today-view');
  const statsView = document.getElementById('stats-view');

  if (tabKey === 'stats') {
    todayView.classList.remove('active');
    statsView.classList.add('active');
    openStats();
  } else if (tabKey === 'today') {
    statsView.classList.remove('active');
    todayView.classList.add('active');
  }
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.view);
  });
});

// ─── SWIPE NAVIGATION ─────────────────────────────────────────────
let touchStartX = 0;
let touchStartY = 0;

document.addEventListener('touchstart', e => {
  touchStartX = e.changedTouches[0].screenX;
  touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

document.addEventListener('touchend', e => {
  const touchEndX = e.changedTouches[0].screenX;
  const touchEndY = e.changedTouches[0].screenY;
  
  const diffX = touchEndX - touchStartX;
  const diffY = touchEndY - touchStartY;
  
  if (Math.abs(diffY) > Math.abs(diffX)) return;
  
  const target = e.target;
  const ignoreSelectors = ['.date-strip', '.date-strip-wrapper', '.reps-chart-wrap', '.dash-heatmap', '.ical-grid', '.stats-habit-selector', '.stat-grid'];
  if (ignoreSelectors.some(s => target.closest(s))) return;

  const threshold = 70;
  if (diffX < -threshold) { 
    // Swipe Sinistra -> Statistiche (se oggi è attivo)
    if (document.getElementById('today-view').classList.contains('active')) {
      switchTab('stats');
    }
  } else if (diffX > threshold) {
    // Swipe Destra -> Oggi (se statistiche è attivo)
    if (document.getElementById('stats-view').classList.contains('active')) {
      switchTab('today');
    }
  }
}, { passive: true });

// ─── STATS ───────────────────────────────────────────────────────
function openStats() {
  document.getElementById('stats-dashboard').classList.remove('hidden');
  document.getElementById('stats-detail-view').classList.add('hidden');
  document.getElementById('stats-main-title').textContent = 'Statistiche';
  document.getElementById('stats-back').classList.add('hidden');
  document.getElementById('btn-toggle-archived').classList.remove('hidden');
  statsHabitId = null;
  statsViewYear = new Date().getFullYear();
  currentChartPeriod = 'week';
  showArchived = false;
  renderStatsDashboard();
}

function renderStatsDashboard() {
  const dash = document.getElementById('stats-dashboard');
  dash.innerHTML = '';

  const active   = habits.filter(h => !h.archived);
  const archived = habits.filter(h => h.archived);

  // Aggiorna stato visivo del pulsante toggle
  const toggleBtn = document.getElementById('btn-toggle-archived');
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', showArchived);
    toggleBtn.title = showArchived ? 'Mostra attive' : 'Archiviate';
    const badge = toggleBtn.querySelector('.archive-badge');
    if (badge) {
      badge.textContent = archived.length > 0 ? archived.length : '';
      badge.style.display = archived.length > 0 ? '' : 'none';
    }
  }

  // Lista da mostrare in base al toggle
  const list = showArchived ? archived : active;

  // Stato vuoto
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.height = '60%';
    empty.innerHTML = showArchived
      ? `<div class="empty-icon">📦</div><p>Nessuna abitudine archiviata.</p>`
      : `<div class="empty-icon">◇</div><p>Nessuna abitudine ancora.<br/>Premi <strong>+</strong> per iniziare!</p>`;
    dash.appendChild(empty);
    return;
  }

  const buildGrid = (list) => {
    const grid = document.createElement('div');
    grid.className = 'dashboard-grid';
    list.forEach(habit => {
      const card = document.createElement('div');
      card.className = 'dashboard-card' + (habit.paused ? ' paused' : '') + (habit.archived ? ' archived' : '');
      card.style.setProperty('--habit-color', habit.color || 'var(--accent)');

      const hdr = document.createElement('div');
      hdr.className = 'dash-card-header';
      hdr.innerHTML = `<span class="dash-emoji">${habit.emoji}</span><span class="dash-name">${habit.name}</span>`;

      const hm = document.createElement('div');
      hm.className = 'dash-heatmap';
      const today = new Date();
      const currYear = today.getFullYear();
      const currMonth = today.getMonth();
      const daysInMonth = new Date(currYear, currMonth + 1, 0).getDate();
      const firstDay = new Date(currYear, currMonth, 1);
      const offset = (firstDay.getDay() + 6) % 7;
      for (let p = 0; p < offset; p++) {
        const sp = document.createElement('div'); sp.className = 'dash-rect empty'; hm.appendChild(sp);
      }
      for (let i = 1; i <= daysInMonth; i++) {
        const d = new Date(currYear, currMonth, i);
        const ds = dateStr(d);
        const rect = document.createElement('div');
        rect.className = 'dash-rect';
        if (isHabitDayGoalMet(habit, ds)) rect.classList.add('on');
        else if (ds > todayStr()) rect.classList.add('future');
        hm.appendChild(rect);
      }

      card.appendChild(hdr);
      card.appendChild(hm);
      card.addEventListener('click', () => { openHabitDetail(habit.id); });

      let menuTimer;
      const openMenu = () => {
        if (navigator.vibrate) navigator.vibrate(40);
        openStatsHabitMenu(habit);
      };
      card.addEventListener('touchstart', () => { menuTimer = setTimeout(openMenu, 500); }, { passive: true });
      card.addEventListener('touchend',   () => clearTimeout(menuTimer), { passive: true });
      card.addEventListener('touchmove',  () => clearTimeout(menuTimer), { passive: true });
      card.addEventListener('mousedown',  () => { menuTimer = setTimeout(openMenu, 500); });
      card.addEventListener('mouseup',    () => clearTimeout(menuTimer));
      card.addEventListener('mouseleave', () => clearTimeout(menuTimer));

      grid.appendChild(card);
    });
    return grid;
  };

  dash.appendChild(buildGrid(list));
}

// ─── STATS HABIT CONTEXT MENU ────────────────────────────────────
let statsMenuHabit = null;

function openStatsHabitMenu(habit) {
  statsMenuHabit = habit;
  document.getElementById('stats-menu-emoji').textContent = habit.emoji;
  document.getElementById('stats-menu-title').textContent = habit.name;
  document.getElementById('stats-menu-archive-text').textContent =
    habit.archived ? 'Ripristina abitudine' : 'Archivia abitudine';
  document.getElementById('stats-habit-menu').classList.remove('hidden');
}

function closeStatsHabitMenu() {
  document.getElementById('stats-habit-menu').classList.add('hidden');
  statsMenuHabit = null;
}

document.getElementById('stats-menu-close').addEventListener('click', closeStatsHabitMenu);
document.getElementById('stats-habit-menu').querySelector('.modal-backdrop').addEventListener('click', closeStatsHabitMenu);

document.getElementById('stats-menu-edit').addEventListener('click', () => {
  const h = statsMenuHabit; closeStatsHabitMenu();
  if (h) openHabitModal(h);
});

document.getElementById('stats-menu-archive').addEventListener('click', async () => {
  const h = statsMenuHabit; closeStatsHabitMenu();
  if (!h) return;
  const isArchived = h.archived || false;
  try {
    await updateDoc(doc(db, 'users', currentUser.uid, 'habits', h.id), { archived: !isArchived });
    toast(isArchived ? 'Abitudine ripristinata' : 'Abitudine archiviata');
  } catch (err) {
    console.error('Errore archiviazione:', err);
    toast('⚠️ Operazione fallita. Controlla la connessione.');
  }
});

document.getElementById('stats-menu-delete').addEventListener('click', async () => {
  const h = statsMenuHabit; closeStatsHabitMenu();
  if (!h) return;
  if (!confirm(`Eliminare definitivamente "${h.name}"? I dati storici verranno persi.`)) return;
  try {
    await deleteDoc(doc(db, 'users', currentUser.uid, 'habits', h.id));
    toast('Abitudine eliminata');
  } catch (err) {
    console.error('Errore eliminazione:', err);
    toast('⚠️ Eliminazione fallita. Controlla la connessione.');
  }
});

// Toggle archiviate/attive nella dashboard statistiche
document.getElementById('btn-toggle-archived').addEventListener('click', () => {
  showArchived = !showArchived;
  renderStatsDashboard();
});

function openHabitDetail(habitId) {
  document.getElementById('stats-dashboard').classList.add('hidden');
  document.getElementById('stats-detail-view').classList.remove('hidden');
  document.getElementById('stats-main-title').textContent = 'Dettagli';
  document.getElementById('stats-back').classList.remove('hidden');
  document.getElementById('btn-toggle-archived').classList.add('hidden');
  
  statsHabitId = habitId;
  buildHabitChips();
  renderStats(habitId);

  // Scroll in cima ogni volta che si apre il dettaglio
  requestAnimationFrame(() => {
    const content = document.getElementById('stats-content');
    if (content) content.scrollTop = 0;
  });
}

document.getElementById('stats-back').addEventListener('click', () => {
  document.getElementById('stats-detail-view').classList.add('hidden');
  document.getElementById('stats-dashboard').classList.remove('hidden');
  document.getElementById('stats-main-title').textContent = 'Statistiche';
  document.getElementById('stats-back').classList.add('hidden');
  document.getElementById('btn-toggle-archived').classList.remove('hidden');
  statsHabitId = null;
  statsViewYear = new Date().getFullYear();
  currentChartPeriod = 'week';
});

function buildHabitChips() {
  const sel = document.getElementById('stats-habit-selector');
  sel.innerHTML = '';
  habits.forEach(h => {
    const chip = document.createElement('div');
    chip.className = 'stats-habit-chip' + (h.id === statsHabitId ? ' active' : '');
    chip.textContent = `${h.emoji} ${h.name}`;
    chip.addEventListener('click', () => {
      document.querySelectorAll('.stats-habit-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      statsHabitId = h.id;
      // Reset al periodo corrente ad ogni cambio abitudine
      statsViewYear = new Date().getFullYear();
      currentChartPeriod = 'week';
      renderStats(h.id);
      // Scroll in cima
      requestAnimationFrame(() => {
        const content = document.getElementById('stats-content');
        if (content) content.scrollTop = 0;
      });
    });
    sel.appendChild(chip);
  });
}

function renderStats(habitId, viewYear, viewMonth) {
  const habit = habits.find(h => h.id === habitId);
  if (!habit) return;
  const content = document.getElementById('stats-content');
  content.innerHTML = '';
  content.style.setProperty('--habit-color', habit.color || 'var(--accent)');

  const today = new Date();
  let totalDays = 0, doneDays = 0, totalValue = 0, valueCount = 0;

  // Per abitudini boolean: parte dal primo giorno completato.
  // Per number/timer: parte dal primo giorno in cui è stato inserito
  // qualsiasi valore > 0, anche se inferiore all'obiettivo.
  let start = new Date(today);

  if (habit.type === 'boolean') {
    const completedDates = Object.keys(logs)
      .filter(ds => isHabitDayGoalMet(habit, ds))
      .sort();
    if (completedDates.length > 0) {
      start = new Date(completedDates[0] + 'T12:00:00');
    }
  } else {
    // number / timer: cerca il primo giorno con qualsiasi valore inserito
    const loggedDates = Object.keys(logs)
      .filter(ds => {
        const entry = (logs[ds] || {})[habit.id];
        if (entry === undefined || entry === null || entry === false) return false;
        const val = (typeof entry === 'object' && entry !== null) ? entry.val : entry;
        return Number(val || 0) > 0;
      })
      .sort();
    if (loggedDates.length > 0) {
      start = new Date(loggedDates[0] + 'T12:00:00');
    }
  }
  start.setHours(0, 0, 0, 0);

  const todayDs = dateStr(today);
  const startDs = dateStr(start);
  const diffDays = Math.ceil(Math.abs(today - start) / (1000 * 60 * 60 * 24));

  // DEBUG temporaneo — rimuovere dopo la diagnosi
  console.log(`[Stats] ${habit.name} | freq=${habit.freq} freqN=${habit.freqN} type=${habit.type}`);
  console.log(`[Stats] start=${startDs} today=${todayDs} diffDays=${diffDays}`);
  console.log(`[Stats] Logs keys:`, Object.keys(logs));
  if (habit.freq === 'weekly' && habit.freqN) {
    const allKeys = Object.keys(logs);
    allKeys.forEach(ds => {
      const entry = (logs[ds] || {})[habit.id];
      const met = isHabitDayGoalMet(habit, ds);
      if (entry !== undefined) console.log(`  ${ds}: entry=`, entry, '→ goalMet=', met);
    });
  }

    // ── Frequenza settimanale ────────────────────────────────────
    // totalDays  = N × numero di settimane trascorse (dalla prima alla corrente)
    // doneDays   = completamenti effettivi in ogni settimana (max N per sett.)
    const weekMs = 7 * 24 * 3600 * 1000;
    // Lunedì della settimana di start
    const startDay = start.getDay();
    const startMon = new Date(start);
    startMon.setDate(start.getDate() - ((startDay + 6) % 7));
    startMon.setHours(0, 0, 0, 0);
    // Lunedì della settimana corrente
    const todayDay = today.getDay();
    const todayMon = new Date(today);
    todayMon.setDate(today.getDate() - ((todayDay + 6) % 7));
    todayMon.setHours(0, 0, 0, 0);

    let wStart = new Date(startMon);
    while (true) {
      const wStartDs = dateStr(wStart);
      const todayMonDs = dateStr(todayMon);
      if (wStartDs > todayMonDs) break; // oltre la settimana corrente

      let weekDone = 0;
      let daysPassedInWeek = 0;
      for (let d = 0; d < 7; d++) {
        const day = new Date(wStart.getFullYear(), wStart.getMonth(), wStart.getDate() + d);
        const ds = dateStr(day);
        if (ds > todayDs) break;
        daysPassedInWeek++;
        if (isHabitDayGoalMet(habit, ds)) weekDone++;
      }

      // Settimana corrente: target pro-rata
      // Settimane passate: target = freqN
      const isCurrentWeek = wStartDs === todayMonDs;
      const weekTarget = isCurrentWeek
        ? Math.min(habit.freqN, daysPassedInWeek)
        : habit.freqN;
      totalDays += weekTarget;
      doneDays  += Math.min(weekDone, habit.freqN);

      // Avanza di 7 giorni usando setDate (rispetta DST locale)
      wStart = new Date(wStart.getFullYear(), wStart.getMonth(), wStart.getDate() + 7);
    }

  } else if (habit.freq === 'monthly' && habit.freqN) {
    // ── Frequenza mensile ────────────────────────────────────────
    // totalDays = N × numero di mesi trascorsi (pro-rata per il mese corrente)
    // doneDays  = completamenti effettivi per mese (max N per mese)
    let y = start.getFullYear(), m = start.getMonth();
    const curY = today.getFullYear(), curM = today.getMonth();

    while (y < curY || (y === curY && m <= curM)) {
      const daysInM = new Date(y, m + 1, 0).getDate();
      let monthDone = 0;
      for (let d = 1; d <= daysInM; d++) {
        const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        if (ds < startDs) continue;
        if (ds > todayDs) break;
        if (isHabitDayGoalMet(habit, ds)) monthDone++;
      }
      // Per il mese corrente il target è pro-rata: min(N, giorni passati del mese)
      const isCurrentMonth = (y === curY && m === curM);
      const target = isCurrentMonth
        ? Math.min(habit.freqN, today.getDate())
        : habit.freqN;
      totalDays += target;
      doneDays  += Math.min(monthDone, habit.freqN);
      m++;
      if (m > 11) { m = 0; y++; }
    }

  } else {
    // ── Frequenza daily / giorni fissi ──────────────────────────
    // Scheduling STATICO: non usa habitScheduledFor() che è dinamico
    // (dipende dai log correnti e darebbe risultati sbagliati per lo storico).
    for (let i = diffDays; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const ds = dateStr(d);
      if (ds < startDs || ds > todayDs) continue;

      // Controlla se il giorno era schedulato (solo in base a freq/freqDays)
      let scheduled = false;
      if (habit.freq === 'daily') {
        scheduled = true;
      } else if (habit.freq === 'days') {
        const dow = d.getDay();
        scheduled = (habit.freqDays || []).map(Number).includes(dow);
      } else {
        scheduled = true;
      }
      if (!scheduled) continue;

      totalDays++;
      const entry = (logs[ds] || {})[habit.id];
      const done = isHabitDayGoalMet(habit, ds);
      if (done) doneDays++;
      if (entry !== undefined && entry !== null && entry !== false) {
        if (habit.type === 'number' || habit.type === 'timer') {
          const numVal = (typeof entry === 'object' && entry !== null) ? entry.val : entry;
          const n = Number(numVal || 0);
          if (n > 0) { totalValue += n; valueCount++; }
        }
      }
    }
  }

  // Per number/timer con frequenza weekly/monthly calcola anche totalValue/valueCount
  if (habit.freq === 'weekly' || habit.freq === 'monthly') {
    if (habit.type === 'number' || habit.type === 'timer') {
      for (let i = diffDays; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const ds = dateStr(d);
        if (ds < startDs) continue;
        const entry = (logs[ds] || {})[habit.id];
        if (entry === undefined || entry === null || entry === false) continue;
        const numVal = (typeof entry === 'object' && entry !== null) ? entry.val : entry;
        const n = Number(numVal || 0);
        if (n > 0) { totalValue += n; valueCount++; }
      }
    }
  }

  const streak = computeStreak(habit);
  const bestStreak = computeBestStreak(habit);
  const pct = totalDays ? Math.round((doneDays / totalDays) * 100) : 0;

  const grid = document.createElement('div');
  grid.className = 'stat-grid';

  const makeCard = (val, lbl, accent = false) => {
    const c = document.createElement('div');
    c.className = 'stat-card' + (accent ? ' accent' : '');
    c.innerHTML = `<div class="stat-val">${val}</div><div class="stat-lbl">${lbl}</div>`;
    return c;
  };

  grid.appendChild(makeCard(`🔥 ${streak}`, 'Streak attuale', true));
  grid.appendChild(makeCard(`⚡ ${bestStreak}`, 'Miglior streak', true));
  grid.appendChild(makeCard(`${pct}%`, 'Completamento totale'));
  grid.appendChild(makeCard(doneDays, 'Completamenti'));
  if (habit.type === 'number' && valueCount > 0) {
    const avg = (totalValue / valueCount).toFixed(1);
    grid.appendChild(makeCard(`${avg} ${habit.unit || ''}`, 'Media sessione'));
    grid.appendChild(makeCard(`${totalValue} ${habit.unit || ''}`, 'Totale'));
  } else if (habit.type === 'timer' && valueCount > 0) {
    grid.appendChild(makeCard(fmtTime(Math.round(totalValue / valueCount)), 'Durata media'));
    grid.appendChild(makeCard(fmtTime(totalValue), 'Tempo totale'));
  }

  content.appendChild(grid);

  const calWrap = document.createElement('div');
  calWrap.className = 'stats-cal-section';
  renderInteractiveCalendar(calWrap, habit, viewYear, viewMonth);
  content.appendChild(calWrap);

  const chartSection = document.createElement('div');
  chartSection.className = 'stats-chart-section';
  renderRepsChart(chartSection, habit, currentChartPeriod);
  content.appendChild(chartSection);
}

function renderInteractiveCalendar(container, habit, year, month) {
  container.innerHTML = '';
  const today = new Date();
  const cy = year  ?? today.getFullYear();
  const cm = month ?? today.getMonth();
  const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                      'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

  const header = document.createElement('div');
  header.className = 'ical-header';
  const prevBtn = document.createElement('button');
  prevBtn.className = 'ical-nav-btn';
  prevBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>`;
  prevBtn.addEventListener('click', () => {
    let nm = cm - 1, ny = cy;
    if (nm < 0) { nm = 11; ny--; }
    renderInteractiveCalendar(container, habit, ny, nm);
  });
  const nextBtn = document.createElement('button');
  nextBtn.className = 'ical-nav-btn';
  nextBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;
  const isCurrentMonth = (cy === today.getFullYear() && cm === today.getMonth());
  if (isCurrentMonth) nextBtn.disabled = true;
  nextBtn.addEventListener('click', () => {
    let nm = cm + 1, ny = cy;
    if (nm > 11) { nm = 0; ny++; }
    renderInteractiveCalendar(container, habit, ny, nm);
  });
  const title = document.createElement('span');
  title.className = 'ical-title';
  title.textContent = `${monthNames[cm]} ${cy}`;
  header.appendChild(prevBtn);
  header.appendChild(title);
  header.appendChild(nextBtn);
  container.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'ical-grid';
  ['L','M','M','G','V','S','D'].forEach(d => {
    const lbl = document.createElement('div');
    lbl.className = 'ical-day-label';
    lbl.textContent = d;
    grid.appendChild(lbl);
  });
  const firstDay = new Date(cy, cm, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  for (let p = 0; p < offset; p++) {
    const sp = document.createElement('div');
    sp.className = 'ical-cell empty';
    grid.appendChild(sp);
  }
  const daysInMonth = new Date(cy, cm + 1, 0).getDate();
  const todayDs = todayStr();
  for (let i = 1; i <= daysInMonth; i++) {
    const ds = `${cy}-${String(cm+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
    const cell = document.createElement('div');
    cell.dataset.date = ds;
    const scheduled = habitScheduledFor(habit, ds);
    const done = scheduled && isHabitDayGoalMet(habit, ds);
    const future = ds > todayDs;
    const skipped = isHabitSkippedOnDay(habit, ds);

    // Valore parziale: qualcosa è stato inserito ma l'obiettivo non è stato raggiunto
    const entry = (logs[ds] || {})[habit.id];
    const rawVal = (typeof entry === 'object' && entry !== null) ? entry.val : entry;
    const hasValue = !done && !skipped && !future
      && (habit.type === 'number' || habit.type === 'timer')
      && Number(rawVal || 0) > 0;

    cell.className = 'ical-cell'
      + (!scheduled ? ' ical-unscheduled' : '')
      + (done      ? ' ical-done'         : '')
      + (skipped   ? ' ical-skipped'      : '')
      + (ds === todayDs ? ' ical-today'   : '')
      + (future    ? ' ical-future'       : '');
    const numEl = document.createElement('span');
    numEl.className = 'ical-num';
    numEl.textContent = i;
    cell.appendChild(numEl);
    if (done) {
      const check = document.createElement('span');
      check.className = 'ical-check';
      check.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
      cell.appendChild(check);
    }
    // Puntino per valore parziale inserito (non completato)
    if (hasValue) {
      const dot = document.createElement('span');
      dot.className = 'ical-partial-dot';
      cell.appendChild(dot);
    }
    // Indicatore "saltato" sulla cella
    if (skipped) {
      const skipMark = document.createElement('span');
      skipMark.className = 'ical-skip-mark';
      skipMark.textContent = '—';
      cell.appendChild(skipMark);
    }

    // ── Tap: comportamento normale (toggle/log) ────────────────
    if (scheduled && !future && habit.type === 'boolean') {
      cell.classList.add('ical-clickable');
      cell.addEventListener('click', async () => { await toggleBoolean(habit, ds); });
    } else if (scheduled && !future && (habit.type === 'number' || habit.type === 'timer')) {
      cell.classList.add('ical-clickable');
      cell.addEventListener('click', () => { openLogModal(habit, ds); });
    }

    // ── Long press: menu skip / nota (su tutti i giorni non futuri) ─
    if (!future) {
      let calPressTimer;
      const openMenu = () => {
        if (navigator.vibrate) navigator.vibrate(40);
        openCalendarCellMenu(habit, ds, cy, cm);
      };
      cell.addEventListener('touchstart', () => { calPressTimer = setTimeout(openMenu, 600); }, { passive: true });
      cell.addEventListener('touchend',   () => clearTimeout(calPressTimer), { passive: true });
      cell.addEventListener('touchmove',  () => clearTimeout(calPressTimer), { passive: true });
      cell.addEventListener('mousedown',  () => { calPressTimer = setTimeout(openMenu, 600); });
      cell.addEventListener('mouseup',    () => clearTimeout(calPressTimer));
    }

    grid.appendChild(cell);
  }
  container.appendChild(grid);
  renderHabitNotes(container, habit, cy, cm);
}

// ─── CALENDAR CELL CONTEXT MENU ──────────────────────────────────
// Mini action sheet per skip/nota direttamente dal calendario statistiche
function openCalendarCellMenu(habit, ds, calYear, calMonth) {
  const isSkipped = isHabitSkippedOnDay(habit, ds);
  const currentNote = getHabitNoteOnDay(habit, ds);
  const d = new Date(ds + 'T12:00:00');
  const mShort = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  const dateLabel = `${d.getDate()} ${mShort[d.getMonth()]}`;

  // Riusa il modal action-sheet esistente nell'HTML
  document.getElementById('action-sheet-emoji').textContent = habit.emoji;
  document.getElementById('action-sheet-title').textContent = `${habit.name} · ${dateLabel}`;
  document.getElementById('btn-skip-text').textContent = isSkipped ? 'Ripristina record' : 'Salta questo giorno';

  // Salva i riferimenti per i listener
  actionSheetHabit = habit;
  // Sovrascriviamo temporaneamente selectedDate solo per i listener dello sheet
  const prevDate = selectedDate;
  selectedDate = ds;

  // Mostra lo sheet
  document.getElementById('action-sheet').classList.remove('hidden');

  // Al chiusura ripristina la data selezionata e ri-renderizza il calendario
  const restoreAndRefresh = () => {
    selectedDate = prevDate;
    // Ri-renderizza le stats preservando il mese del calendario
    const icalTitle = document.querySelector('.ical-title');
    let vYear = calYear, vMonth = calMonth;
    if (icalTitle) {
      const parts = icalTitle.textContent.split(' ');
      if (parts.length === 2) {
        const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                            'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
        const mi = monthNames.indexOf(parts[0]);
        const yi = parseInt(parts[1]);
        if (mi !== -1 && !isNaN(yi)) { vMonth = mi; vYear = yi; }
      }
    }
    if (actionSheetHabit === null) renderStats(habit.id, vYear, vMonth);
  };

  // Override one-shot dei listener di chiusura per ripristinare la data
  const closeBtn  = document.getElementById('action-sheet-close');
  const backdrop  = document.getElementById('action-sheet').querySelector('.modal-backdrop');
  const onClose = () => {
    restoreAndRefresh();
    closeBtn.removeEventListener('click', onClose);
    backdrop.removeEventListener('click', onClose);
  };
  closeBtn.addEventListener('click', onClose);
  backdrop.addEventListener('click', onClose);
}

function renderHabitNotes(container, habit, year, month) {
  const notesSection = document.createElement('div');
  notesSection.className = 'stats-notes-section';
  notesSection.innerHTML = '<div class="section-title">Note del mese</div>';
  
  const list = document.createElement('div');
  list.className = 'notes-list';
  
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let hasNotes = false;
  const mNamesShort = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

  for (let i = 1; i <= daysInMonth; i++) {
    const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
    const entry = (logs[ds] || {})[habit.id];
    if (typeof entry === 'object' && entry !== null && entry.note) {
      hasNotes = true;
      const item = document.createElement('div');
      item.className = 'note-entry';
      item.innerHTML = `
        <div class="note-date-side">${i} ${mNamesShort[month]}</div>
        <div class="note-text-side">${entry.note}</div>
      `;
      list.appendChild(item);
    }
  }
  
  if (!hasNotes) {
    const empty = document.createElement('div');
    empty.className = 'note-empty';
    empty.textContent = 'Nessuna nota per questo mese.';
    list.appendChild(empty);
  }
  
  notesSection.appendChild(list);
  container.appendChild(notesSection);
}

function renderRepsChart(container, habit, period) {
  currentChartPeriod = period;
  container.innerHTML = '';
  const mNames = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

  // ── Header identico per tutti i periodi (stessa altezza → no layout shift) ─
  const yrRow = document.createElement('div');
  yrRow.className = 'reps-header';

  if (period !== 'year') {
    // Settimana / Mese: anno + frecce navigazione
    const yrNav = document.createElement('div');
    yrNav.className = 'stats-year-nav-sm';
    yrNav.innerHTML = `
      <button class="yr-btn-sm" id="yr-prev-chart">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="yr-label-sm">${statsViewYear}</span>
      <button class="yr-btn-sm" id="yr-next-chart">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </button>`;
    yrNav.querySelector('#yr-prev-chart').addEventListener('click', () => { statsViewYear--; renderRepsChart(container, habit, period); });
    yrNav.querySelector('#yr-next-chart').addEventListener('click', () => { statsViewYear++; renderRepsChart(container, habit, period); });
    yrRow.appendChild(yrNav);
  } else {
    // Anno: stesso blocco ma con titolo fisso, senza frecce (occupa la stessa altezza)
    const titleAnn = document.createElement('div');
    titleAnn.className = 'stats-year-nav-sm';
    titleAnn.style.cssText = 'font-family:var(--font-display);font-size:1.5rem;font-weight:400;color:var(--text);';
    titleAnn.textContent = 'Vista annuale';
    yrRow.appendChild(titleAnn);
  }
  container.appendChild(yrRow);

  // ── Sottotitolo "Ripetizioni" ─────────────────────────────────
  const subTitle = document.createElement('div');
  subTitle.className = 'reps-chart-title';
  subTitle.textContent = 'Ripetizioni';
  container.appendChild(subTitle);

  // ── Calcolo barre ─────────────────────────────────────────────
  let bars = [];
  const todayDs = todayStr();

  if (period === 'week') {
    const jan1 = new Date(statsViewYear, 0, 1);
    const startOfFirstWeek = new Date(jan1);
    startOfFirstWeek.setDate(jan1.getDate() - ((jan1.getDay() + 6) % 7));
    for (let i = 0; i < 53; i++) {
      const wStart = new Date(startOfFirstWeek);
      wStart.setDate(startOfFirstWeek.getDate() + i * 7);
      if (wStart.getFullYear() > statsViewYear && i >= 52) break;
      let wVal = 0, hasToday = false;
      for (let d = 0; d < 7; d++) {
        const dayDate = new Date(wStart); dayDate.setDate(wStart.getDate() + d);
        const ds = dateStr(dayDate);
        if (ds === todayDs) hasToday = true;
        const entry = (logs[ds] || {})[habit.id];
        const val = (typeof entry === 'object' && entry !== null) ? (entry.val || 0) : (entry || 0);
        if (habit.type === 'boolean') { if (isHabitDayGoalMet(habit, ds)) wVal++; }
        else wVal += Number(val || 0);
      }
      const lbl = wStart.getDate() + ' ' + mNames[wStart.getMonth()].toLowerCase();
      bars.push({ val: wVal, label: lbl, isToday: hasToday });
    }
  } else if (period === 'month') {
    for (let m = 0; m < 12; m++) {
      const y = statsViewYear;
      let mVal = 0, hasToday = false;
      const daysInM = new Date(y, m + 1, 0).getDate();
      for (let day = 1; day <= daysInM; day++) {
        const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        if (ds === todayDs) hasToday = true;
        const entry = (logs[ds] || {})[habit.id];
        const val = (typeof entry === 'object' && entry !== null) ? (entry.val || 0) : (entry || 0);
        if (habit.type === 'boolean') { if (isHabitDayGoalMet(habit, ds)) mVal++; }
        else mVal += Number(val || 0);
      }
      bars.push({ val: mVal, label: mNames[m], isToday: hasToday });
    }
  } else {
    // Anno: mostra solo gli anni con dati + anno corrente, padding ±2
    const yearsWithData = new Set();
    Object.keys(logs).forEach(ds => {
      const entry = (logs[ds] || {})[habit.id];
      if (entry !== undefined && entry !== null) {
        const val = (typeof entry === 'object') ? entry.val : entry;
        if (habit.type === 'boolean' ? isHabitDayGoalMet(habit, ds) : Number(val || 0) > 0)
          yearsWithData.add(parseInt(ds.split('-')[0]));
      }
    });
    const curY = new Date().getFullYear();
    yearsWithData.add(curY);
    const minY = Math.min(...yearsWithData) - 2;
    const maxY = Math.max(...yearsWithData) + 2;
    for (let y = minY; y <= maxY; y++) {
      let yVal = 0;
      Object.keys(logs).forEach(ds => {
        if (ds.startsWith(String(y))) {
          const entry = (logs[ds] || {})[habit.id];
          const val = (typeof entry === 'object' && entry !== null) ? (entry.val || 0) : (entry || 0);
          if (habit.type === 'boolean') { if (isHabitDayGoalMet(habit, ds)) yVal++; }
          else yVal += Number(val || 0);
        }
      });
      bars.push({ val: yVal, label: String(y), isToday: y === curY });
    }
  }

  // ── Render barre ──────────────────────────────────────────────
  const chartWrap = document.createElement('div');
  chartWrap.className = `reps-chart-wrap period-${period}`;
  const maxVal = Math.max(...bars.map(b => b.val), 1);
  const CHART_H = 120; // altezza massima barra in px

  bars.forEach(b => {
    const col = document.createElement('div');
    col.className = 'reps-bar-col';

    // Valore sopra (solo se > 0)
    const valLbl = document.createElement('div');
    valLbl.className = 'reps-bar-val';
    if (b.val > 0) {
      let dVal = b.val;
      if (habit.type === 'timer') dVal = Math.floor(b.val / 60);
      valLbl.textContent = dVal;
    }

    // Track + fill
    const track = document.createElement('div');
    track.className = 'reps-bar-track';
    const fill = document.createElement('div');
    fill.className = 'reps-bar-fill' + (b.isToday ? ' today' : '') + (b.val === 0 ? ' unscheduled' : '');
    const fillH = b.val > 0 ? Math.max(Math.round((b.val / maxVal) * CHART_H), 6) : 0;
    fill.style.height = fillH + 'px';
    track.appendChild(fill);

    // Label sotto
    const lbl = document.createElement('div');
    lbl.className = 'reps-bar-lbl' + (b.isToday ? ' today' : '');
    lbl.textContent = b.label;

    col.appendChild(valLbl);
    col.appendChild(track);
    col.appendChild(lbl);
    chartWrap.appendChild(col);
  });
  container.appendChild(chartWrap);

  // Scrolla il grafico per portare la colonna "oggi" al centro del viewport
  requestAnimationFrame(() => {
    const todayCol = chartWrap.querySelector('.reps-bar-col:has(.reps-bar-lbl.today)') ||
                     [...chartWrap.querySelectorAll('.reps-bar-col')].find((_, i) => bars[i]?.isToday);
    if (todayCol) {
      const wrapW   = chartWrap.offsetWidth;
      const colLeft = todayCol.offsetLeft;
      const colW    = todayCol.offsetWidth;
      chartWrap.scrollLeft = colLeft - wrapW / 2 + colW / 2;
    }
  });

  // ── Selector Sett./Mese/Anno in fondo ────────────────────────
  const selRow = document.createElement('div');
  selRow.className = 'chart-period-row-bottom';
  const btnRow = document.createElement('div');
  btnRow.className = 'chart-period-btns';
  [{ key: 'week', label: 'Settimana' }, { key: 'month', label: 'Mese' }, { key: 'year', label: 'Anno' }].forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'chart-period-btn' + (p.key === period ? ' active' : '');
    btn.textContent = p.label;
    btn.addEventListener('click', () => { currentChartPeriod = p.key; renderRepsChart(container, habit, p.key); });
    btnRow.appendChild(btn);
  });
  selRow.appendChild(btnRow);
  container.appendChild(selRow);
}

// ─── ACTION SHEET LOGIC ─────────────────────────────────────────
function openActionSheet(habit) {
  actionSheetHabit = habit;
  const isSkipped = isHabitSkippedOnDay(habit, selectedDate);
  
  document.getElementById('action-sheet-emoji').textContent = habit.emoji;
  document.getElementById('action-sheet-title').textContent = habit.name;
  document.getElementById('btn-skip-text').textContent = isSkipped ? 'Ripristina record' : 'Salta record per oggi';
  
  document.getElementById('action-sheet').classList.remove('hidden');
}

function closeActionSheet() {
  document.getElementById('action-sheet').classList.add('hidden');
  actionSheetHabit = null;
}

document.getElementById('action-sheet-close').addEventListener('click', closeActionSheet);
document.getElementById('action-sheet').querySelector('.modal-backdrop').addEventListener('click', closeActionSheet);

document.getElementById('btn-action-edit').addEventListener('click', () => {
  const h = actionSheetHabit;
  closeActionSheet();
  if (h) openHabitModal(h);
});

document.getElementById('btn-action-note').addEventListener('click', async () => {
  const h = actionSheetHabit;
  if (!h) return;
  const currentNote = getHabitNoteOnDay(h, selectedDate);
  const note = prompt('Aggiungi una nota per oggi:', currentNote);
  if (note !== null) {
     try {
       await saveLog(h.id, { note: note.trim() });
       toast('Nota salvata!');
     } catch (err) {
       console.error('Errore salvataggio nota:', err);
       toast('⚠️ Salvataggio nota fallito.');
     }
  }
  closeActionSheet();
});

document.getElementById('btn-action-skip').addEventListener('click', async () => {
  const h = actionSheetHabit;
  if (!h) return;
  const isSkipped = isHabitSkippedOnDay(h, selectedDate);
  try {
    await saveLog(h.id, { skip: !isSkipped });
    toast(isSkipped ? 'Record ripristinato' : 'Giorno saltato (serie salvata)');
  } catch (err) {
    console.error('Errore skip:', err);
    toast('⚠️ Operazione fallita. Controlla la connessione.');
  }
  closeActionSheet();
});

document.getElementById('btn-action-delete').addEventListener('click', async () => {
  const h = actionSheetHabit;
  if (!h) return;
  if (confirm(`Eliminare definitivamente "${h.name}"?`)) {
     try {
       await deleteDoc(doc(db, 'users', currentUser.uid, 'habits', h.id));
       toast('Abitudine eliminata');
     } catch (err) {
       console.error('Errore eliminazione:', err);
       toast('⚠️ Eliminazione fallita. Controlla la connessione.');
     }
  }
  closeActionSheet();
});

// ─── PWA SERVICE WORKER ──────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {

    // Controlla se c'è già un SW in attesa al momento della registrazione
    if (reg.waiting) {
      reg.waiting.postMessage('SKIP_WAITING');
    }

    // Ascolta nuovi SW che entrano in stato "waiting" dopo l'install
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // C'è un aggiornamento pronto: attiva subito e ricarica
          newWorker.postMessage('SKIP_WAITING');
        }
      });
    });

  }).catch(() => {});

  // Quando il SW attivo cambia (dopo SKIP_WAITING), ricarica la pagina
  // per servire i nuovi file — una sola volta, non in loop
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}
