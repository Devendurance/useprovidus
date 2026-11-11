# CRITICAL RULES - MUST FOLLOW


- Auto-log meaningful rules to the project’s AGENTS.md.
- Auto-commit and push after every meaningful checkpoint.
- Auto-clean temporary files and build clutter.
- Keep the repository in a recoverable state.
- B7 overrides automatic push. Keep B7 local, with no deploy or production database writes. Migrations through 0006 already exist and must not be rerun.
- BOT payments require explicit review-card wallet authorization and B5 verification before success. Public BOT Chain Mainnet activation is complete at commit `7820480` for native BOT and Official USDT. BOT Testnet is hidden and disabled publicly. Celo remains intact.
- Public positioning must describe Celo and BOT Chain with current availability labels. BOT-funded utility payments are not live without independently verified settlement and provider-delivery route.
- Use the official BOT Chain website `https://www.botchain.ai`, mainnet explorer `https://scan.botchain.ai`, and testnet explorer `https://scan.bohr.life`. Never fabricate partner branding. Mainnet activation is complete as recorded at `7820480`.
- Network selection and payment capability are independent. Use the B1 chain registry for network metadata, preserve the live native BOT/Official USDT Mainnet route and its security checks, and retain B5 verified receipt semantics.
- Wallet account changes must clear prior-owner assistant drafts and ignore stale async results while preserving submitted/unknown payment recovery evidence. A chain switch alone does not invalidate SIWE under the current `requireOwner` policy.
- Wallet connection must not force a chain. Only explicit network selection may request a switch, and displayed wallet network state must follow provider confirmation.
- Receipt history and detail reads derive ownership from authenticated `requireOwner` state. Never trust a caller-supplied wallet address for receipt access.
- A BOT payment is Verified only when B5 says confirmed and provides `verifiedAt`. Submitted hashes remain pending or unknown until verified.
- Do not invent actual gas fees, recipient addresses, or approval history absent from source records. Token approvals stay separate from payment receipts.
- Conversation history must derive its owner from a verified SIWE session. Persist readable text only, keep payment intents and receipts in their existing stores, and never restore an approval or payment action from chat history.


## WRITING


- Never use em dashes. Use commas, periods, hyphens, or rewrite the sentence.
- Do not use the “It’s not X, it’s Y” correction pattern. State the correct point directly.
- Avoid choppy writing. Keep the flow natural.
- Avoid semicolons in casual replies. Use periods or normal conjunctions.
- Remove stock transitions like “however,” “furthermore,” “it’s worth noting,” and “in conclusion.”
- Use contractions in casual contexts. Say “don’t” instead of “do not.”
- Use simple words. Say “use” instead of “utilize,” “start” instead of “commence,” and “find out” instead of “ascertain.”
- Avoid mid-sentence ellipses unless you’re writing deliberate dialogue.
- Avoid parenthetical asides when the idea can fit naturally into the sentence.
- Use colons sparingly. Don’t label every paragraph or list.
- Remove chatbot filler like “Great question,” “I hope this helps,” “Let me know if,” “Here is a,” and “Let’s dive in.”
- Do not use emojis unless the user clearly wants that style. (This is specific to me, you can leave it if you like to use emojis tho)
- Do not use bold text for emphasis in normal prose.
- Challenge weak reasoning. Flag unsupported claims. Do not agree just to be polite.


## RESPONSES


- Keep responses concise and to the point unless the user asks otherwise.


## AGENT STATE


- Long-running project state lives in `agent-state/`:
  - `project-state.md` tracks what's been built, the architecture, and important decisions.
  - `memory.md` tracks durable facts, conventions, and gotchas.
  - `left-off.md` tracks the current task, what's done, what's next, and known issues.
- At the start of every session, read all three files before doing anything else.
- Update them at every meaningful checkpoint: feature finished, decision made, bug found, direction changed.
- Keep them short. Bullets, not essays. `left-off.md` must always answer: what are we doing, what's done, what's next.
- When the session gets compacted or messy, a new session resumes from these files.


## CONTEXT MANAGEMENT


- When the active agent session approaches roughly 250,000 consumed context tokens, proactively compact or summarize the working context before continuing. Do this before context degradation becomes noticeable.
- Preserve the current objective, repository truth, completed checkpoints and commit hashes, architectural and product decisions, unresolved blockers, relevant environment variable names but never secret values, important implementation invariants, tests and verification state, and the exact next action.
- Do not over-compress implementation-critical details.
- After compaction, continue from the preserved state rather than re-auditing the entire repository.


## PLANNING MODE


- Always ask clarifying questions.
- Never assume the design, tech stack, or features.


## CHANGE / EDIT MODE


- After completing features, whether large or small, always run commands such as lint, type check, and next build to check code quality.


## DATABASE SCHEMA CHANGES


- Whenever you make changes to the database schema, ALWAYS run `db:generate` then `db:migrate`.
- NEVER run drizzle push.


## TESTING


- Use any testing tools and libraries available to the project to test your changes.
- Never assume your changes work; always test.
- If the project does not have any testing tools, scripts, MCP tools, or similar resources available for testing, ask the user whether testing should be skipped.


## UI DESIGN


- Always follow or reference the UI design system when creating or reviewing components or pages.
- Design System: @DESIGN.md


## SHARED MEMORY

- Store shared assistant memory only after an explicit user action. Keep it separate from conversation history, saved recipients, and payment records.
- Derive memory ownership from the verified SIWE session. Never trust a client-supplied owner address.
- Pass a bounded set of owner-scoped memories to the assistant as untrusted background context. Memory must never set payment terms, authorize a payment, or replace a fresh B3 review and wallet approval.
- Ground numeric chain IDs only when the user explicitly ties them to a chain or network. Never mistake an amount that equals a chain ID for network selection, or use a chain ID to fill a missing amount.
- Keep recipient names and addresses canonical in `saved_recipients`. Never store wallet secrets, recovery phrases, signatures, or authentication secrets in memory.
- At the server-side shared-memory write boundary, reject checksum-valid BIP39 phrases from all ten standard wordlists before any repository access. Generate mnemonic regression values at test runtime. Never derive or store keys.
- Wallet changes must hide old-owner memory immediately, cancel stale requests, and discard late responses. Deleting a conversation must leave shared memory intact.
- Apply migration `0008_shared_memories` to production only after an explicitly authorized, reviewed backup and restore plan. Roll back application code first and preserve the additive table unless a separate data export and recovery plan is approved.
