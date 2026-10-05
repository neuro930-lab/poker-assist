export const ALL_POSITIONS = ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;
export type Position = (typeof ALL_POSITIONS)[number];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 9;

/**
 * 人数ごとのポジション（プリフロップの行動順）。
 * 9人の並びから前の席が消えていく。2人のときは BTN が SB を兼ね、先に行動する。
 */
export function positionsFor(players: number): Position[] {
  if (players === 2) return ['BTN', 'BB'];
  return ALL_POSITIONS.slice(MAX_PLAYERS - players) as Position[];
}

/**
 * 座席番号（時計回りに 0..players-1）→ ポジション。
 * BTN の次の席が SB、その次が BB（2人のときは BTN の次が BB）。
 */
export function positionOfSeat(seat: number, btnSeat: number, players: number): Position {
  const order = positionsFor(players);
  const btnIndex = order.indexOf('BTN');
  const offset = (seat - btnSeat + players) % players;
  return order[(btnIndex + offset) % players];
}

/** プリフロップで何番目に行動するか（0 = 最初） */
export function actionIndex(seat: number, btnSeat: number, players: number): number {
  return positionsFor(players).indexOf(positionOfSeat(seat, btnSeat, players));
}

/** 「次のハンド」：BTN を時計回りに1席進める */
export function nextButton(btnSeat: number, players: number): number {
  return (btnSeat + 1) % players;
}

/** 画面表示名。設定により、6人以下のとき先頭の席を「UTG」と呼ぶ */
export function displayName(pos: Position, players: number, labelFirstSeatAsUtg: boolean): string {
  if (pos === 'BTN' && players === 2) return 'BTN/SB';
  if (labelFirstSeatAsUtg && players <= 6 && players >= 4 && positionsFor(players)[0] === pos) {
    return 'UTG';
  }
  return pos;
}
