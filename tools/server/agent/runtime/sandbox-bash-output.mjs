// Bound tool output returned to Pi so a noisy search never floods the model
// context or the Pi RPC stream. The sandbox runtime still enforces its own
// 1 MiB process output limit independently.

export const maximumToolOutputBytes = 32 * 1024;

function utf8BytesForCodePoint(codePoint) {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function isHighSurrogate(codeUnit) {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit) {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function sliceUtf8Start(text, maximumBytes) {
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const codePoint = text.codePointAt(index);
    const step = codePoint > 0xffff ? 2 : 1;
    const characterBytes = utf8BytesForCodePoint(codePoint);
    if (bytes + characterBytes > maximumBytes) break;
    bytes += characterBytes;
    index += step;
  }
  return text.slice(0, index);
}

function sliceUtf8End(text, maximumBytes) {
  let bytes = 0;
  let index = text.length;
  while (index > 0) {
    const unit = text.charCodeAt(index - 1);
    const hasSurrogatePair =
      isLowSurrogate(unit) &&
      index >= 2 &&
      isHighSurrogate(text.charCodeAt(index - 2));
    const step = hasSurrogatePair ? 2 : 1;
    const codePoint = hasSurrogatePair ? text.codePointAt(index - 2) : unit;
    const characterBytes = utf8BytesForCodePoint(codePoint);
    if (bytes + characterBytes > maximumBytes) break;
    bytes += characterBytes;
    index -= step;
  }
  return text.slice(index);
}

function truncateToolOutput(output, maximumBytes) {
  if (Buffer.byteLength(output, "utf8") <= maximumBytes) {
    return { output, truncated: false };
  }
  const headBytes = Math.floor(maximumBytes / 2);
  const tailBytes = maximumBytes - headBytes;
  const head = sliceUtf8Start(output, headBytes);
  const tail = sliceUtf8End(output, tailBytes);
  return {
    output: `${head}\n[... output truncated ...]\n${tail}`,
    truncated: true,
  };
}

export function formatSandboxBashResult(
  result,
  maximumBytes = maximumToolOutputBytes,
) {
  // A stopped or truncated command must say why: an exit code alone does not
  // tell the model whether the deadline, process output budget or tool output
  // cap affected the result.
  const combined = `${result.stdout}\n${result.stderr}`;
  const { output, truncated } = truncateToolOutput(combined, maximumBytes);
  const notices = [];
  if (result.timedOut) {
    notices.push("The command reached its execution deadline and was stopped.");
  }
  if (result.outputLimitExceeded) {
    notices.push("The command exceeded the output limit and was stopped.");
  }
  if (truncated) {
    notices.push(
      "The tool output exceeded 32 KiB and was truncated. Narrow the command or inspect a specific file or range.",
    );
  }
  const notice = notices.length === 0 ? "" : `${notices.join("\n")}\n`;
  return {
    text: `${notice}exit code: ${result.exitCode}\n${output}`,
    details: {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      outputLimitExceeded: result.outputLimitExceeded,
      truncated,
    },
  };
}
