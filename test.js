const logs = {
  "2026-03-23": { h1: true }, // Mon
  "2026-03-24": { h1: true }, // Tue
  "2026-03-25": { h1: true }, // Wed
  "2026-03-26": { h1: true }, // Thu
};

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function isHabitLoggedOnDay(habit, dateString) {
  const entry = (logs[dateString] || {})[habit.id];
  if (entry === undefined || entry === null) return false;
  if (habit.type === 'boolean') return entry === true;
  return false;
}

function checkWeeklyGoalMet(habit, dateString) {
  if (!habit.freqN) return false;
  const d = new Date(dateString + 'T12:00:00');
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
  const start = new Date(d); start.setDate(diff);
  let count = 0;
  for (let i = 0; i < 7; i++) {
     const cur = new Date(start); cur.setDate(start.getDate() + i);
     if (isHabitLoggedOnDay(habit, dateStr(cur))) count++;
  }
  return count >= habit.freqN;
}

function computeStreak(habit, todayStrInput) {
  let streak = 0;
  const today = new Date(todayStrInput + "T12:00:00");
  
  if (habit.freq === 'weekly' && habit.freqN) {
    const startOfCurrentWeek = new Date(today);
    const day = startOfCurrentWeek.getDay();
    const diff = startOfCurrentWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfCurrentWeek.setDate(diff);
    
    if (checkWeeklyGoalMet(habit, dateStr(startOfCurrentWeek))) streak++;
    
    let wStart = new Date(startOfCurrentWeek);
    for (let i = 1; i < 52; i++) {
        wStart.setDate(wStart.getDate() - 7);
        if (checkWeeklyGoalMet(habit, dateStr(wStart))) streak++;
        else break;
    }
  } 
  return streak;
}

const habit = { id: 'h1', type: 'boolean', freq: 'weekly', freqN: 4 };
console.log("Q1 Thu (4 logs):", computeStreak(habit, "2026-03-26"));
console.log("Q2 Wed (3 logs):", computeStreak(habit, "2026-03-25"));

logs["2026-03-16"] = { h1: true };
logs["2026-03-17"] = { h1: true };
logs["2026-03-18"] = { h1: true };
logs["2026-03-19"] = { h1: true };
logs["2026-03-20"] = { h1: true }; 

console.log("Q3 Wed (with last week met):", computeStreak(habit, "2026-03-25"));
console.log("Q4 Thu (with last week met):", computeStreak(habit, "2026-03-26"));
