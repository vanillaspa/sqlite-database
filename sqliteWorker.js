/**
 * @fileoverview SQLite-WASM dedicated worker — one instance per named database.
 *
 * Receives messages from the main thread via a transferred `MessagePort`
 * (`ports[0]`). Each message carries an `action` string and action-specific
 * fields. The worker replies on the same port and closes it, so each
 * message/reply pair is one-shot.
 *
 * **Reply format:**
 * - Success: `{ type: 'application/json', result: <any> }`
 * - Error:   `{ type: 'error', message: <string> }`
 *
 * The `sqlite3` singleton is initialised lazily on the first action that
 * needs it. `db` holds the currently open database connection.
 *
 * @module sqliteWorker
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

/** @type {import('@sqlite.org/sqlite-wasm').Database|null} Currently open DB connection. */
let db = null;

/** @type {import('@sqlite.org/sqlite-wasm').Sqlite3Static|null} sqlite-wasm singleton. */
let sqlite3 = null;

/**
 * Return the sqlite-wasm singleton, initialising it on first call.
 *
 * @returns {Promise<import('@sqlite.org/sqlite-wasm').Sqlite3Static>}
 */
async function getInstance() {
  if (!sqlite3) {
    sqlite3 = await sqlite3InitModule({ print: console.log, printErr: console.error });
  }
  return sqlite3;
}

/**
 * Send a success reply and close the port.
 *
 * @param {MessagePort} port
 * @param {any} result
 */
function reply(port, result) { // TODO: check json coverage
  port.postMessage({ type: 'application/json', result });
  port.close();
}

/**
 * Send an error reply and close the port.
 *
 * @param {MessagePort} port
 * @param {string} message
 */
function replyError(port, message) {
  port.postMessage({ type: 'error', message });
  port.close();
}

/**
 * Classify a SQLite error, log it, and send an error reply.
 *
 * @param {MessagePort} port
 * @param {string} sql - The SQL that caused the error (for logging).
 * @param {Error} e
 */
function handleSQLiteError(port, sql, e) {
  if (e.message.includes('SQLITE_CANTOPEN')) {
    console.info("Info: No SQLite database available. Upload a new database or reload the page.");
  } else if (e.message.includes('SQLITE_CONSTRAINT_UNIQUE')) {
    console.error('Unique constraint violation:', sql, e.message);
  } else {
    console.error("Error executing SQL_", sql, e.message);
  }
  replyError(port, e.message);
}

/**
 * Main message handler.
 *
 * Supported actions:
 * - `createDB`        — open/create a named OPFS database
 * - `closeDB`         — close the current DB connection
 * - `downloadDB`      — export DB bytes as a `Blob`
 * - `executeQuery`    — run a raw SQL string, returns positional row arrays
 * - `prepareStatement`— run a parameterised statement, returns column-keyed row objects
 * - `uploadDB`        — import an `ArrayBuffer` as a new OPFS database
 *
 * @param {MessageEvent} event
 * @param {object} event.data - Message payload.
 * @param {string} event.data.action - The action to perform.
 * @param {MessagePort[]} event.ports - `ports[0]` is the reply port.
 */
onmessage = async function ({ data, ports }) {
  const { action } = data;
  const port = ports[0] ?? null;

  switch (action) {
    case 'closeDB': {
      try {
        closeDB();
        reply(port, null);
      } catch (e) {
        replyError(port, e.message);
      }
      break;
    }
    case 'createDB': {
      const { name } = data;
      try {
        const { newDB, message } = await createDatabase(name)
        db = newDB;
        reply(port, message);
      } catch (e) {
        replyError(port, e.message)
      }
      break;
    }
    case 'downloadDB': {
      try {
        const byteArray = sqlite3.capi.sqlite3_js_db_export(db);
        const blob = new Blob([byteArray.buffer], { type: "application/vnd.sqlite3" });
        reply(port, blob);
      } catch (e) {
        replyError(port.e.message);
      }
      break;
    }
    case 'executeQuery': {
      const { sql } = data;
      try {
        const result = db.exec({ sql , returnValue: "resultRows" });
        reply(port, result);
      } catch (e) {
        handleSQLiteError(port, sql, e)
      }
      break;
    }
    case 'prepareStatement': {
      const { sql, values } = data;
      let stmt;
      try {
        stmt = db.prepare(sql);
        stmt.bind(values);
        const columns = stmt.columnCount > 0 ? stmt.getColumnNames() : [];
        const result = [];
        while (stmt.step()) {
          const row = stmt.get([]);
          result.push(Object.fromEntries(columns.map((columnName, index) => [columnName, row[index]])));
        }
        reply(port, result);
      } catch (e) {
        handleSQLiteError(port, sql, e);
      } finally {
        stmt?.finalize();
      }
      break;
    }
    case 'uploadDB': {
      const { name, arrayBuffer } = data;
      try {
        const message = await uploadDatabase(name, arrayBuffer)
        reply(port, message);
      } catch (e) {
        replyError(port, e.message);
      }
      break;
    }
    default:
      console.warn('Unknown action:', data)
  }
}

/**
 * Open or create a named SQLite database.
 *
 * Prefers OPFS persistence when available; falls back to an in-memory
 * transient database otherwise.
 *
 * @param {string} name - Database name (used as the OPFS file basename).
 * @returns {Promise<{ newDB: import('@sqlite.org/sqlite-wasm').Database, message: string }>}
 */
async function createDatabase(name) {
  const instance = await getInstance();
  return 'opfs' in instance
    ? {
      newDB: new instance.oo1.OpfsDb(`/${name}.sqlite3`),
      message: `OPFS is available, created persisted database at /${name}.sqlite3`
    }
    : {
      newDB: new instance.oo1.DB(`/${name}.sqlite3`, 'ct'),
      message: `OPFS is not available, created transient database /${name}.sqlite3`
    };
}

/**
 * Import an `ArrayBuffer` into OPFS as a new database, replacing any existing one.
 *
 * @param {string} name - Database name.
 * @param {ArrayBuffer} arrayBuffer - Raw `.sqlite3` file contents.
 * @returns {Promise<string>} Confirmation message.
 * @throws {Error} If OPFS is unavailable or the import produces an empty result.
 */
async function uploadDatabase(name, arrayBuffer) {
  const instance = await getInstance();
  if (!('opfs' in instance)) throw new Error('OPFSMissingError: Unsupported operation due to missing OPFS support.');
  const size = await instance.oo1.OpfsDb.importDb(`${name}.sqlite3`, arrayBuffer);
  if (!size) throw new Error('ImportError: Empty size after import.');
  db = new instance.oo1.OpfsDb(`/${name}.sqlite3`);
  return `New DB imported as ${name}.sqlite3. (${arrayBuffer.byteLength} Bytes)`;
}

/**
 * Close the current database connection and release the handle.
 * No-ops if no database is open.
 */
function closeDB() {
  if (db) {
    console.log("Closing...", db);
    db.close();
    db = null;
  }
}
