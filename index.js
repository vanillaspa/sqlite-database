import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { addEventListener, dispatchEvent } from '@vanillaspa/event-bus';

if (!window.Worker) throw new Error(`Your browser doesn't support web workers.`);

export const name = "sqlite";

try {
    const sqlite3 = await sqlite3InitModule({ print: console.log, printErr: console.error });
    console.log('SQLite3 version:', sqlite3.version.libVersion);
} catch (err) {
    console.error('Initialization error:', err.name, err.message);
}

const workers = new Map();
export function getWorkers() {
    return workers;
}

function initializeWorker(name) {
    if (!workers.has(name)) {
        workers.set(name, new Worker(new URL('./sqliteWorker.js', import.meta.url), { type: 'module' }));
    }
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

function fire(type, detail, context) {
    dispatchEvent(new CustomEvent(type, { detail: { ...detail, target: context } }));
}
// No public API, but event-bus listener
addEventListener('sqlite:createDB', async (event) => {
    const { name, target } = event.detail;
    try {
        initializeWorker(name);
        const result = await enqueue(workers.get(name), { action: 'createDB', name });
        fire('sqlite:ready', { result, name }, target);
    } catch (error) {
        fire('sqlite:error', { error: error.message, action: 'createDB' }, target);
    }
}, import.meta);

addEventListener('sqlite:query', async (event) => {
    const { sql, name, target } = event.detail;
    try {
        const result = await enqueue(workers.get(name), { action: "executeQuery", sql });
        fire('sqlite:result', { result, sql }, target);
    } catch (error) {
        fire('sqlite:error', { error: error.message, action: 'executeQuery', sql }, target);
    }
}, import.meta);

addEventListener('sqlite:statement', async (event) => {
    const { sql, values, name, target } = event.detail;
    try {
        const result = await enqueue(workers.get(name), { action: "prepareStatement", sql, values });
        fire('sqlite:result', { result, sql }, target);
    } catch (error) {
        fire('sqlite:error', { error: error.message, action: 'prepareStatement', sql }, target);
    }
}, import.meta)

addEventListener('sqlite:upload', async (event) => {
    const { fileName, arrayBuffer, target } = event.detail;
    try {
        const [name, extension] = fileName.split(".");
        if (!['sqlite', 'sqlite3'].includes(extension)) {
            throw new Error(`UnsupportedError: Unsupported extension ".${extension}"`);
        }
        if (!workers.has(name)) initializeWorker(name);
        const result = await enqueue(workers.get(name), { action: 'uploadDB', name, arrayBuffer });
        fire('sqlite:upload', { result, name }, target)
    } catch (error) {
        fire('sqlite:error', { error: error.message, action: 'uploadDB' }, target);
    }
}, import.meta);

addEventListener('sqlite:download', async (event) => {
    const { name, target } = event.detail;
    try {
        const blob = await enqueue(workers.get(name), { action: 'downloadDB' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}.sqlite3`;
        a.click();
        URL.revokeObjectURL(url)
        fire('sqlite:downloaded', { name }, target);
    } catch (error) {
        fire('sqlite:error', { error: error.message, action: 'downloadDB' }, target);
    }
}, import.meta);

addEventListener('sqlite:closeDB', async (event) => {
    const { name, target } = event.detail;
    try {
        await enqueue(workers.get(name), { action: 'closeDB' });
        workers.get(name).terminate();
        workers.delete(name);
        fire('sqlite:closed', { name }, target);
    } catch (error) {
        fire('sqlite:error', { error: error.message, action: 'closeDB' }, target);
    }
}, import.meta);

addEventListener('sqlite:deleteDB', async (event) => {
    const { name, target } = event.detail;
    try {
        await enqueue(workers.get(name), { action: 'closeDB' });
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle(`${name}.sqlite3`).catch(() => null);
        if (fileHandle) await fileHandle.remove();
        workers.get(name).terminate();
        workers.delete(name);
        fire('sqlite:deleted', { name }, target);
    } catch (error) {
        fire('sqlite:error', { error: error.message, action: 'deleteDB' }, target);
    }
}, import.meta);
