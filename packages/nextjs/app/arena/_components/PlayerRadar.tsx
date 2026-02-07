"use client";

import { Address } from "@scaffold-ui/components";
import { useAccount } from "wagmi";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";

export function PlayerRadar({ roomId }: { roomId: bigint }) {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();

  const { data: allPlayers, isLoading } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getAllPlayers",
    args: [roomId],
  });

  const { data: roomInfo } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRoomInfo",
    args: [roomId],
  });

  const aliveCount =
    roomInfo && typeof roomInfo === "object" && "aliveCount" in roomInfo ? Number((roomInfo as any).aliveCount) : 0;
  const playerCount =
    roomInfo && typeof roomInfo === "object" && "playerCount" in roomInfo ? Number((roomInfo as any).playerCount) : 0;

  const playerAddresses = (allPlayers as string[]) || [];

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-cyan-900/40 bg-black/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
            <h2 className="text-cyan-400 font-mono text-sm font-bold tracking-wider">PLAYER RADAR</h2>
          </div>
          <span className="text-gray-500 font-mono text-xs">
            {aliveCount}/{playerCount}
          </span>
        </div>
      </div>

      {/* Player List */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {isLoading && (
          <div className="text-cyan-400/60 font-mono text-xs text-center py-8 animate-pulse">
            Scanning for players...
          </div>
        )}

        {!isLoading && playerAddresses.length === 0 && (
          <div className="text-gray-600 font-mono text-xs text-center py-8">No players detected</div>
        )}

        {playerAddresses.map(playerAddr => (
          <PlayerRadarCard
            key={playerAddr}
            roomId={roomId}
            playerAddr={playerAddr}
            isMe={!!connectedAddress && playerAddr.toLowerCase() === connectedAddress.toLowerCase()}
            targetNetwork={targetNetwork}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-t border-cyan-900/30 bg-black/40">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
            <span className="text-gray-600 font-mono text-xs">Alive</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-red-600" />
            <span className="text-gray-600 font-mono text-xs">Dead</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-0.5 bg-cyan-500" />
            <span className="text-gray-600 font-mono text-xs">You</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerRadarCard({
  roomId,
  playerAddr,
  isMe,
  targetNetwork,
}: {
  roomId: bigint;
  playerAddr: string;
  isMe: boolean;
  targetNetwork: any;
}) {
  const { data: playerInfo } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getPlayerInfo",
    args: [roomId, playerAddr],
  });

  const isAlive =
    playerInfo && typeof playerInfo === "object" && "isAlive" in playerInfo
      ? Boolean((playerInfo as any).isAlive)
      : true;
  const humanityScore =
    playerInfo && typeof playerInfo === "object" && "humanityScore" in playerInfo
      ? Number((playerInfo as any).humanityScore)
      : 100;
  const isVerifiedHuman =
    playerInfo && typeof playerInfo === "object" && "isVerifiedHuman" in playerInfo
      ? Boolean((playerInfo as any).isVerifiedHuman)
      : false;

  const scoreColor = humanityScore > 60 ? "bg-green-500" : humanityScore > 30 ? "bg-yellow-500" : "bg-red-500";
  const scoreBorderColor =
    humanityScore > 60 ? "border-green-800/40" : humanityScore > 30 ? "border-yellow-800/40" : "border-red-800/40";
  const scoreTextColor =
    humanityScore > 60 ? "text-green-400" : humanityScore > 30 ? "text-yellow-400" : "text-red-400";

  return (
    <div
      className={`relative p-3 rounded border transition-all duration-200 ${
        isMe
          ? "border-cyan-700/50 bg-cyan-950/15"
          : !isAlive
            ? "border-gray-800/20 bg-gray-900/10 opacity-40"
            : scoreBorderColor + " bg-gray-900/30"
      }`}
    >
      {/* Me indicator */}
      {isMe && (
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-cyan-500/60 via-cyan-400/40 to-transparent" />
      )}

      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Status dot */}
          <div
            className={`w-2 h-2 rounded-full shrink-0 ${isAlive ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.4)]" : "bg-red-600"}`}
          />

          {/* Address */}
          <div className={`min-w-0 ${!isAlive ? "line-through" : ""}`}>
            <div className="text-xs">
              <Address address={playerAddr as `0x${string}`} chain={targetNetwork} size="xs" />
            </div>
          </div>
        </div>

        {/* Tags */}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {isMe && (
            <span className="px-1.5 py-0.5 bg-cyan-900/30 border border-cyan-700/40 rounded text-cyan-400 font-mono text-xs">
              YOU
            </span>
          )}
          {isVerifiedHuman && (
            <span className="px-1.5 py-0.5 bg-green-900/20 border border-green-700/30 rounded text-green-400 font-mono text-xs">
              H
            </span>
          )}
          {!isAlive && (
            <span className="px-1.5 py-0.5 bg-red-900/20 border border-red-700/30 rounded text-red-500 font-mono text-xs">
              DEAD
            </span>
          )}
        </div>
      </div>

      {/* Humanity Score */}
      <div className="flex items-center gap-2">
        <span className="text-gray-500 font-mono text-xs shrink-0">HP</span>
        <div className="flex-1 h-2 bg-gray-800/60 rounded-full overflow-hidden">
          <div
            className={`h-full ${scoreColor} rounded-full transition-all duration-700 ease-out`}
            style={{ width: `${Math.max(0, Math.min(100, humanityScore))}%` }}
          />
        </div>
        <span className={`font-mono text-xs font-bold shrink-0 w-7 text-right ${scoreTextColor}`}>{humanityScore}</span>
      </div>
    </div>
  );
}
