import argparse
from functools import partial
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from mimetypes import guess_type
from pathlib import Path
import sqlite3
from urllib.parse import parse_qs, unquote, urlsplit
from xml.parsers.expat import ExpatError
from zipfile import BadZipFile

from .stats import report
from .store import import_export, read_exposures


FILTERS = {"device", "range", "start", "end", "as_of", "offset"}
DEFAULT_DATABASE = Path("data/podstats.sqlite3")


def query_report(database, offset, query):
    offset = int(query.get("offset", offset))
    if not -1439 <= offset <= 1439:
        raise ValueError("offset must be between -1439 and 1439 minutes")
    return report(
        read_exposures(database),
        device=query.get("device"),
        preset=query.get("range", "all"),
        start=query.get("start"),
        end=query.get("end"),
        as_of=query.get("as_of"),
        offset=offset,
    )


class Handler(BaseHTTPRequestHandler):
    def __init__(self, request, client_address, server, *, database, offset, frontend=None):
        self.database = database
        self.offset = offset
        self.frontend = frontend
        super().__init__(request, client_address, server)

    def send_json(self, status, value):
        body = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        port = self.server.server_port
        if self.headers.get("Host") not in {f"127.0.0.1:{port}", f"localhost:{port}"}:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Use the local PodStats address"})
            return
        try:
            if self.frontend is not None and self.send_frontend():
                return
            result = self.route()
        except KeyError:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Unknown endpoint or device"})
        except (ValueError, OverflowError) as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except sqlite3.Error:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Could not read the local database"})
        else:
            self.send_json(HTTPStatus.OK, result)

    def send_frontend(self):
        path = urlsplit(self.path).path
        if path == "/":
            file = self.frontend / "index.html"
        elif path.startswith("/assets/"):
            name = unquote(path.removeprefix("/assets/"))
            if not name or "/" in name or "\\" in name or ":" in name or name in {".", ".."}:
                raise KeyError(path)
            file = self.frontend / "assets" / name
        else:
            return False
        if not file.is_file() or not file.resolve().is_relative_to(self.frontend):
            raise KeyError(path)
        body = file.read_bytes()
        mime = {
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".html": "text/html; charset=utf-8",
            ".webp": "image/webp",
        }.get(file.suffix, guess_type(file.name)[0] or "application/octet-stream")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)
        return True

    def route(self):
        path = urlsplit(self.path)
        if path.path == "/api/v1/health":
            return {"service": "PodStats", "status": "ok", "api_version": 1}
        if path.path not in {"/api/v1/dashboard", "/api/v1/sessions", "/api/v1/devices"}:
            raise KeyError(path.path)
        query = parse_qs(path.query, keep_blank_values=True, max_num_fields=8)
        supported = FILTERS | {"limit", "skip"} if path.path.endswith("/sessions") else FILTERS
        if set(query) - supported or any(len(values) != 1 or not values[0] for values in query.values()):
            raise ValueError("Invalid, repeated or unsupported query parameter")
        query = {name: values[0] for name, values in query.items()}
        if path.path.endswith("/sessions"):
            limit, skip = int(query.get("limit", 50)), int(query.get("skip", 0))
            if not 1 <= limit <= 200 or skip < 0:
                raise ValueError("limit must be 1–200 and skip must be nonnegative")
            dashboard, sessions = query_report(self.database, self.offset, query)
            return {
                "range": dashboard["range"],
                "offset_minutes": dashboard["offset_minutes"],
                "total": len(sessions),
                "limit": limit,
                "skip": skip,
                "items": sessions[::-1][skip:skip + limit],
            }
        dashboard, _ = query_report(self.database, self.offset, query)
        if path.path.endswith("/devices"):
            return {"range": dashboard["range"], "items": dashboard["devices"]}
        return dashboard


def main():
    parser = argparse.ArgumentParser(prog="podstats", description="Apple Health headphone statistics")
    parser.add_argument("--db", type=Path, default=DEFAULT_DATABASE)
    commands = parser.add_subparsers(dest="command", required=True)
    importer = commands.add_parser("import", help="Import an Apple Health ZIP or XML")
    importer.add_argument("export", type=Path)
    server = commands.add_parser("serve", help="Start the local JSON API")
    server.add_argument("--port", type=int, default=8765)
    server.add_argument("--offset", type=int, default=480, help="UTC offset in minutes")
    server.add_argument("--frontend", type=Path, help="Serve a built Vite frontend on the same local port")
    args = parser.parse_args()
    try:
        if args.command == "import":
            print(json.dumps(import_export(args.export, args.db), ensure_ascii=False))
        else:
            if not 0 <= args.port <= 65535 or not -1439 <= args.offset <= 1439:
                raise ValueError("Invalid port or UTC offset")
            args.db.parent.mkdir(parents=True, exist_ok=True)
            frontend = args.frontend.resolve() if args.frontend is not None else None
            if frontend is not None and not (frontend / "index.html").is_file():
                raise ValueError("Frontend build must contain index.html")
            handler = partial(Handler, database=args.db, offset=args.offset, frontend=frontend)
            with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as http:
                route = "/" if frontend is not None else "/api/v1/dashboard"
                print(f"PodStats: http://127.0.0.1:{http.server_port}{route}", flush=True)
                http.serve_forever()
    except KeyboardInterrupt:
        return
    except (OSError, ValueError, ExpatError, BadZipFile, sqlite3.Error) as exc:
        parser.exit(1, f"PodStats: {exc}\n")


if __name__ == "__main__":
    main()
