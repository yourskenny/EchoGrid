# Sample Battle Report

This is representative output from:

```bash
npm run showcase
node ./bin/echogrid.js report ./logs/showcase/9001.jsonl
```

```text
ECHO GRID BATTLE REPORT
Seed: 9001
Agent: agents/rule-aware.js
Build: echogrid-v0.1-demo
Result: SUCCESS / objective_complete
Score: 991
Turns: 53 / 130
Artifacts: 3 / 3
Resources: energy=99 integrity=3
Hidden Rule: sector_c_two_unstable

SCORE BREAKDOWN
- Mission: 300
- Artifacts: 300
- Map certainty: 52
- Rule discovery: 120
- Unused energy: 99
- Integrity: 120
- Penalties: 0

AUDIT METRICS
- Visible cells: 26
- Marks: 0 correct=0 false=0
- Damage events: 0
- Invalid actions: 0
- Wasted actions: 0

KEY EVENTS
- Turn 1: observed sector_c_exactly_two_unstable.
- Turn 2: claimed hidden rule; accepted=true. rationale="sector C scan showed exactly two unstable echoes"
- Turn 16: extracted artifact; total=1.
- Turn 19: extracted artifact; total=2.
- Turn 48: extracted artifact; total=3.
- Turn 53: extracted at exit and completed objective.

FAILURES OR RISKS
- No damage or invalid actions recorded.

TRANSFERABLE LESSON
- Use sector scans to separate structured echo rules from local hazard noise.
```
