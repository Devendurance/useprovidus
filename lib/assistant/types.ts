/**
 * Client-safe contracts for the conversational assistant.
 *
 * This module intentionally contains types only. Server-only implementation
 * belongs in the sibling assistant modules and route handlers.
 */

export type PaymentNetwork = "mtn" | "airtel" | "glo" | "9mobile";

export type UnsupportedIntentType =
  | "data"
  | "electricity"
  | "cable"
  | "unsupported";

export type PaymentIntentType = "airtime" | UnsupportedIntentType;

export interface AirtimeIntent {
  type: "airtime";
  amountNgn?: string;
  phone?: string;
  network?: PaymentNetwork;
  networkConfirmed: boolean;
  missingFields: string[];
  readyForConfirmation: boolean;
}

export interface UnsupportedIntent {
  type: UnsupportedIntentType;
  missingFields: string[];
  readyForConfirmation: false;
}

export type PaymentIntent = AirtimeIntent | UnsupportedIntent;

export interface UserConversationMessage {
  role: "user";
  content: string;
  timestamp: string;
  intent?: never;
}

export interface AssistantConversationMessage {
  role: "assistant";
  content: string;
  timestamp: string;
  intent?: PaymentIntent;
}

export type ConversationMessage =
  | UserConversationMessage
  | AssistantConversationMessage;

export type ChatAssistantTurn = {
  kind: "chat";
  message: AssistantConversationMessage & { intent?: never };
};

export type PaymentIntentAssistantTurn = {
  kind: "payment_intent";
  message: AssistantConversationMessage & { intent: PaymentIntent };
  intent: PaymentIntent;
};

export type AssistantTurn = ChatAssistantTurn | PaymentIntentAssistantTurn;

export interface AssistantChatRequest {
  message: string;
  history: ConversationMessage[];
  activeIntent: PaymentIntent | null;
}

export type AssistantApiErrorCode =
  | "INVALID_REQUEST"
  | "BODY_TOO_LARGE"
  | "RATE_LIMITED"
  | "ASSISTANT_NOT_CONFIGURED"
  | "MODEL_UNAVAILABLE"
  | "MODEL_INVALID_OUTPUT"
  | "STATUS_UNAVAILABLE";

export type AssistantChatResponse =
  | {
      ok: true;
      turn: AssistantTurn;
      activeIntent: PaymentIntent | null;
    }
  | {
      ok: false;
      error: {
        code: AssistantApiErrorCode;
        message: string;
        retryable?: boolean;
      };
    };

export interface ModelIntentCandidate {
  type: PaymentIntentType;
  amountNgn?: string | null;
  phone?: string | null;
  network?: PaymentNetwork | null;
}

export interface AssistantModelOutput {
  mode: "chat" | "payment_intent";
  reply: string;
  intent: ModelIntentCandidate | null;
}
