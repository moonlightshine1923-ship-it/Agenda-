# 📒 OPA — Journal Exécutif PDG / DG

Application de journal partagé en **temps réel** entre le Président (PDG) et le Directeur Général (DG) de l'Organisation du Patronat Algérien.

## 🔐 Identifiants de connexion

| Rôle | Identifiant | Mot de passe |
|------|-------------|--------------|
| Président (PDG) | `pdg` | `opa2025` |
| Directeur Général (DG) | `dg` | `opa2025` |

> Mots de passe hachés avec **bcrypt** — à modifier dans la section `USERS` de `server.js`.

## 🗄 Base de données MySQL

L'application utilise **MySQL / MariaDB**.

### Installation
```bash
# 1. Créer la base et l'utilisateur (une seule fois)
mysql -u root -p < setup-mysql.sql

# 2. Installer les dépendances et lancer
npm install
npm start        # → http://localhost:3000
```
Les tables (`appointments`, `finances`, `audit_log`) sont **créées automatiquement** au premier démarrage.

## ✨ Fonctionnalités

### 1. Architecture & Authentification
- Deux comptes distincts (PDG / DG), sessions sécurisées (12 h).
- Interface aux couleurs OPA (noir & or), logo en évidence, 100 % responsive.

### 2. Agenda partagé en temps réel
- Vue du jour dès la connexion, RDV et mémos classés par heure.
- Écriture croisée DG ↔ PDG, synchronisation instantanée via **WebSockets (Socket.IO)**.
- Indicateur de présence en ligne.

### 3. Calendrier avec jours fériés algériens 🇩🇿
- Calendrier mensuel en **carreaux de journées**, navigation mois par mois (toutes les années).
- **Jours fériés colorés en or** : fêtes civiles (Nouvel an, Yennayer, 1er Mai, 5 Juillet, 1er Novembre) et fêtes religieuses (Aïd el-Fitr, Aïd el-Adha, Awal Mouharram, Achoura, Mawlid) calculées via le calendrier hégirien.
- Week-ends algériens (vendredi/samedi) grisés, jour actuel encadré, RDV affichés dans les cases.
- Clic sur une case → création directe d'un rendez-vous à cette date.
- ⚠️ Les fêtes religieuses dépendent de l'observation de la lune : précision ±1 jour.

### 4. Notifications sonores
- Son discret + badge rouge compteur + panneau de notifications + toast.

### 5. Module financier
- Saisie partagée : montant, libellé, type (Entrée/Sortie), date.
- Tableaux de bord automatiques Jour / Mois / Année, mis à jour en temps réel.

### 6. Journal d'audit
- Traçabilité complète en base MySQL : connexions, créations, modifications, suppressions.

## 🧱 Pile technique
Node.js · Express · Socket.IO · MySQL (mysql2) · express-session · bcryptjs · HTML/CSS/JS vanilla
