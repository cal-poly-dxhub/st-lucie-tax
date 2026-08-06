import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const creds = Object.fromEntries(readFileSync(process.env.CREDS,"utf8").split("\n").filter(Boolean).map(l=>{const i=l.indexOf("=");return[l.slice(0,i),l.slice(i+1)];}));
const SID = process.env.SID;
(async()=>{
  const b=await chromium.launch({headless:true});const p=await b.newPage();
  let API=null; p.on("request",r=>{const u=r.url();if(!API&&u.includes("/chatbot/"))API=u.slice(0,u.indexOf("/chatbot/"));});
  await p.goto("https://st-lucie-tax-collector.calpoly.io/chat/",{waitUntil:"networkidle",timeout:60000});
  await new Promise(r=>setTimeout(r,1500));
  const e=p.locator('input[type=email]').first();
  if(await e.count()){await e.fill(creds.USER||creds.LIVE_USER);await p.locator('input[type=password]').first().fill(creds.PASS||creds.LIVE_PASS);await p.getByRole("button",{name:/sign in/i}).first().click();await new Promise(r=>setTimeout(r,6000));}
  await p.waitForLoadState("networkidle").catch(()=>{});
  const out=await p.evaluate(async({apiBase,sid})=>{
    let auth={};try{const k=Object.keys(localStorage).filter(k=>/CognitoIdentityServiceProvider.*idToken/.test(k));if(k.length)auth={Authorization:`Bearer ${localStorage.getItem(k[0])}`};}catch{}
    const r=await fetch(`${apiBase}/chatbot/session-state/${sid}`,{headers:auth});
    if(!r.ok)return{error:r.status};
    const j=await r.json();
    const ctx=j.structuredContext||{};
    return { state:j.currentState||j.state, documents:ctx.documents, resolvedBuckets:ctx.resolvedBuckets };
  },{apiBase:API,sid:SID});
  console.log(JSON.stringify(out,null,2));
  await b.close();
})().catch(e=>{console.log("FATAL",e.message);process.exit(1);});
