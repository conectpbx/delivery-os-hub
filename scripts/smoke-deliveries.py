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
rows[44]["status"] = "em_rota"
requests = []
created = []
updated = []
maintenance_created = []
maintenance_failure = True

def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))

def handle(route):
    global maintenance_failure
    request = route.request
    parsed = urlparse(request.url)
    if parsed.hostname in ("127.0.0.1", "localhost"):
        return route.continue_()
    if parsed.hostname == "nominatim.openstreetmap.org":
        fixture = {"address": {"road": "Rua GPS do teste", "house_number": "42", "city": "São Paulo"}} if parsed.path.endswith("/reverse") else [{"lat": "-23.56", "lon": "-46.64"}]
        return route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(fixture))
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
    elif path.endswith("/maintenances"):
        if request.method == "POST":
            if maintenance_failure and os.environ.get("SMOKE_MODULES_ONLY"):
                maintenance_failure = False
                return route.fulfill(status=503, content_type="application/json", headers=headers, body=json.dumps({"message": "fixture unavailable"}))
            payload = request.post_data_json
            record = {"id": str(uuid.uuid4()), **payload}
            maintenance_created.append(record)
            result = [record]
        else:
            result = list(maintenance_created)
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
        elif request.method == "PATCH":
            record = next(item for item in rows if "eq." + item["id"] in params.get("id", []))
            record.update(request.post_data_json)
            updated.append(dict(record))
            result = [record]
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
    context = browser.new_context(viewport={"width": 390, "height": 844}, timezone_id="America/Sao_Paulo", locale="pt-BR", permissions=["geolocation"], geolocation={"latitude": -23.55, "longitude": -46.63})
    context.route("**/*", handle)
    context.route_web_socket("**/*", lambda socket: socket.connect_to_server() if urlparse(socket.url).hostname in ("127.0.0.1", "localhost") else None)
    context.add_init_script("localStorage.setItem(" + json.dumps("sb-" + HOST.split(".")[0] + "-auth-token") + "," + json.dumps(json.dumps(SESSION)) + ");")
    if os.environ.get("SMOKE_INVALID_DRAFT"):
        context.add_init_script("localStorage.setItem(" + json.dumps("delivery-os-draft:" + USER_ID + ":entregas.stops") + ", 'null');")
    page = context.new_page()
    failures = []
    page.on("pageerror", lambda error: failures.append(str(error)))
    if os.environ.get("SMOKE_MODULES_ONLY"):
        for route_name in os.environ.get("SMOKE_MODULE_NAMES", "dashboard,entregas,financeiro,manutencao,metas,scanner,relatorios").split(","):
            page.goto(BASE + "/" + route_name, wait_until="domcontentloaded", timeout=30000)
            expect(page.locator("main")).to_be_visible(timeout=20000)
            expect(page.get_by_text("This page didn't load", exact=True)).to_have_count(0)
            for width in [320, 768, 1440]:
                page.set_viewport_size({"width": width, "height": 900})
                page.wait_for_timeout(100)
                if page.evaluate("document.documentElement.scrollWidth > innerWidth"):
                    print("Overflow:", page.evaluate("Array.from(document.querySelectorAll('main *')).filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1; }).slice(0,15).map(el => ({tag:el.tagName, cls:el.className, text:el.textContent.slice(0,60), right:el.getBoundingClientRect().right}))"), flush=True)
                    page.screenshot(path=f"/tmp/review-overflow-{route_name}-{width}.png")
                    raise AssertionError(f"{route_name}: horizontal overflow at {width}px")
            page.screenshot(path=f"/tmp/review-{route_name}.png", full_page=False)
            print(f"Module {route_name}: opened, layouts 320/768/1440 passed", flush=True)
        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(BASE + "/financeiro", wait_until="domcontentloaded")
        expect(page.get_by_role("button", name="Tudo", exact=True)).to_be_visible(timeout=20000)
        page.get_by_role("button", name="Tudo", exact=True).click()
        assert page.get_by_label("Início", exact=True).input_value() < "2020-01-01"
        page.get_by_label("Início", exact=True).fill("2026-12-01")
        expect(page.get_by_label("Fim", exact=True)).to_have_value("2026-12-01")
        page.get_by_label("Fim", exact=True).fill("2026-10-01")
        expect(page.get_by_label("Início", exact=True)).to_have_value("2026-10-01")
        page.goto(BASE + "/manutencao", wait_until="domcontentloaded")
        expect(page.get_by_label("Custo (R$)", exact=True)).to_be_visible(timeout=20000)
        page.get_by_label("Custo (R$)", exact=True).fill("125,50")
        page.get_by_label("Odômetro atual", exact=True).fill("12.000")
        page.get_by_label("Próximo serviço (km)", exact=True).fill("11.000")
        page.get_by_role("button", name="Salvar manutenção", exact=True).click()
        expect(page.get_by_text("A próxima quilometragem deve ser maior que o odômetro atual.", exact=True)).to_be_visible()
        assert not maintenance_created
        page.get_by_label("Próximo serviço (km)", exact=True).fill("15.000")
        page.get_by_role("button", name="Salvar manutenção", exact=True).click()
        expect(page.get_by_text("Não foi possível registrar a manutenção. Tente novamente.", exact=True)).to_be_visible()
        expect(page.get_by_label("Custo (R$)", exact=True)).to_have_value("125,50")
        page.get_by_role("button", name="Salvar manutenção", exact=True).click()
        expect(page.get_by_label("Custo (R$)", exact=True)).to_have_value("")
        assert len(maintenance_created) == 1 and maintenance_created[0]["cost"] == 125.5
        assert maintenance_created[0]["odometer"] == 12000 and maintenance_created[0]["next_due_km"] == 15000
        assert not failures, failures
        browser.close()
        print("Modules: opening/responsive checks, maintenance decimal validation, failed-save preservation and retry passed.")
        raise SystemExit(0)
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
    assert not any(path.endswith("/goals") or (path.endswith("/deliveries") and query.get("limit") == ["500"]) for method, path, query in requests), "delivery screen does not fetch dashboard goals or learning history"
    expect(page.get_by_text("Total recebido", exact=True)).to_have_count(0)

    expect(page.get_by_text("45 corridas no período · 20 exibidas")).to_be_visible()
    page.get_by_role("button", name="Carregar mais 20").click()
    expect(page.get_by_text("45 corridas no período · 40 exibidas")).to_be_visible()
    history_requests = [query for method, path, query in requests if method == "GET" and path.endswith("/deliveries") and query.get("limit") == ["20"]]
    assert any(query.get("offset") == ["20"] for query in history_requests), "history fetched only the requested next page"
    assert all("occurred_at" in query or "or" in query or query.get("limit") == ["20"] for method, path, query in requests if method == "GET" and path.endswith("/deliveries")), "no implicit full-history fetch"
    active_card = page.locator("li").filter(has=page.get_by_role("button", name="Entrega concluída (GPS)", exact=True))
    expect(active_card.get_by_role("button", name="Adicionar ponto adicional", exact=True)).to_be_visible()
    expect(active_card.get_by_role("button", name="Editar paradas", exact=True)).to_be_visible()
    active_card.get_by_role("button", name="Adicionar ponto adicional", exact=True).click()
    active_card.get_by_label("Endereço adicional 1", exact=True).fill("Parada intermediária em rota")
    expect(active_card.get_by_role("button", name="Entrega concluída", exact=True)).to_be_disabled()
    active_card.get_by_role("button", name="Salvar pontos", exact=True).click()
    active_card.locator("summary").filter(has_text="Ver percurso").click()
    expect(active_card.get_by_text("Parada intermediária em rota", exact=True)).to_be_visible()
    assert updated[-1]["status"] == "em_rota"
    active_card.get_by_role("button", name="Editar paradas", exact=True).click()
    active_card.get_by_label("Endereço final da entrega em rota", exact=True).fill("Destino final em rota")
    active_card.get_by_role("button", name="Entrega concluída", exact=True).click()
    expect(page.get_by_text("Destino final em rota", exact=True)).to_be_visible(timeout=20000)
    assert updated[-1]["status"] == "concluida"
    assert updated[-1]["dropoff_address"] == "Destino final em rota"
    assert [stop["address"] for stop in updated[-1]["stops"]] == ["Parada intermediária em rota", "Destino final em rota"]
    entry = page.locator("section").filter(has=page.get_by_role("heading", name="Nova entrega", exact=True))
    expect(entry.get_by_role("button", name="Definir ponto inicial", exact=True)).to_have_count(0)
    expect(entry.get_by_role("button", name="Definir ponto final", exact=True)).to_have_count(0)
    expect(entry.get_by_role("button", name=re.compile("concluída|Finalizar rota"))).to_have_count(0)
    entry.get_by_role("button", name="iFood", exact=True).click()
    entry.get_by_role("button", name="Inserir rota", exact=True).click()
    entry.get_by_label("Endereço do ponto inicial", exact=True).fill("Restaurante Central")
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
    expect(entry.get_by_text(re.compile(r"Valor da entrega:.*20,00"))).to_be_visible()
    before = len(requests)
    value.fill("25,00")
    value.fill("20,00")
    page.wait_for_timeout(700)
    assert not any(path.endswith("/deliveries") for method, path, query in requests[before:]), "typing does not refetch history/summary"
    entry.get_by_role("button", name="Completo", exact=True).click()
    expect(entry.get_by_role("button", name=re.compile("concluída|Finalizar rota"))).to_have_count(0)
    entry.locator("#payment-method").select_option("pix")
    entry.get_by_label("Gratificação do cliente (R$)", exact=True).fill("7,00")
    entry.get_by_role("button", name="Rápido", exact=True).click()
    expect(entry.get_by_text(re.compile(r"Recebimento: Pix"))).to_be_visible()
    entry.get_by_role("button", name="Iniciar entrega", exact=True).click()
    expect(value).to_have_value("", timeout=20000)
    assert len(created) == 1
    assert created[0]["gross_earnings"] == 20 and created[0]["earnings"] == 20 and created[0]["fee_percent"] == 0 and created[0]["tip"] == 0
    assert created[0]["payment_method"] == "pix" and created[0]["status"] == "em_rota"
    assert [stop["address"] for stop in created[0]["stops"]] == ["Restaurante Central", "Rua Intermediária, 50", "Rua Destino, 100"]
    assert created[0]["pickup_address"] == "Restaurante Central"
    assert all(stop["lat"] is not None and stop["lng"] is not None for stop in created[0]["stops"])
    assert created[0]["dropoff_address"] is None
    assert created[0]["started_at"] and created[0]["ended_at"] is None
    context.set_offline(True)
    page.wait_for_function("!navigator.onLine")
    value.fill("10,00")
    entry.get_by_role("button", name="Iniciar entrega", exact=True).click()
    expect(value).to_have_value("")
    assert len(created) == 1, "offline save does not require the backend"
    context.set_offline(False)
    page.wait_for_function("navigator.onLine")
    page.wait_for_timeout(1200)
    assert len(created) == 2 and created[1]["earnings"] == 10, "offline queue syncs the quick entry once"
    assert created[1]["status"] == "em_rota" and created[1]["lat"] == -23.55 and created[1]["lng"] == -46.63
    assert created[1]["stops"][0]["kind"] == "coleta"
    page.locator('[data-delivery-id="' + created[1]["id"] + '"] summary').filter(has_text="Ver percurso").click()
    expect(page.get_by_text("Rua GPS do teste, 42, São Paulo", exact=True).first).to_be_visible(timeout=20000)
    value.fill("30,00")
    entry.get_by_role("button", name="Inserir rota", exact=True).click()
    entry.get_by_label("Endereço do ponto inicial", exact=True).fill("Coleta da entrega iniciada")
    entry.get_by_role("button", name="Iniciar entrega", exact=True).click()
    expect(value).to_have_value("")
    assert len(created) == 3 and created[-1]["status"] == "em_rota"
    started_id = created[-1]["id"]
    started_at = created[-1]["started_at"]
    assert started_at and created[-1]["ended_at"] is None
    assert created[-1]["pickup_address"] == "Coleta da entrega iniciada"
    active_card = page.locator('[data-delivery-id="' + started_id + '"]')
    active_card.locator("summary").filter(has_text="Ver percurso").click()
    active_card.get_by_role("button", name="Editar paradas", exact=True).click()
    active_card.get_by_label("Endereço final da entrega em rota", exact=True).fill("Destino da entrega iniciada")
    active_card.get_by_role("button", name="Entrega concluída", exact=True).click()
    expect(page.get_by_text("Destino da entrega iniciada", exact=True)).to_be_visible(timeout=20000)
    assert len(created) == 3, "finishing updates the started delivery instead of inserting another one"
    assert updated[-1]["id"] == started_id and updated[-1]["status"] == "concluida"
    assert updated[-1]["started_at"] == started_at and updated[-1]["ended_at"]
    assert updated[-1]["dropoff_address"] == "Destino da entrega iniciada"
    page.evaluate("() => { navigator.geolocation.getCurrentPosition = (_success, error) => error({code: 1, message: 'fixture: permission denied'}); }")
    entry.get_by_role("button", name="Completo", exact=True).click()
    expect(entry.get_by_role("button", name=re.compile("concluída|Finalizar rota"))).to_have_count(0)
    value.fill("8,00")
    entry.get_by_role("button", name="Iniciar entrega", exact=True).click()
    expect(value).to_have_value("")
    assert len(created) == 4 and created[-1]["status"] == "em_rota"
    assert created[-1]["started_at"] and created[-1]["lat"] is None and created[-1]["lng"] is None
    assert created[-1]["stops"] == [], "GPS denial does not fabricate a pickup or lose the start"
    for width, height in [(320, 740), (390, 844), (768, 1024), (1440, 1000)]:
        page.set_viewport_size({"width": width, "height": height})
        for mode in ["Rápido", "Completo"]:
            entry.get_by_role("button", name=mode, exact=True).click()
            expect(entry.get_by_role("button", name=mode, exact=True)).to_have_attribute("aria-pressed", "true")
            if entry.get_by_role("button", name="Inserir rota", exact=True).count():
                entry.get_by_role("button", name="Inserir rota", exact=True).click()
            if width == 320 and mode == "Rápido":
                entry.get_by_role("button", name="Adicionar ponto adicional", exact=True).click()

            expect(entry.get_by_role("button", name="Iniciar entrega", exact=True)).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"no horizontal overflow at {width}px in {mode}"
            if mode == "Rápido":
                page.evaluate("window.scrollTo(0, 0)")
                page.screenshot(path=f"/tmp/deliveries-clean-quick-{width}.png", full_page=False, animations="disabled")
        page.evaluate("window.scrollTo(0, 0)")
        page.screenshot(path=f"/tmp/deliveries-clean-{width}.png", full_page=False)
    page.set_viewport_size({"width": 390, "height": 844})
    page.screenshot(path=os.environ.get("DELIVERY_SCREENSHOT", "/tmp/delivery-fast-ui.png"), full_page=True)
    assert not failures, failures
    browser.close()
print("Mobile Chromium: date-filtered queries, 20-row history, app/fee chips, isolated typing, usual payment, automatic start GPS, readable streets, no duplicated dashboard queries, layouts 320/390/768/1440px, exact quick amounts without fees/tips, denied GPS fallback and online/offline starts passed.")
