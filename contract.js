// @vanillaspa/sqlite-database/contract.js
// use import * as SqliteContract from '@vanillaspa/sqlite-database/contract';
// window[SqliteContract.name] = Object.freeze(SqliteContract);
// then
// const { mountBridge, useContract } = window.eventbus;
// const db = useContract(window.SqliteContract, host);
// in useContract(contract, host) and mountBridge(contract, host) in @vanillaspa/event-bus
import { createDB, closeDB, deleteDB, executeQuery, executeStatement, uploadDB, downloadDB } from '@vanillaspa/sqlite-database';

export const name = 'SqliteContract';
export const namespace = 'sqlite';

export const events = {
    create:    { detail: { name: 'string' },                                past: 'created'   },
    query:     { detail: { sql: 'string', name: 'string' },                 past: 'queried'   },
    statement: { detail: { sql: 'string', values: 'array', name: 'string' }, past: 'executed' },
    close:     { detail: { name: 'string' },                                past: 'closed'    },
    delete:    { detail: { name: 'string' },                                past: 'deleted'   },
    upload:    { detail: { fileName: 'string', arrayBuffer: 'any' },        past: 'uploaded'  },
    download:  { detail: { name: 'string' },                                past: 'downloaded' },
};

export const handlers = {
    create:    ({ name })                  => createDB(name),
    query:     ({ sql, name })             => executeQuery(sql, name),
    statement: ({ sql, values, name })     => executeStatement(sql, values, name),
    close:     ({ name })                  => closeDB(name),
    delete:    ({ name })                  => deleteDB(name),
    upload:    ({ fileName, arrayBuffer }) => uploadDB(fileName, arrayBuffer),
    download:  ({ name })                  => downloadDB(name),
};

export const responseDetail = {
    close:    (_, { name }) => ({ name }),
    delete:   (_, { name }) => ({ name }),
    download: ()            => ({}),
};