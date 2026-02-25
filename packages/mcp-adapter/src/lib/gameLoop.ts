import { ethers } from "ethers";
import { getArenaContract } from "./contracts.js";
import { pickVoteTarget, pickChatMessage, randomDelay, sleep } from "./strategies.js";
import { PHASE_NAMES } from "./types.js";
import type { AutoPlayConfig, AutoPlayStatus, PlayerState, RoomState } from "./types.js";

export class GameLoop {
  private config: AutoPlayConfig;
  private wallet: ethers.Wallet;
  private provider: ethers.Provider;
  private arenaAddress: string;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private ticking = false; // guard against overlapping ticks

  private status: AutoPlayStatus;
  private recentErrors: string[] = [];
  private stopped = false;
  private log: (msg: string) => void;

  constructor(
    config: AutoPlayConfig,
    wallet: ethers.Wallet,
    arenaAddress: string,
    log?: (msg: string) => void,
  ) {
    this.config = config;
    this.wallet = wallet;
    this.provider = wallet.provider!;
    this.arenaAddress = arenaAddress;
    this.log = log ?? ((msg: string) => process.stderr.write(`[GameLoop] ${msg}\n`));

    this.status = {
      running: false,
      roomId: config.roomId,
      round: 0,
      phase: 0,
      phaseName: "Waiting",
      humanityScore: 100,
      isAlive: true,
      votesThisGame: 0,
      messagesThisGame: 0,
      settlesThisGame: 0,
      errors: [],
      startedAt: Date.now(),
      lastTickAt: 0,
    };
  }

  start(): AutoPlayStatus {
    if (this.intervalId) return this.getStatus();

    this.stopped = false;
    this.status.running = true;
    this.status.startedAt = Date.now();
    this.log(`Starting auto-play for room ${this.config.roomId}`);

    // Run first tick immediately, then schedule
    this.tick();
    this.intervalId = setInterval(() => this.tick(), this.config.pollIntervalMs);

    return this.getStatus();
  }

  stop(): AutoPlayStatus {
    this.stopped = true;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.status.running = false;
    this.log("Auto-play stopped");
    return this.getStatus();
  }

  getStatus(): AutoPlayStatus {
    return { ...this.status, errors: [...this.recentErrors].slice(-10) };
  }

  private async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    this.status.lastTickAt = Date.now();

    try {
      const contract = getArenaContract(this.arenaAddress, this.wallet);
      const myAddr = this.wallet.address;

      // 1. Read room state
      const [roomInfo, playerAddresses, round] = await Promise.all([
        contract.getRoomInfo(this.config.roomId),
        contract.getAllPlayers(this.config.roomId),
        contract.currentRound(this.config.roomId),
      ]);

      const room = this.parseRoomInfo(roomInfo);
      this.status.phase = room.phase;
      this.status.phaseName = room.phaseName;
      this.status.round = Number(round);

      // 1.5. Verify we are in the room
      const isInRoom = (playerAddresses as string[]).some(
        p => p.toLowerCase() === myAddr.toLowerCase(),
      );
      if (!isInRoom) {
        this.log("ERROR: Not in room. Use action_onchain(JOIN) or create_room first.");
        this.stop();
        return;
      }

      // 2. Game ended → claim reward → stop
      if (room.isEnded || room.phase === 2) {
        this.log(`Game ended at round ${this.status.round}`);
        await this.tryClaim(contract);
        this.stop();
        return;
      }

      // 3. Game hasn't started yet (Waiting phase)
      if (room.phase === 0) {
        return;
      }

      // 4. Read own player info
      const myInfo = await contract.getPlayerInfo(this.config.roomId, myAddr);
      this.status.humanityScore = Number(myInfo.humanityScore);
      this.status.isAlive = myInfo.isAlive;

      // 5. Eliminated → wait for game end
      if (!myInfo.isAlive) {
        this.log("Eliminated, waiting for game to end...");
        return;
      }

      // 6. Get all player states for strategy
      const playerInfos = await Promise.all(
        (playerAddresses as string[]).map((addr: string) =>
          contract.getPlayerInfo(this.config.roomId, addr),
        ),
      );
      const players: PlayerState[] = playerInfos.map((p: ethers.Result) => ({
        address: p.addr,
        humanityScore: Number(p.humanityScore),
        isAlive: p.isAlive,
        isAI: p.isAI,
        actionCount: Number(p.actionCount),
        successfulVotes: Number(p.successfulVotes),
      }));

      // 7. Vote if haven't voted this round
      const hasVoted = await contract.hasVotedInRound(
        this.config.roomId,
        round,
        myAddr,
      );
      if (!hasVoted) {
        await this.tryVote(contract, players, myAddr, myInfo.isAI);
      }

      // 8. Maybe send a chat message (respect 3 per round limit)
      if (
        this.config.chatStrategy !== "silent" &&
        Math.random() < this.config.chatFrequency / 3
      ) {
        // Check message count before sending
        const msgCount = await contract.getMessageCount(this.config.roomId, round, myAddr);
        if (Number(msgCount) < 3) {
          await this.tryChat(contract);
        }
      }

      // 9. Maybe settle the round
      if (this.config.settleEnabled) {
        await this.trySettle(contract, room);
      }

      // 10. Safety: max rounds
      if (this.status.round >= this.config.maxRounds) {
        this.log(`Max rounds (${this.config.maxRounds}) reached, stopping`);
        this.stop();
      }
    } catch (err) {
      this.handleError(err);
    } finally {
      this.ticking = false;
    }
  }

  private async tryVote(
    contract: ethers.Contract,
    players: PlayerState[],
    myAddr: string,
    myIsAI: boolean,
  ): Promise<void> {
    const target = pickVoteTarget(players, myAddr, this.config.voteStrategy, myIsAI);
    if (!target) return;

    // Human-like delay before voting
    await sleep(randomDelay(1000, 4000));

    try {
      this.log(`Voting for ${target} (strategy: ${this.config.voteStrategy})`);
      const tx = await contract.castVote(this.config.roomId, target);
      await tx.wait();
      this.status.votesThisGame++;
    } catch (err) {
      const msg = String(err);
      // Benign race conditions — skip silently
      if (msg.includes("Already voted") || msg.includes("Round not ended")) {
        return;
      }
      if (msg.includes("eliminated") || msg.includes("not active")) {
        this.status.isAlive = false;
        return;
      }
      throw err;
    }
  }

  private async tryChat(contract: ethers.Contract): Promise<void> {
    const message = pickChatMessage();

    await sleep(randomDelay(500, 2000));

    try {
      this.log(`Sending message: "${message}"`);
      const tx = await contract.sendMessage(this.config.roomId, message);
      await tx.wait();
      this.status.messagesThisGame++;
    } catch (err) {
      const msg = String(err);
      if (msg.includes("Message limit")) {
        return; // Not dead, just rate-limited this round
      }
      if (msg.includes("eliminated") || msg.includes("not active")) {
        this.status.isAlive = false;
        return;
      }
      throw err;
    }
  }

  private async trySettle(contract: ethers.Contract, room: RoomState): Promise<void> {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      const blocksSinceSettle = currentBlock - room.lastSettleBlock;

      if (blocksSinceSettle < room.currentInterval) return;

      this.log(`Settling round (blocks since last: ${blocksSinceSettle}, interval: ${room.currentInterval})`);
      const tx = await contract.settleRound(this.config.roomId);
      await tx.wait();
      this.status.settlesThisGame++;
    } catch (err) {
      const msg = String(err);
      // "Round not ended yet" is a normal race condition
      if (msg.includes("Round not ended") || msg.includes("not active")) {
        return;
      }
      throw err;
    }
  }

  private async tryClaim(contract: ethers.Contract): Promise<void> {
    try {
      const [amount, claimed] = await contract.getRewardInfo(
        this.config.roomId,
        this.wallet.address,
      );
      if (amount > 0n && !claimed) {
        this.log(`Claiming reward: ${ethers.formatUnits(amount, 6)} USDC`);
        const tx = await contract.claimReward(this.config.roomId);
        await tx.wait();
        this.log("Reward claimed!");
      } else if (claimed) {
        this.log("Reward already claimed");
      } else {
        this.log("No reward to claim");
      }
    } catch (err) {
      this.log(`Claim failed: ${err}`);
    }
  }

  private parseRoomInfo(info: ethers.Result): RoomState {
    return {
      id: info.id.toString(),
      phase: Number(info.phase),
      phaseName: PHASE_NAMES[Number(info.phase)] ?? "Unknown",
      entryFee: info.entryFee,
      prizePool: info.prizePool,
      maxPlayers: Number(info.maxPlayers),
      playerCount: Number(info.playerCount),
      aliveCount: Number(info.aliveCount),
      humanCount: Number(info.humanCount),
      aiCount: Number(info.aiCount),
      isActive: info.isActive,
      isEnded: info.isEnded,
      currentInterval: Number(info.currentInterval),
      lastSettleBlock: Number(info.lastSettleBlock),
      startBlock: Number(info.startBlock),
    };
  }

  private handleError(err: unknown): void {
    const msg = String(err);

    // Fatal errors — stop the loop
    if (msg.includes("insufficient funds") || msg.includes("nonce too low")) {
      this.log(`Fatal error: ${msg}`);
      this.recentErrors.push(msg.slice(0, 200));
      this.stop();
      return;
    }

    // Transient errors — log and retry next tick
    this.log(`Tick error (will retry): ${msg.slice(0, 200)}`);
    this.recentErrors.push(msg.slice(0, 200));
    if (this.recentErrors.length > 20) {
      this.recentErrors = this.recentErrors.slice(-10);
    }
  }
}
