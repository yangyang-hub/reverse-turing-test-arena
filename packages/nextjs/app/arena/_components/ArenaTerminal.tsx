"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAccount } from "wagmi";
import type { PlayerInfo } from "~~/app/arena/page";
import type { ChatMsg } from "~~/hooks/scaffold-eth/useChatSocket";
import { getAliasName } from "~~/utils/playerAlias";

// import { getTopicForRound } from "~~/utils/topics";

type TerminalMessage = {
  id: string;
  sender: string;
  content: string;
  createdAt: string;
  type: "chat" | "system";
};

function formatTime(createdAt: string): string {
  const date = new Date(createdAt);
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  const s = date.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function getMessageColor(sender: string, content: string, connectedAddress?: string): string {
  if (content.startsWith("[SYSTEM]") || content.startsWith("[VOTE]") || content.startsWith("[PHASE]")) {
    return "text-yellow-400";
  }
  if (content.startsWith("[ELIMINATED]") || content.startsWith("[KILL]")) {
    return "text-red-400";
  }
  if (connectedAddress && sender.toLowerCase() === connectedAddress.toLowerCase()) {
    return "text-cyan-300";
  }
  return "text-green-400";
}

function getTimestampColor(content: string): string {
  if (content.startsWith("[SYSTEM]") || content.startsWith("[VOTE]") || content.startsWith("[PHASE]")) {
    return "text-yellow-700";
  }
  if (content.startsWith("[ELIMINATED]") || content.startsWith("[KILL]")) {
    return "text-red-700";
  }
  return "text-gray-500";
}

export function ArenaTerminal({
  roomId,
  nameMap,
  roomInfo,
  allPlayers,
  myPlayerInfo,
  chatMessages,
  sendMessage,
  isConnected,
  myMessageCount,
}: {
  roomId: bigint;
  nameMap?: Record<string, string>;
  roomInfo: any;
  allPlayers: string[];
  myPlayerInfo?: PlayerInfo;
  currentRound: number;
  chatMessages: ChatMsg[];
  sendMessage: (content: string) => void;
  isConnected: boolean;
  myMessageCount: number;
}) {
  const [inputMessage, setInputMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const { address: connectedAddress } = useAccount();

  const phase = roomInfo && typeof roomInfo === "object" && "phase" in roomInfo ? Number((roomInfo as any).phase) : 0;
  const isGameActive = phase === 1;
  const isMyPlayerAlive = myPlayerInfo?.isAlive ?? false;
  const isPlayerInGame =
    connectedAddress && allPlayers ? allPlayers.some(p => p.toLowerCase() === connectedAddress.toLowerCase()) : false;
  const canSend = isGameActive && isMyPlayerAlive;
  const isSpectator = !isPlayerInGame || !isMyPlayerAlive;

  const MAX_MESSAGES = 6;
  const messagesRemaining = MAX_MESSAGES - myMessageCount;
  const canSendMessage = canSend && messagesRemaining > 0;

  const filteredMessages: TerminalMessage[] = chatMessages.map((msg, idx) => ({
    id: `chat-${msg.id || idx}`,
    sender: msg.sender,
    content: msg.content,
    createdAt: msg.createdAt,
    type: msg.content.startsWith("[") ? ("system" as const) : ("chat" as const),
  }));

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setShouldAutoScroll(scrollHeight - scrollTop - clientHeight < 60);
  }, []);

  useEffect(() => {
    if (shouldAutoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [filteredMessages.length, shouldAutoScroll]);

  const handleSend = async () => {
    if (!inputMessage.trim() || isSending || !canSendMessage || !isConnected) return;
    const message = inputMessage.trim();
    setInputMessage("");
    setIsSending(true);
    try {
      sendMessage(message);
    } catch (err) {
      console.error("Failed to send message:", err);
      setInputMessage(message);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{
        background: "linear-gradient(180deg, #0f1a1f 0%, #0c1518 50%, #0a1215 100%)",
      }}
    >
      {/* Topic Banner at top — commented out */}
      {/* {isGameActive && currentRound > 0 && (
        <div
          className="px-5 py-3"
          style={{
            background: "linear-gradient(90deg, rgba(15, 30, 35, 0.9), rgba(20, 35, 40, 0.95), rgba(15, 30, 35, 0.9))",
            borderBottom: "1px solid rgba(42, 161, 152, 0.2)",
          }}
        >
          <span className="font-mono text-sm font-bold" style={{ color: "#c9a84c" }}>
            RIDOH:{" "}
          </span>
          <span className="text-white font-mono text-sm">{getTopicForRound(currentRound)}</span>
        </div>
      )} */}

      {/* Messages Area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-5 py-4 space-y-0.5"
        style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(42, 161, 152, 0.3) transparent" }}
      >
        {/* System welcome header */}
        <div className="font-mono text-xs mb-4 space-y-0.5" style={{ color: "#4a6a6a" }}>
          <div>
            {"// REVERSE TURING TEST ARENA — ROOM #"}
            {roomId.toString()}
          </div>
          <div>{"// Chat powered by WebSocket (off-chain)"}</div>
          <div>{"// Trust no one. Spot the AI."}</div>
        </div>

        {filteredMessages.length === 0 && (
          <div className="font-mono text-sm text-center py-8" style={{ color: "#4a6a6a" }}>
            <div className="mb-2">No messages yet.</div>
            <div className="text-xs">Be the first to speak... if you dare.</div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {filteredMessages.map(msg => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className="font-mono text-sm leading-relaxed"
            >
              <span className={getTimestampColor(msg.content)}>[{formatTime(msg.createdAt)}]</span>{" "}
              <span
                className={
                  connectedAddress && msg.sender.toLowerCase() === connectedAddress.toLowerCase()
                    ? "text-cyan-400 font-bold"
                    : "text-purple-400"
                }
              >
                {getAliasName(allPlayers, msg.sender, nameMap)}:
              </span>{" "}
              <span className={getMessageColor(msg.sender, msg.content, connectedAddress)}>{msg.content}</span>
            </motion.div>
          ))}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* Bottom: nothing for ended games, Spectator badge, or Player input */}
      {!isGameActive ? null : isSpectator ? (
        <div
          className="flex justify-center py-5"
          style={{
            borderTop: "1px solid rgba(42, 161, 152, 0.25)",
            background: "linear-gradient(90deg, #0c1518, #0e1a1e, #0c1518)",
          }}
        >
          <div
            className="px-8 py-3 font-mono text-base font-bold tracking-wider"
            style={{
              border: "2px solid #2aa198",
              color: "#d0d0d0",
              background: "rgba(10, 25, 30, 0.9)",
              boxShadow: "0 0 15px rgba(42, 161, 152, 0.15)",
            }}
          >
            Spectator mode
          </div>
        </div>
      ) : (
        <div
          className="p-4"
          style={{
            borderTop: "2px solid rgba(42, 161, 152, 0.4)",
            background: "linear-gradient(90deg, #101e22, #132428, #101e22)",
          }}
        >
          <div
            className="flex items-center gap-3 px-5 py-4 rounded-lg"
            style={{
              border: "2px solid rgba(42, 161, 152, 0.5)",
              background: "rgba(15, 35, 40, 0.9)",
              boxShadow: "0 0 12px rgba(42, 161, 152, 0.12), inset 0 0 8px rgba(42, 161, 152, 0.05)",
            }}
          >
            <span className="font-mono text-sm shrink-0" style={{ color: "#2aa198" }}>
              {connectedAddress ? getAliasName(allPlayers, connectedAddress, nameMap) : "anon"}@arena $
            </span>
            <input
              type="text"
              value={inputMessage}
              onChange={e => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                !canSend
                  ? "Spectator mode"
                  : !canSendMessage
                    ? "Message limit reached"
                    : !isConnected
                      ? "Connecting..."
                      : "Type your message..."
              }
              disabled={isSending || !canSendMessage || !isConnected}
              className="flex-1 bg-transparent border-none outline-none font-mono disabled:opacity-50"
              style={{ color: "#66ccbb", fontSize: "15px", caretColor: "#2aa198" }}
              maxLength={280}
            />
            <button
              onClick={handleSend}
              disabled={!inputMessage.trim() || isSending || !canSendMessage || !isConnected}
              className="disabled:cursor-not-allowed disabled:opacity-30 flex items-center gap-2 shrink-0"
              style={{
                padding: "10px 24px",
                border: "2px solid #2aa198",
                borderRadius: "6px",
                fontFamily: "var(--font-mono)",
                fontSize: "14px",
                fontWeight: "bold",
                letterSpacing: "0.1em",
                color: "#ffffff",
                background: "rgba(42, 161, 152, 0.2)",
                transition: "all 0.15s",
              }}
            >
              {isSending ? (
                <span className="animate-pulse">...</span>
              ) : (
                <>
                  SEND
                  {canSend && (
                    <span style={{ fontSize: "11px", color: "#6aadaa" }}>
                      [{messagesRemaining}/{MAX_MESSAGES}]
                    </span>
                  )}
                </>
              )}
            </button>
          </div>
          <div className="flex items-center justify-between mt-2 px-2">
            <span className="font-mono text-xs" style={{ color: "#3a5a5a" }}>
              {inputMessage.length}/280
            </span>
            {!isConnected && <span className="text-yellow-600 font-mono text-xs animate-pulse">Reconnecting...</span>}
          </div>
        </div>
      )}
    </div>
  );
}
