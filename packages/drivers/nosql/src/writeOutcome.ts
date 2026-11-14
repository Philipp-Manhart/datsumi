/** Once a mutation was sent, a transport error is not evidence that nothing was written. */
export async function confirmedWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch {
    throw new Error(
      "Write outcome unknown: the server may have applied the change. Disconnect, reconnect and inspect the current document/key before reviewing another change. Do not retry blindly.",
    );
  }
}
