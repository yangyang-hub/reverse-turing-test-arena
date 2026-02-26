"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useScaffoldEventHistory, useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { getAliasName } from "~~/utils/playerAlias";

type KillEntry = {
  id: string;
  playerAddr: string;
  eliminatedByAddr: string;
  reason: string;
  timestamp: number;
};

export const KillFeed = ({ roomId, nameMap }: { roomId: bigint; nameMap?: Record<string, string> }) => {
  const [entries, setEntries] = useState<KillEntry[]>([]);

  const { data: allPlayers } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getAllPlayers",
    args: [roomId],
  });

  const playerAddresses = (allPlayers as string[]) || [];

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
        playerAddr: (e.args.player as string) || "",
        eliminatedByAddr: (e.args.eliminatedBy as string) || "",
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
            <span className="text-gray-500">&#x1F480;</span>{" "}
            <span className="text-white">{getAliasName(playerAddresses, entry.playerAddr, nameMap)}</span>{" "}
            <span className="text-red-500">ELIMINATED</span> <span className="text-gray-500">by</span>{" "}
            <span className="text-yellow-400">{getAliasName(playerAddresses, entry.eliminatedByAddr, nameMap)}</span>
            <div className="text-gray-600 text-[10px] mt-0.5">&mdash; {entry.reason}</div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
