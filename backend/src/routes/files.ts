import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { FILE_NAME_RE } from "../cloud/files.js";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export const fileRoutes = (app: FastifyInstance, dir: string) => {
    app.get("/files/:name", async (req, reply) => {
        const name = String((req.params as any).name);
        // 严格白名单，杜绝路径穿越
        if (!FILE_NAME_RE.test(name)) return reply.code(404).send("not found");
        const path = join(dir, name);
        if (!existsSync(path)) return reply.code(404).send("not found");
        return reply
            .header("Cache-Control", "private, max-age=3600")
            .type(TYPES[name.split(".")[1]])
            .send(createReadStream(path));
    });
};
