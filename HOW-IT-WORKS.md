# How the AI works, and why it isn't hardcoded

A lot of tools sold as "AIOps" are scripts: *if the health check fails, restart the pod*. That's useful automation, but it isn't AI. Someone wrote the decision in advance.

This document explains what the opponent in Incident Race actually does, why it counts as AI, and, just as important, **what it is not**. Every claim here can be checked against the code and the test suite.

---

## TL;DR

| | Hardcoded "AIOps" script | Incident Race AI |
|---|---|---|
| Who decides the diagnosis? | A human, ahead of time (`if X then Y`) | The algorithm, at runtime, from evidence |
| Can it handle a combination nobody wrote a rule for? | No. Unknown cases fall through | Yes. It reasons over every hypothesis the topology allows |
| Does it deal with misleading signals? | Usually fires on the first match | Weighs all evidence; a red herring can mislead it, then it recovers |
| Does it decide *what to look at next*? | No. It checks a fixed list | Yes. It picks the query with the most expected information per second |
| Does it know how sure it is? | No | Yes: a probability for every hypothesis |
| Does it learn from you? | No | Yes: difficulty and scenario choice adapt to your results |
| New failure type? | Write new rules and new code paths | Describe the symptoms; **zero AI code changes** (proven by a test) |

It's **classical, probabilistic AI**: Bayesian inference plus decision-theoretic planning, with online learning for the adaptation. It is **not** a neural network and **not** an LLM, and it doesn't claim to be.

---

## What "hardcoded" would look like

A hardcoded diagnoser would be a decision tree written by hand:

```ts
// What this project deliberately does NOT do
if (db.connections >= 95) return 'db_pool';
if (logs.includes('OutOfMemoryError')) return 'memory_leak';
if (deployedRecently) return 'bad_deploy';   // wrong whenever a deploy is a coincidence
```

Rules like these break the moment reality doesn't match the author's imagination. Two symptoms might point different ways, a red herring might match first, or a service might be a *victim* rather than the cause.

There is no code like this anywhere in [`src/ai/`](src/ai/). You can check:

```bash
grep -rnE "conn_max|log_oom|'memory_leak'|'db_pool'" src/ai
```

It returns nothing. The AI never mentions a single symptom or fault by name.

---

## What the AI actually does

The opponent is a **Bayesian investigator** ([`src/ai/investigator.ts`](src/ai/investigator.ts)). Every match, it runs this loop:

### 1. Enumerate the hypotheses

From the incident's service map, it builds every possible `(service, fault)` pair that could physically happen. A memory leak can hit an app but not a database; DNS failure can hit a third-party API. A typical incident has **17 to 22 hypotheses**, and the AI starts with no favourite.

### 2. Predict what each hypothesis would look like

For each hypothesis it simulates the consequences through the dependency graph. If `postgres` were saturated, its callers would log connection timeouts, *their* callers would slow down, and so on. This produces an expected set of symptoms per hypothesis, per dashboard.

### 3. Observe the evidence, the same way you do

It reads raw signals (charts, log lines, trace spans) through detectors ([`src/sim/detect.ts`](src/sim/detect.ts)) that turn a dashboard into observations like "latency is way up" or "same call repeated 3×". **It never reads the hidden answer.** It uses the exact query API you use and pays the same time cost per query.

### 4. Update beliefs with Bayes' rule

For every hypothesis it asks: *how likely is what I just saw, if this were the cause?* Then it reweights.

```
P(cause | evidence) ∝ P(evidence | cause) · P(cause)
```

The likelihood is explicitly uncertain. Real dashboards lie, so the model assumes:

- a predicted symptom is missed 10% of the time, and
- an unpredicted symptom shows up anyway 15% of the time (red herrings, noise).

So no single signal is ever treated as proof, which is exactly what makes it robust to coincidences.

### 5. Decide what to look at next

This is the part that makes it an *agent* rather than a classifier. For every query it hasn't run yet, it asks:

> If I ran this query, how much would my uncertainty shrink on average, and is that worth its time cost?

Formally, it scores each query by **expected information gain** (the drop in entropy of its beliefs) divided by the query's cost in seconds. Nobody wrote "check the logs first". It works out which query is most useful *for this incident, given what it already believes*.

### 6. Declare when confident

When one hypothesis passes a confidence threshold, it declares. If it's wrong, it takes the same +20s penalty you do, rules that hypothesis out, and keeps going.

---

## A real investigation, step by step

This is real output (seed 21, Normal mode). The true cause is a **retry storm in `checkout`**. The incident also contains a red herring: `billing` logs routine client retries that have nothing to do with the outage.

| Step | What the AI did | What it saw | Top beliefs after |
|---|---|---|---|
| Start | Read the paging alerts | `edge-gateway`, `pricing`, `checkout`, `reviews`, `email-worker` paging | 4 hypotheses tied at ~20% |
| Q1 | `logs:pricing` (info gain 1.00, the joint best) | upstream timeouts and 5xx, but **no retries** | checkout 46% · billing 46% · pricing 5% |
| Q2 | `logs:billing` | retries! (the **red herring**) | **billing 84%** · checkout 14% |
| Q3 | `logs:checkout` | retries here too | billing 50% · checkout 50% |
| Q4 | `traces:billing` | slow, failing dependency, but **no repeated calls** | checkout 88% · billing 10% |
| Q5 | `traces:checkout` | the **same call repeated 3×** | **checkout 98%** → declares ✓ |

Three things happened here that no script does:

1. **It was fooled and recovered.** At step 2 it was 84% sure of the wrong answer. A rule like "retries in the logs means retry storm" would have stopped there and been wrong. The Bayesian model held 14% on the alternative, and new evidence overturned it.
2. **It chose its own path.** After the logs tied, it switched to *traces*, because traces were now the queries that best separated the two remaining suspects.
3. **It knew how sure it was** at every step, and only committed at 98%.

You can reproduce any investigation: the postmortem screen shows the AI's full path with its confidence after each query.

---

## The proof: it diagnoses failures it was never written for

[`tests/unseen-fault.test.ts`](tests/unseen-fault.test.ts) does the following at test time:

1. Invents a brand-new fault type, **thread-pool exhaustion**, which appears nowhere in the codebase.
2. Describes *only its symptoms* (latency and CPU up, the service sheds load, its own span is slow).
3. Generates 60 incidents with it and lets the unchanged AI investigate.

**Result: correct diagnosis in all 60, and on the first try more than 90% of the time.** It didn't need a rule for thread-pool exhaustion. It reasoned about which explanation fits the evidence better than the 6 faults it already knew.

That's the difference in one test. A script only knows the answers someone typed in; this AI can tell new failure patterns apart once you tell it what they look like.

---

## The learning part: how it adapts to you

Separately from diagnosing, the game *learns from your play* ([`src/ai/adapter.ts`](src/ai/adapter.ts)). It does this between matches only, never mid-race:

- **Difficulty calibration (online learning).** After each match, AI strength moves toward the target win rate for your mode: you win about 70% on Easy, 50% on Normal, 30% on Hard. This is a stochastic-approximation update. In the long run it settles exactly where `P(you win) = target`, which the test suite checks against simulated players of different skill.
- **Weakness targeting (a multi-armed bandit).** It keeps a Beta distribution of your win rate for each fault type and picks the next incident with **Thompson sampling**. You see more of what you're bad at, with enough randomness that it keeps checking whether you've improved. A test confirms it shifts toward a simulated player's weak spot.

Nobody wrote "give this player more retry storms". It infers that from your results.

---

## What it is *not*: the honest limits

Calling something AI shouldn't hide what it can't do:

- **The symptom knowledge is written by people.** Each fault's signature (for example, "a memory leak causes saw-tooth memory and OOM logs") is authored in [`src/sim/faults.ts`](src/sim/faults.ts), like a medical textbook. The AI does not discover new failure types from raw data. What it does on its own is the *reasoning*: combining noisy, conflicting evidence, choosing what to check, and deciding when it's sure.
- **It's not deep learning or an LLM.** No neural network, no training data, no GPU, and it costs $0 and runs offline in your browser tab. That's a design choice. For a structured diagnosis problem with a known set of causes, probabilistic reasoning is more accurate, explainable and fair than a language model guessing.
- **The world is simulated.** Incidents are generated, not taken from real production systems. The *method* (Bayesian diagnosis with value-of-information planning) is the same family of techniques used in medical diagnosis and fault-isolation systems, but this is a training game, not a production tool.

---

## A litmus test for "AIOps" claims

Next time a tool is pitched as AI, ask:

1. **Does it reason under uncertainty?** Can it say "70% this, 25% that", or does it just match a pattern?
2. **Does it handle cases nobody wrote a rule for?** What happens with a combination of symptoms that's new?
3. **Does it choose what to investigate**, or run a fixed checklist?
4. **Does it survive red herrings?** What does it do when the first matching signal is a coincidence?
5. **Does it learn from outcomes** and get better, or behave identically forever?
6. **Can it explain its conclusion** with the evidence that changed its mind?

A script that restarts a process when a health check fails answers "no" to all six. That's fine, it's automation. Just don't call it AI.
