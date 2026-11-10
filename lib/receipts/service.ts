import { and, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { botReceiptStatus, celoReceiptStatus, compareReceiptsNewest, receiptNetwork } from "@/lib/receipts/domain";
import type { DbClient } from "@/lib/db";
import {
  agentTransactions,
  transferSubmissions,
  walletTransferIntents,
} from "@/lib/db/schema";
import { CHAIN_REGISTRY } from "@/lib/chains/registry";
import { CELO_CHAIN_ID, CELO_EXPLORER_URL } from "@/lib/wallet/celo";
import type {
  ReceiptDetail,
  ReceiptFilters,
  ReceiptListPage,
  ReceiptNetworkKey,
  ReceiptPreview,
} from "@/lib/receipts/types";

type Cursor = { createdAt: string; id: string };

type BotJoinRow = {
  intent: typeof walletTransferIntents.$inferSelect;
  submission: typeof transferSubmissions.$inferSelect;
};

const VALID_NETWORKS = new Set<ReceiptNetworkKey>(["celo", "bot-mainnet", "bot-testnet"]);

function normalized(value: string | undefined, max = 80): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof decoded === "object" && decoded !== null &&
      "createdAt" in decoded && typeof decoded.createdAt === "string" &&
      Number.isFinite(Date.parse(decoded.createdAt)) &&
      "id" in decoded && typeof decoded.id === "string" &&
      /^(bot|celo):[^\s]{1,256}$/.test(decoded.id)
    ) {
      return { createdAt: decoded.createdAt, id: decoded.id };
    }
  } catch {
    return null;
  }
  return null;
}

function encodeCursor(receipt: ReceiptPreview): string {
  return Buffer.from(
    JSON.stringify({ createdAt: receipt.createdAt, id: receipt.id }),
  ).toString("base64url");
}

function cursorCondition(
  createdAt: typeof agentTransactions.createdAt | typeof transferSubmissions.createdAt,
  prefixedId: SQL<string>,
  cursor: Cursor | null,
): SQL | undefined {
  if (!cursor) return undefined;
  return or(
    lt(createdAt, cursor.createdAt),
    and(eq(createdAt, cursor.createdAt), lt(prefixedId, cursor.id)),
  );
}



function botStatusCondition(status: string): SQL | undefined {
  if (!status) return undefined;
  switch (status) {
    case "verified":
      return and(
        eq(transferSubmissions.status, "confirmed"),
        sql`${transferSubmissions.verifiedAt} IS NOT NULL`,
      );
    case "pending":
      return or(
        eq(transferSubmissions.status, "submitted"),
        and(
          eq(transferSubmissions.status, "confirmed"),
          isNull(transferSubmissions.verifiedAt),
        ),
      );
    case "unknown":
    case "failed":
      return eq(transferSubmissions.status, status);
    default:
      return sql`false`;
  }
}

function celoStatusCondition(status: string): SQL | undefined {
  if (!status) return undefined;
  if (status === "verified") return sql`false`;
  return eq(agentTransactions.status, status);
}

function botSearchCondition(search: string): SQL | undefined {
  if (!search) return undefined;
  const pattern = `%${escapeLike(search)}%`;
  return or(
    ilike(walletTransferIntents.id, pattern),
    ilike(walletTransferIntents.recipientAddress, pattern),
    ilike(walletTransferIntents.recipientLabel, pattern),
    ilike(walletTransferIntents.amountDisplay, pattern),
    ilike(walletTransferIntents.assetSymbol, pattern),
    ilike(transferSubmissions.txHash, pattern),
    ilike(transferSubmissions.status, pattern),
  );
}

function celoAssetExpression() {
  return sql<string>`upper(coalesce(${agentTransactions.metadata}->>'asset', 'USDC'))`;
}

function celoSearchCondition(search: string): SQL | undefined {
  if (!search) return undefined;
  const pattern = `%${escapeLike(search)}%`;
  return or(
    ilike(agentTransactions.id, pattern),
    ilike(agentTransactions.celoTxHash, pattern),
    ilike(agentTransactions.amountUsdc, pattern),
    ilike(agentTransactions.amountNgn, pattern),
    ilike(agentTransactions.type, pattern),
    ilike(agentTransactions.status, pattern),
    ilike(agentTransactions.paycrestReference, pattern),
    sql`${agentTransactions.metadata}->>'accountName' ILIKE ${pattern}`,
    sql`${agentTransactions.metadata}->>'institutionName' ILIKE ${pattern}`,
    sql`${agentTransactions.metadata}->>'network' ILIKE ${pattern}`,
    sql`upper(coalesce(${agentTransactions.metadata}->>'asset', 'USDC')) ILIKE ${pattern}`,
  );
}



function botPreview(row: BotJoinRow): ReceiptPreview {
  const intent = row.intent;
  const submission = row.submission;
  const network = receiptNetwork(submission.chainId);
  const verified = submission.status === "confirmed" && Boolean(submission.verifiedAt);
  const status = botReceiptStatus(submission.status, submission.verifiedAt);
  const explorer = submission.txHash ? CHAIN_REGISTRY[network.key === "bot-testnet" ? "botTestnet" : "botMainnet"].explorerUrl : null;
  return {
    id: `bot:${intent.id}`,
    source: "bot",
    createdAt: submission.createdAt,
    network: network.label,
    networkKey: network.key,
    chainId: submission.chainId,
    token: intent.assetSymbol,
    amount: intent.amountDisplay,
    recipientName: intent.recipientLabel,
    recipientAddress: intent.recipientAddress,
    status,
    txHash: submission.txHash,
    explorerUrl: submission.txHash && explorer ? `${explorer}/tx/${submission.txHash}` : null,
    verifiedAt: verified ? submission.verifiedAt : null,
  };
}

function metadataString(metadata: unknown, key: string): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function celoPreview(row: typeof agentTransactions.$inferSelect): ReceiptPreview {
  const rawAsset = metadataString(row.metadata, "asset")?.toUpperCase();
  const token = rawAsset === "CNGN" ? "cNGN" : "USDC";
  const network = receiptNetwork(CELO_CHAIN_ID);
  const accountName = metadataString(row.metadata, "accountName");
  const institution = metadataString(row.metadata, "institutionName") ?? metadataString(row.metadata, "institution");
  const mobileNetwork = metadataString(row.metadata, "network");
  const recipientName = accountName ?? institution ?? (row.type === "airtime" && mobileNetwork ? `${mobileNetwork} airtime` : row.type === "airtime" ? "Airtime" : "Cash-out");
  return {
    id: `celo:${row.id}`,
    source: "celo",
    createdAt: row.createdAt,
    network: network.label,
    networkKey: network.key,
    chainId: CELO_CHAIN_ID,
    token,
    amount: token === "cNGN" && row.amountNgn ? row.amountNgn : row.amountUsdc,
    recipientName,
    recipientAddress: null,
    status: celoReceiptStatus(row.status),
    txHash: row.celoTxHash,
    explorerUrl: row.celoTxHash ? `${CELO_EXPLORER_URL}/tx/${row.celoTxHash}` : null,
    verifiedAt: null,
  };
}

export function isReceiptNetworkKey(value: string): value is ReceiptNetworkKey {
  return VALID_NETWORKS.has(value as ReceiptNetworkKey);
}

export function isValidReceiptCursor(value: string | undefined): boolean {
  return !value || decodeCursor(value) !== null;
}

export async function listOwnerReceipts(
  db: DbClient,
  owner: string,
  filters: ReceiptFilters,
): Promise<ReceiptListPage> {
  const limit = Math.max(1, Math.min(50, Math.floor(filters.limit ?? 20)));
  const search = normalized(filters.search);
  const token = normalized(filters.token, 12).toUpperCase();
  const status = normalized(filters.status, 24).toLowerCase();
  const network = filters.network;
  const cursor = decodeCursor(filters.cursor);
  const candidateLimit = limit + 1;

  const botConditions: SQL[] = [
    eq(transferSubmissions.ownerAddress, owner),
    eq(walletTransferIntents.ownerAddress, owner),
    inArray(transferSubmissions.chainId, [CHAIN_REGISTRY.botMainnet.chainId, CHAIN_REGISTRY.botTestnet.chainId]),
  ];
  const celoConditions: SQL[] = [eq(agentTransactions.walletAddress, owner)];

  if (network === "celo") botConditions.push(sql`false`);
  if (network === "bot-mainnet") botConditions.push(eq(transferSubmissions.chainId, CHAIN_REGISTRY.botMainnet.chainId));
  if (network === "bot-testnet") botConditions.push(eq(transferSubmissions.chainId, CHAIN_REGISTRY.botTestnet.chainId));
  if (network && network !== "celo") celoConditions.push(sql`false`);
  if (token) {
    botConditions.push(sql`upper(${walletTransferIntents.assetSymbol}) = ${token}`);
    celoConditions.push(sql`${celoAssetExpression()} = ${token}`);
  }
  const botStatus = botStatusCondition(status);
  if (botStatus) botConditions.push(botStatus);
  const celoStatus = celoStatusCondition(status);
  if (celoStatus) celoConditions.push(celoStatus);
  const botSearch = botSearchCondition(search);
  if (botSearch) botConditions.push(botSearch);
  const celoSearch = celoSearchCondition(search);
  if (celoSearch) celoConditions.push(celoSearch);

  const botId = sql<string>`'bot:' || ${walletTransferIntents.id}`;
  const celoId = sql<string>`'celo:' || ${agentTransactions.id}`;
  const botCursor = cursorCondition(transferSubmissions.createdAt, botId, cursor);
  const celoCursor = cursorCondition(agentTransactions.createdAt, celoId, cursor);
  if (botCursor) botConditions.push(botCursor);
  if (celoCursor) celoConditions.push(celoCursor);

  const [botRows, celoRows] = await Promise.all([
    db.select({ intent: walletTransferIntents, submission: transferSubmissions })
      .from(transferSubmissions)
      .innerJoin(walletTransferIntents, eq(transferSubmissions.intentId, walletTransferIntents.id))
      .where(and(...botConditions))
      .orderBy(desc(transferSubmissions.createdAt), desc(botId))
      .limit(candidateLimit),
    db.select()
      .from(agentTransactions)
      .where(and(...celoConditions))
      .orderBy(desc(agentTransactions.createdAt), desc(celoId))
      .limit(candidateLimit),
  ]);

  const receipts = [
    ...(botRows as BotJoinRow[]).map(botPreview),
    ...celoRows.map(celoPreview),
  ].sort(compareReceiptsNewest);
  const hasMore = receipts.length > limit;
  const page = receipts.slice(0, limit);
  return {
    receipts: page,
    nextCursor: hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]) : null,
  };
}

export async function getOwnerReceiptDetail(
  db: DbClient,
  owner: string,
  id: string,
): Promise<ReceiptDetail | null> {
  const separator = id.indexOf(":");
  if (separator < 1) return null;
  const source = id.slice(0, separator);
  const rawId = id.slice(separator + 1);
  if (!rawId || rawId.length > 256) return null;

  if (source === "bot") {
    const [row] = await db.select({ intent: walletTransferIntents, submission: transferSubmissions })
      .from(transferSubmissions)
      .innerJoin(walletTransferIntents, eq(transferSubmissions.intentId, walletTransferIntents.id))
      .where(and(
        eq(walletTransferIntents.id, rawId),
        eq(walletTransferIntents.ownerAddress, owner),
        eq(transferSubmissions.ownerAddress, owner),
      ))
      .limit(1);
    if (!row) return null;
    const preview = botPreview(row);
    return {
      ...preview,
      payerAddress: row.submission.ownerAddress,
      paymentContract: row.submission.contractAddress,
      tokenContract: row.intent.tokenAddress,
      blockNumber: row.submission.blockNumber,
      confirmationCount: row.submission.confirmations,
      actualGasFee: null,
      receiptTimestamp: row.submission.verifiedAt,
      statusEvidence: row.submission.verifiedAt && row.submission.status === "confirmed"
        ? "B5 verification recorded"
        : `B5 submission status: ${row.submission.status}`,
    };
  }

  if (source === "celo") {
    const [row] = await db.select()
      .from(agentTransactions)
      .where(and(eq(agentTransactions.id, rawId), eq(agentTransactions.walletAddress, owner)))
      .limit(1);
    if (!row) return null;
    const preview = celoPreview(row);
    return {
      ...preview,
      payerAddress: row.walletAddress,
      paymentContract: null,
      tokenContract: null,
      blockNumber: null,
      confirmationCount: null,
      actualGasFee: null,
      receiptTimestamp: null,
      statusEvidence: `Celo record status: ${row.status}`,
    };
  }

  return null;
}
