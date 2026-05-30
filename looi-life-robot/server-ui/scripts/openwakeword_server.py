#!/usr/bin/env python3
"""Local openWakeWord WebSocket service for LOOI.

The browser streams 16 kHz, mono PCM16 frames to this service while LOOI is
waiting for a wake phrase. The service runs openWakeWord locally and emits a
small JSON event when a model crosses the configured threshold.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import sys
import time
from collections import deque
from typing import Iterable

import numpy as np
import websockets

try:
    from openwakeword.model import Model
except Exception as exc:  # pragma: no cover - shown to user at runtime
    print(
        "openWakeWord is not installed. Run:\n"
        "  python3 -m pip install -r scripts/requirements-openwakeword.txt\n"
        f"Import error: {exc}",
        file=sys.stderr,
    )
    raise


DEFAULT_FRAME_SAMPLES = 1280
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_THRESHOLD = 0.5
DEFAULT_COOLDOWN_MS = 1800


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="LOOI openWakeWord WebSocket service")
    parser.add_argument("--host", default=os.getenv("OPENWAKEWORD_HOST", DEFAULT_HOST))
    parser.add_argument("--port", type=int, default=int(os.getenv("OPENWAKEWORD_PORT", DEFAULT_PORT)))
    parser.add_argument(
        "--model",
        action="append",
        default=[],
        help=(
            "openWakeWord model name or local model path. Repeat for multiple models. "
            "If omitted, openWakeWord's package defaults are used."
        ),
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=float(os.getenv("OPENWAKEWORD_THRESHOLD", DEFAULT_THRESHOLD)),
    )
    parser.add_argument(
        "--cooldown-ms",
        type=int,
        default=int(os.getenv("OPENWAKEWORD_COOLDOWN_MS", DEFAULT_COOLDOWN_MS)),
    )
    parser.add_argument(
        "--frame-samples",
        type=int,
        default=int(os.getenv("OPENWAKEWORD_FRAME_SAMPLES", DEFAULT_FRAME_SAMPLES)),
        help="PCM16 samples per openWakeWord inference frame. 1280 is 80 ms at 16 kHz.",
    )
    return parser.parse_args()


def env_models() -> list[str]:
    raw = os.getenv("OPENWAKEWORD_MODELS", "")
    return [entry.strip() for entry in raw.split(",") if entry.strip()]


def build_model(models: Iterable[str]) -> Model:
    model_list = [str(model).strip() for model in models if str(model).strip()]
    if model_list:
        return Model(wakeword_models=model_list)
    return Model()


async def handle_client(websocket, model: Model, args: argparse.Namespace) -> None:
    peer = getattr(websocket, "remote_address", None)
    buffer = deque()
    buffered_samples = 0
    last_wake_at = 0.0

    await websocket.send(json.dumps({
        "type": "ready",
        "sampleRate": 16000,
        "frameSamples": args.frame_samples,
        "threshold": args.threshold,
        "models": args.model or env_models() or "openwakeword_defaults",
    }))
    print(f"[openwakeword] client connected peer={peer}", flush=True)

    try:
        async for message in websocket:
            if isinstance(message, str):
                await handle_text_message(websocket, message, args)
                continue

            frame = np.frombuffer(message, dtype=np.int16)
            if frame.size == 0:
                continue

            buffer.append(frame)
            buffered_samples += int(frame.size)

            while buffered_samples >= args.frame_samples:
                inference_frame, buffered_samples = pop_frame(buffer, args.frame_samples, buffered_samples)
                prediction = model.predict(inference_frame)
                wake = pick_wake(prediction, args.threshold)

                if not wake:
                    continue

                now = time.monotonic()
                if now - last_wake_at < args.cooldown_ms / 1000:
                    continue

                last_wake_at = now
                await websocket.send(json.dumps({
                    "type": "wake",
                    "model": wake["model"],
                    "score": wake["score"],
                    "threshold": args.threshold,
                    "timestamp": time.time(),
                }))
                reset_model(model)
    finally:
        print(f"[openwakeword] client disconnected peer={peer}", flush=True)


async def handle_text_message(websocket, message: str, args: argparse.Namespace) -> None:
    try:
        payload = json.loads(message)
    except json.JSONDecodeError:
        payload = {"type": message}

    if payload.get("type") == "ping":
        await websocket.send(json.dumps({
            "type": "pong",
            "sampleRate": 16000,
            "frameSamples": args.frame_samples,
            "threshold": args.threshold,
        }))


def pop_frame(buffer: deque[np.ndarray], frame_samples: int, buffered_samples: int) -> tuple[np.ndarray, int]:
    chunks = []
    remaining = frame_samples

    while remaining > 0 and buffer:
        chunk = buffer.popleft()
        if chunk.size <= remaining:
            chunks.append(chunk)
            remaining -= int(chunk.size)
            continue

        chunks.append(chunk[:remaining])
        buffer.appendleft(chunk[remaining:])
        remaining = 0

    frame = np.concatenate(chunks).astype(np.int16, copy=False)
    return frame, buffered_samples - frame_samples


def pick_wake(prediction: dict, threshold: float) -> dict | None:
    if not isinstance(prediction, dict) or not prediction:
        return None

    model_name, score = max(prediction.items(), key=lambda item: float(item[1] or 0))
    score = float(score or 0)
    if score < threshold:
        return None

    return {"model": str(model_name), "score": score}


def reset_model(model: Model) -> None:
    reset = getattr(model, "reset", None)
    if callable(reset):
        reset()


async def main() -> None:
    args = parse_args()
    args.model = [*env_models(), *args.model]
    model = build_model(args.model)
    stop_event = asyncio.Event()

    def request_stop(*_args) -> None:
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, request_stop)
        except NotImplementedError:
            pass

    print(
        f"[openwakeword] listening ws://{args.host}:{args.port} "
        f"models={args.model or 'openwakeword_defaults'} threshold={args.threshold}",
        flush=True,
    )

    async with websockets.serve(
        lambda websocket: handle_client(websocket, model, args),
        args.host,
        args.port,
        max_size=2_000_000,
    ):
        await stop_event.wait()


if __name__ == "__main__":
    asyncio.run(main())
