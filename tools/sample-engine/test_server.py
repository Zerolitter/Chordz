"""Service contract tests. The subprocess here is a deterministic test double, not Demucs."""
from __future__ import annotations
import http.client
from io import BytesIO
import json
from pathlib import Path
import struct
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid
import wave
from server import Jobs, SampleServer, inspect_wav
from worker import model_ready


def wav(seconds=.1, channels=2, rate=8000):
    buffer = BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(struct.pack("<h", 1200) * int(seconds * rate) * channels)
    return buffer.getvalue()


class WavValidation(unittest.TestCase):
    def test_valid_mono_and_stereo(self):
        inspect_wav(wav(channels=1))
        inspect_wav(wav())

    def test_rejects_fake_truncated_and_oversized_audio(self):
        for data in [b"fake" * 30, wav()[:-10], wav(25), wav(channels=3)]:
            with self.subTest(length=len(data)), self.assertRaises(ValueError):
                inspect_wav(data)

    def test_model_readiness_requires_explicit_marker_and_existing_local_checkpoints(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            self.assertFalse(model_ready(cache, "htdemucs"))
            (cache / "hub/checkpoints").mkdir(parents=True)
            (cache / "htdemucs.ready.json").write_text(json.dumps({"model": "htdemucs", "files": ["weights.th"]}))
            self.assertFalse(model_ready(cache, "htdemucs"))
            (cache / "hub/checkpoints/weights.th").write_bytes(b"0" * 1001)
            self.assertTrue(model_ready(cache, "htdemucs"))
            (cache / "htdemucs.ready.json").write_text(json.dumps({"model": "htdemucs", "files": ["../outside.th"]}))
            self.assertFalse(model_ready(cache, "htdemucs"))


class LocalService(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="chordz-engine-test-")
        self.directory = Path(self.folder.name)
        self.jobs = Jobs(sys.executable, self.directory / "models", self.directory)
        fake = self.directory / "fake_worker.py"
        fake.write_text("import pathlib,sys,time\na=sys.argv\ntime.sleep(.25)\npathlib.Path(a[a.index('--output')+1]).write_bytes(pathlib.Path(a[a.index('--input')+1]).read_bytes())\n", encoding="utf-8")
        self.jobs.worker_path = fake
        self.prepared = patch("server.model_ready", return_value=True)
        self.prepared.start()
        self.origin = "http://127.0.0.1:5173"
        self.token = "test-only-token-not-for-production"
        self.server = SampleServer(0, self.jobs, self.token, [self.origin])
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.prepared.stop()
        self.folder.cleanup()

    def request(self, method, path, body=None, headers=None):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        sent = {"Authorization": "Bearer " + self.token, "Origin": self.origin}
        if body is not None:
            sent["Content-Type"] = "audio/wav"
        sent.update(headers or {})
        client.request(method, path, body, sent)
        response = client.getresponse()
        data = response.read()
        output = (response.status, dict(response.getheaders()), data)
        client.close()
        return output

    def start(self, identity=None):
        identity = identity or str(uuid.uuid4())
        return identity, self.request("POST", "/v1/jobs/" + identity + "?model=htdemucs&target=drums", wav())

    def wait(self, identity):
        for _ in range(100):
            code, _, data = self.request("GET", "/v1/jobs/" + identity)
            self.assertEqual(code, 200)
            status = json.loads(data)
            if status["state"] in ("complete", "failed", "cancelled"):
                return status
            time.sleep(.02)
        self.fail("The deterministic worker did not finish.")

    def test_capabilities_require_authentication(self):
        self.assertEqual(self.request("GET", "/v1/capabilities", headers={"Authorization": ""})[0], 401)
        self.assertEqual(self.request("GET", "/v1/capabilities")[0], 200)

    def test_unknown_origins_and_rebound_hosts_cannot_access_audio(self):
        self.assertEqual(self.request("GET", "/v1/capabilities", headers={"Origin": "https://untrusted.example"})[0], 403)
        self.assertEqual(self.request("GET", "/v1/capabilities", headers={"Host": "untrusted.example"})[0], 403)

    def test_preflight_is_exact_origin_only_and_exposes_no_token(self):
        code, headers, data = self.request("OPTIONS", "/v1/capabilities", headers={"Authorization": "", "Access-Control-Request-Private-Network": "true"})
        self.assertEqual(code, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], self.origin)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
        self.assertNotIn(self.token.encode(), data)
        self.assertEqual(self.request("OPTIONS", "/v1/capabilities", headers={"Origin": "null"})[0], 403)

    def test_raw_audio_roundtrip_and_explicit_delete_remove_temporary_files(self):
        identity, response = self.start()
        self.assertEqual(response[0], 202)
        self.assertEqual(self.wait(identity)["state"], "complete")
        code, headers, audio = self.request("GET", "/v1/jobs/" + identity + "/audio")
        self.assertEqual(code, 200)
        self.assertEqual(headers["Content-Type"], "audio/wav")
        self.assertEqual(audio, wav())
        folder = Path(self.jobs.jobs[identity].folder.name)
        self.assertEqual(self.request("DELETE", "/v1/jobs/" + identity)[0], 200)
        self.assertFalse(folder.exists())
        self.assertEqual(self.request("GET", "/v1/jobs/" + identity + "/audio")[0], 404)

    def test_one_worker_at_a_time_and_real_process_cancellation(self):
        identity, response = self.start()
        self.assertEqual(response[0], 202)
        second, response = self.start()
        self.assertEqual(response[0], 400)
        self.assertNotIn(second, self.jobs.jobs)
        self.assertEqual(self.request("DELETE", "/v1/jobs/" + identity)[0], 200)
        self.assertEqual(self.jobs.status(identity)["state"], "cancelled")
        third, response = self.start()
        self.assertEqual(response[0], 202)
        self.assertEqual(self.wait(third)["state"], "complete")

    def test_cancel_before_late_upload_prevents_job_creation(self):
        identity = str(uuid.uuid4())
        self.assertEqual(self.request("DELETE", "/v1/jobs/" + identity)[0], 200)
        _, response = self.start(identity)
        self.assertEqual(response[0], 400)
        self.assertEqual(self.jobs.jobs[identity].state, "cancelled")

    def test_invalid_payload_and_unsupported_target_cannot_start_model(self):
        identity = str(uuid.uuid4())
        path = "/v1/jobs/" + identity + "?model=htdemucs&target=drums"
        self.assertEqual(self.request("POST", path, b"not-wav" * 20)[0], 400)
        self.assertFalse(any(job.state == "running" for job in self.jobs.jobs.values()))
        path = "/v1/jobs/" + str(uuid.uuid4()) + "?model=htdemucs&target=piano"
        self.assertEqual(self.request("POST", path, wav())[0], 400)

    def test_no_arbitrary_paths_targets_or_query_arguments(self):
        self.assertEqual(self.request("GET", "/v1/jobs/../../worker.py/audio")[0], 404)
        identity = str(uuid.uuid4())
        for query in ["model=htdemucs&target=drums&output=C:/file", "model=htdemucs&target=drums&target=bass", "model=../../run&target=drums"]:
            self.assertEqual(self.request("POST", "/v1/jobs/" + identity + "?" + query, wav())[0], 400)

    def test_service_shutdown_and_expiry_cleanup(self):
        identity, _ = self.start()
        self.assertEqual(self.wait(identity)["state"], "complete")
        folder = Path(self.jobs.jobs[identity].folder.name)
        self.jobs.jobs[identity].created -= 1000
        self.jobs.prune()
        self.assertFalse(folder.exists())
        self.assertNotIn(identity, self.jobs.jobs)
        self.jobs.close()
        with self.assertRaises(ValueError):
            self.jobs.reserve(str(uuid.uuid4()), "htdemucs", "drums")


if __name__ == "__main__":
    unittest.main()
