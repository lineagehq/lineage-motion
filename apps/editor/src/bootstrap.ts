// Startup failures must be visible before the editor creates any editable state.
import './base.css';

try {
  await import('./main.ts');
} catch {
  document.body.replaceChildren();
  const main = document.createElement('main');
  main.setAttribute('role', 'alert');
  const title = document.createElement('h1'); title.textContent = 'Your local project could not connect';
  const message = document.createElement('p');
  message.textContent = 'Keep npm run dev:editor running, then retry. Your saved project has not been changed.';
  const retry = document.createElement('button'); retry.textContent = 'Retry connection';
  retry.addEventListener('click', () => location.reload());
  main.append(title, message, retry); document.body.append(main);
}
