import { displayName, positionOfSeat } from '../logic/positions';

interface Props {
  players: number;
  btnSeat: number;
  mySeat: number | null;
  opponentSeat: number | null;
  labelFirstSeatAsUtg: boolean;
  isSelectable: (seat: number) => boolean;
  onSeatClick: (seat: number) => void;
  onSeatRightClick: (seat: number) => void;
}

const W = 560;
const H = 380;
const CX = W / 2;
const CY = H / 2;
const RX = 215;
const RY = 135;

export function TableView(props: Props) {
  const { players, btnSeat, mySeat, opponentSeat, labelFirstSeatAsUtg } = props;
  const seats = Array.from({ length: players }, (_, i) => i);

  return (
    <svg className="table-view" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="テーブル">
      <ellipse cx={CX} cy={CY} rx={RX - 40} ry={RY - 35} className="felt" />
      <text x={CX} y={CY} className="felt-text">{players}人</text>
      {seats.map((seat) => {
        // 下中央から時計回りに配置
        const t = Math.PI / 2 + (seat * 2 * Math.PI) / players;
        const x = CX + RX * Math.cos(t);
        const y = CY + RY * Math.sin(t);
        const pos = positionOfSeat(seat, btnSeat, players);
        const isMe = seat === mySeat;
        const isOpp = seat === opponentSeat;
        const selectable = mySeat === null || isMe || props.isSelectable(seat);
        const cls = ['seat'];
        if (isMe) cls.push('me');
        else if (isOpp) cls.push('opponent');
        if (!selectable) cls.push('disabled');
        const blind = pos === 'BTN' || pos === 'SB' || pos === 'BB';
        return (
          <g
            key={seat}
            className={cls.join(' ')}
            transform={`translate(${x},${y})`}
            onClick={() => props.onSeatClick(seat)}
            onContextMenu={(e) => {
              e.preventDefault();
              props.onSeatRightClick(seat);
            }}
          >
            <title>{`座席${seat + 1}：${displayName(pos, players, labelFirstSeatAsUtg)}`}</title>
            <circle r={34} />
            <text className="pos" y={isMe || isOpp ? -4 : 5}>
              {displayName(pos, players, labelFirstSeatAsUtg)}
            </text>
            {(isMe || isOpp) && (
              <text className="role" y={14}>{isMe ? 'あなた' : 'レイズ'}</text>
            )}
            {blind && (
              <g transform="translate(26,-26)" className={`chip chip-${pos.toLowerCase()}`}>
                <circle r={12} />
                <text y={4}>{pos === 'BTN' ? 'D' : pos}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
