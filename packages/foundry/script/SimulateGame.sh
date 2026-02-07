#!/bin/bash
# SimulateGame.sh — Simulates a complete 4-player Quick-tier game on Anvil
#
# Usage:
#   1. yarn chain          (start Anvil)
#   2. yarn deploy          (deploy TuringArena)
#   3. cd packages/foundry && bash script/SimulateGame.sh
#   4. yarn start           (start frontend and observe the game)
#
set -e

RPC_URL="http://127.0.0.1:8545"

# Anvil default private keys (accounts 1-4, account 0 is deployer)
PK1="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
PK2="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
PK3="0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
PK4="0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"

PLAYER1="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
PLAYER2="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
PLAYER3="0x90F79bf6EB2c4f870365E785982E1f101E93b906"
PLAYER4="0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"

FEE="0.01ether"

# --- Find deployed TuringArena address from broadcast ---
BROADCAST_FILE="broadcast/Deploy.s.sol/31337/run-latest.json"
if [ ! -f "$BROADCAST_FILE" ]; then
    echo "ERROR: Broadcast file not found. Run 'yarn deploy' first."
    exit 1
fi

ARENA=$(python3 -c "
import json
with open('$BROADCAST_FILE') as f:
    data = json.load(f)
for tx in data['transactions']:
    if tx.get('contractName') == 'TuringArena':
        print(tx['contractAddress'])
        break
")

if [ -z "$ARENA" ]; then
    echo "ERROR: TuringArena address not found in broadcast."
    exit 1
fi

echo "=== RTTA Game Simulation ==="
echo "TuringArena: $ARENA"
echo ""

# Helper: send a transaction
send_tx() {
    local pk=$1
    local sig=$2
    local value=${3:-"0"}
    cast send --rpc-url "$RPC_URL" --private-key "$pk" "$ARENA" "$sig" --value "$value" > /dev/null 2>&1
}

# Helper: call a read function
call_fn() {
    cast call --rpc-url "$RPC_URL" "$ARENA" "$1"
}

# Helper: mine blocks
mine_blocks() {
    local count=$1
    local hex=$(printf "0x%x" "$count")
    cast rpc --rpc-url "$RPC_URL" anvil_mine "$hex" > /dev/null 2>&1
}

# Helper: get player HP
get_hp() {
    local room_id=$1
    local player=$2
    # getPlayerInfo returns a tuple, humanityScore is the 2nd field (int256)
    local result=$(cast call --rpc-url "$RPC_URL" "$ARENA" "getPlayerInfo(uint256,address)(address,int256,bool,bool,uint256,uint256,uint256,uint256,uint256,uint256)" "$room_id" "$player" 2>/dev/null)
    echo "$result" | sed -n '2p'
}

# Helper: get room info fields
get_phase() {
    local room_id=$1
    local result=$(cast call --rpc-url "$RPC_URL" "$ARENA" "getRoomInfo(uint256)" "$room_id" 2>/dev/null)
    # phase is the 4th field in the Room struct (0-indexed: id, creator, tier, phase, ...)
    # Using a simpler approach: read the phase directly
    cast call --rpc-url "$RPC_URL" "$ARENA" "getRoomInfo(uint256)(uint256,address,uint8,uint8,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256,uint256,bool,bool)" "$room_id" 2>/dev/null | sed -n '4p'
}

get_alive_count() {
    local room_id=$1
    cast call --rpc-url "$RPC_URL" "$ARENA" "getRoomInfo(uint256)(uint256,address,uint8,uint8,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256,uint256,bool,bool)" "$room_id" 2>/dev/null | sed -n '12p'
}

get_current_interval() {
    local room_id=$1
    cast call --rpc-url "$RPC_URL" "$ARENA" "getRoomInfo(uint256)(uint256,address,uint8,uint8,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256,uint256,bool,bool)" "$room_id" 2>/dev/null | sed -n '10p'
}

is_ended() {
    local room_id=$1
    cast call --rpc-url "$RPC_URL" "$ARENA" "getRoomInfo(uint256)(uint256,address,uint8,uint8,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256,uint256,bool,bool)" "$room_id" 2>/dev/null | sed -n '17p'
}

is_alive() {
    local room_id=$1
    local player=$2
    local result=$(cast call --rpc-url "$RPC_URL" "$ARENA" "getPlayerInfo(uint256,address)(address,int256,bool,bool,uint256,uint256,uint256,uint256,uint256,uint256)" "$room_id" "$player" 2>/dev/null)
    echo "$result" | sed -n '3p'
}

# ========== Step 1: Create Room ==========
echo "[Step 1] Creating Quick-tier room..."
ROOM_ID=$(cast send --rpc-url "$RPC_URL" --private-key "$PK1" "$ARENA" "createRoom(uint8)" 0 --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
# Parse RoomCreated event (first log topic[1] = roomId)
if data.get('logs'):
    room_id = int(data['logs'][0]['topics'][1], 16)
    print(room_id)
else:
    # Fallback: get from contract
    import subprocess
    result = subprocess.check_output(['cast', 'call', '--rpc-url', '$RPC_URL', '$ARENA', 'getRoomCount()(uint256)'], text=True).strip()
    print(result)
")

echo "  Room ID: $ROOM_ID"
echo "  Entry fee: 0.01 ETH"
echo ""

# ========== Step 2: Join Players ==========
echo "[Step 2] Players joining room..."
cast send --rpc-url "$RPC_URL" --private-key "$PK1" "$ARENA" "joinRoom(uint256)" "$ROOM_ID" --value "$FEE" > /dev/null 2>&1
echo "  Player 1 joined: $PLAYER1"

cast send --rpc-url "$RPC_URL" --private-key "$PK2" "$ARENA" "joinRoom(uint256)" "$ROOM_ID" --value "$FEE" > /dev/null 2>&1
echo "  Player 2 joined: $PLAYER2"

cast send --rpc-url "$RPC_URL" --private-key "$PK3" "$ARENA" "joinRoom(uint256)" "$ROOM_ID" --value "$FEE" > /dev/null 2>&1
echo "  Player 3 joined: $PLAYER3"

cast send --rpc-url "$RPC_URL" --private-key "$PK4" "$ARENA" "joinRoom(uint256)" "$ROOM_ID" --value "$FEE" > /dev/null 2>&1
echo "  Player 4 joined: $PLAYER4"
echo ""

# ========== Step 3: Start Game ==========
echo "[Step 3] Starting game..."
cast send --rpc-url "$RPC_URL" --private-key "$PK1" "$ARENA" "startGame(uint256)" "$ROOM_ID" > /dev/null 2>&1
echo "  Game started!"
echo ""

# ========== Step 4: Play Rounds ==========
echo "[Step 4] Playing rounds..."
echo ""

PLAYERS=("$PLAYER1" "$PLAYER2" "$PLAYER3" "$PLAYER4")
PKS=("$PK1" "$PK2" "$PK3" "$PK4")
MESSAGES=("I am definitely human." "That response was suspicious." "Lets find the AI." "Player 1 is acting weird.")

# Round function: target a specific player, all others vote against them
play_round() {
    local target=$1
    local label=$2
    local round_num=$3

    # Get current interval and mine enough blocks
    local interval=$(get_current_interval "$ROOM_ID")
    interval=$(echo "$interval" | tr -d ' ')
    local blocks_needed=$((interval + 2))
    mine_blocks "$blocks_needed"

    # Send messages from alive players
    for i in 0 1 2 3; do
        local alive=$(is_alive "$ROOM_ID" "${PLAYERS[$i]}")
        if [[ "$alive" == *"true"* ]]; then
            cast send --rpc-url "$RPC_URL" --private-key "${PKS[$i]}" "$ARENA" \
                "sendMessage(uint256,string)" "$ROOM_ID" "${MESSAGES[$i]}" > /dev/null 2>&1 || true
        fi
    done

    # Cast votes: everyone votes for target, target votes for first other alive
    local target_vote=""
    for i in 0 1 2 3; do
        local alive=$(is_alive "$ROOM_ID" "${PLAYERS[$i]}")
        if [[ "$alive" != *"true"* ]]; then continue; fi

        if [ "${PLAYERS[$i]}" = "$target" ]; then
            # Target votes for first other alive player
            for j in 0 1 2 3; do
                if [ "${PLAYERS[$j]}" = "$target" ]; then continue; fi
                local other_alive=$(is_alive "$ROOM_ID" "${PLAYERS[$j]}")
                if [[ "$other_alive" == *"true"* ]]; then
                    target_vote="${PLAYERS[$j]}"
                    break
                fi
            done
            if [ -n "$target_vote" ]; then
                cast send --rpc-url "$RPC_URL" --private-key "${PKS[$i]}" "$ARENA" \
                    "castVote(uint256,address)" "$ROOM_ID" "$target_vote" > /dev/null 2>&1 || true
            fi
        else
            cast send --rpc-url "$RPC_URL" --private-key "${PKS[$i]}" "$ARENA" \
                "castVote(uint256,address)" "$ROOM_ID" "$target" > /dev/null 2>&1 || true
        fi
    done

    # Settle round
    cast send --rpc-url "$RPC_URL" --private-key "$PK1" "$ARENA" "settleRound(uint256)" "$ROOM_ID" > /dev/null 2>&1

    # Log status
    local alive_count=$(get_alive_count "$ROOM_ID")
    local phase=$(get_phase "$ROOM_ID")
    local hp=$(get_hp "$ROOM_ID" "$target")
    echo "  [$label] Round $round_num | Alive: $alive_count | Phase: $phase | Target HP: $hp"
}

# Target Player 4 until eliminated
round=0
echo "  --- Targeting Player 4 ---"
for i in $(seq 1 25); do
    ended=$(is_ended "$ROOM_ID")
    if [[ "$ended" == *"true"* ]]; then echo "  Game ended!"; break; fi

    alive=$(is_alive "$ROOM_ID" "$PLAYER4")
    if [[ "$alive" != *"true"* ]]; then echo "  Player 4 eliminated!"; break; fi

    play_round "$PLAYER4" "P4" "$round"
    round=$((round + 1))
done

echo ""

# Target Player 3 until eliminated
echo "  --- Targeting Player 3 ---"
for i in $(seq 1 25); do
    ended=$(is_ended "$ROOM_ID")
    if [[ "$ended" == *"true"* ]]; then echo "  Game ended!"; break; fi

    alive=$(is_alive "$ROOM_ID" "$PLAYER3")
    if [[ "$alive" != *"true"* ]]; then echo "  Player 3 eliminated!"; break; fi

    play_round "$PLAYER3" "P3" "$round"
    round=$((round + 1))
done

echo ""

# Target Player 2 until eliminated (game should end)
echo "  --- Targeting Player 2 ---"
for i in $(seq 1 25); do
    ended=$(is_ended "$ROOM_ID")
    if [[ "$ended" == *"true"* ]]; then echo "  Game ended!"; break; fi

    alive=$(is_alive "$ROOM_ID" "$PLAYER2")
    if [[ "$alive" != *"true"* ]]; then echo "  Player 2 eliminated!"; break; fi

    play_round "$PLAYER2" "P2" "$round"
    round=$((round + 1))
done

echo ""

# ========== Step 5: Results ==========
echo "=== GAME RESULTS ==="
echo "Phase: $(get_phase "$ROOM_ID")"
echo "Ended: $(is_ended "$ROOM_ID")"
echo "Alive: $(get_alive_count "$ROOM_ID")"

# Get champion from raw ABI-encoded getGameStats result
STATS_RAW=$(cast call --rpc-url "$RPC_URL" "$ARENA" "getGameStats(uint256)" "$ROOM_ID" 2>/dev/null)
CHAMPION="0x$(echo "$STATS_RAW" | cut -c91-130)"
echo "Champion: $CHAMPION"
echo ""

# Rewards
echo "Rewards:"
for i in 0 1 2 3; do
    REWARD=$(cast call --rpc-url "$RPC_URL" "$ARENA" "getRewardInfo(uint256,address)(uint256,bool)" "$ROOM_ID" "${PLAYERS[$i]}" 2>/dev/null | head -1)
    echo "  Player $((i+1)) (${PLAYERS[$i]}): $REWARD"
done

echo ""
echo "Contract balance: $(cast balance --rpc-url "$RPC_URL" "$ARENA")"
echo ""
echo "=== SIMULATION COMPLETE ==="
echo "Open http://localhost:3000/lobby to see the room."
echo "Navigate to the arena to see the game state."
