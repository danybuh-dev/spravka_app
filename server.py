#!/usr/bin/env python3
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error, request


HOST = os.environ.get("APP_HOST", "127.0.0.1")
PORT = int(os.environ.get("APP_PORT", "8000"))
OPENAI_API_URL = os.environ.get("OPENAI_API_URL", "https://api.openai.com/v1/responses")
GEMINI_API_BASE_URL = os.environ.get("GEMINI_API_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/models")
ROOT = Path(__file__).resolve().parent
DEFAULT_ALLOWED_ORIGINS = "http://127.0.0.1:8000,http://localhost:8000,https://danybuh-dev.github.io"


def load_dotenv():
    env_path = ROOT / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')

        if key and key not in os.environ:
            os.environ[key] = value


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self._send_cors_headers()
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/health":
            provider = resolve_provider()
            self.send_json(
                200,
                {
                    "status": "ok",
                    "openai_api_key_configured": bool(os.environ.get("OPENAI_API_KEY")),
                    "gemini_api_key_configured": bool(os.environ.get("GEMINI_API_KEY")),
                    "provider": provider,
                    "ai_configured": is_provider_configured(provider),
                },
            )
            return

        if self.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/analyze":
            self.send_json(404, {"error": "Unknown endpoint."})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length)

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_json(400, {"error": "Invalid JSON body."})
            return

        try:
            provider = resolve_provider()
            if provider == "gemini":
                data = forward_to_gemini(payload)
            else:
                data = forward_to_openai(payload)
            self.send_json(200, data)
        except error.HTTPError as exc:
            body = exc.read()
            try:
                decoded = json.loads(body.decode("utf-8"))
            except Exception:
                decoded = {"error": body.decode("utf-8", errors="replace")}
            self.send_json(exc.code, decoded)
        except Exception as exc:
            self.send_json(502, {"error": f"Upstream OpenAI request failed: {exc}"})

    def log_message(self, format, *args):
        sys.stdout.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format % args))

    def send_json(self, status_code, payload):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _send_cors_headers(self):
        origin = self.headers.get("Origin")
        allowed_origin = resolve_allowed_origin(origin)
        if allowed_origin:
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Vary", "Origin")

        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")


def main():
    load_dotenv()
    host = os.environ.get("APP_HOST", HOST)
    port = int(os.environ.get("APP_PORT", str(PORT)))
    server = ThreadingHTTPServer((host, port), AppHandler)
    print(f"Serving app on http://{host}:{port}")
    print("Configure OPENAI_API_KEY or GEMINI_API_KEY in .env or in the shell environment before starting the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


def get_allowed_origins():
    raw = os.environ.get("APP_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS)
    return [item.strip() for item in raw.split(",") if item.strip()]


def resolve_allowed_origin(origin):
    if not origin:
        return "*"

    allowed = get_allowed_origins()
    if "*" in allowed:
        return "*"
    if origin in allowed:
        return origin
    return ""


def resolve_provider():
    provider = os.environ.get("AI_PROVIDER", "").strip().lower()
    if provider in {"openai", "gemini"}:
        return provider
    if os.environ.get("GEMINI_API_KEY"):
        return "gemini"
    return "openai"


def is_provider_configured(provider):
    if provider == "gemini":
        return bool(os.environ.get("GEMINI_API_KEY"))
    return bool(os.environ.get("OPENAI_API_KEY"))


def forward_to_openai(payload):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not configured on the server.")

    upstream_body = json.dumps(payload).encode("utf-8")
    upstream_request = request.Request(
        OPENAI_API_URL,
        data=upstream_body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    with request.urlopen(upstream_request, timeout=180) as upstream_response:
        return json.loads(upstream_response.read().decode("utf-8"))


def forward_to_gemini(payload):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not configured on the server.")

    model = payload.get("model") or "gemini-2.5-flash"
    if model.startswith("gpt-"):
        model = "gemini-2.5-flash"
    instructions = payload.get("instructions", "")
    user_input = payload.get("input", "")
    gemini_payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_input}],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
        },
    }

    if instructions:
        gemini_payload["system_instruction"] = {
            "parts": [{"text": instructions}],
        }

    upstream_body = json.dumps(gemini_payload).encode("utf-8")
    upstream_request = request.Request(
        f"{GEMINI_API_BASE_URL}/{model}:generateContent",
        data=upstream_body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
    )

    with request.urlopen(upstream_request, timeout=180) as upstream_response:
        raw = json.loads(upstream_response.read().decode("utf-8"))

    text = ""
    candidates = raw.get("candidates") or []
    if candidates:
        content = candidates[0].get("content") or {}
        parts = content.get("parts") or []
        for part in parts:
            if "text" in part:
                text += part["text"]

    return {
        "output_text": text.strip(),
        "provider": "gemini",
        "raw_response": raw,
    }


if __name__ == "__main__":
    main()
