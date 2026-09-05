---
name: crewai-core
description: Use the CrewAI framework core (github.com/crewAIInc/crewAI) to build a CUSTOM crew of specialist agents that collaborate on a software build with role-based reasoning and task handoffs. Use when no preset engine fits and you want to design your own multi-agent collaboration (custom roles, goals, backstories, tools, tasks, and a process) for a build task.
metadata:
  version: 1.0.0
---

# CrewAI Core

CrewAI (github.com/crewAIInc/crewAI) is a framework for orchestrating
role-playing AI agents ("crews"). You define agents (role, goal, backstory,
tools), tasks (description, expected output, assigned agent), and a process
(sequential or hierarchical). The crew then collaborates to complete the
tasks, passing outputs to each other.

## When to use

Pick CrewAI Core when you need a CUSTOM multi-agent collaboration that none
of the preset engines (ChatDev, MetaGPT) cover out of the box:

- A build task that needs a bespoke crew (e.g. a "Researcher + Architect +
  Implementer + Reviewer" crew tuned to your domain) with custom tools.
- You want full control over roles, goals, tools, and the process
  (sequential vs hierarchical), not a fixed preset pipeline.
- You want agents that reason about each other's output and delegate
  sub-tasks dynamically.
- Integration-heavy builds where each crew member wraps a different tool
  (DB, API, test runner, deploy).

CrewAI is the "build your own multi-agent collaboration" engine.

## Strengths

- Fully composable: define any number of agents, tasks, tools, and a
  process. No fixed role set.
- Sequential AND hierarchical orchestration; supports delegation.
- Tool integration: each agent can use custom tools (LangChain tools,
  MCP servers, raw functions).
- Mature, well-documented, large ecosystem (see `crewai-examples`).
- Good for production crews you run repeatedly, not one-shot demos.

## Limitations (why it is NOT the default)

- You design the crew yourself - more work than running a preset engine
  (ChatDev/MetaGPT) or letting OpenHands drive.
- For a single-app build that must run + pass tests + deploy, an
  OpenHands autonomous loop is usually simpler and more grounded in real
  execution.
- No built-in "software company" preset; you bring the roles.

## Install and run

```bash
pip install crewai
# (Optional, for tooling extras) pip install 'crewai[tools]'

# Write a crew: define agents + tasks + process, then kickoff
# Minimal skeleton:
cat > crew.py <<'PY'
from crewai import Agent, Task, Crew, Process

researcher = Agent(
    role="Spec Researcher",
    goal="Clarify the build requirements",
    backstory="A meticulous analyst who removes ambiguity before code.",
    allow_delegation=False,
)
builder = Agent(
    role="Builder",
    goal="Produce the working code",
    backstory="A pragmatic engineer who ships.",
    allow_delegation=False,
)

spec = Task(
    description="Write a clear spec for a CLI snake game in Python.",
    expected_output="A short markdown spec.",
    agent=researcher,
)
build = Task(
    description="Implement the spec as a runnable Python file.",
    expected_output="A working snake.py.",
    agent=builder,
)

crew = Crew(agents=[researcher, builder], tasks=[spec, build],
            process=Process.sequential)
result = crew.kickoff()
print(result)
PY
crewai run -f crew.py   # or: python crew.py
```

Use `crewai-examples` as the reference for real crews before designing your
own.

## When to pick CrewAI over the others

- Over `openhands-engine`: when you want a custom multi-agent crew with
  role-based collaboration instead of one autonomous loop.
- Over `chatdev`/`metagpt`: when no preset pipeline fits and you need to
  design the roles, tools, and process yourself.
- Over `crewai-examples`: Core is the framework; Examples are recipes. Use
  Core to build, Examples to learn/copy.
