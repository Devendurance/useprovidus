"use client";

import type { ConversationMessage } from "@/lib/assistant/types";
import { cn } from "@/lib/cn";
import { ShieldCheck, Sparkles, Smartphone, HelpCircle } from "lucide-react";

export interface MessageBubbleProps {
  message: ConversationMessage;
  className?: string;
}

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function MessageBubble({ message, className }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const formattedTime = formatTimestamp(message.timestamp);

  if (isUser) {
    return (
      <div
        className={cn(
          "flex w-full justify-end",
          className,
        )}
      >
        <div className="flex max-w-[85%] flex-col items-end sm:max-w-[75%]">
          <div className="rounded-[14px] border-ledger bg-ledger-stone px-4 py-3 text-receipt-field shadow-base">
            <span className="sr-only">You: </span>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed sm:text-[15px]">
              {message.content}
            </p>
          </div>
          {formattedTime ? (
            <time
              dateTime={message.timestamp}
              className="mt-1 font-proof text-[10px] text-receipt-grey"
            >
              {formattedTime}
            </time>
          ) : null}
        </div>
      </div>
    );
  }

  // Assistant message
  const intent = message.intent;

  return (
    <div
      className={cn(
        "flex w-full justify-start gap-2.5 sm:gap-3",
        className,
      )}
    >
      {/* Providus Brand Avatar */}
      <div
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-ledger bg-provident-green text-white shadow-none"
        aria-hidden="true"
      >
        <span className="font-display text-xs font-bold tracking-tight">P</span>
      </div>

      <div className="flex max-w-[88%] flex-1 flex-col items-start sm:max-w-[80%]">
        <div className="w-full rounded-[14px] border-ledger bg-clear-paper px-4 py-3 text-ledger-stone shadow-base">
          <div className="mb-1 flex items-center justify-between gap-2 border-b border-ledger-edge/60 pb-1">
            <div className="flex items-center gap-1.5">
              <span className="font-display text-xs font-semibold text-ledger-stone">
                Providus
              </span>
              <span className="inline-flex items-center gap-0.5 rounded bg-receipt-field px-1.5 py-0.2 font-proof text-[10px] text-receipt-grey border border-ledger-edge">
                <Sparkles className="h-2.5 w-2.5 text-provident-green" />
                Assistant
              </span>
            </div>

            {intent ? (
              <span className="inline-flex items-center gap-1 font-proof text-[10px] text-quote-blue">
                {intent.type === "airtime" ? (
                  <>
                    <Smartphone className="h-3 w-3" />
                    <span>Airtime Intent</span>
                  </>
                ) : (
                  <>
                    <HelpCircle className="h-3 w-3" />
                    <span className="capitalize">{intent.type}</span>
                  </>
                )}
              </span>
            ) : null}
          </div>

          <span className="sr-only">Providus Assistant: </span>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed sm:text-[15px] text-ledger-stone">
            {message.content}
          </p>

          {/* Turn intent summary tag if attached */}
          {intent && intent.type === "airtime" ? (
            <div className="mt-2.5 rounded-[8px] border border-ledger-edge bg-receipt-field px-2.5 py-1.5 text-xs">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-proof text-[11px] text-receipt-grey">
                {intent.amountNgn ? (
                  <span className="font-semibold text-ledger-stone">
                    ₦{intent.amountNgn}
                  </span>
                ) : null}
                {intent.phone ? <span>{intent.phone}</span> : null}
                {intent.network ? (
                  <span className="uppercase text-ledger-stone">
                    {intent.network}
                    {intent.networkConfirmed ? (
                      <span className="ml-1 text-provident-green font-normal">
                        (confirmed)
                      </span>
                    ) : (
                      <span className="ml-1 text-rate-amber font-normal">
                        (unconfirmed)
                      </span>
                    )}
                  </span>
                ) : null}
                {intent.readyForConfirmation ? (
                  <span className="ml-auto inline-flex items-center gap-1 text-provident-green">
                    <ShieldCheck className="h-3 w-3" />
                    Ready
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {formattedTime ? (
          <time
            dateTime={message.timestamp}
            className="mt-1 font-proof text-[10px] text-receipt-grey"
          >
            {formattedTime}
          </time>
        ) : null}
      </div>
    </div>
  );
}
