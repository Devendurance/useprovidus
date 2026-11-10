# CRITICAL RULES - MUST FOLLOW


- Auto-log meaningful rules to the project’s AGENTS.md.
- Auto-commit and push after every meaningful checkpoint.
- Auto-clean temporary files and build clutter.
- Keep the repository in a recoverable state.
- B7 overrides automatic push. Keep B7 local, with no deploy or production database writes. Migrations through 0006 already exist and must not be rerun.
- BOT payments require explicit review-card wallet authorization and B5 verification before success. Controlled BOT Chain Mainnet browser transactions using native BOT and Official USDT are verified. Production payment execution remains gated pending separate launch authorization, regardless of environment configuration.
- B8 positioning must describe Celo and BOT Chain with availability labels. BOT Testnet transfers are verified, BOT Chain Mainnet transaction evidence is verified while production availability remains gated, and BOT-funded utility payments are not live without an independently verified settlement and provider-delivery route.
- Use the official BOT Chain website `https://www.botchain.ai`, mainnet explorer `https://scan.botchain.ai`, and testnet explorer `https://scan.bohr.life`. Never fabricate partner branding or announce mainnet launch early.
- For B9 wallet UX, network selection and payment capability are independent. Use the B1 chain registry for network metadata, keep 677 payment execution blocked, and retain B5 verified receipt semantics.
- Wallet account changes must clear prior-owner assistant drafts and ignore stale async results while preserving submitted/unknown payment recovery evidence. A chain switch alone does not invalidate SIWE under the current `requireOwner` policy.
- Wallet connection must not force a chain. Only explicit network selection may request a switch, and displayed wallet network state must follow provider confirmation.


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
