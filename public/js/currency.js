// Кнопка только подсвечивается. Сумму не трогаем, в макете валюты нарочно разъехались.
export function initCurrencySwitch(root) {
  if (!root) return;

  root.addEventListener('click', (event) => {
    const button = event.target.closest('.currency__button');
    if (!button) return;

    root.querySelectorAll('.currency__button')
      .forEach((item) => item.classList.toggle('is-active', item === button));
  });
}
