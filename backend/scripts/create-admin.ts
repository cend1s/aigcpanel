// 用法：npx tsx scripts/create-admin.ts <email> <password>
// 已存在的账号会被提升为管理员（不修改密码）。
import { config } from "../src/config.js";
import { openDb } from "../src/db.js";
import { register, ROLE_ADMIN, UserError } from "../src/users.js";

const [email, password] = process.argv.slice(2);
if (!email || !password) {
    console.error("用法: npx tsx scripts/create-admin.ts <email> <password>");
    process.exit(1);
}
const db = openDb(config.dbFile);
try {
    register(db, email, password, "admin");
} catch (e) {
    if (!(e instanceof UserError) || e.message !== "该邮箱已注册") throw e;
}
db.prepare("UPDATE users SET role = ? WHERE email = ?").run(ROLE_ADMIN, email.trim().toLowerCase());
console.log(`管理员已就绪: ${email}`);
