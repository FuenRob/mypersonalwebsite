/* ==========================================================================
   Google Material Design 3 Theme - Main JavaScript
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initLiveSearch();
  initCodeCopyButtons();
});

/* --------------------------------------------------------------------------
   1. Dark / Light Theme Controller
   -------------------------------------------------------------------------- */
function initThemeToggle() {
  const toggleBtn = document.getElementById('theme-toggle-btn');
  if (!toggleBtn) return;

  const currentTheme = localStorage.getItem('g-theme') || 
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  setTheme(currentTheme);

  toggleBtn.addEventListener('click', () => {
    const activeTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = activeTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
  });
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('g-theme', theme);

  const toggleBtn = document.getElementById('theme-toggle-btn');
  if (toggleBtn) {
    toggleBtn.innerHTML = theme === 'dark' ? '☀️' : '🌙';
    toggleBtn.setAttribute('aria-label', theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
  }
}

/* --------------------------------------------------------------------------
   2. Live Search & Client-Side Filtering
   -------------------------------------------------------------------------- */
function initLiveSearch() {
  const searchInput = document.getElementById('g-search-input');
  const clearBtn = document.getElementById('g-search-clear');
  const cards = document.querySelectorAll('.g-card, .link-item');

  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();

    if (clearBtn) {
      clearBtn.style.display = query.length > 0 ? 'block' : 'none';
    }

    cards.forEach((card) => {
      const text = card.textContent.toLowerCase();
      if (query === '' || text.includes(query)) {
        card.style.display = '';
      } else {
        card.style.display = 'none';
      }
    });
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));
      searchInput.focus();
    });
  }
}

/* --------------------------------------------------------------------------
   3. Code Copy Buttons
   -------------------------------------------------------------------------- */
function initCodeCopyButtons() {
  const codeBlocks = document.querySelectorAll('.g-article-content pre');

  codeBlocks.forEach((pre) => {
    if (pre.querySelector('.code-copy-btn')) return;

    const button = document.createElement('button');
    button.className = 'code-copy-btn';
    button.type = 'button';
    button.textContent = 'Copiar';

    button.addEventListener('click', async () => {
      const code = pre.querySelector('code') ? pre.querySelector('code').innerText : pre.innerText;
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = '¡Copiado!';
        button.style.backgroundColor = 'var(--g-green)';
        setTimeout(() => {
          button.textContent = 'Copiar';
          button.style.backgroundColor = '';
        }, 2000);
      } catch (err) {
        button.textContent = 'Error';
      }
    });

    pre.style.position = 'relative';
    pre.appendChild(button);
  });
}
