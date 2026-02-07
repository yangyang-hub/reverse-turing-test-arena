"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useScaffoldEventHistory } from "~~/hooks/scaffold-eth";

type KillEntry = {
  id: string;
  player: string;
  eliminatedBy: string;
  reason: string;
  timestamp: number;
};

function truncateAddr(addr: string): string {
  if (!addr) return "???";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export const KillFeed = ({ roomId }: { roomId: bigint }) => {
  const [entries, setEntries] = useState<KillEntry[]>([]);

  const { data: events } = useScaffoldEventHistory({
    contractName: "TuringArena",
    eventName: "PlayerEliminated",
    watch: true,
    fromBlock: 0n,
  });

  useEffect(() => {
    if (!events) return;

    const roomEvents = events
      .filter(e => e.args.roomId?.toString() === roomId.toString())
      .map(e => ({
        id:
          (e as any).transactionHash || (e as any).log?.transactionHash || `${e.args.player}-${(e as any).blockNumber}`,
        player: truncateAddr(e.args.player as string),
        eliminatedBy: truncateAddr(e.args.eliminatedBy as string),
        reason: (e.args.reason as string) || "VOTED OUT",
        timestamp: Date.now(),
      }));

    setEntries(roomEvents.slice(-10));
  }, [events, roomId]);

  // Auto-fade after 10s
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setEntries(prev => prev.filter(e => now - e.timestamp < 10_000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed right-4 top-20 w-72 z-40 pointer-events-none space-y-2">
      <AnimatePresence>
        {entries.map(entry => (
          <motion.div
            key={entry.id}
            className="bg-black/80 border border-red-500/30 rounded px-3 py-2 font-mono text-xs text-red-400 backdrop-blur-sm pointer-events-auto"
            initial={{ x: 300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 300, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
          >
            <span className="text-gray-500">&#x1F480;</span> <span className="text-white">{entry.player}</span>{" "}
            <span className="text-red-500">ELIMINATED</span> <span className="text-gray-500">by</span>{" "}
            <span className="text-yellow-400">{entry.eliminatedBy}</span>
            <div className="text-gray-600 text-[10px] mt-0.5">&mdash; {entry.reason}</div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
