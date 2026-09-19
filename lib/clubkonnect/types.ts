/**
 * ClubKonnect boundary types.
 * Pure definitions safe for shared type imports.
 */

export type ClubKonnectNetworkCode = "01" | "02" | "03" | "04";

export type ClubKonnectNetwork = "mtn" | "glo" | "9mobile" | "airtel";

export interface ClubKonnectConfig {
  userId: string;
  apiKey: string;
  baseUrl: string;
}

export type ClubKonnectErrorCode =
  | "MISSING_CONFIG"
  | "INVALID_INPUT"
  | "NETWORK_ERROR"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_ERROR"
  | "AUTH_FAILED"
  | "PROVIDER_NETWORK_UNRESPONSIVE"
  | "PROVIDER_FLOAT_EXHAUSTED"
  | "UNKNOWN_OUTCOME"
  | "RECONCILIATION_REQUIRED";

export type ClubKonnectResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      code: ClubKonnectErrorCode;
      message: string;
      statusCode?: number | string;
      rawStatus?: string;
      diagnosticId?: string;
    };

export interface AirtimeOrderInput {
  transactionId: string;
  phone: string;
  amountNgn: number;
  network: ClubKonnectNetwork;
  callBackUrl?: string;
}

export interface AirtimeRequestPayload {
  UserID: string;
  APIKey: string;
  MobileNetwork: ClubKonnectNetworkCode;
  Amount: string;
  MobileNumber: string;
  RequestID: string;
  CallBackURL?: string;
}

export interface ClubKonnectRawResponse {
  status?: string;
  statuscode?: string | number;
  statusCode?: string | number;
  status_code?: string | number;
  msg?: string;
  message?: string;
  orderid?: string | number;
  orderId?: string | number;
  requestid?: string;
  requestId?: string;
  balance?: string | number;
  walletbalance?: string | number;
  [key: string]: unknown;
}

export type NormalizedFulfilmentStatus =
  | "processing"
  | "completed"
  | "failed"
  | "unknown";

export interface NormalizedFulfilmentResult {
  status: NormalizedFulfilmentStatus;
  isPending: boolean;
  isFinal: boolean;
  isSuccess: boolean;
  statusCode: string;
  rawStatusText: string;
  orderId?: string;
  requestId?: string;
  failureCode?: ClubKonnectErrorCode;
  failureReason?: string;
}

export interface WalletBalanceResult {
  balanceNgn: string;
  rawResponse: Record<string, unknown>;
}
