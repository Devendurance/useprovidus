"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Bookmark, Check, Loader2, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { useSharedMemory } from "@/hooks/use-shared-memory";
import type { SharedMemoryKind, SharedMemoryView } from "@/lib/shared-memory/service";

type Draft = { kind: SharedMemoryKind; label: string; value: string };

function dateLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "date unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function SharedMemoryPanel(props: {
  ownerAddress: string | null;
  walletAddress: string | null;
}) {
  const ownerKey =
    props.ownerAddress &&
    props.walletAddress &&
    props.ownerAddress.toLowerCase() === props.walletAddress.toLowerCase()
      ? props.ownerAddress.toLowerCase()
      : "unsigned";
  return <SharedMemoryPanelContent key={ownerKey} {...props} />;
}

function SharedMemoryPanelContent(props: {
  ownerAddress: string | null;
  walletAddress: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<Draft>({ kind: "fact", label: "", value: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>({ kind: "fact", label: "", value: "" });
  const [editConflictId, setEditConflictId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteConflictId, setDeleteConflictId] = useState<string | null>(null);
  const [createRequestId, setCreateRequestId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ownerIsCurrent = Boolean(
    props.ownerAddress &&
    props.walletAddress &&
    props.ownerAddress.toLowerCase() === props.walletAddress.toLowerCase(),
  );
  const memory = useSharedMemory({
    ownerAddress: ownerIsCurrent ? props.ownerAddress : null,
    walletAddress: props.walletAddress,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const priorBodyOverflow = document.body.style.overflow;
    const priorHtmlOverflow = document.documentElement.style.overflow;
    if (!dialog.open) dialog.showModal();
    const keepFocusInDialog = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", keepFocusInDialog);
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    dialog.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])")?.focus();
    return () => {
      dialog.removeEventListener("keydown", keepFocusInDialog);
      if (dialog.open) dialog.close();
      document.body.style.overflow = priorBodyOverflow;
      document.documentElement.style.overflow = priorHtmlOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestId = createRequestId ?? window.crypto.randomUUID();
    setCreateRequestId(requestId);
    const result = await memory.create({ requestId, ...createDraft });
    if (!result.ok) return;
    setCreateRequestId(null);
    setCreateDraft({ kind: "fact", label: "", value: "" });
    setCreateOpen(false);
  }

  function edit(memoryItem: SharedMemoryView) {
    setEditingId(memoryItem.id);
    setEditDraft({ kind: memoryItem.kind, label: memoryItem.label, value: memoryItem.value });
    setEditConflictId(null);
    setDeleteConflictId(null);
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>, item: SharedMemoryView) {
    event.preventDefault();
    const result = await memory.update(item.id, {
      expectedVersion: item.version,
      ...editDraft,
    });
    if (result.ok) {
      setEditingId(null);
      setEditConflictId(null);
    } else if (result.code === "STALE_VERSION") {
      setEditConflictId(item.id);
    }
  }

  async function remove(item: SharedMemoryView) {
    const result = await memory.remove(item.id, item.version);
    if (result.ok) {
      setDeleteId(null);
      setDeleteConflictId(null);
    } else if (result.code === "STALE_VERSION") {
      setDeleteConflictId(item.id);
    }
  }

  const renderFields = (
    draft: Draft,
    setDraft: (value: Draft) => void,
    formId: string,
    onAnyChange: () => void,
  ) => (
    <>
      <label className="block font-proof text-xs font-semibold text-ledger-stone" htmlFor={`${formId}-kind`}>Type</label>
      <select
        id={`${formId}-kind`}
        value={draft.kind}
        onChange={(event) => { onAnyChange(); setDraft({ ...draft, kind: event.target.value as SharedMemoryKind }); }}
        className="mt-1 min-h-11 w-full rounded-[8px] border border-ledger-edge bg-white px-3 text-sm text-ledger-stone focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <option value="fact">Fact</option>
        <option value="preference">Preference</option>
      </select>
      <label className="mt-3 block font-proof text-xs font-semibold text-ledger-stone" htmlFor={`${formId}-label`}>Name this memory</label>
      <input
        id={`${formId}-label`}
        value={draft.label}
        onChange={(event) => { onAnyChange(); setDraft({ ...draft, label: event.target.value }); }}
        maxLength={48}
        required
        className="mt-1 min-h-11 w-full rounded-[8px] border border-ledger-edge bg-white px-3 text-sm text-ledger-stone focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        placeholder="Preferred network"
      />
      <label className="mt-3 block font-proof text-xs font-semibold text-ledger-stone" htmlFor={`${formId}-value`}>What should Providus remember?</label>
      <textarea
        id={`${formId}-value`}
        value={draft.value}
        onChange={(event) => { onAnyChange(); setDraft({ ...draft, value: event.target.value }); }}
        maxLength={300}
        required
        rows={3}
        className="mt-1 w-full resize-y rounded-[8px] border border-ledger-edge bg-white px-3 py-2.5 text-sm leading-5 text-ledger-stone focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        placeholder="Use Celo for payment suggestions. Ask me to confirm each time."
      />
    </>
  );

  const listVisible = memory.memories;

  return <>
    <button
      ref={triggerRef}
      type="button"
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      aria-label="Manage shared memory"
      className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border border-ledger-edge bg-clear-paper px-3 font-display text-xs font-semibold text-ledger-stone hover:border-ledger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    ><Bookmark className="h-4 w-4" aria-hidden="true" /><span>Memory</span></button>

    {typeof document !== "undefined" && open ? createPortal(
      <dialog
        ref={dialogRef}
        aria-labelledby="shared-memory-title"
        aria-describedby="shared-memory-description"
        className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0 text-ledger-stone backdrop:bg-ink/55 sm:m-auto sm:h-auto sm:max-h-[92dvh] sm:w-[min(42rem,calc(100vw-2rem))]"
        onCancel={(event) => { event.preventDefault(); setOpen(false); }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <section className="flex max-h-[100dvh] min-h-full flex-col bg-clear-paper pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] sm:min-h-0 sm:max-h-[92dvh] sm:rounded-[14px] sm:shadow-elevated">
          <header className="flex items-start justify-between gap-4 border-b border-ledger-edge px-4 py-4 sm:px-6">
            <div className="min-w-0">
              <p className="font-proof text-[10px] font-semibold uppercase tracking-[0.13em] text-deep-provision">Across your chats</p>
              <h2 id="shared-memory-title" className="mt-1 font-display text-lg font-semibold text-ledger-stone">Saved memory</h2>
              <p id="shared-memory-description" className="mt-1 max-w-[35rem] text-sm leading-5 text-receipt-grey">
                Only facts and preferences you add here can carry into future conversations. Memory never approves a payment.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close saved memory"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] text-ledger-stone hover:bg-receipt-field focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            ><X className="h-5 w-5" aria-hidden="true" /></button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {!ownerIsCurrent ? <div className="rounded-[8px] border border-ledger-edge bg-receipt-field px-4 py-3 text-sm leading-5 text-ledger-stone">
              Sign in with the connected wallet to manage memory shared across its conversations.
            </div> : null}

            {ownerIsCurrent && memory.loading && listVisible.length === 0 ? <p role="status" className="flex items-center gap-2 py-6 text-sm text-receipt-grey"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading saved memory</p> : null}

            {ownerIsCurrent && memory.error ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-loss-red/30 bg-loss-red/5 px-3 py-2.5">
              <p role="alert" className="text-sm leading-5 text-loss-red">{memory.error}</p>
              <button type="button" onClick={() => void memory.reload()} className="inline-flex min-h-10 items-center gap-2 rounded-[7px] px-3 text-sm font-semibold text-ledger-stone underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry</button>
            </div> : null}

            {ownerIsCurrent && memory.notice ? <p role="status" aria-live="polite" className="mb-3 rounded-[8px] bg-provident-green/10 px-3 py-2 text-sm text-deep-provision">{memory.notice}</p> : null}

            {ownerIsCurrent && !memory.loading && listVisible.length === 0 && !createOpen ? <div className="border-b border-ledger-edge py-5">
              <p className="font-display text-sm font-semibold text-ledger-stone">Nothing saved for future chats</p>
              <p className="mt-1 max-w-[34rem] text-sm leading-5 text-receipt-grey">Providus won’t save conversation details automatically. Add a fact or preference only when you want to reuse it.</p>
            </div> : null}

            {ownerIsCurrent ? listVisible.map((item) => {
              const editing = editingId === item.id;
              const deleting = deleteId === item.id;
              return <article key={item.id} className="border-b border-ledger-edge py-4">
                {editing ? <form onSubmit={(event) => void submitEdit(event, item)}>
                  {renderFields(editDraft, setEditDraft, `edit-${item.id}`, () => setEditConflictId(null))}
                  {editConflictId === item.id ? <div className="mt-3 rounded-[8px] border border-loss-red/30 bg-loss-red/5 p-3">
                    <p className="text-sm leading-5 text-loss-red">This memory changed in another tab. Your draft is still here. Reload the latest version before deciding what to save.</p>
                    <button type="button" onClick={() => { setEditConflictId(null); void memory.reload(); }} className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-[7px] px-2 text-sm font-semibold text-ledger-stone underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Reload saved memories</button>
                  </div> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="submit" disabled={memory.saving} className="inline-flex min-h-11 items-center gap-2 rounded-[8px] bg-provident-green px-4 text-sm font-semibold text-white hover:bg-deep-provision disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><Save className="h-4 w-4" aria-hidden="true" />Save changes</button>
                    <button type="button" onClick={() => { setEditingId(null); setEditConflictId(null); }} className="min-h-11 rounded-[8px] border border-ledger-edge px-4 text-sm font-semibold text-ledger-stone focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Cancel</button>
                  </div>
                </form> : <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="break-words font-display text-sm font-semibold text-ledger-stone">{item.label}</h3>
                        <span className="rounded border border-ledger-edge px-1.5 py-0.5 font-proof text-[10px] font-semibold uppercase tracking-wide text-receipt-grey">{item.kind}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-ledger-stone">{item.value}</p>
                      <p className="mt-1 text-[11px] text-receipt-grey">Updated {dateLabel(item.updatedAt)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" onClick={() => edit(item)} aria-label={`Edit ${item.label}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-[7px] px-2 text-xs font-semibold text-ledger-stone hover:bg-receipt-field focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><span>Edit</span></button>
                      <button type="button" onClick={() => { setDeleteId(deleting ? null : item.id); setDeleteConflictId(null); }} aria-label={`Delete ${item.label}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-[7px] px-2 text-xs font-semibold text-loss-red hover:bg-loss-red/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /><span>Delete</span></button>
                    </div>
                  </div>
                  <details className="mt-2 text-xs text-receipt-grey">
                    <summary className="min-h-8 w-fit cursor-pointer py-1 font-semibold text-quote-blue underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Why is this remembered?</summary>
                    <p className="mt-1 max-w-[34rem] leading-5">You chose to save this on {dateLabel(item.createdAt)}. Providus may use it as context in future chats. It never approves or sends a payment. Recipient names and wallet addresses stay in saved recipients.</p>
                  </details>
                  {deleting ? <div className="mt-3 rounded-[8px] border border-loss-red/30 bg-loss-red/5 p-3">
                    <p className="text-sm leading-5 text-ledger-stone">Remove this from future chats? Past conversation messages will remain.</p>
                    {deleteConflictId === item.id ? <p role="alert" className="mt-2 text-sm leading-5 text-loss-red">This memory changed elsewhere. Reload the latest version before removing it.</p> : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {deleteConflictId === item.id ? <button type="button" onClick={() => { setDeleteConflictId(null); void memory.reload(); }} className="inline-flex min-h-10 items-center gap-2 rounded-[7px] px-2 text-sm font-semibold text-ledger-stone underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Reload saved memories</button> : <button type="button" onClick={() => void remove(item)} disabled={memory.saving} className="inline-flex min-h-10 items-center gap-2 rounded-[7px] bg-loss-red px-3 text-sm font-semibold text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Remove memory</button>}
                      <button type="button" onClick={() => { setDeleteId(null); setDeleteConflictId(null); }} className="min-h-10 rounded-[7px] border border-ledger-edge px-3 text-sm font-semibold text-ledger-stone focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Keep it</button>
                    </div>
                  </div> : null}
                </>}
              </article>;
            }) : null}

            {ownerIsCurrent && createOpen ? <form className="border-b border-ledger-edge py-4" onSubmit={(event) => void submitCreate(event)}>
              <h3 className="font-display text-sm font-semibold text-ledger-stone">Add a memory</h3>
              <p className="mt-1 text-xs leading-5 text-receipt-grey">Save only a fact or preference you want available in future chats. Never add wallet keys, recovery phrases, signatures, passwords, API keys, wallet addresses, or payment instructions.</p>
              {renderFields(createDraft, setCreateDraft, "create-memory", () => setCreateRequestId(null))}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="submit" disabled={memory.saving || !createDraft.label.trim() || !createDraft.value.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-[8px] bg-provident-green px-4 text-sm font-semibold text-white hover:bg-deep-provision disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><Check className="h-4 w-4" aria-hidden="true" />Save for future chats</button>
                <button type="button" onClick={() => { setCreateOpen(false); setCreateDraft({ kind: "fact", label: "", value: "" }); setCreateRequestId(null); }} className="min-h-11 rounded-[8px] border border-ledger-edge px-4 text-sm font-semibold text-ledger-stone focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Cancel</button>
              </div>
            </form> : null}

            {ownerIsCurrent && !createOpen ? <button type="button" onClick={() => setCreateOpen(true)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-[8px] border border-ledger bg-clear-paper px-3 text-sm font-semibold text-ledger-stone hover:bg-receipt-field focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><Plus className="h-4 w-4" aria-hidden="true" />Add a memory</button> : null}
          </div>
        </section>
      </dialog>,
      document.body,
    ) : null}
  </>;
}
