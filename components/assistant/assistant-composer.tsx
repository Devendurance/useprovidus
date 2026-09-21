"use client";

import {
  useState,
  useRef,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export interface AssistantComposerProps {
  onSend: (message: string) => void | Promise<void>;
  pending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

const MAX_MESSAGE_LENGTH = 2000;

export function AssistantComposer({
  onSend,
  pending = false,
  disabled = false,
  placeholder = "Type a message or airtime request (e.g. 'Buy ₦500 MTN airtime')...",
  className,
}: AssistantComposerProps) {
  const [content, setContent] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isOverLimit = content.length > MAX_MESSAGE_LENGTH;
  const canSubmit =
    content.trim().length > 0 && !isOverLimit && !pending && !disabled;

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      if (!canSubmit) return;

      const trimmed = content.trim();
      setContent("");

      // Reset textarea height after sending
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      await onSend(trimmed);
    },
    [canSubmit, content, onSend],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setContent(value);

    // Auto-expand textarea up to a max height
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "relative rounded-[14px] border-ledger bg-clear-paper p-3 shadow-base transition-[box-shadow,border-color] focus-within:shadow-elevated",
        className,
      )}
      aria-label="Message composer"
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="assistant-input" className="sr-only">
          Message Providus Assistant
        </label>
        <textarea
          ref={textareaRef}
          id="assistant-input"
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={pending || disabled}
          placeholder={placeholder}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH + 100}
          className="min-h-[44px] w-full resize-none bg-transparent px-2 py-2 text-base text-ledger-stone placeholder:text-receipt-grey/80 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 leading-normal"
          aria-invalid={isOverLimit ? "true" : undefined}
          aria-describedby="composer-meta"
        />

        <div
          id="composer-meta"
          className="flex items-center justify-between border-t border-ledger-edge/60 pt-2"
        >
          <div className="flex items-center gap-2">
            <span className="font-proof text-[11px] text-receipt-grey">
              <kbd className="rounded border border-ledger-edge bg-receipt-field px-1.5 py-0.5 font-mono text-[10px] text-ledger-stone">
                Enter
              </kbd>{" "}
              to send,{" "}
              <kbd className="rounded border border-ledger-edge bg-receipt-field px-1.5 py-0.5 font-mono text-[10px] text-ledger-stone">
                Shift + Enter
              </kbd>{" "}
              for newline
            </span>
            {content.length > 1500 ? (
              <span
                className={cn(
                  "font-proof text-[11px]",
                  isOverLimit
                    ? "font-semibold text-loss-red"
                    : "text-rate-amber",
                )}
              >
                {content.length}/{MAX_MESSAGE_LENGTH}
              </span>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            aria-label="Send message"
            className={cn(
              "inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-[10px] border-ledger bg-provident-green px-4 py-2 font-semibold text-white shadow-base transition-[transform,box-shadow,background-color] duration-100 ease-out",
              "hover:bg-deep-provision hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0_#18211F]",
              "active:translate-x-[3px] active:translate-y-[3px] active:shadow-press",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green",
              "disabled:cursor-not-allowed disabled:bg-receipt-grey disabled:opacity-60 disabled:shadow-none disabled:hover:translate-none",
            )}
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span className="text-xs sm:text-sm font-display">Thinking…</span>
              </>
            ) : (
              <>
                <span className="text-xs sm:text-sm font-display">Send</span>
                <Send className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
