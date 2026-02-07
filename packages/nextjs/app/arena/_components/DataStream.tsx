"use client";

import { useEffect, useRef, useState } from "react";
import { useScaffoldEventHistory } from "~~/hooks/scaffold-eth";

type StreamEntry = {
  id: string;
  txHash: string;
  action: "CHAT" | "VOTE" | "JOIN" | "ELIMINATE" | "CLAIM";
  actor: string;
  blockNumber: number;
};

const ACTION_COLORS: Record<StreamEntry["action"], string> = {
  CHAT: "text-green-400",
  VOTE: "text-red-400",
  JOIN: "text-cyan-400",
  ELIMINATE: "text-yellow-400",
  CLAIM: "text-purple-400",
};

export const DataStream = ({ roomId }: { roomId: bigint }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<StreamEntry[]>([]);

  const { data: chatEvents } = useScaffoldEventHistory({
    contractName: "TuringArena",
    eventName: "NewMessage",
    watch: true,
    fromBlock: 0n,
  });

  const { data: voteEvents } = useScaffoldEventHistory({
    contractName: "TuringArena",
    eventName: "VoteCast",
    watch: true,
    fromBlock: 0n,
  });

  useEffect(() => {
    const newEntries: StreamEntry[] = [];

    chatEvents
      ?.filter(e => e.args.roomId?.toString() === roomId.toString())
      .forEach(e => {
        newEntries.push({
          id: (e as any).transactionHash || (e as any).log?.transactionHash || "",
          txHash: (e as any).transactionHash || (e as any).log?.transactionHash || "0x???",
          action: "CHAT",
          actor: (e.args.sender as string) || "",
          blockNumber: Number((e as any).blockNumber ?? (e as any).log?.blockNumber ?? 0),
        });
      });

    voteEvents
      ?.filter(e => e.args.roomId?.toString() === roomId.toString())
      .forEach(e => {
        newEntries.push({
          id: (e as any).transactionHash || (e as any).log?.transactionHash || "",
          txHash: (e as any).transactionHash || (e as any).log?.transactionHash || "0x???",
          action: "VOTE",
          actor: (e.args.voter as string) || "",
          blockNumber: Number((e as any).blockNumber ?? (e as any).log?.blockNumber ?? 0),
        });
      });

    newEntries.sort((a, b) => a.blockNumber - b.blockNumber);
    setEntries(newEntries.slice(-50));
  }, [chatEvents, voteEvents, roomId]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="bg-black/90 border border-green-500/20 rounded p-3 font-mono">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        <span className="text-green-400 text-xs tracking-wider">BLOCKCHAIN STREAM</span>
      </div>

      <div ref={scrollRef} className="h-48 overflow-y-auto">
        {entries.map((entry, i) => (
          <div key={`${entry.id}-${i}`} className="text-[10px] leading-5 terminal-text">
            <span className="text-gray-600">[{entry.blockNumber}]</span>{" "}
            <span className={ACTION_COLORS[entry.action]}>{entry.action.padEnd(10)}</span>{" "}
            <span className="text-gray-500">
              {entry.actor.slice(0, 6)}..{entry.actor.slice(-4)}
            </span>{" "}
            <span className="text-green-800">tx:{entry.txHash.slice(0, 10)}..</span>
          </div>
        ))}

        {entries.length === 0 && <div className="text-green-800 text-[10px]">&gt; Awaiting transactions...</div>}
      </div>
    </div>
  );
};
