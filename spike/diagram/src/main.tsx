import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FIXTURES } from './fixtures';
import { renderCircuit } from './pipeline';

function App() {
  const [svgs, setSvgs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all(FIXTURES.map(renderCircuit)).then(setSvgs, (e) => setError(String(e)));
  }, []);
  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <h1>Diagram spike (elkjs layered)</h1>
      <p>Hover any wire to highlight its whole net.</p>
      {error && <pre style={{ color: 'crimson' }}>{error}</pre>}
      {svgs.map((svg, i) => (
        <div key={i} style={{ overflow: 'auto', marginBottom: 24, border: '1px solid #ccc' }} dangerouslySetInnerHTML={{ __html: svg }} />
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
