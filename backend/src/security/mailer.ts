import nodemailer from "nodemailer";

export type Mail = { to: string; subject: string; text: string };

// 邮件发送接口：生产用 SMTP；开发用日志输出；测试用内存记录。
// 需要短信验证码时，按同样的方式加一个短信实现即可。
export interface Mailer {
    readonly kind: "smtp" | "log" | "memory";
    send(mail: Mail): Promise<void>;
}

export class SmtpMailer implements Mailer {
    readonly kind = "smtp";
    private transport;
    constructor(
        cfg: { host: string; port: number; secure: boolean; user: string; pass: string },
        private from: string,
    ) {
        this.transport = nodemailer.createTransport({
            host: cfg.host,
            port: cfg.port,
            secure: cfg.secure,
            auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
        });
    }
    async send(mail: Mail) {
        await this.transport.sendMail({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text });
    }
}

/** 仅开发环境：把邮件内容打到日志里，方便本地拿验证码 */
export class LogMailer implements Mailer {
    readonly kind = "log";
    constructor(private log: (msg: string) => void) {}
    async send(mail: Mail) {
        this.log(`[开发模式邮件] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    }
}

export class MemoryMailer implements Mailer {
    readonly kind = "memory";
    sent: Mail[] = [];
    async send(mail: Mail) {
        this.sent.push(mail);
    }
    /** 测试辅助：取最近一封发给某人的邮件里的 6 位验证码 */
    lastCode(to: string) {
        const mail = [...this.sent].reverse().find((m) => m.to === to);
        return mail?.text.match(/\b(\d{6})\b/)?.[1] ?? "";
    }
}
