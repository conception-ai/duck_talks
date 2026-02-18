"""
Gemini Live API voice chat.

Three modes:
    python live.py                  # mic -> speaker (interactive)
    python live.py --file x.pcm     # file -> output.wav (linear, no concurrency)
    python live.py --sim            # file -> output.wav (concurrent queues, no hardware)
"""

import asyncio
import struct
import subprocess
import wave
from pathlib import Path

import pyaudio
from google import genai
from google.genai import live as genai_live, types

# --- Config ---
MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"
CONFIG = types.LiveConnectConfig(
    response_modalities=[types.Modality.AUDIO],
    system_instruction="You are a helpful and friendly AI assistant.",
)
CHUNK_SIZE = 1024
SEND_RATE = 16000
RECV_RATE = 24000
MIME_TYPE = f"audio/pcm;rate={SEND_RATE}"
DEFAULT_INPUT = Path(__file__).parent / "cache" / "hello_are_you_there.pcm"


# ---------------------------------------------------------------------------
# File mode: linear send → receive → save (no hardware)
# ---------------------------------------------------------------------------


async def run_file(input_path: Path, output_path: Path) -> None:
    """Send a PCM file, collect response, save as WAV."""
    audio_bytes = input_path.read_bytes()
    client = genai.Client()

    async with client.aio.live.connect(model=MODEL, config=CONFIG) as session:
        # Send chunks
        chunks = [
            audio_bytes[i : i + CHUNK_SIZE]
            for i in range(0, len(audio_bytes), CHUNK_SIZE)
        ]
        print(f"Sending {len(audio_bytes)} bytes in {len(chunks)} chunks...")
        for chunk in chunks:
            await session.send_realtime_input(
                audio=types.Blob(data=chunk, mime_type=MIME_TYPE)
            )
            await asyncio.sleep(0.03)
        await session.send_realtime_input(audio_stream_end=True)
        print("Waiting for response...")

        # Collect response
        audio_parts: list[bytes] = []
        turn = session.receive()
        async for response in turn:
            if (
                response.server_content
                and response.server_content.model_turn
                and response.server_content.model_turn.parts
            ):
                for part in response.server_content.model_turn.parts:
                    if part.inline_data and isinstance(part.inline_data.data, bytes):
                        audio_parts.append(part.inline_data.data)

    # Save
    result = b"".join(audio_parts)
    if result:
        with wave.open(str(output_path), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(RECV_RATE)
            wf.writeframes(result)
        print(f"Received {len(result)} bytes -> {output_path}")
        _ = subprocess.run(["afplay", str(output_path)], check=False)
    else:
        print("No audio received.")


# ---------------------------------------------------------------------------
# Concurrent mode: 4 async tasks with queues
# Used by both mic mode (hardware I/O) and sim mode (file I/O)
# ---------------------------------------------------------------------------


async def run_concurrent(
    input_source: Path | None = None,
    output_path: Path | None = None,
) -> None:
    """
    Concurrent queue architecture. Two variants:
        input_source=None  → mic input, speaker output (interactive)
        input_source=<path> → file input, WAV output (simulated, no hardware)
    """
    sim = input_source is not None
    client = genai.Client()

    speaker_queue: asyncio.Queue[bytes] = asyncio.Queue()
    mic_queue: asyncio.Queue[types.Blob] = asyncio.Queue(maxsize=5)
    received_bytes: list[bytes] = []  # for sim mode: collect output
    send_count = 0
    recv_count = 0

    # --- PyAudio (only for real mic/speaker) ---
    pya: pyaudio.PyAudio | None = None
    mic_stream: pyaudio.Stream | None = None
    if not sim:
        pya = pyaudio.PyAudio()

    # --- Task: produce audio into mic_queue ---
    async def listen() -> None:
        nonlocal mic_stream
        if sim:
            assert input_source is not None
            # Feed file audio into the queue, simulating real-time mic
            audio_bytes = input_source.read_bytes()
            chunks = [
                audio_bytes[i : i + CHUNK_SIZE]
                for i in range(0, len(audio_bytes), CHUNK_SIZE)
            ]
            print(
                f"[listen] Feeding {len(chunks)} chunks from {input_source.name}",
                flush=True,
            )
            for chunk in chunks:
                await mic_queue.put(types.Blob(data=chunk, mime_type=MIME_TYPE))
                await asyncio.sleep(CHUNK_SIZE / SEND_RATE)  # real-time pacing
            # Signal end of stream so VAD knows we're done
            print("[listen] All chunks queued, sending audio_stream_end", flush=True)
            await asyncio.sleep(0.5)  # let queue drain
            # Sentinel: empty blob signals "send audio_stream_end"
            await mic_queue.put(types.Blob(data=b"", mime_type="END"))
            return  # task done
        else:
            assert pya is not None
            info = pya.get_default_input_device_info()
            print(f"[listen] Mic: {info['name']} (index {info['index']})", flush=True)
            mic_stream = await asyncio.to_thread(
                pya.open,
                format=pyaudio.paInt16,
                channels=1,
                rate=SEND_RATE,
                input=True,
                input_device_index=int(info["index"]),
                frames_per_buffer=CHUNK_SIZE,
            )
            chunk_n = 0
            while True:
                data = await asyncio.to_thread(
                    mic_stream.read, CHUNK_SIZE, exception_on_overflow=False
                )
                chunk_n += 1
                # Log audio energy every ~1s (16 chunks at 16kHz/1024)
                if chunk_n % 16 == 0:
                    samples: tuple[int, ...] = struct.unpack(
                        f"<{len(data) // 2}h", data
                    )
                    rms: float = (sum(s * s for s in samples) / len(samples)) ** 0.5
                    print(f"[listen] chunk {chunk_n}, rms={rms:.0f}", flush=True)
                await mic_queue.put(types.Blob(data=data, mime_type=MIME_TYPE))

    # --- Task: drain mic_queue → API ---
    async def send(session: genai_live.AsyncSession) -> None:
        nonlocal send_count
        while True:
            msg = await mic_queue.get()
            # Sentinel check: empty blob = send audio_stream_end
            if msg.mime_type == "END":
                await session.send_realtime_input(audio_stream_end=True)
                print(
                    f"[send] audio_stream_end sent (after {send_count} chunks)",
                    flush=True,
                )
                return
            await session.send_realtime_input(audio=msg)
            send_count += 1
            if send_count % 20 == 0:
                print(f"[send] {send_count} chunks sent to API", flush=True)

    # --- Task: API → speaker_queue ---
    async def receive(session: genai_live.AsyncSession) -> None:
        nonlocal recv_count
        while True:
            turn = session.receive()
            async for response in turn:
                if (
                    response.server_content
                    and response.server_content.model_turn
                    and response.server_content.model_turn.parts
                ):
                    for part in response.server_content.model_turn.parts:
                        if part.inline_data and isinstance(
                            part.inline_data.data, bytes
                        ):
                            chunk = part.inline_data.data
                            recv_count += 1
                            if sim:
                                received_bytes.append(chunk)
                            else:
                                speaker_queue.put_nowait(chunk)
                            if recv_count % 10 == 1:
                                print(
                                    f"[receive] chunk #{recv_count} ({len(chunk)} bytes)",
                                    flush=True,
                                )
                if response.server_content and response.server_content.turn_complete:
                    print(
                        f"[receive] turn complete ({recv_count} chunks total)",
                        flush=True,
                    )
                    if sim:
                        return  # done, exit task
            # Interruption: drain to stop playback
            if not sim:
                while not speaker_queue.empty():
                    _ = speaker_queue.get_nowait()

    # --- Task: speaker_queue → speakers ---
    async def play() -> None:
        if sim:
            return  # no-op in sim mode
        assert pya is not None
        stream = await asyncio.to_thread(
            pya.open,
            format=pyaudio.paInt16,
            channels=1,
            rate=RECV_RATE,
            output=True,
        )
        while True:
            data = await speaker_queue.get()
            await asyncio.to_thread(stream.write, data)

    try:
        async with client.aio.live.connect(model=MODEL, config=CONFIG) as session:
            label = "sim" if sim else "mic"
            print(f"[{label}] Connected to {MODEL}", flush=True)
            async with asyncio.TaskGroup() as tg:
                _ = tg.create_task(listen())
                _ = tg.create_task(send(session))
                _ = tg.create_task(receive(session))
                _ = tg.create_task(play())
    except (asyncio.CancelledError, KeyboardInterrupt):
        pass
    finally:
        if mic_stream:
            mic_stream.close()
        if pya:
            pya.terminate()
        # Save output in sim mode
        if sim and received_bytes:
            out = output_path or Path("output.wav")
            result = b"".join(received_bytes)
            with wave.open(str(out), "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(RECV_RATE)
                wf.writeframes(result)
            print(f"[sim] {len(result)} bytes -> {out}", flush=True)
            _ = subprocess.run(["afplay", str(out)], check=False)
        elif sim:
            print("[sim] No audio received.", flush=True)
        else:
            print("\nDone.", flush=True)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    if "--file" in sys.argv:
        idx = sys.argv.index("--file")
        _input = Path(sys.argv[idx + 1]) if idx + 1 < len(sys.argv) else DEFAULT_INPUT
        if not _input.exists():
            print(f"File not found: {_input}")
            sys.exit(1)
        asyncio.run(run_file(_input, Path("output.wav")))
    elif "--sim" in sys.argv:
        # Simulated mic: file → concurrent queues → WAV (tests architecture)
        _input = DEFAULT_INPUT
        if not _input.exists():
            print(f"File not found: {_input}")
            sys.exit(1)
        asyncio.run(run_concurrent(input_source=_input, output_path=Path("output.wav")))
    else:
        try:
            asyncio.run(run_concurrent())  # real mic mode
        except KeyboardInterrupt:
            print("\nInterrupted.")
