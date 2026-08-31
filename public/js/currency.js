// Пересчёт суммы по ТЗ не нужен, переключатель меняет только активное состояние.
export function initCurrencySwitch(root) {
  if (!root) return;

  root.addEventListener('click', (event) => {
    const button = event.target.closest('.currency__button');
    if (!button) return;

    root.querySelectorAll('.currency__button')
      .forEach((item) => item.classList.toggle('is-active', item === button));
  });
}
