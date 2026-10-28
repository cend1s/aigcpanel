import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "../db.js";
import { currentUser } from "../session.js";

const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const layout = (title: string, body: string, dark: boolean) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f4f5f7;--card:#fff;--fg:#1d2129;--sub:#86909c;--line:#e5e6eb;--pri:#165dff}
body[data-theme=dark]{--bg:#17171a;--card:#232324;--fg:#f2f3f5;--sub:#a9aeb8;--line:#3a3a3d}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 system-ui,sans-serif;display:flex;justify-content:center;padding:48px 16px}
.card{width:100%;max-width:380px;background:var(--card);border-radius:12px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
h1{font-size:20px;margin:0 0 20px}
input{width:100%;box-sizing:border-box;margin:0 0 12px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--fg);font:inherit}
button{width:100%;padding:10px;border:0;border-radius:8px;background:var(--pri);color:#fff;font:inherit;cursor:pointer}
.msg{color:#f53f3f;min-height:22px;margin-bottom:8px}.sub{color:var(--sub);margin-top:16px;text-align:center}
a{color:var(--pri);text-decoration:none}.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)}
</style></head>
<body${dark ? ' data-theme="dark"' : ""}><div class="card">${body}</div></body></html>`;

// 把登录态同步给桌面端：webview 的 preload 暴露了 window.$mapi；在普通浏览器里没有则跳过
const SYNC_SCRIPT = `
async function syncToApp(payload){
  try{ if(window.$mapi&&window.$mapi.user&&window.$mapi.user.save){ await window.$mapi.user.save(payload); } }catch(e){}
}`;

const authPage = (kind: "login" | "register", dark: boolean) => {
    const isLogin = kind === "login";
    return layout(
        isLogin ? "登录" : "注册",
        `<h1>${isLogin ? "登录" : "注册"}</h1>
<div class="msg" id="msg"></div>
<input id="email" type="email" placeholder="邮箱" autocomplete="email">
${isLogin ? "" : '<input id="nickname" placeholder="昵称（可选）" maxlength="20">'}
<input id="password" type="password" placeholder="密码（至少 8 位）" autocomplete="${isLogin ? "current-password" : "new-password"}">
<button id="submit">${isLogin ? "登录" : "注册"}</button>
<div class="sub">${isLogin ? '没有账号？<a href="/register">去注册</a>' : '已有账号？<a href="/login">去登录</a>'}</div>
<script>${SYNC_SCRIPT}
document.getElementById('submit').onclick=async()=>{
  const msg=document.getElementById('msg'); msg.textContent='';
  const body={email:email.value,password:password.value${isLogin ? "" : ",nickname:nickname.value"}};
  const r=await fetch('/api/auth/${isLogin ? "login" : "register"}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json();
  if(j.code){msg.textContent=j.msg;return;}
  await syncToApp(j.data);
  location.href='/app_manager/user'+location.search;
};</script>`,
        dark,
    );
};

const isDark = (req: FastifyRequest) =>
    (req.query as Record<string, string | undefined>).is_dark === "1";

export const webRoutes = (app: FastifyInstance, db: Db) => {
    app.get("/login", async (req, reply) =>
        reply.type("text/html").send(authPage("login", isDark(req))),
    );
    app.get("/register", async (req, reply) =>
        reply.type("text/html").send(authPage("register", isDark(req))),
    );

    app.get("/logout", async (req, reply) => {
        reply.type("text/html").send(
            layout(
                "退出登录",
                `<h1>已退出登录</h1><div class="sub"><a href="/login">重新登录</a></div>
<script>${SYNC_SCRIPT}
(async()=>{await fetch('/api/auth/logout',{method:'POST'});
await syncToApp({apiToken:'',user:{id:'',name:'',avatar:'',deviceCode:''},data:{functions:{}},basic:{userEnable:true}});})();</script>`,
                isDark(req),
            ),
        );
    });

    // 用户中心（会员页），P1/P2 起加入余额、流水、充值、套餐
    app.get("/app_manager/user", async (req, reply) => {
        const user = currentUser(db, req);
        if (!user) {
            return reply.redirect("/login", 302);
        }
        return reply.type("text/html").send(
            layout(
                "用户中心",
                `<h1>${esc(user.nickname)}</h1>
<div class="row"><span>邮箱</span><span>${esc(user.email)}</span></div>
<div class="row"><span>可用额度</span><span>${user.quota}</span></div>
<div class="sub"><a href="/logout">退出登录</a></div>`,
                isDark(req),
            ),
        );
    });
};
