import { COST, WRONG_PENALTY } from '../sim/constants';
import { FAULTS, FAULT_IDS } from '../sim/faults';
import { FIXES, FIX_FOR } from '../sim/fixes';
import { Modal } from './Modal';

export function FieldGuide({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="Field guide" className="wide" onClose={onClose}>
        <div className="modal-head">
          <h2>📘 Field guide</h2>
          <button onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="hint">
          Query costs: metrics {COST.metrics}s · logs {COST.logs}s · traces {COST.traces}s · deploys {COST.deploys}s · wrong declare +
          {WRONG_PENALTY}s, then +{WRONG_PENALTY * 2}s, +{WRONG_PENALTY * 3}s…
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
                {FIX_FOR[f] && <p className="muted">🔧 Fix: {FIXES[FIX_FOR[f].fix]}</p>}
              </section>
            );
          })}
        </div>
    </Modal>
  );
}
