import { pool } from "../db.js";
import { generateDurationRecommendations } from "../../src/generate-recommendations.js";

// EventBridge-scheduled (nightly) worker. Recomputes duration recommendations
// from service_history and upserts pending rows for admin approval. The
// computation already exists in src/; this is just the scheduled trigger.
export async function handler(): Promise<{ generated: number }> {
  const recommendations = await generateDurationRecommendations(pool);
  console.log(`Generated ${recommendations.length} duration recommendation(s)`);
  return { generated: recommendations.length };
}
