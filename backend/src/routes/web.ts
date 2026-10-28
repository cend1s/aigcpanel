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

// 登录/注册/找回密码页共用的脚本：图形验证码、发送邮件验证码（60 秒倒计时）、提交
const AUTH_SCRIPT = `
const $=id=>document.getElementById(id);
const say=(t,ok)=>{const m=$('msg');m.textContent=t||'';m.style.color=ok?'#00b42a':'#f53f3f';};
let capId='';
async function loadCaptcha(){
  const r=await (await fetch('/api/auth/captcha')).json();
  if(r.code)return;
  capId=r.data.id; $('capimg').innerHTML=r.data.svg; $('captcha').value='';
}
function showCaptcha(){ $('caprow').style.display='flex'; loadCaptcha(); }
async function call(url,body){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{return await r.json();}catch(e){return {code:r.status,msg:'请求失败（'+r.status+'）',data:{}};}
}
function captchaBody(){ return $('caprow').style.display==='none'?{}:{captchaId:capId,captchaCode:$('captcha').value}; }
async function sendCode(purpose){
  const btn=$('sendcode'); if(btn.disabled)return;
  const r=await call('/api/auth/send-code',{email:$('email').value,purpose,...captchaBody()});
  loadCaptcha(); // 图形验证码一次性，每次请求后都换新
  if(r.code){say(r.msg);return;}
  say(r.data.message,true);
  let n=60; btn.disabled=true;
  const t=setInterval(()=>{btn.textContent=n+' 秒后重发'; if(--n<0){clearInterval(t);btn.disabled=false;btn.textContent='获取验证码';}},1000);
}`;

const CAPTCHA_ROW = (visible: boolean) => `
<div id="caprow" class="caprow" style="display:${visible ? "flex" : "none"}">
  <input id="captcha" placeholder="图形验证码" maxlength="6" autocomplete="off">
  <span id="capimg" title="看不清？点击换一张" onclick="loadCaptcha()"></span>
</div>`;

const AUTH_STYLE = `<style>.caprow{gap:8px;align-items:flex-start}.caprow input{flex:1}#capimg{cursor:pointer;height:40px;border-radius:8px;overflow:hidden;background:#fff}
.coderow{display:flex;gap:8px}.coderow input{flex:1}.coderow button{width:auto;white-space:nowrap;padding:10px 12px}.coderow button:disabled{opacity:.6;cursor:not-allowed}
.links{display:flex;justify-content:space-between;margin-top:16px}</style>`;

const loginPage = (dark: boolean) =>
    layout(
        "登录",
        `${AUTH_STYLE}<h1>登录</h1>
<div class="msg" id="msg"></div>
<input id="email" type="email" placeholder="邮箱" autocomplete="email">
<input id="password" type="password" placeholder="密码" autocomplete="current-password">
${CAPTCHA_ROW(false)}
<button id="submit">登录</button>
<div class="links sub"><a href="/register">注册新账号</a><a href="/login?mode=forgot">忘记密码？</a></div>
<script>${SYNC_SCRIPT}${AUTH_SCRIPT}
$('submit').onclick=async()=>{
  say('');
  const r=await call('/api/auth/login',{email:$('email').value,password:$('password').value,...captchaBody()});
  if(r.code){
    say(r.msg);
    // 失败次数达到阈值后，后端要求图形验证码
    if(r.data&&r.data.type==='CaptchaRequired'){showCaptcha();}else if($('caprow').style.display!=='none'){loadCaptcha();}
    return;
  }
  await syncToApp(r.data);
  location.href='/app_manager/user'+location.search;
};
$('password').addEventListener('keydown',e=>{if(e.key==='Enter')$('submit').click();});
</script>`,
        dark,
    );

const registerPage = (dark: boolean) =>
    layout(
        "注册",
        `${AUTH_STYLE}<h1>注册</h1>
<div class="msg" id="msg"></div>
<input id="email" type="email" placeholder="邮箱" autocomplete="email">
${CAPTCHA_ROW(true)}
<div class="coderow"><input id="code" placeholder="邮箱验证码" maxlength="6" inputmode="numeric" autocomplete="one-time-code"><button id="sendcode" type="button">获取验证码</button></div>
<input id="nickname" placeholder="昵称（可选）" maxlength="20" style="margin-top:12px">
<input id="password" type="password" placeholder="密码（8 位以上，含字母和数字）" autocomplete="new-password">
<button id="submit">注册</button>
<div class="sub">已有账号？<a href="/login">去登录</a></div>
<script>${SYNC_SCRIPT}${AUTH_SCRIPT}
loadCaptcha();
$('sendcode').onclick=()=>sendCode('register');
$('submit').onclick=async()=>{
  say('');
  const r=await call('/api/auth/register',{email:$('email').value,code:$('code').value,nickname:$('nickname').value,password:$('password').value});
  if(r.code){say(r.msg);return;}
  await syncToApp(r.data);
  location.href='/app_manager/user'+location.search;
};
</script>`,
        dark,
    );

const forgotPage = (dark: boolean) =>
    layout(
        "找回密码",
        `${AUTH_STYLE}<h1>找回密码</h1>
<div class="msg" id="msg"></div>
<input id="email" type="email" placeholder="注册时使用的邮箱" autocomplete="email">
${CAPTCHA_ROW(true)}
<div class="coderow"><input id="code" placeholder="邮箱验证码" maxlength="6" inputmode="numeric" autocomplete="one-time-code"><button id="sendcode" type="button">获取验证码</button></div>
<input id="password" type="password" placeholder="新密码（8 位以上，含字母和数字）" autocomplete="new-password" style="margin-top:12px">
<button id="submit">重置密码</button>
<div class="sub"><a href="/login">返回登录</a></div>
<script>${AUTH_SCRIPT}
loadCaptcha();
$('sendcode').onclick=()=>sendCode('reset');
$('submit').onclick=async()=>{
  say('');
  const r=await call('/api/auth/reset-password',{email:$('email').value,code:$('code').value,password:$('password').value});
  if(r.code){say(r.msg);return;}
  say('密码已重置，所有设备上的登录已失效，请用新密码登录',true);
  setTimeout(()=>{location.href='/login';},1500);
};
</script>`,
        dark,
    );

const isDark = (req: FastifyRequest) =>
    (req.query as Record<string, string | undefined>).is_dark === "1";

export const webRoutes = (app: FastifyInstance, db: Db) => {
    // 找回密码用 /login?mode=forgot：桌面端的用户窗口只允许 /login、/register、/logout 在窗口内打开，
    // 走同一路径可以留在应用内完成；/forgot 供普通浏览器直接访问
    app.get("/login", async (req, reply) =>
        reply
            .type("text/html")
            .send((req.query as any).mode === "forgot" ? forgotPage(isDark(req)) : loginPage(isDark(req))),
    );
    app.get("/forgot", async (req, reply) => reply.type("text/html").send(forgotPage(isDark(req))));
    app.get("/register", async (req, reply) => reply.type("text/html").send(registerPage(isDark(req))));

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
