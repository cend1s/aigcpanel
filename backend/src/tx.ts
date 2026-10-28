import type { Db } from "./db.js";

// node:sqlite 是同步的，BEGIN IMMEDIATE 先取写锁，保证“检查 + 修改”原子。
// 支持嵌套：内层直接复用外层事务，任何一层抛错都会整体回滚。
const depth = new WeakMap<Db, number>();

export const tx = <T>(db: Db, fn: () => T): T => {
    const d = depth.get(db) ?? 0;
    if (d > 0) {
        return fn();
    }
    db.exec("BEGIN IMMEDIATE");
    depth.set(db, 1);
    try {
        const result = fn();
        db.exec("COMMIT");
        return result;
    } catch (e) {
        db.exec("ROLLBACK");
        throw e;
    } finally {
        depth.set(db, 0);
    }
};

export const now = () => Math.floor(Date.now() / 1000);
