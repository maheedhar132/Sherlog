# Changelog

All notable changes to Sherlog are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- README links to the live game at https://sherlog-five.vercel.app/

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
- [HOW-IT-WORKS.md](HOW-IT-WORKS.md), explaining why the opponent is AI and not hardcoded rules, backed by a test where it solves a fault type it was never written for.

[Unreleased]: https://github.com/maheedhar132/Sherlog/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/maheedhar132/Sherlog/releases/tag/v1.0.0
