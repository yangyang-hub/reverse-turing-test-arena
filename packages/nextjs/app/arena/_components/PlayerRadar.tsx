"use client";

import { Address } from "@scaffold-ui/components";
import { useAccount } from "wagmi";
import { PixelAvatar } from "~~/app/arena/_components/PixelAvatar";
import type { PlayerInfo } from "~~/app/arena/page";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import { getPlayerAlias } from "~~/utils/playerAlias";

export function PlayerRadar({
  nameMap,
  playerInfoMap,
  allPlayers,
  roomInfo,
}: {
  nameMap?: Record<string, string>;
  playerInfoMap: Record<string, PlayerInfo>;
  allPlayers: string[];
  roomInfo: any;
}) {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();

  const aliveCount =
    roomInfo && typeof roomInfo === "object" && "aliveCount" in roomInfo ? Number((roomInfo as any).aliveCount) : 0;
  const playerCount =
    roomInfo && typeof roomInfo === "object" && "playerCount" in roomInfo ? Number((roomInfo as any).playerCount) : 0;
  const phase = roomInfo && typeof roomInfo === "object" && "phase" in roomInfo ? Number((roomInfo as any).phase) : 0;
  const isEnded = phase === 2;

  return (
    <div className="flex flex-col h-full arena-panel-bg arena-scanline">
      {/* Header */}
      <div
        className="px-4 py-3 border-b border-green-900/40"
        style={{ background: "linear-gradient(90deg, #121a12, #1a2619, #121a12)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <h2 className="arena-text-amber font-mono text-sm font-bold tracking-wider">PLAYER RADAR</h2>
          </div>
          <span className="text-green-400 font-mono text-xs font-bold">
            {aliveCount}/{playerCount}
          </span>
        </div>
      </div>

      {/* Player List */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {allPlayers.length === 0 && (
          <div className="text-gray-600 font-mono text-xs text-center py-8">No players detected</div>
        )}

        {allPlayers.map(playerAddr => (
          <PlayerRadarCard
            key={playerAddr}
            playerAddr={playerAddr}
            isMe={!!connectedAddress && playerAddr.toLowerCase() === connectedAddress.toLowerCase()}
            targetNetwork={targetNetwork}
            playerAddresses={allPlayers}
            isEnded={isEnded}
            nameMap={nameMap}
            playerInfo={playerInfoMap[playerAddr.toLowerCase()]}
          />
        ))}
      </div>
    </div>
  );
}

function PlayerRadarCard({
  playerAddr,
  isMe,
  targetNetwork,
  playerAddresses,
  isEnded,
  nameMap,
  playerInfo,
}: {
  playerAddr: string;
  isMe: boolean;
  targetNetwork: any;
  playerAddresses: string[];
  isEnded: boolean;
  nameMap?: Record<string, string>;
  playerInfo?: PlayerInfo;
}) {
  const isAlive = playerInfo?.isAlive ?? true;
  const humanityScore = playerInfo?.humanityScore ?? 100;
  const isAI = playerInfo?.isAI ?? false;

  const scoreColor = humanityScore > 60 ? "bg-green-500" : humanityScore > 30 ? "bg-yellow-500" : "bg-red-500";
  const scoreTextColor =
    humanityScore > 60 ? "text-green-400" : humanityScore > 30 ? "text-yellow-400" : "text-red-400";

  const alias = getPlayerAlias(playerAddresses, playerAddr, nameMap);

  return (
    <div
      className={`relative p-3 rounded transition-all duration-200 ${
        isMe
          ? "arena-card-military border-cyan-800/50"
          : !isAlive
            ? "arena-card-military opacity-40"
            : "arena-card-military"
      }`}
      style={isMe ? { borderColor: "#1a5c6a" } : undefined}
    >
      {/* Me indicator */}
      {isMe && (
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-cyan-500/60 via-cyan-400/40 to-transparent" />
      )}

      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Pixel avatar */}
          <PixelAvatar seed={playerAddr} color={alias.color} size={24} />

          {/* Alias name + optional real address reveal */}
          <div className={`min-w-0 ${!isAlive ? "line-through" : ""}`}>
            <div className="font-mono text-xs font-bold" style={{ color: alias.color }}>
              {alias.name}
            </div>
            {isEnded && (
              <div className="text-xs opacity-70">
                <Address address={playerAddr as `0x${string}`} chain={targetNetwork} size="xs" onlyEnsOrAddress />
              </div>
            )}
          </div>
        </div>

        {/* Tags */}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {/* Only reveal AI/Human identity after game ends */}
          {isEnded && (
            <span
              className={`px-1.5 py-0.5 rounded font-mono text-xs ${
                isAI
                  ? "bg-red-900/30 border border-red-700/40 text-red-400"
                  : "bg-green-900/30 border border-green-700/40 text-green-400"
              }`}
            >
              {isAI ? "AI" : "H"}
            </span>
          )}
          {isMe && (
            <span className="px-1.5 py-0.5 bg-cyan-900/30 border border-cyan-700/40 rounded text-cyan-400 font-mono text-xs">
              YOU
            </span>
          )}
          {!isAlive && (
            <span className="px-1.5 py-0.5 bg-red-900/30 border border-red-700/40 rounded text-red-400 font-mono text-xs font-bold">
              DEAD
            </span>
          )}
          {isAlive && <span className="text-green-400 font-mono text-xs">Alive</span>}
        </div>
      </div>

      {/* Humanity Score */}
      <div className="flex items-center gap-2">
        <span className="text-gray-500 font-mono text-xs shrink-0">{humanityScore}/100</span>
        <div className="flex-1 h-2 arena-hp-track rounded-full overflow-hidden">
          <div
            className={`h-full ${scoreColor} rounded-full transition-all duration-700 ease-out`}
            style={{ width: `${Math.max(0, Math.min(100, humanityScore))}%` }}
          />
        </div>
        <span className={`font-mono text-xs font-bold shrink-0 ${scoreTextColor}`}>{isAlive ? "Alive" : "Dead"}</span>
      </div>
    </div>
  );
}
