import assert from "node:assert/strict";
import { decodeFunctionData, type Address } from "viem";
import { erc20TransferAbi } from "@/lib/wallet/erc20";
import {
  ACTIVE_CELO_ATTRIBUTION_TAG,
  OBSOLETE_CELO_ATTRIBUTION_TAG,
  buildTaggedTransferCalldata,
  extractAttributionTags,
  resolveActiveAttributionTag,
} from "@/lib/celo/attribution";

function runAttributionSelfCheck() {
  const recipient: Address = "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa";
  const amount = BigInt(50150000); // 50.15 USDC

  const prevEnv = process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_TAG;

  try {
    // 1. Tag resolution with active tag
    process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_TAG = ACTIVE_CELO_ATTRIBUTION_TAG;
    const tag = resolveActiveAttributionTag();
    assert.equal(tag, ACTIVE_CELO_ATTRIBUTION_TAG);

    // 2. Build tagged calldata
    const taggedCalldata = buildTaggedTransferCalldata(recipient, amount);
    assert.ok(taggedCalldata.startsWith("0xa9059cbb"));

    // 3. Calldata still decodes to transfer(recipient, amount)
    const decoded = decodeFunctionData({
      abi: erc20TransferAbi,
      data: taggedCalldata,
    });
    assert.equal(decoded.functionName, "transfer");
    assert.equal(decoded.args[0].toLowerCase(), recipient.toLowerCase());
    assert.equal(decoded.args[1], amount);

    // 4. Suffix contains the active attribution tag
    const extractedTags = extractAttributionTags(taggedCalldata);
    assert.equal(extractedTags.length, 1);
    assert.equal(extractedTags[0], ACTIVE_CELO_ATTRIBUTION_TAG);

    // 5. Obsolete tag rejected
    process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_TAG = OBSOLETE_CELO_ATTRIBUTION_TAG;
    assert.throws(
      () => {
        resolveActiveAttributionTag();
      },
      {
        message: /Obsolete attribution tag/i,
      },
    );

    assert.throws(
      () => {
        buildTaggedTransferCalldata(recipient, amount, OBSOLETE_CELO_ATTRIBUTION_TAG);
      },
      {
        message: /Obsolete attribution tag|Attribution tag mismatch/i,
      },
    );

    // 6. Invalid tag format rejected
    process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_TAG = "invalid_format";
    assert.throws(
      () => {
        resolveActiveAttributionTag();
      },
      {
        message: /Invalid Celo attribution tag format/i,
      },
    );

    assert.throws(
      () => {
        buildTaggedTransferCalldata(recipient, amount, "invalid_tag");
      },
      {
        message: /Invalid attribution tag format/i,
      },
    );

    // 7. Unmatched alien tag rejected
    process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_TAG = "celo_000000000000";
    assert.throws(
      () => {
        resolveActiveAttributionTag();
      },
      {
        message: /Attribution tag mismatch/i,
      },
    );

    // 8. Fallback to active tag when env is empty
    delete process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_TAG;
    assert.equal(resolveActiveAttributionTag(), ACTIVE_CELO_ATTRIBUTION_TAG);
  } finally {
    process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_TAG = prevEnv;
  }

  console.log("attribution self-check (P0): all assertions passed");
}

runAttributionSelfCheck();
