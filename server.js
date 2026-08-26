/* =========================================================
   OPA — Journal partagé PDG / DG
   Node.js + Express + Socket.IO + Sessions + MySQL
   ========================================================= */
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { Server } = require('socket.io');
const { getAlgerianHolidays } = require('./holidays-dz');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

/* ---------------- MySQL (configuration cPanel) ---------------- */
const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'opa',
  password: process.env.DB_PASS || 'opa_secret_2025', // ⚠️ remplacez par le VRAI mot de passe de la base
  database: process.env.DB_NAME || 'opa_journal',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true
};
let pool;

async function initDB() {
  pool = mysql.createPool(DB_CONFIG);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      date DATE NOT NULL,
      time VARCHAR(5) DEFAULT '',
      type ENUM('rdv','memo') DEFAULT 'rdv',
      notes TEXT,
      target ENUM('PDG','DG') DEFAULT 'PDG',
      done TINYINT(1) DEFAULT 0,
      created_by VARCHAR(10) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_by VARCHAR(10) DEFAULT NULL,
      updated_at DATETIME DEFAULT NULL,
      INDEX idx_date (date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS finances (
      id INT AUTO_INCREMENT PRIMARY KEY,
      label VARCHAR(200) NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      type ENUM('entree','sortie') DEFAULT 'entree',
      date DATE NOT NULL,
      created_by VARCHAR(10) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_by VARCHAR(10) DEFAULT NULL,
      updated_at DATETIME DEFAULT NULL,
      INDEX idx_date (date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ts DATETIME DEFAULT CURRENT_TIMESTAMP,
      user_role VARCHAR(10) NOT NULL,
      user_name VARCHAR(100) NOT NULL,
      action VARCHAR(20) NOT NULL,
      module VARCHAR(20) NOT NULL,
      details TEXT,
      INDEX idx_ts (ts)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      username VARCHAR(30) PRIMARY KEY,
      password_hash VARCHAR(100) NOT NULL,
      role VARCHAR(10) NOT NULL,
      display_name VARCHAR(100) NOT NULL,
      short_name VARCHAR(10) NOT NULL,
      updated_at DATETIME DEFAULT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Semer les deux comptes au premier démarrage (mot de passe initial : opa2025)
  const [existing] = await pool.query('SELECT username FROM users');
  if (existing.length === 0) {
    await pool.query(
      'INSERT INTO users (username, password_hash, role, display_name, short_name) VALUES (?,?,?,?,?), (?,?,?,?,?)',
      [
        'pdg', bcrypt.hashSync('opa2025', 10), 'PDG', 'Président Directeur Général', 'PDG',
        'dg', bcrypt.hashSync('opa2025', 10), 'DG', 'Directeur Général', 'DG'
      ]
    );
    console.log('👤 Comptes pdg / dg créés (mot de passe initial : opa2025)');
  }
  // Colonne last_seen pour la présence en ligne (compatible multi-processus cPanel)
  try { await pool.query('ALTER TABLE users ADD COLUMN last_seen DATETIME NULL'); } catch (e) { /* déjà présente */ }
  // Sessions par jeton, stockées en base :
  // - indépendantes par ONGLET (le jeton vit dans sessionStorage, pas en cookie)
  // - partagées entre les processus Passenger (cPanel)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(64) PRIMARY KEY,
      username VARCHAR(30) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_last_used (last_used)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ Tables MySQL prêtes (base: ' + DB_CONFIG.database + ')');
}

/* ---------------- Mappers ---------------- */
const mapAppt = (r) => ({
  id: r.id, title: r.title, date: r.date, time: r.time || '',
  type: r.type, notes: r.notes || '', target: r.target, done: !!r.done,
  createdBy: r.created_by, createdAt: r.created_at,
  updatedBy: r.updated_by, updatedAt: r.updated_at
});
const mapTx = (r) => ({
  id: r.id, label: r.label, amount: Number(r.amount), type: r.type,
  date: r.date, createdBy: r.created_by, createdAt: r.created_at,
  updatedBy: r.updated_by, updatedAt: r.updated_at
});
const mapAudit = (r) => ({
  id: r.id, ts: r.ts, user: r.user_role, userName: r.user_name,
  action: r.action, module: r.module, details: r.details
});

/* ---------------- Utilisateurs (stockés en base MySQL) ---------------- */
// Identifiants initiaux : pdg / opa2025  —  dg / opa2025
// Modifiables ensuite via la rubrique Confidentialité de l'application.
async function getUser(username) {
  const [[row]] = await pool.query('SELECT * FROM users WHERE username=?', [(username || '').toLowerCase().trim()]);
  if (!row) return null;
  return {
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    displayName: row.display_name,
    short: row.short_name
  };
}

/* ---------------- Middlewares ---------------- */
app.use(express.json());

/* ---------------- Authentification par jeton (en base) ----------------
   Le jeton est envoyé par le client dans l'en-tête "X-Auth-Token".
   Stocké dans sessionStorage côté navigateur → chaque ONGLET a sa propre
   session (PDG et DG peuvent être ouverts côte à côte).                */
const SESSION_HOURS = 12;
async function getSessionUser(token) {
  if (!token) return null;
  const [[row]] = await pool.query(
    `SELECT s.token, u.username, u.role, u.display_name, u.short_name
     FROM sessions s JOIN users u ON u.username = s.username
     WHERE s.token = ? AND s.last_used > NOW() - INTERVAL ? HOUR`,
    [token, SESSION_HOURS]
  );
  if (!row) return null;
  pool.query('UPDATE sessions SET last_used=NOW() WHERE token=?', [token]).catch(() => {});
  return { username: row.username, role: row.role, displayName: row.display_name, short: row.short_name };
}

/* ---------------- Page tout-en-un (compatible cPanel/Passenger) ----------------
   Certains hébergeurs cPanel interceptent les fichiers statiques (.css/.js/.png)
   et renvoient des erreurs 500. Solution : CSS, JS et logo sont INJECTÉS
   directement dans le HTML → une seule requête "/" servie par Node. */
const WEBAPP = path.join(__dirname, 'webapp');
let PAGE_CACHE = null;
function buildPage() {
  if (PAGE_CACHE) return PAGE_CACHE;
  let html = fs.readFileSync(path.join(WEBAPP, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(WEBAPP, 'style.css'), 'utf8');
  const js = fs.readFileSync(path.join(WEBAPP, 'app.js'), 'utf8');
  // Logo en base64 (version compressée si disponible)
  let logoFile = path.join(WEBAPP, 'assets', 'logo-small.png');
  if (!fs.existsSync(logoFile)) logoFile = path.join(WEBAPP, 'assets', 'logo.png');
  const logoB64 = 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64');

  // Client Socket.IO injecté aussi (certains hébergeurs bloquent tous les .js)
  let socketJs = '';
  try {
    socketJs = fs.readFileSync(
      path.join(__dirname, 'node_modules', 'socket.io', 'client-dist', 'socket.io.min.js'), 'utf8');
  } catch (e) { /* fallback : la balise script originale reste */ }

  html = html.replace('<link rel="stylesheet" href="/style.css">', '<style>\n' + css + '\n</style>');
  if (socketJs) {
    html = html.replace('<script src="/socket.io/socket.io.js"></script>', '<script>\n' + socketJs + '\n</script>');
  }
  html = html.replace('<script src="/app.js"></script>', '<script>\n' + js + '\n</script>');
  html = html.split('/assets/logo.png').join(logoB64);
  PAGE_CACHE = html;
  return html;
}
app.get('/', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(buildPage());
});
// Fallback : servir aussi les fichiers statiques normalement (si jamais ça marche)
app.use(express.static(WEBAPP));

async function requireAuth(req, res, next) {
  try {
    const token = req.headers['x-auth-token'] || req.query.token;
    const user = await getSessionUser(token);
    if (user) {
      req.session = { user, token }; // compatibilité avec les routes existantes
      return next();
    }
    res.status(401).json({ error: 'Non authentifié' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/* ---------------- Journal d'audit ---------------- */
async function addAudit(user, action, module_, details) {
  const [r] = await pool.query(
    'INSERT INTO audit_log (user_role, user_name, action, module, details) VALUES (?,?,?,?,?)',
    [user.role, user.displayName, action, module_, details]
  );
  const entry = {
    id: r.insertId, ts: new Date().toISOString(),
    user: user.role, userName: user.displayName,
    action, module: module_, details
  };
  io.emit('audit:new', entry);
  return entry;
}

/* ---------------- Authentification ---------------- */
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const u = await getUser(username);
    if (!u || !bcrypt.compareSync(password || '', u.passwordHash)) {
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
    }
    const user = { username: u.username, role: u.role, displayName: u.displayName, short: u.short };
    // Créer un jeton de session en base (indépendant par onglet)
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query('INSERT INTO sessions (token, username) VALUES (?,?)', [token, u.username]);
    // Nettoyage des sessions expirées au passage
    pool.query('DELETE FROM sessions WHERE last_used < NOW() - INTERVAL 12 HOUR').catch(() => {});
    await addAudit(user, 'CONNEXION', 'SYSTEME', `${u.displayName} s'est connecté`);
    res.json({ ok: true, user, token });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/api/logout', requireAuth, async (req, res) => {
  await addAudit(req.session.user, 'DECONNEXION', 'SYSTEME', `${req.session.user.displayName} s'est déconnecté`);
  await pool.query('DELETE FROM sessions WHERE token=?', [req.session.token]).catch(() => {});
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

/* ---------------- Confidentialité : changement de mot de passe ----------------
   Sécurité : le mot de passe ACTUEL est obligatoire pour valider le changement. */
app.post('/api/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'La confirmation ne correspond pas au nouveau mot de passe' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 8 caractères' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: "Le nouveau mot de passe doit être différent de l'actuel" });
    }

    // Vérifier le mot de passe ACTUEL (obligatoire)
    const u = await getUser(req.session.user.username);
    if (!u || !bcrypt.compareSync(currentPassword, u.passwordHash)) {
      await addAudit(req.session.user, 'MODIFICATION', 'SYSTEME',
        'Tentative de changement de mot de passe REFUSÉE (mot de passe actuel incorrect)');
      return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    }

    // Enregistrer le nouveau mot de passe (haché bcrypt)
    const newHash = bcrypt.hashSync(newPassword, 10);
    await pool.query('UPDATE users SET password_hash=?, updated_at=NOW() WHERE username=?',
      [newHash, u.username]);

    await addAudit(req.session.user, 'MODIFICATION', 'SYSTEME',
      `${req.session.user.displayName} a changé son mot de passe`);
    res.json({ ok: true, message: 'Mot de passe modifié avec succès' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/* ---------------- Présence en ligne (via base — fiable sur cPanel) ----------------
   Chaque client appelle /api/heartbeat toutes les 5 s. Un utilisateur est
   considéré « en ligne » si son dernier battement date de moins de 15 s.
   Fonctionne même quand Passenger lance plusieurs processus Node.        */
app.post('/api/heartbeat', requireAuth, async (req, res) => {
  try {
    await pool.query('UPDATE users SET last_seen=NOW() WHERE username=?', [req.session.user.username]);
    const [rows] = await pool.query(
      "SELECT role, (last_seen IS NOT NULL AND last_seen > NOW() - INTERVAL 15 SECOND) AS online FROM users"
    );
    const presence = {};
    rows.forEach(r => { presence[r.role] = !!Number(r.online); });
    res.json(presence); // ex. { PDG: true, DG: false }
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

/* ---------------- Jours fériés algériens ---------------- */
app.get('/api/holidays/:year', requireAuth, (req, res) => {
  const year = Number(req.params.year);
  if (!year || year < 1900 || year > 2200) return res.status(400).json({ error: 'Année invalide' });
  res.json(getAlgerianHolidays(year));
});

/* ---------------- Agenda / Rendez-vous ---------------- */
app.get('/api/appointments', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM appointments ORDER BY date, time');
  res.json(rows.map(mapAppt));
});

app.post('/api/appointments', requireAuth, async (req, res) => {
  try {
    const { title, date, time, type, notes, target } = req.body || {};
    if (!title || !date) return res.status(400).json({ error: 'Titre et date requis' });
    const t = type === 'memo' ? 'memo' : 'rdv';
    const tg = target === 'DG' ? 'DG' : 'PDG';
    const [r] = await pool.query(
      'INSERT INTO appointments (title, date, time, type, notes, target, created_by) VALUES (?,?,?,?,?,?,?)',
      [String(title).slice(0, 200), date, time || '', t, (notes || '').slice(0, 1000), tg, req.session.user.role]
    );
    const [[row]] = await pool.query('SELECT * FROM appointments WHERE id=?', [r.insertId]);
    const appt = mapAppt(row);
    await addAudit(req.session.user, 'CREATION', 'AGENDA',
      `${appt.type === 'memo' ? 'Mémo' : 'Rendez-vous'} « ${appt.title} » le ${appt.date}${appt.time ? ' à ' + appt.time : ''} (pour ${appt.target})`);
    io.emit('appt:created', { appt, by: req.session.user.role });
    res.json(appt);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.put('/api/appointments/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[row]] = await pool.query('SELECT * FROM appointments WHERE id=?', [id]);
    if (!row) return res.status(404).json({ error: 'Introuvable' });
    const b = req.body || {};
    const upd = {
      title: b.title !== undefined ? String(b.title).slice(0, 200) : row.title,
      date: b.date !== undefined ? b.date : row.date,
      time: b.time !== undefined ? b.time : row.time,
      type: b.type !== undefined ? (b.type === 'memo' ? 'memo' : 'rdv') : row.type,
      notes: b.notes !== undefined ? String(b.notes).slice(0, 1000) : row.notes,
      target: b.target !== undefined ? (b.target === 'DG' ? 'DG' : 'PDG') : row.target,
      done: b.done !== undefined ? (b.done ? 1 : 0) : row.done
    };
    await pool.query(
      'UPDATE appointments SET title=?, date=?, time=?, type=?, notes=?, target=?, done=?, updated_by=?, updated_at=NOW() WHERE id=?',
      [upd.title, upd.date, upd.time, upd.type, upd.notes, upd.target, upd.done, req.session.user.role, id]
    );
    const [[row2]] = await pool.query('SELECT * FROM appointments WHERE id=?', [id]);
    const appt = mapAppt(row2);
    await addAudit(req.session.user, 'MODIFICATION', 'AGENDA', `« ${appt.title} » (${appt.date}) modifié`);
    io.emit('appt:updated', { appt, by: req.session.user.role });
    res.json(appt);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.delete('/api/appointments/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[row]] = await pool.query('SELECT * FROM appointments WHERE id=?', [id]);
    if (!row) return res.status(404).json({ error: 'Introuvable' });
    await pool.query('DELETE FROM appointments WHERE id=?', [id]);
    const appt = mapAppt(row);
    await addAudit(req.session.user, 'SUPPRESSION', 'AGENDA', `« ${appt.title} » (${appt.date}) supprimé`);
    io.emit('appt:deleted', { id, appt, by: req.session.user.role });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

/* ---------------- Finances ---------------- */
app.get('/api/finances', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM finances ORDER BY date DESC, id DESC');
  res.json(rows.map(mapTx));
});

app.post('/api/finances', requireAuth, async (req, res) => {
  try {
    const { label, amount, type, date } = req.body || {};
    const amt = Number(amount);
    if (!label || !date || !isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Libellé, date et montant positif requis' });
    }
    const t = type === 'sortie' ? 'sortie' : 'entree';
    const [r] = await pool.query(
      'INSERT INTO finances (label, amount, type, date, created_by) VALUES (?,?,?,?,?)',
      [String(label).slice(0, 200), Math.round(amt * 100) / 100, t, date, req.session.user.role]
    );
    const [[row]] = await pool.query('SELECT * FROM finances WHERE id=?', [r.insertId]);
    const tx = mapTx(row);
    await addAudit(req.session.user, 'CREATION', 'FINANCES',
      `${tx.type === 'entree' ? 'Entrée' : 'Sortie'} de ${tx.amount.toLocaleString('fr-DZ')} DA — « ${tx.label} » (${tx.date})`);
    io.emit('fin:created', { tx, by: req.session.user.role });
    res.json(tx);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.put('/api/finances/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[row]] = await pool.query('SELECT * FROM finances WHERE id=?', [id]);
    if (!row) return res.status(404).json({ error: 'Introuvable' });
    const b = req.body || {};
    const upd = {
      label: b.label !== undefined ? String(b.label).slice(0, 200) : row.label,
      amount: (b.amount !== undefined && isFinite(Number(b.amount)) && Number(b.amount) > 0)
        ? Math.round(Number(b.amount) * 100) / 100 : Number(row.amount),
      type: b.type !== undefined ? (b.type === 'sortie' ? 'sortie' : 'entree') : row.type,
      date: b.date !== undefined ? b.date : row.date
    };
    await pool.query(
      'UPDATE finances SET label=?, amount=?, type=?, date=?, updated_by=?, updated_at=NOW() WHERE id=?',
      [upd.label, upd.amount, upd.type, upd.date, req.session.user.role, id]
    );
    const [[row2]] = await pool.query('SELECT * FROM finances WHERE id=?', [id]);
    const tx = mapTx(row2);
    await addAudit(req.session.user, 'MODIFICATION', 'FINANCES', `Transaction « ${tx.label} » modifiée (${tx.amount.toLocaleString('fr-DZ')} DA)`);
    io.emit('fin:updated', { tx, by: req.session.user.role });
    res.json(tx);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.delete('/api/finances/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[row]] = await pool.query('SELECT * FROM finances WHERE id=?', [id]);
    if (!row) return res.status(404).json({ error: 'Introuvable' });
    await pool.query('DELETE FROM finances WHERE id=?', [id]);
    const tx = mapTx(row);
    await addAudit(req.session.user, 'SUPPRESSION', 'FINANCES', `Transaction « ${tx.label} » (${tx.amount.toLocaleString('fr-DZ')} DA) supprimée`);
    io.emit('fin:deleted', { id, tx, by: req.session.user.role });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

/* ---------------- Journal d'audit ---------------- */
app.get('/api/audit', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300');
  res.json(rows.map(mapAudit));
});

/* ---------------- Purge automatique de l'audit (48 h) ----------------
   Supprime les entrées du journal d'audit datant de plus de 48 heures.
   Vérification toutes les heures + au démarrage.                      */
const AUDIT_RETENTION_HOURS = 48;
async function purgeOldAudit() {
  try {
    const [r] = await pool.query(
      'DELETE FROM audit_log WHERE ts < NOW() - INTERVAL ? HOUR',
      [AUDIT_RETENTION_HOURS]
    );
    if (r.affectedRows > 0) {
      console.log(`🧹 Audit purgé : ${r.affectedRows} entrée(s) de plus de ${AUDIT_RETENTION_HOURS} h supprimée(s)`);
      // informer les clients connectés pour rafraîchir leur liste
      io.emit('audit:purged', { removed: r.affectedRows });
    }
  } catch (e) {
    console.error('Erreur purge audit :', e.message);
  }
}

/* ---------------- Socket.IO : présence ----------------
   Authentification par jeton (auth.token envoyé par le client).
   NB : la présence "officielle" (points verts) passe par /api/heartbeat,
   fiable sur cPanel multi-processus ; ceci reste un bonus temps réel. */
const online = new Map();
io.on('connection', async (socket) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    const user = await getSessionUser(token);
    if (user) {
      online.set(socket.id, user.role);
      io.emit('presence', { PDG: [...online.values()].includes('PDG'), DG: [...online.values()].includes('DG') });
    }
  } catch (e) { /* ignoré */ }
  socket.on('disconnect', () => {
    online.delete(socket.id);
    io.emit('presence', { PDG: [...online.values()].includes('PDG'), DG: [...online.values()].includes('DG') });
  });
});

/* ---------------- Démarrage ---------------- */
initDB()
  .then(() => {
    // Purge de l'audit : au démarrage puis toutes les heures
    purgeOldAudit();
    setInterval(purgeOldAudit, 60 * 60 * 1000);
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ OPA Journal démarré sur http://0.0.0.0:${PORT}`);
    });
  })
  .catch((e) => {
    console.error('❌ Impossible de se connecter à MySQL :', e.message);
    console.error('Vérifiez la configuration DB_HOST / DB_USER / DB_PASS / DB_NAME');
    process.exit(1);
  });
