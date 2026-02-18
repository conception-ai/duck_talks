#!/usr/bin/env python3
"""
Programmatic interface to Claude Code CLI REPL.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import cast
import uuid

import fcntl
import os
import pty
import re
import select
import struct
import subprocess
import termios
import time


@dataclass
class REPLSettings:
    """Configurable settings for Claude REPL interaction.

    These may need adjustment if Claude Code CLI changes its TUI behavior.
    """

    # Base directory where Claude stores projects/sessions
    projects_dir: Path = field(
        default_factory=lambda: Path.home() / ".claude" / "projects"
    )

    # Patterns that indicate the REPL is ready for input (checked in raw bytes)
    ready_patterns: list[bytes] = field(
        default_factory=lambda: [
            b"\xe2\x9d\xaf",  # ❯ prompt character
            b"for shortcuts",  # Appears in startup screen
        ]
    )

    # Pattern to detect prompt return after response (checked in decoded str)
    prompt_pattern: str = "\xe2\x9d\xaf"  # ❯

    # Escape sequence to send focus-in event (activates TUI input)
    focus_in_seq: bytes = b"\x1b[I"

    # Key sequence for Enter/submit
    enter_key: bytes = b"\r"

    # Delay between typing characters (seconds)
    char_delay: float = 0.02

    # Command to exit the REPL
    exit_command: bytes = b"/exit\r"

    # Delay after exit to ensure session persists (seconds)
    persist_delay: float = 3.0


def encode_project_path(path: Path) -> str:
    """Encode a path to Claude's project directory name format.

    Example: /Users/dhuynh95/.claude -> -Users-dhuynh95--claude
    """
    # Resolve to absolute path
    abs_path = path.resolve()
    # Replace / with - and . with -
    encoded = str(abs_path).replace("/", "-").replace(".", "-")
    return encoded


# Default settings instance
DEFAULT_SETTINGS = REPLSettings()


class ClaudeREPL:
    timeout: float
    master: int
    proc: subprocess.Popen[bytes]
    settings: REPLSettings
    session_id: str
    workdir: Path

    def __init__(
        self,
        timeout: float = 60,
        settings: REPLSettings | None = None,
        session_id: str | None = None,
        workdir: Path | None = None,
    ):
        self.timeout = timeout
        self.settings = settings or DEFAULT_SETTINGS
        self.session_id = session_id or str(uuid.uuid4())
        self.workdir = (workdir or Path.cwd()).resolve()
        self.master, slave = pty.openpty()

        # Set terminal size
        winsize = struct.pack("HHHH", 24, 80, 0, 0)
        _ = fcntl.ioctl(slave, termios.TIOCSWINSZ, winsize)

        self.proc = subprocess.Popen(
            ["claude", "--session-id", self.session_id],
            stdin=slave,
            stdout=slave,
            stderr=slave,
            close_fds=True,
            cwd=self.workdir,
            env={**os.environ, "TERM": "xterm-256color"},
        )
        os.close(slave)

        # Wait for startup
        _ = self._read_until_ready(timeout=10)

        # Send focus-in to activate
        _ = os.write(self.master, self.settings.focus_in_seq)
        time.sleep(0.1)

    @property
    def session_path(self) -> Path:
        """Path to the session's JSONL file."""
        project_dir = encode_project_path(self.workdir)
        return self.settings.projects_dir / project_dir / f"{self.session_id}.jsonl"

    def _read_all(self, timeout: float = 0.5) -> bytes:
        output = b""
        start = time.time()
        while time.time() - start < timeout:
            ready, _, _ = select.select([self.master], [], [], 0.1)
            if ready:
                try:
                    chunk = os.read(self.master, 4096)
                    if chunk:
                        output += chunk
                except OSError:
                    break
        return output

    def _read_until_ready(self, timeout: float = 30) -> bytes:
        """Read until we see the prompt indicator."""
        output = b""
        start = time.time()
        while time.time() - start < timeout:
            chunk = self._read_all(timeout=0.5)
            output += chunk
            # Look for prompt ready indicators
            for pattern in self.settings.ready_patterns:
                if pattern in output:
                    return output
        return output

    @staticmethod
    def strip_ansi(text: str) -> str:
        """Remove ANSI escape codes."""
        return re.sub(r"\x1B\[[0-?]*[ -/]*[@-~]", "", text)

    def send(self, message: str, timeout: float | None = None) -> str:
        """Send a message and return the response."""
        timeout = timeout or self.timeout

        # Type characters
        for c in message:
            _ = os.write(self.master, c.encode())
            time.sleep(self.settings.char_delay)

        time.sleep(0.05)

        # Press Enter
        _ = os.write(self.master, self.settings.enter_key)

        # Collect response
        all_output = b""
        last_data_time = time.time()
        start = time.time()

        while time.time() - start < timeout:
            chunk = self._read_all(timeout=0.3)
            if chunk:
                all_output += chunk
                last_data_time = time.time()
            else:
                # No data - check if response is complete
                # Look for prompt returning after thinking
                decoded = all_output.decode("utf-8", errors="replace")
                if self.settings.prompt_pattern in decoded[-500:]:
                    # Prompt returned, likely done
                    if time.time() - last_data_time > 1.0:
                        break

        # Extract response text
        decoded = all_output.decode("utf-8", errors="replace")
        clean = self.strip_ansi(decoded)
        return clean

    def close(self) -> None:
        """Exit the REPL. Waits to ensure session persists."""
        try:
            _ = os.write(self.master, self.settings.exit_command)
            time.sleep(self.settings.persist_delay)
        except OSError:
            pass
        self.proc.kill()
        os.close(self.master)

    def __enter__(self) -> "ClaudeREPL":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Programmatic Claude Code REPL interface"
    )
    _ = parser.add_argument("message", nargs="?", help="Message to send to Claude")
    _ = parser.add_argument(
        "-t", "--timeout", type=float, default=60, help="Response timeout in seconds"
    )
    _ = parser.add_argument(
        "-w", "--workdir", type=str, help="Working directory for Claude"
    )
    _ = parser.add_argument(
        "-s", "--session-id", type=str, help="Session ID (UUID) to use"
    )
    args = parser.parse_args()

    message: str | None = cast(str | None, args.message)
    timeout: float = cast(float, args.timeout)
    workdir_str: str | None = cast(str | None, args.workdir)
    session_id: str | None = cast(str | None, args.session_id)

    if not message:
        parser.print_help()
        return

    workdir = Path(workdir_str) if workdir_str else None

    print("Starting Claude REPL...")

    with ClaudeREPL(timeout=timeout, workdir=workdir, session_id=session_id) as repl:
        print(f"Session ID: {repl.session_id}")
        print(f"Session path: {repl.session_path}")
        print(f"Sending: {message!r}")
        response = repl.send(message, timeout=timeout)
        print(f"\n=== Response ===\n{response}")
        print(f"\nSession saved to: {repl.session_path}")


if __name__ == "__main__":
    main()
