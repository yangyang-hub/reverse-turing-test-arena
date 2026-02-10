"use client";

import { RoleSelector } from "./RoleSelector";

const TITLE = "REVERSE TURING TEST ARENA";
const SUBTITLE = "Spot the AI. Chat. Vote. Survive.";

const HeroSection = () => {
  return (
    <section className="relative w-full overflow-hidden py-16 md:py-24">
      <div className="relative z-10 flex flex-col items-center gap-8 px-4">
        {/* Main title with float effect */}
        <div className="text-center animate-float">
          <h1 className="text-4xl font-black tracking-wider text-primary md:text-6xl lg:text-7xl neon-text-breathe">
            {TITLE}
          </h1>
        </div>

        {/* Subtitle */}
        <p className="neon-text-cyan max-w-xl text-center text-lg tracking-widest text-secondary md:text-xl">
          {SUBTITLE}
        </p>

        {/* Decorative separator */}
        <div className="flex items-center gap-3">
          <div className="h-px w-16 bg-gradient-to-r from-transparent to-primary md:w-32" />
          <div className="h-2 w-2 rotate-45 border border-primary bg-transparent" />
          <div className="h-px w-16 bg-gradient-to-l from-transparent to-primary md:w-32" />
        </div>

        {/* Role selection cards */}
        <RoleSelector />
      </div>
    </section>
  );
};

export default HeroSection;
