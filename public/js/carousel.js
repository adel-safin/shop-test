const AUTOPLAY_MS = 5000;

export function initCarousel(root) {
  const slides = [...root.querySelectorAll('.banner__slide')];
  const dotsBox = root.querySelector('[data-carousel-dots]');
  if (slides.length === 0 || !dotsBox) return;

  let current = 0;
  let timer = null;

  const dots = slides.map((_, index) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'banner__dot';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `Слайд ${index + 1}`);
    dot.addEventListener('click', () => {
      show(index);
      restart();
    });
    dotsBox.append(dot);
    return dot;
  });

  function show(index) {
    current = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => slide.classList.toggle('is-active', i === current));
    dots.forEach((dot, i) => {
      dot.classList.toggle('is-active', i === current);
      dot.setAttribute('aria-selected', String(i === current));
    });
  }

  const restart = () => {
    clearInterval(timer);
    timer = setInterval(() => show(current + 1), AUTOPLAY_MS);
  };

  root.querySelector('[data-carousel-prev]')?.addEventListener('click', () => {
    show(current - 1);
    restart();
  });

  root.querySelector('[data-carousel-next]')?.addEventListener('click', () => {
    show(current + 1);
    restart();
  });

  // Автопрокрутка не должна тикать в фоновой вкладке и под курсором.
  root.addEventListener('mouseenter', () => clearInterval(timer));
  root.addEventListener('mouseleave', restart);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(timer);
    else restart();
  });

  show(0);
  restart();
}
