const CHAT_TOKEN_KEY = "rtta_chat_token";

type StoredToken = { token: string; address: string };

export function getStoredChatToken(): StoredToken | null {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(CHAT_TOKEN_KEY) : null;
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function storeChatToken(token: string, address: string) {
  try {
    localStorage.setItem(CHAT_TOKEN_KEY, JSON.stringify({ token, address: address.toLowerCase() }));
  } catch {
    // localStorage not available (SSR, private browsing)
  }
}

export function clearChatToken() {
  try {
    localStorage.removeItem(CHAT_TOKEN_KEY);
  } catch {
    // silent
  }
}
