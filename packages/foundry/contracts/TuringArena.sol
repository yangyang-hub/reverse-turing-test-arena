// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TuringArena - On-chain Reverse Turing Test Battle Royale
/// @notice Players (humans & AI) chat, vote, and eliminate each other in social deduction rounds
contract TuringArena is ReentrancyGuard {
    // ============ Constants ============

    uint256 public constant CHAMPION_SHARE = 3500; // 35%
    uint256 public constant RANKING_SHARE = 2500; // 25%
    uint256 public constant SURVIVAL_SHARE = 2500; // 25%
    uint256 public constant PROTOCOL_SHARE = 1000; // 10%
    uint256 public constant ACHIEVEMENT_SHARE = 500; // 5%
    uint256 public constant BASIS_POINTS = 10000;

    uint256[5] public RANKING_WEIGHTS = [4000, 2500, 1800, 1000, 700];

    uint256 public constant VOTE_DAMAGE = 5;
    uint256 public constant NO_VOTE_PENALTY = 10;

    // ============ Enums ============

    enum RoomTier {
        Quick,
        Standard,
        Epic
    }
    enum GamePhase {
        Waiting,
        Phase1,
        Phase2,
        Phase3,
        Ended
    }

    // ============ Structs ============

    struct TierConfig {
        uint256 minPlayers;
        uint256 maxPlayers;
        uint256 baseInterval; // blocks between rounds
        uint256 entryFee;
        uint256 phase1Threshold; // alive % to enter Phase 2
        uint256 phase2Threshold; // alive % to enter Phase 3
        uint256 phase3ElimsPerRound;
        int256 phase2Decay;
        int256 phase3Decay;
        uint256 rankingSlots;
    }

    struct Player {
        address addr;
        int256 humanityScore; // starts at 100, only decreases
        bool isAlive;
        bool isVerifiedHuman;
        uint256 joinBlock;
        uint256 eliminationBlock;
        uint256 eliminationRank; // 1 = first eliminated
        uint256 lastActionBlock;
        uint256 actionCount;
        uint256 successfulVotes;
    }

    struct Room {
        uint256 id;
        address creator;
        RoomTier tier;
        GamePhase phase;
        uint256 entryFee;
        uint256 prizePool;
        uint256 startBlock;
        uint256 halfwayBlock;
        uint256 baseInterval;
        uint256 currentInterval;
        uint256 playerCount;
        uint256 aliveCount;
        uint256 eliminatedCount;
        int256 currentDecay;
        uint256 lastSettleBlock;
        bool isActive;
        bool isEnded;
    }

    struct GameStats {
        address champion;
        address[] topFive;
        address humanHunter;
        address perfectImpostor;
        address lastHuman;
        address lightningKiller;
        address ironWill;
        uint256 maxSuccessfulVotes;
    }

    struct RewardInfo {
        uint256 amount;
        bool claimed;
    }

    // ============ State ============

    mapping(RoomTier => TierConfig) public tierConfigs;
    mapping(uint256 => Room) public rooms;
    mapping(uint256 => mapping(address => Player)) public players;
    mapping(uint256 => address[]) public roomPlayers;
    mapping(uint256 => address[]) public eliminationOrder;
    mapping(uint256 => GameStats) internal _gameStats;

    // Voting state per round
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public hasVotedInRound;
    mapping(uint256 => mapping(uint256 => mapping(address => address))) public voteTarget;
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) public voteBlock;
    mapping(uint256 => uint256) public currentRound;

    // Rewards: roomId => player => RewardInfo
    mapping(uint256 => mapping(address => RewardInfo)) public rewards;

    uint256 public nextRoomId = 1;
    address public protocolTreasury;

    // ============ Events ============

    event RoomCreated(uint256 indexed roomId, address indexed creator, RoomTier tier, uint256 entryFee);
    event PlayerJoined(uint256 indexed roomId, address indexed player);
    event GameStarted(uint256 indexed roomId, uint256 playerCount);
    event NewMessage(uint256 indexed roomId, address indexed sender, string content, uint256 timestamp);
    event VoteCast(uint256 indexed roomId, address indexed voter, address indexed target, uint256 round);
    event PlayerEliminated(
        uint256 indexed roomId, address indexed player, address eliminatedBy, string reason, int256 finalScore
    );
    event PhaseChanged(uint256 indexed roomId, GamePhase newPhase);
    event GameEnded(uint256 indexed roomId, address winner, uint256 totalPrize);
    event RewardClaimed(uint256 indexed roomId, address indexed player, uint256 amount);

    // ============ Constructor ============

    constructor(address _treasury) {
        require(_treasury != address(0), "Invalid treasury");
        protocolTreasury = _treasury;

        // Quick: 3-10 players (min lowered for testing)
        tierConfigs[RoomTier.Quick] = TierConfig({
            minPlayers: 3,
            maxPlayers: 10,
            baseInterval: 150,
            entryFee: 0.01 ether,
            phase1Threshold: 67,
            phase2Threshold: 33,
            phase3ElimsPerRound: 1,
            phase2Decay: -1,
            phase3Decay: -2,
            rankingSlots: 3
        });

        // Standard: 6-20 players
        tierConfigs[RoomTier.Standard] = TierConfig({
            minPlayers: 6,
            maxPlayers: 20,
            baseInterval: 150,
            entryFee: 0.05 ether,
            phase1Threshold: 67,
            phase2Threshold: 33,
            phase3ElimsPerRound: 1,
            phase2Decay: -1,
            phase3Decay: -2,
            rankingSlots: 5
        });

        // Epic: 12-50 players
        tierConfigs[RoomTier.Epic] = TierConfig({
            minPlayers: 12,
            maxPlayers: 50,
            baseInterval: 150,
            entryFee: 0.1 ether,
            phase1Threshold: 67,
            phase2Threshold: 33,
            phase3ElimsPerRound: 2,
            phase2Decay: -1,
            phase3Decay: -3,
            rankingSlots: 5
        });
    }

    // ============ Room Management ============

    function createRoom(RoomTier _tier) external returns (uint256 roomId) {
        TierConfig storage config = tierConfigs[_tier];
        roomId = nextRoomId++;

        rooms[roomId] = Room({
            id: roomId,
            creator: msg.sender,
            tier: _tier,
            phase: GamePhase.Waiting,
            entryFee: config.entryFee,
            prizePool: 0,
            startBlock: 0,
            halfwayBlock: 0,
            baseInterval: config.baseInterval,
            currentInterval: config.baseInterval,
            playerCount: 0,
            aliveCount: 0,
            eliminatedCount: 0,
            currentDecay: 0,
            lastSettleBlock: 0,
            isActive: false,
            isEnded: false
        });

        emit RoomCreated(roomId, msg.sender, _tier, config.entryFee);
    }

    function joinRoom(uint256 _roomId) external payable {
        Room storage room = rooms[_roomId];
        TierConfig storage config = tierConfigs[room.tier];
        require(room.id != 0, "Room does not exist");
        require(room.phase == GamePhase.Waiting, "Game already started");
        require(msg.value >= room.entryFee, "Insufficient entry fee");
        require(players[_roomId][msg.sender].addr == address(0), "Already joined");
        require(room.playerCount < config.maxPlayers, "Room is full");

        room.prizePool += room.entryFee;
        if (msg.value > room.entryFee) {
            (bool refundSuccess,) = payable(msg.sender).call{ value: msg.value - room.entryFee }("");
            require(refundSuccess, "Refund failed");
        }

        room.playerCount++;
        room.aliveCount++;

        players[_roomId][msg.sender] = Player({
            addr: msg.sender,
            humanityScore: 100,
            isAlive: true,
            isVerifiedHuman: false,
            joinBlock: block.number,
            eliminationBlock: 0,
            eliminationRank: 0,
            lastActionBlock: block.number,
            actionCount: 0,
            successfulVotes: 0
        });

        roomPlayers[_roomId].push(msg.sender);
        emit PlayerJoined(_roomId, msg.sender);
    }

    function startGame(uint256 _roomId) external {
        Room storage room = rooms[_roomId];
        TierConfig storage config = tierConfigs[room.tier];
        require(room.id != 0, "Room does not exist");
        require(room.phase == GamePhase.Waiting, "Already started");
        require(room.playerCount >= config.minPlayers, "Need more players");
        require(msg.sender == room.creator, "Only creator can start");

        room.isActive = true;
        room.phase = GamePhase.Phase1;
        room.startBlock = block.number;
        room.lastSettleBlock = block.number;
        room.currentDecay = 0;
        room.currentInterval = config.baseInterval;

        // Dynamic halfway calculation based on estimated game duration
        uint256 estimatedRounds = room.playerCount;
        room.halfwayBlock = block.number + (config.baseInterval * estimatedRounds / 2);

        emit GameStarted(_roomId, room.playerCount);
    }

    // ============ Core Interaction ============

    function sendMessage(uint256 _roomId, string calldata _content) external {
        require(rooms[_roomId].isActive && !rooms[_roomId].isEnded, "Game not active");
        require(players[_roomId][msg.sender].isAlive, "You are eliminated");
        require(bytes(_content).length <= 280, "Message too long");
        require(bytes(_content).length > 0, "Empty message");

        Player storage player = players[_roomId][msg.sender];
        player.lastActionBlock = block.number;
        player.actionCount++;

        emit NewMessage(_roomId, msg.sender, _content, block.timestamp);
    }

    function castVote(uint256 _roomId, address _target) external {
        Room storage room = rooms[_roomId];
        require(room.isActive && !room.isEnded, "Game not active");
        require(players[_roomId][msg.sender].isAlive, "You are eliminated");
        require(players[_roomId][_target].isAlive, "Target already eliminated");
        require(_target != msg.sender, "Cannot vote for yourself");

        uint256 round = currentRound[_roomId];
        require(!hasVotedInRound[_roomId][round][msg.sender], "Already voted this round");

        hasVotedInRound[_roomId][round][msg.sender] = true;
        voteTarget[_roomId][round][msg.sender] = _target;
        voteBlock[_roomId][round][msg.sender] = block.number;

        emit VoteCast(_roomId, msg.sender, _target, round);
    }

    // ============ Round Settlement ============

    function settleRound(uint256 _roomId) external nonReentrant {
        Room storage room = rooms[_roomId];
        require(room.isActive && !room.isEnded, "Game not active");
        require(block.number >= room.lastSettleBlock + room.currentInterval, "Round not ended yet");

        uint256 round = currentRound[_roomId];
        address[] storage allPlayers = roomPlayers[_roomId];

        // FIX P0: Compute vote damage first, THEN count zeros
        // Step 1: Apply vote damage and no-vote penalty
        for (uint256 i = 0; i < allPlayers.length; i++) {
            address playerAddr = allPlayers[i];
            Player storage p = players[_roomId][playerAddr];
            if (!p.isAlive) continue;

            if (hasVotedInRound[_roomId][round][playerAddr]) {
                address target = voteTarget[_roomId][round][playerAddr];
                players[_roomId][target].humanityScore -= int256(VOTE_DAMAGE);
            } else {
                p.humanityScore -= int256(NO_VOTE_PENALTY);
            }

            // Toxin ring decay (Phase 2/3)
            if (room.currentDecay < 0) {
                p.humanityScore += room.currentDecay;
            }
        }

        // Step 2: Count zeros AFTER all damage applied (FIX P0 - order independent)
        uint256 zeroCount = 0;
        for (uint256 i = 0; i < allPlayers.length; i++) {
            if (players[_roomId][allPlayers[i]].isAlive && players[_roomId][allPlayers[i]].humanityScore <= 0) {
                zeroCount++;
            }
        }

        // Step 3: Elimination logic
        // FIX P0: Use flag instead of calling _endGame from _eliminatePlayer
        address[] memory eliminatedThisRound = new address[](room.aliveCount);
        uint256 eliminatedCount = 0;

        if (zeroCount == room.aliveCount && room.aliveCount > 1) {
            // Tiebreaker: earliest voter survives
            address lastSurvivor = _findEarliestVoter(_roomId, round, allPlayers);
            if (lastSurvivor == address(0)) {
                // No one voted, first alive player survives
                for (uint256 i = 0; i < allPlayers.length; i++) {
                    if (players[_roomId][allPlayers[i]].isAlive) {
                        lastSurvivor = allPlayers[i];
                        break;
                    }
                }
            }
            for (uint256 i = 0; i < allPlayers.length; i++) {
                address playerAddr = allPlayers[i];
                if (players[_roomId][playerAddr].isAlive && playerAddr != lastSurvivor) {
                    eliminatedThisRound[eliminatedCount++] = playerAddr;
                    _markEliminated(_roomId, playerAddr, address(0), "tiebreaker");
                }
            }
        } else {
            // Normal elimination: remove players at or below 0
            for (uint256 i = 0; i < allPlayers.length; i++) {
                address playerAddr = allPlayers[i];
                if (players[_roomId][playerAddr].isAlive && players[_roomId][playerAddr].humanityScore <= 0) {
                    // Find who voted for this player (first voter as eliminatedBy)
                    address eliminatedBy = _findVoterFor(_roomId, round, playerAddr, allPlayers);
                    eliminatedThisRound[eliminatedCount++] = playerAddr;
                    _markEliminated(_roomId, playerAddr, eliminatedBy, "voted_out");
                }
            }
        }

        // Step 4: Update successful votes
        for (uint256 i = 0; i < eliminatedCount; i++) {
            address eliminatedPlayer = eliminatedThisRound[i];
            for (uint256 j = 0; j < allPlayers.length; j++) {
                address voter = allPlayers[j];
                if (hasVotedInRound[_roomId][round][voter] && voteTarget[_roomId][round][voter] == eliminatedPlayer) {
                    players[_roomId][voter].successfulVotes++;
                }
            }
        }

        // Step 5: Advance round
        currentRound[_roomId]++;
        room.lastSettleBlock = block.number;

        // Step 6: Check phase transition
        _checkPhaseTransition(_roomId);

        // Step 7: End game if <= 1 alive (FIX P0 - no reentrancy from _eliminatePlayer)
        if (room.aliveCount <= 1 && room.isActive) {
            _endGame(_roomId);
        }
    }

    // ============ Internal: Elimination ============

    /// @dev Marks a player eliminated without calling _endGame (FIX P0 reentrancy)
    function _markEliminated(uint256 _roomId, address _player, address _eliminatedBy, string memory _reason) internal {
        Room storage room = rooms[_roomId];
        Player storage player = players[_roomId][_player];

        player.isAlive = false;
        player.eliminationBlock = block.number;
        room.eliminatedCount++;
        player.eliminationRank = room.eliminatedCount;
        room.aliveCount--;

        eliminationOrder[_roomId].push(_player);

        // FIX P0: PlayerEliminated event includes eliminatedBy and reason
        emit PlayerEliminated(_roomId, _player, _eliminatedBy, _reason, player.humanityScore);
    }

    function _findEarliestVoter(uint256 _roomId, uint256 _round, address[] storage _allPlayers)
        internal
        view
        returns (address)
    {
        address earliest = address(0);
        uint256 earliestBlock = type(uint256).max;
        for (uint256 i = 0; i < _allPlayers.length; i++) {
            address playerAddr = _allPlayers[i];
            if (
                players[_roomId][playerAddr].isAlive && hasVotedInRound[_roomId][_round][playerAddr]
                    && voteBlock[_roomId][_round][playerAddr] < earliestBlock
            ) {
                earliestBlock = voteBlock[_roomId][_round][playerAddr];
                earliest = playerAddr;
            }
        }
        return earliest;
    }

    function _findVoterFor(uint256 _roomId, uint256 _round, address _target, address[] storage _allPlayers)
        internal
        view
        returns (address)
    {
        for (uint256 i = 0; i < _allPlayers.length; i++) {
            address voter = _allPlayers[i];
            if (hasVotedInRound[_roomId][_round][voter] && voteTarget[_roomId][_round][voter] == _target) {
                return voter;
            }
        }
        return address(0);
    }

    // ============ Phase Transition ============

    function _checkPhaseTransition(uint256 _roomId) internal {
        Room storage room = rooms[_roomId];
        TierConfig storage config = tierConfigs[room.tier];
        if (room.playerCount == 0) return;

        uint256 alivePercent = (room.aliveCount * 100) / room.playerCount;

        if (room.phase == GamePhase.Phase1 && alivePercent <= config.phase1Threshold) {
            room.phase = GamePhase.Phase2;
            room.currentInterval = config.baseInterval / 2;
            room.currentDecay = config.phase2Decay;
            emit PhaseChanged(_roomId, GamePhase.Phase2);
        } else if (room.phase == GamePhase.Phase2 && alivePercent <= config.phase2Threshold) {
            room.phase = GamePhase.Phase3;
            room.currentInterval = config.baseInterval / 4;
            room.currentDecay = config.phase3Decay;
            emit PhaseChanged(_roomId, GamePhase.Phase3);
        }
    }

    // ============ End Game & Rewards ============

    function _endGame(uint256 _roomId) internal {
        Room storage room = rooms[_roomId];
        require(!room.isEnded, "Game already ended");

        room.isActive = false;
        room.isEnded = true;
        room.phase = GamePhase.Ended;

        address champion = _findChampion(_roomId);
        _gameStats[_roomId].champion = champion;

        _calculateTopFive(_roomId);
        _calculateAchievements(_roomId);
        _allocateRewards(_roomId);

        emit GameEnded(_roomId, champion, room.prizePool);
    }

    function _findChampion(uint256 _roomId) internal view returns (address) {
        address[] storage allPlayers = roomPlayers[_roomId];
        for (uint256 i = 0; i < allPlayers.length; i++) {
            if (players[_roomId][allPlayers[i]].isAlive) {
                return allPlayers[i];
            }
        }
        return address(0);
    }

    function _calculateTopFive(uint256 _roomId) internal {
        address[] storage eliminated = eliminationOrder[_roomId];
        uint256 len = eliminated.length;
        address champion = _gameStats[_roomId].champion;

        address[] memory topFive = new address[](5);
        topFive[0] = champion;

        uint256 runnersCount = len < 4 ? len : 4;
        for (uint256 i = 0; i < runnersCount; i++) {
            topFive[i + 1] = eliminated[len - 1 - i];
        }

        _gameStats[_roomId].topFive = topFive;
    }

    function _calculateAchievements(uint256 _roomId) internal {
        Room storage room = rooms[_roomId];
        GameStats storage stats = _gameStats[_roomId];
        address[] storage allPlayers = roomPlayers[_roomId];

        uint256 maxVotes = 0;
        int256 highestIronWillScore = 0;

        for (uint256 i = 0; i < allPlayers.length; i++) {
            Player storage p = players[_roomId][allPlayers[i]];

            if (p.successfulVotes > maxVotes) {
                maxVotes = p.successfulVotes;
                stats.humanHunter = p.addr;
            }

            if (p.humanityScore >= int256(50) && p.humanityScore > highestIronWillScore) {
                highestIronWillScore = p.humanityScore;
                stats.ironWill = p.addr;
            }

            if (p.isVerifiedHuman && !p.isAlive) {
                stats.lastHuman = p.addr;
            }

            uint256 earlyPhaseEnd = room.startBlock + (room.baseInterval * room.playerCount / 10);
            if (p.successfulVotes >= 3 && p.lastActionBlock <= earlyPhaseEnd) {
                stats.lightningKiller = p.addr;
            }
        }

        stats.maxSuccessfulVotes = maxVotes;

        if (stats.champion != address(0) && !players[_roomId][stats.champion].isVerifiedHuman) {
            stats.perfectImpostor = stats.champion;
        }
    }

    /// @dev Allocates rewards to a pull-based mapping (FIX P1: claimReward)
    function _allocateRewards(uint256 _roomId) internal {
        Room storage room = rooms[_roomId];
        GameStats storage stats = _gameStats[_roomId];
        uint256 totalPrize = room.prizePool;

        uint256 protocolAmount = (totalPrize * PROTOCOL_SHARE) / BASIS_POINTS;
        uint256 championAmount = (totalPrize * CHAMPION_SHARE) / BASIS_POINTS;
        uint256 rankingPool = (totalPrize * RANKING_SHARE) / BASIS_POINTS;
        uint256 survivalPool = (totalPrize * SURVIVAL_SHARE) / BASIS_POINTS;
        // achievementPool is the remainder
        uint256 achievementPool = totalPrize - protocolAmount - championAmount - rankingPool - survivalPool;

        // Protocol fee - direct transfer
        if (protocolAmount > 0 && protocolTreasury != address(0)) {
            rewards[_roomId][protocolTreasury].amount += protocolAmount;
        }

        // Champion reward
        if (stats.champion != address(0)) {
            rewards[_roomId][stats.champion].amount += championAmount;
        }

        // Ranking rewards
        for (uint256 i = 0; i < 5; i++) {
            if (i < stats.topFive.length && stats.topFive[i] != address(0)) {
                uint256 rankReward = (rankingPool * RANKING_WEIGHTS[i]) / BASIS_POINTS;
                rewards[_roomId][stats.topFive[i]].amount += rankReward;
            }
        }

        // Survival rewards (survived past halfway)
        address[] memory survivors = _getSurvivalRecipients(_roomId);
        if (survivors.length > 0) {
            uint256 survivalReward = survivalPool / survivors.length;
            for (uint256 i = 0; i < survivors.length; i++) {
                rewards[_roomId][survivors[i]].amount += survivalReward;
            }
        }

        // Achievement rewards
        uint256 perAchievement = achievementPool / 5;
        if (stats.humanHunter != address(0) && stats.maxSuccessfulVotes > 0) {
            rewards[_roomId][stats.humanHunter].amount += perAchievement;
        }
        if (stats.perfectImpostor != address(0)) {
            rewards[_roomId][stats.perfectImpostor].amount += perAchievement;
        }
        if (stats.lastHuman != address(0)) {
            rewards[_roomId][stats.lastHuman].amount += perAchievement;
        }
        if (stats.lightningKiller != address(0)) {
            rewards[_roomId][stats.lightningKiller].amount += perAchievement;
        }
        if (stats.ironWill != address(0)) {
            rewards[_roomId][stats.ironWill].amount += perAchievement;
        }
    }

    /// @notice Pull-based reward claim (FIX P1: missing claimReward)
    function claimReward(uint256 _roomId) external nonReentrant {
        require(rooms[_roomId].isEnded, "Game not ended");
        RewardInfo storage info = rewards[_roomId][msg.sender];
        require(info.amount > 0, "No reward");
        require(!info.claimed, "Already claimed");

        info.claimed = true;
        uint256 amount = info.amount;

        (bool success,) = payable(msg.sender).call{ value: amount }("");
        require(success, "Transfer failed");

        emit RewardClaimed(_roomId, msg.sender, amount);
    }

    function _getSurvivalRecipients(uint256 _roomId) internal view returns (address[] memory) {
        Room storage room = rooms[_roomId];
        address[] storage allPlayers = roomPlayers[_roomId];

        uint256 count = 0;
        for (uint256 i = 0; i < allPlayers.length; i++) {
            Player storage p = players[_roomId][allPlayers[i]];
            if (p.eliminationBlock == 0 || p.eliminationBlock > room.halfwayBlock) {
                count++;
            }
        }

        address[] memory recipients = new address[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < allPlayers.length; i++) {
            Player storage p = players[_roomId][allPlayers[i]];
            if (p.eliminationBlock == 0 || p.eliminationBlock > room.halfwayBlock) {
                recipients[index++] = p.addr;
            }
        }
        return recipients;
    }

    // ============ Admin ============

    function withdrawUnclaimed(uint256 _amount) external {
        require(msg.sender == protocolTreasury, "Only treasury");
        require(_amount <= address(this).balance, "Insufficient balance");
        (bool success,) = payable(protocolTreasury).call{ value: _amount }("");
        require(success, "Transfer failed");
    }

    // ============ View Functions ============

    function getRoomInfo(uint256 _roomId) external view returns (Room memory) {
        return rooms[_roomId];
    }

    function getPlayerInfo(uint256 _roomId, address _player) external view returns (Player memory) {
        return players[_roomId][_player];
    }

    function getAllPlayers(uint256 _roomId) external view returns (address[] memory) {
        return roomPlayers[_roomId];
    }

    function getGameStats(uint256 _roomId) external view returns (GameStats memory) {
        return _gameStats[_roomId];
    }

    function getEliminationOrder(uint256 _roomId) external view returns (address[] memory) {
        return eliminationOrder[_roomId];
    }

    function getRewardInfo(uint256 _roomId, address _player) external view returns (uint256 amount, bool claimed) {
        RewardInfo storage info = rewards[_roomId][_player];
        return (info.amount, info.claimed);
    }

    function getRoomCount() external view returns (uint256) {
        return nextRoomId - 1;
    }

    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    receive() external payable { }
}
