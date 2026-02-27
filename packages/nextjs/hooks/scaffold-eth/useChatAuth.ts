"use client";

import { useCallback, useRef } from "react";
import { useSignMessage } from "wagmi";

const CHAT_SERVER_URL = process.env.NEXT_PUBLIC_CHAT_SERVER_URL || "http://localhost:43001";

type JoinAuthResult = {
  commitment: `0x${string}`;
  salt: string;
  operatorSig: `0x${string}`;
};

/**
 * useChatAuth — authenticates with the chat-server REST API and provides
 * `getJoinAuth()` to obtain commitment + operator signature for room join.
 */
export function useChatAuth() {
  const { signMessageAsync } = useSignMessage({});
  const tokenRef = useRef<string | null>(null);

  const authenticate = useCallback(async (): Promise<string> => {
    if (tokenRef.current) return tokenRef.current;

    const message = `Chat login for RTTA at ${Date.now()}`;
    const signature = await signMessageAsync({ message });

    const res = await fetch(`${CHAT_SERVER_URL}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Chat auth failed");
    }

    const data = await res.json();
    tokenRef.current = data.token;
    return data.token;
  }, [signMessageAsync]);

  const getJoinAuth = useCallback(
    async (roomId: number, isAI: boolean, maxPlayers: number): Promise<JoinAuthResult> => {
      const token = await authenticate();

      const res = await fetch(`${CHAT_SERVER_URL}/api/room-join-auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ roomId, isAI, maxPlayers }),
      });

      if (!res.ok) {
        // Token expired — retry once
        if (res.status === 401) {
          tokenRef.current = null;
          const newToken = await authenticate();
          const retryRes = await fetch(`${CHAT_SERVER_URL}/api/room-join-auth`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${newToken}`,
            },
            body: JSON.stringify({ roomId, isAI, maxPlayers }),
          });
          if (!retryRes.ok) {
            const err = await retryRes.json().catch(() => ({}));
            throw new Error(err.error || "Join auth failed");
          }
          return retryRes.json();
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Join auth failed");
      }

      return res.json();
    },
    [authenticate],
  );

  return { getJoinAuth };
}
