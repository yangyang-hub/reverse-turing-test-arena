"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { NextPage } from "next";
import CreateRoomModal from "~~/app/_components/CreateRoomModal";
import HeroSection from "~~/app/_components/HeroSection";
import RoomCard from "~~/app/_components/RoomCard";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

type FilterTab = "all" | "waiting" | "active" | "ended";

const FILTER_TABS: { id: FilterTab; label: string; phaseRange: number[] | null }[] = [
  { id: "all", label: "All", phaseRange: null },
  { id: "waiting", label: "Waiting", phaseRange: [0] },
  { id: "active", label: "In Progress", phaseRange: [1, 2, 3] },
  { id: "ended", label: "Completed", phaseRange: [4] },
];

const Home: NextPage = () => {
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: roomCount, isLoading: isLoadingCount } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRoomCount",
  });

  const totalRooms = roomCount !== undefined ? Number(roomCount) : 0;

  // Generate room IDs array (0 to roomCount-1)
  const roomIds = useMemo(() => {
    const ids: bigint[] = [];
    for (let i = 0; i < totalRooms; i++) {
      ids.push(BigInt(i));
    }
    return ids;
  }, [totalRooms]);

  return (
    <div className="flex min-h-screen flex-col cyber-grid-bg">
      {/* Hero Section */}
      <HeroSection />

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

          {/* Room count display */}
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
              <RoomGrid roomIds={roomIds} filter={activeFilter} />
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
    </div>
  );
};

/**
 * RoomGrid renders RoomCards, filtering on-screen by reading each room's phase.
 * Since we need per-room data for filtering, we render all RoomCards but use
 * a wrapper that conditionally hides cards not matching the filter.
 */
const RoomGrid = ({ roomIds, filter }: { roomIds: bigint[]; filter: FilterTab }) => {
  if (roomIds.length === 0) {
    return null;
  }

  // When filter is "all", render everything directly
  if (filter === "all") {
    return (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {roomIds.map(id => (
          <RoomCard key={id.toString()} roomId={id} />
        ))}
      </div>
    );
  }

  // For filtered views, render FilteredRoomCards that self-hide if not matching
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {roomIds.map(id => (
        <FilteredRoomCard key={id.toString()} roomId={id} filter={filter} />
      ))}
    </div>
  );
};

/**
 * FilteredRoomCard reads room info and only renders if the phase matches the filter.
 */
const FilteredRoomCard = ({ roomId, filter }: { roomId: bigint; filter: FilterTab }) => {
  const { data: roomInfo } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRoomInfo",
    args: [roomId],
  });

  if (!roomInfo) {
    // Still loading, show placeholder
    return (
      <div className="glass-panel cyber-border flex h-52 animate-pulse items-center justify-center rounded-lg p-4">
        <span className="terminal-text text-sm">LOADING...</span>
      </div>
    );
  }

  const room = roomInfo as unknown as { phase: number };
  const phase = Number(room.phase);

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

export default Home;
