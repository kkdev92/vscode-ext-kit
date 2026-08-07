/**
 * Line/offset arithmetic shared by the editor helpers, kept vscode-free so
 * the arithmetic itself is unit-testable. All indices are UTF-16 code units,
 * exactly like `TextDocument.offsetAt`/`positionAt`.
 */

/** A zero-based line/character pair, structurally a `vscode.Position`. */
export interface LineCharacter {
  readonly line: number;
  readonly character: number;
}

/**
 * Builds a table of the absolute offset where each line starts, in one pass
 * over the document text. Backs `resolvePositionsBatch` and
 * `resolveOffsetsBatch` so resolving many offsets/positions costs one
 * document scan instead of one internal lookup per item.
 *
 * Line breaks are `\r\n`, `\n`, and a lone `\r` — the same three VS Code's
 * own text buffer recognizes (`createLineStartsFast` in the piece tree).
 * Splitting on `\n` alone would agree with `TextDocument.positionAt` for LF
 * and CRLF documents but silently disagree on any document containing a bare
 * carriage return.
 */
export function buildLineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 13 /* '\r' */) {
      if (i + 1 < text.length && text.charCodeAt(i + 1) === 10 /* '\n' */) {
        i++; // \r\n is a single break
      }
      starts.push(i + 1);
    } else if (code === 10 /* '\n' */) {
      starts.push(i + 1);
    }
  }
  return starts;
}

/** Binary-searches `lineStarts` for the line containing `offset`. */
export function findLineForOffset(lineStarts: readonly number[], offset: number): number {
  // Callers build a non-empty table with buildLineStartOffsets. Keeping this
  // helper free of defensive allocation makes the hot batch-conversion path
  // stay allocation-free after the table exists.
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

/**
 * Converts an offset to a line/character pair against a prebuilt line table.
 * Out-of-range offsets are clamped to `[0, textLength]`, matching
 * `TextDocument.positionAt`'s own behavior.
 */
export function offsetToLineCharacter(
  lineStarts: readonly number[],
  textLength: number,
  rawOffset: number
): LineCharacter {
  const offset = Math.max(0, Math.min(rawOffset, textLength));
  const line = findLineForOffset(lineStarts, offset);
  return { line, character: offset - (lineStarts[line] ?? 0) };
}

/**
 * Converts a line/character pair to an offset against a prebuilt line table.
 * Out-of-range lines are clamped to the table's line range; characters are
 * taken as given and can therefore produce an offset past a line or document
 * boundary. Pass positions already validated for the document.
 */
export function lineCharacterToOffset(
  lineStarts: readonly number[],
  position: LineCharacter
): number {
  const maxLine = lineStarts.length - 1;
  const line = Math.max(0, Math.min(position.line, maxLine));
  return (lineStarts[line] ?? 0) + position.character;
}
