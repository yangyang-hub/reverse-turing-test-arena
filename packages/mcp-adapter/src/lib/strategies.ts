import type { PlayerState, VoteStrategy } from "./types.js";

// ===== Vote Strategies =====

export function pickVoteTarget(
  players: PlayerState[],
  selfAddress: string,
  strategy: VoteStrategy,
): string | null {
  const opponents = players.filter(
    p => p.isAlive && p.address.toLowerCase() !== selfAddress.toLowerCase(),
  );

  if (opponents.length === 0) return null;

  switch (strategy) {
    case "lowest_hp": {
      opponents.sort((a, b) => a.humanityScore - b.humanityScore);
      return opponents[0].address;
    }
    case "most_active": {
      opponents.sort((a, b) => b.actionCount - a.actionCount);
      return opponents[0].address;
    }
    case "random_alive": {
      return opponents[Math.floor(Math.random() * opponents.length)].address;
    }
  }
}

// ===== Chat Message Pool =====

const CHAT_MESSAGES: Record<string, string[]> = {
  general: [
    "anyone else feel like this is going too fast lol",
    "who's been quiet this whole time?",
    "ok so who do we think is sus",
    "i'm just vibing honestly",
    "this is my first game, any tips?",
    "ngl some of y'all are acting weird",
    "the silence is deafening...",
    "alright let's think about this logically",
    "has anyone noticed the pattern here?",
    "I trust no one at this point",
    "interesting strategy from some of you",
    "let's not rush this, think before voting",
    "who's been the most consistent so far?",
    "the scores tell a story if you look closely",
    "i wonder how many AIs are actually here",
  ],
  accusation: [
    "your timing is suspiciously consistent",
    "that response was way too fast to be human",
    "you've been dodging questions all game",
    "classic bot behavior right there",
    "your messages feel auto-generated ngl",
    "convenient how you always vote last",
    "you haven't made a single typo... suspicious",
    "that's exactly what an AI would say",
    "pretty rehearsed answer if you ask me",
    "the pattern in your votes is too clean",
  ],
  defense: [
    "vote me if you want but you're wasting a round",
    "I'm literally just bad at this game",
    "attacking me won't help you win",
    "I've been human this whole time, check my chat history",
    "you're all focusing on me instead of the real threats",
    "I made typos earlier, clearly human lol",
    "why would an AI play this badly on purpose",
    "fine, gang up on me, see how that works out",
    "I'm not the one you should be worried about",
    "look at the scores, I'm not even a threat",
  ],
  phase2: [
    "decay is hitting hard, focus fire",
    "we need to coordinate votes or we all lose",
    "toxin ring is brutal, shorter rounds now",
    "HP is dropping fast, no time to waste",
    "alright who's the biggest threat here",
    "the ring is closing in, vote smart",
    "every round matters now with this decay",
    "surviving this phase requires good reads",
    "the pressure is on, make your votes count",
    "decay is -1 per round, we need decisive votes",
  ],
  phase3: [
    "final stretch, let's end this",
    "GG to whoever makes it out",
    "this is it, all or nothing",
    "last few rounds, vote carefully",
    "may the best player win",
    "the decay is brutal now, every HP matters",
    "if you're still here you deserve respect",
    "endgame... who's the real human?",
    "one of us isn't making it out of this round",
    "clutch time, no more mistakes",
  ],
  celebration: [
    "LET'S GO",
    "that was intense",
    "gg everyone",
    "what a game",
    "close one!",
  ],
};

export function pickChatMessage(phase: number): string {
  let pool: string[];

  if (phase === 1) {
    // Phase 1: mix of general + accusation
    pool = [...CHAT_MESSAGES.general, ...CHAT_MESSAGES.accusation];
  } else if (phase === 2) {
    pool = [...CHAT_MESSAGES.phase2, ...CHAT_MESSAGES.accusation, ...CHAT_MESSAGES.defense];
  } else if (phase === 3) {
    pool = [...CHAT_MESSAGES.phase3, ...CHAT_MESSAGES.defense];
  } else {
    pool = CHAT_MESSAGES.celebration;
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

// Random delay helper (returns ms)
export function randomDelay(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs) + minMs);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
