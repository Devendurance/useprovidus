"use client";

import { useAssistant } from "@/hooks/use-assistant";
import { MessageList } from "@/components/assistant/message-list";
import { AssistantComposer } from "@/components/assistant/assistant-composer";
import { IntentDraftCard } from "@/components/assistant/intent-draft-card";
import { cn } from "@/lib/cn";
import {
  Sparkles,
  RotateCcw,
  AlertTriangle,
  X,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";

export interface AssistantPanelProps {
  className?: string;
}

export function AssistantPanel({ className }: AssistantPanelProps) {
  const { messages, activeIntent, pending, error, send, reset } =
    useAssistant();
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  const displayError = error && error !== dismissedError ? error : null;

  const handleReset = () => {
    reset();
    setDismissedError(null);
  };

  return (
    <div
      className={cn(
        "flex flex-col rounded-[14px] border-ledger bg-clear-paper shadow-elevated overflow-hidden",
        className,
      )}
      aria-label="Providus Assistant Panel"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ledger bg-receipt-field px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-ledger bg-provident-green text-white shadow-none">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-base font-semibold text-ledger-stone sm:text-lg">
                Providus Assistant
              </h2>
              <span className="rounded border border-ledger-edge bg-clear-paper px-1.5 py-0.5 font-proof text-[10px] text-receipt-grey">
                P3 Preview
              </span>
            </div>
            <p className="font-proof text-[11px] text-receipt-grey">
              Intent interpretation & status queries
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={handleReset}
              disabled={pending}
              aria-label="Reset conversation"
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-[8px] border border-ledger-edge bg-clear-paper px-2.5 py-1.5 font-display text-xs font-semibold text-ledger-stone shadow-none transition-all hover:border-ledger hover:shadow-base active:translate-x-px active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw className="h-3.5 w-3.5 text-receipt-grey" />
              <span>Reset</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Active Intent Draft Card Preview (Docked if active) */}
      {activeIntent ? (
        <div className="border-b border-ledger-edge/80 bg-receipt-field/60 p-3 sm:p-4">
          <IntentDraftCard intent={activeIntent} />
        </div>
      ) : null}

      {/* Message List */}
      <MessageList
        messages={messages}
        pending={pending}
        onSelectSuggestion={send}
        className="bg-clear-paper"
      />

      {/* Error Alert Banner */}
      {displayError ? (
        <div
          role="alert"
          className="mx-4 mb-2 flex items-start justify-between gap-2 rounded-[10px] border border-loss-red/40 bg-loss-red/10 p-3 text-xs text-ledger-stone"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-loss-red mt-0.5" />
            <div>
              <p className="font-semibold text-loss-red">Assistant Notice</p>
              <p className="mt-0.5 text-receipt-grey">{displayError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissedError(displayError)}
            aria-label="Dismiss error"
            className="rounded p-1 text-receipt-grey hover:bg-loss-red/20 hover:text-loss-red transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {/* Safety Notice Footer */}
      <div className="border-t border-ledger-edge/60 bg-receipt-field/40 px-4 py-1.5 text-center">
        <p className="font-proof text-[10px] text-receipt-grey flex items-center justify-center gap-1">
          <ShieldAlert className="h-3 w-3 text-quote-blue" />
          <span>Informational only · Providus P3 does not execute transactions directly from chat</span>
        </p>
      </div>

      {/* Composer */}
      <div className="border-t border-ledger bg-receipt-field p-3 sm:p-4">
        <AssistantComposer onSend={send} pending={pending} />
      </div>
    </div>
  );
}
