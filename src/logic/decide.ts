import { ALL_HANDS, TOTAL_COMBOS, combosOf } from './hands';
import { actionIndex, displayName, positionOfSeat, type Position } from './positions';
import { colorAt, handLevel, levelOf, maxLevel, positionLevel, type Settings } from './settings';

export type Situation = 'normal' | 'vs3bet' | 'vs4bet';

export interface DecisionInput {
  players: number;
  btnSeat: number;
  mySeat: number | null;
  hand: string | null;
  /** レイズ（3ベット・4ベット）した相手の座席 */
  opponentSeat: number | null;
  situation: Situation;
  settings: Settings;
}

export type Action = 'raise' | '3bet' | 'call' | 'fold' | 'check';

export const ACTION_LABELS: Record<Action, string> = {
  raise: 'レイズ',
  '3bet': '3ベット',
  call: 'コール',
  fold: 'フォールド',
  check: 'チェック（勝ち）',
};

export interface OpponentRange {
  /** 「LJの想定レンジ」「相手の3ベットレンジ」など */
  label: string;
  /** 範囲の最低レベル（この値以上） */
  minLevel: number;
  /** 「水色以上」「紺のみ」 */
  text: string;
  hands: string[];
  combos: number;
  percent: number;
}

export interface Decision {
  status: 'incomplete' | 'action' | 'rangeOnly';
  action?: Action;
  /** 理由（1行） */
  reason: string;
  /** 補足（BBのときの通常vsレイズ判定、3ベット下限など） */
  notes: string[];
  warnings: string[];
  myPosition?: Position;
  opponentPosition?: Position;
  myHandLevel?: number;
  opponentRange?: OpponentRange;
}

/** 相手として選べる座席か（オープン/vsレイズ・vs4ベットは自分より前、vs3ベットは自分より後ろ） */
export function isSelectableOpponent(
  seat: number,
  mySeat: number | null,
  btnSeat: number,
  players: number,
  situation: Situation,
): boolean {
  if (mySeat === null || seat === mySeat || seat < 0 || seat >= players) return false;
  const opp = actionIndex(seat, btnSeat, players);
  const me = actionIndex(mySeat, btnSeat, players);
  return situation === 'vs3bet' ? opp > me : opp < me;
}

/** 「minLevel 以上」のレンジを作る。最大レベルを超えたら最大色のみ、グレー（0）は含めない */
export function buildRange(settings: Settings, rawMin: number, label: string): OpponentRange {
  const top = maxLevel(settings);
  const minLevel = Math.max(1, Math.min(rawMin, top));
  const hands = ALL_HANDS.filter((h) => handLevel(settings, h) >= minLevel);
  const combos = hands.reduce((sum, h) => sum + combosOf(h), 0);
  const name = colorAt(settings, minLevel).name;
  return {
    label,
    minLevel,
    text: minLevel === top ? `${name}のみ` : `${name}以上`,
    hands,
    combos,
    percent: (combos / TOTAL_COMBOS) * 100,
  };
}

export function decide(input: DecisionInput): Decision {
  const { players, btnSeat, mySeat, hand, opponentSeat, situation, settings } = input;
  const res: Decision = { status: 'incomplete', reason: '', notes: [], warnings: [] };
  const name = (lv: number) => colorAt(settings, lv).name;
  const label = (p: Position) => displayName(p, players, settings.labelFirstSeatAsUtg);

  if (mySeat === null) {
    res.reason = 'テーブル図で自分の席をクリックしてください';
    return res;
  }
  const myPos = positionOfSeat(mySeat, btnSeat, players);
  res.myPosition = myPos;

  const validOpp =
    opponentSeat !== null && isSelectableOpponent(opponentSeat, mySeat, btnSeat, players, situation);
  const oppPos = validOpp ? positionOfSeat(opponentSeat, btnSeat, players) : undefined;
  res.opponentPosition = oppPos;
  const P = positionLevel(settings, myPos);
  const R = oppPos ? positionLevel(settings, oppPos) : undefined;
  const H = hand ? handLevel(settings, hand) : undefined;
  res.myHandLevel = H;

  const missingBase = (p: Position) =>
    res.warnings.push(`${label(p)}の基準色が未設定です（設定画面で入力してください）`);

  // ---- 相手の想定レンジ（推奨アクションとは別枠） ----
  if (situation === 'normal' && oppPos) {
    if (R === undefined) missingBase(oppPos);
    else res.opponentRange = buildRange(settings, R, `${label(oppPos)}の想定レンジ`);
  }

  // ---- vs3ベット／vs4ベット：レンジ表示のみ ----
  if (situation !== 'normal' && hand && H !== undefined) {
    res.notes.push(`あなたの手札${hand}は${name(H)}`);
  }
  if (situation === 'vs3bet') {
    if (myPos === 'BB') {
      res.reason = 'BBはオープンしないため、vs3ベットの場面になりません';
      return res;
    }
    if (P === undefined) {
      missingBase(myPos);
      res.reason = '自分のポジションの基準色が必要です';
      return res;
    }
    const who = oppPos ? label(oppPos) : '相手';
    res.opponentRange = buildRange(settings, P + settings.reraiseStep, `${who}の3ベットレンジ`);
    res.status = 'rangeOnly';
    res.reason = `あなた（${label(myPos)}）の基準は${name(P)} → ${settings.reraiseStep}つ上の${res.opponentRange.text}で3ベットしてくると想定`;
    if (!oppPos) res.notes.push('3ベットした人の座席をクリックすると名前が表示されます');
    return res;
  }
  if (situation === 'vs4bet') {
    if (!oppPos) {
      res.reason = '最初にオープンレイズした人（4ベットした人）の座席をクリックしてください';
      return res;
    }
    if (R === undefined) {
      missingBase(oppPos);
      res.reason = '相手のポジションの基準色が必要です';
      return res;
    }
    const threeBetMin = R + settings.reraiseStep;
    const top = maxLevel(settings);
    res.opponentRange = buildRange(
      settings,
      threeBetMin + settings.fourBetStep,
      `${label(oppPos)}の4ベットレンジ`,
    );
    res.status = 'rangeOnly';
    res.reason = `${label(oppPos)}の基準は${name(R)} → あなたの3ベット下限は${threeBetMin > top ? `${name(top)}のみ` : `${name(threeBetMin)}以上`}、相手の4ベットはさらに${settings.fourBetStep}つ上の${res.opponentRange.text}と想定`;
    return res;
  }

  // ---- 通常：オープン／vsレイズ／BB ----
  if (hand === null || H === undefined) {
    res.reason = '13×13表で手札をクリックしてください';
    return res;
  }
  const handText = `あなたの手札${hand}は${name(H)}`;

  if (!oppPos) {
    // オープン判定
    if (myPos === 'BB') {
      res.status = 'action';
      res.action = 'check';
      res.reason = '全員フォールドしたのでBBの勝ち';
      return res;
    }
    if (P === undefined) {
      missingBase(myPos);
      res.reason = '自分のポジションの基準色が必要です';
      return res;
    }
    res.status = 'action';
    res.action = H >= P ? 'raise' : 'fold';
    res.reason = `${handText}、${label(myPos)}の基準は${name(P)} → ${H >= P ? '基準以上なのでレイズ' : '基準未満なのでフォールド'}`;
    return res;
  }

  if (R === undefined) {
    res.reason = '相手のポジションの基準色が必要です';
    return res;
  }
  const diff = H - R;
  const step = settings.reraiseStep;
  const vsRaise: Action = diff >= step ? '3bet' : diff >= 1 ? 'call' : 'fold';
  const diffText =
    diff > 0 ? `${diff}つ上` : diff === 0 ? '同じ色' : `${-diff}つ下`;
  const vsRaiseReason = `${handText}、${label(oppPos)}の基準は${name(R)} → ${diffText}なので${ACTION_LABELS[vsRaise]}`;

  res.status = 'action';
  if (myPos !== 'BB') {
    res.action = vsRaise;
    res.reason = vsRaiseReason;
    return res;
  }

  // BB判定
  const bbMin = levelOf(settings, settings.bbCallColor) ?? 2;
  if (diff >= step) {
    res.action = '3bet';
    res.reason = vsRaiseReason;
  } else if (H >= bbMin) {
    res.action = 'call';
    res.reason = `${handText}、BBは${name(bbMin)}以上ならどこからのレイズでもコール可`;
  } else {
    res.action = 'fold';
    res.reason = `${handText}、BBのコール基準（${name(bbMin)}）未満なのでフォールド`;
  }
  res.notes.push(`通常のvsレイズ判定：${ACTION_LABELS[vsRaise]}（${diffText}）`);
  return res;
}
