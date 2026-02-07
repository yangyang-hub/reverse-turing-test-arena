import { create } from "zustand";

export type GamePhase = "Waiting" | "Phase1" | "Phase2" | "Phase3" | "Ended";
export type RoomTier = "Quick" | "Standard" | "Epic";
export type MessageType = "chat" | "system" | "vote" | "elimination" | "phase";

export type Room = {
  id: bigint;
  creator: string;
  tier: RoomTier;
  phase: GamePhase;
  entryFee: bigint;
  prizePool: bigint;
  playerCount: number;
  aliveCount: number;
  currentRound: number;
  isActive: boolean;
  isEnded: boolean;
};

export type Player = {
  addr: string;
  humanityScore: number;
  isAlive: boolean;
  isVerifiedHuman: boolean;
  eliminationRank: number;
  successfulVotes: number;
};

export type ChatMessage = {
  id: string;
  roomId: bigint;
  sender: string;
  content: string;
  timestamp: number;
  type: MessageType;
  isPending?: boolean;
};

export type Elimination = {
  roomId: bigint;
  player: string;
  eliminatedBy: string;
  reason: string;
  finalScore: number;
  timestamp: number;
};

type UIFlags = {
  showCountdown: boolean;
  showPhaseTransition: boolean;
  showVictory: boolean;
  showKillFeed: boolean;
};

type GameState = {
  currentRoom: Room | null;
  rooms: Room[];
  gamePhase: GamePhase;
  players: Player[];
  myPlayer: Player | null;
  chatMessages: ChatMessage[];
  eliminations: Elimination[];
  currentRound: number;
  selectedVoteTarget: string | null;
  uiFlags: UIFlags;
};

type GameActions = {
  setCurrentRoom: (room: Room | null) => void;
  setRooms: (rooms: Room[]) => void;
  setGamePhase: (phase: GamePhase) => void;
  setPlayers: (players: Player[]) => void;
  setMyPlayer: (player: Player | null) => void;
  addMessage: (msg: ChatMessage) => void;
  addElimination: (elimination: Elimination) => void;
  setCurrentRound: (round: number) => void;
  setSelectedVoteTarget: (target: string | null) => void;
  setUIFlag: (flag: keyof UIFlags, value: boolean) => void;
  transitionPhase: (phase: GamePhase) => void;
  eliminatePlayer: (addr: string) => void;
  reset: () => void;
};

const initialState: GameState = {
  currentRoom: null,
  rooms: [],
  gamePhase: "Waiting",
  players: [],
  myPlayer: null,
  chatMessages: [],
  eliminations: [],
  currentRound: 0,
  selectedVoteTarget: null,
  uiFlags: {
    showCountdown: false,
    showPhaseTransition: false,
    showVictory: false,
    showKillFeed: true,
  },
};

export const useGameStore = create<GameState & GameActions>()(set => ({
  ...initialState,

  setCurrentRoom: room => set({ currentRoom: room }),
  setRooms: rooms => set({ rooms }),
  setGamePhase: phase => set({ gamePhase: phase }),
  setPlayers: players => set({ players }),
  setMyPlayer: player => set({ myPlayer: player }),

  addMessage: msg =>
    set(state => ({
      chatMessages: [...state.chatMessages, msg],
    })),

  addElimination: elimination =>
    set(state => ({
      eliminations: [elimination, ...state.eliminations],
    })),

  setCurrentRound: round => set({ currentRound: round }),
  setSelectedVoteTarget: target => set({ selectedVoteTarget: target }),

  setUIFlag: (flag, value) =>
    set(state => ({
      uiFlags: { ...state.uiFlags, [flag]: value },
    })),

  transitionPhase: phase =>
    set(state => ({
      gamePhase: phase,
      uiFlags: { ...state.uiFlags, showPhaseTransition: true },
    })),

  eliminatePlayer: addr =>
    set(state => ({
      players: state.players.map(p => (p.addr === addr ? { ...p, isAlive: false } : p)),
    })),

  reset: () => set(initialState),
}));
