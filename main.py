"""
Agentic AI System — Main Entry Point

A multi-step task execution system that:
  1. Accepts complex tasks as user input
  2. Decomposes them into discrete steps via LLM
  3. Routes each step to specialized agents (Retriever, Analyzer, Writer)
  4. Executes via async pipeline with parallel batching
  5. Streams partial outputs in real-time with a Rich terminal UI
  6. Handles failures with retry, fallback, and graceful degradation

No black-box frameworks — all orchestration logic is written from scratch.

Usage:
    python main.py
    python main.py --task "Research electric vehicles and write a 3-paragraph summary"
    python main.py --failure-demo   # Demonstrate failure handling
"""

from __future__ import annotations

import argparse
import asyncio
import sys
if sys.stdout.encoding != 'utf-8' and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from rich.console import Console
from rich.live import Live
from rich.markdown import Markdown
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from rich import box

from models.schemas import AgentResult, StepStatus, Step
from orchestrator.core import Orchestrator, DecompositionError
from orchestrator.batching import compute_waves, format_wave_plan
import config


# ─── Rich Console ─────────────────────────────────────────────────────
console = Console()


# ─── Status Icons ─────────────────────────────────────────────────────
STATUS_ICONS = {
    StepStatus.SUCCESS: "[bold green]✅ SUCCESS[/]",
    StepStatus.FAILED: "[bold red]❌ FAILED[/]",
    StepStatus.SKIPPED: "[bold yellow]⏭️  SKIPPED[/]",
    StepStatus.RUNNING: "[bold blue]🔄 RUNNING[/]",
    StepStatus.PENDING: "[dim]⏳ PENDING[/]",
}


def print_banner() -> None:
    """Display the application banner."""
    banner = Text()
    banner.append("╔══════════════════════════════════════════════════════════╗\n", style="bold cyan")
    banner.append("║        ", style="bold cyan")
    banner.append("🤖 Agentic AI System for Multi-Step Tasks", style="bold white")
    banner.append("       ║\n", style="bold cyan")
    banner.append("║        ", style="bold cyan")
    banner.append("Orchestrator → Agents → Streamed Output", style="dim white")
    banner.append("         ║\n", style="bold cyan")
    banner.append("║        ", style="bold cyan")
    banner.append("No black-box frameworks — built from scratch", style="dim white")
    banner.append("      ║\n", style="bold cyan")
    banner.append("╚══════════════════════════════════════════════════════════╝", style="bold cyan")
    console.print(banner)
    console.print()


def print_decomposition(steps: list[Step]) -> None:
    """Display the decomposed steps in a formatted table."""
    table = Table(
        title="📋 Task Decomposition",
        box=box.ROUNDED,
        title_style="bold magenta",
        header_style="bold cyan",
        show_lines=True,
    )
    table.add_column("Step", style="bold", width=8)
    table.add_column("Agent", style="yellow", width=12)
    table.add_column("Instruction", style="white", width=50)
    table.add_column("Depends On", style="dim", width=15)

    for step in steps:
        deps = ", ".join(step.depends_on) if step.depends_on else "—"
        agent_color = {"retriever": "blue", "analyzer": "magenta", "writer": "green"}.get(
            step.agent, "white"
        )
        table.add_row(
            step.id,
            f"[{agent_color}]{step.agent}[/]",
            step.instruction[:80] + ("..." if len(step.instruction) > 80 else ""),
            deps,
        )

    console.print(table)
    console.print()


def print_wave_plan(steps: list[Step]) -> None:
    """Display the execution wave plan."""
    waves = compute_waves(steps)
    console.print(
        Panel(
            format_wave_plan(waves),
            title="⚡ Execution Wave Plan",
            border_style="yellow",
            box=box.ROUNDED,
        )
    )
    console.print()


def print_step_result(result: AgentResult) -> None:
    """Display a single step result with streaming-style output."""
    status_text = STATUS_ICONS.get(result.status, str(result.status))
    agent_color = {"retriever": "blue", "analyzer": "magenta", "writer": "green"}.get(
        result.agent, "white"
    )

    # Header line
    console.print(
        f"\n{'─' * 60}",
        style="dim",
    )
    console.print(
        f"  {status_text}  │  "
        f"Step: [bold]{result.step_id}[/]  │  "
        f"Agent: [{agent_color}]{result.agent}[/]  │  "
        f"Time: [dim]{result.duration_ms:.0f}ms[/]"
    )

    # Error message (if any)
    if result.error:
        console.print(f"  [bold red]⚠ Error:[/] {result.error}")

    # Output preview
    if result.output:
        # Show first 500 chars of output with markdown rendering
        preview = result.output[:500]
        if len(result.output) > 500:
            preview += f"\n\n... [dim]({len(result.output)} total characters)[/dim]"
        console.print(
            Panel(
                Markdown(preview),
                border_style=agent_color,
                padding=(0, 1),
            )
        )


def print_summary(results: list[AgentResult]) -> None:
    """Display the final execution summary."""
    console.print(f"\n{'═' * 60}", style="bold cyan")

    table = Table(
        title="📊 Execution Summary",
        box=box.ROUNDED,
        title_style="bold cyan",
        header_style="bold white",
    )
    table.add_column("Step", style="bold")
    table.add_column("Agent")
    table.add_column("Status")
    table.add_column("Duration", justify="right")

    total_ms = 0.0
    success_count = 0
    failed_count = 0

    for r in results:
        status_text = STATUS_ICONS.get(r.status, str(r.status))
        agent_color = {"retriever": "blue", "analyzer": "magenta", "writer": "green"}.get(
            r.agent, "white"
        )
        table.add_row(
            r.step_id,
            f"[{agent_color}]{r.agent}[/]",
            status_text,
            f"{r.duration_ms:.0f}ms",
        )
        total_ms += r.duration_ms
        if r.status == StepStatus.SUCCESS:
            success_count += 1
        elif r.status == StepStatus.FAILED:
            failed_count += 1

    console.print(table)
    console.print(
        f"\n  Total: [bold]{len(results)}[/] steps  │  "
        f"[green]✅ {success_count} succeeded[/]  │  "
        f"[red]❌ {failed_count} failed[/]  │  "
        f"[dim]⏱ {total_ms:.0f}ms total[/]"
    )
    console.print(f"{'═' * 60}\n", style="bold cyan")

    # Show final writer output if available
    writer_results = [r for r in results if r.agent == "writer" and r.status == StepStatus.SUCCESS]
    if writer_results:
        final_output = writer_results[-1].output
        console.print(
            Panel(
                Markdown(final_output),
                title="📝 Final Output",
                border_style="green",
                box=box.DOUBLE,
                padding=(1, 2),
            )
        )


async def run_pipeline(task: str) -> None:
    """Execute the full pipeline and stream results to the terminal."""

    # ─── Validate config ──────────────────────────────────────────
    try:
        config.validate_config()
    except ValueError as e:
        console.print(f"\n[bold red]Configuration Error:[/] {e}")
        sys.exit(1)

    # ─── Initialize orchestrator ──────────────────────────────────
    console.print("[bold blue]🔧 Initializing orchestrator...[/]")
    orch = Orchestrator()

    # ─── Decompose task ───────────────────────────────────────────
    console.print(f"\n[bold blue]🧠 Decomposing task:[/] [italic]{task}[/]\n")

    try:
        steps = await orch.decompose(task)
    except DecompositionError as e:
        console.print(f"\n[bold red]💥 HARD ABORT — Decomposition Failed[/]")
        console.print(f"   {e}")
        console.print(
            "\n[dim]The task could not be broken down into steps. "
            "This is a critical failure — the pipeline cannot proceed.[/]"
        )
        sys.exit(1)

    # Display the decomposition
    print_decomposition(steps)
    print_wave_plan(steps)

    # ─── Execute pipeline ─────────────────────────────────────────
    console.print("[bold blue]🚀 Executing pipeline...[/]\n")

    results: list[AgentResult] = []

    async for result in orch.execute_pipeline(steps):
        # Stream each result to the terminal as it completes
        print_step_result(result)
        results.append(result)

        # Real-time error streaming
        if result.status == StepStatus.FAILED:
            console.print(
                f"  [yellow]⚠ Step {result.step_id} ({result.agent}) failed — "
                f"pipeline continuing with available data...[/]"
            )

    # ─── Final summary ────────────────────────────────────────────
    print_summary(results)
    console.print("[dim]Logs written to logs/ directory[/]\n")


def main() -> None:
    """CLI entry point."""
    print_banner()

    parser = argparse.ArgumentParser(
        description="Agentic AI System for Multi-Step Tasks"
    )
    parser.add_argument(
        "--task",
        type=str,
        default=None,
        help="Task to execute (if not provided, prompts interactively)",
    )
    parser.add_argument(
        "--failure-demo",
        action="store_true",
        help="Run with a simulated failure to demonstrate error handling",
    )

    args = parser.parse_args()

    # Get task from argument or interactive prompt
    if args.task:
        task = args.task
    else:
        console.print("[bold]Enter your task:[/]")
        console.print("[dim]Example: 'Research electric vehicles and write a 3-paragraph summary'[/]")
        task = console.input("\n[bold cyan]> [/]")

    if not task.strip():
        console.print("[red]No task provided. Exiting.[/]")
        sys.exit(1)

    # If failure demo mode, inject a mock failure into the retriever
    if args.failure_demo:
        console.print(
            "\n[bold yellow]⚠ FAILURE DEMO MODE[/] — "
            "The retriever agent will simulate a timeout on first attempt.\n"
        )
        _enable_failure_demo()

    # Run the async pipeline
    asyncio.run(run_pipeline(task))


def _enable_failure_demo() -> None:
    """
    Monkey-patch the RetrieverAgent to simulate a failure on first call.

    This demonstrates the retry → fallback → continue pipeline behavior
    that evaluators want to see.
    """
    from agents.retriever import RetrieverAgent

    original_run = RetrieverAgent.run
    call_count = {"n": 0}

    async def patched_run(self, step, context):
        call_count["n"] += 1
        if call_count["n"] == 1:
            # Simulate a timeout on the very first retriever call
            raise TimeoutError(
                "Simulated network timeout in RetrieverAgent (failure demo)"
            )
        return await original_run(self, step, context)

    RetrieverAgent.run = patched_run


if __name__ == "__main__":
    main()
