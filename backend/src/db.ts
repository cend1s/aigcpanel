import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

// P0 骨架使用 node:sqlite；P1 起切换 PostgreSQL，数据访问集中在 src/users.ts，便于替换。
export const openDb = (file: string): Db => {
    if (file !== ":memory:") {
        mkdirSync(dirname(file), { recursive: true });
    }
    const db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            email         TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            nickname      TEXT NOT NULL DEFAULT '',
            avatar        TEXT NOT NULL DEFAULT '',
            status        INTEGER NOT NULL DEFAULT 1,
            quota         INTEGER NOT NULL DEFAULT 0,
            used_quota    INTEGER NOT NULL DEFAULT 0,
            created_at    INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS api_tokens (
            token_hash   TEXT PRIMARY KEY,
            user_id      INTEGER NOT NULL REFERENCES users(id),
            device_uuid  TEXT NOT NULL DEFAULT '',
            created_at   INTEGER NOT NULL,
            last_used_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
    `);
    return db;
};
