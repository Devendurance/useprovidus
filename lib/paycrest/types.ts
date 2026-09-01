export type PaycrestSide = "buy" | "sell";
export type CorridorNetwork = "celo";
export type CorridorToken = "USDC";
export type CorridorFiat = "NGN";

export type CorridorQuote =
  | {
      available: true;
      side: PaycrestSide;
      network: "celo";
      token: "USDC";
      fiat: "NGN";
      cryptoAmount: string;
      rate: string; // fiat per 1 token as string from Paycrest
      providerCount: number;
      orderType: string | null;
      refundTimeoutMinutes: number | null;
      checkedAt: string; // ISO UTC
      live: true;
    }
  | {
      available: false;
      side: PaycrestSide;
      network: "celo";
      token: "USDC";
      fiat: "NGN";
      reason: "NO_PROVIDER";
      checkedAt: string;
      live: true;
    };

export type InstitutionSummary = {
  code: string;
  name: string;
  type?: string | null;
};

export type CeloUsdcToken = {
  symbol: "USDC";
  network: "celo";
  contractAddress: string;
  decimals: number;
  baseCurrency?: string;
};

export type SafeValidationDetail = {
  field: string;
  message: string;
};

export type PaycrestErrorCode =
  | "MISSING_CONFIG"
  | "INVALID_INPUT"
  | "PAYCREST_VALIDATION_FAILED"
  | "PAYCREST_ORDER_REJECTED"
  | "AUTH_FAILED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_UNAVAILABLE"
  | "PARSE_ERROR"
  | "TOKEN_NOT_FOUND";

export type PaycrestResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: PaycrestErrorCode;
      message: string;
      httpStatus?: number;
      validationDetails?: SafeValidationDetail[];
      /** Correlates one browser failure with one server log; never contains PII. */
      diagnosticId?: string;
      envelopeShape?: string;
    };
