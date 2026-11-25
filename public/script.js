'use strict';

/* ---------- Дані ---------- */
let MENU = [];

// Захист від XSS: дані з бази екрануються перед вставкою в HTML
const esc = (text) => String(text).replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

const state = { category: 'all', lactoseFree: false, cart: {} };

/* ---------- Елементи ---------- */
const $ = (selector) => document.querySelector(selector);
const burger = $('#burger');
const nav = $('#nav');
const tabs = $('#tabs');
const lactoseBox = $('#lactoseFree');
const menuGrid = $('#menuGrid');
const emptyBox = $('#empty');
const cartList = $('#cartList');
const cartTotal = $('#cartTotal');
const cartCount = $('#cartCount');
const form = $('#orderForm');
const statusBox = $('#formStatus');

/* ---------- 1. Навігація ---------- */
burger.addEventListener('click', () => {
  const open = nav.classList.toggle('nav--open');
  burger.setAttribute('aria-expanded', String(open));
});

// Делегування: один обробник на всі посилання меню
nav.addEventListener('click', (event) => {
  if (event.target.closest('.nav__link')) {
    nav.classList.remove('nav--open');
    burger.setAttribute('aria-expanded', 'false');
  }
});

// Підсвічування активного розділу під час прокручування
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    document.querySelectorAll('.nav__link').forEach((link) => {
      link.classList.toggle('nav__link--active', link.getAttribute('href') === `#${entry.target.id}`);
    });
  });
}, { rootMargin: '-40% 0px -55% 0px' });
document.querySelectorAll('main section[id]').forEach((section) => sectionObserver.observe(section));

/* ---------- 2. Динамічне меню та фільтри (компонент 1) ---------- */
function renderMenu() {
  const items = MENU.filter((item) =>
    (state.category === 'all' || item.category === state.category) &&
    (!state.lactoseFree || item.lactoseFree));

  menuGrid.innerHTML = items.map((item) => `
    <article class="card">
      <h3>${esc(item.name)} <span class="price">${item.price} ₴</span></h3>
      <p>${esc(item.desc)}</p>
      <span class="tag">${item.lactoseFree ? 'Без лактози' : 'Містить лактозу'}</span>
      <button class="btn" data-add="${item.id}">Додати</button>
    </article>`).join('');

  emptyBox.hidden = items.length > 0;
}

tabs.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-category]');
  if (!tab) return;
  state.category = tab.dataset.category;
  tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('tab--active', t === tab));
  renderMenu();
});

lactoseBox.addEventListener('change', () => {
  state.lactoseFree = lactoseBox.checked;
  renderMenu();
});

$('#resetFilters').addEventListener('click', () => {
  state.category = 'all';
  state.lactoseFree = false;
  lactoseBox.checked = false;
  tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('tab--active', t.dataset.category === 'all'));
  renderMenu();
});

/* ---------- 3. Кошик (компонент 2) ---------- */
menuGrid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-add]');
  if (!button) return;
  const id = button.dataset.add;
  state.cart[id] = (state.cart[id] || 0) + 1;
  renderCart();
});

cartList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = button.dataset.id;
  state.cart[id] += button.dataset.action === 'inc' ? 1 : -1;
  if (state.cart[id] <= 0) delete state.cart[id];
  renderCart();
});

function renderCart() {
  const rows = Object.entries(state.cart).map(([id, qty]) => ({
    item: MENU.find((m) => m.id === Number(id)),
    qty
  }));

  cartList.innerHTML = rows.length
    ? rows.map(({ item, qty }) => `
      <li class="cart__row">
        <span>${esc(item.name)}</span>
        <span class="qty">
          <button type="button" data-action="dec" data-id="${item.id}" aria-label="Зменшити кількість">−</button>
          ${qty}
          <button type="button" data-action="inc" data-id="${item.id}" aria-label="Збільшити кількість">+</button>
        </span>
        <span>${item.price * qty} ₴</span>
      </li>`).join('')
    : '<li class="cart__empty">Кошик порожній. Додайте напій із меню.</li>';

  cartTotal.textContent = rows.reduce((sum, { item, qty }) => sum + item.price * qty, 0);
  cartCount.textContent = rows.reduce((sum, { qty }) => sum + qty, 0);
}

/* ---------- 4. Валідація форми ---------- */
const nowMinutes = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};
// Якщо до закриття менше 10 хвилин або кав’ярня вже зачинена, замовлення оформлюється на завтра
const isTomorrowOrder = () => nowMinutes() + 10 > 21 * 60;

const validators = {
  name(value) {
    return value.trim().length >= 2 ? '' : 'Вкажіть ім’я (щонайменше 2 символи).';
  },
  phone(value) {
    const digits = value.replace(/[\s()-]/g, '');
    return /^\+?380\d{9}$/.test(digits) ? '' : 'Введіть номер у форматі +380501234567.';
  },
  time(value) {
    if (!value) return 'Оберіть час самовивозу.';
    const [h, m] = value.split(':').map(Number);
    const minutes = h * 60 + m;
    if (minutes < 8 * 60 || minutes > 21 * 60) return 'Кав’ярня працює з 08:00 до 21:00.';
    if (!isTomorrowOrder() && minutes < nowMinutes() + 10) {
      return 'Оберіть час щонайменше через 10 хвилин від поточного.';
    }
    return '';
  }
};

function validateField(name) {
  const input = form.elements[name];
  const message = validators[name](input.value);
  form.querySelector(`[data-error="${name}"]`).textContent = message;
  input.classList.toggle('invalid', Boolean(message));
  input.setAttribute('aria-invalid', String(Boolean(message)));
  return !message;
}

form.addEventListener('focusout', (event) => {
  if (validators[event.target.name]) validateField(event.target.name);
});

form.addEventListener('input', (event) => {
  if (event.target.classList.contains('invalid')) validateField(event.target.name);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fieldsValid = Object.keys(validators).map(validateField).every(Boolean);

  if (!Object.keys(state.cart).length) {
    return showStatus('Додайте хоча б одну позицію до кошика.', false);
  }
  if (!fieldsValid) {
    return showStatus('Виправте поля, позначені червоним.', false);
  }

  const time = form.elements.time.value;
  const day = isTomorrowOrder() ? 'завтра ' : '';
  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.elements.name.value.trim(),
        phone: form.elements.phone.value,
        pickupTime: time,
        tomorrow: isTomorrowOrder(),
        items: Object.entries(state.cart).map(([id, qty]) => ({ id: Number(id), qty }))
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Помилка сервера.');
    showStatus(`Замовлення №${data.id} прийнято. Сума: ${data.total} ₴. Чекаємо на вас ${day}о ${time}.`, true);
    state.cart = {};
    renderCart();
    form.reset();
  } catch (error) {
    showStatus(`Не вдалося оформити замовлення: ${error.message}`, false);
  }
});

function showStatus(text, ok) {
  statusBox.textContent = text;
  statusBox.className = `status ${ok ? 'status--ok' : 'status--error'}`;
}

/* ---------- Початковий стан ---------- */
async function loadMenu() {
  try {
    const response = await fetch('/api/menu');
    if (!response.ok) throw new Error('Помилка завантаження меню.');
    MENU = await response.json();
    renderMenu();
  } catch (error) {
    menuGrid.innerHTML = '<p>Не вдалося завантажити меню. Оновіть сторінку.</p>';
  }
}

loadMenu();
renderCart();
