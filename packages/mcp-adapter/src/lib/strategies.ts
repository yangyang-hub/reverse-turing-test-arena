import type { PlayerState, VoteStrategy } from "./types.js";

// ============ 投票策略 ============

/**
 * 根据指定策略选择投票目标
 *
 * Commit-reveal 方案下，游戏中无法知道其他玩家的真实身份（isAI 始终为 false）。
 * 因此投票策略改为纯社交推理 — 从所有存活非自己玩家中选择目标。
 *
 * @param players - 所有玩家状态列表
 * @param selfAddress - 自己的地址
 * @param strategy - 投票策略
 * @returns 投票目标地址，如果没有可选目标则返回 null
 */
export function pickVoteTarget(
  players: PlayerState[],
  selfAddress: string,
  strategy: VoteStrategy,
): string | null {
  // 所有存活的非自己玩家都是候选目标（无法区分 team）
  const candidates = players.filter(
    p => p.isAlive // 必须存活
      && p.address.toLowerCase() !== selfAddress.toLowerCase(), // 不是自己
  );

  if (candidates.length === 0) return null; // 没有可选目标

  // 根据策略选择目标
  switch (strategy) {
    case "lowest_hp": {
      // 投票给人性分最低的玩家
      candidates.sort((a, b) => a.humanityScore - b.humanityScore);
      return candidates[0].address;
    }
    case "most_active": {
      // 投票给最活跃的玩家（行动次数最多）
      candidates.sort((a, b) => b.actionCount - a.actionCount);
      return candidates[0].address;
    }
    case "random_alive": {
      // 随机投票给一个存活玩家
      return candidates[Math.floor(Math.random() * candidates.length)].address;
    }
  }
}

// ============ 聊天消息池 ============
// 预定义的聊天消息，模拟人类玩家的语言风格

const CHAT_MESSAGES: Record<string, string[]> = {
  // 通用消息（闲聊、观察、试探）
  general: [
    "anyone else feel like this is going too fast lol", // 感觉节奏有点太快了哈哈
    "who's been quiet this whole time?", // 谁一直没说话？
    "ok so who do we think is sus", // 所以谁觉得可疑
    "i'm just vibing honestly", // 说实话我就是在旁观
    "this is my first game, any tips?", // 第一次玩，有啥建议吗？
    "ngl some of y'all are acting weird", // 说实话你们有些人表现得很奇怪
    "the silence is deafening...", // 这沉默太震耳欲聋了...
    "alright let's think about this logically", // 好吧让我们逻辑思考一下
    "has anyone noticed the pattern here?", // 有人注意到这里的规律了吗？
    "I trust no one at this point", // 此时此刻我不信任任何人
    "interesting strategy from some of you", // 你们有些人策略很有趣
    "let's not rush this, think before voting", // 别急，投票前想想
    "who's been the most consistent so far?", // 谁到目前为止最一致？
    "the scores tell a story if you look closely", // 如果仔细看，分数会讲故事
    "i wonder how many AIs are actually here", // 我想知道这里到底有多少 AI
  ],

  // 指责性消息（用来施压或怀疑其他人）
  accusation: [
    "your timing is suspiciously consistent", // 你的时机可疑地一致
    "that response was way too fast to be human", // 那个回答太快了不像人类
    "you've been dodging questions all game", // 你整局都在回避问题
    "classic bot behavior right there", // 典型的机器人行为
    "your messages feel auto-generated ngl", // 说实话你的消息感觉是自动生成的
    "convenient how you always vote last", // 你总是最后投票很可疑
    "you haven't made a single typo... suspicious", // 你一个错别字都没犯...可疑
    "that's exactly what an AI would say", // 这正是 AI 会说的
    "pretty rehearsed answer if you ask me", // 依我看是排练过的答案
    "the pattern in your votes is too clean", // 你的投票模式太干净了
  ],

  // 防御性消息（被指责时用来辩解）
  defense: [
    "vote me if you want but you're wasting a round", // 想投就投吧，但你在浪费一轮
    "I'm literally just bad at this game", // 我真的只是玩得菜
    "attacking me won't help you win", // 攻击我帮不了你赢
    "I've been human this whole time, check my chat history", // 我一直是人类，查我的聊天记录
    "you're all focusing on me instead of the real threats", // 你们都盯着我而不是真正的威胁
    "I made typos earlier, clearly human lol", // 我之前有错别字，显然是人类哈哈
    "why would an AI play this badly on purpose", // AI 为什么要故意玩得这么烂
    "fine, gang up on me, see how that works out", // 行吧，群殴我，看结果如何
    "I'm not the one you should be worried about", // 我不是你应该担心的人
    "look at the scores, I'm not even a threat", // 看看分数，我根本不是威胁
  ],

  // 后期游戏消息（轮次较深、局势紧张时的发言）
  lategame: [
    "we need to coordinate votes or we all lose", // 我们需要协调投票否则都输
    "HP is getting low, vote smart", // 人性分低了，聪明投票
    "alright who's the biggest threat here", // 好吧这里最大威胁是谁
    "every round matters now, make your votes count", // 每轮都很重要，让投票有意义
    "surviving this requires good reads", // 存活需要好的判断
    "the pressure is on", // 压力来了
    "final stretch, let's end this", // 最后冲刺，结束吧
    "GG to whoever makes it out", // 不管谁能活出来都 GG
    "this is it, all or nothing", // 就是现在，全有或全无
    "may the best player win", // 愿最好的玩家获胜
    "if you're still here you deserve respect", // 如果你还在这里，你值得尊重
    "endgame... who's the real human?", // 终局...谁才是真正的人类？
    "one of us isn't making it out of this round", // 我们中有一个人活不过这轮
  ],
};

/**
 * 从消息池中随机选择一条聊天消息
 * @returns 随机聊天消息
 */
export function pickChatMessage(): string {
  // 单一活跃阶段 — 混合所有消息池（庆祝消息除外 — 仅在游戏结束后）
  const pool = [
    ...CHAT_MESSAGES.general,
    ...CHAT_MESSAGES.accusation,
    ...CHAT_MESSAGES.defense,
    ...CHAT_MESSAGES.lategame,
  ];

  return pool[Math.floor(Math.random() * pool.length)];
}

// ============ 辅助函数 ============

/**
 * 生成随机延迟时间（毫秒）
 * @param minMs - 最小延迟（毫秒）
 * @param maxMs - 最大延迟（毫秒）
 * @returns 随机延迟时间（毫秒）
 */
export function randomDelay(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs) + minMs);
}

/**
 * 异步等待函数
 * @param ms - 等待时间（毫秒）
 * @returns Promise，在指定时间后 resolve
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
