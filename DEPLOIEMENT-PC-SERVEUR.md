# 🖥 Guide de déploiement — PC Serveur local (Windows)

Déploiement de **OPA Journal** sur un PC serveur physique (HDD) dans les locaux de l'organisation.
Le PDG et le DG accèdent à l'application depuis leurs PC/tablettes/téléphones **via le réseau local** (Wi-Fi ou câble), et en option depuis l'extérieur via Internet.

> 💡 Un HDD suffit largement : l'app est très légère (quelques Mo de données par an pour 2 utilisateurs).

---

## ÉTAPE 1 — Installer Node.js

1. Téléchargez **Node.js 20 LTS** : https://nodejs.org/fr (bouton vert « LTS »)
2. Installez en cliquant Suivant partout (laissez les options par défaut)
3. Vérifiez dans PowerShell :
```powershell
node -v     # doit afficher v20.x ou v22.x
npm -v
```

---

## ÉTAPE 2 — Installer MySQL

**Option recommandée : XAMPP** (le plus simple sous Windows)
1. Téléchargez XAMPP : https://www.apachefriends.org/fr/
2. Installez-le (vous pouvez décocher tout sauf **MySQL** et **phpMyAdmin**)
3. Ouvrez le **XAMPP Control Panel** → bouton **Start** à côté de MySQL
4. Cliquez **Config → my.ini** n'est pas nécessaire — laissez par défaut

**Créer la base et l'utilisateur :**
1. Dans XAMPP Control Panel → bouton **Shell** (ou ouvrez PowerShell)
2. Tapez :
```powershell
C:\xampp\mysql\bin\mysql.exe -u root
```
(par défaut root n'a pas de mot de passe sous XAMPP)

3. Collez :
```sql
CREATE DATABASE IF NOT EXISTS opa_journal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'opa'@'localhost' IDENTIFIED BY 'opa_secret_2025';
CREATE USER IF NOT EXISTS 'opa'@'127.0.0.1' IDENTIFIED BY 'opa_secret_2025';
GRANT ALL PRIVILEGES ON opa_journal.* TO 'opa'@'localhost';
GRANT ALL PRIVILEGES ON opa_journal.* TO 'opa'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

**⚙️ Démarrage automatique de MySQL au boot du PC :**
Dans XAMPP Control Panel → colonne **Service** → cochez la croix rouge à côté de MySQL → il devient un service Windows qui démarre tout seul.

---

## ÉTAPE 3 — Installer l'application

1. Décompressez `opa-journal.zip` dans un dossier stable, ex. :
   `C:\opa-journal`
2. Dans PowerShell :
```powershell
cd C:\opa-journal
npm install
```
3. Test de démarrage :
```powershell
npm start
```
Vous devez voir :
```
✅ Tables MySQL prêtes (base: opa_journal)
✅ OPA Journal démarré sur http://0.0.0.0:3000
```
4. Sur le PC serveur, ouvrez http://localhost:3000 → page de connexion OPA ✔
5. Arrêtez avec `Ctrl+C` (on va maintenant le lancer en service permanent)

---

## ÉTAPE 4 — Lancer l'app en permanence (PM2)

Pour que l'app tourne 24 h/24, survive aux plantages et redémarre avec Windows :

```powershell
npm install -g pm2
npm install -g pm2-windows-startup

cd C:\opa-journal
pm2 start server.js --name opa-journal
pm2 save

# Démarrage automatique avec Windows :
pm2-startup install
pm2 save
```

**Commandes utiles :**
| Commande | Effet |
|---|---|
| `pm2 status` | Voir si l'app tourne |
| `pm2 logs opa-journal` | Voir les logs en direct |
| `pm2 restart opa-journal` | Redémarrer l'app |
| `pm2 stop opa-journal` | Arrêter l'app |

> Alternative si PM2 pose problème sous Windows : **NSSM** (https://nssm.cc) qui transforme
> `node server.js` en vrai service Windows : `nssm install OpaJournal "C:\Program Files\nodejs\node.exe" "C:\opa-journal\server.js"`

---

## ÉTAPE 5 — Accès depuis les autres appareils (réseau local)

### 5.1 Trouver l'adresse IP du PC serveur
```powershell
ipconfig
```
Cherchez « Adresse IPv4 » — ex. `192.168.1.50`

### 5.2 Fixer cette IP (important !)
Pour que l'adresse ne change jamais :
- **Méthode routeur (recommandée)** : interface du routeur → DHCP → « Réservation d'adresse » → associez l'adresse MAC du PC serveur à une IP fixe (ex. 192.168.1.50)
- **Ou méthode Windows** : Paramètres → Réseau → Modifier les options d'adaptateur → clic droit sur la carte → Propriétés → IPv4 → « Utiliser l'adresse IP suivante »

### 5.3 Ouvrir le port 3000 dans le pare-feu Windows
PowerShell **en administrateur** :
```powershell
New-NetFirewallRule -DisplayName "OPA Journal" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

### 5.4 C'est prêt !
Depuis n'importe quel appareil du même réseau (PC du PDG, téléphone du DG…) :
```
http://192.168.1.50:3000
```
> 💡 Créez un raccourci/favori sur les appareils du PDG et du DG.
> Sur téléphone : Chrome → menu ⋮ → « Ajouter à l'écran d'accueil » → l'app s'ouvre comme une vraie application.

---

## ÉTAPE 6 (OPTIONNELLE) — Accès depuis l'extérieur (Internet)

⚠️ **Uniquement si nécessaire** (déplacements). Sur le réseau local, sautez cette étape.

### Option 1 : Redirection de port sur le routeur (simple)
1. Interface du routeur → « NAT » ou « Port Forwarding »
2. Redirigez le port externe **3000** → IP interne `192.168.1.50` port **3000**
3. Trouvez votre IP publique : https://mon-ip.com
4. Accès extérieur : `http://VOTRE_IP_PUBLIQUE:3000`
5. Si votre IP publique change (souvent le cas en Algérie), utilisez un **DDNS gratuit** (No-IP, DuckDNS) — la plupart des routeurs ont une section DDNS intégrée → vous obtenez une adresse type `opa-journal.ddns.net`

> ⚠️ Sécurité : dans ce cas, changez ABSOLUMENT les mots de passe par défaut (voir Étape 7) car l'app devient accessible depuis Internet.

### Option 2 : Tunnel sécurisé sans toucher au routeur (plus sûr)
**Cloudflare Tunnel** (gratuit) ou **Tailscale** (VPN privé gratuit jusqu'à 3 utilisateurs — idéal pour PDG + DG) :
- Tailscale : installez-le sur le PC serveur + les appareils du PDG/DG → ils voient le serveur comme s'ils étaient au bureau, chiffré de bout en bout, aucune ouverture de port. **C'est l'option la plus sécurisée.**

---

## ÉTAPE 7 — Sécurisation (à faire avant utilisation réelle)

### 7.1 Changer les mots de passe PDG / DG
Ouvrez `C:\opa-journal\server.js`, section `USERS` (~ligne 95) :
```js
passwordHash: bcrypt.hashSync('opa2025', 10),
```
Remplacez `'opa2025'` par le nouveau mot de passe de chaque compte, puis :
```powershell
pm2 restart opa-journal
```

### 7.2 Changer le secret de session
Toujours dans `server.js` :
```js
secret: 'opa-journal-secret-2025',
```
→ remplacez par une longue chaîne aléatoire quelconque.

### 7.3 Mot de passe MySQL (si le PC est partagé)
```sql
ALTER USER 'opa'@'localhost' IDENTIFIED BY 'NouveauMotDePasseFort';
```
puis mettez à jour la connexion : soit dans `server.js` (valeur par défaut de `DB_PASS`), soit relancez PM2 avec la variable :
```powershell
pm2 delete opa-journal
$env:DB_PASS="NouveauMotDePasseFort"
pm2 start server.js --name opa-journal
pm2 save
```

---

## ÉTAPE 8 — Sauvegardes automatiques (HDD → protégez vos données !)

Créez `C:\opa-journal\backup.bat` :
```bat
@echo off
set DATEJOUR=%date:~-4%-%date:~3,2%-%date:~0,2%
C:\xampp\mysql\bin\mysqldump.exe -u opa -popa_secret_2025 opa_journal > "C:\opa-backups\opa_journal_%DATEJOUR%.sql"
forfiles /p "C:\opa-backups" /m *.sql /d -30 /c "cmd /c del @path" 2>nul
```
(garde 30 jours de sauvegardes)

Puis créez le dossier `C:\opa-backups` et planifiez :
1. **Planificateur de tâches** Windows → Créer une tâche de base
2. Nom : « Sauvegarde OPA Journal » — Déclencheur : **Tous les jours à 20h00**
3. Action : Démarrer un programme → `C:\opa-journal\backup.bat`

> 💡 Idéalement, copiez aussi régulièrement `C:\opa-backups` sur une clé USB ou un autre disque (un HDD peut lâcher).

**Restaurer une sauvegarde :**
```powershell
C:\xampp\mysql\bin\mysql.exe -u opa -popa_secret_2025 opa_journal < C:\opa-backups\opa_journal_2026-08-23.sql
```

---

## ✅ Checklist finale

- [ ] Node.js installé
- [ ] MySQL (XAMPP) installé + démarrage en service automatique
- [ ] Base `opa_journal` + utilisateur `opa` créés
- [ ] App dans `C:\opa-journal` + `npm install` fait
- [ ] PM2 lancé + `pm2 save` + `pm2-startup install` (survit au redémarrage)
- [ ] IP fixe attribuée au PC serveur
- [ ] Port 3000 ouvert dans le pare-feu Windows
- [ ] Testé depuis le PC du PDG et le téléphone du DG : `http://IP_DU_SERVEUR:3000`
- [ ] Mots de passe pdg/dg changés
- [ ] Sauvegarde quotidienne planifiée
- [ ] (Option) Tailscale/DDNS pour l'accès à distance

## 🔧 Dépannage rapide

| Problème | Solution |
|---|---|
| `ERR_CONNECTION_REFUSED` depuis un autre PC | Pare-feu (étape 5.3) ou app arrêtée (`pm2 status`) |
| `Access denied for user 'opa'` | Refaites les commandes SQL de l'étape 2 |
| L'app s'arrête quand on ferme PowerShell | Vous avez lancé `npm start` au lieu de PM2 (étape 4) |
| L'app ne redémarre pas après reboot du PC | `pm2-startup install` puis `pm2 save` ; MySQL en service (étape 2) |
| Lent depuis le téléphone | Vérifiez que le téléphone est sur le Wi-Fi du bureau, pas en 4G |
| Le PC serveur se met en veille | Paramètres → Alimentation → Mise en veille : **Jamais** ⚠️ Important ! |
