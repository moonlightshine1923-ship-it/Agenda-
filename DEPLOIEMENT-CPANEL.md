# 🌐 Guide de déploiement cPanel — OPA Journal
### Accessible partout : PC, tablette, téléphone (4G/Wi-Fi), avec HTTPS

---

## ⚠️ AVANT D'ACHETER / DE COMMENCER : vérification indispensable

Votre hébergement cPanel **DOIT** avoir l'icône **« Setup Node.js App »** (ou « Application Node.js »).

➡️ Connectez-vous à votre cPanel et cherchez « node » dans la barre de recherche.

- ✅ **L'icône existe** → suivez ce guide, tout fonctionnera.
- ❌ **Pas d'icône** → l'hébergement ne supporte PAS Node.js. Contactez le support et demandez :
  *« Proposez-vous le support des applications Node.js (CloudLinux + Setup Node.js App) et les WebSockets ? »*
  Sinon, changez d'offre/hébergeur (la plupart des hébergeurs algériens et internationaux le proposent sur leurs offres récentes).

**Questions à poser à l'hébergeur (idéalement avant de payer) :**
1. Node.js version 18 ou 20 disponible ? ✅ requis
2. MySQL inclus ? ✅ requis (toujours le cas)
3. WebSockets supportés ? (souhaitable ; sinon l'app fonctionne quand même, voir §8)
4. Les processus Node.js tournent-ils en continu ? ✅ souhaitable

---

## ÉTAPE 1 — Créer la base de données MySQL

1. cPanel → **« Bases de données MySQL® »** (MySQL® Databases)
2. **Créer une nouvelle base** :
   - Nom : `opa_journal` → cPanel la préfixe automatiquement : `moncompte_opa_journal`
   - 📝 **Notez le nom complet avec le préfixe**
3. Section **« Utilisateurs MySQL »** → Créer un utilisateur :
   - Nom : `opa` → devient `moncompte_opa`
   - Mot de passe : cliquez « Générateur de mot de passe » → 📝 **notez-le**
4. Section **« Ajouter un utilisateur à la base de données »** :
   - Choisissez l'utilisateur `moncompte_opa` + la base `moncompte_opa_journal` → **Ajouter**
   - Cochez **☑ TOUS LES PRIVILÈGES** (ALL PRIVILEGES) → **Apporter les modifications**

📝 À la fin vous devez avoir noté 3 choses :
| Élément | Exemple |
|---|---|
| Nom de la base | `moncompte_opa_journal` |
| Utilisateur | `moncompte_opa` |
| Mot de passe | `Xk7#mP2vQ9zL` |

---

## ÉTAPE 2 — Téléverser l'application

1. cPanel → **« Gestionnaire de fichiers »** (File Manager)
2. Placez-vous dans votre **racine home** : `/home/moncompte/` (⚠️ PAS dans `public_html` — c'est plus sécurisé, personne ne peut télécharger votre code)
3. Bouton **« + Dossier »** → créez `opa-journal`
4. Entrez dans le dossier → **« Téléverser »** (Upload) → envoyez `opa-journal.zip`
5. De retour dans le gestionnaire : clic droit sur le zip → **« Extract »**
6. ⚠️ Si l'extraction a créé un sous-dossier (`/home/moncompte/opa-journal/opa-journal/`), sélectionnez tout le contenu du sous-dossier → **« Move »** → déplacez-le vers `/home/moncompte/opa-journal/` puis supprimez le dossier vide et le zip
7. Vérifiez que vous avez bien cette structure :
```
/home/moncompte/opa-journal/
├── server.js
├── holidays-dz.js
├── package.json
└── public/
    ├── index.html
    ├── app.js
    ├── style.css
    └── assets/logo.png
```

---

## ÉTAPE 3 — (Recommandé) Sous-domaine dédié

Pour une adresse propre du type `journal.votredomaine.dz` :

1. cPanel → **« Domaines »** ou **« Sous-domaines »**
2. Créez : `journal` . `votredomaine.dz`
3. Le « Document Root » proposé n'a pas d'importance (Node.js prendra le dessus)

*(Vous pouvez aussi utiliser le domaine principal directement.)*

---

## ÉTAPE 4 — Créer l'application Node.js

1. cPanel → **« Setup Node.js App »** → **CREATE APPLICATION**
2. Remplissez :

| Champ | Valeur |
|---|---|
| **Node.js version** | 20.x (ou la plus récente proposée, min 18) |
| **Application mode** | **Production** |
| **Application root** | `opa-journal` |
| **Application URL** | `journal.votredomaine.dz` (ou votre domaine) |
| **Application startup file** | `server.js` |
| **Passenger log file** | (laisser par défaut) |

3. Cliquez **CREATE**

---

## ÉTAPE 5 — Variables d'environnement (connexion MySQL)

Toujours dans la page de votre application Node.js, section **« Environment variables »** → **ADD VARIABLE**, ajoutez ces 4 variables avec **VOS** valeurs de l'étape 1 :

| Name | Value |
|---|---|
| `DB_HOST` | `localhost` |
| `DB_USER` | `moncompte_opa` |
| `DB_PASS` | `Xk7#mP2vQ9zL` (votre mot de passe) |
| `DB_NAME` | `moncompte_opa_journal` |

⚠️ **Ne définissez PAS de variable `PORT`** — cPanel/Passenger l'attribue automatiquement et l'app la lit toute seule.

Cliquez **SAVE**.

---

## ÉTAPE 6 — Installer les dépendances et démarrer

1. Dans la même page → bouton **« Run NPM Install »** (attendez le ✔ vert, 1-2 min)
2. Bouton **« RESTART »** (ou Stop puis Start)
3. Ouvrez votre URL : `https://journal.votredomaine.dz`
   → La page de connexion OPA avec le logo doit s'afficher 🎉
4. Connectez-vous avec `pdg` / `opa2025` et vérifiez :
   - L'agenda s'affiche
   - Ajoutez un RDV test
   - Ouvrez l'onglet Finances, ajoutez une transaction test
   - Onglet Journal d'audit : vos actions apparaissent

---

## ÉTAPE 7 — HTTPS (cadenas 🔒)

La plupart des cPanel incluent **AutoSSL / Let's Encrypt** :
1. cPanel → **« SSL/TLS Status »**
2. Vérifiez que votre (sous-)domaine a un ✅ vert — sinon bouton **« Run AutoSSL »**
3. Testez `https://journal.votredomaine.dz`

> HTTPS est important : vos mots de passe et données financières transitent chiffrés, y compris sur téléphone en 4G.

---

## ÉTAPE 8 — Vérifier le temps réel (Socket.IO)

L'app utilise Socket.IO qui essaie d'abord le « polling » puis bascule en WebSocket. Sur cPanel :

**Test à 2 :** ouvrez l'app sur 2 appareils (PC en `pdg`, téléphone en `dg`). Ajoutez un RDV côté DG :
- ✅ Il apparaît côté PDG en moins de 3 secondes (+ son) → tout est bon, rien à faire
- ❌ Rien ne s'affiche sans recharger la page → forcez le mode polling :

Ouvrez `public/app.js` (Gestionnaire de fichiers → Edit), cherchez la ligne :
```js
socket = io();
```
remplacez par :
```js
socket = io({ transports: ['polling'] });
```
Sauvegardez → **RESTART** dans Setup Node.js App. Le temps réel fonctionnera avec 1-2 s de latence (imperceptible à l'usage).

---

## ÉTAPE 9 — Sécurisation OBLIGATOIRE (app exposée sur Internet !)

Votre application est maintenant accessible du monde entier. Faites ceci **immédiatement** :

### 9.1 Changer les mots de passe PDG et DG
✅ **Directement dans l'application** (aucun fichier à modifier) :
1. Connectez-vous avec `pdg` / `opa2025`
2. Onglet **🔒 Confidentialité** → saisissez le mot de passe actuel + le nouveau (min. 8 caractères, fort)
3. Faites de même avec le compte `dg`
> Les mots de passe sont stockés hachés (bcrypt) dans la table `users` de MySQL.

### 9.2 Changer le secret de session
Dans le même fichier :
```js
secret: 'opa-journal-secret-2025',
```
→ remplacez par une longue chaîne aléatoire, ex. `'Opa!9377#JournalSecret$2026&xKm27pQ'`

### 9.3 Redémarrer
Setup Node.js App → **RESTART**.

---

## ÉTAPE 10 — Accès sur téléphone comme une vraie app 📱

Sur le téléphone du PDG et du DG :
1. Ouvrez `https://journal.votredomaine.dz` dans Chrome (Android) ou Safari (iPhone)
2. Connectez-vous
3. Menu ⋮ (Android) → **« Ajouter à l'écran d'accueil »** / bouton Partager (iPhone) → **« Sur l'écran d'accueil »**
4. Une icône OPA apparaît → l'app s'ouvre en plein écran comme une application native

> 🔔 Le son de notification fonctionne tant que l'app est ouverte à l'écran.

---

## ÉTAPE 11 — Sauvegardes

1. cPanel → **phpMyAdmin** → sélectionnez la base `moncompte_opa_journal`
2. Onglet **« Exporter »** → Format SQL → **Exécuter** → fichier `.sql` téléchargé
3. À faire 1 fois par semaine (ou activez les sauvegardes automatiques de votre hébergeur — cPanel → « Sauvegarde »)

**Restauration :** phpMyAdmin → base → onglet « Importer » → choisir le fichier .sql

---

## 🔧 Dépannage cPanel

| Problème | Cause / Solution |
|---|---|
| **Erreur 503 Service Unavailable** | L'app n'a pas démarré. Setup Node.js App → vérifiez qu'elle est « started ». Consultez le log : fichier `stderr.log` dans le dossier de l'app |
| **« Access denied for user »** dans le log | DB_USER / DB_PASS / DB_NAME incorrects — vérifiez les **préfixes cPanel** (étape 5) puis RESTART |
| **« Cannot find module 'express' »** | « Run NPM Install » n'a pas été fait ou a échoué → relancez-le |
| **Page blanche / 404** | Application URL mal configurée, ou fichiers dans un sous-dossier (étape 2.6) |
| **Le temps réel ne marche pas** | Étape 8 (mode polling) |
| **L'app s'arrête après quelques heures** | Certains mutualisés tuent les process inactifs. Solution : cPanel → « Tâches Cron » → ajoutez une tâche toutes les 5 min : `curl -s https://journal.votredomaine.dz/ > /dev/null` (maintient l'app éveillée) |
| **Changements de code sans effet** | Toujours cliquer **RESTART** après modification d'un fichier |
| **Erreur au RESTART après édition** | Erreur de syntaxe dans le fichier modifié — vérifiez le log stderr.log |

---

## ✅ Checklist finale

- [ ] « Setup Node.js App » disponible chez l'hébergeur
- [ ] Base + utilisateur MySQL créés (avec préfixes notés)
- [ ] Fichiers dans `/home/moncompte/opa-journal` (hors public_html)
- [ ] Application Node.js créée (startup file : `server.js`, mode Production)
- [ ] 4 variables d'environnement DB_* renseignées
- [ ] Run NPM Install ✔ puis RESTART
- [ ] Page de connexion accessible sur l'URL
- [ ] HTTPS actif (cadenas 🔒)
- [ ] Test temps réel à 2 appareils (étape 8)
- [ ] 🔑 Mots de passe pdg/dg changés + secret de session changé
- [ ] Icône ajoutée sur l'écran d'accueil des téléphones PDG et DG
- [ ] Sauvegarde phpMyAdmin testée une fois
