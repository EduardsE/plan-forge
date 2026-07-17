import { beforeAll, describe, expect, it, vi } from "vitest";
import { MODEL_MANIFEST } from "#/lib/model/models";

// The listener under test is installed as a module-scope side effect (see
// the comment above it in model-body.tsx): it narrows and logs suppression
// of the drei preload warm-up's uncaught window error. Capture the actual
// callback registered via window.addEventListener("error", ...) so it can
// be invoked directly and synchronously — dispatching a real window "error"
// event through jsdom's event loop is asynchronous/deferred and not a
// reliable way to assert this logic.
let listener: (event: { message?: string; preventDefault: () => void }) => void;

beforeAll(async () => {
  const addSpy = vi.spyOn(window, "addEventListener");
  vi.resetModules();
  await import("#/components/model-body");
  const registered = addSpy.mock.calls.find(([type]) => type === "error");
  expect(registered).toBeDefined();
  listener = registered?.[1] as typeof listener;
  addSpy.mockRestore();
});

describe("model preload error suppressor", () => {
  it("warns and suppresses an uncaught error naming a known manifest file", () => {
    const [firstEntry] = Object.values(MODEL_MANIFEST);
    expect(firstEntry).toBeDefined();
    const message = `Could not load ${firstEntry.file}: Failed to fetch`;
    const preventDefault = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    listener({ message, preventDefault });

    expect(warn).toHaveBeenCalledWith(
      "Model preload failed (primitives fallback will render):",
      message,
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("leaves an uncaught error for an unrelated asset unsuppressed", () => {
    const preventDefault = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    listener({ message: "Could not load /foo/bar.glb: 404", preventDefault });

    expect(warn).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
