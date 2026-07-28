/**
 * Cross-app link targets for the Chatbot and Admin SPAs.
 *
 * The three frontends are separate bundles. In AWS they share one CloudFront
 * origin (office ops at `/`, chatbot at `/chat`, admin at `/admin`), but
 * locally each runs on its own Vite dev server. Hence the environment split.
 *
 * These must be rendered as plain `<a href>` navigations, never react-router
 * links: the office SPA has no route for `/chat` or `/admin`, so client-side
 * routing would land on a blank page instead of loading the other bundle.
 */

const DEV_CHATBOT_URL = "http://localhost:5180/chat/";
const DEV_ADMIN_URL = "http://localhost:5181/admin/";

export const chatbotUrl: string =
  import.meta.env.VITE_CHATBOT_URL || (import.meta.env.DEV ? DEV_CHATBOT_URL : "/chat");

export const adminUrl: string =
  import.meta.env.VITE_ADMIN_URL || (import.meta.env.DEV ? DEV_ADMIN_URL : "/admin");
