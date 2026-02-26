"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { readContract } from "@wagmi/core";
import { AnimatePresence, motion } from "framer-motion";
import type { NextPage } from "next";
import { formatUnits } from "viem";
import { useAccount, useConfig } from "wagmi";
import CreateRoomModal from "~~/app/_components/CreateRoomModal";
import QuickMatchButton from "~~/app/_components/QuickMatchButton";
import RoomCard from "~~/app/_components/RoomCard";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

type FilterTab = "mine" | "waiting" | "active" | "ended";

const FILTER_TABS: { id: FilterTab; label: string; phaseRange: number[] | null }[] = [
  { id: "mine", label: "My Games", phaseRange: null },
  { id: "waiting", label: "Waiting", phaseRange: [0] },
  { id: "active", label: "In Progress", phaseRange: [1] },
  { id: "ended", label: "Completed", phaseRange: [2] },
];

const LobbyPageContent = () => {
  const [activeFilter, setActiveFilter] = useState<FilterTab>("mine");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { address: connectedAddress } = useAccount();
  const searchParams = useSearchParams();
  const isQuickMatch = searchParams.get("quickMatch") === "true";

  const { data: activeRoomId } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "playerActiveRoom",
    args: [connectedAddress ?? "0x0000000000000000000000000000000000000000"],
  });
  const myActiveRoom = activeRoomId ? Number(activeRoomId) : 0;

  const { data: roomCount, isLoading: isLoadingCount } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRoomCount",
  });

  const totalRooms = roomCount !== undefined ? Number(roomCount) : 0;

  const roomIds = useMemo(() => {
    const ids: bigint[] = [];
    for (let i = 1; i <= totalRooms; i++) {
      ids.push(BigInt(i));
    }
    return ids;
  }, [totalRooms]);

  return (
    <div className="flex min-h-screen flex-col cyber-grid-bg">
      {/* Lobby Header */}
      <div className="relative w-full overflow-hidden py-6 md:py-8">
        <div className="relative z-10 flex flex-col items-center gap-2 px-4">
          <h1 className="text-2xl font-black tracking-wider text-primary md:text-3xl neon-text">BATTLE LOBBY</h1>
          <p className="text-sm tracking-widest text-secondary/70">Browse rooms. Quick match to fight.</p>
          <div className="flex items-center gap-3 mt-1">
            <div className="h-px w-12 bg-gradient-to-r from-transparent to-primary md:w-24" />
            <div className="h-1.5 w-1.5 rotate-45 border border-primary bg-transparent" />
            <div className="h-px w-12 bg-gradient-to-l from-transparent to-primary md:w-24" />
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
                className={`tab font-mono text-xs tracking-widest transition-colors ${
                  activeFilter === tab.id
                    ? "tab-active text-primary neon-text"
                    : "text-base-content/50 hover:text-base-content/80"
                }`}
                onClick={() => setActiveFilter(tab.id)}
              >
                {tab.label.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Quick Match / Active Room + Room count + USDC faucet */}
          <div className="flex items-center gap-4">
            {myActiveRoom > 0 ? (
              <Link
                href={`/arena?roomId=${myActiveRoom}`}
                className="btn btn-sm border-2 border-accent bg-accent/10 font-mono text-xs tracking-widest text-accent hover:bg-accent/20"
              >
                IN ROOM #{myActiveRoom} &rarr;
              </Link>
            ) : (
              <QuickMatchButton roomIds={roomIds} onNoMatch={() => setIsModalOpen(true)} autoMatch={isQuickMatch} />
            )}
            <UsdcFaucet />
            <div className="hidden text-xs tracking-widest text-base-content/40 md:block">
              {isLoadingCount ? (
                <span className="loading loading-dots loading-xs" />
              ) : (
                <span>
                  {totalRooms} ROOM{totalRooms !== 1 ? "S" : ""} FOUND
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Room Grid */}
        {isLoadingCount ? (
          <div className="flex h-64 items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <span className="loading loading-ring loading-lg text-primary" />
              <span className="terminal-text text-sm animate-pulse">SCANNING BLOCKCHAIN...</span>
            </div>
          </div>
        ) : totalRooms === 0 ? (
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
              <RoomGrid roomIds={roomIds} filter={activeFilter} connectedAddress={connectedAddress} />
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Floating create button */}
      <motion.button
        className="btn btn-circle btn-lg fixed bottom-8 right-8 z-50 border-2 border-primary bg-base-100 text-2xl font-bold text-primary shadow-lg"
        style={{
          boxShadow: "0 0 20px rgba(0, 255, 65, 0.3), 0 0 40px rgba(0, 255, 65, 0.1)",
        }}
        onClick={() => setIsModalOpen(true)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title="Create Room"
      >
        +
      </motion.button>

      {/* Create Room Modal */}
      <CreateRoomModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

      {/* Auto-navigate to arena when a joined room becomes Active */}
      {connectedAddress && roomIds.length > 0 && <RoomPhaseWatcher roomIds={roomIds} />}
    </div>
  );
};

const RoomGrid = ({
  roomIds,
  filter,
  connectedAddress,
}: {
  roomIds: bigint[];
  filter: FilterTab;
  connectedAddress: string | undefined;
}) => {
  if (roomIds.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {roomIds.map(id => (
        <FilteredRoomCard key={id.toString()} roomId={id} filter={filter} connectedAddress={connectedAddress} />
      ))}
    </div>
  );
};

const FilteredRoomCard = ({
  roomId,
  filter,
  connectedAddress,
}: {
  roomId: bigint;
  filter: FilterTab;
  connectedAddress: string | undefined;
}) => {
  const { data: roomInfo } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRoomInfo",
    args: [roomId],
  });

  const { data: players } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getAllPlayers",
    args: [roomId],
  });

  if (!roomInfo) {
    return (
      <div className="glass-panel cyber-border flex h-52 animate-pulse items-center justify-center rounded-lg p-4">
        <span className="terminal-text text-sm">LOADING...</span>
      </div>
    );
  }

  const room = roomInfo as unknown as { phase: number };
  const phase = Number(room.phase);

  // "My Games" filter: only show rooms where connected address is a player
  if (filter === "mine") {
    if (!connectedAddress || !players) return null;
    const isInRoom = (players as string[]).some(p => p.toLowerCase() === connectedAddress.toLowerCase());
    if (!isInRoom) return null;
    return <RoomCard roomId={roomId} />;
  }

  // Phase-based filters
  const filterConfig = FILTER_TABS.find(t => t.id === filter);
  if (filterConfig?.phaseRange && !filterConfig.phaseRange.includes(phase)) {
    return null;
  }

  return <RoomCard roomId={roomId} />;
};

const EmptyState = ({ onCreateClick }: { onCreateClick: () => void }) => (
  <div className="flex h-64 flex-col items-center justify-center gap-6">
    <div className="flex flex-col items-center gap-2">
      <span className="text-4xl">&#x25C8;</span>
      <p className="terminal-text text-center text-sm">NO ACTIVE ROOMS DETECTED</p>
      <p className="text-center text-xs tracking-wider text-base-content/40">Deploy the first battle room to begin.</p>
    </div>
    <button className="btn btn-outline btn-primary btn-sm font-bold tracking-widest" onClick={onCreateClick}>
      CREATE FIRST ROOM
    </button>
  </div>
);

const UsdcFaucet = () => {
  const { address, chain } = useAccount();

  const { data: balance } = useScaffoldReadContract({
    contractName: "MockUSDC",
    functionName: "balanceOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
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
 * Polls rooms the connected user has joined. When any room transitions
 * from Waiting (0) to Active (1), auto-navigates to the arena.
 */
const RoomPhaseWatcher = ({ roomIds }: { roomIds: bigint[] }) => {
  const router = useRouter();
  const wagmiConfig = useConfig();
  const { address } = useAccount();
  const { data: arenaInfo } = useDeployedContractInfo({ contractName: "TuringArena" });

  useEffect(() => {
    if (!address || !arenaInfo?.address || !arenaInfo.abi || roomIds.length === 0) return;

    let cancelled = false;

    const poll = async () => {
      try {
        for (let i = roomIds.length - 1; i >= 0; i--) {
          if (cancelled) return;
          const roomId = roomIds[i];

          const roomInfo = (await readContract(wagmiConfig, {
            address: arenaInfo.address,
            abi: arenaInfo.abi,
            functionName: "getRoomInfo",
            args: [roomId],
          })) as { phase: number };

          const phase = Number(roomInfo.phase);

          // Only care about Active rooms
          if (phase !== 1) continue;

          // Check if user is in this room
          const players = (await readContract(wagmiConfig, {
            address: arenaInfo.address,
            abi: arenaInfo.abi,
            functionName: "getAllPlayers",
            args: [roomId],
          })) as string[];

          const isInRoom = players.some(p => p.toLowerCase() === address.toLowerCase());
          if (isInRoom && !cancelled) {
            router.push(`/arena?roomId=${roomId.toString()}`);
            return;
          }
        }
      } catch {
        // Silently retry on next interval
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address, arenaInfo, roomIds, wagmiConfig, router]);

  return null;
};

const LobbyPage: NextPage = () => (
  <Suspense>
    <LobbyPageContent />
  </Suspense>
);

export default LobbyPage;
