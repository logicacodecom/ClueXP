import contextlib
import importlib.util
import io
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock


SOURCE = Path(__file__).with_name("orchestrator.py")
SPEC = importlib.util.spec_from_file_location("cluexp_orchestrator", SOURCE)
ORCHESTRATOR = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = ORCHESTRATOR
SPEC.loader.exec_module(ORCHESTRATOR)


class RunAgentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.log = mock.patch.object(ORCHESTRATOR, "_log").start()
        self.which = mock.patch.object(ORCHESTRATOR.shutil, "which", return_value="agent.exe").start()
        self.addCleanup(mock.patch.stopall)

    def test_capture_is_utf8_and_normalizes_missing_or_invalid_streams(self) -> None:
        completed = subprocess.CompletedProcess(["codex"], 0, b"valid \xe2\x9c\x85 invalid \xff", None)
        with mock.patch.object(ORCHESTRATOR.subprocess, "run", return_value=completed) as run:
            result = ORCHESTRATOR.run_agent("codex", "test")

        self.assertEqual(result.stdout, "valid ✅ invalid �")
        self.assertEqual(result.stderr, "")
        self.assertEqual(run.call_args.kwargs["encoding"], "utf-8")
        self.assertEqual(run.call_args.kwargs["errors"], "replace")
        self.assertEqual(run.call_args.kwargs["env"]["PYTHONUTF8"], "1")
        self.assertEqual(run.call_args.kwargs["env"]["PYTHONIOENCODING"], "utf-8")

    def test_codex_prompt_uses_stdin_and_read_only_sandbox(self) -> None:
        prompt = "large prompt " * 10000
        completed = subprocess.CompletedProcess(["codex"], 0, "done", "")
        with mock.patch.object(ORCHESTRATOR.subprocess, "run", return_value=completed) as run:
            ORCHESTRATOR.run_agent("codex", prompt, read_only=True)

        argv = run.call_args.args[0]
        self.assertNotIn(prompt, argv)
        self.assertEqual(argv[-1], "-")
        self.assertEqual(run.call_args.kwargs["input"], prompt)
        self.assertEqual(argv[argv.index("--sandbox") + 1], "read-only")

    def test_claude_prompt_uses_stdin_and_plan_mode(self) -> None:
        prompt = "large prompt " * 10000
        completed = subprocess.CompletedProcess(["claude"], 0, "done", "")
        with mock.patch.object(ORCHESTRATOR.subprocess, "run", return_value=completed) as run:
            ORCHESTRATOR.run_agent("claude", prompt, read_only=True)

        argv = run.call_args.args[0]
        self.assertNotIn(prompt, argv)
        self.assertEqual(run.call_args.kwargs["input"], prompt)
        self.assertEqual(argv[argv.index("--input-format") + 1], "text")
        self.assertEqual(argv[argv.index("--permission-mode") + 1], "plan")

    def test_timeout_becomes_a_diagnostic_completed_process(self) -> None:
        timeout = subprocess.TimeoutExpired(["codex"], 3, output=b"partial \xe2\x9c\x85", stderr=None)
        with mock.patch.object(ORCHESTRATOR.subprocess, "run", side_effect=timeout):
            result = ORCHESTRATOR.run_agent("codex", "test", timeout=3)

        self.assertEqual(result.returncode, ORCHESTRATOR.AGENT_TIMEOUT_RETURN_CODE)
        self.assertEqual(result.stdout, "partial ✅")
        self.assertIn("timed out after 3 seconds", result.stderr)

    def test_launch_error_becomes_a_diagnostic_completed_process(self) -> None:
        with mock.patch.object(ORCHESTRATOR.subprocess, "run", side_effect=OSError("blocked")):
            result = ORCHESTRATOR.run_agent("codex", "test")

        self.assertEqual(result.returncode, ORCHESTRATOR.AGENT_LAUNCH_RETURN_CODE)
        self.assertEqual(result.stdout, "")
        self.assertIn("Unable to launch codex command: blocked", result.stderr)


class DiscussTests(unittest.TestCase):
    def setUp(self) -> None:
        self.statuses = {
            "codex": ORCHESTRATOR.AgentStatus("codex", True, "codex.exe"),
            "claude": ORCHESTRATOR.AgentStatus("claude", True, "claude.exe"),
        }

    def test_one_round_preserves_codex_claude_codex_order(self) -> None:
        responses = [
            subprocess.CompletedProcess(["codex"], 0, "proposal ✅", None),
            subprocess.CompletedProcess(["claude"], 0, "critique 你好", None),
            subprocess.CompletedProcess(["codex"], 0, "resolution café", None),
        ]
        with mock.patch.object(ORCHESTRATOR, "discover", return_value=self.statuses), mock.patch.object(
            ORCHESTRATOR, "run_agent", side_effect=responses
        ) as run_agent, mock.patch.object(ORCHESTRATOR, "checkpoint") as checkpoint, contextlib.redirect_stdout(
            io.StringIO()
        ):
            self.assertEqual(ORCHESTRATOR.discuss("test", rounds=1), 0)

        self.assertEqual([call.args[0] for call in run_agent.call_args_list], ["codex", "claude", "codex"])
        self.assertTrue(all(call.kwargs["read_only"] for call in run_agent.call_args_list))
        checkpoint.assert_called_once()

    def test_failed_agent_with_no_output_returns_cleanly(self) -> None:
        failure = subprocess.CompletedProcess(["codex"], 7, None, None)
        stderr = io.StringIO()
        with mock.patch.object(ORCHESTRATOR, "discover", return_value=self.statuses), mock.patch.object(
            ORCHESTRATOR, "run_agent", return_value=failure
        ), contextlib.redirect_stderr(stderr):
            self.assertEqual(ORCHESTRATOR.discuss("test", rounds=1), 7)

        self.assertIn("codex command failed with exit code 7", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
