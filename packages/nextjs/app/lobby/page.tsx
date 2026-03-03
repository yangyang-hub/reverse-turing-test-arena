"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type { NextPage } from "next";
import { formatUnits } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import CreateRoomModal from "~~/app/_components/CreateRoomModal";
import QuickMatchButton from "~~/app/_components/QuickMatchButton";
import RoomCard from "~~/app/_components/RoomCard";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

const CHAT_SERVER_URL = process.env.NEXT_PUBLIC_CHAT_SERVER_URL || "http://localhost:43001";

type FilterTab = "mygame" | "waiting" | "active" | "ended";

type RoomSummary = {
  roomId: number;
  creator: string;
  tier: number;
  phase: number;
  entryFee: string;
  prizePool: string;
  maxPlayers: number;
  playerCount: number;
  aliveCount: number;
};

const FILTER_TABS: { id: FilterTab; label: string; icon: string; phaseRange: number[] }[] = [
  { id: "mygame", label: "My Game", icon: "👤", phaseRange: [0, 1, 2] },
  { id: "waiting", label: "Waiting", icon: "⏳", phaseRange: [0] },
  { id: "active", label: "In Game", icon: "⚔", phaseRange: [1] },
  { id: "ended", label: "History", icon: "🏆", phaseRange: [2] },
];

const LobbyPageContent = () => {
  const [activeFilter, setActiveFilter] = useState<FilterTab>("mygame");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNoMatchOpen, setIsNoMatchOpen] = useState(false);
  const [myRoomIds, setMyRoomIds] = useState<bigint[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [roomListVersion, setRoomListVersion] = useState(0);
  const [serverRooms, setServerRooms] = useState<RoomSummary[]>([]);
  const { address: connectedAddress } = useAccount();
  const searchParams = useSearchParams();
  const isQuickMatch = searchParams.get("quickMatch") === "true";

  const { data: activeRoomId, refetch: refetchActiveRoom } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "playerActiveRoom",
    args: [connectedAddress ?? "0x0000000000000000000000000000000000000000"],
    watch: false,
  });
  const myActiveRoom = activeRoomId ? Number(activeRoomId) : 0;

  // Fetch room count only for QuickMatchButton scanning (no polling)
  const { data: roomCount, refetch: refetchRoomCount } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRoomCount",
    watch: false,
  });
  const allRoomIds = useMemo(() => {
    const total = roomCount !== undefined ? Number(roomCount) : 0;
    const ids: bigint[] = [];
    for (let i = 1; i <= total; i++) ids.push(BigInt(i));
    return ids;
  }, [roomCount]);

  // Callback for child components to trigger data refresh after room operations
  const handleRoomChange = useCallback(() => {
    setRoomListVersion(v => v + 1);
    refetchActiveRoom();
    refetchRoomCount();
  }, [refetchActiveRoom, refetchRoomCount]);

  // Fetch only rooms this player participated in (from chat-server identity_records)
  useEffect(() => {
    if (!connectedAddress) {
      setMyRoomIds([]);
      return;
    }
    setIsLoadingRooms(true);
    fetch(`${CHAT_SERVER_URL}/api/players/${connectedAddress}/rooms`)
      .then(res => res.json())
      .then(data => {
        if (data.roomIds) {
          setMyRoomIds(data.roomIds.map((id: number) => BigInt(id)));
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingRooms(false));
  }, [connectedAddress, roomListVersion]);

  // Fetch room summaries from chat-server for public tabs (waiting/active/ended)
  useEffect(() => {
    if (activeFilter === "mygame") return;
    const tab = FILTER_TABS.find(t => t.id === activeFilter);
    const phase = tab?.phaseRange[0];
    fetch(`${CHAT_SERVER_URL}/api/rooms${phase !== undefined ? `?phase=${phase}` : ""}`)
      .then(r => r.json())
      .then(d => setServerRooms(d.rooms ?? []))
      .catch(() => setServerRooms([]));
  }, [activeFilter, roomListVersion]);

  // Merge identity_records rooms + active room (fallback if update-room-id hasn't run yet)
  const mergedRoomIds = useMemo(() => {
    const set = new Set(myRoomIds.map(id => id.toString()));
    if (myActiveRoom > 0) set.add(BigInt(myActiveRoom).toString());
    return Array.from(set).map(s => BigInt(s));
  }, [myRoomIds, myActiveRoom]);

  return (
    <div className="flex min-h-screen flex-col cyber-grid-bg">
      {/* Lobby Header */}
      <div className="relative w-full overflow-hidden py-6 md:py-8">
        <div className="relative z-10 flex flex-col items-center gap-2 px-4">
          <h1
            className="text-2xl font-black tracking-[0.15em] md:text-3xl"
            style={{
              background: "linear-gradient(90deg, #39d353 0%, #00e5ff 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            BATTLE LOBBY
          </h1>
          <p className="text-sm tracking-widest text-secondary/70">Your rooms. Quick match to fight.</p>
          <div className="flex items-center gap-3 mt-1">
            <div className="divider-line-left h-px w-12 md:w-24" />
            <motion.div
              className="h-1.5 w-1.5 rotate-45 border"
              animate={{
                scale: [1, 1.6, 1],
                borderColor: ["#39d353", "#00e5ff", "#39d353"],
                boxShadow: ["0 0 0px rgba(57,211,83,0)", "0 0 6px rgba(0,229,255,0.8)", "0 0 0px rgba(57,211,83,0)"],
              }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
            <div className="divider-line-right h-px w-12 md:w-24" />
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 md:px-8">
        {/* Filter tabs + create button row */}
        <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          {/* DaisyUI tabs */}
          <div className="tabs tabs-bordered">
            {FILTER_TABS.map(tab => (
              <button
                key={tab.id}
                className={`tab tab-lg font-mono text-base md:text-lg tracking-widest transition-colors gap-2 ${
                  activeFilter === tab.id
                    ? "tab-active text-primary"
                    : "text-base-content/50 hover:text-base-content/80"
                }`}
                onClick={() => setActiveFilter(tab.id)}
              >
                <span className="text-lg md:text-xl">{tab.icon}</span>
                {tab.label.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Quick Match / Active Room + Room count + USDC faucet */}
          <div className="flex items-center gap-4">
            {myActiveRoom > 0 ? (
              <Link
                href={`/arena?roomId=${myActiveRoom}`}
                className="btn btn-md border-2 border-accent bg-accent/10 font-mono text-sm tracking-widest text-accent hover:bg-accent/20"
              >
                IN ROOM #{myActiveRoom} &rarr;
              </Link>
            ) : (
              <QuickMatchButton
                roomIds={allRoomIds}
                onNoMatch={() => setIsNoMatchOpen(true)}
                autoMatch={isQuickMatch}
                onRoomJoined={handleRoomChange}
              />
            )}
            <UsdcFaucet />
          </div>
        </div>

        {/* Room Grid */}
        {activeFilter === "mygame" ? (
          !connectedAddress ? (
            <div className="flex h-64 items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <span className="text-4xl opacity-40">🔗</span>
                <span className="terminal-text text-sm text-base-content/50">CONNECT WALLET TO VIEW YOUR ROOMS</span>
              </div>
            </div>
          ) : isLoadingRooms ? (
            <div className="flex h-64 items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <span className="loading loading-ring loading-lg text-primary" />
                <span className="terminal-text text-sm animate-pulse">LOADING YOUR ROOMS...</span>
              </div>
            </div>
          ) : mergedRoomIds.length === 0 ? (
            <EmptyState onCreateClick={() => setIsModalOpen(true)} />
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeFilter}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <RoomGrid
                  roomIds={mergedRoomIds}
                  filter={activeFilter}
                  activeRoomId={myActiveRoom}
                  onRoomChange={handleRoomChange}
                />
              </motion.div>
            </AnimatePresence>
          )
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeFilter}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <ServerRoomGrid rooms={serverRooms} activeRoomId={myActiveRoom} onRoomChange={handleRoomChange} />
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Floating create button */}
      <motion.button
        className="fixed bottom-8 right-8 z-50 font-mono font-bold tracking-widest text-sm flex items-center gap-2 px-5 py-3"
        style={{
          clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))",
          background: "rgba(13,13,26,0.95)",
          border: "1px solid rgba(57,211,83,0.6)",
          color: "#39d353",
        }}
        onClick={() => setIsModalOpen(true)}
        whileHover={{
          backgroundColor: "rgba(57,211,83,0.08)",
          borderColor: "rgba(57,211,83,1)",
        }}
        whileTap={{ scale: 0.97 }}
        title="Create Room"
      >
        <span style={{ fontSize: "18px", lineHeight: 1 }}>✦</span>
        CREATE ROOM
      </motion.button>

      {/* Create Room Modal */}
      <CreateRoomModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onRoomChange={handleRoomChange} />

      {/* No Match Dialog */}
      <NoMatchModal
        isOpen={isNoMatchOpen}
        onClose={() => setIsNoMatchOpen(false)}
        onCreateRoom={() => {
          setIsNoMatchOpen(false);
          setIsModalOpen(true);
        }}
      />

      {/* Auto-navigate to arena when a joined room becomes Active */}
      {connectedAddress && <RoomPhaseWatcher activeRoomId={activeRoomId} />}
    </div>
  );
};

const TabEmptyState = () => (
  <div className="flex w-full flex-col items-center justify-center py-16 px-4">
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center gap-5"
    >
      <motion.img
        src="/icon-group.png"
        alt="No rooms"
        className="w-28 h-28 md:w-36 md:h-36 opacity-40"
        animate={{
          y: [0, -6, 0],
        }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="text-center">
        <p className="font-mono text-sm font-bold tracking-[0.15em] uppercase mb-1" style={{ color: "#39d353" }}>
          No Rooms Found
        </p>
        <p className="font-mono text-xs tracking-wider text-base-content/40 max-w-xs">
          You have no rooms in this category. Use Quick Match or Create Room to get started.
        </p>
      </div>
    </motion.div>
  </div>
);

const RoomGrid = ({
  roomIds,
  filter,
  activeRoomId,
  onRoomChange,
}: {
  roomIds: bigint[];
  filter: FilterTab;
  activeRoomId?: number;
  onRoomChange?: () => void;
}) => {
  const [visibilityMap, setVisibilityMap] = useState<Record<string, boolean>>({});
  const { data: arenaInfo } = useDeployedContractInfo({ contractName: "TuringArena" });

  // Batch-fetch all roomInfo in a single multicall (N individual hooks → 1 batch)
  const roomInfoContracts = useMemo(() => {
    if (!arenaInfo) return [];
    return roomIds.map(id => ({
      address: arenaInfo.address,
      abi: arenaInfo.abi,
      functionName: "getRoomInfo" as const,
      args: [id] as const,
    }));
  }, [arenaInfo, roomIds]);

  const { data: batchRoomInfos, refetch: refetchBatchRoomInfos } = useReadContracts({
    contracts: roomInfoContracts,
    query: { enabled: roomInfoContracts.length > 0, refetchInterval: 10_000 },
  });

  const roomInfoMap = useMemo(() => {
    const map: Record<string, any> = {};
    if (!batchRoomInfos) return map;
    for (let i = 0; i < roomIds.length && i < batchRoomInfos.length; i++) {
      if (batchRoomInfos[i].status === "success" && batchRoomInfos[i].result) {
        map[roomIds[i].toString()] = batchRoomInfos[i].result;
      }
    }
    return map;
  }, [batchRoomInfos, roomIds]);

  const handleRoomChange = useCallback(() => {
    onRoomChange?.();
    refetchBatchRoomInfos();
  }, [onRoomChange, refetchBatchRoomInfos]);

  // Sort rooms: phase priority (Waiting=0 > Active=1 > Ended=2), then roomId descending within each group
  const sortedRoomIds = useMemo(() => {
    if (Object.keys(roomInfoMap).length === 0) return roomIds;
    return [...roomIds].sort((a, b) => {
      const infoA = roomInfoMap[a.toString()] as { phase: number } | undefined;
      const infoB = roomInfoMap[b.toString()] as { phase: number } | undefined;
      const phaseA = infoA ? Number(infoA.phase) : 99;
      const phaseB = infoB ? Number(infoB.phase) : 99;
      if (phaseA !== phaseB) return phaseA - phaseB;
      return Number(b) - Number(a); // descending roomId
    });
  }, [roomIds, roomInfoMap]);

  // Reset visibility map when filter changes
  useEffect(() => {
    setVisibilityMap({});
  }, [filter]);

  const handleVisibility = useCallback((id: string, isVisible: boolean) => {
    setVisibilityMap(prev => {
      if (prev[id] === isVisible) return prev;
      return { ...prev, [id]: isVisible };
    });
  }, []);

  if (roomIds.length === 0) {
    return <TabEmptyState />;
  }

  const reportedCount = Object.keys(visibilityMap).length;
  const visibleCount = Object.values(visibilityMap).filter(Boolean).length;
  const allReported = reportedCount >= sortedRoomIds.length;
  const showEmpty = allReported && visibleCount === 0;

  return (
    <>
      <div
        className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        style={showEmpty ? { display: "none" } : undefined}
      >
        {sortedRoomIds.map(id => (
          <FilteredRoomCard
            key={id.toString()}
            roomId={id}
            roomInfo={roomInfoMap[id.toString()]}
            filter={filter}
            activeRoomId={activeRoomId}
            onVisibility={handleVisibility}
            onRoomChange={handleRoomChange}
          />
        ))}
      </div>
      {showEmpty && <TabEmptyState />}
    </>
  );
};

const FilteredRoomCard = ({
  roomId,
  roomInfo,
  filter,
  activeRoomId,
  onVisibility,
  onRoomChange,
}: {
  roomId: bigint;
  roomInfo?: any;
  filter: FilterTab;
  activeRoomId?: number;
  onVisibility?: (id: string, visible: boolean) => void;
  onRoomChange?: () => void;
}) => {
  const room = roomInfo ? (roomInfo as unknown as { phase: number }) : null;
  const phase = room ? Number(room.phase) : null;
  const filterConfig = FILTER_TABS.find(t => t.id === filter);
  const isVisible = phase !== null && filterConfig?.phaseRange ? filterConfig.phaseRange.includes(phase) : false;

  useEffect(() => {
    if (phase !== null && onVisibility) {
      onVisibility(roomId.toString(), isVisible);
    }
  }, [phase, isVisible, onVisibility, roomId]);

  if (!roomInfo) {
    return null;
  }

  if (!isVisible) return null;

  return <RoomCard roomId={roomId} roomInfo={roomInfo} activeRoomId={activeRoomId} onRoomChange={onRoomChange} />;
};

function summaryToRoomInfo(s: RoomSummary) {
  return {
    phase: s.phase,
    tier: s.tier,
    entryFee: BigInt(s.entryFee),
    prizePool: BigInt(s.prizePool),
    playerCount: BigInt(s.playerCount),
    maxPlayers: BigInt(s.maxPlayers),
    aliveCount: BigInt(s.aliveCount),
    creator: s.creator,
  };
}

const ServerRoomGrid = ({
  rooms,
  activeRoomId,
  onRoomChange,
}: {
  rooms: RoomSummary[];
  activeRoomId?: number;
  onRoomChange?: () => void;
}) => {
  if (rooms.length === 0) {
    return <TabEmptyState />;
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {rooms.map(room => (
        <RoomCard
          key={room.roomId}
          roomId={BigInt(room.roomId)}
          roomInfo={summaryToRoomInfo(room)}
          activeRoomId={activeRoomId}
          onRoomChange={onRoomChange}
        />
      ))}
    </div>
  );
};

const EmptyState = ({ onCreateClick }: { onCreateClick: () => void }) => (
  <div className="flex w-full flex-col items-center justify-center px-4 py-8">
    {/* Card container — bronze border matching the art */}
    <div
      className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-2xl"
      style={{
        border: "2px solid #8B6914",
        boxShadow: "0 0 30px rgba(139,105,20,0.15), 0 4px 20px rgba(0,0,0,0.5)",
      }}
    >
      {/* Image — full brightness, the star of the show */}
      <img src="/nomatch.jpg" alt="No matching rooms found" className="w-full object-cover block" />

      {/* Bottom action bar — warm bronze gradient */}
      <div
        className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-5 sm:px-8"
        style={{
          background: "linear-gradient(180deg, #1a1408 0%, #0d0d1a 100%)",
          borderTop: "1px solid rgba(139,105,20,0.3)",
        }}
      >
        {/* Left text */}
        <div className="text-center sm:text-left">
          <p className="font-mono text-xs font-bold tracking-[0.2em] uppercase" style={{ color: "#C9A84C" }}>
            ◆ Awaiting Challengers
          </p>
          <p className="font-mono text-[11px] tracking-wider text-base-content/40 mt-0.5">
            Deploy the first battle room to begin the showdown.
          </p>
        </div>

        {/* CTA button — bronze / steampunk metallic style */}
        <button
          className="group/btn relative overflow-hidden font-mono text-sm font-black tracking-[0.15em] uppercase px-7 py-3 rounded-lg transition-all duration-300 active:scale-95 shrink-0 cursor-pointer bronze-pulse"
          style={{
            background: "linear-gradient(135deg, #8B6914 0%, #C9A84C 50%, #8B6914 100%)",
            color: "#1a1408",
            boxShadow:
              "0 0 12px rgba(201,168,76,0.3), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -1px 0 rgba(0,0,0,0.3)",
            border: "1px solid #C9A84C",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              "0 0 24px rgba(201,168,76,0.5), inset 0 1px 0 rgba(255,255,255,0.3), inset 0 -1px 0 rgba(0,0,0,0.3)";
            (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              "0 0 12px rgba(201,168,76,0.3), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -1px 0 rgba(0,0,0,0.3)";
            (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
          }}
          onClick={onCreateClick}
        >
          {/* Shimmer sweep */}
          <div
            className="absolute inset-0 [transform:skew(-20deg)_translateX(-180%)] group-hover/btn:[transform:skew(-20deg)_translateX(180%)] group-hover/btn:duration-700"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)",
            }}
          />
          <span className="relative z-10">⚔ CREATE FIRST ROOM</span>
        </button>
      </div>
    </div>
  </div>
);

const NoMatchModal = ({
  isOpen,
  onClose,
  onCreateRoom,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreateRoom: () => void;
}) => (
  <AnimatePresence>
    {isOpen && (
      <>
        {/* Backdrop */}
        <motion.div
          className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
        {/* Dialog */}
        <motion.div
          className="fixed inset-0 z-[101] flex items-center justify-center p-4"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ type: "spring", duration: 0.4, bounce: 0.2 }}
        >
          <div
            className="relative w-full max-w-md overflow-hidden rounded-xl"
            style={{
              background: "linear-gradient(180deg, #141014 0%, #0d0d1a 100%)",
              border: "1px solid rgba(139,105,20,0.4)",
              boxShadow: "0 0 40px rgba(0,0,0,0.6), 0 0 20px rgba(139,105,20,0.1)",
            }}
          >
            {/* Close button */}
            <button
              className="absolute top-3 right-3 z-10 h-7 w-7 flex items-center justify-center rounded-full text-base-content/40 hover:text-base-content/80 hover:bg-base-content/10 transition-colors"
              onClick={onClose}
            >
              ✕
            </button>

            {/* Image */}
            <img
              src="/nomatch.jpg"
              alt="No match"
              className="w-full h-40 object-cover object-top"
              style={{ borderBottom: "1px solid rgba(139,105,20,0.2)" }}
            />

            {/* Content */}
            <div className="px-6 py-5 text-center">
              <h3
                className="font-mono text-lg font-black tracking-[0.12em] uppercase mb-2"
                style={{ color: "#C9A84C" }}
              >
                No Matching Rooms
              </h3>
              <p className="font-mono text-xs tracking-wider text-base-content/50 leading-relaxed mb-6">
                No rooms match your current filters.
                <br />
                You can adjust filters and try again, or create a brand new room.
              </p>

              <div className="flex gap-3">
                <button
                  className="btn btn-sm flex-1 font-mono text-xs tracking-widest text-base-content/50 border-base-content/15 bg-transparent hover:bg-base-content/5"
                  onClick={onClose}
                >
                  CLOSE
                </button>
                <button
                  className="group/btn relative flex-1 overflow-hidden font-mono text-xs font-bold tracking-[0.15em] uppercase px-4 py-2 rounded-lg transition-all duration-300 active:scale-95 cursor-pointer bronze-pulse"
                  style={{
                    background: "linear-gradient(135deg, #8B6914 0%, #C9A84C 50%, #8B6914 100%)",
                    color: "#1a1408",
                    border: "1px solid #C9A84C",
                  }}
                  onClick={onCreateRoom}
                >
                  <div
                    className="absolute inset-0 [transform:skew(-20deg)_translateX(-180%)] group-hover/btn:[transform:skew(-20deg)_translateX(180%)] group-hover/btn:duration-700"
                    style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)" }}
                  />
                  <span className="relative z-10">⚔ CREATE ROOM</span>
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

const UsdcFaucet = () => {
  const { address, chain } = useAccount();

  const { data: balance, refetch: refetchBalance } = useScaffoldReadContract({
    contractName: "MockUSDC",
    functionName: "balanceOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    watch: false,
  });

  const { writeContractAsync, isMining } = useScaffoldWriteContract({
    contractName: "MockUSDC",
  });

  const isLocal = chain?.id === 31337;

  const handleMint = async () => {
    if (!address) return;
    try {
      await writeContractAsync({
        functionName: "mint",
        args: [address, BigInt(100e6)],
      });
      refetchBalance();
    } catch (e) {
      console.error("Mint failed:", e);
    }
  };

  if (!address) return null;

  const displayBalance = balance !== undefined ? formatUnits(balance, 6) : "0";

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-xs text-base-content/50">
        {displayBalance} <span className="text-secondary/60">USDC</span>
      </span>
      {isLocal && (
        <button
          className="btn btn-outline btn-xs border-secondary/40 font-mono text-xs tracking-wider text-secondary hover:bg-secondary/10"
          onClick={handleMint}
          disabled={isMining}
        >
          {isMining ? <span className="loading loading-spinner loading-xs" /> : "MINT 100"}
        </button>
      )}
    </div>
  );
};

/**
 * Watches the connected user's active room. Only auto-navigates to the arena
 * when the phase transitions from Waiting (0) to Active (1) — i.e. when the
 * game just started. If the player is already in an Active game and navigates
 * back to the lobby, no redirect happens.
 */
const RoomPhaseWatcher = ({ activeRoomId }: { activeRoomId: bigint | undefined }) => {
  const router = useRouter();
  const { address } = useAccount();
  const prevPhaseRef = useRef<number | null>(null);

  const roomId = activeRoomId ? BigInt(activeRoomId) : 0n;

  const { data: roomInfo } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRoomInfo",
    args: [roomId],
    query: { enabled: roomId > 0n, refetchInterval: 5_000 },
    watch: false,
  });

  useEffect(() => {
    if (!address || roomId === 0n || !roomInfo) return;
    const phase = Number((roomInfo as unknown as { phase: number }).phase);
    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = phase;

    // Only redirect on Waiting → Active transition (prevPhase was 0, now 1)
    if (prevPhase === 0 && phase === 1) {
      router.push(`/arena?roomId=${roomId.toString()}`);
    }
  }, [address, roomId, roomInfo, router]);

  return null;
};

const LobbyPage: NextPage = () => (
  <Suspense>
    <LobbyPageContent />
  </Suspense>
);

export default LobbyPage;
