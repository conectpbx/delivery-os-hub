import assert from "node:assert/strict";
import test from "node:test";
import { captureInstallPrompt, consumeInstallPrompt, getInstallPrompt } from "./pwa";

test("preserva convite de instalação até o usuário usá-lo e remove listeners", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  try {
    const stop = captureInstallPrompt();
    const event = new Event("beforeinstallprompt", { cancelable: true });
    target.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(getInstallPrompt(), event);
    assert.equal(consumeInstallPrompt(), event);
    assert.equal(consumeInstallPrompt(), null);
    target.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true }));
    target.dispatchEvent(new Event("appinstalled"));
    assert.equal(getInstallPrompt(), null);
    stop();
    target.dispatchEvent(new Event("beforeinstallprompt"));
    assert.equal(getInstallPrompt(), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
