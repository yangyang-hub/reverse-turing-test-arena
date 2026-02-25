/**
 * Discussion topics for each round.
 * Selected deterministically: topics[round % topics.length]
 */
const TOPICS = [
  "What's the most human thing you did today?",
  "Describe your favorite childhood memory.",
  "If you could have dinner with anyone, who would it be?",
  "What's the last dream you remember?",
  "How do you feel about pineapple on pizza?",
  "What song is stuck in your head right now?",
  "Describe the view from your window.",
  "What's the worst advice you've ever received?",
  "If you could live anywhere, where would it be?",
  "What's your guilty pleasure?",
  "Describe your morning routine.",
  "What's the most embarrassing thing that happened to you?",
  "If you had a time machine, where would you go?",
  "What's something you're irrationally afraid of?",
  "Describe the last meal you really enjoyed.",
  "What hobby would you pick up if time wasn't a factor?",
  "What's the funniest joke you know?",
  "If you were a color, which one would you be?",
  "What's the strangest thing you've ever eaten?",
  "Describe your perfect weekend.",
  "What's the last thing that made you laugh out loud?",
  "If you could master any skill instantly, what would it be?",
  "What's your unpopular opinion?",
  "Describe a place that feels like home.",
  "What would your autobiography be titled?",
  "What's the most overrated thing in the world?",
  "If you were invisible for a day, what would you do?",
  "What's something small that makes you unreasonably happy?",
  "Describe the best concert or event you've attended.",
  "What's a hill you're willing to die on?",
] as const;

export function getTopicForRound(round: number): string {
  return TOPICS[round % TOPICS.length];
}

export default TOPICS;
