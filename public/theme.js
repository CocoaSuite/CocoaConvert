// Applies the saved theme before the first paint, so the page never flashes the wrong colours.
try {
  if (localStorage.getItem('cc-theme') === 'light') document.documentElement.classList.add('light');
} catch (e) {}
