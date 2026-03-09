import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
// https://www.npmjs.com/package/@sqlite.org/sqlite-wasm
// https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers

if (!window.Worker) throw new Error(`Your browser doesn't support web workers.`);
export const name = "sqlite"; // module name
try {
    const sqlite3 = await sqlite3InitModule({ print: console.log, printErr: console.error });
    console.log('SQLite3 version:', sqlite3.version.libVersion);
} catch (err) {
    console.error('Initialization error:', err.name, err.message);
}

const workers = new Map();

function getWorker(name = 'default') {
    const worker = workers.get(name);
    if (!worker) throw new Error(`No worker for "${name}"`);
    return worker;
}

function initializeWorker(name) {
    if (workers.has(name)) throw new Error(`Worker "${name}" already exists.`);
    const worker = new Worker(new URL('./sqliteWorker.js', import.meta.url), { type: 'module' });
    workers.set(name, worker);
}

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

// Public API
export function downloadDB(name = 'default') {
    getWorker(name).postMessage({ action: 'downloadDB' });
}

export function createDB(name = 'default') {
    initializeWorker(name); // in try-catch?
    return enqueue(getWorker(name), { action: 'createDB', name });
}

export async function deleteAndTerminateDB(name) {
    const worker = getWorker(name);

    await enqueue(worker, { action: 'closeDB' })

    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(`${name}.sqlite3`).catch(() => null);
    if (fileHandle) await fileHandle.remove();

    worker.terminate();
    workers.delete(name);
}

export function executeQuery(sql, name = 'default') {
    return enqueue(getWorker(name), { action: "executeQuery", sql });
}

export function executeStatement({ sql, values, name = "default" }) {
    return enqueue(getWorker(name), { action: "prepareStatement", sql, values });
}

export function uploadDB(fileName, arrayBuffer) {
    const [name, extension] = fileName.split(".");
    if (!['sqlite', 'sqlite3'].includes(extension)) {
        throw new Error(`UnsupportedError: Unsupported extension ".${extension}"`);
    }
    if (!workers.has(name)) initializeWorker(name);
    return enqueue(workers.get(name), { action: 'uploadDB', name, arrayBuffer });
}

export function terminate(name = 'default') {
    let worker = workers.get(name);
    if (worker) {
        worker.terminate();
        workers.delete(name);
    }
}

export function getWorkers() {
    return workers;
}
