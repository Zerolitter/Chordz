"""Token-authenticated loopback service; one bounded, cancellable model process at a time."""
from __future__ import annotations
import argparse
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlsplit
import wave
from worker import MODELS, model_ready

MAX_BYTES = 40 * 1024 * 1024
JOB_PATTERN = re.compile(r"^/v1/jobs/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(/audio)?$")
DEFAULT_ORIGIN = "https://www.chordz.zerolitter.net"


def inspect_wav(data: bytes) -> None:
    if not 44 <= len(data) <= MAX_BYTES:
        raise ValueError("Select a bounded WAV excerpt, not a full recording.")
    try:
        with wave.open(BytesIO(data), "rb") as audio:
            if audio.getnchannels() not in (1, 2) or audio.getsampwidth() not in (2, 3) or not 8000 <= audio.getframerate() <= 192000:
                raise ValueError("Use 16/24-bit mono or stereo PCM WAV.")
            frames = audio.getnframes()
            if not 0 < frames <= audio.getframerate() * 24:
                raise ValueError("The engine accepts at most 24 seconds including context.")
            if len(audio.readframes(frames)) != frames * audio.getnchannels() * audio.getsampwidth():
                raise ValueError("The WAV excerpt is incomplete.")
    except (wave.Error, EOFError) as error:
        raise ValueError("The request does not contain a complete PCM WAV.") from error


@dataclass
class Job:
    id: str
    state: str = "queued"
    created: float = field(default_factory=time.monotonic)
    error: str | None = None
    folder: tempfile.TemporaryDirectory | None = None
    process: subprocess.Popen | None = None

    def status(self):
        return {"id": self.id, "state": self.state, **({"error": self.error} if self.error else {})}


class Jobs:
    def __init__(self, worker_python: str, cache: Path, work_dir: Path | None = None, device: str = "cpu"):
        self.worker_python, self.cache, self.work_dir, self.device = worker_python, cache, work_dir, device
        self.jobs: dict[str, Job] = {}
        self.lock = threading.RLock()
        self.closed = False
        self.worker_path = Path(__file__).with_name("worker.py")

    def capabilities(self):
        return {"version": 1, "maxSeconds": 24, "models": [
            {"id": model, "ready": model_ready(self.cache, model), "targets": targets} for model, targets in MODELS.items()]}

    @staticmethod
    def stop_process(process):
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)

    def prune(self):
        now = time.monotonic()
        with self.lock:
            expired = [job.id for job in self.jobs.values() if now - job.created > (600 if job.state in ("running", "queued") else 300)]
        for identity in expired:
            self.cancel(identity)
            with self.lock:
                self.jobs.pop(identity, None)

    def reserve(self, identity: str, model: str, target: str) -> Job:
        self.prune()
        with self.lock:
            if self.closed:
                raise ValueError("The local engine is shutting down.")
            if identity in self.jobs:
                raise ValueError("This job identity is already used or cancelled. Start a new extraction.")
            if any(job.state in ("queued", "running") for job in self.jobs.values()):
                raise ValueError("The local engine is busy. Cancel or finish the current extraction first.")
            if model not in MODELS or target not in MODELS[model]:
                raise ValueError("Unsupported model/target combination.")
            if not model_ready(self.cache, model):
                raise ValueError("The selected model is not prepared. Run the explicit model preparation command first.")
            if len(self.jobs) >= 32:
                raise ValueError("Too many retained jobs. Restart the local engine or wait for cleanup.")
            job = Job(identity)
            self.jobs[identity] = job
            return job

    def launch(self, job: Job, data: bytes, model: str, target: str):
        inspect_wav(data)
        with self.lock:
            if job.state != "queued" or self.closed:
                raise ValueError("The extraction was cancelled.")
            job.folder = tempfile.TemporaryDirectory(prefix="chordz-sample-", dir=self.work_dir)
            folder = Path(job.folder.name)
            (folder / "input.wav").write_bytes(data)
        threading.Thread(target=self._run, args=(job, model, target), daemon=True).start()

    def _run(self, job: Job, model: str, target: str):
        try:
            with self.lock:
                if job.state != "queued" or not job.folder:
                    return
                folder = Path(job.folder.name)
                command = [self.worker_python, str(self.worker_path), "--cache", str(self.cache), "--input", str(folder / "input.wav"),
                           "--output", str(folder / "output.wav"), "--model", model, "--target", target, "--device", self.device]
                log = (folder / "worker.log").open("wb")
                try:
                    job.process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                except BaseException:
                    log.close()
                    raise
                job.state = "running"
            try:
                code = job.process.wait(timeout=540)
            except subprocess.TimeoutExpired:
                self.stop_process(job.process)
                raise RuntimeError("Separation exceeded nine minutes and was stopped. Try a shorter excerpt.")
            finally:
                log.close()
            with self.lock:
                if job.state == "cancelled":
                    return
                output = folder / "output.wav"
                if code != 0 or not output.is_file() or not 44 <= output.stat().st_size <= MAX_BYTES:
                    detail = (folder / "worker.log").read_bytes()[-350:].decode("utf-8", errors="replace")
                    raise RuntimeError("Local model failed. " + detail[-300:])
                job.state = "complete"
        except Exception as error:
            with self.lock:
                if job.state != "cancelled":
                    job.state = "failed"
                    job.error = str(error)[:500]
        finally:
            with self.lock:
                job.process = None
                if job.state in ("failed", "cancelled") and job.folder:
                    job.folder.cleanup()
                    job.folder = None

    def status(self, identity):
        self.prune()
        with self.lock:
            job = self.jobs.get(identity)
            if not job:
                raise KeyError("The extraction has expired or does not exist.")
            return job.status()

    def audio(self, identity):
        with self.lock:
            job = self.jobs.get(identity)
            if not job or job.state != "complete" or not job.folder:
                raise KeyError("No completed audio is available for this extraction.")
            path = Path(job.folder.name) / "output.wav"
            if path.stat().st_size > MAX_BYTES:
                raise ValueError("The output exceeds its size limit.")
            return path.read_bytes()

    def cancel(self, identity):
        with self.lock:
            job = self.jobs.get(identity)
            if not job:
                # Tombstones prevent a late POST from starting after its DELETE.
                if len(self.jobs) < 32:
                    self.jobs[identity] = Job(identity, state="cancelled")
                return {"id": identity, "state": "cancelled"}
            job.state = "cancelled"
            process = job.process
        self.stop_process(process)
        with self.lock:
            if job.folder and (not job.process or job.process.poll() is not None):
                try:
                    job.folder.cleanup()
                    job.folder = None
                except PermissionError:
                    pass  # The worker's finally block closes its log before retrying cleanup.
            return job.status()

    def close(self):
        with self.lock:
            self.closed = True
            ids = list(self.jobs)
        for identity in ids:
            self.cancel(identity)


class Handler(BaseHTTPRequestHandler):
    server_version = "ChordzSampleEngine/1"
    protocol_version = "HTTP/1.0"

    def log_message(self, *_args):
        pass  # Never log authorization headers, tokens, source names or audio.

    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def origin_allowed(self):
        origin = self.headers.get("Origin")
        expected = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        return self.headers.get("Host") in expected and (origin is None or origin in self.server.origins)

    def reply(self, code, data, mime="application/json"):
        payload = json.dumps(data).encode() if mime == "application/json" else data
        self.send_response(code)
        origin = self.headers.get("Origin")
        if origin in self.server.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def authorized(self):
        if not self.origin_allowed():
            self.reply(403, {"error": "This host or browser origin is not allowed."})
            return False
        authorization = self.headers.get("Authorization", "")
        if not authorization.isascii() or not secrets.compare_digest(authorization, "Bearer " + self.server.token):
            self.reply(401, {"error": "Paste the current session token from the local sample engine."})
            return False
        return True

    def do_OPTIONS(self):
        origin = self.headers.get("Origin")
        if not self.origin_allowed() or origin not in self.server.origins:
            self.reply(403, {"error": "This browser origin is not allowed."})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        if self.headers.get("Access-Control-Request-Private-Network") == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if not self.authorized():
            return
        parsed = urlsplit(self.path)
        if parsed.path == "/v1/capabilities" and not parsed.query:
            self.reply(200, self.server.jobs.capabilities())
            return
        match = JOB_PATTERN.fullmatch(parsed.path)
        if not match or parsed.query:
            self.reply(404, {"error": "Unknown local engine endpoint."})
            return
        try:
            data = self.server.jobs.audio(match[1]) if match[2] else self.server.jobs.status(match[1])
            self.reply(200, data, "audio/wav" if match[2] else "application/json")
        except (KeyError, ValueError, OSError) as error:
            self.reply(404, {"error": str(error)[:500]})

    def do_POST(self):
        if not self.authorized():
            return
        parsed = urlsplit(self.path)
        match = JOB_PATTERN.fullmatch(parsed.path)
        params = parse_qs(parsed.query, strict_parsing=False)
        if not match or match[2] or set(params) != {"model", "target"} or any(len(value) != 1 for value in params.values()):
            self.reply(400, {"error": "Supply one supported model and target for a new job."})
            return
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1 or len(lengths[0]) > 10 or not lengths[0].isdigit() or self.headers.get("Transfer-Encoding"):
            self.reply(411, {"error": "A bounded content length is required."})
            return
        size = int(lengths[0])
        if not 44 <= size <= MAX_BYTES or self.headers.get("Content-Type") != "audio/wav":
            self.reply(413, {"error": "Send a PCM WAV excerpt up to 24 seconds, not a full recording."})
            return
        job = None
        try:
            job = self.server.jobs.reserve(match[1], params["model"][0], params["target"][0])
            data = self.rfile.read(size)
            if len(data) != size:
                raise ValueError("Audio upload was incomplete.")
            self.server.jobs.launch(job, data, params["model"][0], params["target"][0])
            self.reply(202, self.server.jobs.status(job.id))
        except (ValueError, OSError, TimeoutError) as error:
            if job:
                self.server.jobs.cancel(job.id)
            self.reply(400, {"error": str(error)[:500]})

    def do_DELETE(self):
        if not self.authorized():
            return
        parsed = urlsplit(self.path)
        match = JOB_PATTERN.fullmatch(parsed.path)
        if not match or match[2] or parsed.query:
            self.reply(404, {"error": "Unknown extraction identity."})
            return
        self.reply(200, self.server.jobs.cancel(match[1]))


class SampleServer(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, port, jobs, token, origins):
        super().__init__(("127.0.0.1", port), Handler)
        self.jobs, self.token, self.origins = jobs, token, set(origins)
        self.stop_cleanup = threading.Event()
        def cleanup():
            while not self.stop_cleanup.wait(10):
                jobs.prune()
        self.cleanup_thread = threading.Thread(target=cleanup, daemon=True)
        self.cleanup_thread.start()

    def server_close(self):
        self.stop_cleanup.set()
        self.jobs.close()
        super().server_close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker-python", default=sys.executable, help="Python in the isolated model environment")
    parser.add_argument("--cache", type=Path, default=Path(__file__).parent / ".models")
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--origin", action="append", default=[], help="Additional exact browser origin, e.g. http://127.0.0.1:5173")
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    args = parser.parse_args()
    for origin in args.origin:
        parsed = urlsplit(origin)
        if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username:
            parser.error("Origins must be exact http(s) origins, without a path, query, credentials or wildcard.")
    if args.work_dir:
        args.work_dir.mkdir(parents=True, exist_ok=True)
    jobs = Jobs(args.worker_python, args.cache.resolve(), args.work_dir, args.device)
    token = secrets.token_urlsafe(32)
    server = SampleServer(47831, jobs, token, [DEFAULT_ORIGIN, *args.origin])
    print("Chordz sample engine: http://127.0.0.1:47831", flush=True)
    print("Session token (paste into Chordz; do not publish):", token, flush=True)
    print("One local extraction at a time. No automatic downloads. Ctrl+C stops the service and removes temporary audio.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
