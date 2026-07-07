export interface RuntimeConfig {
  userPoolId: string;
  userPoolClientId: string;
  chatbotApiUrl: string;
}

let cached: RuntimeConfig | null = null;

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (cached) return cached;
  try {
    const res = await fetch("/config.json");
    if (res.ok) {
      cached = await res.json();
      return cached!;
    }
  } catch {
    // Local dev — no config.json served
  }
  cached = {
    userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? "",
    userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? "",
    chatbotApiUrl: import.meta.env.VITE_API_URL ?? "",
  };
  return cached;
}
