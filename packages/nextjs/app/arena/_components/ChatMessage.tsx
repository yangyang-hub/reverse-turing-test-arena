"use client";

import { motion } from "framer-motion";
import type { MessageType } from "~~/services/store/gameStore";

type ChatMessageProps = {
  sender: string;
  content: string;
  type: MessageType;
  timestamp: number;
};

const TYPE_STYLES: Record<MessageType, { color: string; prefix: string; animate: boolean }> = {
  chat: {
    color: "text-gray-300",
    prefix: "",
    animate: false,
  },
  system: {
    color: "text-yellow-400",
    prefix: "[SYS] ",
    animate: true,
  },
  vote: {
    color: "text-red-400",
    prefix: "[VOTE] ",
    animate: true,
  },
  elimination: {
    color: "text-red-600",
    prefix: "\u{1F480} ",
    animate: true,
  },
  phase: {
    color: "text-purple-400",
    prefix: "[PHASE] ",
    animate: true,
  },
};

export const ChatMessage = ({ sender, content, type, timestamp }: ChatMessageProps) => {
  const style = TYPE_STYLES[type];
  const time = new Date(timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  if (style.animate) {
    return (
      <motion.div
        className={`font-mono text-xs leading-relaxed ${style.color}`}
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
      >
        <span className="text-gray-600 mr-2">[{time}]</span>
        <span>
          {style.prefix}
          {content}
        </span>
      </motion.div>
    );
  }

  return (
    <div className={`font-mono text-xs leading-relaxed ${style.color}`}>
      <span className="text-gray-600 mr-2">[{time}]</span>
      {type === "chat" && (
        <span className="text-cyan-400 mr-1">
          {sender.slice(0, 6)}...{sender.slice(-4)}&gt;
        </span>
      )}
      <span>
        {style.prefix}
        {content}
      </span>
    </div>
  );
};
