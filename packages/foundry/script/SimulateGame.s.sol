// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import "../contracts/TuringArena.sol";
import "../contracts/mocks/MockUSDC.sol";

/**
 * @title SimulateGame
 * @notice Simulates a complete 4-player Quick-tier game on Anvil for frontend testing.
 *
 * Usage:
 *   1. yarn chain          (start Anvil)
 *   2. yarn deploy          (deploy TuringArena + MockUSDC)
 *   3. yarn start           (start frontend)
 *   4. cd packages/foundry && forge script script/SimulateGame.s.sol \
 *        --rpc-url http://127.0.0.1:8545 --broadcast -vvv
 *   5. Refresh the frontend to see the game state
 *
 * Anvil default accounts (index 0 is deployer/treasury):
 *   1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
 *   2: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
 *   3: 0x90F79bf6EB2c4f870365E785982E1f101E93b906
 *   4: 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65
 */
contract SimulateGame is Script {
    // Anvil default private keys (accounts 1-4)
    uint256 constant PK1 = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant PK2 = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    uint256 constant PK3 = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;
    uint256 constant PK4 = 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a;

    address constant PLAYER1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant PLAYER2 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address constant PLAYER3 = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
    address constant PLAYER4 = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65;

    TuringArena arena;
    MockUSDC usdc;
    uint256 roomId;

    function run() external {
        // Read deployed arena address from broadcast file
        string memory root = vm.projectRoot();
        string memory broadcastPath =
            string.concat(root, "/broadcast/Deploy.s.sol/31337/run-latest.json");
        string memory json = vm.readFile(broadcastPath);
        address arenaAddr = vm.parseJsonAddress(json, ".transactions[0].contractAddress");
        require(arenaAddr != address(0), "TuringArena not found in broadcast");

        arena = TuringArena(payable(arenaAddr));

        // Read payment token address from the arena contract
        address usdcAddr = address(arena.paymentToken());
        usdc = MockUSDC(usdcAddr);

        console.log("=== RTTA Game Simulation ===");
        console.log("TuringArena:", arenaAddr);
        console.log("MockUSDC:", usdcAddr);
        console.log("Arena USDC balance:", usdc.balanceOf(arenaAddr));
        console.log("");

        _step1_createRoom();
        _step2_joinPlayers();
        _step3_startGame();
        _step4_playRounds();
        _step5_logResults();
    }


    // ========== Step 1: Create Room ==========

    function _step1_createRoom() internal {
        console.log("[Step 1] Creating Quick-tier room...");

        vm.startBroadcast(PK1);
        roomId = arena.createRoom(TuringArena.RoomTier.Quick, 10, 10e6);
        vm.stopBroadcast();

        console.log("  Room ID:", roomId);
        console.log("  Entry fee: 10 USDC");
        console.log("");
    }

    // ========== Step 2: Join Players ==========

    function _step2_joinPlayers() internal {
        console.log("[Step 2] Players joining room (approve + join)...");

        uint256 fee = 10e6; // 10 USDC

        vm.startBroadcast(PK1);
        usdc.approve(address(arena), fee);
        arena.joinRoom(roomId);
        vm.stopBroadcast();
        console.log("  Player 1 joined:", PLAYER1);

        vm.startBroadcast(PK2);
        usdc.approve(address(arena), fee);
        arena.joinRoom(roomId);
        vm.stopBroadcast();
        console.log("  Player 2 joined:", PLAYER2);

        vm.startBroadcast(PK3);
        usdc.approve(address(arena), fee);
        arena.joinRoom(roomId);
        vm.stopBroadcast();
        console.log("  Player 3 joined:", PLAYER3);

        vm.startBroadcast(PK4);
        usdc.approve(address(arena), fee);
        arena.joinRoom(roomId);
        vm.stopBroadcast();
        console.log("  Player 4 joined:", PLAYER4);

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        console.log("  Player count:", room.playerCount);
        console.log("  Prize pool:", room.prizePool, "USDC units");
        console.log("");
    }

    // ========== Step 3: Start Game ==========

    function _step3_startGame() internal {
        console.log("[Step 3] Starting game (creator = Player 1)...");

        vm.startBroadcast(PK1);
        arena.startGame(roomId);
        vm.stopBroadcast();

        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        console.log("  Phase:", uint256(room.phase));
        console.log("  Start block:", room.startBlock);
        console.log("  Base interval:", room.baseInterval);
        console.log("");
    }

    // ========== Step 4: Play Rounds ==========

    function _step4_playRounds() internal {
        console.log("[Step 4] Playing rounds...");
        console.log("");

        // Phase 1: Target Player 4 until eliminated
        _playRoundsTargeting(PLAYER4, "Phase1-TargetP4");

        // Target Player 3 now
        _playRoundsTargeting(PLAYER3, "Phase1-TargetP3");

        // Phase 2: Target Player 2
        _playRoundsTargeting(PLAYER2, "Phase2-TargetP2");

        // Game should end when only Player 1 remains
        console.log("");
    }

    function _playRoundsTargeting(address target, string memory label) internal {
        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        uint256 maxRounds = 25;

        for (uint256 r = 0; r < maxRounds; r++) {
            room = arena.getRoomInfo(roomId);
            if (room.isEnded) {
                console.log("  [%s] Game ended!", label);
                return;
            }

            // Check if target is already eliminated
            TuringArena.Player memory targetInfo = arena.getPlayerInfo(roomId, target);
            if (!targetInfo.isAlive) {
                console.log("  [%s] Target eliminated after %s rounds", label, r);
                return;
            }

            // Mine blocks to advance past round interval
            uint256 blocksNeeded = room.currentInterval + 1;
            _mineBlocks(blocksNeeded);

            // Send messages from alive players
            _sendMessagesIfAlive(r);

            // Cast votes: all alive players (except target) vote for target.
            // Target votes for a random other alive player.
            _castVotesAgainst(target);

            // Settle round
            vm.startBroadcast(PK1);
            arena.settleRound(roomId);
            vm.stopBroadcast();

            // Log status
            uint256 round = arena.currentRound(roomId);
            room = arena.getRoomInfo(roomId);
            targetInfo = arena.getPlayerInfo(roomId, target);
            console.log("  [%s] Round %s | Alive: %s", label, round - 1, room.aliveCount);
            console.log("    Phase: %s | Target HP: %s", uint256(room.phase), _signedToString(targetInfo.humanityScore));
        }
    }

    function _sendMessagesIfAlive(uint256 /* roundNum */) internal {
        string[4] memory msgs = [
            "I am definitely human. Trust me.",
            "That response was too fast... suspicious.",
            "Let's work together to find the AI.",
            "I think player 1 is acting weird."
        ];

        uint256[4] memory pks = [PK1, PK2, PK3, PK4];
        address[4] memory addrs = [PLAYER1, PLAYER2, PLAYER3, PLAYER4];

        for (uint256 i = 0; i < 4; i++) {
            TuringArena.Player memory p = arena.getPlayerInfo(roomId, addrs[i]);
            if (!p.isAlive) continue;

            vm.startBroadcast(pks[i]);
            arena.sendMessage(roomId, msgs[i]);
            vm.stopBroadcast();
        }
    }

    function _castVotesAgainst(address target) internal {
        uint256[4] memory pks = [PK1, PK2, PK3, PK4];
        address[4] memory addrs = [PLAYER1, PLAYER2, PLAYER3, PLAYER4];

        for (uint256 i = 0; i < 4; i++) {
            TuringArena.Player memory p = arena.getPlayerInfo(roomId, addrs[i]);
            if (!p.isAlive) continue;

            address voteFor;
            if (addrs[i] == target) {
                // Target votes for the first other alive player
                voteFor = _findOtherAlive(addrs[i], target);
                if (voteFor == address(0)) continue; // edge case
            } else {
                voteFor = target;
            }

            vm.startBroadcast(pks[i]);
            arena.castVote(roomId, voteFor);
            vm.stopBroadcast();
        }
    }

    function _findOtherAlive(address exclude1, address /* exclude2 */) internal view returns (address) {
        address[4] memory addrs = [PLAYER1, PLAYER2, PLAYER3, PLAYER4];
        for (uint256 i = 0; i < 4; i++) {
            if (addrs[i] == exclude1) continue;
            TuringArena.Player memory p = arena.getPlayerInfo(roomId, addrs[i]);
            if (p.isAlive) return addrs[i];
        }
        return address(0);
    }

    // ========== Step 5: Log Results ==========

    function _step5_logResults() internal view {
        TuringArena.Room memory room = arena.getRoomInfo(roomId);
        TuringArena.GameStats memory stats = arena.getGameStats(roomId);

        console.log("=== GAME RESULTS ===");
        console.log("Phase:", uint256(room.phase));
        console.log("Is Ended:", room.isEnded);
        console.log("Champion:", stats.champion);
        console.log("Prize Pool:", room.prizePool, "USDC units");
        console.log("");

        console.log("Top 5:");
        for (uint256 i = 0; i < stats.topFive.length; i++) {
            if (stats.topFive[i] != address(0)) {
                console.log("  #%s: %s", i + 1, stats.topFive[i]);
            }
        }
        console.log("");

        console.log("Achievements:");
        console.log("  Human Hunter:", stats.humanHunter);
        console.log("  Perfect Impostor:", stats.perfectImpostor);
        console.log("  Iron Will:", stats.ironWill);
        console.log("");

        // Rewards info
        console.log("Rewards:");
        address[4] memory addrs = [PLAYER1, PLAYER2, PLAYER3, PLAYER4];
        for (uint256 i = 0; i < 4; i++) {
            (uint256 amount, bool claimed) = arena.getRewardInfo(roomId, addrs[i]);
            if (amount > 0) {
                console.log("  Player %s: %s USDC units (claimed: %s)", i + 1, amount, claimed);
            }
        }

        // USDC balance
        console.log("");
        console.log("Arena USDC balance:", usdc.balanceOf(address(arena)));
    }

    // ========== Helpers ==========

    function _mineBlocks(uint256 count) internal {
        // Advance block number in simulation context
        vm.roll(block.number + count);
        // Also mine blocks on the actual Anvil node for broadcast
        string memory hexCount = _toHexString(count);
        string memory params = string.concat("[\"", hexCount, "\"]");
        vm.rpc("anvil_mine", params);
    }

    function _toHexString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0x0";

        uint256 temp = value;
        uint256 length = 0;
        while (temp > 0) {
            length++;
            temp >>= 4;
        }

        bytes memory buffer = new bytes(2 + length);
        buffer[0] = "0";
        buffer[1] = "x";

        for (uint256 i = 2 + length - 1; i >= 2; i--) {
            uint8 nibble = uint8(value & 0xf);
            buffer[i] = nibble < 10 ? bytes1(nibble + 48) : bytes1(nibble + 87);
            value >>= 4;
            if (i == 2) break;
        }

        return string(buffer);
    }

    function _signedToString(int256 value) internal pure returns (string memory) {
        if (value >= 0) {
            return _uintToString(uint256(value));
        } else {
            return string.concat("-", _uintToString(uint256(-value)));
        }
    }

    function _uintToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";

        uint256 temp = value;
        uint256 digits;
        while (temp > 0) {
            digits++;
            temp /= 10;
        }

        bytes memory buffer = new bytes(digits);
        while (value > 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }

        return string(buffer);
    }
}
