import { RANK_CHARS, SUIT_SYMBOLS, makeCard, parseCard, rankOf, suitOf, cardToString } from '../engine/cards';

/** 1枚のカード表示（4色デッキ：♠黒 ♥赤 ♦青 ♣緑） */
export function CardChip({ card, small }: { card: string; small?: boolean }) {
  const c = parseCard(card);
  if (c === null) return <span className="card-chip bad">{card}</span>;
  const r = RANK_CHARS[rankOf(c)];
  return (
    <span className={`card-chip suit-${suitOf(c)}${small ? ' small' : ''}`}>
      {r === 'T' ? '10' : r}
      {SUIT_SYMBOLS[suitOf(c)]}
    </span>
  );
}

export function CardRow({ cards, placeholder }: { cards: string[]; placeholder?: string }) {
  if (cards.length === 0) return <span className="muted">{placeholder ?? '—'}</span>;
  return (
    <span className="card-row">
      {cards.map((c) => (
        <CardChip key={c} card={c} />
      ))}
    </span>
  );
}

interface PickerProps {
  /** 使用中のカード（他の欄で使っているもの） */
  used: Set<string>;
  /** この欄で選択中 */
  selected: string[];
  max: number;
  onChange: (cards: string[]) => void;
}

/** 52枚から選ぶ（クリックで追加／解除） */
export function CardPicker({ used, selected, max, onChange }: PickerProps) {
  return (
    <div className="card-picker" role="group" aria-label="カードを選ぶ">
      {[0, 1, 2, 3].map((suit) => (
        <div key={suit} className="picker-row">
          {Array.from({ length: 13 }, (_, i) => 12 - i).map((rank) => {
            const card = cardToString(makeCard(rank, suit));
            const isSel = selected.includes(card);
            const disabled = !isSel && (used.has(card) || selected.length >= max);
            return (
              <button
                key={card}
                type="button"
                className={`pick suit-${suit}${isSel ? ' active' : ''}`}
                disabled={disabled}
                onClick={() => onChange(isSel ? selected.filter((x) => x !== card) : [...selected, card])}
                aria-pressed={isSel}
              >
                {RANK_CHARS[rank] === 'T' ? '10' : RANK_CHARS[rank]}
                {SUIT_SYMBOLS[suit]}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
