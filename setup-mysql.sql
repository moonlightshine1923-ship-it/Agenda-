-- =========================================================
-- OPA Journal — Script d'installation MySQL / MariaDB
-- Exécuter en tant que root :  mysql -u root -p < setup-mysql.sql
-- =========================================================
CREATE DATABASE IF NOT EXISTS opa_journal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'opa'@'localhost' IDENTIFIED BY 'opa_secret_2025';
CREATE USER IF NOT EXISTS 'opa'@'127.0.0.1' IDENTIFIED BY 'opa_secret_2025';

GRANT ALL PRIVILEGES ON opa_journal.* TO 'opa'@'localhost';
GRANT ALL PRIVILEGES ON opa_journal.* TO 'opa'@'127.0.0.1';
FLUSH PRIVILEGES;

-- Les tables (appointments, finances, audit_log) sont créées
-- automatiquement par l'application au premier démarrage.
