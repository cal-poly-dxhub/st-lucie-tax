// Re-fetch the raw AuthID proof result for a given operationId using the app's
// own client + creds, then run it through the real decide() classifier to see
// exactly why it was rejected. Read-only against the AuthID UAT API.
import { readFileSync } from "node:fs";
// load .env for AUTHID_API_KEY_ID / VALUE / BASE_URL
for (const line of readFileSync(".env","utf8").split("\n")) {
  const i=line.indexOf("="); if(i>0 && !line.startsWith("#")){ const k=line.slice(0,i).trim(); if(!process.env[k]) process.env[k]=line.slice(i+1).trim(); }
}
const OP = process.env.OP;
const { getProofResult, getOperationStatus } = await import("./services/chatbot/src/authid/client.ts").catch(()=>import("../../services/chatbot/src/authid/client.js"));
const { decide } = await import("./services/chatbot/src/authid/decision.ts").catch(()=>import("../../services/chatbot/src/authid/decision.js"));

try {
  const status = await getOperationStatus(OP).catch(e=>({error:String(e)}));
  console.log("=== OPERATION STATUS ==="); console.log(JSON.stringify(status,null,2).slice(0,800));
  const raw = await getProofResult(OP);
  console.log("\n=== RAW PROOF RESULT (Payload.Data keys + values) ===");
  const data = raw?.Payload?.Data ?? {};
  // print the anti-fraud + core signal fields specifically
  const keys = Object.keys(data);
  console.log("ALL Payload.Data keys:", JSON.stringify(keys));
  const interesting = ["Matched","LivenessDetectionResult","SelfieInjectionAttackDetectionResult","selfieInjectionAttackDetectionResult","BarcodeSecurity","barcodeSecurity","PadResult","padResult","DocumentInjectionAttackDetectionResult","documentInjectionAttackDetectionResult","MatchScore"];
  for (const k of interesting) if (k in data) console.log(`  ${k}:`, JSON.stringify(data[k]));
  console.log("\n=== decide() VERDICT ===");
  console.log(JSON.stringify(decide(raw),null,2));
} catch(e){ console.log("FATAL", e.message); }
