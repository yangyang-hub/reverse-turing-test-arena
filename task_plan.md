# Plan: Route B — Session Key Full Integration

## Goal
TuringArena enforces session key validity at the contract level. Session keys that expire or exhaust usage are rejected. Frontend provides a UI to generate and register session keys.

## Architecture Decision: Delegation Pattern

The key question is **identity**. When a session key calls `castVote`, should the vote be attributed to:
- (A) The session key address itself (session key IS the player)
- (B) The owner address (session key acts ON BEHALF of the owner)

**Answer: (A) — Session key IS the player.**

Rationale:
- The bot wallet joins the room, pays USDC, and IS a player — it has its own HP, votes, and score
- The owner just delegates authority to create that session key, not to act as themselves
- This avoids complex identity remapping in all player lookups
- TuringArena only needs to verify "is this caller a valid session key?" for rate-limiting/expiry, not "who is the real player?"

This means:
- `msg.sender` remains the player identity everywhere
- SessionKeyValidator just acts as an **optional gate** — if the caller has a registered session, validate it's not expired/exhausted
- Direct private key users bypass the check entirely (backwards compatible)

## Contract Changes

### TuringArena.sol

**New state variable:**
```solidity
ISessionKeyValidator public sessionValidator; // address(0) = disabled
```

**New interface (in separate file or inline):**
```solidity
interface ISessionKeyValidator {
    function isSessionValid(address sessionKey) external view returns (bool);
    function sessions(address) external view returns (address owner, uint256 expiresAt, uint256 maxUsage, uint256 usageCount, bool isRevoked);
}
```

**New internal helper:**
```solidity
function _validateSessionIfRegistered(address _caller) internal view {
    if (address(sessionValidator) == address(0)) return; // disabled
    // Check if this address has a registered session
    (address owner,,,,) = sessionValidator.sessions(_caller);
    if (owner == address(0)) return; // not a session key, direct wallet — allow
    // Has a registered session — enforce validity
    require(sessionValidator.isSessionValid(_caller), "Session expired or exhausted");
}
```

**Apply to these functions (add at top):**
- `sendMessage()` — `_validateSessionIfRegistered(msg.sender)`
- `castVote()` — `_validateSessionIfRegistered(msg.sender)`
- `joinRoom()` — `_validateSessionIfRegistered(msg.sender)`
- `createRoom()` — `_validateSessionIfRegistered(msg.sender)`

**New admin function:**
```solidity
function setSessionValidator(address _validator) external {
    require(msg.sender == protocolTreasury, "Only treasury");
    sessionValidator = ISessionKeyValidator(_validator);
}
```

**Constructor change:** Add optional `_sessionValidator` parameter (can be address(0) to disable).

### SessionKeyValidator.sol — No changes needed
The existing contract already has everything: `createSession`, `revokeSession`, `isSessionValid`, `sessions` mapping.

### Test Changes

**New test file: `SessionKeyIntegration.t.sol`**
- Test: session key can play when valid
- Test: session key rejected after expiry (`vm.warp`)
- Test: session key rejected after max usage
- Test: session key rejected after revocation
- Test: direct wallet (no session) still works (backwards compat)
- Test: sessionValidator = address(0) disables all checks

### Deploy Script
Already deploys SessionKeyValidator. Add `arena.setSessionValidator(address(sessionValidator))` call.

## Frontend Changes

### New component: `SessionKeyPanel.tsx` (in `app/_components/`)

Displayed in the "I'm an Agent" path of RoleSelector. Flow:

1. User connects wallet (already done via RainbowKit)
2. Click "Generate Session Key" → generates random keypair in browser (`ethers.Wallet.createRandom()`)
3. Shows: session key address, private key (masked, copy button)
4. User configures duration (slider: 30min-2h) and max usage (slider: 100-1000)
5. Click "Register On-Chain" → calls `SessionKeyValidator.createSession(sessionKeyAddr, duration, maxUsage)` via wagmi
6. After tx confirms: shows the private key + contract addresses to copy into MCP config
7. User must manually fund the session key with ETH + USDC (show a "Send funds" helper)

### RoleSelector.tsx changes
- Agent path: replace current "COPY URL" / "VIEW DOCS" with `<SessionKeyPanel />` + link to docs
- Keep the skills.md link as secondary

## Files to Change

| File | Change |
|------|--------|
| `contracts/TuringArena.sol` | Add `sessionValidator`, `_validateSessionIfRegistered()`, `setSessionValidator()`, constructor param |
| `contracts/interfaces/ISessionKeyValidator.sol` | New: interface file |
| `script/DeployTuringArena.s.sol` | Call `arena.setSessionValidator()` after deploy |
| `test/SessionKeyIntegration.t.sol` | New: 6 session key integration tests |
| `test/TuringArena.t.sol` | Update setUp if constructor changes |
| `packages/nextjs/app/_components/SessionKeyPanel.tsx` | New: session key generation + registration UI |
| `packages/nextjs/app/_components/RoleSelector.tsx` | Integrate SessionKeyPanel into agent path |

## Implementation Order

1. Create `ISessionKeyValidator.sol` interface
2. Modify `TuringArena.sol` — add state, helper, apply to 4 functions, admin setter
3. Update `DeployTuringArena.s.sol` — wire validator
4. Update `TuringArena.t.sol` — fix constructor if needed
5. Create `SessionKeyIntegration.t.sol` — 6 tests
6. Run `forge test` — all 36 existing + 6 new pass
7. Create `SessionKeyPanel.tsx` frontend component
8. Update `RoleSelector.tsx` to embed it
9. Build all: `forge build`, `npm run build` (mcp-adapter), `yarn next:build`
10. Post-code sync

## Backwards Compatibility

- `sessionValidator = address(0)` → all session checks disabled (same as current behavior)
- Direct private key users never register a session → `sessions[caller].owner == address(0)` → skip validation
- Only session key holders get validated — no impact on existing human players
