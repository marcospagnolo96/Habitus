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
  serverTimestamp
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
let unsubHabits = null;
let unsubLogs = null;

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

// Should a habit appear today?
function habitScheduledFor(habit, dateString) {
  const d = new Date(dateString + 'T12:00:00');
  const dow = d.getDay(); // 0=Sun..6=Sat
  switch (habit.freq) {
    case 'daily': return true;
    case 'days':  return (habit.freqDays || []).map(Number).includes(dow);
    case 'weekly':
    case 'monthly': return true; // always visible, goal-based
    default: return true;
  }
}

// Base log check for a specific day
function isHabitLoggedOnDay(habit, dateString) {
  const entry = (logs[dateString] || {})[habit.id];
  if (entry === undefined || entry === null) return false;
  if (habit.type === 'boolean') return entry === true;
  if (habit.type === 'number')  return Number(entry) >= Number(habit.goal || 1);
  if (habit.type === 'timer')   return Number(entry) >= Number(habit.duration || 1) * 60;
  return false;
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
     if (isHabitLoggedOnDay(habit, dateStr(cur))) count++;
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
     if (isHabitLoggedOnDay(habit, dateStr(cur))) count++;
  }
  let target = Math.round((habit.freqN / 31) * daysInMonth);
  if (target < 1) target = 1;
  return count >= target;
}

// Full check (logged today OR goal met)
function isHabitDone(habit, dateString) {
  if (isHabitLoggedOnDay(habit, dateString)) return true;
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
  subscribeHabits();
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
  unsubHabits = onSnapshot(query(habitsRef, orderBy('createdAt')), snap => {
    habits = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    subscribeLogs();
  });
}

function subscribeLogs() {
  if (unsubLogs) { unsubLogs(); unsubLogs = null; }
  const logsRef = collection(db, 'users', currentUser.uid, 'logs');
  unsubLogs = onSnapshot(logsRef, snap => {
    logs = {};
    snap.docs.forEach(d => { logs[d.id] = d.data(); });
    renderHabits();
    updateProgress();
  });
}

// ─── DATE STRIP ──────────────────────────────────────────────────
function buildDateStrip() {
  const strip = document.getElementById('date-strip');
  strip.innerHTML = '';
  const days = ['Do','Lu','Ma','Me','Gi','Ve','Sa'];
  
  const [sy] = selectedDate.split('-');
  const year = parseInt(sy);
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const totalDays = isLeapYear ? 366 : 365;

  for (let i = 1; i <= totalDays; i++) {
    const d = new Date(year, 0, i);
    const ds = dateStr(d);
    const pill = document.createElement('div');
    pill.className = 'date-pill' + (ds === selectedDate ? ' active' : '');
    pill.dataset.date = ds;
    const hasLog = Object.keys(logs[ds] || {}).length > 0;
    if (hasLog) pill.classList.add('has-logs');
    pill.innerHTML = `
      <span class="pill-day">${days[d.getDay()]}</span>
      <span class="pill-num">${d.getDate()}</span>
      <span class="pill-dot"></span>`;
    pill.addEventListener('click', () => {
      selectedDate = ds;
      buildDateStrip();
      renderHabits();
      updateProgress();
    });
    strip.appendChild(pill);
  }
  
  // Scroll to active date smoothly
  setTimeout(() => {
    const active = strip.querySelector('.active');
    if (active) {
      active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, 50);
}

// ─── RENDER HABITS ───────────────────────────────────────────────
function renderHabits() {
  const container = document.getElementById('habits-container');
  const emptyState = document.getElementById('empty-state');
  const todayHabits = habits.filter(h => habitScheduledFor(h, selectedDate));

  // Clear old cards but keep empty state
  container.querySelectorAll('.habit-card').forEach(c => c.remove());

  if (todayHabits.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  todayHabits.forEach(habit => {
    const card = buildHabitCard(habit);
    container.appendChild(card);
  });

  buildDateStrip(); // refresh dots
}

function buildHabitCard(habit) {
  const card = document.createElement('div');
  card.className = 'habit-card';
  card.style.setProperty('--habit-color', habit.color || 'var(--accent)');
  card.dataset.id = habit.id;

  const done = isHabitDone(habit, selectedDate);
  const entry = (logs[selectedDate] || {})[habit.id];
  const streak = computeStreak(habit);

  // Emoji
  const emojiEl = document.createElement('div');
  emojiEl.className = 'habit-emoji';
  emojiEl.textContent = habit.emoji || '🌱';

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

  const leds = document.createElement('div');
  leds.className = 'habit-leds';
  const todayD = new Date(todayStr() + 'T12:00:00');
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayD);
    d.setDate(todayD.getDate() - i);
    const ds = dateStr(d);
    const dot = document.createElement('div');
    dot.className = 'led-dot';
    if (!habitScheduledFor(habit, ds)) {
       dot.classList.add('skip');
    } else if (isHabitLoggedOnDay(habit, ds)) {
       dot.classList.add('on');
    }
    leds.appendChild(dot);
  }

  info.appendChild(name);
  info.appendChild(meta);

  // Action
  const action = document.createElement('div');
  action.className = 'habit-action';
  const isFuture = selectedDate > todayStr();

  if (habit.type === 'boolean') {
    const btn = document.createElement('button');
    btn.className = 'circle-action-btn' + (done ? ' done' : '');
    btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
    btn.style.setProperty('--habit-color', habit.color || 'var(--accent)');
    if (isFuture) {
        btn.disabled = true; btn.style.opacity = '0.3'; btn.style.cursor = 'not-allowed';
    } else {
        btn.addEventListener('click', e => { e.stopPropagation(); toggleBoolean(habit); });
    }
    action.appendChild(btn);

  } else if (habit.type === 'number') {
    const val = Number(entry || 0);
    const btn = document.createElement('button');
    btn.className = 'circle-action-btn' + (done ? ' done' : '');
    
    let fSize = '1.1rem';
    if (val.toString().length > 3) fSize = '0.75rem';
    else if (val.toString().length > 2) fSize = '0.9rem';

    btn.innerHTML = `<span style="font-size: ${fSize}">${val}</span>`;
    btn.style.setProperty('--habit-color', habit.color || 'var(--accent)');
    if (isFuture) {
        btn.disabled = true; btn.style.opacity = '0.3'; btn.style.cursor = 'not-allowed';
    } else {
        btn.addEventListener('click', e => { e.stopPropagation(); openLogModal(habit); });
    }
    action.appendChild(btn);

  } else if (habit.type === 'timer') {
    const elapsed = Number(entry || 0);
    const btn = document.createElement('button');
    btn.className = 'circle-action-btn' + (done ? ' done' : '');
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

  // Long press → edit
  let pressTimer;
  card.addEventListener('touchstart', () => { pressTimer = setTimeout(() => openHabitModal(habit), 600); });
  card.addEventListener('touchend', () => clearTimeout(pressTimer));
  card.addEventListener('touchmove', () => clearTimeout(pressTimer));
  card.addEventListener('mousedown', () => { pressTimer = setTimeout(() => openHabitModal(habit), 600); });
  card.addEventListener('mouseup', () => clearTimeout(pressTimer));

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
  const todayHabits = habits.filter(h => habitScheduledFor(h, selectedDate));
  const done = todayHabits.filter(h => isHabitDone(h, selectedDate)).length;
  const total = todayHabits.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  document.getElementById('progress-label').textContent = `${done} / ${total} completate oggi`;
  document.getElementById('progress-pct').textContent = `${pct}%`;
  document.getElementById('progress-fill').style.width = pct + '%';
}

// ─── TOGGLE BOOLEAN ─────────────────────────────────────────────
async function toggleBoolean(habit) {
  const current = (logs[selectedDate] || {})[habit.id];
  const newVal = !current;
  await saveLog(habit.id, newVal);
  if (newVal) toast(`${habit.emoji} ${habit.name} completata!`);
}

// ─── SAVE LOG ────────────────────────────────────────────────────
async function saveLog(habitId, value) {
  const logRef = doc(db, 'users', currentUser.uid, 'logs', selectedDate);
  const existing = logs[selectedDate] || {};
  await setDoc(logRef, { ...existing, [habitId]: value }, { merge: true });
}

// ─── LOG MODAL ───────────────────────────────────────────────────
function openLogModal(habit) {
  logModalHabit = habit;
  document.getElementById('log-modal-title').textContent = `${habit.emoji} ${habit.name}`;
  const body = document.getElementById('log-modal-body');
  body.innerHTML = '';

  if (habit.type === 'number') {
    const current = Number((logs[selectedDate] || {})[habit.id] || 0);
    let val = current;
    const wrap = document.createElement('div');
    wrap.className = 'log-number-wrap';
    wrap.innerHTML = `
      <div class="log-number-display" style="align-items:center;">
        <input type="number" id="log-num-val" value="${val}" style="background:var(--bg3); border:2px solid var(--primary); border-radius:12px; outline:none; font-family:var(--font-display); font-size:3rem; color:var(--text); text-align:center; width:100px; padding:4px;" />
        <span class="log-number-unit" style="margin-left:12px;">${habit.unit || ''}</span>
      </div>
      <div class="log-stepper">
        <button class="step-btn" id="step-down">−</button>
        <button class="step-btn" id="step-up">+</button>
      </div>`;
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary'; saveBtn.textContent = 'Salva';
    saveBtn.addEventListener('click', async () => {
      val = Number(document.getElementById('log-num-val').value) || 0;
      await saveLog(habit.id, val);
      closeLogModal();
      toast(`${habit.emoji} Salvato: ${val} ${habit.unit || ''}`);
    });
    wrap.appendChild(saveBtn);
    body.appendChild(wrap);

    const inputObj = document.getElementById('log-num-val');
    document.getElementById('step-up').addEventListener('click', () => {
      val = Number(inputObj.value) || 0;
      val++; inputObj.value = val;
    });
    document.getElementById('step-down').addEventListener('click', () => {
      val = Number(inputObj.value) || 0;
      if (val > 0) { val--; inputObj.value = val; }
    });

  } else if (habit.type === 'timer') {
    logTimerElapsed = Number((logs[selectedDate] || {})[habit.id] || 0);
    logTimerRunning = false;
    logTimerStart = null;
    if (logTimerInterval) clearInterval(logTimerInterval);
    logTimerInterval = null;

    const wrap = document.createElement('div');
    wrap.className = 'timer-log-wrap';
    const minElapsed = Math.floor(logTimerElapsed / 60);
    wrap.innerHTML = `
      <div class="timer-log-display" id="log-timer-disp">${fmtTime(logTimerElapsed)}</div>
      <div class="timer-controls">
        <button class="timer-ctrl-btn primary" id="log-timer-toggle">▶ Avvia</button>
        <button class="timer-ctrl-btn" id="log-timer-reset">↺ Reset</button>
      </div>
      <div style="margin-top:16px; display:flex; gap:8px; align-items:center; width:100%; justify-content:center;">
         <label style="font-size:0.8rem; color:var(--text2);">Minuti (manuale):</label>
         <input type="number" id="manual-mins" placeholder="es. 30" style="background:var(--bg3); color:var(--text); font-size:1.1rem; width:70px; border:1px solid var(--border); border-radius:8px; padding:6px; text-align:center;" min="0" value="${minElapsed > 0 ? minElapsed : ''}" />
      </div>`;
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary'; saveBtn.style.marginTop = '16px';
    saveBtn.textContent = 'Salva tempo';
    saveBtn.addEventListener('click', async () => {
      if (logTimerRunning) stopLogTimer();
      await saveLog(habit.id, logTimerElapsed);
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
      document.getElementById('manual-mins').value = '';
    });
    document.getElementById('manual-mins').addEventListener('input', e => {
      const m = Number(e.target.value);
      if (m >= 0) {
         logTimerElapsed = m * 60;
         document.getElementById('log-timer-disp').textContent = fmtTime(logTimerElapsed);
      }
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
    if (disp) disp.textContent = fmtTime(logTimerElapsed);
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

  // Delete btn
  const delBtn = document.getElementById('delete-habit-btn');
  delBtn.classList.toggle('hidden', !habit);

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
});

// Delete habit
document.getElementById('delete-habit-btn').addEventListener('click', async () => {
  if (!editingHabitId) return;
  if (!confirm('Eliminare questa abitudine? I dati storici verranno persi.')) return;
  await deleteDoc(doc(db, 'users', currentUser.uid, 'habits', editingHabitId));
  closeHabitModal();
  toast('Abitudine eliminata.');
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
      if (isHabitLoggedOnDay(habit, ds)) streak++;
      else if (i > 0) break; // Allow today to be incomplete
      else continue;
    }
  }
  return streak;
}

// ─── BOTTOM NAV ───────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.view === 'stats') {
      openStats();
    } else if (btn.dataset.view === 'today') {
      document.getElementById('stats-view').classList.add('hidden');
    }
  });
});

// ─── STATS ───────────────────────────────────────────────────────
function openStats() {
  const view = document.getElementById('stats-view');
  view.classList.remove('hidden');
  document.getElementById('stats-dashboard').classList.remove('hidden');
  document.getElementById('stats-detail-view').classList.add('hidden');
  document.getElementById('stats-main-title').textContent = 'Statistiche';
  document.getElementById('stats-back').classList.add('hidden');
  
  renderStatsDashboard();
}

function renderStatsDashboard() {
  const dash = document.getElementById('stats-dashboard');
  dash.innerHTML = '';
  
  const grid = document.createElement('div');
  grid.className = 'dashboard-grid';
  
  habits.forEach(habit => {
    const card = document.createElement('div');
    card.className = 'dashboard-card';
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
    
    for (let i = 1; i <= daysInMonth; i++) {
       const d = new Date(currYear, currMonth, i);
       const ds = dateStr(d);
       const rect = document.createElement('div');
       rect.className = 'dash-rect';
       if (!habitScheduledFor(habit, ds)) {
          rect.classList.add('skip');
       } else if (isHabitLoggedOnDay(habit, ds)) {
          rect.classList.add('on');
       } else if (ds > todayStr()) {
          rect.classList.add('future');
       }
       hm.appendChild(rect);
    }
    
    card.appendChild(hdr);
    card.appendChild(hm);
    card.addEventListener('click', () => { openHabitDetail(habit.id); });
    
    grid.appendChild(card);
  });
  
  dash.appendChild(grid);
}

function openHabitDetail(habitId) {
  document.getElementById('stats-dashboard').classList.add('hidden');
  document.getElementById('stats-detail-view').classList.remove('hidden');
  document.getElementById('stats-main-title').textContent = 'Dettagli';
  document.getElementById('stats-back').classList.remove('hidden');
  
  statsHabitId = habitId;
  buildHabitChips();
  renderStats(habitId);
}

document.getElementById('stats-back').addEventListener('click', () => {
  document.getElementById('stats-detail-view').classList.add('hidden');
  document.getElementById('stats-dashboard').classList.remove('hidden');
  document.getElementById('stats-main-title').textContent = 'Statistiche';
  document.getElementById('stats-back').classList.add('hidden');
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
      renderStats(h.id);
    });
    sel.appendChild(chip);
  });
}

function renderStats(habitId) {
  const habit = habits.find(h => h.id === habitId);
  if (!habit) return;
  const content = document.getElementById('stats-content');
  content.innerHTML = '';
  content.style.setProperty('--habit-color', habit.color || 'var(--accent)');

  // Compute stats
  const today = new Date();
  let totalDays = 0, doneDays = 0, totalValue = 0, valueCount = 0;
  const last30 = [];

  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const ds = dateStr(d);
    if (!habitScheduledFor(habit, ds)) { last30.push(null); continue; }
    totalDays++;
    const entry = (logs[ds] || {})[habit.id];
    const done = isHabitLoggedOnDay(habit, ds);
    if (done) doneDays++;
    if (entry !== undefined && entry !== null && entry !== false) {
      if (habit.type === 'number' || habit.type === 'timer') {
        totalValue += Number(entry); valueCount++;
      }
    }
    last30.push({ ds, done, val: entry });
  }

  const streak = computeStreak(habit);
  const pct = totalDays ? Math.round((doneDays / totalDays) * 100) : 0;

  // Stat cards
  const grid = document.createElement('div');
  grid.className = 'stat-grid';

  const makeCard = (val, lbl, accent = false) => {
    const c = document.createElement('div');
    c.className = 'stat-card' + (accent ? ' accent' : '');
    c.innerHTML = `<div class="stat-val">${val}</div><div class="stat-lbl">${lbl}</div>`;
    return c;
  };

  grid.appendChild(makeCard(`🔥 ${streak}`, 'Streak attuale', true));
  grid.appendChild(makeCard(`${pct}%`, 'Completamento 30gg', true));
  grid.appendChild(makeCard(doneDays, 'Volte completata'));
  if (habit.type === 'number' && valueCount > 0) {
    const avg = (totalValue / valueCount).toFixed(1);
    grid.appendChild(makeCard(`${avg} ${habit.unit || ''}`, 'Media per sessione'));
    grid.appendChild(makeCard(`${totalValue} ${habit.unit || ''}`, 'Totale accumulato'));
  } else if (habit.type === 'timer' && valueCount > 0) {
    grid.appendChild(makeCard(fmtTime(Math.round(totalValue / valueCount)), 'Durata media'));
    grid.appendChild(makeCard(fmtTime(totalValue), 'Tempo totale'));
  }

  content.appendChild(grid);

  // Calendar heatmap (last 30 days)
  const calTitle = document.createElement('div');
  calTitle.className = 'section-title';
  calTitle.textContent = 'Ultimi 30 giorni';
  content.appendChild(calTitle);

  const calGrid = document.createElement('div');
  calGrid.className = 'cal-grid';
  calGrid.style.setProperty('--habit-color', habit.color || 'var(--accent)');

  // Day labels
  ['L','M','M','G','V','S','D'].forEach(d => {
    const lbl = document.createElement('div');
    lbl.className = 'cal-day-label'; lbl.textContent = d;
    calGrid.appendChild(lbl);
  });

  // Find first Monday before 30 days ago
  const firstD = new Date(today); firstD.setDate(today.getDate() - 29);
  const dow = firstD.getDay(); // 0=Sun
  const offset = (dow === 0) ? 6 : dow - 1; // offset to previous Monday
  for (let i = 0; i < offset; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell empty';
    calGrid.appendChild(empty);
  }

  last30.forEach(item => {
    const cell = document.createElement('div');
    if (item === null) { cell.className = 'cal-cell'; calGrid.appendChild(cell); return; }
    cell.className = 'cal-cell' + (item.done ? ' done' : '') + (item.ds === todayStr() ? ' today' : '');
    calGrid.appendChild(cell);
  });

  content.appendChild(calGrid);

  // Weekly bar chart (last 8 weeks)
  const barTitle = document.createElement('div');
  barTitle.className = 'section-title';
  barTitle.textContent = 'Completamento settimanale';
  content.appendChild(barTitle);

  const barChart = document.createElement('div');
  barChart.className = 'bar-chart';
  barChart.style.setProperty('--habit-color', habit.color || 'var(--accent)');

  const weeks = [];
  for (let w = 7; w >= 0; w--) {
    let wDone = 0, wTotal = 0;
    for (let d = 0; d < 7; d++) {
      const day = new Date(today);
      day.setDate(today.getDate() - w * 7 - d);
      const ds = dateStr(day);
      if (!habitScheduledFor(habit, ds)) continue;
      wTotal++;
      if (isHabitDone(habit, ds)) wDone++;
    }
    weeks.push({ pct: wTotal ? wDone / wTotal : 0, label: `S-${w}` });
  }
  weeks[weeks.length - 1].label = 'Oggi';

  const maxPct = Math.max(...weeks.map(w => w.pct), 0.01);
  weeks.forEach(w => {
    const wrap = document.createElement('div');
    wrap.className = 'bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = `${(w.pct / maxPct) * 80}px`;
    const lbl = document.createElement('div');
    lbl.className = 'bar-lbl';
    lbl.textContent = w.label === 'Oggi' ? '·' : '';
    wrap.appendChild(bar); wrap.appendChild(lbl);
    barChart.appendChild(wrap);
  });

  content.appendChild(barChart);
}

// ─── PWA SERVICE WORKER ──────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
