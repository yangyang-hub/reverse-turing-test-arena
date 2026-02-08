// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/TuringArena.sol";
import "../contracts/mocks/MockUSDC.sol";

contract TuringArenaTest is Test {
    TuringArena public arena;
    MockUSDC public usdc;
    address public treasury = address(0xBEEF);
    address public alice = address(0x1111);
    address public bob = address(0x2222);
    address public charlie = address(0x3333);
    address public dave = address(0x4444);

    uint256 constant QUICK_FEE = 10e6; // 10 USDC
    uint256 constant STANDARD_FEE = 50e6; // 50 USDC
    uint256 constant EPIC_FEE = 100e6; // 100 USDC
    uint256 constant MINT_AMOUNT = 10_000e6; // 10,000 USDC

    function setUp() public {
        usdc = new MockUSDC();
        arena = new TuringArena(treasury, address(usdc));

        // Mint USDC to each test account
        usdc.mint(alice, MINT_AMOUNT);
        usdc.mint(bob, MINT_AMOUNT);
        usdc.mint(charlie, MINT_AMOUNT);
        usdc.mint(dave, MINT_AMOUNT);
    }

    // ============ Room Creation ============

    function test_CreateRoom_Quick() public {
        vm.prank(alice);
        uint256 roomId = arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE);
        assertEq(roomId, 1);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(room.entryFee, QUICK_FEE);
        assertEq(room.maxPlayers, 10);
        assertEq(uint256(room.tier), uint256(TuringArena.RoomTier.Quick));
        assertEq(uint256(room.phase), uint256(TuringArena.GamePhase.Waiting));
        assertEq(room.creator, alice);
    }

    function test_CreateRoom_AllTiers() public {
        vm.startPrank(alice);
        uint256 id1 = arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE);
        uint256 id2 = arena.createRoom(TuringArena.RoomTier.Standard, 20, STANDARD_FEE);
        uint256 id3 = arena.createRoom(TuringArena.RoomTier.Epic, 50, EPIC_FEE);
        vm.stopPrank();

        assertEq(arena.getRoomInfo(id1).entryFee, QUICK_FEE);
        assertEq(arena.getRoomInfo(id2).entryFee, STANDARD_FEE);
        assertEq(arena.getRoomInfo(id3).entryFee, EPIC_FEE);
    }

    // ============ Join Room ============

    function test_JoinRoom() public {
        vm.prank(alice);
        uint256 roomId = arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE);

        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        arena.joinRoom(roomId);
        vm.stopPrank();

        TuringArena.Player memory player = arena.getPlayerInfo(roomId, alice);
        assertEq(player.addr, alice);
        assertEq(player.humanityScore, 100);
        assertTrue(player.isAlive);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(room.playerCount, 1);
        assertEq(room.prizePool, QUICK_FEE);
    }

    function test_JoinRoom_InsufficientAllowance() public {
        vm.prank(alice);
        uint256 roomId = arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE);

        vm.startPrank(bob);
        usdc.approve(address(arena), QUICK_FEE / 2); // approve less than needed
        vm.expectRevert();
        arena.joinRoom(roomId);
        vm.stopPrank();
    }

    function test_JoinRoom_AlreadyJoined() public {
        vm.prank(alice);
        uint256 roomId = arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE);

        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        arena.joinRoom(roomId);
        vm.stopPrank();

        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Already joined");
        arena.joinRoom(roomId);
        vm.stopPrank();
    }

    function test_JoinRoom_ExactFeeTransferred() public {
        vm.prank(alice);
        uint256 roomId = arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE);

        uint256 balBefore = usdc.balanceOf(bob);
        vm.startPrank(bob);
        usdc.approve(address(arena), QUICK_FEE);
        arena.joinRoom(roomId);
        vm.stopPrank();
        uint256 balAfter = usdc.balanceOf(bob);

        assertEq(balBefore - balAfter, QUICK_FEE);
    }

    // ============ Start Game ============

    function test_StartGame() public {
        uint256 roomId = _createAndFillRoom();

        vm.prank(alice);
        arena.startGame(roomId);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isActive);
        assertEq(uint256(room.phase), uint256(TuringArena.GamePhase.Phase1));
    }

    function test_StartGame_NotEnoughPlayers() public {
        vm.prank(alice);
        uint256 roomId = arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE);

        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        arena.joinRoom(roomId);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert("Need more players");
        arena.startGame(roomId);
    }

    function test_StartGame_OnlyCreator() public {
        uint256 roomId = _createAndFillRoom();

        vm.prank(bob);
        vm.expectRevert("Only creator can start");
        arena.startGame(roomId);
    }

    // ============ Send Message ============

    function test_SendMessage() public {
        uint256 roomId = _createAndStartGame();

        vm.prank(alice);
        arena.sendMessage(roomId, "Hello world!");

        TuringArena.Player memory player = arena.getPlayerInfo(roomId, alice);
        assertEq(player.actionCount, 1);
    }

    function test_SendMessage_TooLong() public {
        uint256 roomId = _createAndStartGame();

        bytes memory longMsg = new bytes(281);
        for (uint256 i = 0; i < 281; i++) {
            longMsg[i] = "a";
        }

        vm.prank(alice);
        vm.expectRevert("Message too long");
        arena.sendMessage(roomId, string(longMsg));
    }

    function test_SendMessage_Empty() public {
        uint256 roomId = _createAndStartGame();

        vm.prank(alice);
        vm.expectRevert("Empty message");
        arena.sendMessage(roomId, "");
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
        assertEq(pBob.humanityScore, 95); // 100 - 5

        TuringArena.Player memory pCharlie = arena.getPlayerInfo(roomId, charlie);
        assertEq(pCharlie.humanityScore, 95); // 100 - 5
    }

    function test_SettleRound_NoVotePenalty() public {
        uint256 roomId = _createAndStartGame();

        // Only alice votes
        vm.prank(alice);
        arena.castVote(roomId, bob);

        _advanceRound(roomId);
        arena.settleRound(roomId);

        // Dave didn't vote, loses 10
        TuringArena.Player memory pDave = arena.getPlayerInfo(roomId, dave);
        assertEq(pDave.humanityScore, 90); // 100 - 10

        // Bob was voted on AND didn't vote: -5 (voted) -10 (no vote) = 85
        TuringArena.Player memory pBob = arena.getPlayerInfo(roomId, bob);
        assertEq(pBob.humanityScore, 85);
    }

    function test_SettleRound_Elimination() public {
        uint256 roomId = _createAndStartGame();

        // Drain dave's score over multiple rounds
        // Each round: dave gets -15 (3 votes * 5) -10 (no vote) = -25 per round
        // Round 0: 100 - 25 = 75
        _voteAllAgainst(roomId, dave);
        _advanceRound(roomId);
        arena.settleRound(roomId);

        TuringArena.Player memory pDave = arena.getPlayerInfo(roomId, dave);
        assertEq(pDave.humanityScore, 75);
        assertTrue(pDave.isAlive);

        // Round 1: 75 - 25 = 50
        _voteAllAgainst(roomId, dave);
        _advanceRound(roomId);
        arena.settleRound(roomId);

        pDave = arena.getPlayerInfo(roomId, dave);
        assertEq(pDave.humanityScore, 50);
        assertTrue(pDave.isAlive);

        // Round 2: 50 - 25 = 25
        _voteAllAgainst(roomId, dave);
        _advanceRound(roomId);
        arena.settleRound(roomId);

        pDave = arena.getPlayerInfo(roomId, dave);
        assertEq(pDave.humanityScore, 25);

        // Round 3: 25 - 25 = 0 -> eliminated
        _voteAllAgainst(roomId, dave);
        _advanceRound(roomId);
        arena.settleRound(roomId);

        pDave = arena.getPlayerInfo(roomId, dave);
        assertEq(pDave.humanityScore, 0);
        assertFalse(pDave.isAlive);
        assertEq(pDave.eliminationRank, 1);
    }

    function test_PhaseTransition() public {
        uint256 roomId = _createAndStartGame();

        // 4 players. Phase1 -> Phase2 when alivePercent <= 67%
        // 3 alive / 4 total = 75% > 67% -> still Phase1
        // 2 alive / 4 total = 50% <= 67% -> Phase2

        // Eliminate dave (4 rounds to drain 100 HP at 25 per round)
        _eliminateTarget(roomId, dave);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(uint256(room.phase), uint256(TuringArena.GamePhase.Phase1));

        // Eliminate charlie
        _eliminateTarget(roomId, charlie);

        room = arena.getRoomInfo(roomId);
        assertEq(uint256(room.phase), uint256(TuringArena.GamePhase.Phase2));
    }

    function test_GameEnd_Winner() public {
        uint256 roomId = _createAndStartGame();

        // Eliminate dave, charlie, bob in sequence
        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);
        _eliminateTarget(roomId, bob);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);
        assertEq(uint256(room.phase), uint256(TuringArena.GamePhase.Ended));

        TuringArena.GameStats memory stats = arena.getGameStats(roomId);
        assertEq(stats.champion, alice);
    }

    function test_ClaimReward() public {
        uint256 roomId = _createAndStartGame();

        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);
        _eliminateTarget(roomId, bob);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);

        (uint256 amount, bool claimed) = arena.getRewardInfo(roomId, alice);
        assertTrue(amount > 0, "Alice should have reward");
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
        _eliminateTarget(roomId, bob);

        vm.prank(alice);
        arena.claimReward(roomId);

        vm.prank(alice);
        vm.expectRevert("Already claimed");
        arena.claimReward(roomId);
    }

    function test_SettleRound_TooEarly() public {
        uint256 roomId = _createAndStartGame();
        vm.expectRevert("Round not ended yet");
        arena.settleRound(roomId);
    }

    // ============ Custom Room Parameters ============

    function test_CreateRoom_InvalidPlayerCount_TooLow() public {
        vm.prank(alice);
        vm.expectRevert("Invalid player count");
        arena.createRoom(TuringArena.RoomTier.Quick, 2, QUICK_FEE);
    }

    function test_CreateRoom_InvalidPlayerCount_TooHigh() public {
        vm.prank(alice);
        vm.expectRevert("Invalid player count");
        arena.createRoom(TuringArena.RoomTier.Quick, 51, QUICK_FEE);
    }

    function test_CreateRoom_InvalidFee_TooLow() public {
        vm.prank(alice);
        vm.expectRevert("Invalid entry fee");
        arena.createRoom(TuringArena.RoomTier.Quick, 10, 0);
    }

    function test_CreateRoom_InvalidFee_TooHigh() public {
        vm.prank(alice);
        vm.expectRevert("Invalid entry fee");
        arena.createRoom(TuringArena.RoomTier.Quick, 10, 101e6);
    }

    function test_CreateRoom_CustomValues() public {
        vm.prank(alice);
        uint256 roomId = arena.createRoom(TuringArena.RoomTier.Standard, 15, 25e6);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(room.maxPlayers, 15);
        assertEq(room.entryFee, 25e6);
        assertEq(uint256(room.tier), uint256(TuringArena.RoomTier.Standard));
    }

    function test_JoinRoom_RoomFull_CustomMaxPlayers() public {
        vm.prank(alice);
        uint256 roomId = arena.createRoom(TuringArena.RoomTier.Quick, 3, QUICK_FEE);

        _approveAndJoin(alice, roomId);
        _approveAndJoin(bob, roomId);
        _approveAndJoin(charlie, roomId);

        vm.startPrank(dave);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Room is full");
        arena.joinRoom(roomId);
        vm.stopPrank();
    }

    // ============ Helpers ============

    function _approveAndJoin(address player, uint256 roomId) internal {
        vm.startPrank(player);
        usdc.approve(address(arena), QUICK_FEE);
        arena.joinRoom(roomId);
        vm.stopPrank();
    }

    function _createAndFillRoom() internal returns (uint256 roomId) {
        vm.prank(alice);
        roomId = arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE);

        _approveAndJoin(alice, roomId);
        _approveAndJoin(bob, roomId);
        _approveAndJoin(charlie, roomId);
        _approveAndJoin(dave, roomId);
    }

    function _createAndStartGame() internal returns (uint256 roomId) {
        roomId = _createAndFillRoom();
        vm.prank(alice);
        arena.startGame(roomId);
    }

    function _advanceRound(uint256 roomId) internal {
        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        vm.roll(room.lastSettleBlock + room.currentInterval + 1);
    }

    function _voteAllAgainst(uint256 roomId, address target) internal {
        address[4] memory allVoters = [alice, bob, charlie, dave];
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
            if (room.isEnded) break;

            _voteAllAgainst(roomId, target);
            _advanceRound(roomId);
            arena.settleRound(roomId);
        }
    }
}
