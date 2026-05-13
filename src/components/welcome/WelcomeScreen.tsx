import { useState, useEffect } from 'react';
import { isTauri } from '../../platform/index';
import { useQuestStore } from '../../stores/questStore';
import styles from './WelcomeScreen.module.css';

type CreditLine = { text: string; head?: true; dim?: true };

const CREDITS: CreditLine[] = [
  { text: '' },
  { text: 'Original QEdit Idea and Development', head: true },
  { text: '' },
  { text: 'Coder', head: true },
  { text: 'Schthack' },
  { text: '' },
  { text: 'First ASM file', head: true },
  { text: 'Myria' },
  { text: 'Clara' },
  { text: '' },
  { text: 'ASM Update', head: true },
  { text: 'Lee  (over 50% of the ASM)' },
  { text: 'Aleron Ives' },
  { text: 'Gatten' },
  { text: 'Schthack' },
  { text: '' },
  { text: 'Quest file format', head: true },
  { text: 'Schthack' },
  { text: 'Lee  (Challenge mode data)', dim: true },
  { text: '' },
  { text: '3D map structure', head: true },
  { text: 'Schthack' },
  { text: '' },
  { text: '3D model structure', head: true },
  { text: 'Kryslin' },
  { text: '' },
  { text: 'Object and Monster model research', head: true },
  { text: 'Lee' },
  { text: 'Schthack' },
  { text: 'Firefox' },
  { text: '' },
  { text: '1.0c-2.0c updates', head: true },
  { text: 'Alisaryn' },
  { text: '' },
  { text: 'Special thanks', head: true },
  { text: 'AleronIves · Lee · Firefox276' },
  { text: 'for their suggestions and being very good guinea pigs', dim: true },
  { text: '' },
  { text: '' },
  { text: 'Research & Reference', head: true },
  { text: 'Phantasmal World' },
  { text: 'by Daan Vanden Bosch', dim: true },
  { text: '' },
  { text: '' },
  { text: 'Built with', head: true },
  { text: 'Tauri · React · TypeScript' },
  { text: 'Three.js · CodeMirror · Zustand', dim: true },
  { text: '' },
  { text: '' },
  { text: 'Phantasy Star Online © Sega', dim: true },
  { text: '' },
  { text: '' },
  { text: 'TypeScript port', head: true },
  { text: 'Gregoire L. Duval' },
  { text: 'Anthropic Claude', dim: true },
  { text: '' },
  { text: '' },
  { text: '' },
];

export function WelcomeScreen() {
  const { newQuest, openQuest, openQuestFromPath, isLoading } = useQuestStore();
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [showRecent,  setShowRecent]  = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke<string[]>('get_recent_files').then(setRecentFiles)
    );
  }, []);

  function handleOpenRecent(path: string) {
    setShowRecent(false);
    void openQuestFromPath(path);
  }

  return (
    <div className={styles.screen} onClick={() => setShowRecent(false)}>

      <div className={styles.left}>
        <div className={styles.hero}>
          <img src="./logo.png" alt="QEdit" className={styles.logo} draggable={false} />
          <div className={styles.appName}>QEdit</div>
          <div className={styles.tagline}>Quest Editor for Phantasy Star Online</div>
        </div>

        <div className={styles.actions}>
          <div className={styles.newRow}>
            <button onClick={() => newQuest(1)} disabled={isLoading}>New — Episode I</button>
            <button onClick={() => newQuest(2)} disabled={isLoading}>New — Episode II</button>
            <button onClick={() => newQuest(4)} disabled={isLoading}>New — Episode IV</button>
          </div>
          <div className={styles.openRow}>
            <button className="primary" onClick={() => void openQuest()} disabled={isLoading}>
              {isLoading ? 'Loading...' : 'Open File...'}
            </button>
            {isTauri() && recentFiles.length > 0 && (
              <div className={styles.recentWrap} onClick={e => e.stopPropagation()}>
                <button onClick={() => setShowRecent(v => !v)} disabled={isLoading}>
                  Open Recent ▾
                </button>
                {showRecent && (
                  <div className={styles.recentDropdown}>
                    {recentFiles.map(path => (
                      <button key={path} onClick={() => handleOpenRecent(path)} title={path}>
                        {path.split(/[\\/]/).pop()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.creditsScroll}>
          {[...CREDITS, ...CREDITS].map((line, i) => (
            <div
              key={i}
              className={[
                styles.creditLine,
                line.head ? styles.creditHead : '',
                line.dim  ? styles.creditDim  : '',
              ].filter(Boolean).join(' ')}
            >
              {line.text || ' '}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
