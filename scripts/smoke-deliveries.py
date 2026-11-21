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
if os.environ.get("SMOKE_CHAIN_METRICS"):
    rows[0]["lat"], rows[0]["lng"] = -23.55, -46.63
    rows[0]["stops"] = [
        {"kind": "coleta", "address": "Rua A", "lat": -23.55, "lng": -46.63, "recorded_at": rows[0]["occurred_at"]},
        {"kind": "entrega", "address": "Rua B", "lat": -23.56, "lng": -46.64, "recorded_at": rows[1]["occurred_at"]},
    ]

requests = []
created = []
updated = []
maintenance_created = []
maintenance_failure = True
if os.environ.get("SMOKE_DASHBOARD_CARDS"):
    for index, record in enumerate(rows[:45]):
        record["status"] = "concluida"
        record["occurred_at"] = iso(now - timedelta(hours=4, minutes=index))
    maintenance_created.append({"id": "maintenance-cost", "user_id": USER_ID, "service_type": "Óleo", "cost": 20, "odometer": 10000, "next_due_km": 12000, "performed_at": now.strftime("%Y-%m-%d"), "next_due_date": None, "description": None})


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
    elif path.endswith("/active_work_journeys") and os.environ.get("SMOKE_DASHBOARD_CARDS"):
        result = [{"state": {"active": True, "synced": True, "journeyId": "remote-journey", "source": "external", "startedAt": iso(now - timedelta(hours=2)), "endedAt": None, "distanceKm": 10, "points": 10, "last": None, "updatedAt": iso(now), "pauses": [{"id": "pause", "reason": "Almoço", "started_at": iso(now - timedelta(hours=1)), "ended_at": iso(now - timedelta(minutes=50))}]}}]
    elif path.endswith("/fuelings") and os.environ.get("SMOKE_DASHBOARD_CARDS"):
        if os.environ.get("SMOKE_COSTS_ERROR"):
            return route.fulfill(status=503, content_type="application/json", headers=headers, body=json.dumps({"message": "fixture cost failure"}))
        result = [{"id": "fuel-cost", "user_id": USER_ID, "liters": 15, "price_per_liter": 6.75, "total": 101.25, "occurred_at": iso(now), "odometer": 10000, "station": "Posto teste"}]
    elif path.endswith("/expenses") and os.environ.get("SMOKE_DASHBOARD_CARDS"):
        result = [{"id": "expense-cost", "user_id": USER_ID, "category": "Alimentação", "amount": 30.5, "occurred_at": iso(now), "description": "Despesa teste", "allocation_method": "immediate"}]
    elif path.endswith("/work_journeys") and os.environ.get("SMOKE_FINANCE_PERFORMANCE"):
        result = [{"id": f"journey-{index}", "user_id": USER_ID, "started_at": iso(now - timedelta(minutes=index + 2)), "ended_at": iso(now - timedelta(minutes=index + 1)), "distance_km": 1, "pauses": []} for index in range(25)]
    elif path.endswith("/gps_route_sessions") and os.environ.get("SMOKE_FINANCE_PERFORMANCE"):
        result = [{"id": "route-test", "user_id": USER_ID, "started_at": iso(now - timedelta(hours=1)), "ended_at": iso(now), "distance_km": 2, "point_count": 2}]
    elif path.endswith("/gps_route_points") and os.environ.get("SMOKE_FINANCE_PERFORMANCE"):
        result = [{"point_id": str(index), "route_id": "route-test", "latitude": -23.55 - index * .001, "longitude": -46.63, "accuracy_m": 5, "speed_kmh": 0, "trip_km": index, "total_km": index, "captured_at": iso(now - timedelta(minutes=1-index))} for index in range(2)]
    elif path.endswith("/profiles"):
        result = [{"id": USER_ID, "full_name": "Fixture", "vehicle": "moto", "fuel_efficiency": 12, "daily_goal": 200, "monthly_goal": 5000}]
    elif path.endswith("/app_challenges") and os.environ.get("SMOKE_GOALS_LAYOUT"):
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        base = {"user_id": USER_ID, "app_name": "iFood", "metric": "deliveries", "target": 99999, "reward": 50, "auto_receive": False, "starts_at": iso(start), "ends_at": iso(start + timedelta(days=1)), "received_at": None}
        result = [{**base, "id": "challenge-active", "title": "Desafio em andamento"}, {**base, "id": "challenge-won", "title": "Desafio conquistado", "target": 1}, {**base, "id": "challenge-expired", "title": "Desafio vencido", "starts_at": iso(start - timedelta(days=2)), "ends_at": iso(start - timedelta(days=1))}, {**base, "id": "challenge-paid", "title": "Desafio recebido", "received_at": iso(now)}]
    elif path.endswith("/goals") and os.environ.get("SMOKE_GOALS_LAYOUT"):
        current_month = now.strftime("%Y-%m") + "-01"
        previous_month = (now.replace(day=1) - timedelta(days=1)).strftime("%Y-%m") + "-01"
        result = [{"id": "goal-current", "user_id": USER_ID, "month": current_month, "revenue_target": 2000, "profit_target": 1200, "deliveries_target": 100}, {"id": "goal-previous", "user_id": USER_ID, "month": previous_month, "revenue_target": 1800, "profit_target": 1000, "deliveries_target": 90}]
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
    if os.environ.get("SMOKE_INITIAL_MODE") == "full":
        context.add_init_script("localStorage.setItem(" + json.dumps("delivery-os-draft:" + USER_ID + ":entregas.entry-mode") + ", '\"full\"');")
    page = context.new_page()
    failures = []
    page.on("pageerror", lambda error: failures.append(str(error)))
    if os.environ.get("SMOKE_MODULES_ONLY"):
        for route_name in os.environ.get("SMOKE_MODULE_NAMES", "dashboard,entregas,financeiro,manutencao,metas,scanner,relatorios").split(","):
            page.goto(BASE + "/" + route_name, wait_until="domcontentloaded", timeout=30000)
            expect(page.locator("main")).to_be_visible(timeout=20000)
            expect(page.get_by_text("This page didn't load", exact=True)).to_have_count(0)
            if route_name == "financeiro" and os.environ.get("SMOKE_FINANCE_PERFORMANCE"):
                history = page.locator("section").filter(has=page.get_by_role("heading", name="Histórico de jornadas", exact=True))
                expect(history.locator("li")).to_have_count(20)
                history.get_by_role("button", name="Carregar mais jornadas", exact=True).click()
                expect(history.locator("li")).to_have_count(25)
                assert not any(path.endswith(("/gps_route_sessions", "/gps_route_points")) for method,path,query in requests), "GPS history must not load before expansion"
                page.get_by_label("Litros", exact=True).fill("12,5")
                page.locator("summary").filter(has_text="Rotas registradas pelo aplicativo").click()
                expect(page.get_by_text("Finalizada", exact=True)).to_be_visible()
                expect(page.locator(".leaflet-container")).to_be_visible()
                initial_points_requests = sum(path.endswith("/gps_route_points") for method,path,query in requests)
                assert initial_points_requests == 1
                page.wait_for_timeout(11000)
                assert sum(path.endswith("/gps_route_points") for method,path,query in requests) == initial_points_requests, "finished GPS routes must not poll"
                page.locator("summary").filter(has_text="Rotas registradas pelo aplicativo").click()
                expect(page.locator(".leaflet-container")).to_have_count(0)
                expect(page.get_by_label("Litros", exact=True)).to_have_value("12,5")
                print("Financeiro: deferred GPS queries, completed-route polling disabled, history pagination and form preservation passed", flush=True)
            if route_name == "dashboard" and os.environ.get("SMOKE_DASHBOARD_CARDS"):
                cost_card = page.get_by_text("Custos registrados", exact=True).first.locator("..").locator("..")
                expect(cost_card.get_by_text("Indisponível" if os.environ.get("SMOKE_COSTS_ERROR") else re.compile(r"R\$\s*151,75"), exact=True)).to_be_visible(timeout=20000)
                time_card = page.get_by_text("Tempo fora das entregas", exact=True).first.locator("..").locator("..")
                expect(time_card.get_by_text("1h 50min", exact=True)).to_be_visible(timeout=20000)
                if os.environ.get("SMOKE_COSTS_ERROR"):
                    expect(page.get_by_role("button", name="Atualizar dados", exact=True)).to_be_visible()
                assert any(path.endswith("/active_work_journeys") for method,path,query in requests), "reads the active journey without requiring a local tracker"
                assert all("or" in query or "occurred_at" in query or query.get("limit") == ["20"] for method,path,query in requests if path.endswith("/deliveries") and method == "GET"), "dashboard uses bounded delivery queries"
            if route_name == "dashboard" and os.environ.get("SMOKE_CHAIN_METRICS"):
                km_card = page.get_by_text("Quilometragem", exact=True).first.locator("..").locator("..")
                expect(km_card.get_by_text("45,0 km", exact=True)).to_be_visible()
                expect(km_card.get_by_text(re.compile("18,00.*por km registrado"))).to_be_visible()
                expect(km_card.get_by_text(re.compile("Pontos encadeados:.*aproximação, parcial"))).to_be_visible(timeout=20000)

            if route_name == "metas" and os.environ.get("SMOKE_GOALS_LAYOUT"):
                expect(page.get_by_role("tab", name="Resumo", exact=True)).to_have_attribute("aria-selected", "true")
                expect(page.get_by_label("Meta de receita (R$)", exact=True)).to_be_hidden()
                goal_filters = page.get_by_role("group", name="Visibilidade das metas", exact=True)
                expect(goal_filters.get_by_role("button", name="Ativas (1)", exact=True)).to_have_attribute("aria-pressed", "true")
                goal_filters.get_by_role("button", name="Finalizadas (1)", exact=True).click()
                expect(page.get_by_text("Encerrada", exact=True)).to_be_visible()
                goal_filters.get_by_role("button", name="Ativas (1)", exact=True).click()
                expect(page.get_by_text("Encerrada", exact=True)).to_have_count(0)

                page.get_by_role("tab", name="Planejamento", exact=True).click()
                expect(page.get_by_label("Meta de receita (R$)", exact=True)).to_be_visible()
                page.get_by_label("Meta de receita (R$)", exact=True).fill("3.500")
                page.get_by_role("tab", name="Resumo", exact=True).click()
                page.get_by_role("tab", name="Planejamento", exact=True).click()
                expect(page.get_by_label("Meta de receita (R$)", exact=True)).to_have_value("3.500")
                page.get_by_role("tab", name="Desafios", exact=True).click()
                expect(page.get_by_role("heading", name="Desafios e bonificações por aplicativo", exact=True)).to_be_visible()
                expect(page.get_by_role("heading", name="Desafio em andamento", exact=True)).to_be_visible()
                expect(page.get_by_role("heading", name="Desafio conquistado", exact=True)).to_have_count(0)
                page.get_by_role("button", name="Ver bonificações pendentes", exact=True).click()
                expect(page.get_by_role("heading", name="Desafio conquistado", exact=True)).to_be_visible()
                expect(page.get_by_role("heading", name="Desafio vencido", exact=True)).to_be_visible()
                expect(page.get_by_role("button", name="Estornar recebimento", exact=True)).to_be_visible()
                expect(page.get_by_role("button", name="Confirmar recebimento", exact=True)).to_be_visible()

                page.get_by_role("tab", name="Resumo", exact=True).click()
                page.get_by_role("button", name="Editar", exact=True).first.click()
                expect(page.get_by_role("tab", name="Planejamento", exact=True)).to_have_attribute("aria-selected", "true")
                expect(page.get_by_label("Meta de receita (R$)", exact=True)).to_be_focused()
                for width in [320, 390, 768, 1440]:
                    page.set_viewport_size({"width": width, "height": 900})
                    for tab in ["Resumo", "Planejamento", "Desafios"]:
                        page.get_by_role("tab", name=tab, exact=True).click()
                        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Metas/{tab}: overflow at {width}px"
                        expect(page.get_by_role("tab", name=tab, exact=True)).to_have_attribute("aria-selected", "true")
                        page.screenshot(path=f"/tmp/goals-{tab}-{width}.png", full_page=False, animations="disabled")
                assert not any(method in ("PATCH", "DELETE") and path.endswith("/app_challenges") for method, path, query in requests), "filtering never changes bonuses"
                assert not any(method in ("POST", "PATCH", "DELETE") and path.endswith("/goals") for method, path, query in requests), "layout navigation never saves or deletes a goal"
                page.get_by_role("tab", name="Resumo", exact=True).click()
                page.get_by_role("tab", name="Resumo", exact=True).focus()
                page.keyboard.press("ArrowRight")
                expect(page.get_by_role("tab", name="Planejamento", exact=True)).to_have_attribute("aria-selected", "true")
                page.get_by_role("tab", name="Resumo", exact=True).click()
                print("Goals: tabs, draft preservation, edit focus, keyboard navigation and responsive layouts passed", flush=True)
            for width in [320, 768, 1440]:
                page.set_viewport_size({"width": width, "height": 900})
                page.wait_for_timeout(100)
                if page.evaluate("document.documentElement.scrollWidth > innerWidth"):
                    print("Overflow:", page.evaluate("Array.from(document.querySelectorAll('main *')).filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1; }).slice(0,15).map(el => ({tag:el.tagName, cls:el.className, text:el.textContent.slice(0,60), right:el.getBoundingClientRect().right}))"), flush=True)
                    page.screenshot(path=f"/tmp/review-overflow-{route_name}-{width}.png")
                    raise AssertionError(f"{route_name}: horizontal overflow at {width}px")
            page.screenshot(path=f"/tmp/review-{route_name}.png", full_page=False)
            print(f"Module {route_name}: opened, layouts 320/768/1440 passed", flush=True)
        if os.environ.get("SMOKE_DASHBOARD_CARDS"):
            assert not failures, failures
            browser.close()
            print("Dashboard cards: registered costs, remote journey unassigned time, responsive layout and bounded queries passed.")
            raise SystemExit(0)
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
    assert updated[-1]["distance_km"] == 1, "manual completion preserves previously recorded km"
    assert [stop["address"] for stop in updated[-1]["stops"]] == ["Parada intermediária em rota", "Destino final em rota"]
    entry = page.locator("section").filter(has=page.get_by_role("heading", name="Nova entrega", exact=True))
    expect(entry.get_by_role("button", name="Definir ponto inicial", exact=True)).to_have_count(0)
    expect(entry.get_by_role("button", name="Definir ponto final", exact=True)).to_have_count(0)
    expect(entry.get_by_role("button", name=re.compile("concluída|Finalizar rota"))).to_have_count(0)
    if os.environ.get("SMOKE_INITIAL_MODE") == "full":
        expect(entry.get_by_role("button", name="Completo", exact=True)).to_have_attribute("aria-pressed", "true")
    entry.get_by_role("button", name="Rápido", exact=True).click()
    entry.get_by_role("button", name="iFood", exact=True).click()
    entry.get_by_role("button", name="Completo", exact=True).click()
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
    entry.get_by_role("button", name="Editar rota", exact=True).click()
    expect(entry.get_by_label("Endereço do ponto final", exact=True)).to_have_value("Rua Destino, 100")
    entry.get_by_role("button", name="Ocultar", exact=True).click()
    entry.locator("#payment-method").select_option("pix")
    entry.get_by_label("Gratificação do cliente (R$)", exact=True).fill("7,00")
    entry.get_by_role("button", name="Rápido", exact=True).click()
    expect(entry.get_by_text(re.compile(r"Recebimento: Pix"))).to_be_visible()
    entry.get_by_role("button", name="Iniciar entrega", exact=True).click()
    expect(value).to_have_value("", timeout=20000)
    assert len(created) == 1
    assert created[0]["gross_earnings"] == 20 and created[0]["earnings"] == 20 and created[0]["fee_percent"] == 0 and created[0]["tip"] == 0
    assert created[0]["payment_method"] == "pix" and created[0]["status"] == "em_rota"
    assert len(created[0]["stops"]) == 1, "quick mode ignores hidden complete-mode stops"
    assert created[0]["pickup_address"] == "Rua GPS do teste, 42, São Paulo"
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
    entry.get_by_role("button", name="Completo", exact=True).click()
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
    page.evaluate("() => { window.fixtureOriginalGeo = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation); navigator.geolocation.getCurrentPosition = (_success, error) => error({code: 1, message: 'fixture: permission denied'}); }")
    entry.get_by_role("button", name="Completo", exact=True).click()
    expect(entry.get_by_role("button", name=re.compile("concluída|Finalizar rota"))).to_have_count(0)
    value.fill("8,00")
    entry.get_by_role("button", name="Iniciar entrega", exact=True).click()
    expect(value).to_have_value("")
    assert len(created) == 4 and created[-1]["status"] == "em_rota"
    assert created[-1]["started_at"] and created[-1]["lat"] is None and created[-1]["lng"] is None
    assert created[-1]["stops"] == [], "GPS denial does not fabricate a pickup or lose the start"
    page.evaluate("() => { navigator.geolocation.getCurrentPosition = window.fixtureOriginalGeo; }")
    context.set_geolocation({"latitude": -23.57, "longitude": -46.65})
    gps_card = page.locator('[data-delivery-id="' + created[1]["id"] + '"]')
    gps_card.get_by_role("button", name="Entrega concluída (GPS)", exact=True).click()
    expect(gps_card.get_by_role("button", name="Entrega concluída (GPS)", exact=True)).to_have_count(0, timeout=20000)
    assert len(created) == 4 and updated[-1]["id"] == created[1]["id"]
    assert updated[-1]["distance_km"] > 0, "GPS completion fills zero distance from the full route"
    assert updated[-1]["status"] == "concluida"
    for width, height in [(320, 740), (390, 844), (768, 1024), (1440, 1000)]:
        page.set_viewport_size({"width": width, "height": height})
        for mode in ["Rápido", "Completo"]:
            entry.get_by_role("button", name=mode, exact=True).click()
            expect(entry.get_by_role("button", name=mode, exact=True)).to_have_attribute("aria-pressed", "true")
            if mode == "Rápido":
                expect(entry.get_by_label("Taxa do app (%)", exact=True)).to_have_count(0)
                expect(entry.get_by_label("Gratificação do cliente (R$)", exact=True)).to_have_count(0)
                expect(entry.get_by_label("Endereço do ponto final", exact=True)).to_have_count(0)
                expect(entry.get_by_text("GPS e ajustes da entrega", exact=True)).to_have_count(0)
                expect(entry.locator("form")).to_have_count(1)

            if entry.get_by_role("button", name="Inserir rota", exact=True).count():
                entry.get_by_role("button", name="Inserir rota", exact=True).click()
            if width == 320 and mode == "Completo":
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
    entry.get_by_role("button", name="Completo", exact=True).click()
    page.wait_for_timeout(400)
    entry.get_by_role("button", name="Rápido", exact=True).click()
    page.get_by_role("link", name="Financeiro", exact=True).click()
    expect(page.get_by_role("heading", name="Financeiro", exact=True)).to_be_visible()
    assert page.evaluate("JSON.parse(localStorage.getItem(" + json.dumps("delivery-os-draft:" + USER_ID + ":entregas.entry-mode") + "))") == "quick"
    page.get_by_role("link", name="Entregas", exact=True).click()
    expect(page.get_by_role("button", name="Rápido", exact=True)).to_have_attribute("aria-pressed", "true")
    expect(page.get_by_label("Taxa do app (%)", exact=True)).to_have_count(0)
    assert not failures, failures
    browser.close()
print("Mobile Chromium: date-filtered queries, 20-row history, app/fee chips, isolated typing, usual payment, automatic start GPS, readable streets, no duplicated dashboard queries, layouts 320/390/768/1440px, exact quick amounts, isolated entry modes, persisted mode after navigation, denied GPS fallback and online/offline starts passed.")
