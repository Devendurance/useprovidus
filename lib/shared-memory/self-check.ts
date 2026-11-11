import "server-only";

import assert from "node:assert/strict";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist as czech } from "@scure/bip39/wordlists/czech";
import { wordlist as english } from "@scure/bip39/wordlists/english";
import { wordlist as french } from "@scure/bip39/wordlists/french";
import { wordlist as italian } from "@scure/bip39/wordlists/italian";
import { wordlist as japanese } from "@scure/bip39/wordlists/japanese";
import { wordlist as korean } from "@scure/bip39/wordlists/korean";
import { wordlist as portuguese } from "@scure/bip39/wordlists/portuguese";
import { wordlist as simplifiedChinese } from "@scure/bip39/wordlists/simplified-chinese";
import { wordlist as spanish } from "@scure/bip39/wordlists/spanish";
import { wordlist as traditionalChinese } from "@scure/bip39/wordlists/traditional-chinese";
import {
  createMemorySharedMemoryStore,
  type SharedMemoryStore,
} from "@/lib/shared-memory/repository";
import {
  createSharedMemory,
  deleteSharedMemory,
  listSharedMemories,
  parseSharedMemoryDraft,
  parseSharedMemoryDelete,
  parseSharedMemoryUpdate,
  readPromptMemories,
  SharedMemoryError,
  updateSharedMemory,
} from "@/lib/shared-memory/service";

const OWNER_A = "0x1111111111111111111111111111111111111111";
const OWNER_B = "0x2222222222222222222222222222222222222222";

function draft(requestId: string, label: string, value: string, kind: "fact" | "preference" = "fact") {
  return parseSharedMemoryDraft({ requestId, kind, label, value });
}

async function expectMemoryError(
  operation: () => Promise<unknown>,
  code: SharedMemoryError["code"],
) {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof SharedMemoryError);
    assert.equal(error.code, code);
    return true;
  });
}

async function run() {
  const store = createMemorySharedMemoryStore();
  const first = await createSharedMemory(
    store,
    OWNER_A,
    draft("p12_request_0001", "Preferred style", "Keep explanations concise.", "preference"),
  );
  const retry = await createSharedMemory(
    store,
    OWNER_A,
    draft("p12_request_0001", "Preferred style", "Keep explanations concise.", "preference"),
  );
  assert.equal(retry.id, first.id, "Retrying a save reuses the existing memory.");
  assert.equal(retry.version, first.version, "An idempotent retry does not bump the version.");

  await expectMemoryError(
    () => createSharedMemory(store, OWNER_A, draft("p12_request_0002", "preferred STYLE", "Another value.")),
    "DUPLICATE_LABEL",
  );
  await expectMemoryError(
    () => createSharedMemory(store, OWNER_A, draft("p12_request_0001", "Different title", "Different value.")),
    "REQUEST_ID_REUSED",
  );

  const ownerB = await createSharedMemory(
    store,
    OWNER_B,
    draft("p12_request_0001", "Preferred style", "Use detailed explanations.", "preference"),
  );
  assert.notEqual(ownerB.id, first.id, "Owners can use the same memory label independently.");
  assert.deepEqual((await listSharedMemories(store, OWNER_A)).map((row) => row.id), [first.id]);
  assert.deepEqual((await listSharedMemories(store, OWNER_B)).map((row) => row.id), [ownerB.id]);

  const updated = await updateSharedMemory(
    store,
    OWNER_A,
    first.id,
    parseSharedMemoryUpdate({
      expectedVersion: 1,
      kind: "preference",
      label: "Preferred style",
      value: "Use short answers and clear steps.",
    }),
  );
  assert.equal(updated.version, 2);
  const updateRetry = await updateSharedMemory(
    store,
    OWNER_A,
    first.id,
    parseSharedMemoryUpdate({
      expectedVersion: 1,
      kind: "preference",
      label: "Preferred style",
      value: "Use short answers and clear steps.",
    }),
  );
  assert.equal(updateRetry.version, 2, "Retrying the same update does not bump the version.");

  const wordlists = [
    czech,
    english,
    french,
    italian,
    japanese,
    korean,
    portuguese,
    simplifiedChinese,
    spanish,
    traditionalChinese,
  ];
  const entropySizes = [16, 20, 24, 28, 32] as const;
  const generatedRecoveryPhrases = wordlists.flatMap((wordlist, wordlistIndex) =>
    entropySizes.map((entropySize, entropyIndex) =>
      entropyToMnemonic(new Uint8Array(entropySize).fill(0x5a + wordlistIndex + entropyIndex), wordlist),
    ),
  );
  let repositoryCalls = 0;
  const guardedStore = new Proxy(store, {
    get(target, property, receiver) {
      const method = Reflect.get(target, property, receiver);
      if (typeof method !== "function") return method;
      return (...args: unknown[]) => {
        repositoryCalls += 1;
        return method.apply(target, args);
      };
    },
  }) as SharedMemoryStore;

  for (const [index, recoveryPhrase] of generatedRecoveryPhrases.entries()) {
    repositoryCalls = 0;
    await expectMemoryError(
      () => createSharedMemory(
        guardedStore,
        OWNER_A,
        draft(`p12_secret_create_${String(index).padStart(2, "0")}`, `Recovery ${index}`, recoveryPhrase),
      ),
      "INVALID_MEMORY",
    );
    assert.equal(repositoryCalls, 0, "A recovery phrase is rejected before repository access on create.");

    repositoryCalls = 0;
    await expectMemoryError(
      () => updateSharedMemory(
        guardedStore,
        OWNER_A,
        first.id,
        parseSharedMemoryUpdate({
          expectedVersion: 2,
          kind: "fact",
          label: "Recovery context",
          value: recoveryPhrase,
        }),
      ),
      "INVALID_MEMORY",
    );
    assert.equal(repositoryCalls, 0, "A recovery phrase is rejected before repository access on update.");
  }

  const embeddedRecoveryPhrase = `Private backup: ${generatedRecoveryPhrases[5].replace(/ /g, "　")}, keep it offline.`;
  repositoryCalls = 0;
  await expectMemoryError(
    () => createSharedMemory(
      guardedStore,
      OWNER_A,
      draft("p12_secret_create_embedded", "Private backup", embeddedRecoveryPhrase),
    ),
    "INVALID_MEMORY",
  );
  assert.equal(repositoryCalls, 0, "A recovery phrase surrounded by prose and Unicode separators is rejected before repository access.");

  const splitPhraseWords = generatedRecoveryPhrases[5].split(" ");
  repositoryCalls = 0;
  await expectMemoryError(
    () => createSharedMemory(
      guardedStore,
      OWNER_A,
      draft(
        "p12_secret_create_cross_field",
        splitPhraseWords.slice(0, 3).join(" "),
        splitPhraseWords.slice(3).join(" "),
      ),
    ),
    "INVALID_MEMORY",
  );
  assert.equal(repositoryCalls, 0, "A recovery phrase split across label and value is rejected before repository access.");

  await expectMemoryError(
    () => updateSharedMemory(
      store,
      OWNER_A,
      first.id,
      parseSharedMemoryUpdate({
        expectedVersion: 1,
        kind: "preference",
        label: "Preferred style",
        value: "Overwrite the newer value.",
      }),
    ),
    "STALE_VERSION",
  );
  await expectMemoryError(
    () => updateSharedMemory(
      store,
      OWNER_B,
      first.id,
      parseSharedMemoryUpdate({
        expectedVersion: 2,
        kind: "fact",
        label: "Other owner edit",
        value: "No access.",
      }),
    ),
    "NOT_FOUND",
  );

  const beforeDelete = await listSharedMemories(store, OWNER_A);
  await deleteSharedMemory(
    store,
    OWNER_B,
    first.id,
    parseSharedMemoryDelete({ expectedVersion: 2 }).expectedVersion,
  );
  assert.deepEqual(await listSharedMemories(store, OWNER_A), beforeDelete, "A foreign delete has no effect.");

  assert.throws(
    () => parseSharedMemoryDraft({
      requestId: "p12_request_0003",
      kind: "fact",
      label: "Wallet",
      value: "0x1111111111111111111111111111111111111111",
    }),
    (error: unknown) => error instanceof SharedMemoryError && error.code === "INVALID_MEMORY",
  );
  assert.throws(
    () => parseSharedMemoryDraft({
      requestId: "p12_request_0004",
      kind: "fact",
      label: "Recovery",
      value: "My recovery phrase is never saved.",
    }),
    (error: unknown) => error instanceof SharedMemoryError && error.code === "INVALID_MEMORY",
  );
  assert.throws(
    () => parseSharedMemoryDraft({
      requestId: "p12_request_0005",
      ownerAddress: OWNER_A,
      kind: "fact",
      label: "Home",
      value: "Lagos",
    }),
    (error: unknown) => error instanceof SharedMemoryError && error.code === "INVALID_MEMORY",
  );

  for (let index = 0; index < 10; index += 1) {
    await createSharedMemory(
      store,
      OWNER_A,
      draft(`p12_bulk_${String(index).padStart(4, "0")}`, `Context ${index}`, "x".repeat(250)),
    );
  }
  const promptMemories = await readPromptMemories(store, OWNER_A);
  assert.ok(promptMemories.length <= 8, "Prompt memory count is bounded.");
  assert.ok(JSON.stringify(promptMemories).length <= 1_800, "Prompt memory size is bounded.");
  assert.equal(promptMemories.some((memory) => "ownerAddress" in memory), false);

  await deleteSharedMemory(
    store,
    OWNER_A,
    updated.id,
    parseSharedMemoryDelete({ expectedVersion: updated.version }).expectedVersion,
  );
  await deleteSharedMemory(
    store,
    OWNER_A,
    updated.id,
    parseSharedMemoryDelete({ expectedVersion: updated.version }).expectedVersion,
  );
  assert.equal((await listSharedMemories(store, OWNER_A)).some((row) => row.id === updated.id), false);

  console.log("Shared memory self-check passed: explicit saves, idempotency, duplicate labels, version conflicts, owner isolation, secret/address rejection, bounded prompt projection, and delete retries.");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : "Shared memory self-check failed.");
  process.exitCode = 1;
});
