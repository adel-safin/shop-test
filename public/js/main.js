import { initCarousel } from './carousel.js';
import { initCatalogMenu } from './catalog-menu.js';
import { initCurrencySwitch } from './currency.js';
import { initProducts } from './products.js';

initCarousel(document.querySelector('[data-carousel]'));

initCatalogMenu(
  document.querySelector('[data-catalog-toggle]'),
  document.querySelector('[data-catalog-menu]'),
);

initCurrencySwitch(document.querySelector('[data-currency]'));

initProducts({
  popular: document.querySelector('[data-products="popular"]'),
  recommended: document.querySelector('[data-products="recommended"]'),
}).catch((error) => console.error('каталог не загрузился', error));
