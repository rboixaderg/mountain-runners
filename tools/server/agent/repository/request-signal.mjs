// Bound a remote read with a deadline while still honouring the stop signal of
// the service. A read that never answers must not stall the caller.

// A GitHub read that never returns would stall the notification cycle or the
// instruction loop behind it.
export const defaultRequestTimeoutMilliseconds = 30 * 1000;

export function requestSignal(
  signal,
  milliseconds = defaultRequestTimeoutMilliseconds,
) {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Wait, resolving early when the service is asked to stop. */
export function sleep(milliseconds, signal) {
  return new Promise((resolve) => {
    let timer;
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
    if (signal?.aborted) {
      resolve();
      return;
    }
    timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", finish, { once: true });
    // The signal may have aborted between the check and the listener.
    if (signal?.aborted) finish();
  });
}
