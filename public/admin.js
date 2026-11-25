'use strict';

const STATUSES = ['Прийнято', 'Готується', 'Готово', 'Видано'];
const tokenInput = document.querySelector('#token');
const message = document.querySelector('#msg');
const panel = document.querySelector('#panel');
const ordersBox = document.querySelector('#orders');
const menuList = document.querySelector('#menuList');
const addForm = document.querySelector('#addForm');

function show(text, ok) {
  message.textContent = text;
  message.className = `status ${ok ? 'status--ok' : 'status--error'}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-admin-token': tokenInput.value }
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data.error || 'Помилка запиту.');
  return data;
}

// Усі дані виводяться через textContent, тому HTML із бази не виконується
function cell(row, text) {
  const td = document.createElement('td');
  td.textContent = text;
  row.append(td);
  return td;
}

function renderOrders(orders) {
  ordersBox.replaceChildren();
  if (!orders.length) {
    ordersBox.textContent = 'Замовлень поки немає.';
    return;
  }
  const table = document.createElement('table');
  const head = table.insertRow();
  ['№', 'Клієнт', 'Телефон', 'Час', 'Склад', 'Сума', 'Статус'].forEach((title) => {
    const th = document.createElement('th');
    th.textContent = title;
    head.append(th);
  });
  orders.forEach((order) => {
    const row = table.insertRow();
    cell(row, order.id);
    cell(row, order.name);
    cell(row, order.phone);
    cell(row, `${order.tomorrow ? 'завтра ' : ''}${order.pickup_time}`);
    cell(row, order.items || '');
    cell(row, `${order.total} ₴`);
    const select = document.createElement('select');
    STATUSES.forEach((status) => select.add(new Option(status, status, false, status === order.status)));
    select.addEventListener('change', async () => {
      try {
        await api(`/api/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) });
        show(`Статус замовлення №${order.id} змінено на «${select.value}».`, true);
      } catch (error) {
        show(error.message, false);
      }
    });
    row.insertCell().append(select);
  });
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.append(table);
  ordersBox.append(wrap);
}

function renderMenu(items) {
  menuList.replaceChildren();
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = `${item.name} — ${item.price} ₴ (${item.category}${item.lactoseFree ? ', без лактози' : ''}) `;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--light';
    button.textContent = 'Видалити';
    button.addEventListener('click', async () => {
      try {
        await api(`/api/menu/${item.id}`, { method: 'DELETE' });
        show(`Позицію «${item.name}» видалено.`, true);
        loadAll();
      } catch (error) {
        show(error.message, false);
      }
    });
    li.append(button);
    menuList.append(li);
  });
}

async function loadAll() {
  const [orders, menu] = await Promise.all([api('/api/orders'), api('/api/menu')]);
  renderOrders(orders);
  renderMenu(menu);
  panel.hidden = false;
}

document.querySelector('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await loadAll();
    show('Вхід виконано.', true);
  } catch (error) {
    panel.hidden = true;
    show(error.message, false);
  }
});

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(addForm);
  try {
    await api('/api/menu', {
      method: 'POST',
      body: JSON.stringify({
        name: data.get('name'),
        price: Number(data.get('price')),
        category: data.get('category'),
        lactoseFree: data.get('lactoseFree') === 'on',
        desc: data.get('desc')
      })
    });
    addForm.reset();
    show('Позицію додано.', true);
    loadAll();
  } catch (error) {
    show(error.message, false);
  }
});
