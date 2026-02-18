"""
Claude Code Conversation Watcher.

Monitor session files and trigger handlers on new assistant messages.

Design:
- State: count of processed entries (file is append-only)
- On file change: reload → if count increased → emit new assistant entries
- Invalid files (partial writes) return None and are skipped
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from threading import Timer
from typing import Annotated, Callable, Final, final, override

from pydantic import Field, TypeAdapter, ValidationError
from watchdog.events import DirModifiedEvent, FileModifiedEvent, FileSystemEventHandler
from watchdog.observers import Observer
from watchdog.observers.api import BaseObserver

from models import (
    AssistantEntry,
    CustomTitleEntry,
    FileHistorySnapshot,
    PrLinkEntry,
    ProgressEntry,
    QueueOperation,
    SessionEntry,
    SummaryEntry,
    SystemEntry,
    TextContent,
    UserEntry,
)

# Discriminated union for parsing
EntryUnion = Annotated[
    QueueOperation
    | UserEntry
    | AssistantEntry
    | ProgressEntry
    | SystemEntry
    | FileHistorySnapshot
    | SummaryEntry
    | CustomTitleEntry
    | PrLinkEntry,
    Field(discriminator="type"),
]

_entry_adapter: TypeAdapter[EntryUnion] = TypeAdapter(EntryUnion)

Handler = Callable[[AssistantEntry], None]


def load_session(path: Path) -> list[SessionEntry] | None:
    """Load session file. Returns None if invalid (partial write)."""
    try:
        entries: list[SessionEntry] = []
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            data = json.loads(line)  # Returns dict for valid JSON objects
            entry = _entry_adapter.validate_python(data)
            entries.append(entry)
        return entries
    except (json.JSONDecodeError, ValidationError, FileNotFoundError, OSError):
        return None


def extract_text(entry: AssistantEntry) -> str:
    """Extract text content from assistant message."""
    texts: list[str] = []
    for block in entry.message.content:
        if isinstance(block, TextContent):
            texts.append(block.text)
    return "\n".join(texts)


@final
class ConversationWatcher:
    """Watch a session file and trigger handler on new assistant messages."""

    def __init__(
        self,
        session_path: Path | str,
        handler: Handler,
        debounce_delay: float = 0.3,
    ) -> None:
        self.session_path: Final = Path(session_path).expanduser().resolve()
        self.handler: Final = handler
        self.debounce_delay: Final = debounce_delay
        self._count = 0
        self._debounce_timer: Timer | None = None
        self._observer: BaseObserver | None = None
        self._running = False

    def start(self) -> None:
        """Initialize and begin watching. Blocks until stop()."""
        if self._running:
            return

        entries = load_session(self.session_path)
        if entries is None:
            print(f"Error: Cannot load session: {self.session_path}", file=sys.stderr)
            sys.exit(1)

        self._count = len(entries)
        self._running = True

        observer = Observer()
        fs_handler = _FileChangeHandler(self.session_path, self._on_change)
        _ = observer.schedule(fs_handler, str(self.session_path.parent))
        observer.start()
        self._observer = observer

        print(f"Watching: {self.session_path}", flush=True)
        print(f"Starting at entry {self._count}", flush=True)
        print("Press Ctrl+C to stop\n", flush=True)

        try:
            while self._running:
                observer.join(timeout=1)
        except KeyboardInterrupt:
            self.stop()

    def stop(self) -> None:
        """Stop watching."""
        self._running = False
        if self._debounce_timer:
            self._debounce_timer.cancel()
        if self._observer:
            self._observer.stop()
            self._observer.join()
        print("\nStopped", flush=True)

    def _on_change(self) -> None:
        """Debounced file change handler."""
        if self._debounce_timer:
            self._debounce_timer.cancel()
        self._debounce_timer = Timer(self.debounce_delay, self._process)
        self._debounce_timer.start()

    def _process(self) -> None:
        """Process new entries."""
        entries = load_session(self.session_path)
        if entries is None:
            return  # Partial write, skip

        if len(entries) <= self._count:
            return  # No new entries

        # Process new assistant entries
        for entry in entries[self._count :]:
            if isinstance(entry, AssistantEntry):
                try:
                    self.handler(entry)
                except Exception as e:
                    print(f"Handler error: {e}", file=sys.stderr, flush=True)

        self._count = len(entries)


@final
class _FileChangeHandler(FileSystemEventHandler):
    """Watchdog handler for file modifications."""

    def __init__(self, target: Path, callback: Callable[[], None]) -> None:
        self._target: Final = target.resolve()
        self._callback: Final = callback

    @override
    def on_modified(self, event: DirModifiedEvent | FileModifiedEvent) -> None:
        if not event.is_directory:
            src = event.src_path
            if isinstance(src, bytes):
                src = src.decode()
            if Path(src).resolve() == self._target:
                self._callback()


# --- Handlers ---


def log_handler(entry: AssistantEntry) -> None:
    """Print message preview to stdout."""
    text = extract_text(entry)
    preview = text[:200].replace("\n", " ")
    if len(text) > 200:
        preview += "..."
    print(f"[{entry.timestamp}] NEW: {preview}", flush=True)


def tts_handler(entry: AssistantEntry) -> None:
    """Speak text content via macOS 'say' command."""
    raise NotImplementedError("TTS handler is not implemented")


HANDLERS: dict[str, Handler] = {
    "log": log_handler,
    "tts": tts_handler,
}


# --- CLI ---


def main() -> None:
    parser = argparse.ArgumentParser(description="Watch Claude Code session files")
    _ = parser.add_argument("session_path", type=Path, help="Path to session JSONL")
    _ = parser.add_argument(
        "--handler",
        choices=list(HANDLERS.keys()),
        default="log",
        help="Handler (default: log)",
    )
    _ = parser.add_argument(
        "--debounce",
        type=float,
        default=0.3,
        help="Debounce delay in seconds (default: 0.3)",
    )

    args = parser.parse_args()

    session_path = Path(args.session_path)
    if not session_path.exists():
        print(f"Error: File not found: {session_path}", file=sys.stderr)
        sys.exit(1)

    handler_name = str(args.handler)
    debounce = float(args.debounce)

    watcher = ConversationWatcher(
        session_path=session_path,
        handler=HANDLERS[handler_name],
        debounce_delay=debounce,
    )
    watcher.start()


if __name__ == "__main__":
    main()
