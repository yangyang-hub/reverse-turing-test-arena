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
  "function getRoomInfo(uint256 roomId) view returns (tuple(uint256 id, address creator, uint8 tier, uint8 phase, uint256 entryFee, uint256 prizePool, uint256 startBlock, uint256 baseInterval, uint256 currentInterval, uint256 maxPlayers, uint256 playerCount, uint256 aliveCount, uint256 eliminatedCount, uint256 humanCount, uint256 aiCount, uint256 lastSettleBlock, bool isActive, bool isEnded))",
  "function getPlayerInfo(uint256 roomId, address player) view returns (tuple(address addr, int256 humanityScore, bool isAlive, bool isAI, uint256 joinBlock, uint256 eliminationBlock, uint256 eliminationRank, uint256 lastActionBlock, uint256 actionCount, uint256 successfulVotes))",
  "function getGameStats(uint256 roomId) view returns (tuple(bool humansWon, address mvp, uint256 mvpVotes))",
  "function getAllPlayers(uint256 roomId) view returns (address[])",
  "function getRoomCount() view returns (uint256)",
  "function paymentToken() view returns (address)",
  // View functions — mappings
  "function currentRound(uint256 roomId) view returns (uint256)",
  "function hasVotedInRound(uint256 roomId, uint256 round, address player) view returns (bool)",
  "function voteTarget(uint256 roomId, uint256 round, address voter) view returns (address)",
  "function getRewardInfo(uint256 roomId, address player) view returns (uint256 amount, bool claimed)",
  "function getMessageCount(uint256 roomId, uint256 round, address player) view returns (uint256)",
  // View functions — helpers
  "function getEliminationOrder(uint256 roomId) view returns (address[])",
  "function allAliveVoted(uint256 roomId) view returns (bool)",
  "function getContractBalance() view returns (uint256)",
  // Write functions
  "function sendMessage(uint256 roomId, string content)",
  "function castVote(uint256 roomId, address target)",
  "function joinRoom(uint256 roomId, bool isAI)",
  "function settleRound(uint256 roomId)",
  "function startGame(uint256 roomId)",
  "function createRoom(uint8 tier, uint256 maxPlayers, uint256 entryFee, bool isAI) returns (uint256 roomId)",
  "function leaveRoom(uint256 roomId)",
  "function claimReward(uint256 roomId)",
  // Events
  "event RoomCreated(uint256 indexed roomId, address indexed creator, uint8 tier, uint256 entryFee, uint256 maxPlayers, bool isAI)",
  "event PlayerJoined(uint256 indexed roomId, address indexed player, bool isAI)",
  "event NewMessage(uint256 indexed roomId, address indexed sender, string content, uint256 timestamp)",
  "event VoteCast(uint256 indexed roomId, address indexed voter, address indexed target, uint256 round)",
  "event PlayerEliminated(uint256 indexed roomId, address indexed player, address eliminatedBy, string reason, int256 finalScore)",
  "event GameEnded(uint256 indexed roomId, bool humansWon, uint256 totalPrize)",
];

// Contract factory helpers
export function getArenaContract(addressOrProvider: string, signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(addressOrProvider, ARENA_ABI, signerOrProvider);
}

export function getTokenContract(address: string, signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(address, ERC20_ABI, signerOrProvider);
}
