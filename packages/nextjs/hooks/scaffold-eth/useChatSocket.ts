"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";

export type ChatMsg = {
  id?: number;
  roomId: number;
  round: number;
  sender: string;
  content: string;
  createdAt: string;
};

// Env var takes precedence; otherwise auto-detect ws/wss from page protocol
function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_CHAT_SERVER_WS_URL) {
    return process.env.NEXT_PUBLIC_CHAT_SERVER_WS_URL;
  }
  // Derive from REST URL if available (http→ws, https→wss)
  const restUrl = process.env.NEXT_PUBLIC_CHAT_SERVER_URL;
  if (restUrl) {
    return restUrl.replace(/^http/, "ws") + "/ws";
  }
  // Fallback: match page protocol
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return "wss://localhost:43001/ws";
  }
  return "ws://localhost:43001/ws";
}

/**
 * useChatSocket — connects to the chat-server via native WebSocket.
 * Handles auth (SIWE signature), room join, and real-time message streaming.
 */
export function useChatSocket(roomId: number | undefined) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage({});
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [myMessageCount, setMyMessageCount] = useState(0);
  const [myIsAI, setMyIsAI] = useState<boolean | undefined>(undefined);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Track per-round message count for the connected user
  useEffect(() => {
    if (!address || !messages.length) {
      setMyMessageCount(0);
      return;
    }
    // Find the latest round in messages
    const latestRound = Math.max(...messages.map(m => m.round));
    const count = messages.filter(
      m => m.round === latestRound && m.sender.toLowerCase() === address.toLowerCase(),
    ).length;
    setMyMessageCount(count);
  }, [messages, address]);

  useEffect(() => {
    if (!roomId || !address) return;

    let ws: WebSocket;
    let closed = false;

    const connect = () => {
      try {
        ws = new WebSocket(getWsUrl());
      } catch (err) {
        // SecurityError: mixed content (HTTPS page + ws:// endpoint)
        console.warn("[ChatSocket] Failed to connect:", err);
        return;
      }
      wsRef.current = ws;

      ws.onopen = async () => {
        try {
          const message = `Chat login for RTTA at ${Date.now()}`;
          const signature = await signMessageAsync({ message });
          ws.send(JSON.stringify({ type: "auth", message, signature }));
        } catch {
          // User rejected signature — close connection
          ws.close();
        }
      };

      ws.onmessage = event => {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case "auth_ok":
            ws.send(JSON.stringify({ type: "join_room", roomId }));
            setIsConnected(true);
            break;
          case "room_joined":
            setMessages(
              (data.messages || []).map((m: any) => ({
                id: m.id,
                roomId: m.roomId,
                round: m.round,
                sender: m.sender,
                content: m.content,
                createdAt: m.createdAt,
              })),
            );
            if (data.isAI !== undefined && data.isAI !== null) {
              setMyIsAI(Boolean(data.isAI));
            }
            break;
          case "new_message":
            setMessages(prev => [
              ...prev,
              {
                id: data.id,
                roomId: data.roomId,
                round: data.round,
                sender: data.sender,
                content: data.content,
                createdAt: data.createdAt,
              },
            ]);
            break;
          case "error":
            console.warn("[ChatSocket] Error:", data.code, data.message);
            break;
          default:
            console.warn("[ChatSocket] Unknown message type:", data.type);
            break;
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        // Auto-reconnect after 3s unless intentionally closed
        if (!closed) {
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror
      };
    };

    connect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
      setIsConnected(false);
      setMessages([]);
    };
  }, [roomId, address, signMessageAsync]);

  const sendMessage = useCallback(
    (content: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "send_message", roomId, content }));
      }
    },
    [roomId],
  );

  return { messages, sendMessage, isConnected, myMessageCount, myIsAI };
}
