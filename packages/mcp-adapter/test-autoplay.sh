#!/bin/bash
# test-autoplay.sh — Sets up a 4-player room, starts the game, then launches the bot on Player 4
#
# Usage:
#   1. yarn chain          (Terminal 1)
#   2. yarn deploy         (Terminal 2)
#   3. cd packages/mcp-adapter && bash test-autoplay.sh
#
set -e

RPC_URL="http://127.0.0.1:8545"

# Anvil default private keys
PK1="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
PK2="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
PK3="0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
PK4="0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"

PLAYER1="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
PLAYER2="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
PLAYER3="0x90F79bf6EB2c4f870365E785982E1f101E93b906"
PLAYER4="0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"

FEE="10000000" # 10 USDC (6 decimals)

# --- Find deployed contract addresses from broadcast ---
FOUNDRY_DIR="$(dirname "$0")/../foundry"
BROADCAST_FILE="$FOUNDRY_DIR/broadcast/Deploy.s.sol/31337/run-latest.json"
if [ ! -f "$BROADCAST_FILE" ]; then
    echo "ERROR: Broadcast file not found at $BROADCAST_FILE"
    echo "Run 'yarn deploy' first."
    exit 1
fi

# Extract contract addresses (MockUSDC deployed first, TuringArena second)
USDC=$(cat "$BROADCAST_FILE" | python3 -c "
import json,sys
data=json.load(sys.stdin)
for tx in data['transactions']:
    if tx.get('contractName')=='MockUSDC':
        print(tx['contractAddress'])
        break
")
ARENA=$(cat "$BROADCAST_FILE" | python3 -c "
import json,sys
data=json.load(sys.stdin)
for tx in data['transactions']:
    if tx.get('contractName')=='TuringArena':
        print(tx['contractAddress'])
        break
")

echo "=== Auto-Play Test Setup ==="
echo "USDC:  $USDC"
echo "Arena: $ARENA"
echo ""

# --- Helper ---
send() {
    cast send --rpc-url $RPC_URL --private-key "$1" "$2" "$3" $4 $5 $6 2>/dev/null | grep -q "status" || true
}

# --- Step 1: Player 1 creates room (auto-joins) ---
echo "[1/5] Player 1 approving USDC + creating room..."
cast send --rpc-url $RPC_URL --private-key $PK1 $USDC "approve(address,uint256)" $ARENA $FEE > /dev/null 2>&1
cast send --rpc-url $RPC_URL --private-key $PK1 $ARENA "createRoom(uint8,uint256,uint256)" 0 10 $FEE > /dev/null 2>&1

ROOM_ID=$(cast call --rpc-url $RPC_URL $ARENA "getRoomCount()(uint256)")
echo "   Room created: ID = $ROOM_ID"

# --- Step 2: Players 2-3 join ---
echo "[2/5] Player 2 joining..."
cast send --rpc-url $RPC_URL --private-key $PK2 $USDC "approve(address,uint256)" $ARENA $FEE > /dev/null 2>&1
cast send --rpc-url $RPC_URL --private-key $PK2 $ARENA "joinRoom(uint256)" $ROOM_ID > /dev/null 2>&1

echo "[3/5] Player 3 joining..."
cast send --rpc-url $RPC_URL --private-key $PK3 $USDC "approve(address,uint256)" $ARENA $FEE > /dev/null 2>&1
cast send --rpc-url $RPC_URL --private-key $PK3 $ARENA "joinRoom(uint256)" $ROOM_ID > /dev/null 2>&1

# --- Step 3: Player 4 joins ---
echo "[4/5] Player 4 (bot) joining..."
cast send --rpc-url $RPC_URL --private-key $PK4 $USDC "approve(address,uint256)" $ARENA $FEE > /dev/null 2>&1
cast send --rpc-url $RPC_URL --private-key $PK4 $ARENA "joinRoom(uint256)" $ROOM_ID > /dev/null 2>&1

# --- Step 4: Player 1 starts the game ---
echo "[5/5] Player 1 starting game..."
cast send --rpc-url $RPC_URL --private-key $PK1 $ARENA "startGame(uint256)" $ROOM_ID > /dev/null 2>&1

# Verify
PHASE=$(cast call --rpc-url $RPC_URL $ARENA "getRoomInfo(uint256)" $ROOM_ID 2>/dev/null | cut -c 199-264)
echo ""
echo "=== Room $ROOM_ID ready! Game is active. ==="
echo ""
echo "Now launch the bot (Player 4) with:"
echo ""
echo "  PRIVATE_KEY=$PK4 \\"
echo "  ROOM_ID=$ROOM_ID \\"
echo "  RPC_URL=$RPC_URL \\"
echo "  ARENA_CONTRACT_ADDRESS=$ARENA \\"
echo "  PAYMENT_TOKEN_ADDRESS=$USDC \\"
echo "  POLL_INTERVAL_MS=3000 \\"
echo "  npm run autoplay"
echo ""
echo "Or copy-paste this one-liner:"
echo ""
echo "PRIVATE_KEY=$PK4 ROOM_ID=$ROOM_ID RPC_URL=$RPC_URL ARENA_CONTRACT_ADDRESS=$ARENA PAYMENT_TOKEN_ADDRESS=$USDC POLL_INTERVAL_MS=3000 npm run autoplay"
