import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

if (!window.Worker) throw new Error(`Your browser doesn't support web workers.`);

export const name = "sqlite";

try {
    const sqlite3 = await sqlite3InitModule({ print: console.log, printErr: console.error });
    console.log('SQLite3 version:', sqlite3.version.libVersion);
} catch (err) {
    console.error('Initialization error:', err.name, err.message);
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

const workers = new Map();
function getWorker(name) {
    if (!workers.has(name)) {
        workers.set(name, new Worker(new URL('./sqliteWorker.js', import.meta.url), { type: 'module' }));
    }
    return workers.get(name);
}

export function getWorkers() {
    return workers;
}

export function createDB(name) {
    return enqueue(getWorker(name), { action: 'createDB', name });
}

export async function closeDB(name) {
    const worker = getWorker(name);
    await enqueue(worker, { action: 'closeDB' });
    worker.terminate();
    workers.delete(name);
}

export async function deleteDB(name) {
    const worker = getWorker(name);
    await enqueue(worker, { action: 'closeDB' });
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(`${name}.sqlite3`).catch(() => null);
    if (fileHandle) await fileHandle.remove();
    worker.terminate();
    workers.delete(name);
}

export function executeQuery(sql, name) {
    return enqueue(getWorker(name), { action: 'executeQuery', sql });
}

export function executeStatement(sql, values, name) {
    return enqueue(getWorker(name), { action: 'prepareStatement', sql, values });
}

export function uploadDB(fileName, arrayBuffer) {
    const [name, extension] = fileName.split('.'); // TODO handle multiple dots in fileName
    if (!['sqlite', 'sqlite3'].includes(extension)) {
        throw new Error(`UnsupportedError: Unsupported extension ".${extension}"`);
    }
    return enqueue(getWorker(name), { action: 'uploadDB', name, arrayBuffer });
}

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
