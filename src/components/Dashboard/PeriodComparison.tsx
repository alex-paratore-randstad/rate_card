import React, { useState, useMemo } from 'react';
import { ArrowRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { formatCurrencyRandstad, formatPercentageDrift } from '../../utils/formatters';

export const PeriodComparison: React.FC = () => {
  const { rateCards } = useRateCard();

  const months = useMemo(() => {
    return Array.from(new Set(rateCards.map((r) => r.effectiveMonth))).sort().reverse();
  }, [rateCards]);

  const [baseMonth, setBaseMonth] = useState<string>(months[1] || '2026-03');
  const [targetMonth, setTargetMonth] = useState<string>(months[0] || '2026-04');

  // Compute MoM delta per role between baseMonth and targetMonth
  const comparisonList = useMemo(() => {
    const baseCards = rateCards.filter((r) => r.effectiveMonth === baseMonth);
    const targetCards = rateCards.filter((r) => r.effectiveMonth === targetMonth);

    const rolesSet = new Set([
      ...baseCards.map((r) => r.jobTitle),
      ...targetCards.map((r) => r.jobTitle),
    ]);

    return Array.from(rolesSet).map((role) => {
      const baseRec = baseCards.find((r) => r.jobTitle === role);
      const targetRec = targetCards.find((r) => r.jobTitle === role);

      const baseMin = baseRec ? baseRec.minRate : 0;
      const baseMax = baseRec ? baseRec.maxRate : 0;
      const targetMin = targetRec ? targetRec.minRate : 0;
      const targetMax = targetRec ? targetRec.maxRate : 0;

      const minDelta = targetMin && baseMin ? targetMin - baseMin : 0;
      const maxDelta = targetMax && baseMax ? targetMax - baseMax : 0;
      const maxDeltaPercent = baseMax ? (maxDelta / baseMax) * 100 : 0;

      return {
        jobTitle: role,
        baseMin,
        baseMax,
        targetMin,
        targetMax,
        minDelta,
        maxDelta,
        maxDeltaPercent,
      };
    });
  }, [rateCards, baseMonth, targetMonth]);

  return (
    <div className="tonal-card">
      <div className="card-header-row">
        <div>
          <h2>Period over Period Rate Card Comparison</h2>
          <span className="app-subtitle">
            Compare minimum and maximum rate shifts between monthly reporting cycles
          </span>
        </div>

        {/* Period Selector Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div>
            <label className="form-label">Base Period:</label>
            <select
              className="form-control"
              style={{ width: '150px' }}
              value={baseMonth}
              onChange={(e) => setBaseMonth(e.target.value)}
            >
              {months.map((m) => (
                <option key={`base-${m}`} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <ArrowRight size={18} color="#415E7D" style={{ marginTop: '20px' }} />

          <div>
            <label className="form-label">Comparison Period:</label>
            <select
              className="form-control"
              style={{ width: '150px' }}
              value={targetMonth}
              onChange={(e) => setTargetMonth(e.target.value)}
            >
              {months.map((m) => (
                <option key={`target-${m}`} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="table-container">
        <table className="randstad-table">
          <thead>
            <tr>
              <th>Job Title</th>
              <th>Base Max Rate ({baseMonth})</th>
              <th>Target Max Rate ({targetMonth})</th>
              <th>Rate Change (USD)</th>
              <th>Percentage Shift</th>
            </tr>
          </thead>
          <tbody>
            {comparisonList.map((item) => {
              const isPositive = item.maxDelta > 0;
              const isNegative = item.maxDelta < 0;

              return (
                <tr key={item.jobTitle}>
                  <td>{item.jobTitle}</td>
                  <td>{item.baseMax ? formatCurrencyRandstad(item.baseMax) : 'N/A'}</td>
                  <td>{item.targetMax ? formatCurrencyRandstad(item.targetMax) : 'N/A'}</td>
                  <td style={{ fontWeight: 600 }}>
                    {item.maxDelta !== 0
                      ? `${item.maxDelta > 0 ? '+' : ''}${formatCurrencyRandstad(item.maxDelta)}`
                      : 'USD $0.00'}
                  </td>
                  <td>
                    <span
                      className={`status-pill ${
                        isPositive ? 'success' : isNegative ? 'error' : 'info'
                      }`}
                    >
                      {isPositive && <TrendingUp size={14} />}
                      {isNegative && <TrendingDown size={14} />}
                      {!isPositive && !isNegative && <Minus size={14} />}
                      <span>{formatPercentageDrift(item.maxDeltaPercent)}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
