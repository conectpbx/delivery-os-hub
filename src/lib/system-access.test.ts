import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryObserver, focusManager, onlineManager } from "@tanstack/react-query";
import type { SystemAccess } from "./admin";
import {
  MODULE_ROUTES,
  SYSTEM_ACCESS_KEY,
  moduleIsDisabled,
  visibleModules,
  systemAccessOptions,
  updateModuleAccess,
} from "./system-access";

function access(role: SystemAccess["role"] = "user"): SystemAccess {
  return {
    role,
    maintenanceMode: false,
    modules: Object.fromEntries(MODULE_ROUTES.map(({ module }) => [module, true])),
  };
}
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

test("global module disable affects navigation and direct URLs for all roles", () => {
  for (const role of ["user", "admin", "super_admin"] as const) {
    for (const route of MODULE_ROUTES) {
      const state = access(role);
      state.modules[route.module] = false;
      assert.ok(!visibleModules(state).some(({ module }) => module === route.module));
      assert.equal(moduleIsDisabled(route.to, state), true);
      assert.equal(moduleIsDisabled(`${route.to}/`, state), true);
      assert.equal(moduleIsDisabled(`${route.to}/detalhes`, state), true);
      assert.equal(moduleIsDisabled("/admin", state), false);
    }
  }
});

test("unknown access does not expose modules while permissions load", () => {
  assert.deepEqual(visibleModules(undefined), []);
  assert.equal(moduleIsDisabled("/entregas", undefined), true);
  assert.equal(moduleIsDisabled("/financeiro-extra", access()), false);
});

test("disabling and re-enabling a module updates an open session without reloading", async () => {
  const qc = client();
  let server = access("super_admin");
  qc.setQueryData(SYSTEM_ACCESS_KEY, server);
  const observer = new QueryObserver(
    qc,
    systemAccessOptions(async () => server),
  );
  const blocked: boolean[] = [];
  const unsubscribe = observer.subscribe(({ data }) =>
    blocked.push(moduleIsDisabled("/scanner", data)),
  );
  try {
    await observer.refetch();
    await updateModuleAccess(qc, "scanner", false, async () => {
      server = { ...server, modules: { ...server.modules, scanner: false } };
    });
    assert.equal(observer.getCurrentResult().data?.modules["scanner"], false);
    assert.ok(blocked.includes(true));
    assert.equal(
      visibleModules(observer.getCurrentResult().data).some(({ module }) => module === "scanner"),
      false,
    );
    await updateModuleAccess(qc, "scanner", true, async () => {
      server = { ...server, modules: { ...server.modules, scanner: true } };
    });
    assert.equal(moduleIsDisabled("/scanner", observer.getCurrentResult().data), false);
  } finally {
    unsubscribe();
    qc.clear();
  }
});

test("failed admin save leaves the existing module configuration unchanged", async () => {
  const qc = client();
  qc.setQueryData(SYSTEM_ACCESS_KEY, access());
  await assert.rejects(
    updateModuleAccess(qc, "finance", false, async () => {
      throw new Error("denied");
    }),
    /denied/,
  );
  assert.equal(qc.getQueryData<SystemAccess>(SYSTEM_ACCESS_KEY)?.modules["finance"], true);
  qc.clear();
});

test("an old in-flight response cannot undo a successful module update", async () => {
  const qc = client();
  const old = access();
  qc.setQueryData(SYSTEM_ACCESS_KEY, old);
  let release!: (value: SystemAccess) => void;
  let server = old;
  let calls = 0;
  const observer = new QueryObserver(
    qc,
    systemAccessOptions(() => {
      calls++;
      return calls === 1
        ? new Promise<SystemAccess>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(server);
    }),
  );
  const unsubscribe = observer.subscribe(() => {});
  try {
    await updateModuleAccess(qc, "finance", false, async () => {
      server = { ...old, modules: { ...old.modules, finance: false } };
    });
    release(old);
    await Promise.resolve();
    assert.equal(qc.getQueryData<SystemAccess>(SYSTEM_ACCESS_KEY)?.modules["finance"], false);
  } finally {
    unsubscribe();
    qc.clear();
  }
});

test("a second PWA session refreshes changed settings when returning to foreground", async () => {
  const qc = client();
  let server = access();
  const observer = new QueryObserver(
    qc,
    systemAccessOptions(async () => server),
  );
  qc.mount();
  focusManager.setFocused(false);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await observer.refetch();
    assert.equal(moduleIsDisabled("/metas", observer.getCurrentResult().data), false);
    server = { ...server, modules: { ...server.modules, goals: false } };
    focusManager.setFocused(true);
    // Aguarda a consulta disparada pelo evento de foco, sem refetch manual.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        stop();
        reject(new Error("foreground settings did not refresh"));
      }, 1000);
      const stop = observer.subscribe(({ data }) => {
        if (data?.modules["goals"] === false) {
          clearTimeout(timer);
          stop();
          resolve();
        }
      });
    });
    assert.equal(moduleIsDisabled("/metas", observer.getCurrentResult().data), true);
  } finally {
    unsubscribe();
    qc.unmount();
    qc.clear();
    focusManager.setFocused(undefined);
  }
});

test("a restored PWA cache is refreshed even if it was saved just now", async () => {
  const qc = client();
  const cached = access();
  qc.setQueryData(SYSTEM_ACCESS_KEY, cached);
  const server = { ...cached, modules: { ...cached.modules, reports: false } };
  const observer = new QueryObserver(
    qc,
    systemAccessOptions(async () => server),
  );
  const unsubscribe = observer.subscribe(() => {});
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        stop();
        reject(new Error("restored access did not refresh on mount"));
      }, 1000);
      const stop = observer.subscribe(({ data }) => {
        if (data?.modules["reports"] === false) {
          clearTimeout(timer);
          stop();
          resolve();
        }
      });
    });
    assert.equal(moduleIsDisabled("/relatorios", observer.getCurrentResult().data), true);
  } finally {
    unsubscribe();
    qc.clear();
  }
});

test("disabling all modules keeps the administration route independent", () => {
  const state = access("super_admin");
  state.modules = Object.fromEntries(MODULE_ROUTES.map(({ module }) => [module, false]));
  assert.deepEqual(visibleModules(state), []);
  assert.equal(moduleIsDisabled("/admin", state), false);
  assert.equal(moduleIsDisabled("/dashboard", state), true);
});

test("an online PWA picks up changes made while it was disconnected", async () => {
  const qc = client();
  let server = access();
  const observer = new QueryObserver(
    qc,
    systemAccessOptions(async () => server),
  );
  qc.mount();
  const unsubscribe = observer.subscribe(() => {});
  try {
    await observer.refetch();
    onlineManager.setOnline(false);
    server = { ...server, modules: { ...server.modules, deliveries: false } };
    const refreshed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        stop();
        reject(new Error("reconnect settings did not refresh"));
      }, 1000);
      const stop = observer.subscribe(({ data }) => {
        if (data?.modules["deliveries"] === false) {
          clearTimeout(timer);
          stop();
          resolve();
        }
      });
    });
    onlineManager.setOnline(true);
    await refreshed;
    assert.equal(moduleIsDisabled("/entregas", observer.getCurrentResult().data), true);
  } finally {
    unsubscribe();
    qc.unmount();
    qc.clear();
    onlineManager.setOnline(true);
  }
});
