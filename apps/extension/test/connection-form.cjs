/* oxlint-disable typescript/unbound-method -- Preserve and restore native webview methods; invocation uses the original receiver. */
const vscode = require("vscode");
exports.addConnection = async (values) => {
  const original = vscode.window.createWebviewPanel;
  let failure;
  vscode.window.createWebviewPanel = (type, ...args) => {
    const panel = original(type, ...args);
    if (type === "datsumi.connection") {
      const receive = panel.webview.onDidReceiveMessage;
      panel.webview.onDidReceiveMessage = (callback, ...rest) => {
        const subscription = receive.call(panel.webview, callback, ...rest);
        queueMicrotask(() =>
          callback({
            type: "connection/submit",
            test: false,
            values: {
              driver: "sqlite",
              mode: "fields",
              name: "Native test",
              url: "",
              host: "localhost",
              port: "5432",
              database: "",
              username: "",
              password: "",
              credentialMode: "session",
              tls: true,
              ca: "",
              readOnly: false,
              path: "",
              create: false,
              ...values,
            },
          }),
        );
        return subscription;
      };
      const post = panel.webview.postMessage;
      panel.webview.postMessage = async (message) => {
        if (message.type === "connection/state" && message.error) {
          failure = message.error;
          panel.dispose();
        }
        return post.call(panel.webview, message);
      };
    }
    return panel;
  };
  try {
    const result = await vscode.commands.executeCommand("datsumi.addConnection");
    if (failure) throw new Error(failure);
    return result;
  } finally {
    vscode.window.createWebviewPanel = original;
  }
};
