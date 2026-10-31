# Contributing to Sherlog

Thanks for helping make on-call less scary. Sherlog is maintained by [@maheedhar132](https://github.com/maheedhar132), and every change lands through a reviewed pull request, including the maintainer's own.

## How changes get in

`main` is protected: nobody pushes to it directly.

1. **Open an issue first** for anything bigger than a typo, using the *Feature request*, *Bug report* or *New fault type* template. It saves you from building something we can't merge.
2. **Fork** the repo and create a branch from `main` (`feat/disk-full-fault`, `fix/map-overlap`).
3. Make your change. Run the checks locally:
   ```bash
   npm ci
   npm test
   npm run build
   ```
4. **Open a pull request** against `main` and fill in the template. CI must pass, and a maintainer reviews every PR.
5. Vercel posts a **preview link** on your PR, so reviewers can play your change before it merges.

## What we'd love

- **New fault types.** One entry in [`src/sim/faults.ts`](src/sim/faults.ts): valid targets, symptoms per channel, the postmortem story and a tip. The test suite automatically checks that it renders, is detected and is solvable. Ideas: certificate expiry, disk full, clock skew, thread-pool exhaustion, a bad feature flag, Kafka consumer lag.
- **Better signals.** More realistic log lines, trace attributes or metric shapes.
- **Accessibility and mobile improvements.**
- **Bug reports with a seed.** The `INC-xxxxx` number in the match header reproduces the incident.

## What we'll push back on

- **Anything that needs a server, an account or an API key.** Sherlog stays free, offline and private.
- **Making the AI read hidden state.** It must only use the query API the player has. That's the whole point.
- **Large dependencies** for small gains. The game ships about 65 KB of gzipped JavaScript.

## Code style

- TypeScript strict mode, functional React components, no state library.
- Match the surrounding code: naming, comment density, file layout.
- Simulation and AI changes need tests. UI changes need a screenshot in the PR.

## Versioning and releases

Sherlog follows [Semantic Versioning](https://semver.org/):

- **Patch** (`1.0.x`): fixes and balance tweaks that don't change how the game plays.
- **Minor** (`1.x.0`): new fault types, modes and features.
- **Major** (`x.0.0`): changes that reset saved profiles or change the core rules.

Every user-visible change adds a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md). The maintainer cuts releases by tagging `vX.Y.Z` on `main` and publishing a GitHub Release.

## Conduct

Be kind and assume good intent. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
