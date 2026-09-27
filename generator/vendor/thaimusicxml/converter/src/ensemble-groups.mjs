// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// Grouping <ensemble> parts into converter output units, shared by every
// export target. See reference/conversion's "Stacked instruments".

/**
 * Stacked rows merge into one output unit with one row per member, per
 * reference/conversion's "Stacked instruments" - a stack is one instrument
 * played by one performer, not several. `splitStacks` reverses that, giving
 * each row its own unit instead.
 */
export function groupParts(parts, splitStacks) {
  if (splitStacks) return parts.map((p) => ({ id: p.id, name: p.name, members: [p] }));
  const groups = [];
  const seenStacks = new Set();
  for (const p of parts) {
    if (!p.stack) {
      groups.push({ id: p.id, name: p.name, members: [p] });
      continue;
    }
    if (seenStacks.has(p.stack)) continue;
    seenStacks.add(p.stack);
    const members = parts.filter((q) => q.stack === p.stack).sort((a, b) => a.row - b.row);
    groups.push({ id: `stack-${p.stack}`, name: members[0].name, members });
  }
  return groups;
}
