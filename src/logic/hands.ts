export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;

/**
 * 13×13表の (行, 列) → ハンド名。
 * 対角線がペア、右上がスーテッド、左下がオフスート。
 */
export function handAt(row: number, col: number): string {
  if (row === col) return RANKS[row] + RANKS[col];
  const hi = Math.min(row, col);
  const lo = Math.max(row, col);
  return RANKS[hi] + RANKS[lo] + (row < col ? 's' : 'o');
}

export const ALL_HANDS: string[] = RANKS.flatMap((_, r) => RANKS.map((__, c) => handAt(r, c)));

export const TOTAL_COMBOS = 1326;

/** ペア6通り、スーテッド4通り、オフスート12通り */
export function combosOf(hand: string): number {
  if (hand.length === 2) return 6;
  return hand.endsWith('s') ? 4 : 12;
}
