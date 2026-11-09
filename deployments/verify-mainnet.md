# Mainnet source verification package — ProvidusPay 0xd373b037…fCF60

Status: UNVERIFIED on scan.botchain.ai (programmatic API blocked: POST /api → 403).
Bytecode provably matches the build below. Use the browser form.

## 1. Open the form

https://scan.botchain.ai/contract-verification
(or the contract page → Code tab → "Verify & Publish").

## 2. Exact form values

| Field | Value |
|---|---|
| Contract address | `0xd373b0377F17D38707C610f39820297CF4cfCF60` |
| Compiler type | Solidity (Standard JSON Input) |
| Compiler version | v0.8.24+commit.e11b9ed9 |
| EVM version | paris |
| Optimization | No (runs value irrelevant when disabled; enter 200 if required) |
| License | MIT |
| Contract name | `contracts/ProvidusPay.sol:ProvidusPay` |
| Constructor arguments (ABI-encoded) | `000000000000000000000000aBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C` |
| Standard JSON file | `deployments/solc-input-0.8.24.json` (upload as-is; 17 sources, OZ 5.6.1) |

## 3. After submit

Record the explorer confirmation URL in `deployments/bot-mainnet.json`
(`sourceVerification.status = "verified"`). Do NOT redeploy on failure —
retry the form instead and record the exact error.

## 4. If the form is unavailable — request to the BOT Chain team

> Subject: Contract source verification support for BOT Chain Mainnet (677)
>
> We deployed an audited-reviewed payment router at
> 0xd373b0377F17D38707C610f39820297CF4cfCF60 (solc 0.8.24, optimizer off,
> EVM paris, MIT). Programmatic verification POSTs to /api return 403 and
> Sourcify reports "Chain 677 not found". Please advise the supported
> verification route (web form URL, Sourcify chain onboarding, or Blockscout
> API enablement). Reproducible `standard-json-input` is ready to submit.
