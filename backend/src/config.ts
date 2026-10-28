export const config = {
    port: Number(process.env.PORT ?? 3100),
    host: process.env.HOST ?? "127.0.0.1",
    dbFile: process.env.DB_FILE ?? "data/app.db",
};
