/**
 * Cross-app link targets for the Office Operations and Admin SPAs.
 *
 * The three frontends are separate bundles. In AWS they share one CloudFront
 * origin (office ops at `/`, chatbot at `/chat`, admin at `/admin`), but
 * locally each runs on its own Vite dev server. Hence the environment split.
 *
 * Navigating to these is a full page load, which is fine: the chatbot resumes
 * from the `?s=<sessionId>` query param, so returning here restores the
 * conversation.
 */

const DEV_OFFICE_OPS_URL = "http://localhost:5173/";
const DEV_ADMIN_URL = "http://localhost:5181/admin/";

export const officeOpsUrl: string =
  import.meta.env.VITE_OFFICE_OPS_URL || (import.meta.env.DEV ? DEV_OFFICE_OPS_URL : "/");

export const adminUrl: string =
  import.meta.env.VITE_ADMIN_URL || (import.meta.env.DEV ? DEV_ADMIN_URL : "/admin");

/**
 * Cognito groups that identify staff. Citizens have no group claims, so the
 * staff links stay hidden for them.
 */
const STAFF_GROUPS = ["admin", "checkin_clerk", "service_clerk"];

export function isStaff(groups: string[] | undefined): boolean {
  return (groups ?? []).some((g) => STAFF_GROUPS.includes(g));
}
