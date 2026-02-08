"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAccount } from "wagmi";
import { useScaffoldEventHistory, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

type TerminalMessage = {
  id: string;
  sender: string;
  content: string;
  timestamp: bigint;
  roomId: bigint;
  type: "chat" | "system";
};

function formatTime(timestamp: bigint): string {
  const date = new Date(Number(timestamp) * 1000);
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  const s = date.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
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

export function ArenaTerminal({ roomId }: { roomId: bigint }) {
  const [inputMessage, setInputMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const { address: connectedAddress } = useAccount();

  const { data: roomInfo } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRoomInfo",
    args: [roomId],
  });

  const zeroAddr = "0x0000000000000000000000000000000000000000" as const;
  const { data: myPlayerInfo } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getPlayerInfo",
    args: [roomId, connectedAddress ?? zeroAddr],
  });

  const isGameActive =
    roomInfo && typeof roomInfo === "object" && "isActive" in roomInfo ? Boolean((roomInfo as any).isActive) : false;
  const isMyPlayerAlive =
    myPlayerInfo && typeof myPlayerInfo === "object" && "isAlive" in myPlayerInfo
      ? Boolean((myPlayerInfo as any).isAlive)
      : false;
  const canSend = isGameActive && isMyPlayerAlive;
  const startBlock =
    roomInfo && typeof roomInfo === "object" && "startBlock" in roomInfo ? BigInt((roomInfo as any).startBlock) : 0n;

  const { data: messageEvents, isLoading: eventsLoading } = useScaffoldEventHistory({
    contractName: "TuringArena",
    eventName: "NewMessage",
    fromBlock: startBlock || 0n,
    watch: true,
  });

  const { writeContractAsync, isMining } = useScaffoldWriteContract({
    contractName: "TuringArena",
  });

  const filteredMessages: TerminalMessage[] = (messageEvents || [])
    .filter(event => {
      const args = event.args as any;
      if (!args) return false;
      return BigInt(args.roomId) === roomId;
    })
    .map((event, idx) => {
      const args = event.args as any;
      return {
        id: `${event.transactionHash}-${event.logIndex}-${idx}`,
        sender: args.sender as string,
        content: args.content as string,
        timestamp: BigInt(args.timestamp),
        roomId: BigInt(args.roomId),
        type: (args.content as string).startsWith("[") ? ("system" as const) : ("chat" as const),
      };
    })
    .sort((a, b) => Number(a.timestamp - b.timestamp));

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
    if (!inputMessage.trim() || isSending || isMining || !canSend) return;

    const message = inputMessage.trim();
    setInputMessage("");
    setIsSending(true);

    try {
      await writeContractAsync({
        functionName: "sendMessage",
        args: [roomId, message],
      });
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
      <div className="flex items-center justify-between px-4 py-2 border-b border-green-900/40 bg-black/60">
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
          {eventsLoading && <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />}
        </div>
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
          <div>{"//  All messages are stored on-chain via events"}</div>
          <div>{"//  Trust no one. Prove your humanity."}</div>
          <div>{"// ============================================"}</div>
        </div>

        {filteredMessages.length === 0 && !eventsLoading && (
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
              <span className={getTimestampColor(msg.content)}>[{formatTime(msg.timestamp)}]</span>{" "}
              <span
                className={
                  connectedAddress && msg.sender.toLowerCase() === connectedAddress.toLowerCase()
                    ? "text-cyan-500 font-bold"
                    : "text-purple-400"
                }
              >
                {truncateAddress(msg.sender)}:
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
            {connectedAddress ? truncateAddress(connectedAddress) : "anon"}@arena $
          </span>
          <input
            type="text"
            value={inputMessage}
            onChange={e => setInputMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              !canSend ? "Spectator mode" : isSending || isMining ? "Transmitting to chain..." : "Type your message..."
            }
            disabled={isSending || isMining || !canSend}
            className="flex-1 bg-transparent border-none outline-none text-green-400 font-mono text-sm placeholder-gray-700 caret-green-400 disabled:opacity-50"
            maxLength={280}
          />
          <button
            onClick={handleSend}
            disabled={!inputMessage.trim() || isSending || isMining || !canSend}
            className="px-3 py-1 border border-green-700/50 text-green-400 font-mono text-xs hover:bg-green-900/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isSending || isMining ? <span className="animate-pulse">TX...</span> : "SEND"}
          </button>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-gray-700 font-mono text-xs">{inputMessage.length}/280</span>
          {(isSending || isMining) && (
            <span className="text-yellow-600 font-mono text-xs animate-pulse">Broadcasting to network...</span>
          )}
        </div>
      </div>
    </div>
  );
}
