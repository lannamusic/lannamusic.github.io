// Copyright 2026 Nopparuj Ananvoranich
// SPDX-License-Identifier: Apache-2.0

// Exact rational arithmetic for slot timing. A <group> divides one slot into
// k equal parts, and k is not bounded by the schema, so onsets and durations
// need exact fractions rather than floats to stay comparable across measures.

export function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export const lcm = (a, b) => Math.abs(a * b) / gcd(a, b);

export function frac(n, d = 1) {
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export const ZERO = frac(0);
export const ONE = frac(1);

export const add = (a, b) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const subtract = (a, b) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a, b) => frac(a.n * b.n, a.d * b.d);
export const isZero = (a) => a.n === 0;
export const toNumber = (a) => a.n / a.d;
export const compare = (a, b) => a.n * b.d - b.n * a.d;
