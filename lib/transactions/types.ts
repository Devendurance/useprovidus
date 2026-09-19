import type { TransactionStatus, TransactionType } from "@/lib/db/schema";

export type { TransactionStatus, TransactionType };

export interface TransactionMetadata {
  institution?: string;
  institutionName?: string;
  accountIdentifierMasked?: string;
  accountName?: string;
  rate?: string | null;
  senderFee?: string;
  transactionFee?: string;
  totalUsdcToSend?: string;
  refundAddress?: string;
  [key: string]: unknown;
}

export interface TransactionRecord {
  id: string;
  idempotencyKey: string;
  type: TransactionType;
  status: TransactionStatus;
  walletAddress: string;
  amountUsdc: string;
  amountNgn: string | null;
  celoTxHash: string | null;
  paycrestOrderId: string | null;
  paycrestReference: string;
  paycrestStatus: string | null;
  receiveAddress: string | null;
  validUntil: string | null;
  failureCode: string | null;
  failureReason: string | null;
  metadata?: TransactionMetadata | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTransactionInput {
  id?: string;
  idempotencyKey: string;
  type?: TransactionType;
  walletAddress: string;
  amountUsdc: string;
  amountNgn?: string | null;
  paycrestOrderId?: string | null;
  paycrestReference: string;
  paycrestStatus?: string | null;
  receiveAddress?: string | null;
  validUntil?: string | null;
  metadata?: TransactionMetadata;
}

export interface BindPaycrestOrderInput {
  id: string;
  paycrestOrderId: string;
  paycrestReference?: string;
  receiveAddress: string;
  validUntil?: string | null;
  paycrestStatus?: string | null;
  metadata?: TransactionMetadata;
}

export interface UpdateTransactionStatusInput {
  status: TransactionStatus;
  paycrestStatus?: string | null;
  celoTxHash?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
}

/**
 * Public DTO returned to client. Contains no secrets, internal stack traces,
 * or full bank account numbers.
 */
export interface PublicTransactionDto {
  id: string;
  idempotencyKey: string;
  type: TransactionType;
  status: TransactionStatus;
  walletAddress: string;
  amountUsdc: string;
  amountNgn: string | null;
  celoTxHash: string | null;
  paycrestOrderId: string | null;
  paycrestReference: string;
  paycrestStatus: string | null;
  receiveAddress: string | null;
  validUntil: string | null;
  failureCode: string | null;
  failureReason: string | null;
  metadata?: {
    institutionName?: string;
    accountIdentifierMasked?: string;
    rate?: string | null;
    totalUsdcToSend?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export function toPublicTransactionDto(
  tx: TransactionRecord,
): PublicTransactionDto {
  return {
    id: tx.id,
    idempotencyKey: tx.idempotencyKey,
    type: tx.type,
    status: tx.status,
    walletAddress: tx.walletAddress,
    amountUsdc: tx.amountUsdc,
    amountNgn: tx.amountNgn,
    celoTxHash: tx.celoTxHash,
    paycrestOrderId: tx.paycrestOrderId,
    paycrestReference: tx.paycrestReference,
    paycrestStatus: tx.paycrestStatus,
    receiveAddress: tx.receiveAddress,
    validUntil: tx.validUntil,
    failureCode: tx.failureCode,
    failureReason: tx.failureReason,
    metadata: tx.metadata
      ? {
          institutionName: tx.metadata.institutionName,
          accountIdentifierMasked: tx.metadata.accountIdentifierMasked,
          rate: tx.metadata.rate,
          totalUsdcToSend: tx.metadata.totalUsdcToSend,
        }
      : undefined,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
  };
}
