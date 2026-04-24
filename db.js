const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || '/data/accounts.db';

const dbDir = path.dirname(DB_PATH);
if (dbDir && dbDir !== '/') {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS check_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      account_id INTEGER,
      expiry_date TEXT,
      days_left INTEGER,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function addAccount(userId, username, password) {
  return run(
    'INSERT INTO accounts (user_id, username, password) VALUES (?, ?, ?)',
    [userId, username, password]
  );
}

async function getAccounts(userId) {
  return all('SELECT * FROM accounts WHERE user_id = ?', [userId]);
}

async function deleteAccount(userId, accountId) {
  return run('DELETE FROM accounts WHERE id = ? AND user_id = ?', [accountId, userId]);
}

async function logCheck(userId, accountId, expiryDate, daysLeft) {
  return run(
    'INSERT INTO check_log (user_id, account_id, expiry_date, days_left) VALUES (?, ?, ?, ?)',
    [userId, accountId, expiryDate, daysLeft]
  );
}

module.exports = { addAccount, getAccounts, deleteAccount, logCheck };
