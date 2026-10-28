import { randomUUID } from "node:crypto";
import svgCaptcha from "svg-captcha";
import type { Db } from "../db.js";
import { sha256 } from "../security.js";
import { now } from "../tx.js";

// 图形验证码接口：内置实现基于 svg-captcha（本地生成，无需第三方服务）。
// 它能挡住简单脚本，但挡不住专门的 OCR；正式运营遇到批量攻击时，
// 可按此接口替换为腾讯云/阿里云/Cloudflare Turnstile 等托管验证码。
export interface CaptchaService {
    create(): { id: string; svg: string };
    /** 校验并作废（无论对错都只能用一次） */
    verify(id: unknown, answer: unknown): boolean;
}

const TTL = 5 * 60;

export class SvgCaptchaService implements CaptchaService {
    constructor(private db: Db) {}

    create() {
        const c = svgCaptcha.create({
            size: 4,
            noise: 3,
            ignoreChars: "0o1ilI",
            width: 120,
            height: 40,
            color: true,
        });
        const id = randomUUID();
        // 顺带清理过期记录，避免表无限增长
        this.db.prepare("DELETE FROM captchas WHERE expires_at < ?").run(now());
        this.db
            .prepare("INSERT INTO captchas (id, answer_hash, expires_at) VALUES (?, ?, ?)")
            .run(id, sha256(c.text.toLowerCase()), now() + TTL);
        return { id, svg: c.data };
    }

    verify(id: unknown, answer: unknown) {
        if (typeof id !== "string" || typeof answer !== "string" || !answer.trim()) return false;
        const row: any = this.db.prepare("SELECT * FROM captchas WHERE id = ?").get(id);
        if (!row) return false;
        this.db.prepare("DELETE FROM captchas WHERE id = ?").run(id);
        return row.expires_at >= now() && row.answer_hash === sha256(answer.trim().toLowerCase());
    }
}
