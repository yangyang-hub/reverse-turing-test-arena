"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { ArenaTerminal } from "~~/app/arena/_components/ArenaTerminal";
import { PlayerRadar } from "~~/app/arena/_components/PlayerRadar";
import { VotePanel } from "~~/app/arena/_components/VotePanel";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

const PHASE_LABELS: Record<number, string> = {
  0: "WAITING",
  1: "PHASE 1",
  2: "PHASE 2",
  3: "PHASE 3",
  4: "ENDED",
};

const PHASE_COLORS: Record<number, string> = {
  0: "text-gray-400",
  1: "text-green-400",
  2: "text-yellow-400",
  3: "text-red-400",
  4: "text-purple-400",
};

function ArenaContent() {
  const searchParams = useSearchParams();
  const rawRoomId = searchParams.get("roomId");
  const { address: connectedAddress } = useAccount();

  const roomId = rawRoomId ? BigInt(rawRoomId) : undefined;

  const { data: roomInfo, isLoading: roomLoading } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRoomInfo",
    args: [roomId] as const,
  });

  const { data: allPlayers } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getAllPlayers",
    args: [roomId] as const,
  });

  if (!rawRoomId || roomId === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="text-center p-8 border border-red-500/50 bg-red-950/20 rounded-lg max-w-md">
          <div className="text-red-400 text-6xl mb-4 font-mono">!</div>
          <h2 className="text-red-400 text-xl font-mono mb-2">NO ROOM ID</h2>
          <p className="text-gray-500 font-mono text-sm">
            Access denied. No room identifier provided in query parameters.
          </p>
          <Link
            href="/"
            className="inline-block mt-6 px-6 py-2 border border-cyan-500/50 text-cyan-400 font-mono text-sm hover:bg-cyan-500/10 transition-colors"
          >
            RETURN TO LOBBY
          </Link>
        </div>
      </div>
    );
  }

  if (roomLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="text-center">
          <div className="text-cyan-400 font-mono text-lg animate-pulse mb-4">CONNECTING TO ARENA...</div>
          <div className="flex justify-center gap-1">
            {[0, 1, 2, 3, 4].map(i => (
              <div
                key={i}
                className="w-2 h-8 bg-cyan-500/60 animate-pulse"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!roomInfo) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="text-center p-8 border border-red-500/50 bg-red-950/20 rounded-lg max-w-md">
          <div className="text-red-400 text-6xl mb-4 font-mono">404</div>
          <h2 className="text-red-400 text-xl font-mono mb-2">ROOM NOT FOUND</h2>
          <p className="text-gray-500 font-mono text-sm">
            Room #{rawRoomId} does not exist or has been purged from the chain.
          </p>
          <Link
            href="/"
            className="inline-block mt-6 px-6 py-2 border border-cyan-500/50 text-cyan-400 font-mono text-sm hover:bg-cyan-500/10 transition-colors"
          >
            RETURN TO LOBBY
          </Link>
        </div>
      </div>
    );
  }

  const phase = typeof roomInfo === "object" && "phase" in roomInfo ? Number((roomInfo as any).phase) : 0;
  const aliveCount =
    typeof roomInfo === "object" && "aliveCount" in roomInfo ? Number((roomInfo as any).aliveCount) : 0;
  const playerCount =
    typeof roomInfo === "object" && "playerCount" in roomInfo ? Number((roomInfo as any).playerCount) : 0;
  const currentRound =
    typeof roomInfo === "object" && "currentRound" in roomInfo ? Number((roomInfo as any).currentRound) : 0;
  const prizePool = typeof roomInfo === "object" && "prizePool" in roomInfo ? BigInt((roomInfo as any).prizePool) : 0n;

  const phaseLabel = PHASE_LABELS[phase] ?? "UNKNOWN";
  const phaseColor = PHASE_COLORS[phase] ?? "text-gray-400";

  const isPlayerInGame = connectedAddress && allPlayers ? (allPlayers as string[]).includes(connectedAddress) : false;

  return (
    <div className="flex flex-col min-h-screen bg-black text-gray-100">
      {/* HUD Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-900/50 bg-gray-950/80 backdrop-blur-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 font-mono text-xs">ROOM</span>
            <span className="text-cyan-400 font-mono text-sm font-bold">#{rawRoomId}</span>
          </div>
          <div className="h-4 w-px bg-gray-700" />
          <div className="flex items-center gap-2">
            <span className="text-gray-500 font-mono text-xs">PHASE</span>
            <span className={`font-mono text-sm font-bold ${phaseColor}`}>{phaseLabel}</span>
          </div>
          <div className="h-4 w-px bg-gray-700" />
          <div className="flex items-center gap-2">
            <span className="text-gray-500 font-mono text-xs">ROUND</span>
            <span className="text-white font-mono text-sm font-bold">{currentRound}</span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 font-mono text-xs">ALIVE</span>
            <span className="text-green-400 font-mono text-sm font-bold">
              {aliveCount}/{playerCount}
            </span>
          </div>
          <div className="h-4 w-px bg-gray-700" />
          <div className="flex items-center gap-2">
            <span className="text-gray-500 font-mono text-xs">PRIZE</span>
            <span className="text-yellow-400 font-mono text-sm font-bold">
              {(Number(prizePool) / 1e18).toFixed(4)} MON
            </span>
          </div>
          {isPlayerInGame && (
            <>
              <div className="h-4 w-px bg-gray-700" />
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-green-400 font-mono text-xs">IN GAME</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Arena Grid */}
      <div className="flex-1 grid grid-cols-12 gap-0 overflow-hidden">
        {/* Left Sidebar - Player Radar */}
        <div className="col-span-3 border-r border-cyan-900/30 overflow-y-auto">
          <PlayerRadar roomId={roomId} />
        </div>

        {/* Center - Chat Terminal */}
        <div className="col-span-6 flex flex-col overflow-hidden">
          <ArenaTerminal roomId={roomId} />
        </div>

        {/* Right Sidebar - Vote Panel */}
        <div className="col-span-3 border-l border-cyan-900/30 overflow-y-auto">
          <VotePanel roomId={roomId} />
        </div>
      </div>
    </div>
  );
}

export default function ArenaPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-black">
          <div className="text-cyan-400 font-mono text-lg animate-pulse">INITIALIZING ARENA...</div>
        </div>
      }
    >
      <ArenaContent />
    </Suspense>
  );
}
