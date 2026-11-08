// Tiny loader: the floating to-do widget loads only its own small module; every other window loads the full app.
const mode = new URLSearchParams(location.search).get('mode');
if (mode === 'todo') import('./todo.js'); else import('./app.js');
