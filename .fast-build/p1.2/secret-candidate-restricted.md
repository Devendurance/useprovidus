# P1.2 secret protection, candidate B

## Shape-based refusal for free-text memory

Keep the existing explicit-save flow and owner-scoped memory model. Before either create or edit reaches persistence, tokenize the proposed free-text value into Unicode letter-and-number runs and reject it when any contiguous run has 12 through 24 word tokens. Normalize apostrophes and punctuation as separators so punctuation between words does not evade the check. Return a neutral inline message such as “This looks like sensitive recovery information. Remove it before saving.” Do not echo the submitted value into logs or errors.

Apply the same pure guard in the shared create/update parser, before service writes. Keep it independent of the BIP39 library and wallet code. It only counts tokens. It never derives, validates, requests, or stores keys or phrases. No schema change or migration is needed. Existing SIWE-derived ownership, explicit user action, and payment authorization boundaries remain unchanged.

## Tradeoffs

- Coverage: catches standard 12, 15, 18, 21, or 24-word phrases, including invalid-checksum lookalikes and punctuation-separated words. It can miss phrases with inserted non-word material or other transformations. Checksum validation has more precise identification of valid mnemonics.
- False positives: higher. Any ordinary note containing a contiguous run of 12 or more words is refused, regardless of vocabulary or meaning. This may make long-form memory inconvenient. The UI should explain how to shorten the fact, without suggesting that shorter secret fragments are safe to save.
- Runtime: linear in input length, with no wordlist scan or cryptographic work. Negligible for bounded memory values.
- Flexibility: preserves short free-text facts and preferences. It does not impose a rigid catalog, but effectively limits a saved fact to fewer than 12 consecutive words. A fixed enum-only model would be safer by construction but would remove user-authored context.
- Persistence: create and edit share the guard before their existing owner-scoped writes. A bypassing server path must also call that parser; client-only validation is insufficient.

## Smallest regression

Add one parser-level test with a known valid BIP39 test vector. Assert both create and edit reject it before invoking persistence, and assert the rejection omits the submitted text. In the same test, verify an 11-word ordinary fact remains accepted. Keep the vector confined to test code and use a non-secret test fixture, never a user wallet phrase. No wallet or database operation is required.

## Decision note

Choose this when avoiding a checksum dependency and keeping implementation cost low matter more than accepting long prose. Prefer checksum-based detection when the product needs fewer false positives. Either approach must guard both create and edit on the server-side path.
