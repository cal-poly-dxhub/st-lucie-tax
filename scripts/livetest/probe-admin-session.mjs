import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const creds = Object.fromEntries(readFileSync(process.env.CREDS,"utf8").split("\n").filter(Boolean).map(l=>{const i=l.indexOf("=");return[l.slice(0,i),l.slice(i+1)];}));
const SID = process.env.SID;
(async()=>{
  const b=await chromium.launch({headless:true});const p=await b.newPage();
  await p.goto("https://st-lucie-tax-collector.calpoly.io/admin/",{waitUntil:"networkidle",timeout:60000});
  await new Promise(r=>setTimeout(r,1500));
  const e=p.locator('input[type=email]').first();
  if(await e.count()){await e.fill(creds.USER||creds.LIVE_USER);await p.locator('input[type=password]').first().fill(creds.PASS||creds.LIVE_PASS);await p.getByRole("button",{name:/sign in/i}).first().click();await new Promise(r=>setTimeout(r,7000));}
  await p.waitForLoadState("networkidle").catch(()=>{});
  const out=await p.evaluate(async(sid)=>{
    let auth={};try{const k=Object.keys(localStorage).filter(x=>/CognitoIdentityServiceProvider.*idToken/.test(x));if(k.length)auth={Authorization:`Bearer ${localStorage.getItem(k[0])}`};}catch{}
    // admin API base is /api/admin, route /admin/sessions/:id
    const r=await fetch(`/api/admin/admin/sessions/${sid}`,{headers:auth});
    if(!r.ok)return{error:r.status,text:(await r.text()).slice(0,200)};
    return await r.json();
  },SID);
  console.log(JSON.stringify(out));
  await b.close();
})().catch(e=>{console.log("FATAL "+e.message);process.exit(1);});
