# Changelog

All notable changes to Sherlog are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0] - 2026-10-31

Daily streaks, fairer rules, a visible AI reasoning trace, and claims that match what the game does.

### Added

- **AI reasoning panel** in the postmortem: the AI's top suspects and their probabilities after every step, so you can see why it opened each dashboard.
- Architecture diagram (`docs/architecture.png`), a demo GIF and screenshots in the README.
- Accessible dialogs (Escape closes, Tab stays inside, focus returns), a visible keyboard focus ring, reduced-motion support and higher-contrast form controls and map edges.
- Stricter security headers: Content-Security-Policy, X-Frame-Options and Permissions-Policy.
- Daily streaks, tracked per browser like Wordle: current and best streak, plus daily stats (played, solved, beat the AI). A day counts when you solve the daily, win or lose against the AI; giving up or missing a day resets it.
- A streak line on the daily card, a reminder when a streak is at risk, and a 🔥 streak on the daily share card.
- README section explaining what the profile stores and that streaks live in your browser (export and import move them).

### Changed

- **Wrong declarations now cost 20 s, then 40 s, then 60 s** (was a flat 20 s). A player who never opened a dashboard used to beat the Normal AI 44% of the time; it is now about 20%, with skilled play almost unaffected. The AI plays by the same rule.
- The AI is built from a `PlayerView` (service map, alerts, dashboards) instead of the whole incident, so it cannot read the hidden answer by construction. A new test swaps the answer and checks its behaviour is unchanged.
- Copy now says what the game does: the AI adapts to how well you do (not "learns how you debug"), and the game runs entirely in your browser (not "offline").
- README shortened to the essentials; `HOW-IT-WORKS.md` rewritten with a real investigation trace and a plain list of limits.

### Fixed

- Builds failed under TypeScript 7 (`TS2882` on the CSS import). Added Vite's client type declarations.
- Dependabot no longer splits React upgrades into PRs that can't install. React, React DOM and their types are now grouped, and Node's types stay on the Node major we run.
- The Node engine range is capped below 27: Vercel keeps the project's Node 26 and won't silently jump to a new Node major.

## [1.0.0] - 2026-10-31

The first public release.

### Added

- Race an adaptive AI investigator to the root cause of a procedurally generated production incident: a service map with paging alerts, plus metrics, logs, traces and a deploy log. Every query costs investigation time.
- Six fault types: memory leak, database saturation, bad deploy, cache stampede, retry storm and DNS failure, with red herrings that scale by mode.
- A Bayesian AI opponent that reads the same signals as the player and picks queries by expected information gain per second.
- Easy, Normal and Hard modes, each tuned to a target win rate, with adaptive difficulty between matches and placement for new players.
- Thompson-sampling scenario picker that serves more of your weakest fault types.
- Postmortem replay: your path next to the AI's, the evidence you skipped, and the red herrings.
- Daily incident with a fixed AI, plus a Wordle-style share card.
- Expandable service map with full names and dependency arrows.
- Field guide, profile export and import, and link-preview images for social sharing.
- [HOW-IT-WORKS.md](HOW-IT-WORKS.md), explaining why the opponent is AI and not hardcoded rules, backed by a test that a new fault type needs no AI code changes.

[Unreleased]: https://github.com/maheedhar132/Sherlog/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/maheedhar132/Sherlog/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/maheedhar132/Sherlog/releases/tag/v1.0.0
