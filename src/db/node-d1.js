// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Local stand-in for Cloudflare D1, built on Node's own SQLite (node:sqlite).
// It mirrors the slice of the D1 API the app uses — prepare/bind/first/all/run
// and atomic batch — and is just as strict about parameter types, so code that
// runs here runs on D1 unchanged. Used by the local server and the tests only;
// it is never part of the Cloudflare bundle.

let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  throw new Error(
    `Node.js ${process.versions.node} cannot run this app locally: it needs the built-in SQLite module (node:sqlite), ` +
      'which works without flags from Node.js 22.13.0. Install Node.js 22.13.0 or newer (an LTS release from nodejs.org).',
  );
}

function checkParams(params) {
  for (const p of params) {
    if (p === undefined) throw new TypeError("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
    if (typeof p === 'boolean') throw new TypeError('D1 shim: bind booleans as 0 or 1');
    if (typeof p === 'object' && p !== null && !(p instanceof Uint8Array)) {
      throw new TypeError('D1 shim: objects cannot be bound; serialize them first');
    }
  }
}

const plain = (row) => (row ? { ...row } : row);
const returnsRows = (sql) => /\breturning\b/i.test(sql) || /^\s*(select|with|pragma)\b/i.test(sql);

// Numbered placeholders (?1, ?2) bind differently across Node versions; the app uses plain "?" only.
function checkSql(sql) {
  if (/\?\d/.test(sql.replace(/'[^']*'/g, ''))) {
    throw new Error('D1 shim: use plain "?" placeholders, not numbered ones like ?1');
  }
  return sql;
}

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    checkParams(params);
    return new Statement(this.db, this.sql, params);
  }

  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.params);
    if (row === undefined) return null;
    const obj = plain(row);
    if (column === undefined) return obj;
    if (!(column in obj)) throw new Error(`D1_COLUMN_NOTFOUND: ${column}`);
    return obj[column];
  }

  async all() {
    const results = this.db.prepare(this.sql).all(...this.params).map(plain);
    return { success: true, results, meta: { rows_read: results.length } };
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    const st = this.db.prepare(this.sql);
    if (returnsRows(this.sql)) {
      const results = st.all(...this.params).map(plain);
      return { success: true, results, meta: { changes: results.length } };
    }
    const info = st.run(...this.params);
    return {
      success: true,
      results: [],
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
    };
  }
}

export function createD1(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON;');
  if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  return {
    prepare(sql) {
      return new Statement(db, checkSql(sql));
    },
    /** Atomic, like D1: every statement commits or none does. */
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => s.runSync());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql) {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
    close() {
      db.close();
    },
  };
}
