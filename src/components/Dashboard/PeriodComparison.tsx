import React, { useState, useMemo } from 'react';
import { ArrowRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { formatCurrencyRandstad, formatPercentageDrift, formatDateRandstad } from '../../utils/formatters';

export const PeriodComparison: React.FC = () => {
  const { clientScopedRateCards: rateCards } = useRateCard();

  const periods = useMemo(() => {
    return Array.from(new Set(rateCards.map((r) => r.effectiveDate))).sort().reverse();
  }, [rateCards]);

  const [basePeriod, setBasePeriod] = useState<string>('');
  const [targetPeriod, setTargetPeriod] = useState<string>('');

  // Rate cards load asynchronously, so both selectors' first render sees an
  // empty list. Derive the shown periods rather than latching onto that state.
  const effectiveBase = basePeriod && periods.includes(basePeriod) ? basePeriod : periods[1] ?? '';
  const effectiveTarget =
    targetPeriod && periods.includes(targetPeriod) ? targetPeriod : periods[0] ?? '';

  // Compute the per-role delta between the two selected effective dates
  const comparisonList = useMemo(() => {
    const baseCards = rateCards.filter((r) => r.effectiveDate === effectiveBase);
    const targetCards = rateCards.filter((r) => r.effectiveDate === effectiveTarget);

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
  }, [rateCards, effectiveBase, effectiveTarget]);

  return (
    <div className="tonal-card">
      <div className="card-header-row">
        <div>
          <h2>Period over Period Rate Card Comparison</h2>
          <span className="app-subtitle">
            Compare minimum and maximum rate shifts between reporting dates
          </span>
        </div>

        {/* Period Selector Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div>
            <label className="form-label">Base Period:</label>
            <select
              className="form-control"
              style={{ width: '180px' }}
              value={effectiveBase}
              onChange={(e) => setBasePeriod(e.target.value)}
            >
              {periods.map((p) => (
                <option key={`base-${p}`} value={p}>
                  {formatDateRandstad(p)}
                </option>
              ))}
            </select>
          </div>

          <ArrowRight size={18} color="#415E7D" style={{ marginTop: '20px' }} />

          <div>
            <label className="form-label">Comparison Period:</label>
            <select
              className="form-control"
              style={{ width: '180px' }}
              value={effectiveTarget}
              onChange={(e) => setTargetPeriod(e.target.value)}
            >
              {periods.map((p) => (
                <option key={`target-${p}`} value={p}>
                  {formatDateRandstad(p)}
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
              <th>Base Max Rate ({formatDateRandstad(effectiveBase)})</th>
              <th>Target Max Rate ({formatDateRandstad(effectiveTarget)})</th>
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
