import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

let db = null;
let sqlite3 = null;

async function getInstance() {
  if (!sqlite3) {
    sqlite3 = await sqlite3InitModule({ print: console.log, printErr: console.error });
  }
  return sqlite3;
}

function reply(port, result) {
  port.postMessage({ type: 'application/json', result });
  port.close();
}

function replyError(port, message) {
  port.postMessage({ type: 'error', message });
  port.close();
}

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
        const columns = stmt.getColumnNames();
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

async function uploadDatabase(name, arrayBuffer) {
  const instance = await getInstance();
  if (!('opfs' in instance)) throw new Error('OPFSMissingError: Unsupported operation due to missing OPFS support.');
  const size = await instance.oo1.OpfsDb.importDb(`${name}.sqlite3`, arrayBuffer);
  if (!size) throw new Error('ImportError: Empty size after import.');
  db = new instance.oo1.OpfsDb(`/${name}.sqlite3`);
  return `New DB imported as ${name}.sqlite3. (${arrayBuffer.byteLength} Bytes)`;
}

function closeDB() {
  if (db) {
    console.log("Closing...", db);
    db.close();
    db = null;
  }
}
