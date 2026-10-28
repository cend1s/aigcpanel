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

    // 用户中心：余额、兑换码、充值、套餐、流水。页面数据全部走 JSON 接口，用 textContent 渲染避免 XSS。
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
<div class="row"><span>可用额度</span><b id="quota">-</b></div>
<div class="row"><span>当前套餐</span><span id="subs">无</span></div>
<h3>兑换码</h3>
<input id="key" placeholder="输入兑换码"><button id="redeem">兑换</button>
<h3>充值</h3>
<select id="provider"></select>
<input id="amount" type="number" min="1" step="1" placeholder="充值金额（元）">
<button id="topup">去支付</button>
<h3>套餐</h3><div id="plans"></div>
<h3>最近流水</h3><div id="ledger"></div>
<div class="msg" id="msg"></div>
<div class="sub"><a href="/logout">退出登录</a></div>
<style>select{width:100%;padding:10px;margin:0 0 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--fg)}h3{margin:20px 0 8px;font-size:15px}.plan{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}.plan button{width:auto;padding:6px 14px}</style>
<script>
const $=id=>document.getElementById(id);
const api=async(u,b={})=>(await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})).json();
const say=t=>{$('msg').textContent=t};
let methods=null;
async function refresh(){
  const b=await api('/api/account/balance'); if(b.code===1001){location.href='/login';return;}
  $('quota').textContent=b.data.quota;
  $('subs').textContent=b.data.subscriptions.map(s=>s.planTitle+'（剩余 '+s.remaining+'）').join('、')||'无';
  const l=await api('/api/account/ledger',{pageSize:10});
  $('ledger').replaceChildren(...l.data.records.map(r=>{const d=document.createElement('div');d.className='row';
    const a=document.createElement('span');a.textContent=r.reason;const c=document.createElement('span');c.textContent=(r.delta>0?'+':'')+r.delta;d.append(a,c);return d;}));
}
async function init(){
  methods=(await api('/api/pay/methods')).data;
  $('provider').replaceChildren(...methods.providers.flatMap(p=>p.methods.map(m=>{const o=document.createElement('option');o.value=p.name+'|'+m.value;o.textContent=m.title;return o;})));
  const pl=await api('/api/plan/list');
  $('plans').replaceChildren(...pl.data.records.map(p=>{const d=document.createElement('div');d.className='plan';
    const t=document.createElement('span');t.textContent=p.title+' · ￥'+(p.priceCents/100)+' / '+p.durationDays+'天 · '+p.quota+' 额度';
    const btn=document.createElement('button');btn.textContent='购买';btn.onclick=()=>pay({kind:'plan',planId:p.id});d.append(t,btn);return d;}));
  await refresh();
}
async function pay(body){
  const [provider,method]=($('provider').value||'|').split('|');
  if(!provider){say('暂无可用的支付方式');return;}
  const r=await api('/api/pay/create',{...body,provider,method});
  if(r.code){say(r.msg);return;}
  window.open(r.data.payUrl,'_blank'); say('已打开支付页面，支付完成后请刷新本页');
}
$('topup').onclick=()=>pay({kind:'topup',amountCents:Math.round(Number($('amount').value)*100)});
$('redeem').onclick=async()=>{const r=await api('/api/account/redeem',{key:$('key').value});say(r.code?r.msg:'兑换成功，到账 '+r.data.quota);if(!r.code)refresh();};
init();
</script>`,
                isDark(req),
            ),
        );
    });
};
