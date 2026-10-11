/* =========================================================
   OPA Journal — Frontend (temps réel via Socket.IO)
   ========================================================= */
let ME = null;
let socket = null;
let appointments = [];
let finances = [];
let auditLog = [];
let notifications = [];
let unread = 0;

const $ = (id) => document.getElementById(id);
const todayStr = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const fmtMoney = (n) => (n || 0).toLocaleString('fr-DZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s) => {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};
// Jour de la semaine en lettres (ex. « lundi ») + date complète longue
const fmtWeekday = (s) => {
  if (!s) return '';
  return new Date(s + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long' });
};
const fmtDateLong = (s) => {
  if (!s) return '';
  return new Date(s + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};
const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- Notifications SYSTÈME (son sans interaction) ----------------
   Les navigateurs interdisent le son web sans interaction, MAIS une
   notification système (comme WhatsApp Web) joue le SON DU SYSTÈME
   (Windows/Android/iOS) même onglet en arrière-plan, sans aucun clic.
   L'utilisateur doit juste accepter l'autorisation UNE seule fois. */
function askNotifPermission() {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  } catch (e) {}
}

function showSystemNotification(text) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification('🔔 OPA Journal', {
      body: text,
      icon: '/assets/logo.png',
      silent: false,          // → le système joue son propre son de notification
      tag: 'opa-' + Date.now()
    });
    n.onclick = () => { try { window.focus(); n.close(); } catch (e) {} };
    setTimeout(() => { try { n.close(); } catch (e) {} }, 15000);
  } catch (e) {}
}

/* ---------------- Son de notification (Web Audio, discret) ----------------
   Les navigateurs bloquent le son tant qu'aucune interaction (clic/touche)
   n'a eu lieu depuis le chargement de la page. On déverrouille à la moindre
   interaction, et si une notification est arrivée pendant le blocage, le
   son est joué dès le déverrouillage. Un indicateur 🔇 prévient l'utilisateur. */
let audioCtx = null;
let soundPending = false; // une notif sonore est arrivée pendant le blocage

function audioUnlocked() {
  return audioCtx && audioCtx.state === 'running';
}

function updateSoundBanner() {
  let b = document.getElementById('soundBanner');
  const locked = ME && !audioUnlocked();
  if (locked) {
    if (!b) {
      b = document.createElement('div');
      b.id = 'soundBanner';
      b.textContent = '🔇 Cliquez n\'importe où pour activer le son des notifications';
      b.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);' +
        'background:#fff;color:#b45309;border:1px solid #f0b849;border-radius:999px;' +
        'padding:9px 18px;font-size:.82rem;z-index:299;box-shadow:0 8px 24px rgba(17,24,39,.15);cursor:pointer;';
      document.body.appendChild(b);
    }
  } else if (b) {
    b.remove();
  }
}

function tryUnlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(() => {
        updateSoundBanner();
        if (soundPending) { soundPending = false; playNotifSound(); }
      }).catch(() => {});
    } else {
      updateSoundBanner();
      if (soundPending) { soundPending = false; playNotifSound(); }
    }
  } catch (e) {}
}
// Déverrouiller à la MOINDRE interaction (clic, toucher, clavier) — en continu
['pointerdown', 'touchstart', 'keydown', 'click'].forEach(evt => {
  document.addEventListener(evt, tryUnlockAudio, { passive: true });
});

function playNotifSound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      // Audio bloqué par le navigateur → mémoriser et jouer au déverrouillage
      soundPending = true;
      audioCtx.resume().catch(() => {});
      updateSoundBanner();
      return;
    }
    const now = audioCtx.currentTime;
    // Carillon 4 notes (Do-Mi-Sol-Do aigu) — durée totale ≈ 1,5 s
    // [fréquence Hz, délai s, durée s, volume]
    const notes = [
      [523.25, 0.00, 0.60, 0.16],  // Do5
      [659.25, 0.18, 0.60, 0.16],  // Mi5
      [783.99, 0.36, 0.70, 0.15],  // Sol5
      [1046.50, 0.54, 0.95, 0.14]  // Do6 (tenue plus longue)
    ];
    notes.forEach(([freq, delay, dur, vol]) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, now + delay);
      g.gain.linearRampToValueAtTime(vol, now + delay + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(now + delay);
      o.stop(now + delay + dur + 0.05);
    });
  } catch (e) { /* silencieux */ }
}

/* ---------------- API (jeton par onglet : sessionStorage) ---------------- */
/* Chaque ONGLET a son propre jeton → on peut ouvrir PDG et DG côte à côte
   dans le même navigateur sans qu'ils s'écrasent mutuellement. */
let TOKEN = sessionStorage.getItem('opa_token') || '';
function setToken(t) {
  TOKEN = t || '';
  if (t) sessionStorage.setItem('opa_token', t);
  else sessionStorage.removeItem('opa_token');
}
async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': TOKEN,
      ...(opts.headers || {})
    }
  });
  if (res.status === 401) { setToken(''); showLogin(); throw new Error('401'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur serveur');
  return data;
}

/* ---------------- Connexion ---------------- */
function showLogin() {
  $('loginScreen').classList.remove('hidden');
  $('appScreen').classList.add('hidden');
  if (socket) { socket.disconnect(); socket = null; }
}
function showApp() {
  $('loginScreen').classList.add('hidden');
  $('appScreen').classList.remove('hidden');
  $('userRole').textContent = ME.short;
  document.title = `OPA — Journal ${ME.short}`;
  $('todayTitle').textContent = ME.role === 'PDG' ? 'Agenda du jour — Président' : 'Agenda du jour — Directeur Général';
  $('todayDate').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('privacyUser').textContent = ME.displayName;
  $('privacyRole').textContent = ME.short;
  connectSocket();
  loadAll();
  fallbackStart(); // synchro + présence permanentes (fiables sur cPanel)
  updateSoundBanner(); // avertit si le son est verrouillé (reconnexion auto sans clic)
  askNotifPermission(); // notifications système : son même sans interaction
}

/* ---------------- Œil mot de passe ---------------- */
$('togglePass').addEventListener('click', () => {
  const inp = $('loginPass');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('togglePass').textContent = show ? '🙈' : '👁';
  $('togglePass').classList.toggle('active', show);
  inp.focus();
});

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('loginUser').value, password: $('loginPass').value })
    });
    setToken(data.token); // jeton propre à CET onglet
    ME = data.user;
    showApp();
  } catch (err) {
    $('loginError').textContent = err.message === '401' ? 'Identifiant ou mot de passe incorrect' : err.message;
  }
});

$('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
  ME = null;
  setToken('');
  fallbackStop();
  showLogin();
});

/* ---------------- Socket.IO temps réel ---------------- */
function connectSocket() {
  if (socket) socket.disconnect();
  // 'polling' d'abord : requêtes HTTP classiques, compatibles avec les hébergeurs
  // cPanel qui bloquent les WebSockets. Socket.IO tentera l'upgrade WS ensuite.
  socket = io({
    transports: ['polling', 'websocket'],
    auth: { token: TOKEN }, // jeton de CET onglet
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    timeout: 10000
  });

  // NB : sur cPanel, Passenger peut lancer PLUSIEURS processus Node : les
  // événements Socket.IO ne circulent alors pas entre PDG et DG. La synchro
  // de secours (fallbackSync) et la présence (heartbeat) tournent donc EN
  // PERMANENCE via la base de données — fiables dans tous les cas.
  // Socket.IO reste actif en bonus pour l'instantanéité quand il fonctionne.

  socket.on('presence', (p) => {
    $('dotPDG').classList.toggle('on', !!p.PDG);
    $('dotDG').classList.toggle('on', !!p.DG);
  });

  socket.on('appt:created', ({ appt, by }) => {
    if (appointments.find(a => a.id === appt.id)) return; // déjà reçu (via synchro)
    appointments.push(appt);
    renderAgenda();
    // 🔔 SON uniquement pour l'ajout d'un rendez-vous (type 'rdv')
    if (by !== ME.role) notify(`📅 ${by} a ajouté : « ${appt.title} » le ${fmtDateLong(appt.date)}${appt.time ? ' à ' + appt.time : ''}`, appt.type === 'rdv');
  });
  socket.on('appt:updated', ({ appt, by }) => {
    const i = appointments.findIndex(a => a.id === appt.id);
    if (i !== -1) appointments[i] = appt; else appointments.push(appt);
    renderAgenda();
    if (by !== ME.role) notify(`✏️ ${by} a modifié : « ${appt.title} »`);
  });
  socket.on('appt:deleted', ({ id, appt, by }) => {
    appointments = appointments.filter(a => a.id !== id);
    renderAgenda();
    if (by !== ME.role) notify(`🗑 ${by} a supprimé : « ${appt.title} »`);
  });

  socket.on('fin:created', ({ tx, by }) => {
    if (finances.find(t => t.id === tx.id)) return; // déjà reçu (via synchro)
    finances.push(tx);
    renderFinances();
    if (by !== ME.role) notify(`💰 ${by} a saisi une ${tx.type === 'entree' ? 'entrée' : 'sortie'} de ${fmtMoney(tx.amount)} DA — ${tx.label}`);
  });
  socket.on('fin:updated', ({ tx, by }) => {
    const i = finances.findIndex(t => t.id === tx.id);
    if (i !== -1) finances[i] = tx; else finances.push(tx);
    renderFinances();
    if (by !== ME.role) notify(`✏️ ${by} a modifié la transaction « ${tx.label} »`);
  });
  socket.on('fin:deleted', ({ id, tx, by }) => {
    finances = finances.filter(t => t.id !== id);
    renderFinances();
    if (by !== ME.role) notify(`🗑 ${by} a supprimé la transaction « ${tx.label} »`);
  });

  socket.on('audit:new', (entry) => {
    auditLog.unshift(entry);
    if (auditLog.length > 300) auditLog.length = 300;
    renderAudit();
  });

  // Purge automatique du journal d'audit (48 h) → recharger la liste
  socket.on('audit:purged', async () => {
    try {
      auditLog = await api('/api/audit');
      renderAudit();
    } catch (e) {}
  });
}

/* ---------------- Synchro de secours (si le temps réel est bloqué) ----------------
   Certains hébergeurs cPanel bloquent Socket.IO. Dans ce cas, on re-télécharge
   les données toutes les 5 s et on détecte les nouveautés de l'autre utilisateur
   (avec notification + son pour les nouveaux RDV). ---------------------------- */
let fallbackTimer = null;
let heartbeatTimer = null;
function fallbackStart() {
  if (!fallbackTimer) fallbackTimer = setInterval(fallbackSync, 5000);
  if (!heartbeatTimer) { heartbeatTimer = setInterval(sendHeartbeat, 5000); sendHeartbeat(); }
}
function fallbackStop() {
  clearInterval(fallbackTimer); fallbackTimer = null;
  clearInterval(heartbeatTimer); heartbeatTimer = null;
}

/* Présence (points verts) via la base — fiable même sur cPanel multi-processus */
async function sendHeartbeat() {
  if (!ME) return;
  try {
    const p = await api('/api/heartbeat', { method: 'POST', body: JSON.stringify({}) });
    $('dotPDG').classList.toggle('on', !!p.PDG);
    $('dotDG').classList.toggle('on', !!p.DG);
  } catch (e) { /* retentera */ }
}
async function fallbackSync() {
  if (!ME) return;
  try {
    const [newAppts, newFins, newAudit] = await Promise.all([
      api('/api/appointments'), api('/api/finances'), api('/api/audit')
    ]);

    // Nouveaux RDV/mémos créés par l'autre utilisateur → notification (+ son si RDV)
    const oldApptIds = new Set(appointments.map(a => a.id));
    newAppts.forEach(a => {
      if (!oldApptIds.has(a.id) && a.createdBy !== ME.role) {
        notify(`📅 ${a.createdBy} a ajouté : « ${a.title} » le ${fmtDateLong(a.date)}${a.time ? ' à ' + a.time : ''}`, a.type === 'rdv');
      }
    });
    // Nouvelles transactions de l'autre utilisateur → notification
    const oldFinIds = new Set(finances.map(t => t.id));
    newFins.forEach(t => {
      if (!oldFinIds.has(t.id) && t.createdBy !== ME.role) {
        notify(`💰 ${t.createdBy} a saisi une ${t.type === 'entree' ? 'entrée' : 'sortie'} de ${fmtMoney(t.amount)} DA — ${t.label}`);
      }
    });

    // Rafraîchir l'affichage seulement si quelque chose a changé
    const changed = JSON.stringify(newAppts) !== JSON.stringify(appointments)
      || JSON.stringify(newFins) !== JSON.stringify(finances)
      || (newAudit[0] && (!auditLog[0] || newAudit[0].id !== auditLog[0].id));
    appointments = newAppts;
    finances = newFins;
    auditLog = newAudit;
    if (changed) {
      renderAgenda();
      renderFinances();
      renderAudit();
    }
  } catch (e) { /* silencieux : retentera dans 5 s */ }
}

/* ---------------- Notifications ---------------- */
/* withSound = true → joue le son (uniquement pour l'ajout d'un RDV) */
function notify(text, withSound = false) {
  notifications.unshift({ text, time: new Date(), read: false });
  if (notifications.length > 50) notifications.length = 50;
  unread++;
  updateBadge();
  renderNotifs();
  if (withSound) {
    playNotifSound();              // carillon web (si la page a déjà été touchée)
    showSystemNotification(text);  // notification système avec SON (sans interaction)
  }
  toast(text);
}
function updateBadge() {
  const b = $('badge');
  if (unread > 0) { b.textContent = unread > 99 ? '99+' : unread; b.classList.remove('hidden'); }
  else b.classList.add('hidden');
}
function renderNotifs() {
  const list = $('notifList');
  if (!notifications.length) { list.innerHTML = '<div class="empty">Aucune notification</div>'; return; }
  list.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}">
      <div>${escapeHtml(n.text)}</div>
      <div class="n-time">${n.time.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
    </div>`).join('');
}
$('bellBtn').addEventListener('click', () => {
  $('notifPanel').classList.toggle('hidden');
});
$('clearNotif').addEventListener('click', () => {
  notifications.forEach(n => n.read = true);
  unread = 0; updateBadge(); renderNotifs();
});
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 4000);
}

/* ---------------- Onglets ---------------- */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    $('tab-' + btn.dataset.tab).classList.remove('hidden');
  });
});

/* ---------------- Chargement ---------------- */
async function loadAll() {
  try {
    [appointments, finances, auditLog] = await Promise.all([
      api('/api/appointments'), api('/api/finances'), api('/api/audit')
    ]);
    renderAgenda();
    renderFinances();
    renderAudit();
    renderCalendar();
  } catch (e) { console.error(e); }
}

/* ---------------- Agenda ---------------- */
function apptHtml(a) {
  return `
    <div class="appt ${a.type} ${a.done ? 'done' : ''}">
      <div class="a-day">
        <span class="a-weekday">${fmtWeekday(a.date)}</span>
        <span class="a-hour">${a.time || 'Journée'}</span>
      </div>
      <div class="a-numdate">${fmtDate(a.date)}</div>
      <div class="a-title">${a.type === 'memo' ? '📝 ' : ''}${escapeHtml(a.title)}</div>
      <div class="a-meta">
        <span class="tag ${a.target === 'PDG' ? 'pdg' : 'dg'}">pour ${a.target}</span>
        <span class="tag">par ${a.createdBy}</span>
      </div>
      ${a.notes ? `<div class="a-notes">${escapeHtml(a.notes)}</div>` : ''}
      <div class="a-actions">
        <button onclick="toggleDone(${a.id})">${a.done ? '↩ Rouvrir' : '✔ Terminé'}</button>
        <button onclick="editAppt(${a.id})" title="Modifier">✏</button>
        <button onclick="deleteAppt(${a.id})" title="Supprimer">🗑</button>
      </div>
    </div>`;
}
function renderAgenda() {
  // le calendrier affiche aussi les RDV → resynchroniser
  if (typeof renderCalendar === 'function' && document.getElementById('calGrid')) {
    renderCalendar();
  }
  const today = todayStr();
  const sortFn = (x, y) => (x.date + (x.time || '00:00')).localeCompare(y.date + (y.time || '00:00'));
  const todays = appointments.filter(a => a.date === today).sort(sortFn);
  const upcoming = appointments.filter(a => a.date > today).sort(sortFn);

  $('todayCount').textContent = todays.length;
  $('todayList').innerHTML = todays.length ? todays.map(apptHtml).join('') : '<div class="empty">Rien de prévu aujourd\'hui</div>';
  $('upcomingList').innerHTML = upcoming.length ? upcoming.map(apptHtml).join('') : '<div class="empty">Aucun rendez-vous à venir</div>';
}

/* Cycle de vie des RDV : créés dans « À venir » → le jour J dans « Aujourd'hui »
   → le lendemain ils disparaissent de l'affichage (agenda + calendrier).
   Ils restent archivés en base de données. */
$('apptDate').min = todayStr(); // pas de création dans le passé
let lastRenderedDay = todayStr();
setInterval(() => {
  const d = todayStr();
  if (d !== lastRenderedDay) {
    lastRenderedDay = d;
    $('apptDate').min = d;
    renderAgenda(); // réaffiche tout : la veille disparaît, les lendemains passent en « Aujourd'hui »
  }
}, 30000);

window.toggleDone = async (id) => {
  const a = appointments.find(x => x.id === id);
  if (!a) return;
  await api('/api/appointments/' + id, { method: 'PUT', body: JSON.stringify({ done: !a.done }) });
};
window.editAppt = (id) => {
  const a = appointments.find(x => x.id === id);
  if (!a) return;
  $('apptModalTitle').textContent = 'Modifier le rendez-vous / mémo';
  $('apptId').value = a.id;
  $('apptTitle').value = a.title;
  $('apptDate').value = a.date;
  $('apptTime').value = a.time || '';
  $('apptType').value = a.type;
  $('apptTarget').value = a.target;
  $('apptNotes').value = a.notes || '';
  updateApptDatePreview();
  $('apptModal').classList.remove('hidden');
};
window.deleteAppt = async (id) => {
  if (!confirm('Supprimer cet élément ?')) return;
  await api('/api/appointments/' + id, { method: 'DELETE' });
};

$('addApptBtn').addEventListener('click', () => {
  $('apptModalTitle').textContent = 'Nouveau rendez-vous / mémo';
  $('apptForm').reset();
  $('apptId').value = '';
  $('apptDate').value = todayStr();
  // Par défaut : le DG écrit pour le PDG, et inversement
  $('apptTarget').value = ME.role === 'DG' ? 'PDG' : 'PDG';
  updateApptDatePreview();
  $('apptModal').classList.remove('hidden');
});

/* Aperçu dans la modale : jour en lettres (gras + grand) + heure */
function updateApptDatePreview() {
  const el = $('apptDatePreview');
  if (!el) return;
  const d = $('apptDate').value;
  const t = $('apptTime').value;
  if (!d) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  const rest = new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  el.innerHTML = `<span class="pv-weekday">${fmtWeekday(d)}</span><span class="pv-rest">${rest}${t ? ' · ' + t : ''}</span>`;
  el.classList.remove('hidden');
}
$('apptDate').addEventListener('input', updateApptDatePreview);
$('apptTime').addEventListener('input', updateApptDatePreview);

$('apptForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    title: $('apptTitle').value.trim(),
    date: $('apptDate').value,
    time: $('apptTime').value,
    type: $('apptType').value,
    target: $('apptTarget').value,
    notes: $('apptNotes').value.trim()
  };
  const id = $('apptId').value;
  try {
    if (id) await api('/api/appointments/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/appointments', { method: 'POST', body: JSON.stringify(body) });
    $('apptModal').classList.add('hidden');
  } catch (err) { alert(err.message); }
});

/* ---------------- Finances ---------------- */
function computeTotals(list) {
  let inn = 0, out = 0;
  list.forEach(t => t.type === 'entree' ? inn += t.amount : out += t.amount);
  return { inn, out, net: inn - out };
}
function renderFinances() {
  const today = todayStr();
  const ym = today.slice(0, 7);
  const y = today.slice(0, 4);
  const now = new Date();
  $('monthLabel').textContent = now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }).toUpperCase();
  $('yearLabel').textContent = 'ANNÉE ' + y;

  const day = computeTotals(finances.filter(t => t.date === today));
  const month = computeTotals(finances.filter(t => (t.date || '').startsWith(ym)));
  const year = computeTotals(finances.filter(t => (t.date || '').startsWith(y)));

  const setNet = (id, v) => {
    const el = $(id);
    el.textContent = fmtMoney(v) + ' DA';
    el.className = v < 0 ? 'neg' : '';
  };
  $('dayIn').textContent = '+' + fmtMoney(day.inn);   $('dayOut').textContent = '−' + fmtMoney(day.out);   setNet('dayNet', day.net);
  $('monthIn').textContent = '+' + fmtMoney(month.inn); $('monthOut').textContent = '−' + fmtMoney(month.out); setNet('monthNet', month.net);
  $('yearIn').textContent = '+' + fmtMoney(year.inn);  $('yearOut').textContent = '−' + fmtMoney(year.out);  setNet('yearNet', year.net);

  const sorted = [...finances].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)).slice(0, 100);
  $('finBody').innerHTML = sorted.length ? sorted.map(t => `
    <tr>
      <td>${fmtDate(t.date)}</td>
      <td>${escapeHtml(t.label)}</td>
      <td><span class="type-pill ${t.type}">${t.type === 'entree' ? 'Entrée' : 'Sortie'}</span></td>
      <td class="right" style="font-weight:700;color:${t.type === 'entree' ? 'var(--green)' : 'var(--red)'}">
        ${t.type === 'entree' ? '+' : '−'}${fmtMoney(t.amount)}
      </td>
      <td class="muted">${t.createdBy}</td>
      <td class="right">
        <button class="mini-btn" onclick="editTx(${t.id})">✏</button>
        <button class="mini-btn" onclick="deleteTx(${t.id})">🗑</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty">Aucune transaction</td></tr>';
}

window.editTx = (id) => {
  const t = finances.find(x => x.id === id);
  if (!t) return;
  $('txModalTitle').textContent = 'Modifier la transaction';
  $('txId').value = t.id;
  $('txLabel').value = t.label;
  $('txAmount').value = t.amount;
  $('txDate').value = t.date;
  $('txType').value = t.type;
  $('txModal').classList.remove('hidden');
};
window.deleteTx = async (id) => {
  if (!confirm('Supprimer cette transaction ?')) return;
  await api('/api/finances/' + id, { method: 'DELETE' });
};

$('addTxBtn').addEventListener('click', () => {
  $('txModalTitle').textContent = 'Nouvelle transaction';
  $('txForm').reset();
  $('txId').value = '';
  $('txDate').value = todayStr();
  $('txModal').classList.remove('hidden');
});

$('txForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    label: $('txLabel').value.trim(),
    amount: Number($('txAmount').value),
    date: $('txDate').value,
    type: $('txType').value
  };
  const id = $('txId').value;
  try {
    if (id) await api('/api/finances/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/finances', { method: 'POST', body: JSON.stringify(body) });
    $('txModal').classList.add('hidden');
  } catch (err) { alert(err.message); }
});

/* ---------------- Calendrier (jours fériés algériens) ---------------- */
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-11
let holidaysCache = {}; // year -> [{date,name,type}]

async function getHolidays(year) {
  if (!holidaysCache[year]) {
    try { holidaysCache[year] = await api('/api/holidays/' + year); }
    catch (e) { holidaysCache[year] = []; }
  }
  return holidaysCache[year];
}

const MONTHS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
let calSelected = null; // date sélectionnée (YYYY-MM-DD)

async function renderCalendar() {
  const holidays = await getHolidays(calYear);
  const holidayMap = {};
  holidays.forEach(h => {
    if (!holidayMap[h.date]) holidayMap[h.date] = [];
    holidayMap[h.date].push(h);
  });

  $('calTitle').textContent = MONTHS_FR[calMonth].toUpperCase() + ' ' + calYear;

  const first = new Date(calYear, calMonth, 1);
  const startDow = first.getDay(); // 0 = dimanche
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const daysPrev = new Date(calYear, calMonth, 0).getDate();
  const today = todayStr();

  const cells = [];
  for (let i = startDow - 1; i >= 0; i--) cells.push({ day: daysPrev - i, other: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, date: ds, other: false });
  }
  let nd = 1;
  while (cells.length % 7 !== 0) cells.push({ day: nd++, other: true });

  $('calGrid').innerHTML = cells.map(c => {
    if (c.other) return `<div class="cal-cell other"><span class="cal-daynum">${c.day}</span></div>`;
    const dow = new Date(c.date + 'T00:00:00').getDay();
    const isWeekend = dow === 5 || dow === 6; // vendredi / samedi (Algérie)
    const hols = holidayMap[c.date] || [];
    // Les événements passés ne sont plus affichés (aujourd'hui + à venir uniquement)
    const evts = c.date >= today ? appointments.filter(a => a.date === c.date) : [];
    const hasRdv = evts.some(a => a.type === 'rdv');
    const hasMemo = evts.some(a => a.type === 'memo');
    const cls = ['cal-cell'];
    if (isWeekend) cls.push('weekend');
    if (hols.length) cls.push('holiday');
    if (c.date === today) cls.push('today');
    if (hasRdv) cls.push('has-rdv');
    if (hasMemo) cls.push('has-memo');
    // points sous la pastille si férié/aujourd'hui ET événements
    let dots = '';
    if ((hols.length || c.date === today) && (hasRdv || hasMemo)) {
      dots = `<span class="cal-dots">${hasRdv ? '<i class="d-rdv"></i>' : ''}${hasMemo ? '<i class="d-memo"></i>' : ''}</span>`;
    }
    const tip = [...hols.map(h => h.name), ...evts.map(a => a.title)].join(', ');
    return `<div class="${cls.join(' ')}" onclick="calDayClick('${c.date}')" title="${escapeHtml(tip)}">
      <span class="cal-daynum">${c.day}${dots}</span>
    </div>`;
  }).join('');

  renderCalEvents(holidayMap);
}

/* Liste des événements sous le calendrier (style photo) */
function renderCalEvents(holidayMap) {
  const mm = String(calMonth + 1).padStart(2, '0');
  const prefix = `${calYear}-${mm}`;

  let dates, title;
  if (calSelected && calSelected.startsWith(prefix)) {
    dates = [calSelected];
    title = new Date(calSelected + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } else {
    // tout le mois
    dates = null;
    title = 'Ce mois — fériés et rendez-vous';
  }
  $('calDayTitle').textContent = title;

  const today = todayStr();
  const inScope = (d) => dates ? dates.includes(d) : (d || '').startsWith(prefix);

  const cards = [];
  // Jours fériés (à partir d'aujourd'hui uniquement)
  Object.keys(holidayMap).sort().forEach(d => {
    if (!inScope(d) || d < today) return;
    holidayMap[d].forEach(h => {
      cards.push({
        sort: d + ' 00:00',
        html: `<div class="cal-evt-card" onclick="calDayClick('${d}')">
          <span class="cal-evt-time">${fmtDate(d).slice(0, 5)}</span>
          <span class="cal-evt-bar ferie"></span>
          <div class="cal-evt-main">
            <div class="cal-evt-title">★ ${escapeHtml(h.name)}</div>
            <div class="cal-evt-sub">Jour férié — ${h.type === 'civil' ? 'fête civile' : 'fête religieuse'}</div>
          </div>
          <span class="cal-evt-chev">›</span>
        </div>`
      });
    });
  });
  // Rendez-vous / mémos (aujourd'hui + à venir uniquement)
  appointments.filter(a => a.date >= today && inScope(a.date)).forEach(a => {
    cards.push({
      sort: a.date + ' ' + (a.time || '00:01'),
      html: `<div class="cal-evt-card" onclick="editAppt(${a.id})">
        <span class="cal-evt-time">${a.time || 'Journée'}</span>
        <span class="cal-evt-bar ${a.type}"></span>
        <div class="cal-evt-main">
          <div class="cal-evt-title">${escapeHtml(a.title)}</div>
          <div class="cal-evt-sub">${fmtDateLong(a.date)} · pour ${a.target} · par ${a.createdBy}${a.notes ? ' — ' + escapeHtml(a.notes) : ''}</div>
        </div>
        <span class="cal-evt-chev">›</span>
      </div>`
    });
  });

  cards.sort((x, y) => x.sort.localeCompare(y.sort));
  $('calEvents').innerHTML = cards.length
    ? cards.map(c => c.html).join('')
    : `<div class="cal-empty-card">Aucun événement ${dates ? 'ce jour-là' : 'ce mois-ci'}</div>`;
}

window.calDayClick = (date) => {
  // 1er clic : sélectionner le jour (affiche ses événements) — 2e clic : créer un RDV
  // (création uniquement pour aujourd'hui ou une date future)
  if (calSelected === date && date >= todayStr()) {
    $('apptModalTitle').textContent = 'Nouveau rendez-vous / mémo';
    $('apptForm').reset();
    $('apptId').value = '';
    $('apptDate').value = date;
    $('apptTarget').value = 'PDG';
    updateApptDatePreview();
    $('apptModal').classList.remove('hidden');
  } else {
    calSelected = date;
    renderCalendar();
  }
};

$('calPrev').addEventListener('click', () => {
  calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
  calSelected = null;
  renderCalendar();
});
$('calNext').addEventListener('click', () => {
  calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
  calSelected = null;
  renderCalendar();
});
$('calToday').addEventListener('click', () => {
  calYear = new Date().getFullYear();
  calMonth = new Date().getMonth();
  calSelected = todayStr();
  renderCalendar();
});
$('calAddBtn').addEventListener('click', () => {
  const d = calSelected && calSelected >= todayStr() ? calSelected : todayStr();
  $('apptModalTitle').textContent = 'Nouveau rendez-vous / mémo';
  $('apptForm').reset();
  $('apptId').value = '';
  $('apptDate').value = d;
  $('apptTarget').value = 'PDG';
  updateApptDatePreview();
  $('apptModal').classList.remove('hidden');
});

/* ---------------- Confidentialité : changement de mot de passe ---------------- */
// Œil sur les 3 champs
document.querySelectorAll('.eye-btn[data-eye]').forEach(btn => {
  btn.addEventListener('click', () => {
    const inp = $(btn.dataset.eye);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.textContent = show ? '🙈' : '👁';
    btn.classList.toggle('active', show);
  });
});

// Jauge de force du nouveau mot de passe
$('pwdNew').addEventListener('input', () => {
  const v = $('pwdNew').value;
  let score = 0;
  if (v.length >= 8) score++;
  if (v.length >= 12) score++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
  if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
  $('pwdStrength').innerHTML = score ? `<i class="w${score}"></i>` : '';
});

$('pwdForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('pwdError').textContent = '';
  $('pwdSuccess').textContent = '';

  const currentPassword = $('pwdCurrent').value;
  const newPassword = $('pwdNew').value;
  const confirmPassword = $('pwdConfirm').value;

  // Vérifications côté client
  if (newPassword !== confirmPassword) {
    $('pwdError').textContent = 'La confirmation ne correspond pas au nouveau mot de passe';
    return;
  }
  if (newPassword.length < 8) {
    $('pwdError').textContent = 'Le nouveau mot de passe doit contenir au moins 8 caractères';
    return;
  }
  if (newPassword === currentPassword) {
    $('pwdError').textContent = "Le nouveau mot de passe doit être différent de l'actuel";
    return;
  }

  try {
    await api('/api/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
    });
    $('pwdSuccess').textContent = '✔ Mot de passe modifié avec succès';
    $('pwdForm').reset();
    $('pwdStrength').innerHTML = '';
    toast('🔒 Votre mot de passe a été changé');
  } catch (err) {
    $('pwdError').textContent = err.message; // ex. « Mot de passe actuel incorrect »
  }
});

/* ---------------- Audit ---------------- */
const AUDIT_ICONS = { AGENDA: '📅', FINANCES: '💰', SYSTEME: '🔐' };
function renderAudit() {
  const list = $('auditList');
  list.innerHTML = auditLog.length ? auditLog.map(a => `
    <div class="audit-item">
      <span class="audit-ico">${AUDIT_ICONS[a.module] || '•'}</span>
      <div class="audit-main">
        <div>${escapeHtml(a.details)}</div>
        <div class="audit-meta">${a.userName} (${a.user}) — ${new Date(a.ts).toLocaleString('fr-FR')}</div>
      </div>
      <span class="audit-action ${a.action}">${a.action}</span>
    </div>`).join('') : '<div class="empty">Aucune action enregistrée</div>';
}

/* ---------------- Fermeture modales ---------------- */
document.querySelectorAll('[data-close]').forEach(b => {
  b.addEventListener('click', () => b.closest('.modal').classList.add('hidden'));
});
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
});

/* ---------------- Session existante ? ---------------- */
(async () => {
  try {
    const data = await api('/api/me');
    ME = data.user;
    showApp();
  } catch (e) { showLogin(); }
})();
