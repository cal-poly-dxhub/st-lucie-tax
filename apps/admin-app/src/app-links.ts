/**
 * Cross-app link targets for the Office Operations and Chatbot SPAs.
 *
 * The three frontends are separate bundles. In AWS they share one CloudFront
 * origin (office ops at `/`, chatbot at `/chat`, admin at `/admin`), but
 * locally each runs on its own Vite dev server. Hence the environment split.
 */

const DEV_OFFICE_OPS_URL = "http://localhost:5173/";
const DEV_CHATBOT_URL = "http://localhost:5180/chat/";

export const officeOpsUrl: string =
  import.meta.env.VITE_OFFICE_OPS_URL || (import.meta.env.DEV ? DEV_OFFICE_OPS_URL : "/");

export const chatbotUrl: string =
  import.meta.env.VITE_CHATBOT_URL || (import.meta.env.DEV ? DEV_CHATBOT_URL : "/chat");
