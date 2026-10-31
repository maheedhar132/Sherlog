import { useState } from 'react';
import type { Profile } from '../ai/adapter';
import { fmt } from '../game/session';
import { scoreShift, shiftShareText, type ShiftEntry } from '../game/shift';
import type { Mode } from '../sim/types';

interface Props {
  entries: ShiftEntry[];
  mode: Mode;
  best: boolean;
  profile: Profile;
  onAgain: () => void;
  onHome: () => void;
}

export function ShiftSummary({ entries, mode, best, profile, onAgain, onHome }: Props) {
  const s = scoreShift(entries);
  const [copied, setCopied] = useState(false);
  const share = shiftShareText(entries, location.href.split('#')[0]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(share);
      setCopied(true);
    } catch {
      prompt('Copy your result:', share);
    }
  };
  const verdict = s.wins === entries.length ? 'A clean shift' : s.wins > 0 ? 'A shift with a fight' : s.solved > 0 ? 'The AI had the night shift' : 'A rough night';
  return (
    <div className="postmortem shift-summary">
      <header className="pm-head">
        <div>
          <h1>🌙 {verdict}</h1>
          <p className="muted">
            {s.wins}/{entries.length} beat the AI · {s.solved}/{entries.length} solved · {mode} mode
            {best ? ' · 🏅 your best shift so far' : ''}
          </p>
        </div>
        <div className="pm-score">
          <div>
            <span>Your total</span>
            <b>{fmt(s.total)}</b>
          </div>
          <div>
            <span>AI total</span>
            <b>{fmt(s.aiTotal)}</b>
          </div>
        </div>
      </header>
      <section className="card">
        <h3>The shift</h3>
        <ol className="timeline">
          {entries.map((e, i) => (
            <li key={i} className={e.won ? 'good' : e.playerMttr === null ? 'bad' : ''}>
              <time>#{i + 1}</time>
              {e.won ? '🏆 beat the AI' : e.playerMttr === null ? '⬛ unsolved' : '🤖 solved, AI faster'}: you {e.playerMttr === null ? 'n/a' : fmt(e.playerMttr)} vs AI {fmt(e.aiMttr)}
            </li>
          ))}
        </ol>
        {profile.bestShift && (
          <p className="muted">
            Best shift: {profile.bestShift.solved}/{entries.length} solved in {fmt(profile.bestShift.total)} · shifts played: {profile.shifts ?? 1}
          </p>
        )}
        <pre className="share">{share}</pre>
        <div className="row-buttons">
          <button onClick={copy}>{copied ? 'Copied ✓' : '📋 Copy result'}</button>
          <button className="primary" onClick={onAgain}>
            Another shift →
          </button>
          <button onClick={onHome}>Home</button>
        </div>
      </section>
    </div>
  );
}
