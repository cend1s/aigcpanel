import type { Db } from "../db.js";
import { parsePricing } from "./pricing.js";
import type { ModelRow } from "./types.js";

const toRow = (r: any): ModelRow => ({
    id: Number(r.id),
    name: r.name,
    version: r.version,
    title: r.title,
    provider: r.provider,
    providerConfig: JSON.parse(r.provider_config || "{}"),
    pricing: JSON.parse(r.pricing || "{}"),
    enabled: !!r.enabled,
});

export const getModel = (db: Db, name: string, version: string): ModelRow | null => {
    const r = db
        .prepare("SELECT * FROM cloud_models WHERE name = ? AND version = ? AND enabled = 1")
        .get(name, version);
    return r ? toRow(r) : null;
};

export const getModelById = (db: Db, id: number): ModelRow | null => {
    const r = db.prepare("SELECT * FROM cloud_models WHERE id = ?").get(id);
    return r ? toRow(r) : null;
};

/** 下发给客户端的清单（对应 server/all）：不含 provider_config / pricing，密钥永不出后端。 */
export const publicModelRecords = (db: Db) =>
    (db.prepare("SELECT * FROM cloud_models WHERE enabled = 1 ORDER BY id").all() as any[]).map(
        (r) => ({
            name: r.name,
            version: r.version,
            title: r.title,
            description: r.description,
            logo: r.logo,
            url: "",
            demo: [],
            content: r.content,
            functions: JSON.parse(r.functions || "{}"),
        }),
    );

export type ModelInput = {
    name: string;
    version: string;
    title: string;
    description?: string;
    logo?: string;
    content?: string;
    functions?: Record<string, unknown>;
    provider: string;
    providerConfig?: Record<string, unknown>;
    pricing: unknown;
    enabled?: boolean;
};

export const saveModel = (db: Db, m: ModelInput): number => {
    parsePricing(m.pricing);
    if (!m.name || !m.version || !m.provider) {
        throw new Error("name / version / provider 不能为空");
    }
    // 桌面端按名称前缀 Cloud 识别云端模型并加载云端驱动；其他名称会被当作本地模型包加载而报错
    if (!/^Cloud[A-Za-z0-9_-]*$/.test(m.name)) {
        throw new Error("云端模型名称必须以 Cloud 开头，且只能包含字母、数字、下划线和短横线");
    }
    db.prepare(
        `INSERT INTO cloud_models (name, version, title, description, logo, content, functions, provider, provider_config, pricing, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name, version) DO UPDATE SET
           title=excluded.title, description=excluded.description, logo=excluded.logo,
           content=excluded.content, functions=excluded.functions, provider=excluded.provider,
           provider_config=excluded.provider_config, pricing=excluded.pricing, enabled=excluded.enabled`,
    ).run(
        m.name,
        m.version,
        m.title,
        m.description ?? "",
        m.logo ?? "",
        m.content ?? "",
        JSON.stringify(m.functions ?? {}),
        m.provider,
        JSON.stringify(m.providerConfig ?? {}),
        JSON.stringify(m.pricing),
        m.enabled === false ? 0 : 1,
    );
    const row: any = db
        .prepare("SELECT id FROM cloud_models WHERE name = ? AND version = ?")
        .get(m.name, m.version);
    return Number(row.id);
};
