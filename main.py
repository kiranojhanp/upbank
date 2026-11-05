import asyncio
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

UP_API_BASE_URL = "https://api.up.com.au/api/v1"
EVENT_QUEUE_MAX = 20

# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
# The session cookie carries an opaque random id only. The Up personal access
# token lives in this server-side table, so it never reaches the browser — a
# signed cookie is tamper-proof but readable, which is not good enough for a
# banking credential. The table also lets a login survive a server restart.
SESSION_COOKIE_NAME = "up_session"
SESSION_HTTPS_ONLY = bool(os.environ.get("SESSION_HTTPS_ONLY"))


def _positive_int_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default


SESSION_TTL_SECONDS = _positive_int_env("SESSION_TTL_DAYS", 30) * 24 * 60 * 60
# Refresh last_seen/expiry at most once an hour instead of on every request.
SESSION_TOUCH_SECONDS = 60 * 60
# Re-check the Up token against Up at most this often. Between checks the boot
# probe trusts the stored session, which keeps page loads off the Up API while
# still catching a revoked token within the window.
SESSION_VERIFY_SECONDS = _positive_int_env("SESSION_VERIFY_HOURS", 6) * 60 * 60
SESSION_DB_PATH = os.environ.get(
    "SESSION_DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".sessions.sqlite3"),
)


def _session_db() -> sqlite3.Connection:
    connection = sqlite3.connect(SESSION_DB_PATH, timeout=5.0)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def init_session_store() -> None:
    connection = _session_db()
    try:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id           TEXT PRIMARY KEY,
                access_token TEXT NOT NULL,
                webhook_id   TEXT,
                uid          TEXT NOT NULL,
                created_at   REAL NOT NULL,
                last_seen    REAL NOT NULL,
                expires_at   REAL NOT NULL,
                verified_at  REAL
            )
            """
        )
        # Migrate stores created before token verification was tracked.
        columns = {row[1] for row in connection.execute("PRAGMA table_info(sessions)")}
        if "verified_at" not in columns:
            connection.execute("ALTER TABLE sessions ADD COLUMN verified_at REAL")
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (time.time(),))
        connection.commit()
    finally:
        connection.close()
    try:
        os.chmod(SESSION_DB_PATH, 0o600)
    except OSError:
        pass


def create_session(token: str) -> tuple[str, str, float]:
    """Create a session and return (id, user fingerprint, expiry)."""
    session_id = secrets.token_urlsafe(32)
    now = time.time()
    expires_at = now + SESSION_TTL_SECONDS
    # A stable, non-reversible fingerprint. The browser uses it to scope its
    # local cache, so two Up accounts on one machine never share rows.
    uid = hashlib.sha256(token.encode()).hexdigest()[:16]
    connection = _session_db()
    try:
        # Login already pinged Up, so the token starts out verified.
        connection.execute(
            "INSERT INTO sessions"
            " (id, access_token, webhook_id, uid, created_at, last_seen, expires_at, verified_at)"
            " VALUES (?, ?, NULL, ?, ?, ?, ?, ?)",
            (session_id, token, uid, now, now, expires_at, now),
        )
        connection.commit()
    finally:
        connection.close()
    return session_id, uid, expires_at


def load_session(session_id: Optional[str]) -> Optional[dict]:
    """Look up a session, deleting it if expired. Slides the expiry at most hourly."""
    if not session_id:
        return None

    now = time.time()
    connection = _session_db()
    try:
        row = connection.execute(
            "SELECT id, access_token, webhook_id, uid, last_seen, expires_at, verified_at"
            " FROM sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
        if row is None:
            return None
        if row["expires_at"] <= now:
            connection.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            connection.commit()
            return None

        expires_at = row["expires_at"]
        renewed = now - row["last_seen"] >= SESSION_TOUCH_SECONDS
        if renewed:
            expires_at = now + SESSION_TTL_SECONDS
            connection.execute(
                "UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?",
                (now, expires_at, session_id),
            )
            connection.commit()

        return {
            "id": row["id"],
            "access_token": row["access_token"],
            "webhook_id": row["webhook_id"],
            "uid": row["uid"],
            "expires_at": expires_at,
            "verified_at": row["verified_at"],
            "renewed": renewed,
        }
    finally:
        connection.close()


def delete_session(session_id: str) -> None:
    connection = _session_db()
    try:
        connection.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        connection.commit()
    finally:
        connection.close()


def set_session_webhook(session_id: str, webhook_id: str) -> None:
    connection = _session_db()
    try:
        connection.execute(
            "UPDATE sessions SET webhook_id = ? WHERE id = ?", (webhook_id, session_id)
        )
        connection.commit()
    finally:
        connection.close()


def set_session_verified(session_id: str, verified_at: float) -> None:
    connection = _session_db()
    try:
        connection.execute(
            "UPDATE sessions SET verified_at = ? WHERE id = ?", (verified_at, session_id)
        )
        connection.commit()
    finally:
        connection.close()


def set_session_cookie(response: Response, session_id: str, expires_at: float) -> None:
    response.set_cookie(
        SESSION_COOKIE_NAME,
        session_id,
        max_age=max(1, int(expires_at - time.time())),
        httponly=True,
        # Strict, not lax: no cross-site request should ever carry this cookie.
        # The trade-off is that following an external link to the app shows the
        # login screen once, which is the right default for banking data.
        samesite="strict",
        secure=SESSION_HTTPS_ONLY,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="strict",
        secure=SESSION_HTTPS_ONLY,
    )


def get_session(request: Request) -> Optional[dict]:
    return getattr(request.state, "session", None)

# Module-level state — mirrors the Node version's single-user model.
# Up's webhook calls have no browser session, so the token and secret
# have to live here.
webhook_secret: Optional[str] = None
user_access_token: Optional[str] = None
event_queue: list[dict] = []

http: httpx.AsyncClient


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http
    init_session_store()
    http = httpx.AsyncClient(timeout=30.0)
    try:
        yield
    finally:
        await http.aclose()


app = FastAPI(lifespan=lifespan)

# ---------------------------------------------------------------------------
# Security headers + same-origin enforcement
# ---------------------------------------------------------------------------
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})

# The SPA is same-origin only: no CDNs, no third-party fonts, no inline
# scripts. `style-src 'unsafe-inline'` is required because React writes
# `style` attributes; it cannot exfiltrate data because connect-src is 'self'.
# `'wasm-unsafe-eval'` is required to compile the SQLite (wa-sqlite) engine used
# by the local cache; it permits WebAssembly only, not JavaScript eval.
CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "worker-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)

ALLOWED_ORIGINS = {
    origin.strip().rstrip("/")
    for origin in os.environ.get("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
}


def _origin_is_trusted(origin: str, request: Request) -> bool:
    """Allow same-origin requests and explicitly configured origins.

    `Host` is the host of the direct connection. When a dev proxy or reverse
    proxy rewrites it, `X-Forwarded-Host` carries the browser-visible host, so
    both are accepted. Neither can be set by a cross-origin browser request
    (they are forbidden headers), so this does not weaken the CSRF check.
    """
    if origin in ALLOWED_ORIGINS:
        return True

    parsed = urlparse(origin)
    if parsed.scheme not in {"http", "https"}:
        return False

    candidates = {
        request.headers.get("host"),
        request.headers.get("x-forwarded-host"),
    }
    return any(candidate and parsed.netloc == candidate for candidate in candidates)


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    # CSRF defence in depth: the session cookie is already SameSite=Strict, but
    # an explicit Origin check also covers older browsers and non-browser
    # clients. GET-style methods are exempt.
    if request.method not in SAFE_METHODS:
        origin = request.headers.get("origin")
        if origin is not None and not _origin_is_trusted(origin, request):
            return JSONResponse(
                status_code=403, content={"error": "cross_origin_request_blocked"}
            )

    # Resolve the opaque session id once per request. Handlers read it from
    # request.state instead of re-querying SQLite.
    request.state.session = load_session(request.cookies.get(SESSION_COOKIE_NAME))

    response = await call_next(request)

    # Sliding expiry: refresh the cookie's Max-Age alongside the stored expiry.
    session = get_session(request)
    if session and session["renewed"]:
        set_session_cookie(response, session["id"], session["expires_at"])

    headers = response.headers
    headers.setdefault("Content-Security-Policy", CONTENT_SECURITY_POLICY)
    headers.setdefault("X-Content-Type-Options", "nosniff")
    headers.setdefault("X-Frame-Options", "DENY")
    headers.setdefault("Referrer-Policy", "no-referrer")
    headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
    headers.setdefault(
        "Permissions-Policy",
        "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    )

    # Financial data must not sit in the HTTP cache or a shared proxy.
    if request.url.path.startswith("/api/") or request.url.path == "/":
        headers["Cache-Control"] = "no-store, max-age=0"
        headers["Pragma"] = "no-cache"

    return response

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
FRONTEND_DIST = os.path.join(BASE_DIR, "frontend", "dist")


# ---------------------------------------------------------------------------
# Errors — keep the {"error": "..."} shape the existing frontend expects
# ---------------------------------------------------------------------------
class ApiError(HTTPException):
    def __init__(self, status_code: int, error: str):
        super().__init__(status_code=status_code, detail={"error": error})


@app.exception_handler(HTTPException)
async def _http_exc_handler(request: Request, exc: HTTPException):
    if isinstance(exc.detail, dict) and "error" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def get_token(request: Request) -> str:
    session = get_session(request)
    if not session:
        raise ApiError(401, "session_expired")
    return session["access_token"]


def status_error(e: httpx.HTTPStatusError, fallback: str) -> HTTPException:
    if e.response.status_code == 401:
        return ApiError(401, "session_expired")
    return ApiError(500, fallback)


async def fetch_all_pages(url: str, token: str) -> list[dict]:
    results: list[dict] = []
    next_url: Optional[str] = url
    while next_url:
        resp = await http.get(next_url, headers=auth_headers(token))
        resp.raise_for_status()
        body = resp.json()
        results.extend(body.get("data", []))
        next_url = (body.get("links") or {}).get("next")
    return results


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------
class LoginBody(BaseModel):
    accessToken: str


class TagsBody(BaseModel):
    tags: list[str]


class CategoryBody(BaseModel):
    categoryId: Optional[str] = None


# ---------------------------------------------------------------------------
# Frontend (React SPA)
# ---------------------------------------------------------------------------
def frontend_index():
    index_file = os.path.join(FRONTEND_DIST, "index.html")
    if not os.path.isfile(index_file):
        return JSONResponse(
            {
                "detail": (
                    "Frontend has not been built. Run "
                    "`cd frontend && npm install && npm run build`."
                )
            },
            status_code=503,
        )
    return FileResponse(index_file)


@app.get("/")
async def index_page():
    return frontend_index()


# ---------------------------------------------------------------------------
# Login / Logout
# ---------------------------------------------------------------------------
@app.post("/api/login")
async def login(body: LoginBody, request: Request, response: Response):
    token = body.accessToken
    if not token:
        raise ApiError(400, "Access token is required")

    try:
        r = await http.get(f"{UP_API_BASE_URL}/util/ping", headers=auth_headers(token))
        r.raise_for_status()
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise ApiError(401, "Invalid access token. Please check and try again.")
        raise ApiError(502, "Up API error")

    session_id, uid, expires_at = create_session(token)

    global user_access_token
    user_access_token = token

    webhook_url = os.environ.get("WEBHOOK_URL")
    if webhook_url and urlparse(webhook_url).scheme == "https":
        try:
            existing = await fetch_all_pages(f"{UP_API_BASE_URL}/webhooks", token)
            for wh in existing:
                if wh["attributes"]["url"] == webhook_url:
                    await http.delete(
                        f"{UP_API_BASE_URL}/webhooks/{wh['id']}",
                        headers=auth_headers(token),
                    )

            resp = await http.post(
                f"{UP_API_BASE_URL}/webhooks",
                json={
                    "data": {
                        "attributes": {
                            "url": webhook_url,
                            "description": "Up Web App Webhook",
                        }
                    }
                },
                headers=auth_headers(token),
            )
            resp.raise_for_status()
            wh = resp.json()["data"]
            set_session_webhook(session_id, wh["id"])
            global webhook_secret
            webhook_secret = wh["attributes"]["secretKey"]
            print(f"Registered webhook: {wh['id']}")
        except Exception as e:
            print("Webhook management error:", e)

    set_session_cookie(response, session_id, expires_at)
    return {"ok": True, "uid": uid, "expiresAt": expires_at}


@app.get("/api/session")
async def session_info(request: Request):
    """Session probe used on boot, before any Collection is materialised.

    It verifies the Up token so a revoked token cannot render local cached
    rows, but only once per `SESSION_VERIFY_HOURS`; younger sessions are
    trusted so a page load does not always cost an Up request. A network
    failure is reported as `verified: False` rather than a sign-out, so the
    app still works offline from its cache.
    """
    session = get_session(request)
    if not session:
        raise ApiError(401, "session_expired")

    now = time.time()
    verified_at = session["verified_at"] or 0.0
    if now - verified_at < SESSION_VERIFY_SECONDS:
        return {
            "authenticated": True,
            "uid": session["uid"],
            "expiresAt": session["expires_at"],
            "verified": True,
            "verifiedAt": verified_at,
        }

    verified = False
    try:
        r = await http.get(
            f"{UP_API_BASE_URL}/util/ping", headers=auth_headers(session["access_token"])
        )
        if r.status_code in (401, 403):
            delete_session(session["id"])
            raise ApiError(401, "session_expired")
        r.raise_for_status()
        verified = True
        verified_at = now
        set_session_verified(session["id"], now)
    except httpx.HTTPError:
        # Up is unreachable or returned a server error. Keep the session and
        # try again on the next boot.
        pass

    return {
        "authenticated": True,
        "uid": session["uid"],
        "expiresAt": session["expires_at"],
        "verified": verified,
        "verifiedAt": verified_at,
    }


async def _clear_session(request: Request) -> None:
    session = get_session(request)
    if session:
        webhook_id = session["webhook_id"]
        if webhook_id:
            try:
                await http.delete(
                    f"{UP_API_BASE_URL}/webhooks/{webhook_id}",
                    headers=auth_headers(session["access_token"]),
                )
            except Exception as e:
                print("Error deleting webhook:", e)
        delete_session(session["id"])

    global user_access_token
    user_access_token = None


@app.get("/logout")
async def logout(request: Request):
    await _clear_session(request)
    redirect = RedirectResponse("/", status_code=303)
    clear_session_cookie(redirect)
    return redirect


@app.post("/api/logout")
async def api_logout(request: Request, response: Response):
    await _clear_session(request)
    clear_session_cookie(response)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------
@app.get("/api/accounts")
async def get_accounts(token: str = Depends(get_token)):
    try:
        accounts = await fetch_all_pages(f"{UP_API_BASE_URL}/accounts", token)
    except httpx.HTTPStatusError as e:
        raise status_error(e, "Could not fetch accounts")
    return {"accounts": accounts}


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------
@app.get("/api/accounts/{account_id}/transactions")
async def get_account_transactions(
    account_id: str,
    token: str = Depends(get_token),
    status_filter: Optional[str] = Query(None, alias="status"),
    since: Optional[str] = None,
    until: Optional[str] = None,
    category: Optional[str] = None,
    tag: Optional[str] = None,
    pageSize: Optional[str] = "50",
):
    params: dict[str, str] = {"page[size]": pageSize or "50"}
    if status_filter:
        params["filter[status]"] = status_filter
    if since:
        params["filter[since]"] = since
    if until:
        params["filter[until]"] = until
    if category:
        params["filter[category]"] = category
    if tag:
        params["filter[tag]"] = tag

    try:
        tx_resp, categories = await asyncio.gather(
            http.get(
                f"{UP_API_BASE_URL}/accounts/{account_id}/transactions",
                params=params,
                headers=auth_headers(token),
            ),
            fetch_all_pages(f"{UP_API_BASE_URL}/categories", token),
        )
        tx_resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise status_error(e, "Could not fetch transactions")

    body = tx_resp.json()
    category_map = {c["id"]: c["attributes"]["name"] for c in categories}

    return {
        "transactions": body.get("data", []),
        "nextPage": (body.get("links") or {}).get("next"),
        "categoryMap": category_map,
    }


@app.get("/api/transactions/next")
async def get_next_transactions(cursor: str, token: str = Depends(get_token)):
    try:
        r = await http.get(cursor, headers=auth_headers(token))
        r.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise status_error(e, "Could not fetch transactions")

    body = r.json()
    return {
        "transactions": body.get("data", []),
        "nextPage": (body.get("links") or {}).get("next"),
    }


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------
@app.get("/api/tags")
async def get_tags(token: str = Depends(get_token)):
    try:
        tags = await fetch_all_pages(f"{UP_API_BASE_URL}/tags", token)
    except httpx.HTTPStatusError as e:
        raise status_error(e, "Could not fetch tags")
    return {"tags": tags}


@app.post("/api/transactions/{tx_id}/tags", status_code=204)
async def add_tags(tx_id: str, body: TagsBody, token: str = Depends(get_token)):
    payload = {"data": [{"type": "tags", "id": label} for label in body.tags]}
    try:
        r = await http.post(
            f"{UP_API_BASE_URL}/transactions/{tx_id}/relationships/tags",
            json=payload,
            headers=auth_headers(token),
        )
        r.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise status_error(e, "Could not add tags")
    return Response(status_code=204)


@app.delete("/api/transactions/{tx_id}/tags", status_code=204)
async def remove_tags(tx_id: str, body: TagsBody, token: str = Depends(get_token)):
    payload = {"data": [{"type": "tags", "id": label} for label in body.tags]}
    try:
        r = await http.request(
            "DELETE",
            f"{UP_API_BASE_URL}/transactions/{tx_id}/relationships/tags",
            json=payload,
            headers=auth_headers(token),
        )
        r.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise status_error(e, "Could not remove tags")
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Category
# ---------------------------------------------------------------------------
@app.patch("/api/transactions/{tx_id}/category", status_code=204)
async def update_category(tx_id: str, body: CategoryBody, token: str = Depends(get_token)):
    payload = (
        {"data": {"type": "categories", "id": body.categoryId}}
        if body.categoryId
        else {"data": None}
    )
    try:
        r = await http.patch(
            f"{UP_API_BASE_URL}/transactions/{tx_id}/relationships/category",
            json=payload,
            headers=auth_headers(token),
        )
        r.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise status_error(e, "Could not update category")
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Webhooks
# ---------------------------------------------------------------------------
@app.post("/api/webhooks")
async def receive_webhook(request: Request):
    global webhook_secret
    raw_body = await request.body()

    if webhook_secret:
        signature = request.headers.get("x-up-authenticity-signature")
        if not signature:
            print("Webhook received without signature — rejecting")
            raise ApiError(401, "missing signature")

        expected = hmac.new(
            webhook_secret.encode(), raw_body, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            print("Webhook signature mismatch — rejecting")
            raise ApiError(401, "invalid signature")

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        raise ApiError(400, "invalid json")

    data = payload.get("data") or {}
    attrs = data.get("attributes") or {}
    event_type = attrs.get("eventType")
    rel = data.get("relationships") or {}
    transaction_id = ((rel.get("transaction") or {}).get("data") or {}).get("id")

    if event_type and event_type != "PING":
        event: dict = {"type": event_type}
        if transaction_id and user_access_token:
            try:
                r = await http.get(
                    f"{UP_API_BASE_URL}/transactions/{transaction_id}",
                    headers=auth_headers(user_access_token),
                )
                r.raise_for_status()
                tx = r.json()["data"]["attributes"]
                event["description"] = tx.get("description")
                event["amount"] = (tx.get("amount") or {}).get("value")
            except Exception as e:
                print("Could not fetch transaction for webhook event:", e)

        if len(event_queue) >= EVENT_QUEUE_MAX:
            event_queue.pop(0)
        event_queue.append(event)
        print(f"Queued webhook event: {event_type}", event.get("description", ""))

    return Response(status_code=200)


@app.get("/api/events")
async def get_events():
    events = list(event_queue)
    event_queue.clear()
    return {"events": events}

# ---------------------------------------------------------------------------
# Static assets + SPA fallback (registered last so API routes win)
# ---------------------------------------------------------------------------
if os.path.isdir(os.path.join(FRONTEND_DIST, "assets")):
    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")),
        name="assets",
    )


@app.get("/{file_path:path}")
async def serve_frontend(file_path: str):
    if file_path.startswith("api/"):
        raise ApiError(404, "not_found")

    candidate = os.path.normpath(os.path.join(FRONTEND_DIST, file_path))
    if candidate.startswith(FRONTEND_DIST + os.sep) and os.path.isfile(candidate):
        return FileResponse(candidate)

    return frontend_index()
