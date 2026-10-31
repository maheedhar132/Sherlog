import { COST, WRONG_PENALTY } from '../sim/constants';
import { FAULTS, FAULT_IDS } from '../sim/faults';

export function FieldGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Field guide">
        <div className="modal-head">
          <h2>📘 Field guide</h2>
          <button onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="hint">
          Query costs: metrics {COST.metrics}s · logs {COST.logs}s · traces {COST.traces}s · deploys {COST.deploys}s · wrong declare +
          {WRONG_PENALTY}s
        </p>
        <div className="guide-grid">
          {FAULT_IDS.map((f) => {
            const d = FAULTS[f];
            return (
              <section key={f} className="guide-item">
                <h3>{d.name}</h3>
                <p className="muted">{d.short}</p>
                <ul>
                  {d.signals.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                <p className="tip">💡 {d.tip}</p>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
