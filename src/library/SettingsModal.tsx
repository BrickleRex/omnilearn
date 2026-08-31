import { useState } from 'react';
import type { GuidanceStyle, Scheme, Settings } from '../../shared/types';
import { api } from '../api';
import Modal from '../components/Modal';

const SCHEMES: Array<{ id: Scheme; name: string; note: string; swatches: [string, string, string, string] }> = [
  { id: 'sunshower',  name: 'Sunshower',  note: 'light · default', swatches: ['#f2efe8', '#ff5c39', '#2b50ff', '#ffc700'] },
  { id: 'blackboard', name: 'Blackboard', note: 'dark · chalk',    swatches: ['#17181c', '#ff7a5c', '#7e97ff', '#ffd34d'] },
  { id: 'arcade',     name: 'Arcade',     note: 'dark · neon',     swatches: ['#0d0e12', '#ff4d6d', '#3ddc97', '#ffc700'] },
  { id: 'mint',       name: 'Mint',       note: 'light · calm',    swatches: ['#eef4ef', '#0f7b5f', '#3b6ce8', '#ff6b4a'] },
];

const GUIDANCE: Array<{ id: GuidanceStyle; name: string; note: string }> = [
  { id: 'compass',   name: 'Compass',   note: 'slim strip above the editor: step pips + the current step.' },
  { id: 'footlight', name: 'Footlight', note: 'bottom bar with an amber lamp; hints type themselves out.' },
  { id: 'both',      name: 'Both',      note: 'compass overhead, footlight below. The default.' },
];

export default function SettingsModal({
  settings, onSettings, onClose, onError,
}: {
  settings: Settings;
  onSettings: (s: Settings) => void;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);

  async function save(patch: Partial<Settings>, key: string) {
    setSaving(key);
    try {
      const next = await api.putSettings(patch);
      onSettings(next);
    } catch (e) {
      onError(e);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Modal title="Settings" onClose={onClose} testId="settings-modal" width={560} labelledBy="settings-title">
      <section className="set-block">
        <span className="label">Color scheme</span>
        <div className="set-schemes">
          {SCHEMES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`set-swatch${settings.scheme === s.id ? ' is-on' : ''}`}
              data-testid={`scheme-${s.id}`}
              aria-pressed={settings.scheme === s.id}
              disabled={saving !== null}
              onClick={() => save({ scheme: s.id }, s.id)}
            >
              <span className="set-swatch-chips" aria-hidden="true">
                {s.swatches.map((c, i) => <i key={i} style={{ background: c }} />)}
              </span>
              <span className="set-swatch-name">{s.name}</span>
              <span className="set-swatch-note">{s.note}</span>
              {settings.scheme === s.id && <span className="set-tick" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="set-block">
        <span className="label">Guidance style</span>
        <div className="set-radios" role="radiogroup" aria-label="Guidance style">
          {GUIDANCE.map((g) => (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={settings.guidanceStyle === g.id}
              className={`set-radio${settings.guidanceStyle === g.id ? ' is-on' : ''}`}
              data-testid={`guidance-${g.id}`}
              disabled={saving !== null}
              onClick={() => save({ guidanceStyle: g.id }, g.id)}
            >
              <span className="set-dot" aria-hidden="true" />
              <span>
                <b>{g.name}</b>
                <em>{g.note}</em>
              </span>
            </button>
          ))}
        </div>
      </section>

      <p className="set-foot">
        Models: plan <code>{settings.models.plan}</code> · primer <code>{settings.models.primer}</code> ·
        hint <code>{settings.models.hint}</code> · ghost <code>{settings.models.ghost}</code> ·
        watch <code>{settings.models.watch}</code>
      </p>
    </Modal>
  );
}
