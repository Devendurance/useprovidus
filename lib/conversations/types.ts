export type ConversationTurnStatus = "pending" | "complete" | "failed" | "superseded";
export type ConversationFailureCode =
  | "assistant_unavailable"
  | "invalid_output"
  | "rate_limited";

export type ConversationSummary = {
  id: string;
  title: string;
  titleSource: "automatic" | "manual";
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
};

export type ConversationMessageView = {
  id: string;
  sessionId: string;
  turnId: string;
  sequence: number;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  turnStatus?: ConversationTurnStatus;
  failureCode?: ConversationFailureCode | null;
};

export type ConversationListPage = {
  sessions: ConversationSummary[];
  nextCursor: string | null;
};

export type ConversationDetail = {
  session: ConversationSummary;
  messages: ConversationMessageView[];
  olderBeforeSequence: number | null;
};

export type ConversationTurnClaim =
  | {
      kind: "claimed";
      userMessage: ConversationMessageView;
      context: ConversationMessageView[];
      attemptId: string;
    }
  | {
      kind: "replay";
      userMessage: ConversationMessageView;
      assistantMessage: ConversationMessageView;
    }
  | { kind: "in_progress" }
  | { kind: "conflict" }
  | { kind: "stale" }
  | { kind: "not_found" };

export type ConversationTurnCompletion =
  | {
      kind: "completed" | "replay";
      userMessage: ConversationMessageView;
      assistantMessage: ConversationMessageView;
    }
  | { kind: "stale" }
  | { kind: "not_found" };
