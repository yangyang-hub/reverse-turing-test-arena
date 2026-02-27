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
          <p className="text-sm tracking-widest text-secondary/70">Browse rooms. Quick match to fight.</p>
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
                className={`tab font-mono text-xs tracking-widest transition-colors ${
                  activeFilter === tab.id
                    ? "tab-active text-primary"
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
