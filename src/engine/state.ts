import type { Position } from '../logic/positions';
import type { Format } from '../logic/yokosawa';

export type PreflopScenario = 'unopened' | 'limped' | 'raised' | '3bet' | '4bet';
export type OpponentRole = 'unknown' | 'opener' | 'caller' | '3bettor' | '4bettor' | 'limper' | 'blind';
export type StreetAction = 'none' | 'check' | 'bet' | 'raise';

export interface Opponent {
  position: Position;
  /** 残りスタック（不明なら null） */
  stack: number | null;
  /** プリフロップでの役割（レンジ推定に使う） */
  role: OpponentRole;
}

/** 画面解析または手入力で作る「今の状況」 */
export interface GameState {
  format: Format;
  /** 卓に座っている人数（ポジション計算用） */
  players: number;
  heroPosition: Position | null;
  /** "As" などの文字列（0〜2枚） */
  heroCards: string[];
  /** 0・3・4・5枚 */
  board: string[];
  /** 1BBのチップ量。金額をBB単位で入れるなら 1 */
  bigBlind: number;
  /** 今のポット（このストリートで出ているベットも含む） */
  pot: number;
  /** 自分がコールに必要な額（0 ならチェック可能） */
  toCall: number;
  /** 自分の残りスタック */
  heroStack: number;
  preflop: PreflopScenario;
  /** プリフロップ最後のレイズ（ベット）をしたのが自分か */
  heroIsAggressor: boolean;
  /** まだハンドに残っている相手 */
  opponents: Opponent[];
  /** このストリートで相手がしたこと（一番強いもの） */
  villainAction: StreetAction;
  /** それより前のストリートで相手がベット・レイズした回数（レンジを絞る） */
  villainBetsEarlier: number;
}

export function emptyState(format: Format = 'ring'): GameState {
  return {
    format,
    players: format === 'tournament' ? 9 : 6,
    heroPosition: null,
    heroCards: [],
    board: [],
    bigBlind: 1,
    pot: 1.5,
    toCall: 1,
    heroStack: 100,
    preflop: 'unopened',
    heroIsAggressor: false,
    opponents: [],
    villainAction: 'none',
    villainBetsEarlier: 0,
  };
}
