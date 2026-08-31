export function initCatalogMenu(toggle, menu) {
  if (!toggle || !menu) return;

  const setOpen = (open) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(menu.hidden);
  });

  // Клик внутри меню не должен его закрывать, поэтому проверяем contains,
  // а не просто «клик где-то на документе».
  document.addEventListener('click', (event) => {
    if (menu.hidden) return;
    if (menu.contains(event.target) || toggle.contains(event.target)) return;
    setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });

  menu.addEventListener('click', (event) => {
    const section = event.target.closest('.catalog-menu__section');
    if (!section) return;
    menu.querySelectorAll('.catalog-menu__section')
      .forEach((item) => item.classList.toggle('is-active', item === section));
  });
}
