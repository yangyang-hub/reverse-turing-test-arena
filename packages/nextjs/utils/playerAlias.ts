// NATO-phonetic + cyberpunk codenames (50 total — matches max players)
const ALIASES = [
  "Alpha",
  "Bravo",
  "Charlie",
  "Delta",
  "Echo",
  "Foxtrot",
  "Ghost",
  "Havoc",
  "Icarus",
  "Jinx",
  "Kilo",
  "Lima",
  "Mirage",
  "Neon",
  "Omega",
  "Phantom",
  "Quasar",
  "Razor",
  "Specter",
  "Tango",
  "Umbra",
  "Viper",
  "Wraith",
  "Xeno",
  "Yonder",
  "Zenith",
  "Axiom",
  "Bolt",
  "Cipher",
  "Drift",
  "Ember",
  "Flux",
  "Glitch",
  "Haze",
  "Ion",
  "Jolt",
  "Karma",
  "Lux",
  "Morph",
  "Nexus",
  "Onyx",
  "Pulse",
  "Quake",
  "Rune",
  "Shard",
  "Trace",
  "Unity",
  "Volt",
  "Warp",
  "Zero",
];

// Cyberpunk palette for avatar backgrounds
const COLORS = [
  "#00FFFF",
  "#FF00FF",
  "#00FF41",
  "#FFD700",
  "#FF4444",
  "#7B68EE",
  "#FF6B35",
  "#00E5FF",
  "#FF1493",
  "#39FF14",
  "#FF8C00",
  "#BA55D3",
  "#20B2AA",
  "#DC143C",
  "#4169E1",
  "#32CD32",
  "#FF69B4",
  "#1E90FF",
  "#FF7F50",
  "#9370DB",
  "#00CED1",
  "#FF4500",
  "#6A5ACD",
  "#2E8B57",
  "#DAA520",
  "#CD5C5C",
  "#4682B4",
  "#8FBC8F",
  "#D2691E",
  "#5F9EA0",
  "#B22222",
  "#228B22",
  "#DB7093",
  "#008B8B",
  "#CD853F",
  "#483D8B",
  "#BDB76B",
  "#8B0000",
  "#3CB371",
  "#C71585",
  "#556B2F",
  "#FF8247",
  "#6495ED",
  "#7FFF00",
  "#D2B48C",
  "#9932CC",
  "#66CDAA",
  "#FF6347",
  "#4B0082",
  "#F0E68C",
];

type PlayerAlias = {
  name: string;
  color: string;
  initial: string;
};

/**
 * Returns alias info for a player based on their index in the getAllPlayers array.
 * If nameMap is provided and has an entry for this address, uses the on-chain name.
 * Deterministic: same address in same room always gets the same alias.
 */
export function getPlayerAlias(players: string[], address: string, nameMap?: Record<string, string>): PlayerAlias {
  const idx = players.findIndex(p => p.toLowerCase() === address.toLowerCase());
  if (idx === -1) {
    return { name: "Unknown", color: "#666666", initial: "?" };
  }
  const chainName = nameMap?.[address.toLowerCase()];
  const name = chainName || ALIASES[idx % ALIASES.length];
  const color = COLORS[idx % COLORS.length];
  return { name, color, initial: name[0] };
}

/**
 * Shorthand — returns just the alias name string.
 */
export function getAliasName(players: string[], address: string, nameMap?: Record<string, string>): string {
  return getPlayerAlias(players, address, nameMap).name;
}
