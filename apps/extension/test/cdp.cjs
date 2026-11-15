const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.delay = delay;
exports.connect = async (port) => {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const pending = new Map();
  const contexts = new Map();
  let sequence = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.executionContextCreated") {
      const list = contexts.get(message.sessionId) || [];
      list.push(message.params.context);
      contexts.set(message.sessionId, list);
    }
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error.message));
    else call.resolve(message.result);
  };
  const call = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId
            ? { sessionId: typeof sessionId === "object" ? sessionId.session : sessionId }
            : {}),
        }),
      );
    });
  const evaluate = async (session, expression) => {
    const result = await call(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
        ...(typeof session === "object" ? { contextId: session.contextId } : {}),
      },
      session,
    );
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description || result.exceptionDetails.text,
      );
    return result.result?.value;
  };
  const attached = new Map();
  const find = async (expression) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const { targetInfos } = await call("Target.getTargets");
      for (const target of targetInfos.filter((target) =>
        ["page", "iframe", "webview"].includes(target.type),
      )) {
        try {
          if (!attached.has(target.targetId))
            attached.set(
              target.targetId,
              (await call("Target.attachToTarget", { targetId: target.targetId, flatten: true }))
                .sessionId,
            );
          const session = attached.get(target.targetId);
          await call("Runtime.enable", {}, session);
          // Desktop window activation is external to CDP. Keep the isolated page
          // focused while exercising real DOM keys in headless/X11 sessions.
          if (target.type === "page")
            await call("Emulation.setFocusEmulationEnabled", { enabled: true }, session);
          for (const context of contexts.get(session) || []) {
            const reference = { session, contextId: context.id, frameId: context.auxData?.frameId };
            if (await evaluate(reference, expression)) return reference;
          }
        } catch {
          /* Targets may disappear while a webview resolves. */
        }
      }
      await delay(100);
    }
    throw new Error(
      `Rendered webview was not found: ${expression}; targets=${JSON.stringify((await call("Target.getTargets")).targetInfos.map((t) => ({ type: t.type, url: t.url })))}, contexts=${JSON.stringify([...contexts].map(([s, c]) => ({ session: s, contexts: c.map((x) => ({ id: x.id, origin: x.origin, frame: x.auxData?.frameId })) })))}`,
    );
  };
  const press = async (session, key, code, keyCode, modifiers = 0) => {
    const held = [];
    let flags = 0;
    for (const [bit, name, scan, vk] of [
      [2, "Control", "ControlLeft", 17],
      [4, "Meta", "MetaLeft", 91],
      [8, "Shift", "ShiftLeft", 16],
    ]) {
      if (!(modifiers & bit)) continue;
      flags |= bit;
      held.push([bit, name, scan, vk]);
      await call(
        "Input.dispatchKeyEvent",
        {
          type: "rawKeyDown",
          key: name,
          code: scan,
          windowsVirtualKeyCode: vk,
          modifiers: flags,
          location: 1,
        },
        session,
      );
    }
    await call(
      "Input.dispatchKeyEvent",
      { type: "rawKeyDown", key, code, windowsVirtualKeyCode: keyCode, modifiers: flags },
      session,
    );
    await call(
      "Input.dispatchKeyEvent",
      { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, modifiers: flags },
      session,
    );
    for (const [bit, name, scan, vk] of held.reverse()) {
      flags &= ~bit;
      await call(
        "Input.dispatchKeyEvent",
        {
          type: "keyUp",
          key: name,
          code: scan,
          windowsVirtualKeyCode: vk,
          modifiers: flags,
          location: 1,
        },
        session,
      );
    }
    await delay(100);
  };
  return { call, evaluate, find, press, close: () => socket.close() };
};
