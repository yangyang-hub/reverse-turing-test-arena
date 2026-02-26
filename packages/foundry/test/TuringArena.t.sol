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

    uint256 constant QUICK_FEE = 10e6; // 10 USDC
    uint256 constant STANDARD_FEE = 50e6; // 50 USDC
    uint256 constant EPIC_FEE = 100e6; // 100 USDC
    uint256 constant MINT_AMOUNT = 10_000e6; // 10,000 USDC

    function setUp() public {
        usdc = new MockUSDC();
        arena = new TuringArena(treasury, address(usdc));

        usdc.mint(alice, MINT_AMOUNT);
        usdc.mint(bob, MINT_AMOUNT);
        usdc.mint(charlie, MINT_AMOUNT);
        usdc.mint(dave, MINT_AMOUNT);
        usdc.mint(eve, MINT_AMOUNT);
        usdc.mint(frank, MINT_AMOUNT);
    }

    // ============ Room Creation ============

    function test_CreateRoom_Quick() public {
        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        uint256 roomId = arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE, false, "Alice");
        vm.stopPrank();
        assertEq(roomId, 1);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(room.entryFee, QUICK_FEE);
        assertEq(room.maxPlayers, 10);
        assertEq(room.playerCount, 1);
        assertEq(room.prizePool, QUICK_FEE);
        assertEq(room.humanCount, 1);
        assertEq(room.aiCount, 0);
        assertEq(uint256(room.tier), uint256(TuringArena.RoomTier.Quick));
        assertEq(uint256(room.phase), uint256(TuringArena.GamePhase.Waiting));
        assertEq(room.creator, alice);

        TuringArena.Player memory player = arena.getPlayerInfo(roomId, alice);
        assertEq(player.addr, alice);
        assertEq(player.humanityScore, 100);
        assertTrue(player.isAlive);
        assertFalse(player.isAI);

        // Verify name stored
        assertEq(arena.getPlayerName(roomId, alice), "Alice");
    }

    function test_CreateRoom_AsAI() public {
        vm.startPrank(dave);
        usdc.approve(address(arena), QUICK_FEE);
        uint256 roomId = arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE, true, "DaveBot");
        vm.stopPrank();

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(room.humanCount, 0);
        assertEq(room.aiCount, 1);

        TuringArena.Player memory player = arena.getPlayerInfo(roomId, dave);
        assertTrue(player.isAI);
    }

    function test_CreateRoom_AllTiers() public {
        // Each tier created by a different address (players can only be in one room)
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
        assertFalse(player.isAI);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(room.playerCount, 2);
        assertEq(room.humanCount, 2);
        assertEq(room.aiCount, 0);
        assertEq(room.prizePool, QUICK_FEE * 2);
    }

    function test_JoinRoom_AI() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(dave, roomId, true);

        TuringArena.Player memory player = arena.getPlayerInfo(roomId, dave);
        assertTrue(player.isAI);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(room.humanCount, 1);
        assertEq(room.aiCount, 1);
    }

    function test_JoinRoom_AISlotLimit() public {
        // 10 players → max AI = 10 * 30 / 100 = 3
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);

        // Join 3 AIs (should succeed)
        _approveAndJoin(dave, roomId, true); // AI 1
        _approveAndJoin(eve, roomId, true); // AI 2
        _approveAndJoin(frank, roomId, true); // AI 3

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(room.aiCount, 3);

        // 4th AI should fail
        address extraAI = address(0x7777);
        usdc.mint(extraAI, MINT_AMOUNT);
        vm.startPrank(extraAI);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("AI slots full");
        arena.joinRoom(roomId, true, "ExtraAI");
        vm.stopPrank();
    }

    function test_JoinRoom_AISlotLimit_SmallRoom() public {
        // 3 players → aiSlots = max(1, 3*30/100) = max(1, 0) = 1, humanSlots = 2
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 3, QUICK_FEE, false);
        _approveAndJoin(dave, roomId, true); // fills the 1 AI slot

        // 2nd AI should fail
        vm.startPrank(bob);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("AI slots full");
        arena.joinRoom(roomId, true, "Bot2");
        vm.stopPrank();
    }

    function test_JoinRoom_HumanSlotLimit() public {
        // 3 players → humanSlots = 3 - 1 = 2, aiSlots = 1
        // Creator (alice) is human → humanCount=1
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 3, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false); // human 2/2

        // 3rd human should fail (human slots full)
        vm.startPrank(charlie);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Human slots full");
        arena.joinRoom(roomId, false, "Charlie");
        vm.stopPrank();
    }

    function test_JoinRoom_InsufficientAllowance() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);

        vm.startPrank(bob);
        usdc.approve(address(arena), QUICK_FEE / 2);
        vm.expectRevert();
        arena.joinRoom(roomId, false, "Bob");
        vm.stopPrank();
    }

    function test_JoinRoom_AlreadyJoined() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);

        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Already in a room");
        arena.joinRoom(roomId, false, "Alice2");
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
        // maxPlayers=3: humanSlots=2, aiSlots=1. Creator (alice) auto-joined as human (1/3)
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 3, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false); // human 2/3

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(uint256(room.phase), uint256(TuringArena.GamePhase.Waiting));
        assertFalse(room.isActive);

        _approveAndJoin(dave, roomId, true); // AI 3/3 → auto-start!

        room = arena.getRoomInfo(roomId);
        assertEq(uint256(room.phase), uint256(TuringArena.GamePhase.Active));
        assertTrue(room.isActive);
    }

    // ============ Start Game (manual) ============

    function test_StartGame() public {
        // Room auto-starts when full (via _createAndFillRoom)
        uint256 roomId = _createAndFillRoom();

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isActive);
        assertEq(uint256(room.phase), uint256(TuringArena.GamePhase.Active));
    }

    function test_StartGame_NotFull() public {
        // 10-player room with only 1 player → cannot start
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);

        vm.prank(alice);
        vm.expectRevert("Room not full");
        arena.startGame(roomId);
    }

    function test_StartGame_OnlyCreator() public {
        // Create a 4-player room, fill 3 slots (not full yet)
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 4, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false);
        _approveAndJoin(charlie, roomId, false);
        // 3/4 — not full, but still test creator-only restriction
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

    function test_SendMessage_RoundLimit() public {
        uint256 roomId = _createAndStartGame();

        vm.startPrank(alice);
        arena.sendMessage(roomId, "Message 1");
        arena.sendMessage(roomId, "Message 2");
        arena.sendMessage(roomId, "Message 3");

        vm.expectRevert("Message limit reached");
        arena.sendMessage(roomId, "Message 4");
        vm.stopPrank();

        assertEq(arena.getMessageCount(roomId, 0, alice), 3);
    }

    function test_SendMessage_LimitResetsPerRound() public {
        uint256 roomId = _createAndStartGame();

        // Use 3 messages in round 0
        vm.startPrank(alice);
        arena.sendMessage(roomId, "Msg 1");
        arena.sendMessage(roomId, "Msg 2");
        arena.sendMessage(roomId, "Msg 3");
        vm.stopPrank();

        // Settle round to advance to round 1
        _voteAllAgainst(roomId, dave);
        _advanceRound(roomId);
        arena.settleRound(roomId);

        // Should be able to send again in round 1
        TuringArena.Player memory pAlice = arena.getPlayerInfo(roomId, alice);
        if (pAlice.isAlive) {
            vm.prank(alice);
            arena.sendMessage(roomId, "New round msg");
            assertEq(arena.getMessageCount(roomId, 1, alice), 1);
        }
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

        // bob was voted by alice: -10. Also self-vote since dave didn't vote does NOT affect bob
        // dave didn't vote → self-vote -10
        TuringArena.Player memory pBob = arena.getPlayerInfo(roomId, bob);
        assertEq(pBob.humanityScore, 90); // 100 - 10 (from alice's vote)

        TuringArena.Player memory pCharlie = arena.getPlayerInfo(roomId, charlie);
        assertEq(pCharlie.humanityScore, 90); // 100 - 10 (from bob's vote)
    }

    function test_SettleRound_AutoSelfVote() public {
        uint256 roomId = _createAndStartGame();

        // Only alice votes
        vm.prank(alice);
        arena.castVote(roomId, bob);

        _advanceRound(roomId);
        arena.settleRound(roomId);

        // dave didn't vote: self-vote = -10 (not -20 like old NO_VOTE_PENALTY)
        TuringArena.Player memory pDave = arena.getPlayerInfo(roomId, dave);
        assertEq(pDave.humanityScore, 90); // 100 - 10 (self-vote)

        // bob was voted by alice AND didn't vote: -10 (from alice) -10 (self-vote) = 80
        TuringArena.Player memory pBob = arena.getPlayerInfo(roomId, bob);
        assertEq(pBob.humanityScore, 80); // 100 - 10 - 10
    }

    function test_SettleRound_Elimination() public {
        uint256 roomId = _createAndStartGame();

        // Each round: dave gets -30 (3 votes * 10) + -10 (self-vote) = -40 per round
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

        // Round 2: 20 - 40 = -20 → eliminated
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

    // ============ Team Win: Humans Win (all AIs eliminated) ============

    function test_TeamWin_HumansWin() public {
        // Setup: 3 humans (alice, bob, charlie) + 1 AI (dave)
        uint256 roomId = _createAndStartGame(); // alice=human, bob=human, charlie=human, dave=AI

        // Eliminate the AI (dave)
        _eliminateTarget(roomId, dave);

        // All AIs eliminated → humans win
        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);

        TuringArena.GameStats memory stats = arena.getGameStats(roomId);
        assertTrue(stats.humansWon);
    }

    function test_TeamWin_AIsWin() public {
        // Setup: 5 humans + 2 AIs = 7 players → aiSlots = 7*30/100 = 2, humanSlots = 5
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 7, QUICK_FEE, false); // human
        _approveAndJoin(bob, roomId, false); // human
        _approveAndJoin(charlie, roomId, false); // human
        _approveAndJoin(dave, roomId, true); // AI
        _approveAndJoin(eve, roomId, false); // human

        // Need 1 more human to fill humanSlots=5
        address gina = address(0x8888);
        usdc.mint(gina, MINT_AMOUNT);
        _approveAndJoin(gina, roomId, false); // human (5/5)

        _approveAndJoin(frank, roomId, true); // AI (2/2) → auto-start (7/7)

        // Eliminate all humans one by one
        _eliminateTarget(roomId, alice);
        _eliminateTarget(roomId, bob);
        _eliminateTarget(roomId, charlie);
        _eliminateTarget(roomId, eve);
        _eliminateTarget(roomId, gina);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);

        TuringArena.GameStats memory stats = arena.getGameStats(roomId);
        assertFalse(stats.humansWon); // AIs won
    }

    // ============ 2-Player Endgame ============

    function test_FinalTwo_HigherHPWins() public {
        uint256 roomId = _createAndStartGame();

        // Eliminate dave and charlie
        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);

        // Now alice and bob remain. After elimination rounds, alice should have higher HP
        // (because she votes for targets, not vice versa)
        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        if (!room.isEnded) {
            // Force the 2-player endgame — one more settle
            _voteAllAgainst(roomId, bob);
            _advanceRound(roomId);
            arena.settleRound(roomId);
        }

        room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);
    }

    function test_FinalTwo_AIWinsOnTie() public {
        // 4 players: alice (human), bob (human), charlie (human), dave (AI)
        uint256 roomId = _createAndFillRoom(); // auto-starts (4/4)

        // Eliminate bob and charlie first → leaves alice vs dave
        _eliminateTarget(roomId, bob);
        _eliminateTarget(roomId, charlie);

        // After charlie eliminated, alice and dave remain → triggers _resolveFinalTwo
        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);

        // The game resolved with team-aware logic
        TuringArena.GameStats memory stats = arena.getGameStats(roomId);
        assertTrue(room.isEnded);

        // dave (AI) was never the sole target (all voted together each round)
        // In _resolveFinalTwo, tie → AI wins
        assertFalse(stats.humansWon); // AIs won
    }

    // ============ Reward Distribution ============

    function test_RewardDistribution() public {
        uint256 roomId = _createAndStartGame();

        // Eliminate dave (AI), then charlie, then bob → alice wins (last human)
        _eliminateTarget(roomId, dave);
        _eliminateTarget(roomId, charlie);
        _eliminateTarget(roomId, bob);

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
        _eliminateTarget(roomId, bob);

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
        _eliminateTarget(roomId, bob);

        vm.prank(alice);
        arena.claimReward(roomId);

        vm.prank(alice);
        vm.expectRevert("Already claimed");
        arena.claimReward(roomId);
    }

    // ============ Custom Room Parameters ============

    function test_CreateRoom_InvalidPlayerCount_TooLow() public {
        vm.prank(alice);
        vm.expectRevert("Invalid player count");
        arena.createRoom(TuringArena.RoomTier.Quick, 2, QUICK_FEE, false, "A");
    }

    function test_CreateRoom_InvalidPlayerCount_TooHigh() public {
        vm.prank(alice);
        vm.expectRevert("Invalid player count");
        arena.createRoom(TuringArena.RoomTier.Quick, 51, QUICK_FEE, false, "A");
    }

    function test_CreateRoom_InvalidFee_TooLow() public {
        vm.prank(alice);
        vm.expectRevert("Invalid entry fee");
        arena.createRoom(TuringArena.RoomTier.Quick, 10, 0, false, "A");
    }

    function test_CreateRoom_InvalidFee_TooHigh() public {
        vm.prank(alice);
        vm.expectRevert("Invalid entry fee");
        arena.createRoom(TuringArena.RoomTier.Quick, 10, 101e6, false, "A");
    }

    function test_CreateRoom_CustomValues() public {
        vm.startPrank(alice);
        usdc.approve(address(arena), 25e6);
        uint256 roomId = arena.createRoom(TuringArena.RoomTier.Standard, 15, 25e6, false, "Alice");
        vm.stopPrank();

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(room.maxPlayers, 15);
        assertEq(room.entryFee, 25e6);
        assertEq(room.playerCount, 1);
        assertEq(room.prizePool, 25e6);
        assertEq(uint256(room.tier), uint256(TuringArena.RoomTier.Standard));
    }

    function test_JoinRoom_RoomFull_CustomMaxPlayers() public {
        // 3-player room: 2 humans + 1 AI → auto-starts
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 3, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false);
        _approveAndJoin(dave, roomId, true); // 3/3 → auto-start

        vm.startPrank(eve);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Game already started");
        arena.joinRoom(roomId, false, "Eve");
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
        assertEq(roomAfter.humanCount, 1);
        assertEq(roomAfter.prizePool, QUICK_FEE);

        TuringArena.Player memory pBob = arena.getPlayerInfo(roomId, bob);
        assertEq(pBob.addr, address(0));
    }

    function test_LeaveRoom_AI_UpdatesCounts() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(dave, roomId, true);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertEq(room.humanCount, 1);
        assertEq(room.aiCount, 1);

        vm.prank(dave);
        arena.leaveRoom(roomId);

        room = arena.getRoomInfo(roomId);
        assertEq(room.humanCount, 1);
        assertEq(room.aiCount, 0);
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

        // All vote alice → alice: 100 - 30 - 10(self-vote)
        // everyone else: 100 - 10(self-vote since they voted for alice, they DID vote so no self-vote)
        // Actually: alice votes bob, bob/charlie/dave vote alice
        vm.prank(alice);
        arena.castVote(roomId, bob);
        vm.prank(bob);
        arena.castVote(roomId, alice);
        vm.prank(charlie);
        arena.castVote(roomId, alice);

        // dave doesn't vote → self-vote -10
        _advanceRound(roomId);
        arena.settleRound(roomId);

        // alice: 100 - 10(bob) - 10(charlie) = 80
        // bob: 100 - 10(alice) = 90
        // charlie: 100 (no one voted charlie)
        // dave: 100 - 10(self-vote) = 90
        TuringArena.Player memory pAlice = arena.getPlayerInfo(roomId, alice);
        assertEq(pAlice.humanityScore, 80);

        TuringArena.Player memory pBob = arena.getPlayerInfo(roomId, bob);
        assertEq(pBob.humanityScore, 90);

        TuringArena.Player memory pCharlie = arena.getPlayerInfo(roomId, charlie);
        assertEq(pCharlie.humanityScore, 100);

        TuringArena.Player memory pDave = arena.getPlayerInfo(roomId, dave);
        assertEq(pDave.humanityScore, 90);

        // No extra decay was applied — only vote damage
    }

    // ============ Multi-Room Restriction ============

    function test_JoinRoom_AlreadyInAnotherRoom() public {
        uint256 room1 = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(bob, room1, false);

        // Bob is in room1, tries to join room2 → revert
        uint256 room2 = _createRoom(charlie, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        vm.startPrank(bob);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Already in a room");
        arena.joinRoom(room2, false, "Bob");
        vm.stopPrank();
    }

    function test_CreateRoom_AlreadyInRoom() public {
        uint256 room1 = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);

        // Alice is already in room1 (creator), tries to create room2 → revert
        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Already in a room");
        arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE, false, "Alice2");
        vm.stopPrank();

        // Verify playerActiveRoom
        assertEq(arena.playerActiveRoom(alice), room1);
    }

    function test_LeaveRoom_ThenJoinAnother() public {
        uint256 room1 = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(bob, room1, false);

        // Bob is in room1, verify activeRoom
        assertEq(arena.playerActiveRoom(bob), room1);

        // Bob leaves room1
        vm.prank(bob);
        arena.leaveRoom(room1);
        assertEq(arena.playerActiveRoom(bob), 0);

        // Bob can now join room2
        uint256 room2 = _createRoom(charlie, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(bob, room2, false);
        assertEq(arena.playerActiveRoom(bob), room2);
    }

    function test_GameEnd_ClearsActiveRoom() public {
        uint256 roomId = _createAndStartGame();

        // All players should have activeRoom set
        assertEq(arena.playerActiveRoom(alice), roomId);
        assertEq(arena.playerActiveRoom(bob), roomId);
        assertEq(arena.playerActiveRoom(charlie), roomId);
        assertEq(arena.playerActiveRoom(dave), roomId);

        // Eliminate dave (AI) → humans win → game ends
        _eliminateTarget(roomId, dave);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);

        // All players should have activeRoom cleared
        assertEq(arena.playerActiveRoom(alice), 0);
        assertEq(arena.playerActiveRoom(bob), 0);
        assertEq(arena.playerActiveRoom(charlie), 0);
        assertEq(arena.playerActiveRoom(dave), 0);

        // Alice can now join a new room
        uint256 room2 = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        assertEq(arena.playerActiveRoom(alice), room2);
    }

    function test_CancelRoom_ClearsActiveRoom() public {
        uint256 roomId = _createRoom(alice, TuringArena.RoomTier.Quick, 10, QUICK_FEE, false);
        _approveAndJoin(bob, roomId, false);

        assertEq(arena.playerActiveRoom(alice), roomId);
        assertEq(arena.playerActiveRoom(bob), roomId);

        // Creator cancels room
        vm.prank(alice);
        arena.leaveRoom(roomId);

        // Both players should have activeRoom cleared
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
        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Invalid name length");
        arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE, false, "ThisNameIsWayTooLongX");
        vm.stopPrank();
    }

    function test_PlayerName_Empty() public {
        vm.startPrank(alice);
        usdc.approve(address(arena), QUICK_FEE);
        vm.expectRevert("Invalid name length");
        arena.createRoom(TuringArena.RoomTier.Quick, 10, QUICK_FEE, false, "");
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

        // Name cleared after leaving
        assertEq(bytes(arena.getPlayerName(roomId, bob)).length, 0);
    }

    function test_PlayerName_PreservedAfterGameEnd() public {
        uint256 roomId = _createAndFillRoom();

        // Game auto-started, names should be set
        assertEq(arena.getPlayerName(roomId, alice), "Creator");
        assertEq(arena.getPlayerName(roomId, dave), "Player");

        // End the game
        _eliminateTarget(roomId, dave);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        assertTrue(room.isEnded);

        // Names still readable after game ends
        assertEq(arena.getPlayerName(roomId, alice), "Creator");
        assertEq(arena.getPlayerName(roomId, dave), "Player");
    }

    // ============ Helpers ============

    function _createRoom(
        address creator,
        TuringArena.RoomTier tier,
        uint256 maxPlayers,
        uint256 entryFee,
        bool isAI
    ) internal returns (uint256 roomId) {
        vm.startPrank(creator);
        usdc.approve(address(arena), entryFee);
        roomId = arena.createRoom(tier, maxPlayers, entryFee, isAI, "Creator");
        vm.stopPrank();
    }

    function _approveAndJoin(address player, uint256 roomId, bool isAI) internal {
        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        vm.startPrank(player);
        usdc.approve(address(arena), room.entryFee);
        arena.joinRoom(roomId, isAI, "Player");
        vm.stopPrank();
    }

    function _approveAndJoin(address player, uint256 roomId, bool isAI, string memory name) internal {
        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        vm.startPrank(player);
        usdc.approve(address(arena), room.entryFee);
        arena.joinRoom(roomId, isAI, name);
        vm.stopPrank();
    }

    /// @dev Creates a room with 4 players: alice, bob, charlie (humans) + dave (AI)
    /// maxPlayers=4 → aiSlots=1, humanSlots=3 → auto-starts when all 4 join
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
            if (room.isEnded) break;

            _voteAllAgainst(roomId, target);
            _advanceRound(roomId);
            arena.settleRound(roomId);
        }
    }
}
