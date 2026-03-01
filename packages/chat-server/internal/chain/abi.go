package chain

// Minimal ABI for TuringArena read-only functions used by the chat server.
// Updated for commit-reveal: Room struct no longer has humanCount/aiCount.
const ArenaABI = `[
  {
    "inputs": [{"internalType": "uint256", "name": "_roomId", "type": "uint256"}],
    "name": "getRoomInfo",
    "outputs": [
      {
        "components": [
          {"internalType": "uint256", "name": "id", "type": "uint256"},
          {"internalType": "address", "name": "creator", "type": "address"},
          {"internalType": "enum TuringArena.RoomTier", "name": "tier", "type": "uint8"},
          {"internalType": "enum TuringArena.GamePhase", "name": "phase", "type": "uint8"},
          {"internalType": "uint256", "name": "entryFee", "type": "uint256"},
          {"internalType": "uint256", "name": "prizePool", "type": "uint256"},
          {"internalType": "uint256", "name": "startBlock", "type": "uint256"},
          {"internalType": "uint256", "name": "baseInterval", "type": "uint256"},
          {"internalType": "uint256", "name": "currentInterval", "type": "uint256"},
          {"internalType": "uint256", "name": "maxPlayers", "type": "uint256"},
          {"internalType": "uint256", "name": "playerCount", "type": "uint256"},
          {"internalType": "uint256", "name": "aliveCount", "type": "uint256"},
          {"internalType": "uint256", "name": "eliminatedCount", "type": "uint256"},
          {"internalType": "uint256", "name": "lastSettleBlock", "type": "uint256"},
          {"internalType": "bool", "name": "isActive", "type": "bool"},
          {"internalType": "bool", "name": "isEnded", "type": "bool"}
        ],
        "internalType": "struct TuringArena.Room",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "uint256", "name": "_roomId", "type": "uint256"},
      {"internalType": "address", "name": "_player", "type": "address"}
    ],
    "name": "getPlayerInfo",
    "outputs": [
      {
        "components": [
          {"internalType": "address", "name": "addr", "type": "address"},
          {"internalType": "uint256", "name": "humanityScore", "type": "uint256"},
          {"internalType": "bool", "name": "isAlive", "type": "bool"},
          {"internalType": "bool", "name": "isAI", "type": "bool"},
          {"internalType": "uint256", "name": "joinBlock", "type": "uint256"},
          {"internalType": "uint256", "name": "eliminationBlock", "type": "uint256"},
          {"internalType": "uint256", "name": "eliminationRank", "type": "uint256"},
          {"internalType": "uint256", "name": "lastActionBlock", "type": "uint256"},
          {"internalType": "uint256", "name": "actionCount", "type": "uint256"},
          {"internalType": "uint256", "name": "successfulVotes", "type": "uint256"}
        ],
        "internalType": "struct TuringArena.Player",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "_roomId", "type": "uint256"}],
    "name": "getAllPlayers",
    "outputs": [{"internalType": "address[]", "name": "", "type": "address[]"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "name": "currentRound",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "_roomId", "type": "uint256"}],
    "name": "getRoomPlayerNames",
    "outputs": [{"internalType": "string[]", "name": "", "type": "string[]"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "name": "pendingReveal",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "uint256", "name": "_roomId", "type": "uint256"},
      {"internalType": "address[]", "name": "_players", "type": "address[]"},
      {"internalType": "bool[]", "name": "_isAIs", "type": "bool[]"},
      {"internalType": "bytes32[]", "name": "_salts", "type": "bytes32[]"}
    ],
    "name": "revealAndEnd",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "uint256", "name": "", "type": "uint256"},
      {"internalType": "address", "name": "", "type": "address"}
    ],
    "name": "identityCommitments",
    "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getRoomCount",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
]`
