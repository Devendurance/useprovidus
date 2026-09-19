/**
 * Comprehensive tests for ClubKonnect server boundary:
 * - Compile-time server-only enforcement (static import audit of client source trees)
 * - Server-only config & fail-closed behavior
 * - Redaction of URLs and objects (never leak UserID/APIKey, mask phone)
 * - Airtime request builder validation (network, phone, amount)
 * - Deterministic, collision-resistant RequestID generation
 * - Conservative status normalization (100, 200, 201, 300, 417, unknown)
 * - Safe mock-based wallet balance query and status reconciliation query (read-only GETs only; no purchase path exists in P2, duplicate-mutation safety belongs to P6)
 *
 * Run: npm run test:clubkonnect
 * (uses --conditions=react-server so `server-only` resolves to its server-safe entry outside Next.js)
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getClubKonnectConfig,
  redactClubKonnectUrl,
  redactClubKonnectObject,
  maskPhoneNumber,
} from "@/lib/clubkonnect/server/config";
import {
  normalizeClubKonnectStatus,
  buildClubKonnectRequestId,
} from "@/lib/clubkonnect/server/status";
import {
  normalizeAndValidatePhone,
  validateAirtimeAmount,
  buildAirtimeRequestPayload,
  buildQueryTransactionUrl,
  buildWalletBalanceUrl,
  queryClubKonnectWalletBalance,
  queryClubKonnectTransaction,
} from "@/lib/clubkonnect/server/client";

/** Repository root, derived from this file's location so the audit is cwd-independent. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Client-facing source trees that must never reach the server-only boundary. */
const CLIENT_SOURCE_DIRS = ["app", "components", "hooks"];

/** File extensions scanned by the static import audit. */
const SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;

/**
 * Extracts every import/require/re-export specifier from a source file, including
 * side-effect imports (`import "x"`) and dynamic imports (`import("x")`).
 */
function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const matcher = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"'\n]+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

/** True when a specifier resolves into the server-only ClubKonnect boundary. */
function isServerBoundarySpecifier(specifier: string): boolean {
  return (
    specifier === "server-only" ||
    /(?:^|\/)clubkonnect\/server(?:\/|$)/.test(specifier) ||
    /^(?:\.\.?\/)+server(?:\/|$)/.test(specifier)
  );
}

/** Lists source files under a repo-relative directory, skipping build/dot directories. */
function listSourceFiles(relativeDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(path.join(dir, entry.name));
      } else if (SOURCE_FILE_PATTERN.test(entry.name)) {
        files.push(path.join(dir, entry.name));
      }
    }
  };
  walk(relativeDir);
  return files;
}

/** Strips the file header comment(s) so the first real statement can be inspected. */
function stripLeadingComments(source: string): string {
  let rest = source.replace(/^\uFEFF/, "").trimStart();
  for (;;) {
    if (rest.startsWith("//")) {
      const newline = rest.indexOf("\n");
      rest = newline === -1 ? "" : rest.slice(newline + 1).trimStart();
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      rest = end === -1 ? "" : rest.slice(end + 2).trimStart();
      continue;
    }
    return rest;
  }
}

async function run() {
  console.log("Starting ClubKonnect server boundary self-check...");

  // Save env
  const origUserId = process.env.CLUBKONNECT_USER_ID;
  const origApiKey = process.env.CLUBKONNECT_API_KEY;
  const origBaseUrl = process.env.CLUBKONNECT_BASE_URL;

  try {
    // -------------------------------------------------------------
    // Test Group 1: Server Config & Fail-Closed Behavior
    // -------------------------------------------------------------
    delete process.env.CLUBKONNECT_USER_ID;
    delete process.env.CLUBKONNECT_API_KEY;
    delete process.env.CLUBKONNECT_BASE_URL;

    // Fails closed when credentials missing
    const missingRes = getClubKonnectConfig();
    assert.equal(missingRes.ok, false);
    assert.equal(missingRes.code, "MISSING_CONFIG");

    process.env.CLUBKONNECT_USER_ID = "test_user_id";
    const missingKeyRes = getClubKonnectConfig();
    assert.equal(missingKeyRes.ok, false);
    assert.equal(missingKeyRes.code, "MISSING_CONFIG");

    process.env.CLUBKONNECT_API_KEY = "test_api_key_secret";
    process.env.CLUBKONNECT_BASE_URL = "http://insecure.example.com";
    const insecureBaseRes = getClubKonnectConfig();
    assert.equal(insecureBaseRes.ok, false);
    assert.equal(insecureBaseRes.code, "MISSING_CONFIG");

    process.env.CLUBKONNECT_BASE_URL = "https://www.nellobytesystems.com/path?bad=query";
    const queryBaseRes = getClubKonnectConfig();
    assert.equal(queryBaseRes.ok, false);
    assert.equal(queryBaseRes.code, "MISSING_CONFIG");

    // Success with valid env
    process.env.CLUBKONNECT_BASE_URL = "https://www.nellobytesystems.com";
    const validConfig = getClubKonnectConfig();
    assert.equal(validConfig.ok, true);
    if (validConfig.ok) {
      assert.equal(validConfig.data.userId, "test_user_id");
      assert.equal(validConfig.data.apiKey, "test_api_key_secret");
      assert.equal(validConfig.data.baseUrl, "https://www.nellobytesystems.com");
    }

    // -------------------------------------------------------------
    // Test Group 2: Redaction & Safe Logging
    // -------------------------------------------------------------
    const sensitiveUrl =
      "https://www.nellobytesystems.com/APIAirtimeV1.asp?UserID=secret_uid&APIKey=super_secret_key&MobileNumber=08031234567&Amount=1000";
    const redactedUrl = redactClubKonnectUrl(sensitiveUrl);
    assert.equal(redactedUrl.includes("secret_uid"), false, "UserID must not be in redacted URL");
    assert.equal(redactedUrl.includes("super_secret_key"), false, "APIKey must not be in redacted URL");
    assert.equal(redactedUrl.includes("08031234567"), false, "Full phone number must not be in redacted URL");
    assert.equal(redactedUrl.includes("0803***4567"), true, "Phone number must be masked in redacted URL");
    assert.equal(redactedUrl.includes("UserID=%5BREDACTED%5D") || redactedUrl.includes("UserID=[REDACTED]"), true);
    assert.equal(redactedUrl.includes("APIKey=%5BREDACTED%5D") || redactedUrl.includes("APIKey=[REDACTED]"), true);

    const maskedPhone = maskPhoneNumber("08031234567");
    assert.equal(maskedPhone, "0803***4567");

    const sensitiveObj = {
      apiKey: "secret_api_key",
      userId: "secret_user",
      authorization: "Bearer secret_token",
      password: "secret_password",
      mobileNumber: "08031234567",
      amount: "500",
      nestedList: [
        { token: "nested_token_123" },
        "plain_value",
      ],
    };
    const redactedObj = redactClubKonnectObject(sensitiveObj) as Record<string, unknown>;
    assert.equal(redactedObj.apiKey, "[REDACTED]");
    assert.equal(redactedObj.userId, "[REDACTED]");
    assert.equal(redactedObj.authorization, "[REDACTED]");
    assert.equal(redactedObj.password, "[REDACTED]");
    assert.equal(redactedObj.mobileNumber, "0803***4567");
    assert.equal(Array.isArray(redactedObj.nestedList), true);
    const list = redactedObj.nestedList as Array<Record<string, unknown>>;
    assert.equal(list[0].token, "[REDACTED]");
    assert.equal(list[1], "plain_value");

    // Mixed-case query parameter keys must be redacted case-insensitively
    const mixedCaseUrl =
      "https://www.nellobytesystems.com/APIWalletBalanceV1.asp?ApiKey=secret123&UserId=user456&Status=200";
    const mixedCaseRedacted = redactClubKonnectUrl(mixedCaseUrl);
    assert.equal(mixedCaseRedacted.includes("secret123"), false, "Mixed-case ApiKey value must be redacted");
    assert.equal(mixedCaseRedacted.includes("user456"), false, "Mixed-case UserId value must be redacted");
    assert.equal(/ApiKey=(%5BREDACTED%5D|\[REDACTED\])/.test(mixedCaseRedacted), true);
    assert.equal(/UserId=(%5BREDACTED%5D|\[REDACTED\])/.test(mixedCaseRedacted), true);
    assert.equal(mixedCaseRedacted.includes("Status=200"), true, "Non-sensitive query values must survive redaction");

    // URL userinfo credentials must be cleared entirely
    const userInfoRedacted = redactClubKonnectUrl("https://user:pass@example.com/api");
    assert.equal(userInfoRedacted.includes("user:pass"), false, "Userinfo credentials must be cleared");
    assert.equal(userInfoRedacted.includes("pass"), false, "Password must not survive URL redaction");
    assert.equal(userInfoRedacted.startsWith("https://example.com/api"), true);

    // Nested URL strings inside objects must be redacted, not passed through
    const nestedUrlObj = redactClubKonnectObject({
      callbackUrl:
        "https://www.nellobytesystems.com/APIAirtimeV1.asp?ApiKey=secret123&UserId=user456&MobileNumber=08031234567&Amount=500",
      status: "ORDER_COMPLETED",
      orderid: "98765",
    }) as Record<string, unknown>;
    const nestedCallbackUrl = nestedUrlObj.callbackUrl as string;
    assert.equal(typeof nestedCallbackUrl, "string");
    assert.equal(nestedCallbackUrl.includes("secret123"), false, "Nested URL APIKey must be redacted");
    assert.equal(nestedCallbackUrl.includes("user456"), false, "Nested URL UserId must be redacted");
    assert.equal(nestedCallbackUrl.includes("08031234567"), false, "Nested URL phone must be masked");
    assert.equal(nestedCallbackUrl.includes("0803***4567"), true, "Nested URL phone must be masked, not dropped");
    assert.equal(nestedUrlObj.status, "ORDER_COMPLETED", "Non-sensitive strings must survive object redaction");
    assert.equal(nestedUrlObj.orderid, "98765");

    // Free-form strings containing an embedded URL must be redacted, userinfo included
    const freeFormObj = redactClubKonnectObject({
      note: "request failed: https://user:pass@example.com/api",
    }) as Record<string, unknown>;
    const freeFormNote = freeFormObj.note as string;
    assert.equal(freeFormNote.includes("user:pass"), false, "Embedded URL userinfo must be redacted in objects");
    assert.equal(freeFormNote.includes("pass"), false, "Embedded URL password must not survive object redaction");
    assert.equal(freeFormNote.includes("https://example.com/api"), true, "Redacted URL must stay readable in objects");

    // Phone validation
    assert.equal(normalizeAndValidatePhone("08031234567"), "08031234567");
    assert.equal(normalizeAndValidatePhone("+2348031234567"), "08031234567");
    assert.equal(normalizeAndValidatePhone("2348031234567"), "08031234567");
    assert.equal(normalizeAndValidatePhone("0803-123-4567"), "08031234567");
    assert.equal(normalizeAndValidatePhone("12345"), null);
    assert.equal(normalizeAndValidatePhone("01234567890"), null);

    // Amount validation
    assert.equal(validateAirtimeAmount(50), true);
    assert.equal(validateAirtimeAmount(1000), true);
    assert.equal(validateAirtimeAmount(50_000), true);
    assert.equal(validateAirtimeAmount(49), false);
    assert.equal(validateAirtimeAmount(50_001), false);
    assert.equal(validateAirtimeAmount(100.5), false); // must be integer

    // RequestID generation: Determinism, collision resistance, and input validation
    const txId = "tx_9988_test-uuid-1234";
    const reqId1 = buildClubKonnectRequestId(txId);
    const reqId2 = buildClubKonnectRequestId(txId);
    assert.equal(reqId1, reqId2, "RequestID must be strictly deterministic across calls for same txId");
    assert.equal(reqId1.startsWith("ck"), true);
    assert.equal(reqId1.length <= 32, true);

    // Collision resistance check: same prefix but different suffix
    const txA = "providus_airtime_order_batch_001_aaa";
    const txB = "providus_airtime_order_batch_001_bbb";
    const reqIdA = buildClubKonnectRequestId(txA);
    const reqIdB = buildClubKonnectRequestId(txB);
    assert.notEqual(reqIdA, reqIdB, "Different transactions with shared prefix must produce distinct RequestIDs");
    assert.equal(reqIdA.length <= 32, true);
    assert.equal(reqIdB.length <= 32, true);

    // Invalid input throws
    assert.throws(() => buildClubKonnectRequestId(""));
    assert.throws(() => buildClubKonnectRequestId("   "));

    // Build airtime request
    const validAirtimeRes = buildAirtimeRequestPayload({
      transactionId: txId,
      phone: "08031234567",
      amountNgn: 500,
      network: "mtn",
    });
    assert.equal(validAirtimeRes.ok, true);
    if (validAirtimeRes.ok) {
      assert.equal(validAirtimeRes.data.payload.MobileNetwork, "01"); // MTN
      assert.equal(validAirtimeRes.data.payload.Amount, "500");
      assert.equal(validAirtimeRes.data.payload.MobileNumber, "08031234567");
      assert.equal(validAirtimeRes.data.payload.RequestID, reqId1);
      assert.equal(validAirtimeRes.data.redactedUrl.includes("0803***4567"), true);
      assert.equal(validAirtimeRes.data.redactedUrl.includes("test_api_key_secret"), false);
    }

    // Invalid phone rejection
    const invalidPhoneRes = buildAirtimeRequestPayload({
      transactionId: txId,
      phone: "invalid_phone",
      amountNgn: 500,
      network: "airtel",
    });
    assert.equal(invalidPhoneRes.ok, false);
    assert.equal(invalidPhoneRes.code, "INVALID_INPUT");

    // Invalid amount rejection
    const invalidAmtRes = buildAirtimeRequestPayload({
      transactionId: txId,
      phone: "08031234567",
      amountNgn: 10,
      network: "glo",
    });
    assert.equal(invalidAmtRes.ok, false);
    assert.equal(invalidAmtRes.code, "INVALID_INPUT");

    // -------------------------------------------------------------
    // Test Group 4: Status Normalization
    // -------------------------------------------------------------
    // 100 = ORDER_RECEIVED: Acknowledgement only, NOT success
    const s100 = normalizeClubKonnectStatus({
      status: "ORDER_RECEIVED",
      statuscode: "100",
      orderid: "ord_100",
      requestid: reqId1,
    });
    assert.equal(s100.status, "processing");
    assert.equal(s100.isPending, true);
    assert.equal(s100.isFinal, false);
    assert.equal(s100.isSuccess, false);
    assert.equal(s100.orderId, "ord_100");

    // 300 = Processing: NOT success
    const s300 = normalizeClubKonnectStatus({
      status: "Processing",
      statuscode: "300",
      orderid: "ord_300",
    });
    assert.equal(s300.status, "processing");
    assert.equal(s300.isPending, true);
    assert.equal(s300.isFinal, false);
    assert.equal(s300.isSuccess, false);

    // statuscode 200 = Success (ORDER_COMPLETED): ONLY this numeric code is terminal success
    const s200 = normalizeClubKonnectStatus({
      status: "ORDER_COMPLETED",
      statuscode: "200",
      orderid: "ord_200",
    });
    assert.equal(s200.status, "completed");
    assert.equal(s200.isPending, false);
    assert.equal(s200.isFinal, true);
    assert.equal(s200.isSuccess, true);

    // 201 = Network Unresponsive: MUST NOT be treated as success!
    // Must map to non-terminal "unknown" with RECONCILIATION_REQUIRED
    const s201 = normalizeClubKonnectStatus({
      status: "Network Unresponsive",
      statuscode: "201",
      orderid: "ord_201",
    });
    assert.equal(s201.status, "unknown");
    assert.equal(s201.isPending, false);
    assert.equal(s201.isFinal, false, "201 must not be treated as terminal without reconciliation");
    assert.equal(s201.isSuccess, false, "201 must NEVER be treated as success");
    assert.equal(s201.failureCode, "PROVIDER_NETWORK_UNRESPONSIVE");

    // 417 = Insufficient Balance / Float issue
    const s417 = normalizeClubKonnectStatus({
      status: "Insufficient Balance",
      statuscode: "417",
    });
    assert.equal(s417.status, "failed");
    assert.equal(s417.isPending, false);
    assert.equal(s417.isFinal, true);
    assert.equal(s417.isSuccess, false);
    assert.equal(s417.failureCode, "PROVIDER_FLOAT_EXHAUSTED");

    // Unknown or unrecognized status: MUST remain unknown, NEVER infer success
    const sUnknown = normalizeClubKonnectStatus({
      status: "Something Weird Happened",
      statuscode: "999",
    });
    assert.equal(sUnknown.status, "unknown");
    assert.equal(sUnknown.isPending, false);
    assert.equal(sUnknown.isFinal, false);
    assert.equal(sUnknown.isSuccess, false);
    assert.equal(sUnknown.failureCode, "UNKNOWN_OUTCOME");

    // Numeric statuscode 200 must still be terminal success (provider may send either type)
    const s200Numeric = normalizeClubKonnectStatus({ status: "ORDER_COMPLETED", statuscode: 200 });
    assert.equal(s200Numeric.status, "completed");
    assert.equal(s200Numeric.isSuccess, true);

    // Status TEXT "ORDER_COMPLETED" must NEVER imply success on its own.
    // With no statuscode the response is unresolved and requires reconciliation.
    const sTextOnlyCompleted = normalizeClubKonnectStatus({ status: "ORDER_COMPLETED" });
    assert.equal(sTextOnlyCompleted.status, "unknown");
    assert.equal(sTextOnlyCompleted.isSuccess, false, "Text-only ORDER_COMPLETED must NEVER be success");
    assert.equal(sTextOnlyCompleted.isFinal, false);
    assert.equal(sTextOnlyCompleted.failureCode, "UNKNOWN_OUTCOME");

    // A text field containing "200" is not a numeric status code and must not imply success.
    const sStatusOnly200 = normalizeClubKonnectStatus({ status: "200" });
    assert.equal(sStatusOnly200.isSuccess, false);
    assert.equal(sStatusOnly200.status, "unknown");
    assert.equal(sStatusOnly200.failureCode, "UNKNOWN_OUTCOME");

    // Provider remark/description text must surface when msg/message are absent
    const sRemarkOnly = normalizeClubKonnectStatus({ statuscode: "999", remark: "Provider remark text" });
    assert.equal(sRemarkOnly.rawStatusText, "Provider remark text");
    const sDescriptionOnly = normalizeClubKonnectStatus({
      statuscode: "999",
      description: "Provider description text",
    });
    assert.equal(sDescriptionOnly.rawStatusText, "Provider description text");

    // Empty statuscode with ORDER_COMPLETED text must also stay unknown
    const sEmptyCodeCompleted = normalizeClubKonnectStatus({ status: "ORDER_COMPLETED", statuscode: "" });
    assert.equal(sEmptyCodeCompleted.status, "unknown");
    assert.equal(sEmptyCodeCompleted.isSuccess, false, "Empty statuscode must NEVER be success");

    // Official provider quirk: statuscode 201 also returns status "ORDER_COMPLETED"
    // (remark "Network Unresponsive"). It must stay unknown + reconciliation-required.
    const s201CompletedText = normalizeClubKonnectStatus({
      status: "ORDER_COMPLETED",
      statuscode: "201",
      msg: "Network Unresponsive",
    });
    assert.equal(s201CompletedText.status, "unknown");
    assert.equal(s201CompletedText.isSuccess, false, "201 with ORDER_COMPLETED text must NEVER be success");
    assert.equal(s201CompletedText.isFinal, false);
    assert.equal(s201CompletedText.failureCode, "PROVIDER_NETWORK_UNRESPONSIVE");

    // Raw provider text must never echo credentials into rawStatusText
    const sLeakyMessage = normalizeClubKonnectStatus({
      statuscode: "999",
      msg: "Auth failed for APIKey=super_secret_key and UserID=secret_uid token=abc123",
    });
    assert.equal(sLeakyMessage.rawStatusText.includes("super_secret_key"), false, "rawStatusText must not echo APIKey");
    assert.equal(sLeakyMessage.rawStatusText.includes("secret_uid"), false, "rawStatusText must not echo UserID");
    assert.equal(sLeakyMessage.rawStatusText.includes("abc123"), false, "rawStatusText must not echo token");

    const sLeakyUrlMessage = normalizeClubKonnectStatus({
      statuscode: "999",
      msg: "Call https://api.nellobytesystems.com/query?UserID=secret_uid&APIKey=super_secret_key failed",
    });
    assert.equal(sLeakyUrlMessage.rawStatusText.includes("secret_uid"), false, "rawStatusText must not echo URL UserID");
    assert.equal(
      sLeakyUrlMessage.rawStatusText.includes("super_secret_key"),
      false,
      "rawStatusText must not echo URL APIKey",
    );

    // Free-form URL userinfo inside a provider message must be stripped too
    const sLeakyUserInfoMessage = normalizeClubKonnectStatus({
      statuscode: "999",
      msg: "request failed: https://user:pass@example.com/api",
    });
    assert.equal(
      sLeakyUserInfoMessage.rawStatusText.includes("user:pass"),
      false,
      "rawStatusText must not echo URL userinfo credentials",
    );
    assert.equal(
      sLeakyUserInfoMessage.rawStatusText.includes("pass"),
      false,
      "rawStatusText must not echo URL passwords",
    );

    // -------------------------------------------------------------
    // Test Group 5: Mocked Read-Only Provider Queries & Timeout Handling
    // (No purchase/mutation path exists in P2; proves UPSTREAM_TIMEOUT without issuing a new request, NOT duplicate-purchase safety)
    // -------------------------------------------------------------
    const originalFetch = globalThis.fetch;
    let lastFetchedUrl = "";
    let fetchCalled = 0;

    // Exercise URL builders directly
    const qUrlRes = buildQueryTransactionUrl({ requestId: reqId1 });
    assert.equal(qUrlRes.ok, true);
    const wbUrlRes = buildWalletBalanceUrl();
    assert.equal(wbUrlRes.ok, true);

    try {
      // Mock wallet balance query
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        fetchCalled += 1;
        lastFetchedUrl = typeof input === "string" ? input : input.toString();
        return new Response(
          JSON.stringify({
            walletbalance: "154200.50",
            status: "200",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const balanceRes = await queryClubKonnectWalletBalance();
      assert.equal(balanceRes.ok, true);
      if (balanceRes.ok) {
        assert.equal(balanceRes.data.balanceNgn, "154200.50");
      }
      assert.equal(lastFetchedUrl.includes("APIWalletBalanceV1.asp"), true);

      // Mock transaction query by RequestID
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        fetchCalled += 1;
        lastFetchedUrl = typeof input === "string" ? input : input.toString();
        return new Response(
          JSON.stringify({
            statuscode: "200",
            status: "ORDER_COMPLETED",
            orderid: "123456",
            requestid: reqId1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const txQueryRes = await queryClubKonnectTransaction({ requestId: reqId1 });
      assert.equal(txQueryRes.ok, true);
      if (txQueryRes.ok) {
        assert.equal(txQueryRes.data.status, "completed");
        assert.equal(txQueryRes.data.isSuccess, true);
        assert.equal(txQueryRes.data.orderId, "123456");
        assert.equal(txQueryRes.data.requestId, reqId1);
      }
      assert.equal(lastFetchedUrl.includes("APIQueryV1.asp"), true);
      assert.equal(lastFetchedUrl.includes(`RequestID=${reqId1}`), true);

      // Mock timeout during status query: returns UPSTREAM_TIMEOUT, does NOT trigger new purchase
      globalThis.fetch = (async () => {
        const err = new Error("AbortError");
        err.name = "AbortError";
        throw err;
      }) as typeof fetch;

      const timeoutRes = await queryClubKonnectTransaction({ requestId: reqId1 });
      assert.equal(timeoutRes.ok, false);
      assert.equal(timeoutRes.code, "UPSTREAM_TIMEOUT");
      assert.equal(fetchCalled >= 2, true);
    } finally {
      globalThis.fetch = originalFetch;
    }

    // -------------------------------------------------------------
    // Test Group 6: Compile-Time Server-Only Boundary (static import audit)
    // -------------------------------------------------------------
    // Sanity: the extractor used by this audit must actually see forbidden specifiers.
    // These are plain string fixtures (never executed code): the audit is only meaningful if it
    // can flag static imports, dynamic imports, and side-effect imports alike.
    assert.deepEqual(
      extractImportSpecifiers('import { getClubKonnectConfig } from "@/lib/clubkonnect/server/config";'),
      ["@/lib/clubkonnect/server/config"],
    );
    assert.deepEqual(extractImportSpecifiers('const mod = await import("../server");'), ["../server"]);
    assert.deepEqual(extractImportSpecifiers('import "server-only";'), ["server-only"]);

    // Every server module must guard itself with `server-only` as its first statement.
    const serverModulePaths = ["config.ts", "client.ts", "status.ts", "index.ts"].map(
      (name) => `lib/clubkonnect/server/${name}`,
    );
    for (const modulePath of serverModulePaths) {
      const moduleSource = readFileSync(path.join(REPO_ROOT, modulePath), "utf8");
      assert.match(
        stripLeadingComments(moduleSource),
        /^import\s+["']server-only["'];?/,
        `${modulePath} must start with import "server-only"; to enforce the server boundary`,
      );
    }

    // The client-safe barrel may only re-export pure types: no server modules, no `server-only`.
    const clientBarrelPath = "lib/clubkonnect/index.ts";
    assert.deepEqual(
      extractImportSpecifiers(readFileSync(path.join(REPO_ROOT, clientBarrelPath), "utf8")),
      ["@/lib/clubkonnect/types"],
      `${clientBarrelPath} must stay client-safe and only re-export pure type definitions`,
    );

    // No client-facing source tree may reach the server boundary or import `server-only`.
    const boundaryViolations: string[] = [];
    for (const dir of CLIENT_SOURCE_DIRS) {
      const dirFiles = listSourceFiles(dir);
      assert.equal(dirFiles.length > 0, true, `Expected ${dir}/ to contain source files to audit`);
      for (const file of dirFiles) {
        for (const specifier of extractImportSpecifiers(readFileSync(path.join(REPO_ROOT, file), "utf8"))) {
          if (isServerBoundarySpecifier(specifier)) {
            boundaryViolations.push(`${file} -> ${specifier}`);
          }
        }
      }
    }
    assert.deepEqual(
      boundaryViolations,
      [],
      `Client code must not import server-only ClubKonnect modules: ${boundaryViolations.join(", ")}`,
    );

    console.log("ClubKonnect server boundary self-check: ALL ASSERTIONS PASSED!");
  } finally {
    // Restore env
    if (origUserId !== undefined) process.env.CLUBKONNECT_USER_ID = origUserId;
    else delete process.env.CLUBKONNECT_USER_ID;
    if (origApiKey !== undefined) process.env.CLUBKONNECT_API_KEY = origApiKey;
    else delete process.env.CLUBKONNECT_API_KEY;
    if (origBaseUrl !== undefined) process.env.CLUBKONNECT_BASE_URL = origBaseUrl;
    else delete process.env.CLUBKONNECT_BASE_URL;
  }
}

run().catch((err) => {
  console.error("ClubKonnect self-check failed:", err);
  process.exit(1);
});
