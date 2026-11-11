"use client";

import { useAssistant } from "@/hooks/use-assistant";
import { MessageList } from "@/components/assistant/message-list";
import { AssistantComposer } from "@/components/assistant/assistant-composer";
import { IntentDraftCard } from "@/components/assistant/intent-draft-card";
import { PaymentInstructionsCard } from "@/components/assistant/payment-instructions-card";
import { cn } from "@/lib/cn";
import {
  Sparkles,
  AlertTriangle,
  X,
  ShieldAlert,
  ReceiptText,
  Loader2,
  Menu,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useWalletAuth, type WalletAuth } from "@/hooks/use-wallet-auth";
import { WalletTransferCard } from "@/components/assistant/wallet-transfer-card";
import { ConnectWalletButton } from "@/components/ui/connect-wallet-button";
import { ConversationHistory } from "@/components/assistant/conversation-history";
import { SharedMemoryPanel } from "@/components/assistant/shared-memory-panel";

export interface AssistantPanelProps {
  className?: string;
}

export function AssistantPanel({ className }: AssistantPanelProps) {
  const auth = useWalletAuth();
  const refreshSession = auth.refreshSession;
  useEffect(() => {
    if (auth.address) void refreshSession();
  }, [auth.address, refreshSession]);
  return <AssistantContent className={className} auth={auth} />;
}

function AssistantContent({ className, auth }: AssistantPanelProps & { auth: WalletAuth }) {
  const {
    messages,
    conversations,
    activeConversationId,
    activeConversationTitle,
    conversationOwner,
    conversationsLoading,
    conversationLoading,
    conversationCreating,
    conversationError,
    conversationCursor,
    olderBeforeSequence,
    olderMessagesLoading,
    retryableMessage,
    walletAction,
    activeIntent,
    pending,
    error,
    send,
    createConversation,
    openConversation,
    renameConversation,
    deleteConversation,
    loadMoreConversations,
    loadOlderMessages,
    retryLastMessage,
    reset,
    preview,
    previewLoading,
    previewError,
    asset,
    selectAsset,
    confirmedPayment,
    confirmPayment,
    refreshPreview,
    editIntent,
    paymentInstructions,
    preparingPayment,
    preparationError,
    depositStatus,
    depositHash,
    depositError,
    confirmDeposit,
    rehydratedTransactionId,
    rehydrating,
    rehydrationError,
    loadTransaction,
  } = useAssistant({ walletTransferOwner: auth.owner, walletAddress: auth.address });
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [lookupId, setLookupId] = useState("");
  const [lookupDismissedFor, setLookupDismissedFor] = useState<string | null>(null);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);

  const displayError = error && error !== dismissedError ? error : null;
  const storedTurnInProgress = messages.some((message) => message.role === "user" && message.turnStatus === "pending");

  return (
    <div
      className={cn(
        "flex flex-col rounded-[14px] border-ledger bg-clear-paper shadow-elevated overflow-hidden",
        className,
      )}
      aria-label="Providus Assistant Panel"
    >
      <div className="border-b border-ledger bg-receipt-field p-4 font-proof text-sm">
        {auth.address ? <>
          <p className="break-all">Connected wallet {auth.address}</p>
          <p className="mt-1" role="status" aria-live="polite">{auth.statusCopy}</p>
          {auth.status === "authenticated" ? <p className="mt-1 text-xs text-receipt-grey">Payments still need explicit wallet approval in the review card.</p> : null}
          {(auth.status === "unauthenticated" || auth.status === "reauthentication-required") && !auth.busy ? <>
            <p className="mt-2 max-w-prose text-xs leading-relaxed text-receipt-grey">Your wallet signs a login message to prove ownership. It does not approve or send a payment.</p>
            <button className="mt-2 min-h-11 rounded-lg border border-ledger bg-clear-paper px-4 disabled:opacity-50" onClick={() => void auth.signIn()}>{auth.status === "reauthentication-required" ? "Sign in again" : "Sign in"}</button>
          </> : null}
        </> : <ConnectWalletButton />}
        {auth.error && <p role="alert" className="mt-2 text-red-700">{auth.error}</p>}
      </div>
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
              <span className="hidden rounded border border-provident-green/40 bg-provident-green/10 px-1.5 py-0.5 font-proof text-[10px] font-semibold text-deep-provision sm:inline-flex">
                Live · payment preview
              </span>
            </div>
            <p className="hidden font-proof text-[11px] text-receipt-grey sm:block">
              Ask for Celo services or BOT Chain Mainnet payments, then approve each in your wallet
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden max-w-40 truncate font-proof text-xs text-receipt-grey sm:block" title={activeConversationTitle ?? undefined}>{activeConversationTitle ?? "New conversation"}</span>
          <SharedMemoryPanel
            ownerAddress={auth.status === "authenticated" ? auth.owner ?? null : null}
            walletAddress={auth.address ?? null}
          />
          <button
            ref={historyTriggerRef}
            type="button"
            onClick={() => setMobileHistoryOpen(true)}
            aria-label="Open conversation history"
            aria-haspopup="dialog"
            className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border border-ledger-edge bg-clear-paper px-3 font-display text-xs font-semibold text-ledger-stone hover:border-ledger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:hidden"
          ><Menu className="h-4 w-4" aria-hidden="true" /><span>Chats</span></button>
        </div>
      </div>

      <div className="flex min-w-0">
      <ConversationHistory
        ownerAvailable={Boolean(conversationOwner)}
        conversations={conversations}
        activeConversationId={activeConversationId}
        activeConversationTitle={activeConversationTitle}
        loading={conversationsLoading}
        creating={conversationCreating}
        error={conversationError}
        hasMore={Boolean(conversationCursor)}
        onNew={() => { if (conversationOwner) void createConversation(); else reset(); }}
        onOpen={openConversation}
        onRename={renameConversation}
        onDelete={deleteConversation}
        onLoadMore={() => void loadMoreConversations()}
        mobileOpen={mobileHistoryOpen}
        onMobileClose={() => setMobileHistoryOpen(false)}
        mobileTriggerRef={historyTriggerRef}
      />
      <div className="flex min-w-0 flex-1 flex-col">
      {conversationLoading ? <div role="status" className="flex min-h-[300px] items-center justify-center gap-2 bg-clear-paper text-sm text-receipt-grey"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Opening conversation</div> : null}

      {/* Payment asset selector: switching requests a fresh preview via selectAsset */}
      {activeIntent && activeIntent.type === "airtime" && activeIntent.readyForConfirmation && !paymentInstructions ? (
        <div className="border-b border-ledger-edge/80 bg-receipt-field/60 px-3 pt-3 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-ledger-edge bg-clear-paper px-3 py-2">
            <span className="font-proof text-[11px] text-receipt-grey">
              Pay with:
            </span>
            <div className="flex items-center gap-1.5" role="group" aria-label="Payment asset">
              {(["USDC", "CNGN"] as const).map((symbol) => {
                const selected = asset === symbol;
                return (
                  <button
                    key={symbol}
                    type="button"
                    onClick={() => {
                      if (!selected && !previewLoading && !preparingPayment) selectAsset(symbol);
                    }}
                    disabled={previewLoading || preparingPayment || selected}
                    aria-pressed={selected}
                    className="inline-flex min-h-[30px] items-center rounded-[6px] border px-2.5 py-1 font-display text-[11px] font-semibold transition-all disabled:cursor-default border-ledger-edge bg-clear-paper text-receipt-grey hover:border-ledger hover:text-ledger-stone disabled:opacity-60 data-[selected=true]:border-ledger data-[selected=true]:bg-ledger-stone data-[selected=true]:text-clear-paper"
                    data-selected={selected}
                  >
                    {symbol === "CNGN" ? "cNGN" : symbol}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      {/* Active Intent Draft Card Preview (Docked if active) */}
      {activeIntent && activeIntent.type !== "wallet_transfer" ? (
        <div className="border-b border-ledger-edge/80 bg-receipt-field/60 p-3 sm:p-4">
          <IntentDraftCard
            intent={activeIntent}
            preview={preview}
            previewLoading={previewLoading}
            previewError={previewError}
            confirmedPayment={confirmedPayment}
            onConfirmPayment={confirmPayment}
            onRefreshPreview={refreshPreview}
            onEditIntent={editIntent}
            paymentInstructions={paymentInstructions}
            preparingPayment={preparingPayment}
            preparationError={preparationError}
            depositStatus={depositStatus}
            depositHash={depositHash}
            depositError={depositError}
            onDepositConfirmed={confirmDeposit}
          />
        </div>
      ) : null}
      {/* Rehydrated payment instructions (detached: no active intent required) */}
      {!activeIntent && paymentInstructions && lookupDismissedFor !== rehydratedTransactionId ? (
        <div className="border-b border-ledger-edge/80 bg-receipt-field/60 p-3 sm:p-4">
          <PaymentInstructionsCard
            instructions={paymentInstructions}
            preview={preview}
            status={depositStatus}
            depositStatus={depositStatus}
            depositHash={depositHash}
            depositError={depositError ?? rehydrationError}
            onDepositConfirmed={confirmDeposit}
            onBackToPreview={() => setLookupDismissedFor(rehydratedTransactionId)}
          />
        </div>
      ) : null}


      {/* Message List */}
      {olderBeforeSequence ? <div className="border-b border-ledger-edge bg-clear-paper px-4 py-2 text-center">
        <button type="button" onClick={() => void loadOlderMessages()} disabled={olderMessagesLoading || conversationLoading} className="inline-flex min-h-11 items-center gap-2 rounded-[8px] px-3 text-xs font-semibold text-quote-blue underline underline-offset-2 hover:bg-receipt-field disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          {olderMessagesLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {olderMessagesLoading ? "Loading earlier messages…" : "Load earlier messages"}
        </button>
      </div> : null}
      <MessageList
        messages={messages}
        pending={pending}
        onSelectSuggestion={send}
        className="bg-clear-paper"
      />
      <WalletTransferCard key={`${auth.address}:${auth.owner}:${activeIntent?.type === "wallet_transfer" ? `${activeIntent.chainId}:${activeIntent.recipientAddress}:${activeIntent.preparedIntentId}` : "recovery"}`} auth={auth} action={walletAction} draft={activeIntent?.type === "wallet_transfer" ? activeIntent : null} send={send} pending={pending} />
      {/* Explicit transaction lookup (resume an unfunded order after reload) */}
      <div className="mx-4 mb-2 rounded-[10px] border border-ledger-edge bg-receipt-field/70 p-3">
        <form
          aria-label="Resume a pending payment"
          onSubmit={(event) => {
            event.preventDefault();
            setLookupDismissedFor(null);
            void loadTransaction(lookupId.trim());
          }}
        >
          <label htmlFor="assistant-transaction-lookup" className="flex items-center gap-1.5 font-proof text-[11px] font-semibold text-ledger-stone">
            <ReceiptText className="h-3.5 w-3.5 text-quote-blue" aria-hidden="true" />
            <span>Resume a pending payment</span>
          </label>
          <p className="mt-1 font-proof text-[11px] leading-relaxed text-receipt-grey">
            Enter a payment ID to reload its payment instructions. Nothing is paid automatically.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="assistant-transaction-lookup"
              type="text"
              value={lookupId}
              onChange={(event) => setLookupId(event.target.value)}
              placeholder="tx_airtime_…"
              autoComplete="off"
              spellCheck={false}
              disabled={rehydrating || pending}
              className="min-h-[38px] w-full flex-1 rounded-[8px] border border-ledger-edge bg-clear-paper px-2.5 py-1.5 font-mono text-xs text-ledger-stone placeholder:text-receipt-grey/70 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-provident-green disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={rehydrating || pending || lookupId.trim() === ""}
              className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-[8px] border border-ledger bg-clear-paper px-3.5 py-1.5 font-display text-xs font-semibold text-ledger-stone shadow-none transition-all hover:border-ledger hover:shadow-base active:translate-x-px active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rehydrating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <span>Loading…</span>
                </>
              ) : (
                <span>Load payment</span>
              )}
            </button>
          </div>
        </form>
        {rehydrationError ? (
          <p role="alert" className="mt-2 font-proof text-[11px] leading-relaxed text-loss-red">
            {rehydrationError}
          </p>
        ) : null}
      </div>


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
          {retryableMessage ? <button type="button" onClick={() => void retryLastMessage()} disabled={pending} className="min-h-11 shrink-0 rounded-[8px] border border-ledger bg-clear-paper px-3 font-display text-xs font-semibold text-ledger-stone hover:bg-receipt-field disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Retry reply</button> : null}
          {storedTurnInProgress && activeConversationId ? <button type="button" onClick={() => void openConversation(activeConversationId)} disabled={conversationLoading} className="min-h-11 shrink-0 rounded-[8px] border border-ledger bg-clear-paper px-3 font-display text-xs font-semibold text-ledger-stone hover:bg-receipt-field disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Refresh conversation</button> : null}
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
          <span>Your wallet stays in your control · every payment needs your explicit approval</span>
        </p>
      </div>

      {/* Composer */}
      <div className="border-t border-ledger bg-receipt-field p-3 sm:p-4">
        <AssistantComposer onSend={send} pending={pending} />
      </div>
      </div>
      </div>
    </div>
  );
}
