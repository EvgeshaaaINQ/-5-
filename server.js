'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN; // секрет зберігається у змінних середовища
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'cozybean.db');
const CATEGORIES = ['coffee', 'tea', 'dessert'];
const STATUSES = ['Прийнято', 'Готується', 'Готово', 'Видано'];

/* ---------- База даних ---------- */
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price > 0),
    category TEXT NOT NULL,
    lactose_free INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    pickup_time TEXT NOT NULL,
    tomorrow INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'Прийнято',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    price INTEGER NOT NULL,
    qty INTEGER NOT NULL
  );
`);

if (db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n === 0) {
  const seed = db.prepare(
    'INSERT INTO menu_items (name, price, category, lactose_free, description) VALUES (?, ?, ?, ?, ?)'
  );
  [
    ['Капучино', 85, 'coffee', 0, 'Еспресо, шовковисте молоко та ніжна пінка.'],
    ['Флет вайт', 95, 'coffee', 0, 'Подвійне еспресо з тонким шаром молочної пінки.'],
    ['Фільтр-кава', 75, 'coffee', 1, 'Зерно Ефіопія, ноти бергамоту й чорниці.'],
    ['Матча-лате на вівсяному', 110, 'tea', 1, 'Японська матча з вівсяним молоком.'],
    ['Чай із чебрецем', 60, 'tea', 1, 'Чорний чай із чебрецем і медом.'],
    ['Круасан', 70, 'dessert', 0, 'Масляний круасан, випечений зранку.'],
    ['Веганський брауні', 80, 'dessert', 1, 'Шоколадний брауні без молока й яєць.']
  ].forEach((row) => seed.run(...row));
}

const toDto = (row) => ({
  id: row.id,
  name: row.name,
  price: row.price,
  category: row.category,
  lactoseFree: Boolean(row.lactose_free),
  desc: row.description
});

/* ---------- Застосунок ---------- */
const app = express();
app.use(helmet({
  contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null } }
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN || req.get('x-admin-token') !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Потрібна авторизація адміністратора.' });
  }
  next();
}

function validateItem(body) {
  const { name, price, category, lactoseFree, desc } = body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) {
    return 'Назва має містити від 2 до 60 символів.';
  }
  if (!Number.isInteger(price) || price < 1 || price > 10000) return 'Ціна має бути цілим числом від 1 до 10000.';
  if (!CATEGORIES.includes(category)) return 'Невідома категорія.';
  if (typeof lactoseFree !== 'boolean') return 'Поле «Без лактози» має бути true або false.';
  if (typeof desc !== 'string' || desc.length > 200) return 'Опис має бути не довшим за 200 символів.';
  return '';
}

/* ---------- REST API: меню (CRUD) ---------- */
app.get('/api/menu', (req, res) => {
  res.json(db.prepare('SELECT * FROM menu_items ORDER BY id').all().map(toDto));
});

app.post('/api/menu', requireAdmin, (req, res) => {
  const error = validateItem(req.body);
  if (error) return res.status(400).json({ error });
  const { name, price, category, lactoseFree, desc } = req.body;
  const info = db.prepare(
    'INSERT INTO menu_items (name, price, category, lactose_free, description) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), price, category, lactoseFree ? 1 : 0, desc);
  const row = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(toDto(row));
});

app.put('/api/menu/:id', requireAdmin, (req, res) => {
  const error = validateItem(req.body);
  if (error) return res.status(400).json({ error });
  const { name, price, category, lactoseFree, desc } = req.body;
  const info = db.prepare(
    'UPDATE menu_items SET name = ?, price = ?, category = ?, lactose_free = ?, description = ? WHERE id = ?'
  ).run(name.trim(), price, category, lactoseFree ? 1 : 0, desc, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Позицію не знайдено.' });
  res.json(toDto(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id)));
});

app.delete('/api/menu/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Позицію не знайдено.' });
  res.status(204).end();
});

/* ---------- REST API: замовлення ---------- */
const insertOrder = db.prepare(
  'INSERT INTO orders (name, phone, pickup_time, tomorrow, total) VALUES (?, ?, ?, ?, ?)'
);
const insertLine = db.prepare(
  'INSERT INTO order_items (order_id, item_name, price, qty) VALUES (?, ?, ?, ?)'
);
const createOrder = db.transaction((order, lines) => {
  const orderId = insertOrder.run(order.name, order.phone, order.pickupTime, order.tomorrow ? 1 : 0, order.total)
    .lastInsertRowid;
  lines.forEach((line) => insertLine.run(orderId, line.name, line.price, line.qty));
  return orderId;
});

app.post('/api/orders', (req, res) => {
  const { name, phone, pickupTime, tomorrow, items } = req.body || {};
  const cleanPhone = typeof phone === 'string' ? phone.replace(/[\s()-]/g, '') : '';

  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) {
    return res.status(400).json({ error: 'Вкажіть ім’я (від 2 до 60 символів).' });
  }
  if (!/^\+?380\d{9}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'Невірний формат телефону.' });
  }
  if (typeof pickupTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(pickupTime)) {
    return res.status(400).json({ error: 'Невірний формат часу.' });
  }
  const minutes = Number(pickupTime.slice(0, 2)) * 60 + Number(pickupTime.slice(3));
  if (minutes < 8 * 60 || minutes > 21 * 60) {
    return res.status(400).json({ error: 'Кав’ярня працює з 08:00 до 21:00.' });
  }
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) {
    return res.status(400).json({ error: 'Кошик порожній або занадто великий.' });
  }

  // Ціни беруться з бази, а не з запиту клієнта
  const lines = [];
  for (const entry of items) {
    if (!entry || !Number.isInteger(entry.id) || !Number.isInteger(entry.qty) || entry.qty < 1 || entry.qty > 20) {
      return res.status(400).json({ error: 'Некоректна позиція в кошику.' });
    }
    const row = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(entry.id);
    if (!row) return res.status(400).json({ error: 'Одна з позицій більше недоступна.' });
    lines.push({ name: row.name, price: row.price, qty: entry.qty });
  }

  const total = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  const id = createOrder({ name: name.trim(), phone: cleanPhone, pickupTime, tomorrow: tomorrow === true, total }, lines);
  res.status(201).json({ id, total });
});

app.get('/api/orders', requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT o.*, group_concat(oi.item_name || ' ×' || oi.qty, ', ') AS items
    FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
    GROUP BY o.id ORDER BY o.id DESC
  `).all());
});

app.patch('/api/orders/:id', requireAdmin, (req, res) => {
  const status = req.body && req.body.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Невідомий статус.' });
  const info = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Замовлення не знайдено.' });
  res.json({ id: Number(req.params.id), status });
});

/* ---------- Помилки ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Маршрут не знайдено.' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const bad = err.type === 'entity.parse.failed' || err.type === 'entity.too.large';
  res.status(bad ? 400 : 500).json({ error: bad ? 'Некоректний запит.' : 'Помилка сервера.' });
});

app.listen(PORT, () => console.log(`Cozy Bean: http://localhost:${PORT}`));
