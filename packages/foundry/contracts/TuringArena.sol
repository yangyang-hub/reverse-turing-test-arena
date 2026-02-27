// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title TuringArena - On-chain Reverse Turing Test: Humans vs AI
/// @notice Players (humans & AI agents) chat, vote, and eliminate each other in team-based social deduction rounds
/// @dev Uses commit-reveal for identity hiding: isAI is hidden during gameplay, revealed at game end by operator
contract TuringArena is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Constants ============

    uint256 public constant PROTOCOL_SHARE = 1000; // 10%
    uint256 public constant WINNING_TEAM_SHARE = 7000; // 70%
    uint256 public constant MVP_SHARE = 1000; // 10%
    uint256 public constant SURVIVAL_SHARE = 1000; // 10%
    uint256 public constant BASIS_POINTS = 10000;

    uint256 public constant VOTE_DAMAGE = 10;

    uint256 public constant MIN_PLAYERS = 3; // minimum: 2 humans + 1 AI
    uint256 public constant MAX_PLAYERS = 50;
    uint256 public constant MIN_FEE = 1e6; // 1 USDC
    uint256 public constant MAX_FEE = 100e6; // 100 USDC
    uint256 public constant MAX_NAME_LENGTH = 20;
    uint256 public constant REVEAL_TIMEOUT = 3600; // ~1h on Monad

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
        bool isAI; // true for AI agents, false for humans — hidden during gameplay, set by revealAndEnd
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

    // Rewards: roomId => player => RewardInfo
    mapping(uint256 => mapping(address => RewardInfo)) public rewards;

    // Track player's active room (0 = not in any room)
    mapping(address => uint256) public playerActiveRoom;

    // Player names per room: roomId => player => name
    mapping(uint256 => mapping(address => string)) public playerNames;

    // Commit-reveal identity hiding
    address public operator;
    mapping(uint256 => mapping(address => bytes32)) public identityCommitments;
    mapping(bytes32 => bool) public usedCommitments; // anti-replay
    mapping(uint256 => bool) public pendingReveal;

    uint256 public nextRoomId = 1;
    address public immutable protocolTreasury;
    IERC20 public immutable paymentToken;

    // ============ Events ============

    event RoomCreated(uint256 indexed roomId, address indexed creator, RoomTier tier, uint256 entryFee, uint256 maxPlayers);
    event PlayerJoined(uint256 indexed roomId, address indexed player);
    event GameStarted(uint256 indexed roomId, uint256 playerCount);
    event VoteCast(uint256 indexed roomId, address indexed voter, address indexed target, uint256 round);
    event PlayerEliminated(
        uint256 indexed roomId, address indexed player, address eliminatedBy, string reason, int256 finalScore
    );
    event GameEnded(uint256 indexed roomId, bool humansWon, uint256 totalPrize);
    event RewardClaimed(uint256 indexed roomId, address indexed player, uint256 amount);
    event PlayerLeft(uint256 indexed roomId, address indexed player, uint256 refund);
    event RoomCancelled(uint256 indexed roomId, address indexed creator);
    event IdentitiesRevealed(uint256 indexed roomId, bool humansWon);
    event EmergencyEndTriggered(uint256 indexed roomId);

    // ============ Constructor ============

    constructor(address _treasury, address _paymentToken, address _operator) {
        require(_treasury != address(0), "Invalid treasury");
        require(_paymentToken != address(0), "Invalid payment token");
        require(_operator != address(0), "Invalid operator");
        protocolTreasury = _treasury;
        paymentToken = IERC20(_paymentToken);
        operator = _operator;

        tierConfigs[RoomTier.Quick] = TierConfig({ baseInterval: 300, rankingSlots: 3 });
        tierConfigs[RoomTier.Standard] = TierConfig({ baseInterval: 300, rankingSlots: 5 });
        tierConfigs[RoomTier.Epic] = TierConfig({ baseInterval: 300, rankingSlots: 5 });
    }

    // ============ Room Management ============

    function createRoom(
        RoomTier _tier,
        uint256 _maxPlayers,
        uint256 _entryFee,
        bytes32 _commitment,
        bytes calldata _operatorSig,
        string calldata _name
    ) external returns (uint256 roomId) {
        require(_maxPlayers >= MIN_PLAYERS && _maxPlayers <= MAX_PLAYERS, "Invalid player count");
        require(_entryFee >= MIN_FEE && _entryFee <= MAX_FEE, "Invalid entry fee");
        require(playerActiveRoom[msg.sender] == 0, "Already in a room");
        require(bytes(_name).length >= 1 && bytes(_name).length <= MAX_NAME_LENGTH, "Invalid name length");
        require(_commitment != bytes32(0), "Invalid commitment");
        require(!usedCommitments[_commitment], "Commitment already used");
        require(
            _verifyOperator(keccak256(abi.encodePacked(msg.sender, _commitment, "create")), _operatorSig),
            "Invalid operator signature"
        );

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
            isAI: false, // hidden during gameplay
            joinBlock: block.number,
            eliminationBlock: 0,
            eliminationRank: 0,
            lastActionBlock: block.number,
            actionCount: 0,
            successfulVotes: 0
        });
        roomPlayers[roomId].push(msg.sender);
        playerActiveRoom[msg.sender] = roomId;
        playerNames[roomId][msg.sender] = _name;
        identityCommitments[roomId][msg.sender] = _commitment;
        usedCommitments[_commitment] = true;

        emit RoomCreated(roomId, msg.sender, _tier, _entryFee, _maxPlayers);
        emit PlayerJoined(roomId, msg.sender);
    }

    function joinRoom(uint256 _roomId, bytes32 _commitment, bytes calldata _operatorSig, string calldata _name)
        external
    {
        Room storage room = rooms[_roomId];
        require(room.id != 0, "Room does not exist");
        require(room.phase == GamePhase.Waiting, "Game already started");
        require(playerActiveRoom[msg.sender] == 0, "Already in a room");
        require(room.playerCount < room.maxPlayers, "Room is full");
        require(bytes(_name).length >= 1 && bytes(_name).length <= MAX_NAME_LENGTH, "Invalid name length");
        require(_commitment != bytes32(0), "Invalid commitment");
        require(!usedCommitments[_commitment], "Commitment already used");
        require(
            _verifyOperator(
                keccak256(abi.encodePacked(msg.sender, _commitment, "join", _roomId)), _operatorSig
            ),
            "Invalid operator signature"
        );

        paymentToken.safeTransferFrom(msg.sender, address(this), room.entryFee);
        room.prizePool += room.entryFee;

        room.playerCount++;
        room.aliveCount++;

        players[_roomId][msg.sender] = Player({
            addr: msg.sender,
            humanityScore: 100,
            isAlive: true,
            isAI: false, // hidden during gameplay
            joinBlock: block.number,
            eliminationBlock: 0,
            eliminationRank: 0,
            lastActionBlock: block.number,
            actionCount: 0,
            successfulVotes: 0
        });

        roomPlayers[_roomId].push(msg.sender);
        playerActiveRoom[msg.sender] = _roomId;
        playerNames[_roomId][msg.sender] = _name;
        identityCommitments[_roomId][msg.sender] = _commitment;
        usedCommitments[_commitment] = true;

        emit PlayerJoined(_roomId, msg.sender);

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
        uint256 refund = room.entryFee;

        delete players[_roomId][_player];
        delete playerNames[_roomId][_player];
        delete identityCommitments[_roomId][_player];
        playerActiveRoom[_player] = 0;

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
            uint256 refund = room.entryFee;
            delete players[_roomId][player];
            delete playerNames[_roomId][player];
            delete identityCommitments[_roomId][player];
            playerActiveRoom[player] = 0;
            paymentToken.safeTransfer(player, refund);
            emit PlayerLeft(_roomId, player, refund);
        }

        delete roomPlayers[_roomId];

        room.phase = GamePhase.Ended;
        room.isEnded = true;
        room.playerCount = 0;
        room.aliveCount = 0;
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

    function castVote(uint256 _roomId, address _target) external nonReentrant {
        Room storage room = rooms[_roomId];
        require(room.isActive && !room.isEnded, "Game not active");
        require(!pendingReveal[_roomId], "Pending reveal");
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
        require(!pendingReveal[_roomId], "Pending reveal");
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

        // Step 6: If alive count <= 2, pause for operator reveal
        if (room.isActive && room.aliveCount <= 2) {
            pendingReveal[_roomId] = true;
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
    /// Called by revealAndEnd after identities are known.
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

        // Guard: need exactly 2 alive players for this resolution
        if (alive1 == address(0) || alive2 == address(0)) return;

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

    // ============ Reveal & End Game ============

    /// @notice Operator reveals all identities and ends the game with team-based outcome
    function revealAndEnd(
        uint256 _roomId,
        address[] calldata _players,
        bool[] calldata _isAIs,
        bytes32[] calldata _salts
    ) external {
        require(msg.sender == operator, "Only operator");
        require(rooms[_roomId].isActive || pendingReveal[_roomId], "Not active/pending");
        require(!rooms[_roomId].isEnded, "Already ended");
        require(_players.length == _isAIs.length && _isAIs.length == _salts.length, "Array length mismatch");

        address[] storage allPlayers = roomPlayers[_roomId];
        require(_players.length == allPlayers.length, "Must reveal all players");

        // Verify commitments and set isAI
        for (uint256 i = 0; i < _players.length; i++) {
            bytes32 commitment = identityCommitments[_roomId][_players[i]];
            require(commitment != bytes32(0), "No commitment for player");
            bytes32 computed = keccak256(abi.encodePacked(_isAIs[i], _salts[i]));
            require(computed == commitment, "Commitment mismatch");
            players[_roomId][_players[i]].isAI = _isAIs[i];
        }

        // Count alive humans and AIs
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

        // Resolve final two if exactly 2 alive
        if (rooms[_roomId].aliveCount == 2) {
            _resolveFinalTwo(_roomId);
            // Recount after resolution
            aliveHumans = 0;
            aliveAIs = 0;
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
        }

        // Determine winner
        bool humansWon;
        if (aliveHumans == 0 && aliveAIs > 0) {
            humansWon = false; // AIs win
        } else if (aliveAIs == 0 && aliveHumans > 0) {
            humansWon = true; // Humans win
        } else if (aliveHumans > 0 && aliveAIs > 0) {
            // Both teams still have survivors — humans win if they have more alive
            humansWon = aliveHumans >= aliveAIs;
        } else {
            // Both teams eliminated (shouldn't happen normally)
            humansWon = false;
        }

        pendingReveal[_roomId] = false;
        _endGame(_roomId, humansWon);

        emit IdentitiesRevealed(_roomId, humansWon);
    }

    /// @notice Emergency end when operator fails to reveal within timeout
    function emergencyEnd(uint256 _roomId) external {
        require(pendingReveal[_roomId], "Not pending reveal");
        require(!rooms[_roomId].isEnded, "Already ended");
        require(block.number > rooms[_roomId].lastSettleBlock + REVEAL_TIMEOUT, "Reveal timeout not reached");

        Room storage room = rooms[_roomId];
        pendingReveal[_roomId] = false;

        room.isActive = false;
        room.isEnded = true;
        room.phase = GamePhase.Ended;

        // Clear active room for all players
        address[] storage allPlayers = roomPlayers[_roomId];
        for (uint256 i = 0; i < allPlayers.length; i++) {
            playerActiveRoom[allPlayers[i]] = 0;
        }

        // Emergency: split prize equally among alive players (no team bonus)
        uint256 totalPrize = room.prizePool;
        uint256 protocolAmount = (totalPrize * PROTOCOL_SHARE) / BASIS_POINTS;
        uint256 remainingPool = totalPrize - protocolAmount;

        if (protocolAmount > 0) {
            rewards[_roomId][protocolTreasury].amount += protocolAmount;
        }

        uint256 aliveCount = 0;
        for (uint256 i = 0; i < allPlayers.length; i++) {
            if (players[_roomId][allPlayers[i]].isAlive) {
                aliveCount++;
            }
        }
        if (aliveCount > 0) {
            uint256 perPlayer = remainingPool / aliveCount;
            for (uint256 i = 0; i < allPlayers.length; i++) {
                if (players[_roomId][allPlayers[i]].isAlive) {
                    rewards[_roomId][allPlayers[i]].amount += perPlayer;
                }
            }
        }

        emit EmergencyEndTriggered(_roomId);
    }

    // ============ End Game & Rewards ============

    function _endGame(uint256 _roomId, bool _humansWon) internal {
        Room storage room = rooms[_roomId];
        if (room.isEnded) return; // guard against double-end

        room.isActive = false;
        room.isEnded = true;
        room.phase = GamePhase.Ended;

        // Clear active room for all players so they can join new games
        address[] storage allPlayers = roomPlayers[_roomId];
        for (uint256 i = 0; i < allPlayers.length; i++) {
            playerActiveRoom[allPlayers[i]] = 0;
        }

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

    function setOperator(address _newOperator) external {
        require(msg.sender == protocolTreasury, "Only treasury");
        require(_newOperator != address(0), "Invalid operator");
        operator = _newOperator;
    }

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

    function getPlayerName(uint256 _roomId, address _player) external view returns (string memory) {
        return playerNames[_roomId][_player];
    }

    function getRoomPlayerNames(uint256 _roomId) external view returns (string[] memory) {
        address[] storage addrs = roomPlayers[_roomId];
        string[] memory names = new string[](addrs.length);
        for (uint256 i = 0; i < addrs.length; i++) {
            names[i] = playerNames[_roomId][addrs[i]];
        }
        return names;
    }

    // ============ Internal: Operator Verification ============

    function _verifyOperator(bytes32 _hash, bytes calldata _sig) internal view returns (bool) {
        return _hash.toEthSignedMessageHash().recover(_sig) == operator;
    }
}
