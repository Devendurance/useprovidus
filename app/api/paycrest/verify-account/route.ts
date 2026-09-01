import {
  listNgnBankInstitutions,
  verifyNgnAccountName,
} from "@/lib/paycrest/server";
import {
  maskAccountIdentifier,
  validateInstitutionCode,
  validateNgnAccountIdentifier,
} from "@/lib/paycrest/recipient";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = {
  "Cache-Control": "no-store",
} as const;

const MAX_BODY_BYTES = 4_096;

export type VerifyAccountErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_INSTITUTION"
  | "INVALID_ACCOUNT_IDENTIFIER"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_VERIFICATION_FAILED"
  | "PAYCREST_AUTH_ERROR"
  | "PAYCREST_RATE_LIMITED"
  | "PAYCREST_TIMEOUT"
  | "PAYCREST_UNAVAILABLE"
  | "UPSTREAM_ERROR"
  | "CONFIGURATION_ERROR";

function errorResponse(
  code: VerifyAccountErrorCode,
  message: string,
  status: number,
) {
  return NextResponse.json(
    { ok: false, verified: false, error: { code, message } },
    { status, headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return errorResponse(
      "INVALID_REQUEST",
      "Content-Type must be application/json",
      415,
    );
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return errorResponse("INVALID_REQUEST", "Could not read request body", 400);
  }

  if (rawText.length > MAX_BODY_BYTES) {
    return errorResponse("INVALID_REQUEST", "Request body too large", 413);
  }

  let body: unknown;
  try {
    body = rawText === "" ? null : JSON.parse(rawText);
  } catch {
    return errorResponse("INVALID_REQUEST", "Body must be valid JSON", 400);
  }

  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "Body must be a JSON object",
      400,
    );
  }

  const record = body as Record<string, unknown>;
  const allowedKeys = new Set(["institution", "accountIdentifier"]);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      return errorResponse(
        "INVALID_REQUEST",
        "Unexpected fields in request body",
        400,
      );
    }
  }

  // Never accept accountName from the browser
  if ("accountName" in record) {
    return errorResponse(
      "INVALID_REQUEST",
      "accountName must not be supplied by the client",
      400,
    );
  }

  const institutionRaw = record.institution;
  const accountRaw = record.accountIdentifier;

  if (typeof institutionRaw !== "string" || typeof accountRaw !== "string") {
    return errorResponse(
      "INVALID_REQUEST",
      "institution and accountIdentifier are required strings",
      400,
    );
  }

  const accountCheck = validateNgnAccountIdentifier(accountRaw);
  if (!accountCheck.ok) {
    return errorResponse(
      "INVALID_ACCOUNT_IDENTIFIER",
      accountCheck.message,
      400,
    );
  }

  const institutionsResult = await listNgnBankInstitutions();
  if (!institutionsResult.ok) {
    if (institutionsResult.code === "MISSING_CONFIG") {
      return errorResponse(
        "CONFIGURATION_ERROR",
        "Paycrest is not configured",
        500,
      );
    }
    if (institutionsResult.code === "AUTH_FAILED") {
      return errorResponse(
        "PAYCREST_AUTH_ERROR",
        "Paycrest authentication failed",
        502,
      );
    }
    if (institutionsResult.code === "UPSTREAM_TIMEOUT") {
      return errorResponse("PAYCREST_TIMEOUT", "Paycrest timed out", 504);
    }
    return errorResponse(
      "PAYCREST_UNAVAILABLE",
      "Could not load NGN institutions",
      502,
    );
  }

  const institutionCheck = validateInstitutionCode(
    institutionRaw,
    institutionsResult.data,
  );
  if (!institutionCheck.ok) {
    return errorResponse("INVALID_INSTITUTION", institutionCheck.message, 400);
  }

  const verifyResult = await verifyNgnAccountName({
    institution: institutionCheck.data.code,
    accountIdentifier: accountCheck.data,
  });

  if (!verifyResult.ok) {
    if (verifyResult.code === "MISSING_CONFIG") {
      return errorResponse(
        "CONFIGURATION_ERROR",
        "Paycrest is not configured",
        500,
      );
    }
    if (verifyResult.code === "AUTH_FAILED") {
      return errorResponse(
        "PAYCREST_AUTH_ERROR",
        "Paycrest authentication failed",
        502,
      );
    }
    if (verifyResult.code === "UPSTREAM_TIMEOUT") {
      return errorResponse("PAYCREST_TIMEOUT", "Paycrest timed out", 504);
    }
    if (verifyResult.httpStatus === 429) {
      return errorResponse(
        "PAYCREST_RATE_LIMITED",
        "Too many verification requests",
        429,
      );
    }
    if (verifyResult.httpStatus === 404) {
      return errorResponse(
        "ACCOUNT_NOT_FOUND",
        "Account could not be found",
        404,
      );
    }
    if (
      verifyResult.code === "INVALID_INPUT" ||
      verifyResult.httpStatus === 400 ||
      verifyResult.httpStatus === 422
    ) {
      return errorResponse(
        "ACCOUNT_VERIFICATION_FAILED",
        "Account verification was rejected",
        400,
      );
    }
    if (verifyResult.code === "PARSE_ERROR") {
      return errorResponse(
        "ACCOUNT_VERIFICATION_FAILED",
        "Account verification did not return a usable name",
        502,
      );
    }
    if (verifyResult.code === "UPSTREAM_UNAVAILABLE") {
      return errorResponse(
        "PAYCREST_UNAVAILABLE",
        "Paycrest is temporarily unavailable",
        502,
      );
    }
    return errorResponse(
      "UPSTREAM_ERROR",
      "Account verification failed",
      502,
    );
  }

  const verifiedAt = new Date().toISOString();

  return NextResponse.json(
    {
      ok: true,
      verified: true,
      recipient: {
        institution: institutionCheck.data.code,
        accountIdentifierMasked: maskAccountIdentifier(accountCheck.data),
        accountName: verifyResult.data.accountName,
        institutionName: institutionCheck.data.name,
      },
      verifiedAt,
    },
    { status: 200, headers: NO_STORE },
  );
}
