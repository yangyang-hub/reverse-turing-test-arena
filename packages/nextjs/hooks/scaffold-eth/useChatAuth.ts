"use client";

import { useCallback, useRef } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { clearChatToken, getStoredChatToken, storeChatToken } from "~~/utils/chatToken";

const CHAT_SERVER_URL = process.env.NEXT_PUBLIC_CHAT_SERVER_URL || "http://localhost:43001";

type JoinAuthResult = {
  commitment: `0x${string}`;
  salt: string;
  operatorSig: `0x${string}`;
};

/**
 * useChatAuth — authenticates with the chat-server REST API and provides
 * `getJoinAuth()` to obtain commitment + operator signature for room join.
 *
 * Token is persisted in localStorage so page refreshes don't require re-signing.
 */
export function useChatAuth() {
  const { signMessageAsync } = useSignMessage({});
  const { address } = useAccount();
  const tokenRef = useRef<string | null>(null);

  const authenticate = useCallback(async (): Promise<string> => {
    // 1. Check in-memory cache
    if (tokenRef.current) return tokenRef.current;

    // 2. Check localStorage (survives page refresh)
    const stored = getStoredChatToken();
    if (stored && stored.address === address?.toLowerCase()) {
      tokenRef.current = stored.token;
      return stored.token;
    }

    // 3. Need fresh SIWE signature
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
    storeChatToken(data.token, data.address);
    return data.token;
  }, [signMessageAsync, address]);

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
        // Token expired — clear cache and retry once
        if (res.status === 401) {
          tokenRef.current = null;
          clearChatToken();
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

  const updateRoomId = useCallback(
    async (newRoomId: number): Promise<void> => {
      const token = await authenticate();
      const res = await fetch(`${CHAT_SERVER_URL}/api/room-join-auth/update-room-id`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newRoomId }),
      });
      if (!res.ok) {
        console.warn("[ChatAuth] Failed to update room ID:", await res.text());
      }
    },
    [authenticate],
  );

  const deleteIdentity = useCallback(
    async (roomId: number): Promise<void> => {
      const token = await authenticate();
      const res = await fetch(`${CHAT_SERVER_URL}/api/room-join-auth/leave`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ roomId }),
      });
      if (!res.ok) {
        console.warn("[ChatAuth] Failed to delete identity:", await res.text());
      }
    },
    [authenticate],
  );

  return { getJoinAuth, updateRoomId, deleteIdentity };
}
