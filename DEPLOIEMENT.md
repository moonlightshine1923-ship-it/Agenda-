# 🚀 Guide de déploiement — OPA Journal (PDG / DG)

## ⚖️ cPanel ou serveur VPS : lequel choisir ?

| Critère | cPanel (hébergement mutualisé) | VPS (serveur dédié virtuel) |
|---|---|---|
| **WebSockets (Socket.IO)** | ⚠️ Souvent limité/instable (Passenger) | ✅ Support total |
| **Temps réel instantané** | ⚠️ Bascule parfois en "polling" (plus lent) | ✅ Parfait |
| **Processus Node.js permanent** | ⚠️ Peut être arrêté par l'hébergeur | ✅ Contrôle total (PM2) |
| **Prix** | ~2-5 €/mois | ~5-12 €/mois |
| **Difficulté** | Facile (interface graphique) | Moyenne (ligne de commande) |
| **MySQL** | ✅ Inclus | ✅ À installer soi-même |

### 🏆 Recommandation : **VPS**
Votre application repose sur **Socket.IO (temps réel)** et un **processus Node.js qui tourne 24 h/24** — exactement ce que les mutualisés cPanel gèrent mal. Pour 2 utilisateurs (PDG + DG), un petit VPS à ~5 €/mois est idéal :
- **Contabo, Hetzner, OVH, DigitalOcean** (internationaux)
- **Hébergeurs algériens** avec offre VPS si vous voulez héberger en Algérie

Le cPanel reste possible **si** votre hébergeur propose « Setup Node.js App » — guide fourni plus bas.

---

# OPTION A — Déploiement sur VPS (recommandé) ✅

Exemple avec **Ubuntu 22.04/24.04**. Connectez-vous en SSH :
```bash
ssh root@IP_DE_VOTRE_SERVEUR
```

## A.1 — Installer Node.js 20
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v    # doit afficher v20.x
```

## A.2 — Installer MySQL (ou MariaDB)
```bash
apt-get install -y mariadb-server
systemctl enable --now mariadb
mysql_secure_installation   # définir mdp root, répondre Y partout
```

Créer la base et l'utilisateur :
```bash
mysql -u root -p
```
```sql
CREATE DATABASE opa_journal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'opa'@'localhost' IDENTIFIED BY 'UN_MOT_DE_PASSE_FORT';
GRANT ALL PRIVILEGES ON opa_journal.* TO 'opa'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```
> ⚠️ En production, remplacez `opa_secret_2025` par un vrai mot de passe fort.

## A.3 — Déposer l'application
```bash
mkdir -p /var/www
cd /var/www
# Transférez le zip depuis votre PC (à lancer depuis Windows PowerShell) :
#   scp opa-journal.zip root@IP_SERVEUR:/var/www/
apt-get install -y unzip
unzip opa-journal.zip
cd opa-journal
npm install --production
```

## A.4 — Tester le démarrage
```bash
DB_PASS='UN_MOT_DE_PASSE_FORT' PORT=3000 node server.js
# → ✅ Tables MySQL prêtes  /  ✅ OPA Journal démarré
# Ctrl+C pour arrêter
```

## A.5 — PM2 : faire tourner l'app 24 h/24 (redémarrage auto)
```bash
npm install -g pm2

# Créer le fichier de config avec vos variables
cat > ecosystem.config.js <<'EOF'
module.exports = {
  apps: [{
    name: "opa-journal",
    script: "server.js",
    env: {
      PORT: 3000,
      DB_HOST: "127.0.0.1",
      DB_USER: "opa",
      DB_PASS: "UN_MOT_DE_PASSE_FORT",
      DB_NAME: "opa_journal"
    }
  }]
};
EOF

pm2 start ecosystem.config.js
pm2 save
pm2 startup     # copiez-collez la commande qu'il affiche → démarrage auto au reboot
```
Commandes utiles : `pm2 status`, `pm2 logs opa-journal`, `pm2 restart opa-journal`

## A.6 — Nginx : reverse proxy + nom de domaine
```bash
apt-get install -y nginx
cat > /etc/nginx/sites-available/opa-journal <<'EOF'
server {
    listen 80;
    server_name journal.votredomaine.dz;   # ← votre (sous-)domaine

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        # Indispensable pour Socket.IO (WebSockets) :
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
EOF
ln -s /etc/nginx/sites-available/opa-journal /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```
Chez votre registrar : créez un enregistrement **DNS A** `journal.votredomaine.dz → IP du VPS`.

## A.7 — HTTPS gratuit (Let's Encrypt)
```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d journal.votredomaine.dz
```
Renouvellement automatique inclus. Votre app est accessible en **https://journal.votredomaine.dz** 🎉

## A.8 — Pare-feu (sécurité de base)
```bash
apt-get install -y ufw
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```
> Le port 3000 n'est PAS ouvert au public : seul Nginx y accède en interne. MySQL n'écoute que sur localhost. C'est le comportement souhaité.

## A.9 — Checklist sécurité production
- [ ] Changer les mots de passe `pdg` / `dg` dans `server.js` (section `USERS`)
- [ ] Changer le `secret` de session dans `server.js` (`opa-journal-secret-2025` → chaîne aléatoire longue)
- [ ] Mot de passe MySQL fort dans `ecosystem.config.js`
- [ ] Sauvegardes : `mysqldump -u opa -p opa_journal > backup_$(date +%F).sql` (à mettre en cron quotidien)

---

# OPTION B — Déploiement sur cPanel (si pas de VPS)

⚠️ **Prérequis obligatoire** : votre hébergeur doit proposer l'icône **« Setup Node.js App »** (CloudLinux). Sans elle, le déploiement Node.js est **impossible** sur cPanel — contactez votre hébergeur pour vérifier avant d'acheter.

## B.1 — Créer la base MySQL
1. cPanel → **Bases de données MySQL®**
2. Créer la base : ex. `moncompte_opa_journal`
3. Créer l'utilisateur : ex. `moncompte_opa` + mot de passe fort
4. **Ajouter l'utilisateur à la base** en cochant **TOUS LES PRIVILÈGES**
5. Notez les 3 valeurs (elles sont préfixées par votre nom de compte cPanel)

## B.2 — Téléverser l'application
1. cPanel → **Gestionnaire de fichiers**
2. Créez un dossier **hors de public_html** : ex. `/home/moncompte/opa-journal`
3. Téléversez `opa-journal.zip` dedans → clic droit → **Extract**
4. Si le contenu est extrait dans un sous-dossier `opa-journal/opa-journal`, déplacez les fichiers un niveau au-dessus

## B.3 — Créer l'application Node.js
1. cPanel → **Setup Node.js App** → **Create Application**
2. Remplissez :
   - **Node.js version** : 18 ou 20 (la plus récente proposée)
   - **Application mode** : Production
   - **Application root** : `opa-journal`
   - **Application URL** : votre domaine ou sous-domaine (ex. `journal.votredomaine.dz`)
   - **Application startup file** : `server.js`
3. **Create**

## B.4 — Variables d'environnement
Dans la page de l'application → section **Environment Variables** → ajoutez :
| Nom | Valeur |
|---|---|
| `DB_HOST` | `localhost` |
| `DB_USER` | `moncompte_opa` |
| `DB_PASS` | votre mot de passe MySQL |
| `DB_NAME` | `moncompte_opa_journal` |

(ne définissez PAS `PORT` : Passenger le gère automatiquement)

## B.5 — Installer les dépendances et démarrer
1. Toujours dans Setup Node.js App → bouton **Run NPM Install**
2. Puis **Restart App**
3. Visitez votre URL → la page de connexion OPA doit s'afficher

## B.6 — Limitation importante : WebSockets
Sur beaucoup d'hébergements cPanel, **les WebSockets ne passent pas** (Passenger/LiteSpeed les bloque). Socket.IO bascule alors automatiquement en **« long polling »** : l'app fonctionne, le temps réel marche, mais avec 1-3 secondes de latence au lieu d'être instantané.

Si le temps réel ne fonctionne pas du tout, forcez le polling côté client — dans `public/app.js`, remplacez :
```js
socket = io();
```
par :
```js
socket = io({ transports: ['polling'] });
```

## B.7 — Dépannage cPanel
| Problème | Solution |
|---|---|
| Erreur 503 / app ne démarre pas | Vérifiez les logs : dossier `opa-journal/stderr.log` ou bouton logs dans Setup Node.js App |
| `Access denied for user` | Revérifiez DB_USER/DB_PASS/DB_NAME (avec les préfixes cPanel !) puis Restart App |
| Page blanche | Vérifiez que Application startup file = `server.js` et que `npm install` a bien été exécuté |
| Pas de temps réel | Voir B.6 (polling) |
| App s'arrête toute seule | Mode "Production" + certains hébergeurs tuent les process inactifs → passez au VPS |

---

# 📋 Récapitulatif

| Vous voulez... | Choisissez |
|---|---|
| Le vrai temps réel instantané, fiabilité 24/7 | **VPS + PM2 + Nginx + SSL** (Option A) |
| La simplicité maximale et vous avez déjà un cPanel avec Node.js | cPanel (Option B), en acceptant la latence éventuelle |

Dans les deux cas, avant la mise en production :
1. 🔑 Changez les mots de passe `pdg`/`dg` (dans `server.js`, section `USERS`)
2. 🔑 Changez le secret de session
3. 🔑 Mot de passe MySQL fort
4. 💾 Mettez en place une sauvegarde quotidienne de la base
