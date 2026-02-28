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
  2: "text-red-400",
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

  // Contract info for multicall (needed by all batch-read hooks below)
  const { data: arenaInfo } = useDeployedContractInfo({ contractName: "TuringArena" });
  const zeroAddr = "0x0000000000000000000000000000000000000000" as const;

  // Core polled multicall: getRoomInfo + currentRound + pendingReveal (3 → 1 multicall per tick)
  const coreContracts = useMemo(() => {
    if (!arenaInfo || roomId === undefined) return [];
    return [
      {
        address: arenaInfo.address,
        abi: arenaInfo.abi,
        functionName: "getRoomInfo" as const,
        args: [roomId] as const,
      },
      {
        address: arenaInfo.address,
        abi: arenaInfo.abi,
        functionName: "currentRound" as const,
        args: [roomId] as const,
      },
      {
        address: arenaInfo.address,
        abi: arenaInfo.abi,
        functionName: "pendingReveal" as const,
        args: [roomId] as const,
      },
    ];
  }, [arenaInfo, roomId]);

  const {
    data: coreData,
    isLoading: coreLoading,
    refetch: refetchCoreData,
  } = useReadContracts({
    contracts: coreContracts,
    query: { enabled: coreContracts.length > 0, refetchInterval: 2_000 },
  });

  const roomLoading = !arenaInfo || coreLoading;
  const roomInfo = coreData?.[0]?.result;
  const currentRoundData = coreData?.[1]?.result as bigint | undefined;
  const isPendingReveal = coreData?.[2]?.result as boolean | undefined;

  // Static multicall: getAllPlayers + getRoomPlayerNames (fetched once, no polling)
  const staticContracts = useMemo(() => {
    if (!arenaInfo || roomId === undefined) return [];
    return [
      {
        address: arenaInfo.address,
        abi: arenaInfo.abi,
        functionName: "getAllPlayers" as const,
        args: [roomId] as const,
      },
      {
        address: arenaInfo.address,
        abi: arenaInfo.abi,
        functionName: "getRoomPlayerNames" as const,
        args: [roomId] as const,
      },
    ];
  }, [arenaInfo, roomId]);

  const { data: staticData } = useReadContracts({
    contracts: staticContracts,
    query: { enabled: staticContracts.length > 0 },
  });

  const allPlayers = staticData?.[0]?.result as string[] | undefined;
  const playerNames = staticData?.[1]?.result as string[] | undefined;

  // Vote status multicall: hasVotedInRound (depends on currentRoundData from core)
  const voteCheckContracts = useMemo(() => {
    if (!arenaInfo || roomId === undefined || !connectedAddress || !currentRoundData || currentRoundData === 0n)
      return [];
    return [
      {
        address: arenaInfo.address,
        abi: arenaInfo.abi,
        functionName: "hasVotedInRound" as const,
        args: [roomId, currentRoundData, connectedAddress] as const,
      },
    ];
  }, [arenaInfo, roomId, connectedAddress, currentRoundData]);

  const { data: voteCheckData } = useReadContracts({
    contracts: voteCheckContracts,
    query: { enabled: voteCheckContracts.length > 0, refetchInterval: 2_000 },
  });

  const hasVotedOnChain = voteCheckData?.[0]?.result as boolean | undefined;

  const { data: blockNumber } = useBlockNumber({ watch: true });

  // Game end data — no per-block polling (refetched manually on phase transition)
  const { data: gameStats, refetch: refetchGameStats } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getGameStats",
    args: [roomId] as const,
    watch: false,
  });

  const { data: rewardInfo } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRewardInfo",
    args: [roomId, connectedAddress ?? zeroAddr] as const,
    watch: false,
  });

  // Batch-fetch all player info via multicall (replaces N individual hooks in children)
  const playerInfoContracts = useMemo(() => {
    if (!allPlayers || !arenaInfo) return [];
    return (allPlayers as string[]).map(addr => ({
      address: arenaInfo.address,
      abi: arenaInfo.abi,
      functionName: "getPlayerInfo" as const,
      args: [roomId, addr] as const,
    }));
  }, [allPlayers, roomId, arenaInfo]);

  const { data: batchedPlayerInfos, refetch: refetchPlayerInfos } = useReadContracts({
    contracts: playerInfoContracts,
    query: {
      enabled: playerInfoContracts.length > 0,
      refetchInterval: 2_000,
    },
  });

  // Refetch player info immediately when round advances (settle applies HP damage)
  useEffect(() => {
    if (currentRoundData !== undefined && currentRoundData > 0n) {
      refetchPlayerInfos();
    }
  }, [currentRoundData, refetchPlayerInfos]);

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

  // Derive phase early so we can skip WebSocket for ended rooms
  const phase = typeof roomInfo === "object" && "phase" in roomInfo ? Number((roomInfo as any).phase) : 0;
  const pendingReveal = Boolean(isPendingReveal);

  // WebSocket chat connection — single instance for the whole arena page
  // Players in active game: WebSocket (token-based, no re-signing)
  // Spectators of active game: REST polling (no auth needed)
  // Ended game / waiting: REST fetch once (no auth needed)
  const parsedRoomIdForChat = rawRoomId ? Number(rawRoomId) : undefined;
  const isPlayerInGameForChat =
    connectedAddress && allPlayers
      ? (allPlayers as string[]).some(p => p.toLowerCase() === connectedAddress.toLowerCase())
      : false;
  const chatMode: "ws" | "poll" | "static" | "off" =
    phase === 1 && isPlayerInGameForChat
      ? "ws" // players get real-time WebSocket
      : phase === 1
        ? "poll" // spectators of active game get REST polling
        : phase === 2
          ? "static" // ended game: fetch once
          : "off"; // waiting: no chat
  const {
    messages: chatMessages,
    sendMessage,
    isConnected,
    myMessageCount,
    myIsAI: chatMyIsAI,
  } = useChatSocket(parsedRoomIdForChat, chatMode);

  // Settle state
  const [isSettling, setIsSettling] = useState(false);
  const [showVictory, setShowVictory] = useState(false);
  const [showBriefing, setShowBriefing] = useState(true);
  const [isEmergencyEnding, setIsEmergencyEnding] = useState(false);
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    if (phase === 2 && prevPhaseRef.current !== 2 && prevPhaseRef.current !== 0) {
      // Refetch gameStats before showing victory — avoids stale default (humansWon=false)
      refetchGameStats().then(() => setShowVictory(true));
    }
    prevPhaseRef.current = phase;
  }, [phase, refetchGameStats]);

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
      await Promise.all([refetchCoreData(), refetchPlayerInfos()]);
    } catch (e: any) {
      const msg = e?.message || "";
      if (!msg.includes("Round not ended yet")) {
        console.error("Settle failed:", e);
      }
    } finally {
      setIsSettling(false);
    }
  };

  // Emergency end: fallback when operator fails to reveal
  const REVEAL_TIMEOUT = 3600;
  const canEmergencyEnd =
    pendingReveal && currentBlock > 0 && lastSettleBlock > 0 && currentBlock > lastSettleBlock + REVEAL_TIMEOUT;
  const emergencyBlocksRemaining =
    pendingReveal && currentBlock > 0 && lastSettleBlock > 0
      ? Math.max(0, lastSettleBlock + REVEAL_TIMEOUT - currentBlock)
      : 0;

  const handleEmergencyEnd = async () => {
    if (!roomId || isEmergencyEnding) return;
    setIsEmergencyEnding(true);
    try {
      await writeArena({ functionName: "emergencyEnd", args: [roomId] });
      await Promise.all([refetchCoreData(), refetchPlayerInfos()]);
    } catch (e: any) {
      console.error("Emergency end failed:", e);
    } finally {
      setIsEmergencyEnding(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden arena-bg text-gray-100">
      {/* HUD Top Bar */}
      <div className="relative flex items-center justify-between px-4 py-2 arena-header-bg shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="arena-text-amber font-mono text-xs font-bold">ROOM</span>
            <span className="text-white font-mono text-xs font-bold">#{rawRoomId}</span>
          </div>
          <div className="h-3 w-px bg-green-900/60" />
          <div className="flex items-center gap-1.5">
            <span className="arena-text-amber font-mono text-xs font-bold">PHASE</span>
            <span
              className={`font-mono text-xs font-bold px-1.5 py-0.5 border rounded ${pendingReveal ? "text-orange-400 border-orange-700/50" : phaseColor + " border-green-800/40"}`}
            >
              {pendingReveal ? "PENDING REVEAL" : phaseLabel}
            </span>
          </div>
          <div className="h-3 w-px bg-green-900/60" />
          <div className="flex items-center gap-1.5">
            <span className="arena-text-amber font-mono text-xs font-bold">ROUND</span>
            <span className="text-white font-mono text-xs font-bold">{currentRound}</span>
          </div>
          {isGameActive && !pendingReveal && (
            <>
              <div className="h-3 w-px bg-green-900/60" />
              <div className="flex items-center gap-1.5">
                <span className="arena-text-amber font-mono text-xs font-bold">SETTLE IN</span>
                {canSettle ? (
                  <span className="text-orange-400 font-mono text-xs font-bold animate-pulse">READY</span>
                ) : (
                  <span className="text-green-300 font-mono text-xs font-bold">{blocksRemaining} blocks</span>
                )}
              </div>
            </>
          )}
        </div>

        {/* FINAL SHOWDOWN Title — center */}
        <h1
          className="absolute left-1/2 top-1/2 text-xl font-black tracking-wider whitespace-nowrap pointer-events-none"
          style={{
            color: "#22c55e",
            textShadow: "0 0 16px rgba(34, 197, 94, 0.6), 0 0 4px rgba(34, 197, 94, 0.3)",
            transform: "translate(-50%, -50%)",
          }}
        >
          FINAL SHOWDOWN
        </h1>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="arena-text-amber font-mono text-xs font-bold">ALIVE</span>
            <span className="text-green-400 font-mono text-xs font-bold">
              {aliveCount}/{playerCount}
            </span>
          </div>
          <div className="h-3 w-px bg-green-900/60" />
          <div className="flex items-center gap-1.5">
            <span className="arena-text-amber font-mono text-xs font-bold">PRIZE</span>
            <span className="text-yellow-400 font-mono text-xs font-bold">
              {(Number(prizePool) / 1e6).toFixed(2)} USDC
            </span>
          </div>
          {isPlayerInGame && phase !== 2 && !pendingReveal && (
            <>
              <div className="h-3 w-px bg-green-900/60" />
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-green-400 font-mono text-xs font-bold">IN GAME</span>
              </div>
            </>
          )}
          {pendingReveal && phase === 1 && (
            <>
              <div className="h-3 w-px bg-green-900/60" />
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
                <span className="text-orange-400 font-mono text-xs">AWAITING REVEAL</span>
              </div>
              {canEmergencyEnd ? (
                <>
                  <div className="h-3 w-px bg-green-900/60" />
                  <button
                    onClick={handleEmergencyEnd}
                    disabled={isEmergencyEnding}
                    className="px-3 py-1 border border-red-600/60 text-red-400 font-mono text-xs hover:bg-red-900/20 transition-colors rounded animate-pulse"
                  >
                    {isEmergencyEnding ? <span className="loading loading-spinner loading-xs" /> : "EMERGENCY END"}
                  </button>
                </>
              ) : (
                <>
                  <div className="h-3 w-px bg-green-900/60" />
                  <span className="text-gray-500 font-mono text-xs">
                    EMERGENCY IN {emergencyBlocksRemaining} BLOCKS
                  </span>
                </>
              )}
              <div className="h-3 w-px bg-green-900/60" />
              <Link
                href="/lobby"
                className="px-3 py-1 border border-green-700/50 arena-text-amber font-mono text-xs hover:bg-green-900/20 transition-colors rounded"
              >
                BACK TO LOBBY
              </Link>
            </>
          )}
          {phase === 2 && (
            <>
              <div className="h-3 w-px bg-green-900/60" />
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-red-400 font-mono text-xs">GAME OVER</span>
              </div>
              <div className="h-3 w-px bg-green-900/60" />
              <button
                onClick={() => refetchGameStats().then(() => setShowVictory(true))}
                className="px-3 py-1 border border-yellow-600/50 text-yellow-400 font-mono text-xs hover:bg-yellow-900/20 transition-colors rounded"
              >
                VIEW RESULTS
              </button>
            </>
          )}
          {canSettle && !pendingReveal && (
            <>
              <div className="h-3 w-px bg-green-900/60" />
              <button
                onClick={handleSettle}
                disabled={isSettling}
                className="arena-btn-settle px-3 py-1 font-mono text-xs font-bold rounded animate-pulse"
              >
                {isSettling ? <span className="loading loading-spinner loading-xs" /> : "SETTLE ROUND"}
              </button>
            </>
          )}
          {phase === 0 && isPlayerInGame && (
            <>
              <div className="h-3 w-px bg-green-900/60" />
              <button
                onClick={handleLeave}
                className="px-3 py-1 border border-red-600/50 text-red-400 font-mono text-xs hover:bg-red-900/20 transition-colors rounded"
              >
                LEAVE ROOM
              </button>
            </>
          )}
          {canStartGame && (
            <>
              <div className="h-3 w-px bg-green-900/60" />
              <button
                onClick={handleStartGame}
                className="px-3 py-1 border border-green-500/50 text-green-400 font-mono text-xs hover:bg-green-900/20 transition-colors rounded animate-pulse"
              >
                START GAME
              </button>
            </>
          )}
          {phase === 0 && isCreator && playerCount < maxPlayers && (
            <>
              <div className="h-3 w-px bg-green-900/60" />
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
        <div className="col-span-3 border-r border-green-900/30 min-h-0 overflow-hidden">
          <PlayerRadar
            nameMap={nameMap}
            playerInfoMap={playerInfoMap}
            allPlayers={(allPlayers as string[]) || []}
            roomInfo={roomInfo}
          />
        </div>

        {/* Center - Chat Terminal */}
        <div className="col-span-6 flex flex-col min-h-0 overflow-hidden border-x border-green-900/20">
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
        <div className="col-span-3 border-l border-green-900/30 min-h-0 overflow-hidden">
          <VotePanel
            roomId={roomId}
            nameMap={nameMap}
            playerInfoMap={playerInfoMap}
            allPlayers={(allPlayers as string[]) || []}
            roomInfo={roomInfo}
            roundNum={currentRoundData}
            blockNumber={blockNumber}
            pendingReveal={pendingReveal}
            hasVotedOnChain={hasVotedOnChain}
            onEmergencyEnd={() => {
              refetchCoreData();
              refetchPlayerInfos();
            }}
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
          allPlayers={(allPlayers as string[]) || []}
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
