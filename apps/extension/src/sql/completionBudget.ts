interface Cancellation {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

/** Slow metadata must not block keyword/function suggestions or cancel the SQL session. */
export function completionBudget<T>(
  pending: Promise<T>,
  fallback: T,
  token: Cancellation,
  milliseconds = 600,
): Promise<{ value: T; incomplete: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    let listener: { dispose(): void } | undefined;
    const finish = (value: T, incomplete: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      listener?.dispose();
      resolve({ value, incomplete });
    };
    const timer = setTimeout(() => finish(fallback, true), milliseconds);
    listener = token.onCancellationRequested(() => finish(fallback, true));
    if (token.isCancellationRequested) finish(fallback, true);
    void pending.then(
      (value) => finish(value, false),
      () => finish(fallback, false),
    );
  });
}
