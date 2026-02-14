export type VoteStrategy = "lowest_hp" | "most_active" | "random_alive";
export type ChatStrategy = "phase_aware" | "silent";

export type AutoPlayConfig = {
  roomId: string;
  voteStrategy: VoteStrategy;
  chatStrategy: ChatStrategy;
  chatFrequency: number; // 0-1, probability per tick of sending a message
  settleEnabled: boolean; // whether to call settleRound when eligible
  pollIntervalMs: number; // tick interval in ms
  maxRounds: number; // safety limit to auto-stop
};

export type AutoPlayStatus = {
  running: boolean;
  roomId: string;
  round: number;
  phase: number;
  phaseName: string;
  humanityScore: number;
  isAlive: boolean;
  votesThisGame: number;
  messagesThisGame: number;
  settlesThisGame: number;
  errors: string[];
  startedAt: number; // unix ms
  lastTickAt: number; // unix ms
};

export type PlayerState = {
  address: string;
  humanityScore: number;
  isAlive: boolean;
  actionCount: number;
  successfulVotes: number;
};

export type RoomState = {
  id: string;
  phase: number;
  phaseName: string;
  entryFee: bigint;
  prizePool: bigint;
  maxPlayers: number;
  playerCount: number;
  aliveCount: number;
  isActive: boolean;
  isEnded: boolean;
  currentInterval: number;
  lastSettleBlock: number;
  startBlock: number;
};

export const PHASE_NAMES = ["Waiting", "Phase1", "Phase2", "Phase3", "Ended"] as const;

export const DEFAULT_CONFIG: Omit<AutoPlayConfig, "roomId"> = {
  voteStrategy: "lowest_hp",
  chatStrategy: "phase_aware",
  chatFrequency: 0.3,
  settleEnabled: true,
  pollIntervalMs: 5000,
  maxRounds: 100,
};
