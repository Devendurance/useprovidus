"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Loader2,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { ConversationSummary } from "@/lib/conversations/types";

type ConversationHistoryProps = {
  ownerAvailable: boolean;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  activeConversationTitle: string | null;
  loading: boolean;
  creating: boolean;
  error: string | null;
  hasMore: boolean;
  onNew: () => void;
  onOpen: (sessionId: string) => Promise<boolean>;
  onRename: (sessionId: string, title: string) => Promise<boolean>;
  onDelete: (sessionId: string) => Promise<boolean>;
  onLoadMore: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
  mobileTriggerRef: React.RefObject<HTMLButtonElement | null>;
};

function dateLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function ConversationHistory(props: ConversationHistoryProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const mobileDialogRef = useRef<HTMLDialogElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!props.mobileOpen) return;
    const dialog = mobileDialogRef.current;
    if (!dialog) return;
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const firstFocusable = dialog.querySelector<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
    );
    firstFocusable?.focus();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
      if (props.mobileTriggerRef.current?.isConnected) props.mobileTriggerRef.current.focus();
    };
  }, [props.mobileOpen, props.mobileTriggerRef]);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  const startRename = (session: ConversationSummary) => {
    setEditingId(session.id);
    setEditingTitle(session.title);
  };

  const saveRename = async (sessionId: string) => {
    const title = editingTitle.trim();
    if (!title) return;
    if (await props.onRename(sessionId, title)) setEditingId(null);
  };

  const openSession = async (sessionId: string) => {
    await props.onOpen(sessionId);
    props.onMobileClose();
  };

  const listContent = (mobile = false) => (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-ledger-edge px-3 py-3">
        {!collapsed || mobile ? <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-ledger-stone">Your conversations</p>
          <p className="mt-0.5 text-xs text-receipt-grey">Private to this wallet</p>
        </div> : <span className="sr-only">Your conversations</span>}
        {!mobile ? <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] text-ledger-stone hover:bg-receipt-field focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          aria-label={collapsed ? "Expand conversation history" : "Collapse conversation history"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
        </button> : <button
          type="button"
          onClick={props.onMobileClose}
          className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-ledger-stone hover:bg-receipt-field focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          aria-label="Close conversation history"
        ><X className="h-5 w-5" aria-hidden="true" /></button>}
      </div>

      <div className="p-3">
        <button
          type="button"
          onClick={() => { props.onNew(); if (mobile) props.onMobileClose(); }}
          disabled={props.creating}
          className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] border border-ledger bg-provident-green px-3 text-sm font-semibold text-white hover:bg-deep-provision disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${collapsed && !mobile ? "px-0" : ""}`}
          aria-label="Start a new conversation"
        >
          {props.creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          {!collapsed || mobile ? <span>New chat</span> : null}
        </button>
        {!props.ownerAvailable ? <p className="mt-3 rounded-[8px] bg-receipt-field px-3 py-2.5 text-xs leading-5 text-receipt-grey">
          Sign in with your connected wallet to save and return to conversations.
        </p> : null}
      </div>

      {(!collapsed || mobile) ? <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <h3 className="px-2 pb-2 pt-1 font-proof text-[11px] font-semibold uppercase tracking-wide text-receipt-grey">Recent</h3>
        {props.loading && props.conversations.length === 0 ? <div className="flex items-center gap-2 px-3 py-4 text-xs text-receipt-grey" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading conversations
        </div> : null}
        {!props.loading && props.ownerAvailable && props.conversations.length === 0 ? <p className="px-3 py-3 text-xs leading-5 text-receipt-grey">Your saved conversations will appear here.</p> : null}
        {props.conversations.map((session) => {
          const active = props.activeConversationId === session.id;
          const editing = editingId === session.id;
          return <div key={session.id} className={`group relative mb-1 rounded-[8px] border ${active ? "border-provident-green/50 bg-provident-green/10" : "border-transparent hover:border-ledger-edge hover:bg-receipt-field"}`}>
            <div className="flex min-w-0 items-start gap-1">
              <button
                type="button"
                onClick={() => void openSession(session.id)}
                aria-current={active ? "page" : undefined}
                className="flex min-h-11 min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-focus"
              >
                <MessageSquareText className={`mt-0.5 h-4 w-4 shrink-0 ${active ? "text-provident-green" : "text-receipt-grey"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  {editing ? <span className="sr-only">Editing conversation title</span> : <span className="block truncate text-xs font-medium text-ledger-stone">{session.title || "New conversation"}</span>}
                  {!editing ? <span className="mt-0.5 block text-[10px] text-receipt-grey">{dateLabel(session.lastMessageAt ?? session.updatedAt)}</span> : null}
                </span>
              </button>
              {editing ? <form className="absolute z-10 mx-2 mt-9 flex w-[min(18rem,70vw)] gap-1 rounded-[8px] border border-ledger-edge bg-clear-paper p-2 shadow-elevated" onSubmit={(event) => { event.preventDefault(); void saveRename(session.id); }}>
                <input ref={editInputRef} value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} maxLength={80} aria-label="Conversation title" className="min-h-10 min-w-0 flex-1 rounded-[6px] border border-ledger-edge bg-white px-2 text-sm text-ledger-stone focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus" />
                <button type="submit" disabled={!editingTitle.trim()} aria-label="Save title" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-provident-green text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><Check className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" onClick={() => setEditingId(null)} aria-label="Cancel rename" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] text-ledger-stone hover:bg-receipt-field focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><X className="h-4 w-4" aria-hidden="true" /></button>
              </form> : <div className="mr-1 flex shrink-0 items-center gap-0.5 py-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <button type="button" onClick={() => startRename(session)} aria-label={`Rename ${session.title}`} className="inline-flex h-9 w-9 items-center justify-center rounded-[6px] text-receipt-grey hover:bg-clear-paper hover:text-ledger-stone focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"><Pencil className="h-3.5 w-3.5" aria-hidden="true" /></button>
                <button type="button" onClick={() => { if (window.confirm(`Delete “${session.title}”? This conversation will be permanently removed.`)) void props.onDelete(session.id); }} aria-label={`Delete ${session.title}`} className="inline-flex h-9 w-9 items-center justify-center rounded-[6px] text-receipt-grey hover:bg-loss-red/10 hover:text-loss-red focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
              </div>}
            </div>
          </div>;
        })}
        {props.hasMore ? <button type="button" onClick={props.onLoadMore} disabled={props.loading} className="mt-2 min-h-11 w-full rounded-[8px] px-3 text-xs font-semibold text-quote-blue underline underline-offset-2 hover:bg-receipt-field disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">{props.loading ? "Loading…" : "Load older conversations"}</button> : null}
        {props.error ? <p role="alert" className="mx-1 mt-2 rounded-[8px] bg-loss-red/10 px-3 py-2 text-xs leading-5 text-loss-red">{props.error}</p> : null}
      </div> : null}
    </>
  );

  return <>
    <aside className={`hidden shrink-0 flex-col border-r border-ledger-edge bg-clear-paper transition-[width] duration-150 motion-reduce:transition-none md:flex ${collapsed ? "w-14" : "w-64 lg:w-72"}`} aria-label="Conversation history">
      {listContent()}
    </aside>
    {typeof document !== "undefined" && props.mobileOpen ? createPortal(
      <dialog
        ref={mobileDialogRef}
        aria-label="Conversation history"
        className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0 text-ledger-stone backdrop:bg-ink/55 md:hidden"
        onCancel={(event) => { event.preventDefault(); props.onMobileClose(); }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          props.onMobileClose();
          window.requestAnimationFrame(() => props.mobileTriggerRef.current?.focus());
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = [...(mobileDialogRef.current?.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
          ) ?? [])].filter((element) => element.offsetParent !== null);
          const first = focusable[0];
          const last = focusable.at(-1);
          if (!first || !last) {
            event.preventDefault();
            return;
          }
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <aside className="flex h-full w-[min(21rem,88vw)] flex-col border-r border-ledger-edge bg-clear-paper pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-elevated" aria-label="Your conversations">
          {listContent(true)}
        </aside>
      </dialog>,
      document.body,
    ) : null}
  </>;
}
