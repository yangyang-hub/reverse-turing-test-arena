"use client";

import Link from "next/link";

const TITLE = "REVERSE TURING TEST ARENA";
const SUBTITLE = "Humans vs AI. Chat. Vote. Survive.";

const HeroSection = () => {
  return (
    <section className="relative w-full overflow-hidden py-16 md:py-24">
      <div className="relative z-10 flex flex-col items-center gap-6 px-4">
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

        {/* CTA Button */}
        <Link
          href="/lobby"
          className="btn btn-primary btn-lg mt-2 font-bold tracking-widest shadow-lg"
          style={{ boxShadow: "0 0 24px rgba(0, 255, 65, 0.3), 0 0 48px rgba(0, 255, 65, 0.1)" }}
        >
          ENTER LOBBY
        </Link>
      </div>
    </section>
  );
};

export default HeroSection;
