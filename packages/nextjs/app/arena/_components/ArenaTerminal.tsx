"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAccount } from "wagmi";
import type { PlayerInfo } from "~~/app/arena/page";
import type { ChatMsg } from "~~/hooks/scaffold-eth/useChatSocket";
import { getAliasName } from "~~/utils/playerAlias";
import { getTopicForRound } from "~~/utils/topics";

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
    return "text-yellow-600";
  }
  if (content.startsWith("[ELIMINATED]") || content.startsWith("[KILL]")) {
    return "text-red-600";
  }
  return "text-gray-600";
}

export function ArenaTerminal({
  roomId,
  nameMap,
  roomInfo,
  allPlayers,
  myPlayerInfo,
  currentRound,
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
  // Channel exclusivity is enforced server-side — no need to check isAI here
  const canSend = isGameActive && isMyPlayerAlive;

  // Message limit per round
  const MAX_MESSAGES = 6;
  const messagesRemaining = MAX_MESSAGES - myMessageCount;
  const canSendMessage = canSend && messagesRemaining > 0;

  // Transform chat messages to terminal format
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
    <div className="flex flex-col h-full bg-gray-950">
      {/* Terminal Header */}
      <div className="flex flex-col border-b border-green-900/40 bg-black/60">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
            </div>
            <span className="text-green-500/70 font-mono text-xs ml-2">arena://room-{roomId.toString()}/terminal</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-600 font-mono text-xs">{filteredMessages.length} msgs</span>
            {isConnected ? (
              <div className="w-2 h-2 rounded-full bg-green-400" title="WebSocket connected" />
            ) : (
              <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" title="Reconnecting..." />
            )}
          </div>
        </div>
        {/* Discussion topic */}
        {isGameActive && currentRound > 0 && (
          <div className="px-4 py-1.5 border-t border-green-900/20 bg-green-950/10">
            <span className="text-gray-500 font-mono text-xs">TOPIC: </span>
            <span className="text-cyan-400 font-mono text-xs">{getTopicForRound(currentRound)}</span>
          </div>
        )}
      </div>

      {/* Messages Area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-green-900/40"
      >
        {/* Welcome message */}
        <div className="text-gray-600 font-mono text-xs mb-4 pb-2 border-b border-gray-800/50">
          <div>{"// ============================================"}</div>
          <div>
            {"//  REVERSE TURING TEST ARENA - ROOM #"}
            {roomId.toString()}
          </div>
          <div>{"//  Chat powered by WebSocket (off-chain)"}</div>
          <div>{"//  Trust no one. Spot the AI."}</div>
          <div>{"// ============================================"}</div>
        </div>

        {filteredMessages.length === 0 && (
          <div className="text-gray-600 font-mono text-sm text-center py-8">
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
              className="font-mono text-sm leading-relaxed group"
            >
              <span className={getTimestampColor(msg.content)}>[{formatTime(msg.createdAt)}]</span>{" "}
              <span
                className={
                  connectedAddress && msg.sender.toLowerCase() === connectedAddress.toLowerCase()
                    ? "text-cyan-500 font-bold"
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

      {/* Input Area */}
      <div className="border-t border-green-900/40 bg-black/60 p-3">
        <div className="flex items-center gap-2">
          <span className="text-green-500 font-mono text-sm shrink-0">
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
                  ? "Message limit reached (3/round)"
                  : !isConnected
                    ? "Connecting to chat..."
                    : "Type your message..."
            }
            disabled={isSending || !canSendMessage || !isConnected}
            className="flex-1 bg-transparent border-none outline-none text-green-400 font-mono text-sm placeholder-gray-700 caret-green-400 disabled:opacity-50"
            maxLength={280}
          />
          <button
            onClick={handleSend}
            disabled={!inputMessage.trim() || isSending || !canSendMessage || !isConnected}
            className={`px-3 py-1 border font-mono text-xs transition-colors disabled:cursor-not-allowed flex items-center gap-1.5 ${
              messagesRemaining <= 0
                ? "border-red-700/50 text-red-500 opacity-50"
                : messagesRemaining === 1
                  ? "border-yellow-700/50 text-yellow-400 hover:bg-yellow-900/20 disabled:opacity-30"
                  : "border-green-700/50 text-green-400 hover:bg-green-900/20 disabled:opacity-30"
            }`}
          >
            {isSending ? (
              <span className="animate-pulse">...</span>
            ) : (
              <>
                SEND
                {canSend && (
                  <span
                    className={`text-[10px] ${
                      messagesRemaining <= 0
                        ? "text-red-500"
                        : messagesRemaining === 1
                          ? "text-yellow-500"
                          : "text-gray-500"
                    }`}
                  >
                    [{messagesRemaining}/{MAX_MESSAGES}]
                  </span>
                )}
              </>
            )}
          </button>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-gray-700 font-mono text-xs">{inputMessage.length}/280</span>
          {!isConnected && <span className="text-yellow-600 font-mono text-xs animate-pulse">Reconnecting...</span>}
        </div>
      </div>
    </div>
  );
}
