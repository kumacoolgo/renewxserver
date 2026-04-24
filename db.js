const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || '/data/accounts.db';

let db;

function getDb() {
  if (!db) {
    const dbDir = path.dirname(DB_PATH);
    if (dbDir && dbDir !== '/') {
      require('fs').mkdirSync(dbDir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS check_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        account_id INTEGER,
        expiry_date TEXT,
        days_left INTEGER,
        checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
  return db;
}

function addAccount(userId, username, password) {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO accounts (user_id, username, password) VALUES (?, ?, ?)');
  return stmt.run(userId, username, password);
}

function getAccounts(userId) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM accounts WHERE user_id = ?');
  return stmt.all(userId);
}

function deleteAccount(userId, accountId) {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?');
  return stmt.run(accountId, userId);
}

function logCheck(userId, accountId, expiryDate, daysLeft) {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO check_log (user_id, account_id, expiry_date, days_left) VALUES (?, ?, ?, ?)');
  return stmt.run(userId, accountId, expiryDate, daysLeft);
}

module.exports = { getDb, addAccount, getAccounts, deleteAccount, logCheck };
