"use client";

import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

const TITLE = "REVERSE TURING TEST ARENA";

const HeroSection = () => {
  const { data: roomCount } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRoomCount",
  });

  const totalRooms = roomCount !== undefined ? Number(roomCount) : 0;

  return (
    <section className="relative w-full overflow-hidden py-8 md:py-12">
      <div className="relative z-10 flex flex-col items-center gap-4 px-4">
        {/* Main title with float effect */}
        <div className="text-center animate-float">
          <h1 className="text-4xl font-black tracking-wider text-primary md:text-6xl lg:text-7xl neon-text-breathe">
            {TITLE}
          </h1>
        </div>

        {/* Subtitle */}
        <p className="neon-text-cyan max-w-xl text-center text-lg tracking-widest text-secondary md:text-xl">
          Humans vs AI. Chat. Vote. Survive.
        </p>

        {/* Decorative separator */}
        <div className="flex items-center gap-3">
          <div className="h-px w-16 bg-gradient-to-r from-transparent to-primary md:w-32" />
          <div className="h-2 w-2 rotate-45 border border-primary bg-transparent" />
          <div className="h-px w-16 bg-gradient-to-l from-transparent to-primary md:w-32" />
        </div>

        {/* Stats bar */}
        <div className="glass-panel mt-2 flex flex-wrap items-center justify-center gap-6 rounded px-6 py-2 md:gap-10 md:px-10 md:py-3">
          <StatItem label="TOTAL ROOMS" value={totalRooms.toString()} />
          <div className="h-8 w-px bg-primary/30" />
          <StatItem label="PROTOCOL" value="MONAD EVM" />
          <div className="h-8 w-px bg-primary/30" />
          <StatItem label="GAME MODE" value="BATTLE ROYALE" />
          <div className="hidden h-8 w-px bg-primary/30 md:block" />
          <StatItem label="STATUS" value="ONLINE" highlight />
        </div>
      </div>
    </section>
  );
};

const StatItem = ({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) => (
  <div className="flex flex-col items-center gap-1">
    <span className="text-xs tracking-widest text-base-content/50">{label}</span>
    <span
      className={`text-sm font-bold tracking-wider md:text-base ${
        highlight ? "animate-pulse text-success neon-text" : "text-secondary"
      }`}
    >
      {value}
    </span>
  </div>
);

export default HeroSection;
