import { useEffect, useState } from 'react';
import { isOnTick, roundToTick, tickSize } from '../../../shared/market';
import type { OrderType, Side } from '../../../shared/types';
import { won } from '../format';
import { useStore } from '../store';

export function OrderTicket() {
  const { selected, status, account, risk, placeOrder } = useStore();
  const stock = useStore((s) => s.stocks.find((x) => x.symbol === s.selected));
  const marketPrice = useStore((s) => s.quotes[s.selected]?.price);
  const holding = useStore((s) => s.holdings.find((h) => h.symbol === s.selected));
  const ticketFill = useStore((s) => s.ticketFill);

  const [side, setSide] = useState<Side>('buy');
  const [type, setType] = useState<OrderType>('limit');
  const [price, setPrice] = useState(0);
  const [qty, setQty] = useState(0);
  const [bracket, setBracket] = useState(false);
  const [stop, setStop] = useState(0);
  const [take, setTake] = useState(0);
  const [memo, setMemo] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);

  // 종목을 바꾸면 주문가를 현재가로 되돌린다.
  useEffect(() => {
    setPrice(useStore.getState().quotes[selected]?.price ?? 0);
    setQty(0);
    setBracket(false);
    setStop(0);
    setTake(0);
  }, [selected]);

  // 호가창이나 비중 계산기에서 넘어온 값을 지정가로 입력한다.
  useEffect(() => {
    if (!ticketFill) return;
    setType('limit');
    setPrice(ticketFill.price);
    if (ticketFill.qty !== undefined) {
      setSide('buy');
      setQty(ticketFill.qty);
    }
    if (ticketFill.stop || ticketFill.take) {
      setBracket(true);
      setStop(ticketFill.stop ?? 0);
      setTake(ticketFill.take ?? 0);
    }
  }, [ticketFill]);

  if (!stock || !marketPrice || !status || !account) return <section className="panel ticket" />;

  const refPrice = type === 'limit' ? price : marketPrice;
  const amount = qty * refPrice;
  const maxQty =
    side === 'buy'
      ? refPrice > 0
        ? Math.floor(account.buyingPower / (refPrice * (1 + status.feeRate)))
        : 0
      : (holding?.sellableQty ?? 0);

  let problem = '';
  if (type === 'limit' && !isOnTick(price)) problem = `호가 단위(${won(tickSize(price))}원)에 맞지 않습니다.`;
  else if (qty > maxQty) problem = side === 'buy' ? '주문 가능 금액을 넘었습니다.' : '매도 가능 수량을 넘었습니다.';
  else if (amount > status.maxOrderAmount) problem = `1회 주문 한도 ${won(status.maxOrderAmount)}원을 넘었습니다.`;
  const useBracket = side === 'buy' && bracket && (stop > 0 || take > 0);
  if (!problem && useBracket) {
    if (stop > 0 && stop >= refPrice) problem = '손절가는 매수가보다 낮아야 합니다.';
    else if (take > 0 && take <= refPrice) problem = '익절가는 매수가보다 높아야 합니다.';
  }
  if (!problem && side === 'buy' && risk?.blocked) problem = '오늘 손실이 하루 한도에 닿아 매수가 막혀 있습니다.';
  const canSubmit = qty > 0 && !problem;

  const step = (d: 1 | -1) =>
    setPrice((p) => (d > 0 ? roundToTick(p, 'down') + tickSize(p) : roundToTick(p, 'up') - tickSize(p - 1)));

  const submit = async () => {
    setSending(true);
    const ok = await placeOrder({
      symbol: selected,
      side,
      type,
      qty,
      price: type === 'limit' ? price : undefined,
      stopPrice: useBracket && stop > 0 ? stop : undefined,
      takePrice: useBracket && take > 0 ? take : undefined,
      memo: memo.trim() || undefined,
    });
    setSending(false);
    setConfirming(false);
    if (ok) {
      setQty(0);
      setMemo('');
    }
  };

  const sideLabel = side === 'buy' ? '매수' : '매도';

  return (
    <section className="panel ticket">
      <div className="seg">
        <button className={side === 'buy' ? 'on buy' : ''} onClick={() => setSide('buy')}>
          매수
        </button>
        <button className={side === 'sell' ? 'on sell' : ''} onClick={() => setSide('sell')}>
          매도
        </button>
      </div>
      <div className="seg small">
        <button className={type === 'limit' ? 'on' : ''} onClick={() => setType('limit')}>
          지정가
        </button>
        <button className={type === 'market' ? 'on' : ''} onClick={() => setType('market')}>
          시장가
        </button>
      </div>

      <label className="field">
        <span>가격</span>
        {type === 'limit' ? (
          <div className="stepper">
            <button onClick={() => step(-1)} aria-label="가격 내리기">
              −
            </button>
            <input inputMode="numeric" value={price || ''} onChange={(e) => setPrice(Number(e.target.value) || 0)} />
            <button onClick={() => step(1)} aria-label="가격 올리기">
              +
            </button>
          </div>
        ) : (
          <div className="readonly">시장가 (현재 {won(marketPrice)}원)</div>
        )}
      </label>

      <label className="field">
        <span>수량</span>
        <div className="stepper">
          <button onClick={() => setQty((q) => Math.max(0, q - 1))} aria-label="수량 줄이기">
            −
          </button>
          <input
            inputMode="numeric"
            value={qty || ''}
            placeholder="0"
            onChange={(e) => setQty(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          />
          <button onClick={() => setQty((q) => q + 1)} aria-label="수량 늘리기">
            +
          </button>
        </div>
      </label>
      <div className="quick">
        {[10, 25, 50, 100].map((p) => (
          <button key={p} className="chip" onClick={() => setQty(Math.floor((maxQty * p) / 100))}>
            {p === 100 ? '최대' : `${p}%`}
          </button>
        ))}
      </div>

      {side === 'buy' && (
        <div className="bracket">
          <label className="check">
            <input type="checkbox" checked={bracket} onChange={(e) => setBracket(e.target.checked)} />
            손절·익절 함께 걸기
          </label>
          {bracket && (
            <div className="bracket-grid">
              <label>
                <span>손절가</span>
                <input inputMode="numeric" placeholder="없음" value={stop || ''} onChange={(e) => setStop(Number(e.target.value) || 0)} />
              </label>
              <label>
                <span>익절가</span>
                <input inputMode="numeric" placeholder="없음" value={take || ''} onChange={(e) => setTake(Number(e.target.value) || 0)} />
              </label>
            </div>
          )}
        </div>
      )}

      <dl className="summary">
        <dt>{side === 'buy' ? '주문 가능' : '매도 가능'}</dt>
        <dd>{side === 'buy' ? `${won(account.buyingPower)}원` : `${won(holding?.sellableQty ?? 0)}주`}</dd>
        <dt>예상 주문 금액</dt>
        <dd>{won(amount)}원</dd>
      </dl>
      {problem && qty > 0 && <div className="problem">{problem}</div>}

      <button className={`submit ${side}`} disabled={!canSubmit} onClick={() => setConfirming(true)}>
        {sideLabel}하기
      </button>

      {confirming && (
        <div className="modal-back" onClick={() => !sending && setConfirming(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              {stock.name} <span className={side}>{sideLabel}</span>
            </h3>
            <dl className="summary">
              <dt>유형</dt>
              <dd>{type === 'limit' ? '지정가' : '시장가'}</dd>
              <dt>가격</dt>
              <dd>{type === 'limit' ? `${won(price)}원` : '시장가'}</dd>
              <dt>수량</dt>
              <dd>{won(qty)}주</dd>
              <dt>예상 금액</dt>
              <dd>{won(amount)}원</dd>
              {useBracket && (
                <>
                  <dt>자동 매도</dt>
                  <dd>
                    {stop > 0 ? `손절 ${won(stop)}` : ''} {take > 0 ? `익절 ${won(take)}` : ''}
                  </dd>
                </>
              )}
            </dl>
            <input className="search memo" placeholder="매매 이유 (선택, 매매 일지에 남습니다)" value={memo} onChange={(e) => setMemo(e.target.value)} />
            <p className={`mode ${status.live ? 'live' : ''}`}>
              {status.live ? '실계좌 주문입니다. 실제 돈이 움직입니다.' : '모의투자 주문입니다. 실제 돈은 움직이지 않습니다.'}
            </p>
            <div className="modal-actions">
              <button disabled={sending} onClick={() => setConfirming(false)}>
                취소
              </button>
              <button className={`submit ${side}`} disabled={sending} onClick={submit}>
                {sending ? '전송 중…' : `${sideLabel} 주문`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
