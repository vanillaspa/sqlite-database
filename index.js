/**
 * @fileoverview SQLite-WASM facade — one dedicated Worker per named database.
 *
 * Each database runs in its own `Worker` (`sqliteWorker.js`). Communication
 * uses `MessageChannel` so responses are private to the caller and never
 * broadcast. All operations are async, returning Promises that resolve with
 * the worker's result or reject with its error message.
 *
 * Exposed on `window.sqlite` (frozen) by `main.js` after import.
 *
 * Components should **not** call these functions directly — instead dispatch
 * `sqlite:*` events via the event contract and let the bridge component
 * (`<sqlite-notes>` / `<sqlite-workers>`) translate.
 *
 * @module sqlite-database
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

if (!window.Worker) throw new Error(`Your browser doesn't support web workers.`);

/** @type {'sqlite'} */
export const name = "sqlite";

try {
    const sqlite3 = await sqlite3InitModule({ print: console.log, printErr: console.error });
    console.log('SQLite3 version:', sqlite3.version.libVersion);
} catch (err) {
    console.error('Initialization error:', err.name, err.message);
}

/**
 * Send a message to `worker` and return a Promise that settles with the reply.
 *
 * Uses a `MessageChannel` so each call gets its own private port — replies
 * cannot cross between concurrent calls. `port2` is transferred to the worker.
 *
 * @param {Worker} worker
 * @param {object} payload - Message data posted to the worker.
 * @returns {Promise<any>} Resolves with `data.result`; rejects on `type === 'error'`
 *   or `MessageChannel` deserialization failure.
 */
function enqueue(worker, payload) {
    const { port1, port2 } = new MessageChannel();
    return new Promise((resolve, reject) => {
        port1.onmessage = ({ data }) => {
            port1.close();
            data.type === 'error'
                ? reject(new Error(data.message))
                : resolve(data.result);
        };
        port1.onmessageerror = () => {
            port1.close();
            reject(new Error('MessageChannel deserialization error'));
        };
        worker.postMessage(payload, [port2]);
    })
}

/** @type {Map<string, Worker>} Database name → its dedicated worker. */
const workers = new Map();

/**
 * Return the worker for `name`, creating it on first access.
 *
 * @param {string} name - Database name.
 * @returns {Worker}
 */
function getWorker(name) {
    if (!workers.has(name)) {
        workers.set(name, new Worker(new URL('./sqliteWorker.js', import.meta.url), { type: 'module' }));
    }
    return workers.get(name);
}

/**
 * Expose the internal worker map (read-only reference).
 *
 * @returns {Map<string, Worker>}
 */
export function getWorkers() {
    return workers;
}

/**
 * Open (or create) a named SQLite database in OPFS.
 *
 * @param {string} name - Database name. A file `/{name}.sqlite3` is created in OPFS.
 * @returns {Promise<string>} Confirmation message from sqlite-wasm.
 */
export function createDB(name) {
    return enqueue(getWorker(name), { action: 'createDB', name });
}

/**
 * Close the database connection and terminate the worker.
 *
 * The OPFS file is kept. The worker entry is removed from the internal map.
 *
 * @param {string} name - Database name.
 * @returns {Promise<void>}
 */
export async function closeDB(name) {
    const worker = getWorker(name);
    await enqueue(worker, { action: 'closeDB' });
    worker.terminate();
    workers.delete(name);
}

/**
 * Close the database, terminate the worker, and permanently delete the OPFS file.
 *
 * Irreversible. The OPFS file handle is obtained via `navigator.storage.getDirectory()`
 * and removed if found. The worker entry is removed from the internal map.
 *
 * @param {string} name - Database name.
 * @returns {Promise<void>}
 */
export async function deleteDB(name) {
    const worker = getWorker(name);
    await enqueue(worker, { action: 'closeDB' });
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(`${name}.sqlite3`).catch(() => null);
    if (fileHandle) await fileHandle.remove();
    worker.terminate();
    workers.delete(name);
}

/**
 * Execute a raw SQL string. Use for DDL, multi-statement scripts, or queries
 * where column-keyed results are not needed.
 *
 * For SELECT: resolves with `Array<Array<any>>` (rows as positional arrays).
 * For non-SELECT: resolves with the sqlite-wasm result value.
 *
 * @param {string} sql - SQL to execute.
 * @param {string} name - Database name.
 * @returns {Promise<Array<Array<any>>|any>}
 */
export function executeQuery(sql, name) {
    return enqueue(getWorker(name), { action: 'executeQuery', sql });
}

/**
 * Execute a parameterised SQL statement using positional placeholders (`$1`, `$2`, …).
 *
 * Prefer this over {@link executeQuery} for any statement that includes
 * user-supplied values.
 *
 * For SELECT: resolves with `Array<Record<string, any>>` (rows as column-keyed objects).
 * For non-SELECT: resolves with the sqlite-wasm result value.
 *
 * @param {string} sql - SQL with `$1`, `$2`, … placeholders.
 * @param {Array<any>} values - Positional values to bind.
 * @param {string} name - Database name.
 * @returns {Promise<Array<Record<string, any>>|any>}
 */
export function executeStatement(sql, values, name) {
    return enqueue(getWorker(name), { action: 'prepareStatement', sql, values });
}

/**
 * Import a `.sqlite` or `.sqlite3` file into OPFS, replacing the named database.
 *
 * The database name is derived from the file name (before the first `.`).
 *
 * @param {string} fileName - File name, must end in `.sqlite` or `.sqlite3`.
 * @param {ArrayBuffer} arrayBuffer - Raw file contents.
 * @returns {Promise<string>} Confirmation message.
 * @throws {Error} If the file extension is unsupported (synchronous, before the Promise).
 */
export function uploadDB(fileName, arrayBuffer) {
    const [name, extension] = fileName.split('.'); // TODO handle multiple dots in fileName
    if (!['sqlite', 'sqlite3'].includes(extension)) {
        throw new Error(`UnsupportedError: Unsupported extension ".${extension}"`);
    }
    return enqueue(getWorker(name), { action: 'uploadDB', name, arrayBuffer });
}

/**
 * Export the named database as a `.sqlite3` file, triggering the browser save dialog.
 *
 * Creates a temporary object URL, clicks a synthetic `<a>` element, then revokes
 * the URL. Also resolves with the exported `Blob` for programmatic use.
 *
 * @param {string} name - Database name.
 * @returns {Promise<Blob>} The exported database blob.
 */
export async function downloadDB(name) {
    const blob = await enqueue(getWorker(name), { action: 'downloadDB' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.sqlite3`;
    a.click();
    URL.revokeObjectURL(url);
    return blob;
}
