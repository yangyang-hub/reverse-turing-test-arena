import { ethers } from "ethers";

// ERC-20 ABI (for approve, balance checks, mint)
export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function mint(address to, uint256 amount)",
];

// TuringArena ABI — full set for MCP adapter + auto-play
export const ARENA_ABI = [
  // View functions — structs
  "function getRoomInfo(uint256 roomId) view returns (tuple(uint256 id, address creator, uint8 tier, uint8 phase, uint256 entryFee, uint256 prizePool, uint256 startBlock, uint256 halfwayBlock, uint256 baseInterval, uint256 currentInterval, uint256 maxPlayers, uint256 playerCount, uint256 aliveCount, uint256 eliminatedCount, int256 currentDecay, uint256 lastSettleBlock, bool isActive, bool isEnded))",
  "function getPlayerInfo(uint256 roomId, address player) view returns (tuple(address addr, int256 humanityScore, bool isAlive, bool isVerifiedHuman, uint256 joinBlock, uint256 eliminationBlock, uint256 eliminationRank, uint256 lastActionBlock, uint256 actionCount, uint256 successfulVotes))",
  "function getAllPlayers(uint256 roomId) view returns (address[])",
  "function getRoomCount() view returns (uint256)",
  "function paymentToken() view returns (address)",
  // View functions — mappings
  "function currentRound(uint256 roomId) view returns (uint256)",
  "function hasVotedInRound(uint256 roomId, uint256 round, address player) view returns (bool)",
  "function getRewardInfo(uint256 roomId, address player) view returns (uint256 amount, bool claimed)",
  // Write functions
  "function sendMessage(uint256 roomId, string content)",
  "function castVote(uint256 roomId, address target)",
  "function joinRoom(uint256 roomId)",
  "function settleRound(uint256 roomId)",
  "function startGame(uint256 roomId)",
  "function createRoom(uint8 tier, uint256 maxPlayers, uint256 entryFee) returns (uint256 roomId)",
  "function leaveRoom(uint256 roomId)",
  "function claimReward(uint256 roomId)",
  // Events
  "event NewMessage(uint256 indexed roomId, address indexed sender, string content, uint256 timestamp)",
  "event VoteCast(uint256 indexed roomId, address indexed voter, address indexed target, uint256 round)",
  "event PlayerEliminated(uint256 indexed roomId, address indexed player, uint256 round, address eliminatedBy)",
  "event GameEnded(uint256 indexed roomId, address champion, uint256 totalRounds)",
];

// SessionKeyValidator ABI
export const SESSION_ABI = [
  "function createSession(address sessionKey, uint256 duration, uint256 maxUsage)",
  "function revokeSession(address sessionKey)",
  "function isSessionValid(address sessionKey) view returns (bool)",
  "function getSessionRemainingTime(address sessionKey) view returns (uint256)",
  "function getSessionOwner(address sessionKey) view returns (address)",
  "function sessions(address) view returns (address owner, uint256 expiresAt, uint256 maxUsage, uint256 usageCount, bool isRevoked)",
];

// Contract factory helpers
export function getArenaContract(addressOrProvider: string, signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(addressOrProvider, ARENA_ABI, signerOrProvider);
}

export function getTokenContract(address: string, signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(address, ERC20_ABI, signerOrProvider);
}

export function getSessionContract(address: string, signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(address, SESSION_ABI, signerOrProvider);
}
