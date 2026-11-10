export type ReceiptSource = "bot" | "celo";

export type ReceiptNetworkKey = "celo" | "bot-mainnet" | "bot-testnet";

export type ReceiptPreview = {
  id: string;
  source: ReceiptSource;
  createdAt: string;
  network: string;
  networkKey: ReceiptNetworkKey;
  chainId: number;
  token: string;
  amount: string;
  recipientName: string;
  recipientAddress: string | null;
  status: string;
  txHash: string | null;
  explorerUrl: string | null;
  verifiedAt: string | null;
};

export type ReceiptDetail = ReceiptPreview & {
  payerAddress: string;
  paymentContract: string | null;
  tokenContract: string | null;
  blockNumber: number | null;
  confirmationCount: number | null;
  actualGasFee: string | null;
  receiptTimestamp: string | null;
  statusEvidence: string;
};

export type ReceiptFilters = {
  search?: string;
  network?: ReceiptNetworkKey;
  token?: string;
  status?: string;
  cursor?: string;
  limit?: number;
};

export type ReceiptListPage = {
  receipts: ReceiptPreview[];
  nextCursor: string | null;
};
