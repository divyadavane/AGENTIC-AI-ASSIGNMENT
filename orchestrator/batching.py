"""
Manual dependency-wave batching for the pipeline.

This module groups steps into "waves" based on their dependency graph.
Steps in the same wave have no inter-dependencies and can run in parallel
via asyncio.gather().

This is hand-written topological sort logic — no external libraries.
The assignment explicitly requires manual batching, not framework abstractions.
"""

from __future__ import annotations

from models.schemas import Step


class BatchingError(Exception):
    """Raised when the dependency graph is invalid (e.g., circular deps)."""
    pass


def compute_waves(steps: list[Step]) -> list[list[Step]]:
    """
    Group steps into dependency waves using topological sort.

    Wave 0: Steps with no dependencies (can run immediately)
    Wave 1: Steps whose dependencies are all in Wave 0
    Wave N: Steps whose dependencies are all in waves < N

    Steps within the same wave are independent and can run in parallel.

    Args:
        steps: List of decomposed steps with dependency info.

    Returns:
        List of waves, where each wave is a list of steps that can
        run concurrently.

    Raises:
        BatchingError: If circular dependencies are detected or
                       a step references a non-existent dependency.

    Example:
        >>> steps = [
        ...     Step(id="s1", agent="retriever", instruction="...", depends_on=[]),
        ...     Step(id="s2", agent="retriever", instruction="...", depends_on=[]),
        ...     Step(id="s3", agent="analyzer", instruction="...", depends_on=["s1", "s2"]),
        ...     Step(id="s4", agent="writer", instruction="...", depends_on=["s3"]),
        ... ]
        >>> waves = compute_waves(steps)
        >>> # Wave 0: [s1, s2]  — no deps, run in parallel
        >>> # Wave 1: [s3]      — depends on s1, s2
        >>> # Wave 2: [s4]      — depends on s3
    """
    # Build a lookup: step_id → Step
    step_map: dict[str, Step] = {s.id: s for s in steps}
    all_ids: set[str] = set(step_map.keys())

    # Validate: check for references to non-existent steps
    for step in steps:
        for dep_id in step.depends_on:
            if dep_id not in all_ids:
                raise BatchingError(
                    f"Step '{step.id}' depends on '{dep_id}', "
                    f"which does not exist in the step list."
                )

    # Track which steps have been assigned to a wave
    assigned: set[str] = set()
    waves: list[list[Step]] = []

    # Iteratively assign steps to waves
    max_iterations = len(steps) + 1  # Safety bound to detect cycles
    iteration = 0

    while len(assigned) < len(steps):
        iteration += 1
        if iteration > max_iterations:
            # Remaining steps have unresolvable dependencies → cycle
            remaining = [s.id for s in steps if s.id not in assigned]
            raise BatchingError(
                f"Circular dependency detected. "
                f"Cannot resolve steps: {remaining}"
            )

        # Find all steps whose dependencies are fully satisfied
        wave: list[Step] = []
        for step in steps:
            if step.id in assigned:
                continue
            # Check if all dependencies have been assigned in prior waves
            deps_satisfied = all(dep_id in assigned for dep_id in step.depends_on)
            if deps_satisfied:
                wave.append(step)

        if not wave:
            # No progress was made — must be a cycle
            remaining = [s.id for s in steps if s.id not in assigned]
            raise BatchingError(
                f"Circular dependency detected. "
                f"Cannot resolve steps: {remaining}"
            )

        # Record this wave
        waves.append(wave)
        for step in wave:
            assigned.add(step.id)

    return waves


def format_wave_plan(waves: list[list[Step]]) -> str:
    """
    Format the wave execution plan as a human-readable string.

    Useful for logging and debugging the batching logic.

    Returns:
        A multi-line string showing which steps run in each wave.
    """
    lines: list[str] = []
    for i, wave in enumerate(waves):
        step_ids = [s.id for s in wave]
        agents = [s.agent for s in wave]
        parallel = "parallel" if len(wave) > 1 else "sequential"
        lines.append(
            f"  Wave {i}: [{', '.join(step_ids)}] "
            f"({', '.join(agents)}) — {parallel}"
        )
    return "\n".join(lines)
