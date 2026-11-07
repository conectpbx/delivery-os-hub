"""Isolated mobile UI smoke test. All remote HTTP/WebSocket calls are intercepted.
Requires Python Playwright and Chromium; the local Vite server defaults to :3005.
No real login, production database, map provider or AI service is contacted.
"""
import base64
import json
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get("SMOKE_BASE_URL", "http://127.0.0.1:3005")
values = dict(line.split("=", 1) for line in (ROOT / ".env").read_text().splitlines() if "=" in line and not line.startswith("#"))
HOST = urlparse(values.get("VITE_SUPABASE_URL", values.get("SUPABASE_URL", "")).strip('"\'')).hostname
assert HOST, "public Supabase URL is needed to intercept its requests"
USER_ID = "00000000-0000-4000-8000-000000000001"
USER = {"id": USER_ID, "aud": "authenticated", "role": "authenticated", "email": "fixture@example.invalid", "app_metadata": {"provider": "email", "providers": ["email"]}, "user_metadata": {}, "created_at": "2025-01-01T00:00:00Z"}
def encoded(value):
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
TOKEN = encoded({"alg": "HS256", "typ": "JWT"}) + "." + encoded({"sub": USER_ID, "aud": "authenticated", "role": "authenticated", "iat": int(time.time()), "exp": int(time.time()) + 3600}) + ".TEST_ONLY_NOT_A_VALID_SIGNATURE"
SESSION = {"access_token": TOKEN, "refresh_token": "TEST_ONLY", "token_type": "bearer", "expires_in": 3600, "expires_at": int(time.time()) + 3600, "user": USER}
now = datetime.now(ZoneInfo("America/Sao_Paulo"))
def iso(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
rows = []
for index in range(45 + 800):
    at = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(minutes=index + 1) if index < 45 else now - timedelta(days=400, minutes=index)
    rows.append({"id": str(uuid.uuid4()), "user_id": USER_ID, "app_name": "iFood", "gross_earnings": 20, "fee_percent": 10, "earnings": 18, "tip": 0, "payment_method": "credito", "distance_km": 1, "duration_min": 10, "idle_min": 0, "occurred_at": iso(at), "status": "concluida", "started_at": None, "ended_at": None, "pickup_address": None, "dropoff_address": None, "lat": None, "lng": None, "stops": []})
requests = []
created = []

def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))

def handle(route):
    request = route.request
    parsed = urlparse(request.url)
    if parsed.hostname in ("127.0.0.1", "localhost"):
        return route.continue_()
    if parsed.hostname != HOST:
        return route.abort()
    path, params = parsed.path, parse_qs(parsed.query)
    headers = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "content-range"}
    if request.method == "OPTIONS":
        return route.fulfill(status=204, headers=headers)
    requests.append((request.method, path, params))
    if path.endswith("/auth/v1/user"):
        result = USER
    elif path.endswith("/rpc/get_my_system_access"):
        result = {"role": "user", "maintenanceMode": False, "modules": {name: True for name in ["dashboard", "deliveries", "finance", "maintenance", "goals", "scanner", "reports"]}}
    elif path.endswith("/rpc/is_super_admin"):
        result = False
    elif "/rpc/" in path:
        result = []
    elif path.endswith("/profiles"):
        result = [{"id": USER_ID, "full_name": "Fixture", "vehicle": "moto", "fuel_efficiency": 12, "daily_goal": 200, "monthly_goal": 5000}]
    elif path.endswith("/apps"):
        result = [{"id": "app-a", "user_id": USER_ID, "name": "iFood", "fee_percent": 10, "color": "#ef4444", "created_at": iso(now)}, {"id": "app-b", "user_id": USER_ID, "name": "Uber", "fee_percent": 15, "color": "#111111", "created_at": iso(now)}]
    elif path.endswith("/deliveries"):
        if request.method == "POST":
            payload = request.post_data_json
            if isinstance(payload, list): payload = payload[0]
            record = {"id": str(uuid.uuid4()), "occurred_at": iso(now), **payload}
            existing = next((item for item in rows if item["id"] == record["id"]), None)
            if not existing:
                rows.append(record)
                created.append(record)
            result = [existing or record]
        else:
            result = list(rows)
            for condition in params.get("app_name", []):
                if condition.startswith("eq."): result = [item for item in result if item["app_name"] == condition[3:]]
            for condition in params.get("status", []):
                if condition.startswith("eq."): result = [item for item in result if item["status"] == condition[3:]]
            for condition in params.get("occurred_at", []):
                if condition.startswith("gte."): result = [item for item in result if timestamp(item["occurred_at"]) >= timestamp(condition[4:])]
                if condition.startswith("lte."): result = [item for item in result if timestamp(item["occurred_at"]) <= timestamp(condition[4:])]
            if "or" in params:
                lower = re.search(r"occurred_at\.gte\.([^,)]+)", params["or"][0])
                upper = re.search(r"occurred_at\.lte\.([^,)]+)", params["or"][0])
                if lower: result = [item for item in result if timestamp(item["occurred_at"]) >= timestamp(lower[1])]
                if upper: result = [item for item in result if timestamp(item["occurred_at"]) <= timestamp(upper[1])]
            result.sort(key=lambda item: (item["occurred_at"], item["id"]), reverse=True)
            total = len(result)
            offset, limit = int(params.get("offset", [0])[0]), int(params.get("limit", [1000])[0])
            result = result[offset:offset + limit]
            headers["content-range"] = f"{offset}-{offset + len(result) - 1}/{total}"
            select = params.get("select", ["*"])[0]
            if select != "*": result = [{key: item.get(key) for key in select.split(",")} for item in result]
    else:
        result = []
    if "application/vnd.pgrst.object+json" in request.headers.get("accept", "") and isinstance(result, list):
        result = result[0] if result else None
    route.fulfill(status=200, content_type="application/json", headers=headers, body=json.dumps(result))

print("UI fixture: launching Chromium", flush=True)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"), headless=True, args=["--disable-dev-shm-usage"])
    print("UI fixture: browser launched", flush=True)
    context = browser.new_context(viewport={"width": 390, "height": 844}, timezone_id="America/Sao_Paulo", locale="pt-BR")
    context.route("**/*", handle)
    context.route_web_socket("**/*", lambda socket: socket.connect_to_server() if urlparse(socket.url).hostname in ("127.0.0.1", "localhost") else None)
    context.add_init_script("localStorage.setItem(" + json.dumps("sb-" + HOST.split(".")[0] + "-auth-token") + "," + json.dumps(json.dumps(SESSION)) + ");")
    if os.environ.get("SMOKE_INVALID_DRAFT"):
        context.add_init_script("localStorage.setItem(" + json.dumps("delivery-os-draft:" + USER_ID + ":entregas.stops") + ", 'null');")
    page = context.new_page()
    failures = []
    page.on("pageerror", lambda error: failures.append(str(error)))
    print("UI fixture: navigating", flush=True)
    page.goto(BASE + "/entregas", wait_until="domcontentloaded", timeout=30000)
    print("UI fixture: document loaded", flush=True)
    try:
        expect(page.get_by_role("button", name="Rápido", exact=True)).to_be_visible(timeout=20000)
    except Exception:
        page.screenshot(path="/tmp/delivery-fixture-failure.png", full_page=True)
        print("UI fixture body:", page.locator("body").inner_text()[:2500], flush=True)
        raise
    print("UI fixture: entry visible", flush=True)
    expect(page.get_by_text("45 corridas no período · 20 exibidas")).to_be_visible()
    page.get_by_role("button", name="Carregar mais 20").click()
    expect(page.get_by_text("45 corridas no período · 40 exibidas")).to_be_visible()
    history_requests = [query for method, path, query in requests if method == "GET" and path.endswith("/deliveries") and query.get("limit") == ["20"]]
    assert any(query.get("offset") == ["20"] for query in history_requests), "history fetched only the requested next page"
    assert all("occurred_at" in query or "or" in query or query.get("limit") == ["20"] for method, path, query in requests if method == "GET" and path.endswith("/deliveries")), "no implicit full-history fetch"
    entry = page.locator("section").filter(has=page.get_by_role("heading", name="Nova entrega", exact=True))
    entry.get_by_role("button", name="iFood", exact=True).click()
    entry.get_by_role("button", name="Definir ponto final", exact=True).click()
    entry.get_by_label("Endereço do ponto 1", exact=True).fill("Restaurante Central")
    entry.get_by_label("Endereço do ponto final", exact=True).fill("Rua Destino, 100")
    entry.get_by_role("button", name="Adicionar ponto adicional", exact=True).click()
    entry.get_by_label("Endereço do ponto 2", exact=True).fill("Rua Intermediária, 50")
    expect(entry.get_by_label("Endereço do ponto final", exact=True)).to_have_value("Rua Destino, 100")
    entry.get_by_role("button", name="Completo", exact=True).click()
    expect(entry.get_by_role("button", name="Adicionar ponto adicional", exact=True)).to_be_visible()
    expect(entry.get_by_label("Endereço do ponto final", exact=True)).to_have_value("Rua Destino, 100")
    entry.get_by_role("button", name="Rápido", exact=True).click()
    value = entry.get_by_label("Valor bruto (R$)", exact=True)
    value.fill("20,00")
    expect(entry.get_by_text(re.compile(r"Líquido:.*18,00"))).to_be_visible()
    before = len(requests)
    value.fill("25,00")
    value.fill("20,00")
    page.wait_for_timeout(700)
    assert not any(path.endswith("/deliveries") for method, path, query in requests[before:]), "typing does not refetch history/summary"
    entry.get_by_role("button", name="Completo", exact=True).click()
    entry.locator("#payment-method").select_option("pix")
    entry.get_by_role("button", name="Rápido", exact=True).click()
    expect(entry.get_by_text(re.compile(r"Recebimento: Pix"))).to_be_visible()
    entry.get_by_role("button", name="Registrar entrega concluída").click()
    page.wait_for_timeout(500)
    assert len(created) == 1
    assert created[0]["gross_earnings"] == 20 and created[0]["earnings"] == 18 and created[0]["fee_percent"] == 10
    assert created[0]["payment_method"] == "pix" and created[0]["status"] == "concluida"
    assert [stop["address"] for stop in created[0]["stops"]] == ["Restaurante Central", "Rua Intermediária, 50", "Rua Destino, 100"]
    assert created[0]["pickup_address"] == "Restaurante Central"
    assert created[0]["dropoff_address"] == "Rua Destino, 100"
    context.set_offline(True)
    page.wait_for_function("!navigator.onLine")
    value.fill("10,00")
    entry.get_by_role("button", name="Registrar entrega concluída").click()
    expect(value).to_have_value("")
    assert len(created) == 1, "offline save does not require the backend"
    context.set_offline(False)
    page.wait_for_function("navigator.onLine")
    page.wait_for_timeout(1200)
    assert len(created) == 2 and created[1]["earnings"] == 9, "offline queue syncs the quick entry once"
    page.screenshot(path=os.environ.get("DELIVERY_SCREENSHOT", "/tmp/delivery-fast-ui.png"), full_page=True)
    assert not failures, failures
    browser.close()
print("Mobile Chromium: date-filtered queries, 20-row history, app/fee chips, isolated typing, usual payment, additional/final stops in both modes and online/offline quick saves passed.")
