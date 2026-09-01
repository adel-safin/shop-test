import { api, isStaticHost, rubles } from './api.js';

// Ключ идемпотентности живёт, пока запрос по этому товару в полёте. Второй клик
// попадает в тот же ключ, сервер отдаёт тот же заказ вместо второго.
const inFlight = new Map();

function cardTemplate(product) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.sku = product.sku;

  const oldPrice = Math.round((product.price_kopecks * 1.5) / 100) * 100;
  const stock = Number(product.free_keys);

  card.innerHTML = `
    <img class="card__cover" src="assets/card-cover.png" alt="">
    <div class="card__body">
      <h3 class="card__title">💥 ${product.name} 🔑 РФ+СНГ</h3>
      <div class="card__prices">
        <span class="card__price">${rubles(product.price_kopecks)}</span>
        <span class="card__price-old">${rubles(oldPrice)}</span>
      </div>
      <p class="card__stock">${stock > 0 ? `в наличии: ${stock}` : 'нет в наличии'}</p>
      <button class="card__buy" type="button" data-buy>Купить</button>
    </div>
  `;

  return card;
}

async function buy(button, sku) {
  if (isStaticHost()) {
    alert('Покупка идёт через локальный бэкенд. Запустите npm start и откройте http://localhost:3000');
    return;
  }

  const label = button.textContent;
  button.textContent = 'Оформляем...';

  if (!inFlight.has(sku)) inFlight.set(sku, crypto.randomUUID());

  try {
    const order = await api.createOrder(sku, inFlight.get(sku));
    window.location.href = `order.html?id=${encodeURIComponent(order.id)}`;
  } catch (error) {
    inFlight.delete(sku);
    button.textContent = label;
    const offline = error.name === 'TimeoutError' || error.name === 'AbortError'
      || error.message === 'Failed to fetch' || error.name === 'TypeError';
    alert(offline
      ? 'Покупка идёт через локальный бэкенд. Запустите npm start и откройте http://localhost:3000'
      : `Не удалось создать заказ: ${error.message}`);
  }
}

async function loadProducts() {
  if (!isStaticHost()) {
    try {
      return await api.products();
    } catch { /* дальше catalog.json */ }
  }

  const data = await fetch('catalog.json').then((r) => r.json());
  return {
    products: data.products.map((item) => ({
      sku: item.sku,
      name: item.name,
      type: item.type,
      price_kopecks: item.price * 100,
      currency: item.currency,
      image: item.image,
      free_keys: item.sku === 'KEY-CS2-PRIME' ? 50 : 0,
    })),
  };
}

export async function initProducts(rows) {
  const { products } = await loadProducts();

  // Товар с непустым пулом показываем первым: на нём виден основной путь выдачи.
  const ordered = [...products].sort((a, b) => Number(b.free_keys) - Number(a.free_keys));

  const chunks = { popular: ordered.slice(0, 5), recommended: ordered.slice(5, 10) };

  for (const [name, node] of Object.entries(rows)) {
    if (!node) continue;
    node.replaceChildren(...chunks[name].map(cardTemplate));

    node.addEventListener('click', (event) => {
      const button = event.target.closest('[data-buy]');
      if (!button) return;
      buy(button, button.closest('.card').dataset.sku);
    });
  }
}
