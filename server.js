/**
 * 2PP The Barber Club — Booking API
 * Express + storage (Upstash Redis ถ้าตั้งค่าไว้ / in-memory ถ้าไม่ได้ตั้ง)
 *
 * รันในเครื่อง: node server.js  (ค่าเริ่มต้น port 3001)
 * บน Vercel:   api/index.js import app นี้ไปใช้เป็น Serverless Function
 *
 * Environment variables
 *   ADMIN_PASSWORD                         รหัสผ่านหน้าหลังร้าน (/admin) — บน Vercel ต้องตั้ง ไม่งั้น login ไม่ได้
 *                                          (รันในเครื่องถ้าไม่ตั้ง จะใช้ "admin1234")
 *   KV_REST_API_URL / KV_REST_API_TOKEN    Upstash Redis (ได้อัตโนมัติเมื่อต่อ Upstash ผ่าน Vercel Marketplace)
 *   UPSTASH_REDIS_REST_URL / _TOKEN        ชื่อแบบ Upstash ตรง ๆ ก็ใช้ได้
 */
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

/* ------------------------------------------------------------------ */
/*  ค่าตั้งร้าน                                                         */
/* ------------------------------------------------------------------ */
const OPEN_TIME = '10:00'; // เวลาเปิดร้าน
const CLOSE_TIME = '20:00'; // เวลาปิดร้าน (บริการต้องเสร็จก่อนเวลานี้)
const SLOT_STEP_MIN = 30; // ระยะห่างระหว่างช่วงเวลาที่ให้เลือก (นาที)
const MAX_ADVANCE_DAYS = 30; // จองล่วงหน้าได้สูงสุดกี่วัน
const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

/* ------------------------------------------------------------------ */
/*  ข้อมูลร้าน (คงที่)                                                  */
/* ------------------------------------------------------------------ */
const services = [
  { id: 'svc-cut', name: 'ตัดผม', description: 'ตัดแต่งทรงตามสไตล์ที่ต้องการ', duration: 45, price: 350 },
  { id: 'svc-cut-wash', name: 'ตัด + สระ', description: 'ตัดผมพร้อมสระและนวดศีรษะ', duration: 60, price: 450 },
  { id: 'svc-cut-wash-set', name: 'ตัด + สระ + เซ็ต', description: 'ครบจบพร้อมจัดแต่งทรงด้วยผลิตภัณฑ์พรีเมียม', duration: 75, price: 550 },
  { id: 'svc-shave', name: 'โกนหนวด', description: 'โกนหนวดด้วยผ้าร้อน สไตล์บาร์เบอร์คลาสสิก', duration: 30, price: 250 },
  { id: 'svc-color', name: 'ทำสีผม', description: 'ทำสีผมด้วยผลิตภัณฑ์ถนอมเส้นผม', duration: 120, price: 1500 },
  { id: 'svc-perm', name: 'ยืด / ดัด', description: 'ยืดหรือดัดผม จัดทรงให้อยู่ตัวนาน', duration: 150, price: 1800 },
];

const staff = [
  {
    id: 'stf-pui',
    name: 'ช่าง PUI',
    title: 'Master Barber',
    avatar: 'https://i.pravatar.cc/240?img=12',
    serviceIds: ['svc-cut', 'svc-cut-wash', 'svc-cut-wash-set', 'svc-shave'],
    daysOff: [3], // หยุดวันพุธ
  },
  {
    id: 'stf-beauty',
    name: 'ช่าง Beauty',
    title: 'Color Specialist',
    avatar: 'https://i.pravatar.cc/240?img=47',
    serviceIds: ['svc-cut', 'svc-cut-wash', 'svc-cut-wash-set', 'svc-color', 'svc-perm'],
    daysOff: [1], // หยุดวันจันทร์
  },
  {
    id: 'stf-tony',
    name: 'ช่าง Tony',
    title: 'Senior Barber',
    avatar: 'https://i.pravatar.cc/240?img=33',
    serviceIds: ['svc-cut', 'svc-cut-wash', 'svc-shave', 'svc-perm'],
    daysOff: [2], // หยุดวันอังคาร
  },
  {
    id: 'stf-mint',
    name: 'ช่าง Mint',
    title: 'Stylist',
    avatar: 'https://i.pravatar.cc/240?img=45',
    serviceIds: ['svc-cut-wash', 'svc-cut-wash-set', 'svc-color'],
    daysOff: [4], // หยุดวันพฤหัสบดี
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toHHmm = (mins) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/**
 * "ตอนนี้" ตามเวลาร้าน (Asia/Bangkok) ไม่ว่าเครื่อง server จะตั้ง timezone อะไร
 * (Vercel รันเป็น UTC) — คืน Date ที่ getHours()/getDate() ฯลฯ ตรงกับเวลาไทย
 * ใช้สำหรับคำนวณวัน/เวลาเท่านั้น ไม่ใช้เป็น timestamp จริง
 */
const SHOP_TZ = 'Asia/Bangkok';
const shopNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: SHOP_TZ }));

/** Date → YYYY-MM-DD (อ่านค่าจาก local getters) */
const formatDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const isValidDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};
const isValidTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const dayOfWeek = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay(); // 0 = อาทิตย์
};

const findService = (id) => services.find((s) => s.id === id);
const findStaff = (id) => staff.find((s) => s.id === id);

/** ระยะเวลาของการจองหนึ่งรายการ (นาที) */
const bookingDuration = (b) => findService(b.serviceId)?.duration ?? SLOT_STEP_MIN;

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/** Express 4 ไม่จับ error จาก async handler เอง — ห่อไว้ส่งต่อให้ error handler */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------------------------------------------------------ */
/*  Storage                                                            */
/*  - Redis (Upstash REST): ข้อมูลถาวร ใช้ร่วมกันทุก instance บน Vercel   */
/*  - Memory: สำหรับรันในเครื่อง/เดโม ข้อมูลหายเมื่อรีสตาร์ท              */
/* ------------------------------------------------------------------ */
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const BOOKINGS_KEY = '2pp:bookings'; // hash: id → booking JSON

async function redis(command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Redis ${command[0]} failed: ${data.error || res.status}`);
  return data.result;
}

const redisStore = {
  kind: 'redis',
  async list() {
    const flat = (await redis(['HGETALL', BOOKINGS_KEY])) || [];
    const out = [];
    for (let i = 1; i < flat.length; i += 2) out.push(JSON.parse(flat[i]));
    return out;
  },
  async get(id) {
    const raw = await redis(['HGET', BOOKINGS_KEY, id]);
    return raw ? JSON.parse(raw) : null;
  },
  async save(booking) {
    await redis(['HSET', BOOKINGS_KEY, booking.id, JSON.stringify(booking)]);
    return booking;
  },
  /** ล็อกข้าม instance ด้วย SET NX PX — กันสองคนจองช่าง/วันเดียวกันพร้อมกัน */
  async withLock(key, fn) {
    const lockKey = `2pp:lock:${key}`;
    const token = crypto.randomUUID();
    const deadline = Date.now() + 5000;
    while ((await redis(['SET', lockKey, token, 'NX', 'PX', '10000'])) !== 'OK') {
      if (Date.now() > deadline) {
        const err = new Error('ระบบกำลังมีผู้ใช้งานจำนวนมาก กรุณาลองใหม่อีกครั้ง');
        err.status = 503;
        throw err;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    try {
      return await fn();
    } finally {
      // ปลดล็อกเฉพาะเมื่อยังเป็นของเราอยู่
      await redis([
        'EVAL',
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        '1',
        lockKey,
        token,
      ]).catch(() => {});
    }
  },
};

const memoryBookings = new Map();
const memoryLocks = new Map();
const memoryStore = {
  kind: 'memory',
  async list() {
    return [...memoryBookings.values()];
  },
  async get(id) {
    return memoryBookings.get(id) ?? null;
  },
  async save(booking) {
    memoryBookings.set(booking.id, booking);
    return booking;
  },
  /** process เดียว: ต่อคิวงานที่ใช้ key เดียวกันให้ทำทีละงาน */
  async withLock(key, fn) {
    const prev = memoryLocks.get(key) ?? Promise.resolve();
    let release;
    const mine = new Promise((r) => (release = r));
    const chain = prev.then(() => mine);
    memoryLocks.set(key, chain);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (memoryLocks.get(key) === chain) memoryLocks.delete(key);
    }
  },
};

const store = REDIS_URL && REDIS_TOKEN ? redisStore : memoryStore;

/** การจองที่ยังกินเวลาช่าง (ไม่นับที่ยกเลิก) ของช่าง/วันนั้น */
async function activeBookingsFor(staffId, date, excludeId = null) {
  const all = await store.list();
  return all.filter((b) => b.staffId === staffId && b.date === date && b.status !== 'cancelled' && b.id !== excludeId);
}

/* ------------------------------------------------------------------ */
/*  Availability                                                       */
/* ------------------------------------------------------------------ */
/**
 * คำนวณช่วงเวลาว่างของช่างในวันที่กำหนด
 * - อยู่ในเวลาทำการ และบริการต้องเสร็จก่อนปิดร้าน
 * - ตัดช่วงที่ทับกับการจองเดิม (คิดจากระยะเวลาบริการจริง)
 * - ถ้าเป็นวันนี้ ตัดช่วงเวลาที่ผ่านไปแล้วออก
 */
function computeSlots(member, date, duration, existing) {
  if (!member || member.daysOff.includes(dayOfWeek(date))) return [];

  const open = toMinutes(OPEN_TIME);
  const close = toMinutes(CLOSE_TIME);
  const taken = existing.map((b) => {
    const start = toMinutes(b.time);
    return [start, start + bookingDuration(b)];
  });

  let earliest = open;
  const now = shopNow();
  if (date === formatDate(now)) earliest = Math.max(open, now.getHours() * 60 + now.getMinutes() + 1);

  const slots = [];
  for (let t = open; t + duration <= close; t += SLOT_STEP_MIN) {
    if (t < earliest) continue;
    if (!taken.some(([s, e]) => overlaps(t, t + duration, s, e))) slots.push(toHHmm(t));
  }
  return slots;
}

/** ช่วงเวลาที่ยังเหลือในวัน (ไม่สนการจอง) — ใช้แยก "ร้านปิดรับคิวแล้ว" ออกจาก "คิวเต็ม" */
function remainingShopSlots(date, duration = SLOT_STEP_MIN) {
  const open = toMinutes(OPEN_TIME);
  const close = toMinutes(CLOSE_TIME);
  const now = shopNow();
  const earliest = date === formatDate(now) ? now.getHours() * 60 + now.getMinutes() + 1 : open;
  const out = [];
  for (let t = open; t + duration <= close; t += SLOT_STEP_MIN) if (t >= earliest) out.push(toHHmm(t));
  return out;
}

/** ตรวจว่าเวลาที่ขอชนกับคิวอื่นไหม → null ถ้าว่าง, ไม่งั้นคืน { status, body } สำหรับตอบ 409 */
function slotConflict({ member, svc, date, time, existing }) {
  const free = computeSlots(member, date, svc.duration, existing);
  if (free.includes(time)) return null;
  const start = toMinutes(time);
  const clash = existing.some((b) =>
    overlaps(start, start + svc.duration, toMinutes(b.time), toMinutes(b.time) + bookingDuration(b))
  );
  return {
    code: clash ? 'SLOT_TAKEN' : 'SLOT_UNAVAILABLE',
    message: clash
      ? 'ขออภัย ช่วงเวลานี้ถูกจองไปแล้ว กรุณาเลือกเวลาอื่น'
      : 'ช่วงเวลานี้ไม่อยู่ในเวลาให้บริการ กรุณาเลือกเวลาอื่น',
    slots: free,
  };
}

/* ------------------------------------------------------------------ */
/*  Admin auth (stateless token ลงลายเซ็น HMAC, อายุ 12 ชม.)            */
/* ------------------------------------------------------------------ */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (process.env.VERCEL ? '' : 'admin1234');
const SESSION_MS = 12 * 60 * 60 * 1000;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const sign = (exp) =>
  crypto.createHmac('sha256', `2pp-admin:${ADMIN_PASSWORD}`).update(String(exp)).digest('base64url');

function issueToken() {
  const exp = Date.now() + SESSION_MS;
  return { token: `${exp}.${sign(exp)}`, expiresAt: new Date(exp).toISOString() };
}

function isValidToken(token) {
  if (!ADMIN_PASSWORD || typeof token !== 'string') return false;
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!exp || exp < Date.now() || !sig) return false;
  const expected = Buffer.from(sign(exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function requireAdmin(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!isValidToken(token)) {
    return res.status(401).json({ code: 'UNAUTHORIZED', message: 'กรุณาเข้าสู่ระบบใหม่' });
  }
  next();
}

/* ------------------------------------------------------------------ */
/*  ข้อมูลตัวอย่าง (เฉพาะโหมด memory)                                    */
/* ------------------------------------------------------------------ */
if (store.kind === 'memory') {
  const today = shopNow();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const sample = [
    { serviceId: 'svc-cut-wash', staffId: 'stf-pui', date: formatDate(today), time: '13:00', status: 'confirmed' },
    { serviceId: 'svc-shave', staffId: 'stf-pui', date: formatDate(today), time: '16:00', status: 'pending' },
    { serviceId: 'svc-color', staffId: 'stf-beauty', date: formatDate(today), time: '14:00', status: 'pending' },
    { serviceId: 'svc-cut', staffId: 'stf-pui', date: formatDate(tomorrow), time: '11:00', status: 'pending' },
    { serviceId: 'svc-perm', staffId: 'stf-beauty', date: formatDate(tomorrow), time: '10:00', status: 'confirmed' },
  ];
  sample.forEach((s, i) => {
    const svc = findService(s.serviceId);
    const stf = findStaff(s.staffId);
    const id = crypto.randomUUID();
    memoryBookings.set(id, {
      id,
      serviceId: svc.id,
      serviceName: svc.name,
      staffId: stf.id,
      staffName: stf.name,
      date: s.date,
      time: s.time,
      customerName: `ลูกค้าตัวอย่าง ${i + 1}`,
      customerPhone: `08000000${String(i + 1).padStart(2, '0')}`,
      specialRequest: i === 0 ? 'ขอทรงสั้นด้านข้าง' : '',
      createdAt: new Date().toISOString(),
      status: s.status,
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Public routes                                                      */
/* ------------------------------------------------------------------ */
app.get('/api/health', (_req, res) => res.json({ ok: true, storage: store.kind }));

// GET /api/services — รายการบริการทั้งหมด
app.get('/api/services', (_req, res) => {
  res.json(services);
});

// GET /api/staff?serviceId= — ช่างที่ทำบริการนั้นได้ (ไม่ส่ง serviceId = ทั้งหมด)
app.get('/api/staff', (req, res) => {
  const { serviceId } = req.query;
  if (serviceId && !findService(serviceId)) {
    return res.status(404).json({ message: 'ไม่พบบริการที่เลือก' });
  }
  const list = serviceId ? staff.filter((s) => s.serviceIds.includes(serviceId)) : staff;
  res.json(list);
});

// GET /api/availability?staffId=&date=[&serviceId=]
// serviceId (ไม่บังคับ) ใช้คำนวณความยาวบริการ เพื่อไม่ให้เวลาที่เสนอไปทับคิวถัดไป
app.get(
  '/api/availability',
  ah(async (req, res) => {
    const { staffId, date, serviceId } = req.query;
    if (!staffId || !date) return res.status(400).json({ message: 'ต้องระบุ staffId และ date' });
    const member = findStaff(staffId);
    if (!member) return res.status(404).json({ message: 'ไม่พบช่างที่เลือก' });
    if (!isValidDate(date)) return res.status(400).json({ message: 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)' });
    const svc = serviceId ? findService(serviceId) : null;
    if (serviceId && !svc) return res.status(404).json({ message: 'ไม่พบบริการที่เลือก' });

    const dayOff = member.daysOff.includes(dayOfWeek(date));
    const todayStr = formatDate(shopNow());
    const duration = svc?.duration ?? SLOT_STEP_MIN;
    const slots =
      date < todayStr || dayOff ? [] : computeSlots(member, date, duration, await activeBookingsFor(staffId, date));

    // เหตุผลที่ไม่มีช่วงว่าง เพื่อให้หน้าเว็บแสดงข้อความได้ตรง
    let reason = null;
    if (!slots.length) {
      if (date < todayStr) reason = 'past';
      else if (dayOff) reason = 'dayOff';
      else if (date === todayStr && remainingShopSlots(date, duration).length === 0) reason = 'closed';
      else reason = 'full';
    }

    res.json({ staffId, date, dayOff, reason, slots });
  })
);

// POST /api/bookings — สร้างการจองใหม่
app.post(
  '/api/bookings',
  ah(async (req, res) => {
    const body = req.body ?? {};
    const serviceId = String(body.serviceId ?? '').trim();
    const staffId = String(body.staffId ?? '').trim();
    const date = String(body.date ?? '').trim();
    const time = String(body.time ?? '').trim();
    const customerName = String(body.customerName ?? '').trim().slice(0, 100);
    const customerPhone = String(body.customerPhone ?? '').replace(/[\s-]/g, '');
    const specialRequest = String(body.specialRequest ?? '').trim().slice(0, 500);

    // 1) ตรวจข้อมูลที่จำเป็น
    const errors = {};
    if (!serviceId) errors.serviceId = 'กรุณาเลือกบริการ';
    if (!staffId) errors.staffId = 'กรุณาเลือกช่าง';
    if (!isValidDate(date)) errors.date = 'กรุณาเลือกวันที่ให้ถูกต้อง';
    if (!isValidTime(time)) errors.time = 'กรุณาเลือกเวลาให้ถูกต้อง';
    if (customerName.length < 2) errors.customerName = 'กรุณากรอกชื่อ-นามสกุล';
    if (!/^0\d{8,9}$/.test(customerPhone)) errors.customerPhone = 'เบอร์โทรไม่ถูกต้อง (เช่น 0812345678)';
    if (Object.keys(errors).length) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'กรุณากรอกข้อมูลให้ครบถ้วน', errors });
    }

    // 2) ตรวจว่าบริการ/ช่างมีอยู่จริงและเข้ากันได้
    const svc = findService(serviceId);
    const member = findStaff(staffId);
    if (!svc) return res.status(404).json({ code: 'NOT_FOUND', message: 'ไม่พบบริการที่เลือก' });
    if (!member) return res.status(404).json({ code: 'NOT_FOUND', message: 'ไม่พบช่างที่เลือก' });
    if (!member.serviceIds.includes(serviceId)) {
      return res.status(400).json({ code: 'STAFF_SERVICE_MISMATCH', message: `${member.name} ไม่ได้ให้บริการ${svc.name}` });
    }

    // 3) ตรวจช่วงวัน
    const todayStr = formatDate(shopNow());
    const limit = shopNow();
    limit.setDate(limit.getDate() + MAX_ADVANCE_DAYS);
    if (date < todayStr) return res.status(400).json({ code: 'PAST_DATE', message: 'ไม่สามารถจองย้อนหลังได้' });
    if (date > formatDate(limit)) {
      return res.status(400).json({ code: 'TOO_FAR', message: `จองล่วงหน้าได้ไม่เกิน ${MAX_ADVANCE_DAYS} วัน` });
    }
    if (member.daysOff.includes(dayOfWeek(date))) {
      return res.status(409).json({ code: 'DAY_OFF', message: `${member.name} หยุดในวันที่เลือก` });
    }

    // 4) ป้องกัน double-booking: ล็อกช่าง+วัน แล้วตรวจกับข้อมูลล่าสุดก่อนบันทึก
    const result = await store.withLock(`${staffId}:${date}`, async () => {
      const conflict = slotConflict({ member, svc, date, time, existing: await activeBookingsFor(staffId, date) });
      if (conflict) return { status: 409, body: conflict };

      const booking = {
        id: crypto.randomUUID(),
        serviceId: svc.id,
        serviceName: svc.name,
        staffId: member.id,
        staffName: member.name,
        date,
        time,
        customerName,
        customerPhone,
        specialRequest,
        createdAt: new Date().toISOString(),
        status: 'pending',
      };
      await store.save(booking);
      return { status: 201, body: booking };
    });

    res.status(result.status).json(result.body);
  })
);

/* ------------------------------------------------------------------ */
/*  Admin routes (หน้าหลังร้าน /admin)                                  */
/* ------------------------------------------------------------------ */
// POST /api/admin/login { password } → { token, expiresAt }
app.post(
  '/api/admin/login',
  ah(async (req, res) => {
    if (!ADMIN_PASSWORD) {
      return res.status(503).json({
        code: 'ADMIN_NOT_CONFIGURED',
        message: 'ยังไม่ได้ตั้งรหัสผ่านหลังร้าน (ADMIN_PASSWORD) บนเซิร์ฟเวอร์',
      });
    }
    const password = String(req.body?.password ?? '');
    const ok = crypto.timingSafeEqual(sha256(password), sha256(ADMIN_PASSWORD));
    if (!ok) {
      await new Promise((r) => setTimeout(r, 600)); // ชะลอการเดารหัส
      return res.status(401).json({ code: 'WRONG_PASSWORD', message: 'รหัสผ่านไม่ถูกต้อง' });
    }
    res.json(issueToken());
  })
);

// GET /api/admin/bookings?date=YYYY-MM-DD  (ไม่ส่ง date = ตั้งแต่วันนี้เป็นต้นไป)
app.get(
  '/api/admin/bookings',
  requireAdmin,
  ah(async (req, res) => {
    const { date } = req.query;
    if (date && !isValidDate(date)) return res.status(400).json({ message: 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)' });
    const todayStr = formatDate(shopNow());
    const list = (await store.list())
      .filter((b) => (date ? b.date === date : b.date >= todayStr))
      .sort((a, b) => (a.date + a.time + a.staffName).localeCompare(b.date + b.time + b.staffName));
    res.json({ storage: store.kind, today: todayStr, bookings: list });
  })
);

// PATCH /api/admin/bookings/:id { status }
app.patch(
  '/api/admin/bookings/:id',
  requireAdmin,
  ah(async (req, res) => {
    const status = String(req.body?.status ?? '');
    if (!BOOKING_STATUSES.includes(status)) {
      return res.status(400).json({ code: 'BAD_STATUS', message: 'สถานะไม่ถูกต้อง' });
    }
    const current = await store.get(req.params.id);
    if (!current) return res.status(404).json({ code: 'NOT_FOUND', message: 'ไม่พบการจองนี้' });

    const result = await store.withLock(`${current.staffId}:${current.date}`, async () => {
      const latest = await store.get(current.id);
      // เปิดคิวที่ยกเลิกไปแล้วกลับมา ต้องเช็กว่าเวลานั้นยังไม่มีคนอื่นจองแทน
      if (latest.status === 'cancelled' && status !== 'cancelled') {
        const others = await activeBookingsFor(latest.staffId, latest.date, latest.id);
        const svc = findService(latest.serviceId) ?? { duration: SLOT_STEP_MIN };
        const start = toMinutes(latest.time);
        const clash = others.some((b) =>
          overlaps(start, start + svc.duration, toMinutes(b.time), toMinutes(b.time) + bookingDuration(b))
        );
        if (clash) {
          return { status: 409, body: { code: 'SLOT_TAKEN', message: 'เวลานี้มีคิวอื่นจองแทนไปแล้ว เปิดคิวนี้กลับไม่ได้' } };
        }
      }
      const updated = { ...latest, status, updatedAt: new Date().toISOString() };
      await store.save(updated);
      return { status: 200, body: updated };
    });

    res.status(result.status).json(result.body);
  })
);

/* ------------------------------------------------------------------ */
/*  Fallbacks                                                          */
/* ------------------------------------------------------------------ */
// 404 สำหรับ /api ที่ไม่มีอยู่
app.use('/api', (_req, res) => res.status(404).json({ message: 'Not found' }));

// error handler (เช่น JSON ผิดรูปแบบ, Redis ล่ม)
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ code: 'BAD_JSON', message: 'รูปแบบข้อมูลไม่ถูกต้อง' });
  }
  if (err.status === 503) return res.status(503).json({ code: 'BUSY', message: err.message });
  console.error(err);
  res.status(500).json({ code: 'SERVER_ERROR', message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' });
});

// ใช้เป็น Vercel Serverless Function ได้ (api/index.js import app ไปใช้)
export default app;

// รันเป็นเซิร์ฟเวอร์ปกติเมื่อสั่ง `node server.js` โดยตรงเท่านั้น
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  app.listen(PORT, () => {
    console.log(`✂  2PP The Barber Club API → http://localhost:${PORT}  (storage: ${store.kind})`);
    if (!process.env.ADMIN_PASSWORD) console.log('   admin password (dev default): admin1234');
  });
}
