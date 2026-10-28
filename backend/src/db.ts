import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

// 当前使用 node:sqlite；切换 PostgreSQL 时，替换本文件与各模块里的 SQL 即可，
// 业务规则（事务、幂等、状态机）与存储无关。
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
            role          INTEGER NOT NULL DEFAULT 1,
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

        -- 额度流水：每次余额变动一条，便于对账和客诉
        CREATE TABLE IF NOT EXISTS quota_ledger (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL REFERENCES users(id),
            delta         INTEGER NOT NULL,
            balance_after INTEGER NOT NULL,
            reason        TEXT NOT NULL,
            ref_type      TEXT NOT NULL DEFAULT '',
            ref_id        TEXT NOT NULL DEFAULT '',
            created_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ledger_user ON quota_ledger(user_id, id);

        CREATE TABLE IF NOT EXISTS redemptions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            key           TEXT NOT NULL UNIQUE,
            quota         INTEGER NOT NULL,
            status        INTEGER NOT NULL DEFAULT 1,
            batch         TEXT NOT NULL DEFAULT '',
            expired_time  INTEGER NOT NULL DEFAULT 0,
            used_user_id  INTEGER NOT NULL DEFAULT 0,
            redeemed_time INTEGER NOT NULL DEFAULT 0,
            created_at    INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS plans (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            title          TEXT NOT NULL,
            subtitle       TEXT NOT NULL DEFAULT '',
            price_cents    INTEGER NOT NULL,
            duration_days  INTEGER NOT NULL,
            quota          INTEGER NOT NULL,
            functions      TEXT NOT NULL DEFAULT '{}',
            enabled        INTEGER NOT NULL DEFAULT 1,
            sort           INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS subscriptions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL REFERENCES users(id),
            plan_id      INTEGER NOT NULL REFERENCES plans(id),
            quota_total  INTEGER NOT NULL,
            quota_used   INTEGER NOT NULL DEFAULT 0,
            start_time   INTEGER NOT NULL,
            end_time     INTEGER NOT NULL,
            status       TEXT NOT NULL DEFAULT 'active',
            source       TEXT NOT NULL DEFAULT 'order',
            order_id     INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_sub_user ON subscriptions(user_id, status, end_time);

        -- 订单：充值与套餐购买共用。trade_no 唯一，是回调幂等的依据
        CREATE TABLE IF NOT EXISTS orders (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            trade_no    TEXT NOT NULL UNIQUE,
            kind        TEXT NOT NULL,
            plan_id     INTEGER NOT NULL DEFAULT 0,
            quota       INTEGER NOT NULL DEFAULT 0,
            money_cents INTEGER NOT NULL,
            provider    TEXT NOT NULL,
            method      TEXT NOT NULL DEFAULT '',
            status      TEXT NOT NULL DEFAULT 'pending',
            created_at  INTEGER NOT NULL,
            paid_at     INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, id);

        -- 云端模型：供应商与密钥只存后端，不下发客户端
        CREATE TABLE IF NOT EXISTS cloud_models (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            version         TEXT NOT NULL,
            title           TEXT NOT NULL,
            description     TEXT NOT NULL DEFAULT '',
            logo            TEXT NOT NULL DEFAULT '',
            content         TEXT NOT NULL DEFAULT '',
            functions       TEXT NOT NULL DEFAULT '{}',
            provider        TEXT NOT NULL,
            provider_config TEXT NOT NULL DEFAULT '{}',
            pricing         TEXT NOT NULL DEFAULT '{}',
            enabled         INTEGER NOT NULL DEFAULT 1,
            UNIQUE (name, version)
        );
        CREATE TABLE IF NOT EXISTS cloud_tasks (
            id          TEXT PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            model_id    INTEGER NOT NULL REFERENCES cloud_models(id),
            status      TEXT NOT NULL,
            reserved    INTEGER NOT NULL DEFAULT 0,
            settled     INTEGER NOT NULL DEFAULT 0,
            funding     TEXT NOT NULL DEFAULT '{}',
            upstream_id TEXT NOT NULL DEFAULT '',
            param       TEXT NOT NULL DEFAULT '{}',
            result      TEXT NOT NULL DEFAULT '{}',
            error       TEXT NOT NULL DEFAULT '',
            client_id   TEXT NOT NULL DEFAULT '',
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON cloud_tasks(status, updated_at);

        -- 邮件验证码：只存哈希；限制有效期、尝试次数、发送频率
        CREATE TABLE IF NOT EXISTS verification_codes (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            email      TEXT NOT NULL,
            purpose    TEXT NOT NULL,
            code_hash  TEXT NOT NULL,
            attempts   INTEGER NOT NULL DEFAULT 0,
            used       INTEGER NOT NULL DEFAULT 0,
            ip         TEXT NOT NULL DEFAULT '',
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_codes_email ON verification_codes(email, purpose, id);

        -- 图形验证码：一次性，答案只存哈希
        CREATE TABLE IF NOT EXISTS captchas (
            id          TEXT PRIMARY KEY,
            answer_hash TEXT NOT NULL,
            expires_at  INTEGER NOT NULL
        );

        -- 登录失败计数：按邮箱（不论账号是否存在）记录，避免通过“锁定”提示枚举账号
        CREATE TABLE IF NOT EXISTS login_failures (
            email        TEXT PRIMARY KEY,
            count        INTEGER NOT NULL DEFAULT 0,
            first_at     INTEGER NOT NULL,
            locked_until INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_id   INTEGER NOT NULL,
            action     TEXT NOT NULL,
            target     TEXT NOT NULL DEFAULT '',
            detail     TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL
        );
    `);
    // P0 阶段建的库没有 role 列，补上
    const cols = db.prepare("PRAGMA table_info(users)").all() as any[];
    if (!cols.some((c) => c.name === "role")) {
        db.exec("ALTER TABLE users ADD COLUMN role INTEGER NOT NULL DEFAULT 1");
    }
    if (!cols.some((c) => c.name === "email_verified")) {
        db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
    }
    const taskCols = db.prepare("PRAGMA table_info(cloud_tasks)").all() as any[];
    if (!taskCols.some((c) => c.name === "client_id")) {
        db.exec("ALTER TABLE cloud_tasks ADD COLUMN client_id TEXT NOT NULL DEFAULT ''");
    }
    // 客户端任务 id 去重：桌面端重试或重启后重新提交同一个任务，不会重复扣费
    db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_client ON cloud_tasks(user_id, client_id) WHERE client_id != ''",
    );
    return db;
};
