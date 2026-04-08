import { useQuestStore } from '../../stores/questStore';
import { Language } from '../../core/model/types';
import css from './MetadataEditor.module.css';

const LANGUAGE_OPTIONS = [
  { value: 0, label: 'Japanese (JP)' },
  { value: 1, label: 'English (EN)' },
  { value: 2, label: 'German (DE)' },
  { value: 3, label: 'French (FR)' },
  { value: 4, label: 'Spanish (ES)' },
];

function versionLabel(version: string): string {
  if (version === 'DC') return 'DC / GC (ASCII)';
  if (version === 'PC') return 'PC (UTF-16LE)';
  if (version === 'BB') return 'Blue Burst (UTF-16LE)';
  return version;
}

export function MetadataEditor() {
  const quest = useQuestStore(s => s.quest);
  const updateBinMeta = useQuestStore(s => s.updateBinMeta);

  if (!quest) {
    return <div className={css.placeholder}>No quest loaded.</div>;
  }

  const { bin } = quest;

  return (
    <div className={css.wrap}>
      <div className={css.section}>
        <div className={css.sectionTitle}>Quest Identity</div>

        <div className={css.row}>
          <span className={css.label}>Quest #</span>
          <div className={css.field}>
            <input
              type="number"
              className={css.numInput}
              value={bin.questNumber}
              min={0}
              max={65535}
              onChange={e => updateBinMeta({ questNumber: Math.max(0, Math.min(65535, parseInt(e.target.value, 10) || 0)) })}
            />
          </div>
        </div>

        <div className={css.row}>
          <span className={css.label}>Title</span>
          <div className={css.field}>
            <input
              type="text"
              className={css.input}
              value={bin.title}
              maxLength={32}
              onChange={e => updateBinMeta({ title: e.target.value })}
            />
            <div className={css.hint}>{bin.title.length} / 32 characters</div>
          </div>
        </div>

        <div className={css.row}>
          <span className={css.label}>Language</span>
          <div className={css.field}>
            <select
              className={css.select}
              value={bin.language}
              onChange={e => updateBinMeta({ language: parseInt(e.target.value, 10) as Language })}
            >
              {LANGUAGE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={css.row}>
          <span className={css.label}>Version</span>
          <div className={css.field}>
            <input
              type="text"
              className={css.input}
              value={versionLabel(bin.version)}
              readOnly
              style={{ opacity: 0.6, cursor: 'default' }}
            />
            <div className={css.hint}>Determined by the source file — not editable.</div>
          </div>
        </div>
      </div>

      <div className={css.section}>
        <div className={css.sectionTitle}>Text Content</div>

        <div className={css.row}>
          <span className={css.label}>Short Info</span>
          <div className={css.field}>
            <textarea
              className={css.textarea}
              value={bin.info}
              rows={3}
              onChange={e => updateBinMeta({ info: e.target.value })}
            />
            <div className={css.hint}>Shown in the quest selection menu.</div>
          </div>
        </div>

        <div className={css.row}>
          <span className={css.label}>Description</span>
          <div className={css.field}>
            <textarea
              className={css.textarea}
              value={bin.description}
              rows={5}
              onChange={e => updateBinMeta({ description: e.target.value })}
            />
            <div className={css.hint}>Shown when the quest is highlighted in-game.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
