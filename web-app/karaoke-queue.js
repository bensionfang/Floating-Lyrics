'use strict';

const crypto = require('node:crypto');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS karaoke_queue_items (
  queue_id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL UNIQUE,
  song_id TEXT NOT NULL,
  singer_id TEXT NOT NULL,
  singer TEXT NOT NULL,
  "key" INTEGER NOT NULL DEFAULT 0,
  tempo REAL NOT NULL DEFAULT 1,
  scoring INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_order INTEGER NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS karaoke_queue_position_idx ON karaoke_queue_items(position);
CREATE TABLE IF NOT EXISTS karaoke_queue_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  next_order INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO karaoke_queue_meta (id, revision, next_order) VALUES (1, 0, 1);
`;

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
        if (error) reject(error); else resolve(this);
    });
});

const get = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
});

const all = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
});

function ensureKaraokeQueueSchema(db, callback) {
    const promise = new Promise((resolve, reject) => {
        db.exec(SCHEMA, (error) => error ? reject(error) : resolve());
    });
    if (callback) promise.then(() => callback(null), callback);
    return promise;
}

function integer(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : fallback;
}

function tempo(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 1;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function itemFromRow(row) {
    return {
        queueId: row.queue_id,
        reservationId: row.reservation_id,
        songId: row.song_id,
        singerId: row.singer_id,
        singer: row.singer,
        key: row.key,
        tempo: row.tempo,
        scoring: !!row.scoring,
        status: row.status,
        order: row.position,
        createdOrder: row.created_order,
    };
}

async function projectQueueItem(item, songResolver) {
    const song = songResolver ? await songResolver(item.songId) : null;
    return song && typeof song === 'object' ? {
        ...item,
        title: song.title,
        artist: song.artist,
        lyricsStatus: song.lyrics && song.lyrics.status || 'missing',
    } : item;
}

class KaraokeQueue {
    constructor(db, options = {}) {
        this.db = db;
        this._idFactory = options.idFactory || (() => crypto.randomUUID());
        this._reservationIdFactory = options.reservationIdFactory || this._idFactory;
        this._songResolver = options.songResolver || null;
        this.ready = ensureKaraokeQueueSchema(db);
        this._tail = Promise.resolve();
    }

    _serial(task) {
        const next = this._tail.then(() => this.ready).then(task);
        this._tail = next.catch(() => {});
        return next;
    }

    async _state() {
        const meta = await get(this.db, 'SELECT revision FROM karaoke_queue_meta WHERE id=1');
        const rows = await all(this.db, `SELECT queue_id, reservation_id, song_id, singer_id, singer,
            "key" AS key, tempo, scoring, status, position, created_order
            FROM karaoke_queue_items ORDER BY position, created_order`);
        const items = await Promise.all(rows.map((row) => projectQueueItem(itemFromRow(row), this._songResolver)));
        const currentQueueId = items[0] ? items[0].queueId : null;
        return {
            revision: meta ? meta.revision : 0,
            currentQueueId,
            hasNext: items.length > 1,
            items,
        };
    }

    snapshot() {
        return this._serial(() => this._state());
    }

    _expectedRevision(messageOrRevision) {
        if (messageOrRevision === undefined || messageOrRevision === null) return undefined;
        return integer(messageOrRevision, -1);
    }

    async _mutate(expectedRevision, change) {
        return this._serial(async () => {
            await run(this.db, 'BEGIN IMMEDIATE');
            try {
                const meta = await get(this.db, 'SELECT revision, next_order FROM karaoke_queue_meta WHERE id=1');
                const expected = this._expectedRevision(expectedRevision);
                if (expected !== undefined && expected !== meta.revision) {
                    await run(this.db, 'ROLLBACK');
                    return {
                        accepted: false,
                        reason: 'stale-queue-revision',
                        state: await this._state(),
                    };
                }
                const rows = await all(this.db, `SELECT queue_id, reservation_id, song_id, singer_id, singer,
                    "key" AS key, tempo, scoring, status, position, created_order
                    FROM karaoke_queue_items ORDER BY position, created_order`);
                const result = await change(rows, meta);
                if (!result || result.accepted === false) {
                    await run(this.db, 'ROLLBACK');
                    return {
                        accepted: false,
                        reason: result && result.reason ? result.reason : 'queue-mutation-rejected',
                        state: await this._state(),
                    };
                }
                await run(this.db, 'UPDATE karaoke_queue_meta SET revision=revision+1 WHERE id=1');
                await run(this.db, 'COMMIT');
                const state = await this._state();
                const item = result.item && state.items.find((candidate) => candidate.queueId === result.item.queueId);
                return { accepted: true, state, ...(item ? { item } : {}) };
            } catch (error) {
                try { await run(this.db, 'ROLLBACK'); } catch (rollbackError) { /* preserve original error */ }
                throw error;
            }
        });
    }

    async _resolveSong(songId) {
        if (!this._songResolver) return true;
        return !!(await this._songResolver(songId));
    }

    async _newItem(input, position, status, createdOrder) {
        if (!input || !input.songId) throw new Error('songId is required');
        const songId = String(input.songId);
        if (!(await this._resolveSong(songId))) return null;
        const singerId = String(input.singerId || input.singer || 'anonymous');
        const item = {
            queueId: String(input.queueId || this._idFactory()),
            reservationId: String(input.reservationId || this._reservationIdFactory()),
            songId,
            singerId,
            singer: String(input.singer || singerId),
            key: integer(input.key),
            tempo: tempo(input.tempo),
            scoring: !!(input.scoring ?? input.scoringEnabled),
            status,
            order: position,
            createdOrder,
        };
        return item;
    }

    async _insertItem(item) {
        await run(this.db, `INSERT INTO karaoke_queue_items
            (queue_id, reservation_id, song_id, singer_id, singer, "key", tempo, scoring, status, position, created_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            item.queueId, item.reservationId, item.songId, item.singerId, item.singer,
            item.key, item.tempo, item.scoring ? 1 : 0, item.status, item.order, item.createdOrder,
        ]);
    }

    async _rewriteOrder(rows) {
        await run(this.db, 'UPDATE karaoke_queue_items SET position = -position - 1');
        for (let index = 0; index < rows.length; index++) {
            await run(this.db, 'UPDATE karaoke_queue_items SET position=?, status=? WHERE queue_id=?', [
                index, index === 0 ? 'current' : 'queued', rows[index].queue_id,
            ]);
        }
    }

    reserve(input, expectedRevision) {
        return this._mutate(expectedRevision, async (rows, meta) => {
            const item = await this._newItem(input, rows.length, rows.length ? 'queued' : 'current', meta.next_order);
            if (!item) return { accepted: false, reason: 'song-not-found' };
            await this._insertItem(item);
            await run(this.db, 'UPDATE karaoke_queue_meta SET next_order=next_order+1 WHERE id=1');
            return { item };
        });
    }

    insertNext(input, expectedRevision) {
        return this._mutate(expectedRevision, async (rows, meta) => {
            const position = rows.length ? 1 : 0;
            const item = await this._newItem(input, position, rows.length ? 'queued' : 'current', meta.next_order);
            if (!item) return { accepted: false, reason: 'song-not-found' };
            if (rows.length) await run(this.db, 'UPDATE karaoke_queue_items SET position=position+1 WHERE position>=1');
            await this._insertItem(item);
            await run(this.db, 'UPDATE karaoke_queue_meta SET next_order=next_order+1 WHERE id=1');
            return { item };
        });
    }

    remove(queueId, expectedRevision) {
        return this._mutate(expectedRevision, async (rows) => {
            const index = rows.findIndex((row) => row.queue_id === String(queueId));
            if (index < 0) return { accepted: false, reason: 'queue-item-not-found' };
            await run(this.db, 'DELETE FROM karaoke_queue_items WHERE queue_id=?', [String(queueId)]);
            rows.splice(index, 1);
            await this._rewriteOrder(rows);
            return {};
        });
    }

    removeCurrent(expectedRevision) {
        return this._mutate(expectedRevision, async (rows) => {
            if (!rows.length) return { accepted: false, reason: 'no-current-item' };
            await run(this.db, 'DELETE FROM karaoke_queue_items WHERE queue_id=?', [rows[0].queue_id]);
            rows.shift();
            await this._rewriteOrder(rows);
            return {};
        });
    }

    setKey(queueId, value, expectedRevision) {
        return this._mutate(expectedRevision, async (rows) => {
            const item = rows.find((row) => row.queue_id === String(queueId || rows[0]?.queue_id || ''));
            if (!item) return { accepted: false, reason: 'queue-item-not-found' };
            const key = integer(value);
            if (key < -6 || key > 6) return { accepted: false, reason: 'invalid-key' };
            await run(this.db, 'UPDATE karaoke_queue_items SET "key"=? WHERE queue_id=?', [key, item.queue_id]);
            return {};
        });
    }

    reorder(queueId, newIndex, expectedRevision) {
        return this._mutate(expectedRevision, async (rows) => {
            const from = rows.findIndex((row) => row.queue_id === String(queueId));
            if (from < 0) return { accepted: false, reason: 'queue-item-not-found' };
            if (from === 0) return { accepted: false, reason: 'current-item-cannot-reorder' };
            const target = integer(newIndex, -1);
            if (target < 1 || target >= rows.length) return { accepted: false, reason: 'invalid-queue-position' };
            const [item] = rows.splice(from, 1);
            rows.splice(target, 0, item);
            await this._rewriteOrder(rows);
            return {};
        });
    }

    skip(expectedRevision) {
        return this.removeCurrent(expectedRevision);
    }

    handleMessage(message) {
        if (!message || typeof message !== 'object') return null;
        const expectedRevision = message.expectedRevision;
        switch (message.type) {
            case 'karaoke_queue_reserve':
                return this.reserve(message.item || message, expectedRevision);
            case 'karaoke_queue_insert_next':
                return this.insertNext(message.item || message, expectedRevision);
            case 'karaoke_queue_remove':
                return this.remove(message.queueId, expectedRevision);
            case 'karaoke_queue_remove_current':
                return this.removeCurrent(expectedRevision);
            case 'karaoke_queue_key':
                return this.setKey(message.queueId, message.key, expectedRevision);
            case 'karaoke_queue_reorder':
                return this.reorder(message.queueId, message.newIndex, expectedRevision);
            case 'karaoke_queue_skip':
                return this.skip(expectedRevision);
            default:
                return null;
        }
    }
}

module.exports = {
    KaraokeQueue,
    ensureKaraokeQueueSchema,
};
