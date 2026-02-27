"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount, useBlockNumber, useReadContracts } from "wagmi";
import { ArenaTerminal } from "~~/app/arena/_components/ArenaTerminal";
import { MissionBriefing } from "~~/app/arena/_components/MissionBriefing";
import { PlayerRadar } from "~~/app/arena/_components/PlayerRadar";
import { VictoryScreen } from "~~/app/arena/_components/VictoryScreen";
import { VotePanel } from "~~/app/arena/_components/VotePanel";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useChatSocket } from "~~/hooks/scaffold-eth/useChatSocket";

export type PlayerInfo = {
  addr: string;
  humanityScore: number;
  isAlive: boolean;
  isAI: boolean;
  actionCount: number;
  successfulVotes: number;
};

const PHASE_LABELS: Record<number, string> = {
  0: "WAITING",
  1: "ACTIVE",
  2: "ENDED",
};

const PHASE_COLORS: Record<number, string> = {
  0: "text-gray-400",
  1: "text-green-400",
  2: "text-purple-400",
};

function ArenaContent() {
  const searchParams = useSearchParams();
  const rawRoomId = searchParams.get("roomId");
  const { address: connectedAddress } = useAccount();
  const router = useRouter();

  const { writeContractAsync: writeArena } = useScaffoldWriteContract({
    contractName: "TuringArena",
  });

  // Lock page scroll so only inner panels scroll
  useEffect(() => {
    const root = document.querySelector(".min-h-screen");
    if (root) root.classList.add("arena-lock-scroll");
    return () => {
      if (root) root.classList.remove("arena-lock-scroll");
    };
  }, []);

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

  const { data: currentRoundData } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "currentRound",
    args: [roomId] as const,
  });

  const { data: blockNumber } = useBlockNumber({ watch: true });

  // Game end data
  const { data: gameStats } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getGameStats",
    args: [roomId] as const,
  });

  const { data: rewardInfo } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRewardInfo",
    args: [roomId, connectedAddress ?? "0x0000000000000000000000000000000000000000"] as const,
  });

  const { data: playerNames } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRoomPlayerNames",
    args: [roomId] as const,
  });

  // Batch-fetch all player info via multicall (replaces N individual hooks in children)
  const { data: arenaInfo } = useDeployedContractInfo({ contractName: "TuringArena" });
  const playerInfoContracts = useMemo(() => {
    if (!allPlayers || !arenaInfo) return [];
    return (allPlayers as string[]).map(addr => ({
      address: arenaInfo.address,
      abi: arenaInfo.abi,
      functionName: "getPlayerInfo" as const,
      args: [roomId, addr] as const,
    }));
  }, [allPlayers, roomId, arenaInfo]);

  const { data: batchedPlayerInfos } = useReadContracts({
    contracts: playerInfoContracts,
    query: { enabled: playerInfoContracts.length > 0 },
  });

  // Build playerInfoMap: lowercase address → PlayerInfo
  const playerInfoMap = useMemo<Record<string, PlayerInfo>>(() => {
    const map: Record<string, PlayerInfo> = {};
    if (!batchedPlayerInfos || !allPlayers) return map;
    const addrs = allPlayers as string[];
    for (let i = 0; i < addrs.length && i < batchedPlayerInfos.length; i++) {
      const res = batchedPlayerInfos[i];
      if (res.status === "success" && res.result) {
        const r = res.result as any;
        map[addrs[i].toLowerCase()] = {
          addr: r.addr ?? addrs[i],
          humanityScore: Number(r.humanityScore ?? 100),
          isAlive: Boolean(r.isAlive),
          isAI: Boolean(r.isAI),
          actionCount: Number(r.actionCount ?? 0),
          successfulVotes: Number(r.successfulVotes ?? 0),
        };
      }
    }
    return map;
  }, [batchedPlayerInfos, allPlayers]);

  // Build nameMap: address (lowercase) → on-chain name
  const nameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (allPlayers && playerNames) {
      const addrs = allPlayers as string[];
      const names = playerNames as string[];
      for (let i = 0; i < addrs.length && i < names.length; i++) {
        if (names[i]) {
          map[addrs[i].toLowerCase()] = names[i];
        }
      }
    }
    return map;
  }, [allPlayers, playerNames]);

  // WebSocket chat connection — single instance for the whole arena page
  // (previously duplicated in ArenaTerminal, causing two WS connections + two SIWE signatures)
  const parsedRoomIdForChat = rawRoomId ? Number(rawRoomId) : undefined;
  const {
    messages: chatMessages,
    sendMessage,
    isConnected,
    myMessageCount,
    myIsAI: chatMyIsAI,
  } = useChatSocket(parsedRoomIdForChat);

  // Settle state
  const [isSettling, setIsSettling] = useState(false);
  const [showVictory, setShowVictory] = useState(false);
  const [showBriefing, setShowBriefing] = useState(true);

  // Auto-show VictoryScreen only when phase transitions to Ended live (not on page load)
  const phase = typeof roomInfo === "object" && "phase" in roomInfo ? Number((roomInfo as any).phase) : 0;
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    if (phase === 2 && prevPhaseRef.current !== 2 && prevPhaseRef.current !== 0) {
      setShowVictory(true);
    }
    prevPhaseRef.current = phase;
  }, [phase]);

  if (!rawRoomId || roomId === undefined) {
    return (
      <div className="flex items-center justify-center flex-1 bg-black">
        <div className="text-center p-8 border border-red-500/50 bg-red-950/20 rounded-lg max-w-md">
          <div className="text-red-400 text-6xl mb-4 font-mono">!</div>
          <h2 className="text-red-400 text-xl font-mono mb-2">NO ROOM ID</h2>
          <p className="text-gray-500 font-mono text-sm">
            Access denied. No room identifier provided in query parameters.
          </p>
          <Link
            href="/lobby"
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
      <div className="flex items-center justify-center flex-1 bg-black">
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
      <div className="flex items-center justify-center flex-1 bg-black">
        <div className="text-center p-8 border border-red-500/50 bg-red-950/20 rounded-lg max-w-md">
          <div className="text-red-400 text-6xl mb-4 font-mono">404</div>
          <h2 className="text-red-400 text-xl font-mono mb-2">ROOM NOT FOUND</h2>
          <p className="text-gray-500 font-mono text-sm">
            Room #{rawRoomId} does not exist or has been purged from the chain.
          </p>
          <Link
            href="/lobby"
            className="inline-block mt-6 px-6 py-2 border border-cyan-500/50 text-cyan-400 font-mono text-sm hover:bg-cyan-500/10 transition-colors"
          >
            RETURN TO LOBBY
          </Link>
        </div>
      </div>
    );
  }

  // Redirect to lobby if room is still in Waiting phase (game not started yet)
  if (phase === 0) {
    return (
      <div className="flex items-center justify-center flex-1 bg-black">
        <div className="text-center p-8 border border-yellow-500/30 bg-yellow-950/10 rounded-lg max-w-md">
          <div className="text-yellow-400 text-5xl mb-4 font-mono animate-pulse">&#x23F3;</div>
          <h2 className="text-yellow-400 text-xl font-mono mb-2">ROOM NOT READY</h2>
          <p className="text-gray-500 font-mono text-sm">
            Room #{rawRoomId} is still waiting for players. You&apos;ll be redirected automatically when the game
            starts.
          </p>
          <Link
            href="/lobby"
            className="inline-block mt-6 px-6 py-2 border border-cyan-500/50 text-cyan-400 font-mono text-sm hover:bg-cyan-500/10 transition-colors"
          >
            BACK TO LOBBY
          </Link>
        </div>
      </div>
    );
  }

  const aliveCount =
    typeof roomInfo === "object" && "aliveCount" in roomInfo ? Number((roomInfo as any).aliveCount) : 0;
  const playerCount =
    typeof roomInfo === "object" && "playerCount" in roomInfo ? Number((roomInfo as any).playerCount) : 0;
  const currentRound = currentRoundData !== undefined ? Number(currentRoundData) : 0;
  const prizePool = typeof roomInfo === "object" && "prizePool" in roomInfo ? BigInt((roomInfo as any).prizePool) : 0n;
  const creator = typeof roomInfo === "object" && "creator" in roomInfo ? ((roomInfo as any).creator as string) : "";
  const lastSettleBlock =
    typeof roomInfo === "object" && "lastSettleBlock" in roomInfo ? Number((roomInfo as any).lastSettleBlock) : 0;
  const currentInterval =
    typeof roomInfo === "object" && "currentInterval" in roomInfo ? Number((roomInfo as any).currentInterval) : 0;

  const myIsAI = chatMyIsAI ?? false;

  const phaseLabel = PHASE_LABELS[phase] ?? "UNKNOWN";
  const phaseColor = PHASE_COLORS[phase] ?? "text-gray-400";

  const isPlayerInGame =
    connectedAddress && allPlayers
      ? (allPlayers as string[]).some(p => p.toLowerCase() === connectedAddress.toLowerCase())
      : false;

  const isCreator = connectedAddress ? creator.toLowerCase() === connectedAddress.toLowerCase() : false;
  const maxPlayers =
    typeof roomInfo === "object" && "maxPlayers" in roomInfo ? Number((roomInfo as any).maxPlayers) : 0;
  const canStartGame = phase === 0 && isCreator && playerCount === maxPlayers;

  // Round timing
  const isGameActive = phase === 1;
  const currentBlock = blockNumber ? Number(blockNumber) : 0;
  const settleTargetBlock = lastSettleBlock + currentInterval;
  const blocksRemaining = isGameActive && currentBlock > 0 ? Math.max(0, settleTargetBlock - currentBlock) : 0;
  const intervalReached = isGameActive && currentBlock >= settleTargetBlock && currentBlock > 0 && lastSettleBlock > 0;
  const canSettle = intervalReached;

  const handleStartGame = async () => {
    if (!roomId) return;
    try {
      await writeArena({ functionName: "startGame", args: [roomId] });
    } catch (e) {
      console.error("Failed to start game:", e);
    }
  };

  const handleLeave = async () => {
    if (!roomId) return;
    try {
      await writeArena({ functionName: "leaveRoom", args: [roomId] });
      router.push("/lobby");
    } catch (e) {
      console.error("Failed to leave room:", e);
    }
  };

  const handleSettle = async () => {
    if (!roomId || isSettling) return;
    setIsSettling(true);
    try {
      await writeArena({ functionName: "settleRound", args: [roomId] });
    } catch (e: any) {
      const msg = e?.message || "";
      if (!msg.includes("Round not ended yet")) {
        console.error("Settle failed:", e);
      }
    } finally {
      setIsSettling(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-black text-gray-100">
      {/* HUD Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-900/50 bg-gray-950/80 backdrop-blur-sm shrink-0">
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
          {isGameActive && (
            <>
              <div className="h-4 w-px bg-gray-700" />
              <div className="flex items-center gap-2">
                <span className="text-gray-500 font-mono text-xs">SETTLE IN</span>
                {canSettle ? (
                  <span className="text-orange-400 font-mono text-sm font-bold animate-pulse">READY</span>
                ) : (
                  <span className="text-cyan-300 font-mono text-sm font-bold">{blocksRemaining} blocks</span>
                )}
              </div>
            </>
          )}
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
              {(Number(prizePool) / 1e6).toFixed(2)} USDC
            </span>
          </div>
          {isPlayerInGame && phase !== 2 && (
            <>
              <div className="h-4 w-px bg-gray-700" />
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-green-400 font-mono text-xs">IN GAME</span>
              </div>
            </>
          )}
          {phase === 2 && (
            <>
              <div className="h-4 w-px bg-gray-700" />
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-purple-400" />
                <span className="text-purple-400 font-mono text-xs">GAME OVER</span>
              </div>
              <div className="h-4 w-px bg-gray-700" />
              <button
                onClick={() => setShowVictory(true)}
                className="px-3 py-1 border border-yellow-500/50 text-yellow-400 font-mono text-xs hover:bg-yellow-900/20 hover:border-yellow-500 transition-colors rounded"
              >
                VIEW RESULTS
              </button>
            </>
          )}
          {canSettle && (
            <>
              <div className="h-4 w-px bg-gray-700" />
              <button
                onClick={handleSettle}
                disabled={isSettling}
                className="px-3 py-1 border border-orange-500/50 text-orange-400 font-mono text-xs hover:bg-orange-900/20 hover:border-orange-500 transition-colors rounded animate-pulse"
              >
                {isSettling ? <span className="loading loading-spinner loading-xs" /> : "SETTLE ROUND"}
              </button>
            </>
          )}
          {phase === 0 && isPlayerInGame && (
            <>
              <div className="h-4 w-px bg-gray-700" />
              <button
                onClick={handleLeave}
                className="px-3 py-1 border border-red-500/50 text-red-400 font-mono text-xs hover:bg-red-900/20 hover:border-red-500 transition-colors rounded"
              >
                LEAVE ROOM
              </button>
            </>
          )}
          {canStartGame && (
            <>
              <div className="h-4 w-px bg-gray-700" />
              <button
                onClick={handleStartGame}
                className="px-3 py-1 border border-green-500/50 text-green-400 font-mono text-xs hover:bg-green-900/20 hover:border-green-500 transition-colors rounded animate-pulse"
              >
                START GAME
              </button>
            </>
          )}
          {phase === 0 && isCreator && playerCount < maxPlayers && (
            <>
              <div className="h-4 w-px bg-gray-700" />
              <span className="text-yellow-500/60 font-mono text-xs">
                NEED {maxPlayers - playerCount} MORE PLAYER{maxPlayers - playerCount > 1 ? "S" : ""}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Main Arena Grid */}
      <div className="flex-1 grid grid-cols-12 gap-0 min-h-0">
        {/* Left Sidebar - Player Radar */}
        <div className="col-span-3 border-r border-cyan-900/30 min-h-0 overflow-hidden">
          <PlayerRadar
            nameMap={nameMap}
            playerInfoMap={playerInfoMap}
            allPlayers={(allPlayers as string[]) || []}
            roomInfo={roomInfo}
          />
        </div>

        {/* Center - Chat Terminal */}
        <div className="col-span-6 flex flex-col min-h-0 overflow-hidden">
          <ArenaTerminal
            roomId={roomId}
            nameMap={nameMap}
            roomInfo={roomInfo}
            allPlayers={(allPlayers as string[]) || []}
            myPlayerInfo={playerInfoMap[connectedAddress?.toLowerCase() ?? ""]}
            currentRound={currentRound}
            chatMessages={chatMessages}
            sendMessage={sendMessage}
            isConnected={isConnected}
            myMessageCount={myMessageCount}
          />
        </div>

        {/* Right Sidebar - Vote Panel */}
        <div className="col-span-3 border-l border-cyan-900/30 min-h-0 overflow-hidden">
          <VotePanel
            roomId={roomId}
            nameMap={nameMap}
            playerInfoMap={playerInfoMap}
            allPlayers={(allPlayers as string[]) || []}
            roomInfo={roomInfo}
            roundNum={currentRoundData}
            blockNumber={blockNumber}
          />
        </div>
      </div>

      {/* Mission Briefing overlay */}
      {showBriefing && phase === 1 && isPlayerInGame && (
        <MissionBriefing totalPlayers={playerCount} isAI={myIsAI} onDismiss={() => setShowBriefing(false)} />
      )}

      {/* Victory Screen overlay */}
      {showVictory && phase === 2 && gameStats && roomId !== undefined && (
        <VictoryScreen
          roomId={roomId}
          humansWon={Boolean((gameStats as any).humansWon)}
          mvp={((gameStats as any).mvp as string) ?? ""}
          mvpVotes={Number((gameStats as any).mvpVotes ?? 0)}
          myRewardAmount={rewardInfo ? BigInt((rewardInfo as any)[0] ?? 0) : 0n}
          myRewardClaimed={rewardInfo ? Boolean((rewardInfo as any)[1]) : false}
          nameMap={nameMap}
          onDismiss={() => {
            setShowVictory(false);
          }}
        />
      )}
    </div>
  );
}

export default function ArenaPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center flex-1 bg-black">
          <div className="text-cyan-400 font-mono text-lg animate-pulse">INITIALIZING ARENA...</div>
        </div>
      }
    >
      <ArenaContent />
    </Suspense>
  );
}
