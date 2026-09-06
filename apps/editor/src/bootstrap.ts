// Startup failures must be visible before the editor creates any editable state.
import './base.css';

try {
  await import('./main.ts');
} catch (error) {
  document.body.replaceChildren();
  const main = document.createElement('main');
  main.setAttribute('role', 'alert');
  const missing = error instanceof Error && error.message === 'EDITOR_SHOT_NOT_FOUND';
  const title = document.createElement('h1'); title.textContent = missing ? 'This shot could not be found' : 'Your local project could not connect';
  const message = document.createElement('p');
  message.textContent = 'Keep npm run dev:editor running, then retry. Your saved project has not been changed.';
  const retry = document.createElement('button'); retry.textContent = 'Retry connection';
  retry.addEventListener('click', () => { if (missing) location.href = location.pathname; else location.reload(); });
  if (missing) {
    message.textContent = 'The requested shot is not in this project. No other shot has been opened or changed.';
    retry.textContent = 'Open project';
  }
  main.append(title, message, retry); document.body.append(main);
}
