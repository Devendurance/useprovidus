# P0.2 Throughput Checkpoint

- Blocking first steps: trace the existing owner-scoped BOT and Celo ledgers, reproduce the production mobile menu, and settle the unified receipt DTO/API shape before touching UI code.
- Independent workstreams: public copy and positioning updates; owner-scoped receipt readers and DTO; accessible receipt and mobile navigation interactions; regression coverage and screenshots.
- Shared mutable state: avoid parallel edits to the receipt DTO, global navigation, central positioning module, and Fast-Build state. A single implementation owner owns the P0.2 code/test files in an isolated worktree.
- Smallest safe decomposition: add a read-only authenticated receipt service over existing ledgers, then compact history/modal UI and the mobile menu fix, then align public copy and run the full verification set. No schema or payment-engine change.
