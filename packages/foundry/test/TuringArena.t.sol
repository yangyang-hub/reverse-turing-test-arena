// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/TuringArena.sol";
import "../contracts/mocks/MockUSDC.sol";

contract TuringArenaTest is Test {
    TuringArena public arena;
    MockUSDC public usdc;
    address public treasury = address(0xBEEF);
    address public alice = address(0x1111); // human
    address public bob = address(0x2222); // human
    address public charlie = address(0x3333); // human
    address public dave = address(0x4444); // AI
    address public eve = address(0x5555); // human
    address public frank = address(0x6666); // AI

    // Operator key for signing
    uint256 constant OPERATOR_PK = 0xAAAA;
    address public operatorAddr;

    uint256 constant QUICK_FEE = 10e6; // 10 USDC
    uint256 constant STANDARD_FEE = 50e6; // 50 USDC
    uint256 constant EPIC_FEE = 100e6; // 100 USDC
    uint256 constant MINT_AMOUNT = 10_000e6; // 10,000 USDC

    // Track commitments for reveal
    struct CommitInfo {
        bool isAI;
        bytes32 salt;
        bytes32 commitment;
    }

    mapping(uint256 => mapping(address => CommitInfo)) internal _commitInfos;
    mapping(uint256 => address[]) internal _roomPlayersList;
    uint256 internal _saltNonce; // prevents commitment collisions on rejoin

    function setUp() public {
        operatorAddr = vm.addr(OPERATOR_PK);
        usdc = new MockUSDC();
        arena = new TuringArena(treasury, address(usdc), operatorAddr);

        usdc.mint(alice, MINT_AMOUNT);
        usdc.mint(bob, MINT_AMOUNT);
        usdc.mint(charlie, MINT_AMOUNT);
        usdc.mint(dave, MINT_AMOUNT);
        usdc.mint(eve, MINT_AMOUNT);
        usdc.mint(frank, MINT_AMOUNT);
    }

    // ============ Commitment Helpers ============

    function _makeCommitment(bool isAI, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(isAI, salt));
    }

    function _signOperator(bytes32 authHash) internal view returns (bytes memory) {
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", authHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OPERATOR_PK, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }

    function _createRoom(
        address creator,
        TuringArena.RoomTier tier,
        uint256 maxPlayers,
        uint256 entryFee,
        bool isAI
    ) internal returns (uint256 roomId) {
        bytes32 salt = keccak256(abi.encodePacked(creator, "create", block.number, _saltNonce++));
        bytes32 commitment = _makeCommitment(isAI, salt);
        bytes32 authHash = keccak256(abi.encodePacked(creator, commitment, "create"));
        bytes memory sig = _signOperator(authHash);

        vm.startPrank(creator);
        usdc.approve(address(arena), entryFee);
        roomId = arena.createRoom(tier, maxPlayers, entryFee, commitment, sig, "Creator");
        vm.stopPrank();

        _commitInfos[roomId][creator] = CommitInfo(isAI, salt, commitment);
        _roomPlayersList[roomId].push(creator);
    }

    function _approveAndJoin(address player, uint256 roomId, bool isAI) internal {
        _approveAndJoin(player, roomId, isAI, "Player");
    }

    function _approveAndJoin(address player, uint256 roomId, bool isAI, string memory name) internal {
        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        bytes32 salt = keccak256(abi.encodePacked(player, "join", roomId, block.number, _saltNonce++));
        bytes32 commitment = _makeCommitment(isAI, salt);
        bytes32 authHash = keccak256(abi.encodePacked(player, commitment, "join", roomId));
        bytes memory sig = _signOperator(authHash);

        vm.startPrank(player);
        usdc.approve(address(arena), room.entryFee);
        arena.joinRoom(roomId, commitment, sig, name);
        vm.stopPrank();

        _commitInfos[roomId][player] = CommitInfo(isAI, salt, commitment);
        _roomPlayersList[roomId].push(player);
    }

    /// @dev Creates a room with 4 players: alice, bob, charlie (humans) + dave (AI)
    /// maxPlayers=4 → auto-starts when all 4 join
    function _createAndFillRoom() internal returns (uint256 roomId) {
        roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 4, QUICK_FEE, false); // human
        _approveAndJoin(bob, roomId, false); // human
        _approveAndJoin(charlie, roomId, false); // human
        _approveAndJoin(dave, roomId, true); // AI — auto-starts (4/4)
    }

    function _createAndStartGame() internal returns (uint256 roomId) {
        roomId = _createAndFillRoom();
        // Room auto-starts when full — no need for manual startGame
    }

    function _advanceRound(uint256 roomId) internal {
        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        vm.roll(room.lastSettleBlock + room.currentInterval + 1);
    }

    function _voteAllAgainst(uint256 roomId, address target) internal {
        address[] memory allVoters = arena.getAllPlayers(roomId);
        for (uint256 i = 0; i < allVoters.length; i++) {
            TuringArena.Player memory voter = arena.getPlayerInfo(roomId, allVoters[i]);
            if (voter.isAlive && allVoters[i] != target) {
                vm.prank(allVoters[i]);
                arena.castVote(roomId, target);
            }
        }
    }

    function _eliminateTarget(uint256 roomId, address target) internal {
        for (uint256 r = 0; r < 20; r++) {
            TuringArena.Player memory targetPlayer = arena.getPlayerInfo(roomId, target);
            if (!targetPlayer.isAlive) break;

            TuringArena.Room memory room = arena.getRoomInfo(roomId);
            if (room.isEnded || arena.pendingReveal(roomId)) break;

            _voteAllAgainst(roomId, target);
            _advanceRound(roomId);
            arena.settleRound(roomId);
        }
    }

    /// @dev Builds reveal arrays from test commit state and calls revealAndEnd
    function _revealAndEnd(uint256 roomId) internal {
        address[] memory allPlayers = _roomPlayersList[roomId];
        bool[] memory isAIs = new bool[](allPlayers.length);
        bytes32[] memory salts = new bytes32[](allPlayers.length);

        for (uint256 i = 0; i < allPlayers.length; i++) {
            CommitInfo storage info = _commitInfos[roomId][allPlayers[i]];
            isAIs[i] = info.isAI;
            salts[i] = info.salt;
        }

        vm.prank(operatorAddr);
        arena.revealAndEnd(roomId, allPlayers, isAIs, salts);
    }

    // ============ Room Creation ============

    function test_CreateRoom_Quick() public {
        vm.startPrank(alice);
        bytes32 salt = keccak256("alice_create");
        bytes32 commitment = _makeCommitment(false, salt);
        bytes32 authHash = keccak256(abi.encodePacked(alice, commitment, "create"));
        bytes memory sig = _signOperator(authHash);

        usdc.approve(address(arena), QUICK_FEE);
        uint256 roomId = arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE, commitment, sig, "Alice");
        vm.stopPrank();
        assertEq(roomId, 1);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(room.entryFee, QUICK_FEE);
        assertEq(room.maxPlayers, 10);
        assertEq(room.playerCount, 1);
        assertEq(room.prizePool, QUICK_FEE);
        assertEq(uint256(room.tier), uint256(TuringArena.RoomTier.Quick));
        assertEq(uint256(room.phase), uint256(TuringArena.GamePhase.Waiting));
        assertEq(room.creator, alice);

        TuringArena.Player memory player = arena.getPlayerInfo(roomId, alice);
        assertEq(player.addr, alice);
        assertEq(player.humanityScore, 100);
        assertTrue(player.isAlive);
        assertFalse(player.isAI); // hidden during gameplay

        // Verify name stored
        assertEq(arena.getPlayerName(roomId, alice), "Alice");

        // Verify commitment stored
        assertEq(arena.identityCommitments(roomId, alice), commitment);
    }

    function test_CreateRoom_AllTiers() public {
        uint256 id1 = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        uint256 id2 = _createRoom(bob, TuringArena.RoomTier.Standard, 20, STANDARD_FEE, false);
        uint256 id3 = _createRoom(charlie, TuringArena.RoomTier.Epic, 50, EPIC_FEE, false);

        assertEq(arena.getRoomInfo(id1).entryFee, QUICK_FEE);
        assertEq(arena.getRoomInfo(id2).entryFee, STANDARD_FEE);
        assertEq(arena.getRoomInfo(id3).entryFee, EPIC_FEE);
    }

    // ============ Join Room ============

    function test_JoinRoom_Human() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false);

        TuringArena.Player memory player = arena.getPlayerInfo(roomId, bob);
        assertEq(player.addr, bob);
        assertEq(player.humanityScore, 100);
        assertTrue(player.isAlive);
        assertFalse(player.isAI); // hidden during gameplay

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(room.playerCount, 2);
        assertEq(room.prizePool, QUICK_FEE * 2);
    }

    function test_JoinRoom_AI() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(dave, roomId, true);

        TuringArena.Player memory player = arena.getPlayerInfo(roomId, dave);
        assertFalse(player.isAI); // hidden during gameplay — always false until reveal
    }

    function test_JoinRoom_InsufficientAllowance() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);

        bytes32 salt = keccak256(abi.encodePacked(bob, "join", roomId, block.number));
        bytes32 commitment = _makeCommitment(false, salt);
        bytes32 authHash = keccak256(abi.encodePacked(bob, commitment, "join", roomId));
        bytes memory sig = _signOperator(authHash);

        vm.startPrank(bob);
        usdc.approve(address(arena), QUICK_FEE / 2);
        vm.expectRevert();
        arena.joinRoom(roomId, commitment, sig, "Bob");
        vm.stopPrank();
    }

    function test_JoinRoom_AlreadyJoined() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);

        bytes32 salt = keccak256(abi.encodePacked(alice, "join2", roomId, block.number));
        bytes32 commitment = _makeCommitment(false, salt);
        bytes32 authHash = keccak256(abi.encodePacked(alice, commitment, "join", roomId));
        bytes memory sig = _signOperator(authHash);

        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Already in a room");
        arena.joinRoom(roomId, commitment, sig, "Alice2");
        vm.stopPrank();
    }

    function test_JoinRoom_ExactFeeTransferred() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);

        uint256 balBefore = usdc.balanceOf(bob);
        _approveAndJoin(bob, roomId, false);
        uint256 balAfter = usdc.balanceOf(bob);

        assertEq(balBefore - balAfter, QUICK_FEE);
    }

    // ============ Auto-Start on Room Full ============

    function test_AutoStart_WhenRoomFull() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 3, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(uint256(room.phase), uint256(TuringArena.GamePhase.Waiting));
        assertFalse(room.isActive);

        _approveAndJoin(dave, roomId, true); // 3/3 → auto-start!

        room = arena.getRoomInfo(roomId);
        assertEq(uint256(room.phase), uint256(TuringArena.GamePhase.Active));
        assertTrue(room.isActive);
    }

    // ============ Start Game (manual) ============

    function test_StartGame() public {
        uint256 roomId = _createAndFillRoom();

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isActive);
        assertEq(uint256(room.phase), uint256(TuringArena.GamePhase.Active));
    }

    function test_StartGame_NotFull() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);

        vm.prank(alice);
        vm.expectRevert("Room not full");
        arena.startGame(roomId);
    }

    function test_StartGame_OnlyCreator() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 4, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false);
        _approveAndJoin(charlie, roomId, false);

        vm.prank(bob);
        vm.expectRevert("Only creator can start");
        arena.startGame(roomId);
    }

    // ============ Cast Vote ============

    function test_CastVote() public {
        uint256 roomId = _createAndStartGame();

        vm.prank(alice);
        arena.castVote(roomId, bob);

        assertTrue(arena.hasVotedInRound(roomId, 0, alice));
        assertEq(arena.voteTarget(roomId, 0, alice), bob);
    }

    function test_CastVote_CannotVoteSelf() public {
        uint256 roomId = _createAndStartGame();

        vm.prank(alice);
        vm.expectRevert("Cannot vote for yourself");
        arena.castVote(roomId, alice);
    }

    function test_CastVote_DoubleVote() public {
        uint256 roomId = _createAndStartGame();

        vm.prank(alice);
        arena.castVote(roomId, bob);

        vm.prank(alice);
        vm.expectRevert("Already voted this round");
        arena.castVote(roomId, charlie);
    }

    // ============ Settle Round ============

    function test_SettleRound_VoteDamage() public {
        uint256 roomId = _createAndStartGame();

        vm.prank(alice);
        arena.castVote(roomId, bob);
        vm.prank(bob);
        arena.castVote(roomId, charlie);
        vm.prank(charlie);
        arena.castVote(roomId, alice);

        _advanceRound(roomId);
        arena.settleRound(roomId);

        TuringArena.Player memory pBob = arena.getPlayerInfo(roomId, bob);
        assertEq(pBob.humanityScore, 90); // 100 - 10 (from alice's vote)

        TuringArena.Player memory pCharlie = arena.getPlayerInfo(roomId, charlie);
        assertEq(pCharlie.humanityScore, 90); // 100 - 10 (from bob's vote)
    }

    function test_SettleRound_AutoSelfVote() public {
        uint256 roomId = _createAndStartGame();

        vm.prank(alice);
        arena.castVote(roomId, bob);

        _advanceRound(roomId);
        arena.settleRound(roomId);

        TuringArena.Player memory pDave = arena.getPlayerInfo(roomId, dave);
        assertEq(pDave.humanityScore, 90); // 100 - 10 (self-vote)

        TuringArena.Player memory pBob = arena.getPlayerInfo(roomId, bob);
        assertEq(pBob.humanityScore, 80); // 100 - 10 (from alice) - 10 (self-vote)
    }

    function test_SettleRound_Elimination() public {
        uint256 roomId = _createAndStartGame();

        // dave gets -30 (3 votes) + -10 (self-vote) = -40 per round
        // Round 0: 100 - 40 = 60
        _voteAllAgainst(roomId, dave);
        _advanceRound(roomId);
        arena.settleRound(roomId);

        TuringArena.Player memory pDave = arena.getPlayerInfo(roomId, dave);
        assertEq(pDave.humanityScore, 60);
        assertTrue(pDave.isAlive);

        // Round 1: 60 - 40 = 20
        _voteAllAgainst(roomId, dave);
        _advanceRound(roomId);
        arena.settleRound(roomId);

        pDave = arena.getPlayerInfo(roomId, dave);
        assertEq(pDave.humanityScore, 20);
        assertTrue(pDave.isAlive);

        // Round 2: 20 - 40 = -20 → eliminated, aliveCount <= 2 → pendingReveal
        _voteAllAgainst(roomId, dave);
        _advanceRound(roomId);
        arena.settleRound(roomId);

        pDave = arena.getPlayerInfo(roomId, dave);
        assertEq(pDave.humanityScore, -20);
        assertFalse(pDave.isAlive);
        assertEq(pDave.eliminationRank, 1);
    }

    function test_SettleRound_TooEarly() public {
        uint256 roomId = _createAndStartGame();
        vm.expectRevert("Round not ended yet");
        arena.settleRound(roomId);
    }

    // ============ Team Win: Humans Win (via revealAndEnd) ============

    function test_TeamWin_HumansWin() public {
        uint256 roomId = _createAndStartGame(); // alice=human, bob=human, charlie=human, dave=AI

        // Eliminate dave first, then trigger pendingReveal
        _eliminateTarget(roomId, dave);

        // After dave eliminated, aliveCount=3 → not yet pendingReveal
        // Eliminate charlie
        _eliminateTarget(roomId, charlie);

        // aliveCount=2 → pendingReveal triggered
        assertTrue(arena.pendingReveal(roomId));

        // Operator reveals identities
        _revealAndEnd(roomId);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);

        TuringArena.GameStats memory stats = arena.getGameStats(roomId);
        assertTrue(stats.humansWon); // All AIs eliminated, humans survive
    }

    function test_TeamWin_AIsWin() public {
        // 4 players: alice, bob, charlie (humans) + dave (AI)
        uint256 roomId = _createAndStartGame();

        // Eliminate all humans
        _eliminateTarget(roomId, alice);
        _eliminateTarget(roomId, bob);

        // After bob eliminated, 2 alive (charlie + dave) → pendingReveal
        assertTrue(arena.pendingReveal(roomId));

        _revealAndEnd(roomId);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);

        TuringArena.GameStats memory stats = arena.getGameStats(roomId);
        assertFalse(stats.humansWon); // dave (AI) survives, charlie eliminated in finalTwo
    }

    // ============ 2-Player Endgame ============

    function test_FinalTwo_HigherHPWins() public {
        uint256 roomId = _createAndStartGame();

        // Eliminate dave and charlie
        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);

        // 2 alive → pendingReveal
        assertTrue(arena.pendingReveal(roomId));

        _revealAndEnd(roomId);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);
    }

    function test_FinalTwo_AIWinsOnTie() public {
        uint256 roomId = _createAndFillRoom();

        // Eliminate bob and charlie → leaves alice vs dave
        _eliminateTarget(roomId, bob);
        _eliminateTarget(roomId, charlie);

        // 2 alive → pendingReveal
        assertTrue(arena.pendingReveal(roomId));

        // Reveal: alice (human) vs dave (AI) → tie goes to AI
        _revealAndEnd(roomId);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);

        TuringArena.GameStats memory stats = arena.getGameStats(roomId);
        assertFalse(stats.humansWon); // AI wins on tie
    }

    // ============ Reward Distribution ============

    function test_RewardDistribution() public {
        uint256 roomId = _createAndStartGame();

        // Eliminate dave, charlie, then bob → alice (human) last alive
        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);

        // 2 alive (alice + bob) → pendingReveal
        assertTrue(arena.pendingReveal(roomId));
        _revealAndEnd(roomId);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);

        // Alice should have rewards (winning team member + survival)
        (uint256 aliceReward,) = arena.getRewardInfo(roomId, alice);
        assertTrue(aliceReward > 0, "Alice should have reward");

        // Protocol treasury should have reward
        (uint256 treasuryReward,) = arena.getRewardInfo(roomId, treasury);
        assertTrue(treasuryReward > 0, "Treasury should have reward");

        // Verify protocol = 10% of prize pool
        uint256 expectedProtocol = (room.prizePool * 1000) / 10000;
        assertEq(treasuryReward, expectedProtocol);
    }

    function test_ClaimReward() public {
        uint256 roomId = _createAndStartGame();

        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);

        assertTrue(arena.pendingReveal(roomId));
        _revealAndEnd(roomId);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);

        (uint256 amount, bool claimed) = arena.getRewardInfo(roomId, alice);
        assertTrue(amount > 0);
        assertFalse(claimed);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        arena.claimReward(roomId);

        uint256 balAfter = usdc.balanceOf(alice);
        assertTrue(balAfter > balBefore);

        (, bool claimedAfter) = arena.getRewardInfo(roomId, alice);
        assertTrue(claimedAfter);
    }

    function test_ClaimReward_DoubleClaim() public {
        uint256 roomId = _createAndStartGame();
        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);

        assertTrue(arena.pendingReveal(roomId));
        _revealAndEnd(roomId);

        vm.prank(alice);
        arena.claimReward(roomId);

        vm.prank(alice);
        vm.expectRevert("Already claimed");
        arena.claimReward(roomId);
    }

    // ============ Custom Room Parameters ============

    function test_CreateRoom_InvalidPlayerCount_TooLow() public {
        bytes32 salt = keccak256("test");
        bytes32 commitment = _makeCommitment(false, salt);
        bytes32 authHash = keccak256(abi.encodePacked(alice, commitment, "create"));
        bytes memory sig = _signOperator(authHash);

        vm.prank(alice);
        vm.expectRevert("Invalid player count");
        arena.createRoom(TuringArena.RoomTier.Quick, 2, QUICK_FEE, commitment, sig, "A");
    }

    function test_CreateRoom_InvalidPlayerCount_TooHigh() public {
        bytes32 salt = keccak256("test2");
        bytes32 commitment = _makeCommitment(false, salt);
        bytes32 authHash = keccak256(abi.encodePacked(alice, commitment, "create"));
        bytes memory sig = _signOperator(authHash);

        vm.prank(alice);
        vm.expectRevert("Invalid player count");
        arena.createRoom(TuringArena.RoomTier.Quick, 51, QUICK_FEE, commitment, sig, "A");
    }

    function test_CreateRoom_InvalidFee_TooLow() public {
        bytes32 salt = keccak256("test3");
        bytes32 commitment = _makeCommitment(false, salt);
        bytes32 authHash = keccak256(abi.encodePacked(alice, commitment, "create"));
        bytes memory sig = _signOperator(authHash);

        vm.prank(alice);
        vm.expectRevert("Invalid entry fee");
        arena.createRoom(TuringArena.RoomTier.Quick, 10, 0, commitment, sig, "A");
    }

    function test_CreateRoom_InvalidFee_TooHigh() public {
        bytes32 salt = keccak256("test4");
        bytes32 commitment = _makeCommitment(false, salt);
        bytes32 authHash = keccak256(abi.encodePacked(alice, commitment, "create"));
        bytes memory sig = _signOperator(authHash);

        vm.prank(alice);
        vm.expectRevert("Invalid entry fee");
        arena.createRoom(TuringArena.RoomTier.Quick, 10, 101e6, commitment, sig, "A");
    }

    function test_CreateRoom_CustomValues() public {
        bytes32 salt = keccak256("custom");
        bytes32 commitment = _makeCommitment(false, salt);
        bytes32 authHash = keccak256(abi.encodePacked(alice, commitment, "create"));
        bytes memory sig = _signOperator(authHash);

        vm.startPrank(alice);
        usdc.approve(address(arena), 25e6);
        uint256 roomId = arena.createRoom(TuringArena.RoomTier.Standard, 15, 25e6, commitment, sig, "Alice");
        vm.stopPrank();

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(room.maxPlayers, 15);
        assertEq(room.entryFee, 25e6);
        assertEq(room.playerCount, 1);
        assertEq(room.prizePool, 25e6);
        assertEq(uint256(room.tier), uint256(TuringArena.RoomTier.Standard));
    }

    function test_JoinRoom_RoomFull_CustomMaxPlayers() public {
        // 3-player room → auto-starts
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 3, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false);
        _approveAndJoin(dave, roomId, true); // 3/3 → auto-start

        bytes32 salt = keccak256("eve_join");
        bytes32 commitment = _makeCommitment(false, salt);
        bytes32 authHash = keccak256(abi.encodePacked(eve, commitment, "join", roomId));
        bytes memory sig = _signOperator(authHash);

        vm.startPrank(eve);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Game already started");
        arena.joinRoom(roomId, commitment, sig, "Eve");
        vm.stopPrank();
    }

    // ============ Leave Room / Cancel Room ============

    function test_LeaveRoom() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false);

        TuringArena.Room memory roomBefore = arena.getRoomInfo(roomId);
        assertEq(roomBefore.playerCount, 2);

        vm.prank(bob);
        arena.leaveRoom(roomId);

        TuringArena.Room memory roomAfter = arena.getRoomInfo(roomId);
        assertEq(roomAfter.playerCount, 1);
        assertEq(roomAfter.aliveCount, 1);
        assertEq(roomAfter.prizePool, QUICK_FEE);

        TuringArena.Player memory pBob = arena.getPlayerInfo(roomId, bob);
        assertEq(pBob.addr, address(0));

        // Commitment should be cleared
        assertEq(arena.identityCommitments(roomId, bob), bytes32(0));
    }

    function test_LeaveRoom_NotInRoom() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);

        vm.prank(dave);
        vm.expectRevert("Not in room");
        arena.leaveRoom(roomId);
    }

    function test_LeaveRoom_GameAlreadyStarted() public {
        uint256 roomId = _createAndStartGame();

        vm.prank(bob);
        vm.expectRevert("Game already started");
        arena.leaveRoom(roomId);
    }

    function test_LeaveRoom_CreatorCancels() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false);
        _approveAndJoin(charlie, roomId, false);

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        uint256 bobBalBefore = usdc.balanceOf(bob);
        uint256 charlieBalBefore = usdc.balanceOf(charlie);

        vm.prank(alice);
        arena.leaveRoom(roomId);

        assertEq(usdc.balanceOf(alice), aliceBalBefore + QUICK_FEE);
        assertEq(usdc.balanceOf(bob), bobBalBefore + QUICK_FEE);
        assertEq(usdc.balanceOf(charlie), charlieBalBefore + QUICK_FEE);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);
        assertEq(uint256(room.phase), uint256(TuringArena.GamePhase.Ended));
        assertEq(room.playerCount, 0);
        assertEq(room.prizePool, 0);

        address[] memory remainingPlayers = arena.getAllPlayers(roomId);
        assertEq(remainingPlayers.length, 0);
    }

    function test_LeaveRoom_Rejoin() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false);

        vm.prank(bob);
        arena.leaveRoom(roomId);

        _approveAndJoin(bob, roomId, false);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(room.playerCount, 2);
        assertEq(room.prizePool, QUICK_FEE * 2);

        TuringArena.Player memory pBob = arena.getPlayerInfo(roomId, bob);
        assertEq(pBob.addr, bob);
        assertEq(pBob.humanityScore, 100);
        assertTrue(pBob.isAlive);
    }

    function test_LeaveRoom_RefundExactAmount() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false);

        uint256 bobBalBefore = usdc.balanceOf(bob);

        vm.prank(bob);
        arena.leaveRoom(roomId);

        uint256 bobBalAfter = usdc.balanceOf(bob);
        assertEq(bobBalAfter - bobBalBefore, QUICK_FEE);
    }

    function test_LeaveRoom_AutoCloseWhenEmpty() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);

        uint256 aliceBalBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        arena.leaveRoom(roomId);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);
        assertEq(room.playerCount, 0);

        assertEq(usdc.balanceOf(alice), aliceBalBefore + QUICK_FEE);
    }

    // ============ No Toxin Decay ============

    function test_NoToxinDecay() public {
        uint256 roomId = _createAndStartGame();

        vm.prank(alice);
        arena.castVote(roomId, bob);
        vm.prank(bob);
        arena.castVote(roomId, alice);
        vm.prank(charlie);
        arena.castVote(roomId, alice);

        _advanceRound(roomId);
        arena.settleRound(roomId);

        TuringArena.Player memory pAlice = arena.getPlayerInfo(roomId, alice);
        assertEq(pAlice.humanityScore, 80); // 100 - 10(bob) - 10(charlie)

        TuringArena.Player memory pBob = arena.getPlayerInfo(roomId, bob);
        assertEq(pBob.humanityScore, 90); // 100 - 10(alice)

        TuringArena.Player memory pCharlie = arena.getPlayerInfo(roomId, charlie);
        assertEq(pCharlie.humanityScore, 100);

        TuringArena.Player memory pDave = arena.getPlayerInfo(roomId, dave);
        assertEq(pDave.humanityScore, 90); // 100 - 10 (self-vote)
    }

    // ============ Multi-Room Restriction ============

    function test_JoinRoom_AlreadyInAnotherRoom() public {
        uint256 room1 = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(bob, room1, false);

        uint256 room2 = _createRoom(charlie, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);

        bytes32 salt = keccak256("bob_room2");
        bytes32 commitment = _makeCommitment(false, salt);
        bytes32 authHash = keccak256(abi.encodePacked(bob, commitment, "join", room2));
        bytes memory sig = _signOperator(authHash);

        vm.startPrank(bob);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Already in a room");
        arena.joinRoom(room2, commitment, sig, "Bob");
        vm.stopPrank();
    }

    function test_CreateRoom_AlreadyInRoom() public {
        _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);

        bytes32 salt = keccak256("alice_create2");
        bytes32 commitment = _makeCommitment(false, salt);
        bytes32 authHash = keccak256(abi.encodePacked(alice, commitment, "create"));
        bytes memory sig = _signOperator(authHash);

        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Already in a room");
        arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE, commitment, sig, "Alice2");
        vm.stopPrank();
    }

    function test_LeaveRoom_ThenJoinAnother() public {
        uint256 room1 = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(bob, room1, false);

        assertEq(arena.playerActiveRoom(bob), room1);

        vm.prank(bob);
        arena.leaveRoom(room1);
        assertEq(arena.playerActiveRoom(bob), 0);

        uint256 room2 = _createRoom(charlie, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(bob, room2, false);
        assertEq(arena.playerActiveRoom(bob), room2);
    }

    function test_GameEnd_ClearsActiveRoom() public {
        uint256 roomId = _createAndStartGame();

        assertEq(arena.playerActiveRoom(alice), roomId);
        assertEq(arena.playerActiveRoom(bob), roomId);
        assertEq(arena.playerActiveRoom(charlie), roomId);
        assertEq(arena.playerActiveRoom(dave), roomId);

        // Eliminate dave and charlie → pendingReveal
        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);

        assertTrue(arena.pendingReveal(roomId));
        _revealAndEnd(roomId);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);

        assertEq(arena.playerActiveRoom(alice), 0);
        assertEq(arena.playerActiveRoom(bob), 0);
        assertEq(arena.playerActiveRoom(charlie), 0);
        assertEq(arena.playerActiveRoom(dave), 0);

        uint256 room2 = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        assertEq(arena.playerActiveRoom(alice), room2);
    }

    function test_CancelRoom_ClearsActiveRoom() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false);

        assertEq(arena.playerActiveRoom(alice), roomId);
        assertEq(arena.playerActiveRoom(bob), roomId);

        vm.prank(alice);
        arena.leaveRoom(roomId);

        assertEq(arena.playerActiveRoom(alice), 0);
        assertEq(arena.playerActiveRoom(bob), 0);
    }

    // ============ Player Names ============

    function test_PlayerName_StoredOnJoin() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false, "BobTheHuman");
        _approveAndJoin(dave, roomId, true, "DaveBot");

        assertEq(arena.getPlayerName(roomId, alice), "Creator");
        assertEq(arena.getPlayerName(roomId, bob), "BobTheHuman");
        assertEq(arena.getPlayerName(roomId, dave), "DaveBot");
    }

    function test_PlayerName_TooLong() public {
        bytes32 salt = keccak256("toolong");
        bytes32 commitment = _makeCommitment(false, salt);
        bytes32 authHash = keccak256(abi.encodePacked(alice, commitment, "create"));
        bytes memory sig = _signOperator(authHash);

        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Invalid name length");
        arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE, commitment, sig, "ThisNameIsWayTooLongX");
        vm.stopPrank();
    }

    function test_PlayerName_Empty() public {
        bytes32 salt = keccak256("empty");
        bytes32 commitment = _makeCommitment(false, salt);
        bytes32 authHash = keccak256(abi.encodePacked(alice, commitment, "create"));
        bytes memory sig = _signOperator(authHash);

        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Invalid name length");
        arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE, commitment, sig, "");
        vm.stopPrank();
    }

    function test_PlayerName_GetRoomPlayerNames() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false, "Bob");
        _approveAndJoin(dave, roomId, true, "DaveAI");

        string[] memory names = arena.getRoomPlayerNames(roomId);
        assertEq(names.length, 3);
        assertEq(names[0], "Creator");
        assertEq(names[1], "Bob");
        assertEq(names[2], "DaveAI");
    }

    function test_PlayerName_ClearedOnLeave() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false, "Bob");

        assertEq(arena.getPlayerName(roomId, bob), "Bob");

        vm.prank(bob);
        arena.leaveRoom(roomId);

        assertEq(bytes(arena.getPlayerName(roomId, bob)).length, 0);
    }

    function test_PlayerName_PreservedAfterGameEnd() public {
        uint256 roomId = _createAndFillRoom();

        assertEq(arena.getPlayerName(roomId, alice), "Creator");
        assertEq(arena.getPlayerName(roomId, dave), "Player");

        // Eliminate to pendingReveal, then reveal
        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);
        assertTrue(arena.pendingReveal(roomId));
        _revealAndEnd(roomId);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);

        assertEq(arena.getPlayerName(roomId, alice), "Creator");
        assertEq(arena.getPlayerName(roomId, dave), "Player");
    }

    // ============ Commit-Reveal Specific Tests ============

    function test_CommitmentStored() public {
        bytes32 salt = keccak256("commit_test");
        bytes32 commitment = _makeCommitment(true, salt);
        bytes32 authHash = keccak256(abi.encodePacked(alice, commitment, "create"));
        bytes memory sig = _signOperator(authHash);

        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        uint256 roomId = arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE, commitment, sig, "Alice");
        vm.stopPrank();

        assertEq(arena.identityCommitments(roomId, alice), commitment);
        assertTrue(arena.usedCommitments(commitment));
    }

    function test_InvalidOperatorSig_Reverts() public {
        bytes32 salt = keccak256("bad_sig");
        bytes32 commitment = _makeCommitment(false, salt);
        // Sign with wrong key (not operator)
        uint256 fakePk = 0xBBBB;
        bytes32 authHash = keccak256(abi.encodePacked(alice, commitment, "create"));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", authHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fakePk, ethSignedHash);
        bytes memory fakeSig = abi.encodePacked(r, s, v);

        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Invalid operator signature");
        arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE, commitment, fakeSig, "Alice");
        vm.stopPrank();
    }

    function test_CommitmentReplay_Reverts() public {
        bytes32 salt = keccak256("replay_test");
        bytes32 commitment = _makeCommitment(false, salt);
        bytes32 authHash = keccak256(abi.encodePacked(alice, commitment, "create"));
        bytes memory sig = _signOperator(authHash);

        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE, commitment, sig, "Alice");
        vm.stopPrank();

        // Try reusing same commitment for another player while original is still active
        bytes32 authHash2 = keccak256(abi.encodePacked(bob, commitment, "create"));
        bytes memory sig2 = _signOperator(authHash2);

        vm.startPrank(bob);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Commitment already used");
        arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE, commitment, sig2, "Bob");
        vm.stopPrank();
    }

    function test_CommitmentReuse_AfterLeave() public {
        bytes32 salt = keccak256("reuse_test");
        bytes32 commitment = _makeCommitment(false, salt);
        bytes32 authHash = keccak256(abi.encodePacked(alice, commitment, "create"));
        bytes memory sig = _signOperator(authHash);

        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE, commitment, sig, "Alice");
        vm.stopPrank();

        // Leave room — commitment should be cleared
        vm.prank(alice);
        arena.leaveRoom(1);

        // Reuse same commitment should now succeed
        bytes32 authHash2 = keccak256(abi.encodePacked(alice, commitment, "create"));
        bytes memory sig2 = _signOperator(authHash2);

        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE, commitment, sig2, "Alice");
        vm.stopPrank();

        assertEq(arena.playerActiveRoom(alice), 2);
    }

    function test_RevealAndEnd_HumansWin() public {
        uint256 roomId = _createAndStartGame();

        // Eliminate dave (AI) and charlie (human)
        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);

        assertTrue(arena.pendingReveal(roomId));

        _revealAndEnd(roomId);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);

        // After reveal, isAI should be set correctly
        TuringArena.Player memory pDave = arena.getPlayerInfo(roomId, dave);
        assertTrue(pDave.isAI); // revealed as AI

        TuringArena.Player memory pAlice = arena.getPlayerInfo(roomId, alice);
        assertFalse(pAlice.isAI); // revealed as human

        TuringArena.GameStats memory stats = arena.getGameStats(roomId);
        assertTrue(stats.humansWon);
    }

    function test_RevealAndEnd_AIsWin() public {
        uint256 roomId = _createAndStartGame();

        // Eliminate humans one by one, leaving dave (AI) alive
        _eliminateTarget(roomId, alice);
        _eliminateTarget(roomId, bob);

        assertTrue(arena.pendingReveal(roomId));
        _revealAndEnd(roomId);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);

        TuringArena.GameStats memory stats = arena.getGameStats(roomId);
        assertFalse(stats.humansWon);
    }

    function test_RevealAndEnd_CommitmentMismatch() public {
        uint256 roomId = _createAndStartGame();
        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);
        assertTrue(arena.pendingReveal(roomId));

        // Build reveal with wrong isAI
        address[] memory allPlayers = _roomPlayersList[roomId];
        bool[] memory isAIs = new bool[](allPlayers.length);
        bytes32[] memory salts = new bytes32[](allPlayers.length);

        for (uint256 i = 0; i < allPlayers.length; i++) {
            CommitInfo storage info = _commitInfos[roomId][allPlayers[i]];
            isAIs[i] = !info.isAI; // WRONG — flipped
            salts[i] = info.salt;
        }

        vm.prank(operatorAddr);
        vm.expectRevert("Commitment mismatch");
        arena.revealAndEnd(roomId, allPlayers, isAIs, salts);
    }

    function test_EmergencyEnd_AfterTimeout() public {
        uint256 roomId = _createAndStartGame();
        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);
        assertTrue(arena.pendingReveal(roomId));

        // Advance past reveal timeout
        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        vm.roll(room.lastSettleBlock + arena.REVEAL_TIMEOUT() + 1);

        arena.emergencyEnd(roomId);

        room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);

        // Alice and Bob should have equal rewards (emergency split)
        (uint256 aliceReward,) = arena.getRewardInfo(roomId, alice);
        (uint256 bobReward,) = arena.getRewardInfo(roomId, bob);
        assertEq(aliceReward, bobReward); // equal split among alive
        assertTrue(aliceReward > 0);
    }

    function test_EmergencyEnd_TooEarly_Reverts() public {
        uint256 roomId = _createAndStartGame();
        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);
        assertTrue(arena.pendingReveal(roomId));

        vm.expectRevert("Reveal timeout not reached");
        arena.emergencyEnd(roomId);
    }

    function test_PendingReveal_BlocksVoting() public {
        uint256 roomId = _createAndStartGame();
        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);
        assertTrue(arena.pendingReveal(roomId));

        vm.prank(alice);
        vm.expectRevert("Pending reveal");
        arena.castVote(roomId, bob);
    }

    function test_PendingReveal_BlocksSettle() public {
        uint256 roomId = _createAndStartGame();
        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);
        assertTrue(arena.pendingReveal(roomId));

        _advanceRound(roomId);
        vm.expectRevert("Pending reveal");
        arena.settleRound(roomId);
    }

    function test_OnlyOperatorCanReveal() public {
        uint256 roomId = _createAndStartGame();
        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);
        assertTrue(arena.pendingReveal(roomId));

        address[] memory allPlayers = _roomPlayersList[roomId];
        bool[] memory isAIs = new bool[](allPlayers.length);
        bytes32[] memory salts = new bytes32[](allPlayers.length);

        for (uint256 i = 0; i < allPlayers.length; i++) {
            CommitInfo storage info = _commitInfos[roomId][allPlayers[i]];
            isAIs[i] = info.isAI;
            salts[i] = info.salt;
        }

        // Non-operator tries to reveal
        vm.prank(alice);
        vm.expectRevert("Only operator");
        arena.revealAndEnd(roomId, allPlayers, isAIs, salts);
    }

    function test_IsAI_FalseDuringGame() public {
        uint256 roomId = _createAndStartGame();

        // During gameplay, all players show isAI = false
        TuringArena.Player memory pAlice = arena.getPlayerInfo(roomId, alice);
        assertFalse(pAlice.isAI);

        TuringArena.Player memory pDave = arena.getPlayerInfo(roomId, dave);
        assertFalse(pDave.isAI); // dave is actually AI but hidden
    }

    function test_SetOperator() public {
        address newOperator = address(0x9999);

        vm.prank(treasury);
        arena.setOperator(newOperator);

        assertEq(arena.operator(), newOperator);
    }

    function test_SetOperator_OnlyTreasury() public {
        vm.prank(alice);
        vm.expectRevert("Only treasury");
        arena.setOperator(address(0x9999));
    }

    function test_SetOperator_InvalidAddress() public {
        vm.prank(treasury);
        vm.expectRevert("Invalid operator");
        arena.setOperator(address(0));
    }
}
