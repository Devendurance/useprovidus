"use client";

import { useEffect, useRef } from "react";
import type { ConversationMessage } from "@/lib/assistant/types";
import { MessageBubble } from "@/components/assistant/message-bubble";
import { cn } from "@/lib/cn";
import { Sparkles, ArrowRight, Loader2 } from "lucide-react";

export interface MessageListProps {
  messages: ConversationMessage[];
  pending?: boolean;
  onSelectSuggestion?: (text: string) => void;
  className?: string;
}

const STARTER_SUGGESTIONS = [
  "Buy ₦500 airtime for 08012345678",
  "Buy ₦1000 MTN airtime",
  "What is the status of tx_sample_123?",
  "How does Celo USDC cash-out work?",
];

export function MessageList({
  messages,
  pending = false,
  onSelectSuggestion,
  className,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or pending state
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, pending]);

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Conversation history"
      className={cn(
        "flex flex-1 flex-col overflow-y-auto p-4 sm:p-5 space-y-4 min-h-[300px] max-h-[560px]",
        className,
      )}
    >
      {messages.length === 0 ? (
        <div className="my-auto flex flex-col items-center justify-center py-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-[12px] border border-ledger bg-provident-green/10 text-provident-green shadow-base">
            <Sparkles className="h-6 w-6" aria-hidden="true" />
          </div>
          <h3 className="mt-3 font-display text-lg font-semibold text-ledger-stone">
            Providus Intent Assistant
          </h3>
          <p className="mt-1 max-w-md text-sm text-receipt-grey leading-relaxed">
            Clarify airtime top-ups, check transaction status, or explore Celo route intelligence.
            Try one of the prompts below to get started.
          </p>

          {onSelectSuggestion ? (
            <div className="mt-5 flex w-full max-w-lg flex-col gap-2">
              <span className="font-proof text-xs text-receipt-grey text-left">
                Suggested prompts:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                {STARTER_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => onSelectSuggestion(suggestion)}
                    className="group flex items-center justify-between rounded-[10px] border border-ledger-edge bg-receipt-field p-2.5 text-xs text-ledger-stone shadow-none transition-all hover:border-ledger hover:bg-clear-paper hover:shadow-base active:translate-x-px active:translate-y-px"
                  >
                    <span className="font-medium text-left truncate mr-2">
                      {suggestion}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-receipt-grey transition-transform group-hover:translate-x-0.5 group-hover:text-provident-green shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        messages.map((message, index) => (
          <MessageBubble
            key={`${message.timestamp}-${index}`}
            message={message}
          />
        ))
      )}

      {/* Pending / Thinking Indicator */}
      {pending ? (
        <div className="flex w-full justify-start gap-2.5 sm:gap-3">
          <div
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-ledger bg-provident-green text-white shadow-none"
            aria-hidden="true"
          >
            <span className="font-display text-xs font-bold tracking-tight">P</span>
          </div>
          <div className="flex items-center gap-2 rounded-[14px] border border-ledger bg-clear-paper px-4 py-3 text-sm text-receipt-grey shadow-base">
            <Loader2 className="h-4 w-4 animate-spin text-provident-green" />
            <span className="font-proof text-xs">
              Providus is thinking…
            </span>
          </div>
        </div>
      ) : null}

      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}
