import { buildApp } from "./app.js";
import { config } from "./config.js";
import { openDb } from "./db.js";

const app = buildApp(openDb(config.dbFile));
app.listen({ port: config.port, host: config.host }).catch((e) => {
    app.log.error(e);
    process.exit(1);
});
