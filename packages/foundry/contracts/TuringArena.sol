// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title TuringArena - On-chain Reverse Turing Test: Humans vs AI
/// @notice Players (humans & AI agents) chat, vote, and eliminate each other in team-based social deduction rounds
contract TuringArena is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant PROTOCOL_SHARE = 1000; // 10%
    uint256 public constant WINNING_TEAM_SHARE = 7000; // 70%
    uint256 public constant MVP_SHARE = 1000; // 10%
    uint256 public constant SURVIVAL_SHARE = 1000; // 10%
    uint256 public constant BASIS_POINTS = 10000;

    uint256 public constant VOTE_DAMAGE = 10;
    uint256 public constant MAX_MESSAGES_PER_ROUND = 3;

    uint256 public constant MIN_PLAYERS = 3; // minimum: 2 humans + 1 AI
    uint256 public constant MAX_PLAYERS = 50;
    uint256 public constant MIN_FEE = 1e6; // 1 USDC
    uint256 public constant MAX_FEE = 100e6; // 100 USDC

    // ============ Enums ============

    enum RoomTier { Quick, Standard, Epic }
    enum GamePhase { Waiting, Active, Ended }

    // ============ Structs ============

    struct TierConfig {
        uint256 baseInterval; // blocks between rounds
        uint256 rankingSlots; // for survival reward calc
    }

    struct Player {
        address addr;
        int256 humanityScore; // starts at 100, only decreases
        bool isAlive;
        bool isAI; // true for AI agents, false for humans
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
        uint256 baseInterval;
        uint256 currentInterval;
        uint256 maxPlayers;
        uint256 playerCount;
        uint256 aliveCount;
        uint256 eliminatedCount;
        uint256 humanCount;
        uint256 aiCount;
        uint256 lastSettleBlock;
        bool isActive;
        bool isEnded;
    }

    struct GameStats {
        bool humansWon; // true = humans won, false = AIs won
        address mvp; // top voter on winning team
        uint256 mvpVotes;
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

    // Message counter: roomId => round => player => count
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) public messageCount;

    // Rewards: roomId => player => RewardInfo
    mapping(uint256 => mapping(address => RewardInfo)) public rewards;

    uint256 public nextRoomId = 1;
    address public immutable protocolTreasury;
    IERC20 public immutable paymentToken;

    // ============ Events ============

    event RoomCreated(
        uint256 indexed roomId, address indexed creator, RoomTier tier, uint256 entryFee, uint256 maxPlayers,
        bool isAI
    );
    event PlayerJoined(uint256 indexed roomId, address indexed player, bool isAI);
    event GameStarted(uint256 indexed roomId, uint256 playerCount);
    event NewMessage(uint256 indexed roomId, address indexed sender, string content, uint256 timestamp);
    event VoteCast(uint256 indexed roomId, address indexed voter, address indexed target, uint256 round);
    event PlayerEliminated(
        uint256 indexed roomId, address indexed player, address eliminatedBy, string reason, int256 finalScore
    );
    event GameEnded(uint256 indexed roomId, bool humansWon, uint256 totalPrize);
    event RewardClaimed(uint256 indexed roomId, address indexed player, uint256 amount);
    event PlayerLeft(uint256 indexed roomId, address indexed player, uint256 refund);
    event RoomCancelled(uint256 indexed roomId, address indexed creator);

    // ============ Constructor ============

    constructor(address _treasury, address _paymentToken) {
        require(_treasury != address(0), "Invalid treasury");
        require(_paymentToken != address(0), "Invalid payment token");
        protocolTreasury = _treasury;
        paymentToken = IERC20(_paymentToken);

        tierConfigs[RoomTier.Quick] = TierConfig({ baseInterval: 300, rankingSlots: 3 });
        tierConfigs[RoomTier.Standard] = TierConfig({ baseInterval: 300, rankingSlots: 5 });
        tierConfigs[RoomTier.Epic] = TierConfig({ baseInterval: 300, rankingSlots: 5 });
    }

    // ============ Room Management ============

    function createRoom(RoomTier _tier, uint256 _maxPlayers, uint256 _entryFee, bool _isAI)
        external
        returns (uint256 roomId)
    {
        require(_maxPlayers >= MIN_PLAYERS && _maxPlayers <= MAX_PLAYERS, "Invalid player count");
        require(_entryFee >= MIN_FEE && _entryFee <= MAX_FEE, "Invalid entry fee");
        TierConfig storage config = tierConfigs[_tier];
        roomId = nextRoomId++;

        rooms[roomId] = Room({
            id: roomId,
            creator: msg.sender,
            tier: _tier,
            phase: GamePhase.Waiting,
            entryFee: _entryFee,
            prizePool: _entryFee,
            startBlock: 0,
            baseInterval: config.baseInterval,
            currentInterval: config.baseInterval,
            maxPlayers: _maxPlayers,
            playerCount: 1,
            aliveCount: 1,
            eliminatedCount: 0,
            humanCount: _isAI ? 0 : 1,
            aiCount: _isAI ? 1 : 0,
            lastSettleBlock: 0,
            isActive: false,
            isEnded: false
        });

        // Auto-join creator
        paymentToken.safeTransferFrom(msg.sender, address(this), _entryFee);
        players[roomId][msg.sender] = Player({
            addr: msg.sender,
            humanityScore: 100,
            isAlive: true,
            isAI: _isAI,
            joinBlock: block.number,
            eliminationBlock: 0,
            eliminationRank: 0,
            lastActionBlock: block.number,
            actionCount: 0,
            successfulVotes: 0
        });
        roomPlayers[roomId].push(msg.sender);

        emit RoomCreated(roomId, msg.sender, _tier, _entryFee, _maxPlayers, _isAI);
        emit PlayerJoined(roomId, msg.sender, _isAI);
    }

    function joinRoom(uint256 _roomId, bool _isAI) external {
        Room storage room = rooms[_roomId];
        require(room.id != 0, "Room does not exist");
        require(room.phase == GamePhase.Waiting, "Game already started");
        require(players[_roomId][msg.sender].addr == address(0), "Already joined");
        require(room.playerCount < room.maxPlayers, "Room is full");

        // Enforce 7:3 human:AI ratio — at least 1 AI slot guaranteed
        uint256 aiSlots = room.maxPlayers * 30 / 100;
        if (aiSlots == 0) aiSlots = 1; // min 1 AI for team game
        uint256 humanSlots = room.maxPlayers - aiSlots;
        if (_isAI) {
            require(room.aiCount < aiSlots, "AI slots full");
        } else {
            require(room.humanCount < humanSlots, "Human slots full");
        }

        paymentToken.safeTransferFrom(msg.sender, address(this), room.entryFee);
        room.prizePool += room.entryFee;

        room.playerCount++;
        room.aliveCount++;
        if (_isAI) {
            room.aiCount++;
        } else {
            room.humanCount++;
        }

        players[_roomId][msg.sender] = Player({
            addr: msg.sender,
            humanityScore: 100,
            isAlive: true,
            isAI: _isAI,
            joinBlock: block.number,
            eliminationBlock: 0,
            eliminationRank: 0,
            lastActionBlock: block.number,
            actionCount: 0,
            successfulVotes: 0
        });

        roomPlayers[_roomId].push(msg.sender);
        emit PlayerJoined(_roomId, msg.sender, _isAI);

        // Auto-start when room is full
        if (room.playerCount == room.maxPlayers) {
            _startGame(_roomId);
        }
    }

    function leaveRoom(uint256 _roomId) external nonReentrant {
        Room storage room = rooms[_roomId];
        require(room.id != 0, "Room does not exist");
        require(room.phase == GamePhase.Waiting, "Game already started");
        require(players[_roomId][msg.sender].addr != address(0), "Not in room");

        if (msg.sender == room.creator) {
            _cancelRoom(_roomId);
        } else {
            _removePlayer(_roomId, msg.sender);
        }
    }

    function _removePlayer(uint256 _roomId, address _player) internal {
        Room storage room = rooms[_roomId];
        Player storage p = players[_roomId][_player];
        uint256 refund = room.entryFee;

        // Update human/AI counts
        if (p.isAI) {
            room.aiCount--;
        } else {
            room.humanCount--;
        }

        delete players[_roomId][_player];

        address[] storage playerList = roomPlayers[_roomId];
        for (uint256 i = 0; i < playerList.length; i++) {
            if (playerList[i] == _player) {
                playerList[i] = playerList[playerList.length - 1];
                playerList.pop();
                break;
            }
        }

        room.playerCount--;
        room.aliveCount--;
        room.prizePool -= refund;

        paymentToken.safeTransfer(_player, refund);
        emit PlayerLeft(_roomId, _player, refund);

        // Auto-close room when no players remain
        if (room.playerCount == 0) {
            room.phase = GamePhase.Ended;
            room.isEnded = true;
            emit RoomCancelled(_roomId, room.creator);
        }
    }

    function _cancelRoom(uint256 _roomId) internal {
        Room storage room = rooms[_roomId];
        address[] storage playerList = roomPlayers[_roomId];

        for (uint256 i = 0; i < playerList.length; i++) {
            address player = playerList[i];
            if (players[_roomId][player].addr != address(0)) {
                uint256 refund = room.entryFee;
                delete players[_roomId][player];
                paymentToken.safeTransfer(player, refund);
                emit PlayerLeft(_roomId, player, refund);
            }
        }

        delete roomPlayers[_roomId];

        room.phase = GamePhase.Ended;
        room.isEnded = true;
        room.playerCount = 0;
        room.aliveCount = 0;
        room.humanCount = 0;
        room.aiCount = 0;
        room.prizePool = 0;

        emit RoomCancelled(_roomId, room.creator);
    }

    function startGame(uint256 _roomId) external {
        Room storage room = rooms[_roomId];
        require(room.id != 0, "Room does not exist");
        require(room.phase == GamePhase.Waiting, "Already started");
        require(msg.sender == room.creator, "Only creator can start");
        require(room.playerCount == room.maxPlayers, "Room not full");

        _startGame(_roomId);
    }

    function _startGame(uint256 _roomId) internal {
        Room storage room = rooms[_roomId];
        room.isActive = true;
        room.phase = GamePhase.Active;
        room.startBlock = block.number;
        room.lastSettleBlock = block.number;
        room.currentInterval = room.baseInterval;

        emit GameStarted(_roomId, room.playerCount);
    }

    // ============ Core Interaction ============

    function sendMessage(uint256 _roomId, string calldata _content) external {
        require(rooms[_roomId].isActive && !rooms[_roomId].isEnded, "Game not active");
        require(players[_roomId][msg.sender].isAlive, "You are eliminated");
        require(bytes(_content).length <= 280, "Message too long");
        require(bytes(_content).length > 0, "Empty message");

        uint256 round = currentRound[_roomId];
        require(messageCount[_roomId][round][msg.sender] < MAX_MESSAGES_PER_ROUND, "Message limit reached");
        messageCount[_roomId][round][msg.sender]++;

        Player storage player = players[_roomId][msg.sender];
        player.lastActionBlock = block.number;
        player.actionCount++;

        emit NewMessage(_roomId, msg.sender, _content, block.timestamp);
    }

    function castVote(uint256 _roomId, address _target) external nonReentrant {
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

        // Auto-settle when last alive player votes
        if (_allAliveVoted(_roomId)) {
            _settleRound(_roomId);
        }
    }

    // ============ Round Settlement ============

    function settleRound(uint256 _roomId) external nonReentrant {
        Room storage room = rooms[_roomId];
        require(room.isActive && !room.isEnded, "Game not active");
        require(block.number >= room.lastSettleBlock + room.currentInterval, "Round not ended yet");
        _settleRound(_roomId);
    }

    function _settleRound(uint256 _roomId) internal {
        Room storage room = rooms[_roomId];
        uint256 round = currentRound[_roomId];
        address[] storage allPlayers = roomPlayers[_roomId];

        // Step 1: Apply vote damage to targets, auto-self-vote for non-voters
        for (uint256 i = 0; i < allPlayers.length; i++) {
            address playerAddr = allPlayers[i];
            Player storage p = players[_roomId][playerAddr];
            if (!p.isAlive) continue;

            if (hasVotedInRound[_roomId][round][playerAddr]) {
                // Apply damage to the target they voted for
                address target = voteTarget[_roomId][round][playerAddr];
                players[_roomId][target].humanityScore -= int256(VOTE_DAMAGE);
            } else {
                // Auto-self-vote: non-voters take VOTE_DAMAGE to self (not NO_VOTE_PENALTY)
                p.humanityScore -= int256(VOTE_DAMAGE);
                emit VoteCast(_roomId, playerAddr, playerAddr, round);
            }
        }

        // Step 2: Count zeros AFTER all damage applied
        uint256 zeroCount = 0;
        for (uint256 i = 0; i < allPlayers.length; i++) {
            if (players[_roomId][allPlayers[i]].isAlive && players[_roomId][allPlayers[i]].humanityScore <= 0) {
                zeroCount++;
            }
        }

        // Step 3: Elimination logic
        address[] memory eliminatedThisRound = new address[](room.aliveCount);
        uint256 eliminatedCount = 0;

        if (zeroCount == room.aliveCount && room.aliveCount > 1) {
            // Tiebreaker: earliest voter survives
            address lastSurvivor = _findEarliestVoter(_roomId, round, allPlayers);
            if (lastSurvivor == address(0)) {
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

        // Step 6: Team win check
        if (room.isActive) {
            uint256 aliveHumans = 0;
            uint256 aliveAIs = 0;
            for (uint256 i = 0; i < allPlayers.length; i++) {
                Player storage p = players[_roomId][allPlayers[i]];
                if (p.isAlive) {
                    if (p.isAI) {
                        aliveAIs++;
                    } else {
                        aliveHumans++;
                    }
                }
            }

            if (aliveHumans == 0 && aliveAIs > 0) {
                // All humans eliminated — AIs win
                _endGame(_roomId, false);
            } else if (aliveAIs == 0 && aliveHumans > 0) {
                // All AIs eliminated — Humans win
                _endGame(_roomId, true);
            } else if (room.aliveCount <= 2) {
                // 2-player endgame: HP comparison
                _resolveFinalTwo(_roomId);
            }
        }
    }

    // ============ Internal: Elimination ============

    function _markEliminated(uint256 _roomId, address _player, address _eliminatedBy, string memory _reason) internal {
        Room storage room = rooms[_roomId];
        Player storage player = players[_roomId][_player];

        player.isAlive = false;
        player.eliminationBlock = block.number;
        room.eliminatedCount++;
        player.eliminationRank = room.eliminatedCount;
        room.aliveCount--;

        eliminationOrder[_roomId].push(_player);

        emit PlayerEliminated(_roomId, _player, _eliminatedBy, _reason, player.humanityScore);
    }

    /// @dev When 2 players remain, compare HP. Higher HP wins. Tie → AI wins.
    function _resolveFinalTwo(uint256 _roomId) internal {
        address[] storage all = roomPlayers[_roomId];
        address alive1;
        address alive2;
        for (uint256 i = 0; i < all.length; i++) {
            if (players[_roomId][all[i]].isAlive) {
                if (alive1 == address(0)) {
                    alive1 = all[i];
                } else {
                    alive2 = all[i];
                    break;
                }
            }
        }

        Player storage p1 = players[_roomId][alive1];
        Player storage p2 = players[_roomId][alive2];

        address loser;
        if (p1.humanityScore > p2.humanityScore) {
            loser = alive2;
        } else if (p2.humanityScore > p1.humanityScore) {
            loser = alive1;
        } else {
            // Tie: AI player wins. If both same type, first-in-array wins.
            if (p1.isAI && !p2.isAI) {
                loser = alive2; // p1 (AI) wins
            } else if (p2.isAI && !p1.isAI) {
                loser = alive1; // p2 (AI) wins
            } else {
                loser = alive2; // same type: first-in-array wins
            }
        }
        _markEliminated(_roomId, loser, address(0), "final_two");

        // Determine winning team based on the survivor
        address winner = (loser == alive1) ? alive2 : alive1;
        bool humansWon = !players[_roomId][winner].isAI;
        _endGame(_roomId, humansWon);
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

    function _allAliveVoted(uint256 _roomId) internal view returns (bool) {
        uint256 round = currentRound[_roomId];
        address[] storage all = roomPlayers[_roomId];
        for (uint256 i = 0; i < all.length; i++) {
            if (players[_roomId][all[i]].isAlive && !hasVotedInRound[_roomId][round][all[i]]) {
                return false;
            }
        }
        return rooms[_roomId].aliveCount > 0;
    }

    // ============ End Game & Rewards ============

    function _endGame(uint256 _roomId, bool _humansWon) internal {
        Room storage room = rooms[_roomId];
        if (room.isEnded) return; // guard against double-end

        room.isActive = false;
        room.isEnded = true;
        room.phase = GamePhase.Ended;

        _gameStats[_roomId].humansWon = _humansWon;

        _determineMVP(_roomId, _humansWon);
        _allocateRewards(_roomId);

        emit GameEnded(_roomId, _humansWon, room.prizePool);
    }

    /// @dev Find MVP: player with most successfulVotes on winning team
    function _determineMVP(uint256 _roomId, bool _humansWon) internal {
        address[] storage allPlayers = roomPlayers[_roomId];
        address mvp = address(0);
        uint256 maxVotes = 0;

        for (uint256 i = 0; i < allPlayers.length; i++) {
            Player storage p = players[_roomId][allPlayers[i]];
            bool isWinningTeam = _humansWon ? !p.isAI : p.isAI;
            if (isWinningTeam && p.successfulVotes > maxVotes) {
                maxVotes = p.successfulVotes;
                mvp = p.addr;
            }
        }

        _gameStats[_roomId].mvp = mvp;
        _gameStats[_roomId].mvpVotes = maxVotes;
    }

    function _allocateRewards(uint256 _roomId) internal {
        Room storage room = rooms[_roomId];
        GameStats storage stats = _gameStats[_roomId];
        address[] storage allPlayers = roomPlayers[_roomId];
        uint256 totalPrize = room.prizePool;

        uint256 protocolAmount = (totalPrize * PROTOCOL_SHARE) / BASIS_POINTS;
        uint256 winningTeamPool = (totalPrize * WINNING_TEAM_SHARE) / BASIS_POINTS;
        uint256 mvpAmount = (totalPrize * MVP_SHARE) / BASIS_POINTS;
        uint256 survivalPool = totalPrize - protocolAmount - winningTeamPool - mvpAmount;

        // Protocol fee
        if (protocolAmount > 0) {
            rewards[_roomId][protocolTreasury].amount += protocolAmount;
        }

        // Winning team reward: split equally among alive players on winning team
        uint256 winningAliveCount = 0;
        for (uint256 i = 0; i < allPlayers.length; i++) {
            Player storage p = players[_roomId][allPlayers[i]];
            bool isWinningTeam = stats.humansWon ? !p.isAI : p.isAI;
            if (p.isAlive && isWinningTeam) {
                winningAliveCount++;
            }
        }
        if (winningAliveCount > 0) {
            uint256 perWinner = winningTeamPool / winningAliveCount;
            for (uint256 i = 0; i < allPlayers.length; i++) {
                Player storage p = players[_roomId][allPlayers[i]];
                bool isWinningTeam = stats.humansWon ? !p.isAI : p.isAI;
                if (p.isAlive && isWinningTeam) {
                    rewards[_roomId][p.addr].amount += perWinner;
                }
            }
        }

        // MVP reward
        if (stats.mvp != address(0) && stats.mvpVotes > 0) {
            rewards[_roomId][stats.mvp].amount += mvpAmount;
        }

        // Survival reward: split among ALL alive players (both teams)
        uint256 totalAlive = 0;
        for (uint256 i = 0; i < allPlayers.length; i++) {
            if (players[_roomId][allPlayers[i]].isAlive) {
                totalAlive++;
            }
        }
        if (totalAlive > 0) {
            uint256 perSurvivor = survivalPool / totalAlive;
            for (uint256 i = 0; i < allPlayers.length; i++) {
                if (players[_roomId][allPlayers[i]].isAlive) {
                    rewards[_roomId][allPlayers[i]].amount += perSurvivor;
                }
            }
        }
    }

    function claimReward(uint256 _roomId) external nonReentrant {
        require(rooms[_roomId].isEnded, "Game not ended");
        RewardInfo storage info = rewards[_roomId][msg.sender];
        require(info.amount > 0, "No reward");
        require(!info.claimed, "Already claimed");

        info.claimed = true;
        uint256 amount = info.amount;

        paymentToken.safeTransfer(msg.sender, amount);

        emit RewardClaimed(_roomId, msg.sender, amount);
    }

    // ============ Admin ============

    function withdrawUnclaimed(uint256 _amount) external {
        require(msg.sender == protocolTreasury, "Only treasury");
        require(_amount <= paymentToken.balanceOf(address(this)), "Insufficient balance");
        paymentToken.safeTransfer(protocolTreasury, _amount);
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

    function allAliveVoted(uint256 _roomId) external view returns (bool) {
        return _allAliveVoted(_roomId);
    }

    function getRewardInfo(uint256 _roomId, address _player) external view returns (uint256 amount, bool claimed) {
        RewardInfo storage info = rewards[_roomId][_player];
        return (info.amount, info.claimed);
    }

    function getRoomCount() external view returns (uint256) {
        return nextRoomId - 1;
    }

    function getContractBalance() external view returns (uint256) {
        return paymentToken.balanceOf(address(this));
    }

    function getMessageCount(uint256 _roomId, uint256 _round, address _player) external view returns (uint256) {
        return messageCount[_roomId][_round][_player];
    }
}
