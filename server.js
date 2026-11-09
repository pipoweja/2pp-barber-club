/**
 * 2PP The Barber Club — Booking API
 * Express + in-memory data store
 *
 * รัน: node server.js  (ค่าเริ่มต้น port 3001)
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

/* ------------------------------------------------------------------ */
/*  In-memory data store                                               */
/* ------------------------------------------------------------------ */
const services = [];
const staff = [];
const bookings = [];

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

/**
 * คำนวณช่วงเวลาว่างของช่างในวันที่กำหนด
 * - อยู่ในเวลาทำการ และบริการต้องเสร็จก่อนปิดร้าน
 * - ตัดช่วงที่ทับกับการจองเดิม (คิดจากระยะเวลาบริการจริง)
 * - ถ้าเป็นวันนี้ ตัดช่วงเวลาที่ผ่านไปแล้วออก
 */
function getAvailableSlots(staffId, date, duration = SLOT_STEP_MIN) {
  const member = findStaff(staffId);
  if (!member) return [];
  if (member.daysOff.includes(dayOfWeek(date))) return [];

  const open = toMinutes(OPEN_TIME);
  const close = toMinutes(CLOSE_TIME);

  const taken = bookings
    .filter((b) => b.staffId === staffId && b.date === date && b.status !== 'cancelled')
    .map((b) => {
      const start = toMinutes(b.time);
      return [start, start + bookingDuration(b)];
    });

  let earliest = open;
  const now = shopNow();
  if (date === formatDate(now)) {
    earliest = Math.max(open, now.getHours() * 60 + now.getMinutes() + 1);
  }

  const slots = [];
  for (let t = open; t + duration <= close; t += SLOT_STEP_MIN) {
    if (t < earliest) continue;
    const clash = taken.some(([s, e]) => overlaps(t, t + duration, s, e));
    if (!clash) slots.push(toHHmm(t));
  }
  return slots;
}

/** ช่วงเวลาที่ยังเหลือในวัน (ไม่สนการจอง) — ใช้แยก "ร้านปิดรับคิวแล้ว" ออกจาก "คิวเต็ม" */
function getAvailableSlotsIgnoringBookings(date, duration = SLOT_STEP_MIN) {
  const open = toMinutes(OPEN_TIME);
  const close = toMinutes(CLOSE_TIME);
  const now = shopNow();
  const earliest = date === formatDate(now) ? now.getHours() * 60 + now.getMinutes() + 1 : open;
  const out = [];
  for (let t = open; t + duration <= close; t += SLOT_STEP_MIN) if (t >= earliest) out.push(toHHmm(t));
  return out;
}

/* ------------------------------------------------------------------ */
/*  Seed data                                                        */
/* ------------------------------------------------------------------ */
function seed() {
  services.push(
    { id: 'svc-cut', name: 'ตัดผม', description: 'ตัดแต่งทรงตามสไตล์ที่ต้องการ', duration: 45, price: 350 },
    { id: 'svc-cut-wash', name: 'ตัด + สระ', description: 'ตัดผมพร้อมสระและนวดศีรษะ', duration: 60, price: 450 },
    { id: 'svc-cut-wash-set', name: 'ตัด + สระ + เซ็ต', description: 'ครบจบพร้อมจัดแต่งทรงด้วยผลิตภัณฑ์พรีเมียม', duration: 75, price: 550 },
    { id: 'svc-shave', name: 'โกนหนวด', description: 'โกนหนวดด้วยผ้าร้อน สไตล์บาร์เบอร์คลาสสิก', duration: 30, price: 250 },
    { id: 'svc-color', name: 'ทำสีผม', description: 'ทำสีผมด้วยผลิตภัณฑ์ถนอมเส้นผม', duration: 120, price: 1500 },
    { id: 'svc-perm', name: 'ยืด / ดัด', description: 'ยืดหรือดัดผม จัดทรงให้อยู่ตัวนาน', duration: 150, price: 1800 }
  );

  staff.push(
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
    }
  );

  // ตัวอย่างการจองเดิม (วันนี้และพรุ่งนี้) เพื่อให้เห็นว่าระบบตัดช่วงที่ไม่ว่างออก
  const today = shopNow();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const sample = [
    { serviceId: 'svc-cut-wash', staffId: 'stf-pui', date: formatDate(today), time: '13:00' },
    { serviceId: 'svc-shave', staffId: 'stf-pui', date: formatDate(today), time: '16:00' },
    { serviceId: 'svc-color', staffId: 'stf-beauty', date: formatDate(today), time: '14:00' },
    { serviceId: 'svc-cut', staffId: 'stf-pui', date: formatDate(tomorrow), time: '11:00' },
    { serviceId: 'svc-perm', staffId: 'stf-beauty', date: formatDate(tomorrow), time: '10:00' },
  ];
  for (const s of sample) {
    const svc = findService(s.serviceId);
    const stf = findStaff(s.staffId);
    bookings.push({
      id: crypto.randomUUID(),
      serviceId: svc.id,
      serviceName: svc.name,
      staffId: stf.id,
      staffName: stf.name,
      date: s.date,
      time: s.time,
      customerName: 'ลูกค้าตัวอย่าง',
      customerPhone: '0800000000',
      specialRequest: '',
      createdAt: new Date().toISOString(),
      status: 'pending',
    });
  }
}
seed();

/* ------------------------------------------------------------------ */
/*  Routes                                                             */
/* ------------------------------------------------------------------ */
app.get('/api/health', (_req, res) => res.json({ ok: true }));

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
app.get('/api/availability', (req, res) => {
  const { staffId, date, serviceId } = req.query;
  if (!staffId || !date) {
    return res.status(400).json({ message: 'ต้องระบุ staffId และ date' });
  }
  if (!findStaff(staffId)) return res.status(404).json({ message: 'ไม่พบช่างที่เลือก' });
  if (!isValidDate(date)) return res.status(400).json({ message: 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)' });

  const svc = serviceId ? findService(serviceId) : null;
  if (serviceId && !svc) return res.status(404).json({ message: 'ไม่พบบริการที่เลือก' });

  const member = findStaff(staffId);
  const dayOff = member.daysOff.includes(dayOfWeek(date));
  const todayStr = formatDate(shopNow());
  const slots = date < todayStr ? [] : getAvailableSlots(staffId, date, svc?.duration);

  // เหตุผลที่ไม่มีช่วงว่าง เพื่อให้หน้าเว็บแสดงข้อความได้ตรง
  let reason = null;
  if (!slots.length) {
    if (date < todayStr) reason = 'past';
    else if (dayOff) reason = 'dayOff';
    else if (date === todayStr && getAvailableSlotsIgnoringBookings(date, svc?.duration).length === 0) reason = 'closed';
    else reason = 'full';
  }

  res.json({ staffId, date, dayOff, reason, slots });
});

// GET /api/bookings — ดูรายการจองทั้งหมด (สำหรับตรวจสอบ/หลังร้าน)
app.get('/api/bookings', (_req, res) => {
  res.json(bookings);
});

// POST /api/bookings — สร้างการจองใหม่
app.post('/api/bookings', (req, res) => {
  const body = req.body ?? {};
  const serviceId = String(body.serviceId ?? '').trim();
  const staffId = String(body.staffId ?? '').trim();
  const date = String(body.date ?? '').trim();
  const time = String(body.time ?? '').trim();
  const customerName = String(body.customerName ?? '').trim();
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

  // 4) ป้องกัน double-booking: เวลาที่ขอต้องอยู่ในรายการช่วงว่างที่คำนวณใหม่ ณ ตอนนี้
  //    (Node.js ทำงาน single-thread และส่วนนี้ไม่มี await จึงไม่มี race ระหว่างตรวจกับบันทึก)
  const free = getAvailableSlots(staffId, date, svc.duration);
  if (!free.includes(time)) {
    const start = toMinutes(time);
    const clash = bookings.some(
      (b) =>
        b.staffId === staffId &&
        b.date === date &&
        b.status !== 'cancelled' &&
        overlaps(start, start + svc.duration, toMinutes(b.time), toMinutes(b.time) + bookingDuration(b))
    );
    return res.status(409).json({
      code: clash ? 'SLOT_TAKEN' : 'SLOT_UNAVAILABLE',
      message: clash
        ? 'ขออภัย ช่วงเวลานี้ถูกจองไปแล้ว กรุณาเลือกเวลาอื่น'
        : 'ช่วงเวลานี้ไม่อยู่ในเวลาให้บริการ กรุณาเลือกเวลาอื่น',
      slots: free,
    });
  }

  // 5) บันทึก
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
  bookings.push(booking);

  res.status(201).json(booking);
});

// 404 สำหรับ /api ที่ไม่มีอยู่
app.use('/api', (_req, res) => res.status(404).json({ message: 'Not found' }));

// error handler (เช่น JSON ผิดรูปแบบ)
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ code: 'BAD_JSON', message: 'รูปแบบข้อมูลไม่ถูกต้อง' });
  }
  console.error(err);
  res.status(500).json({ code: 'SERVER_ERROR', message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' });
});

// ใช้เป็น Vercel Serverless Function ได้ (api/index.js import app ไปใช้)
export default app;

// รันเป็นเซิร์ฟเวอร์ปกติเมื่อสั่ง `node server.js` โดยตรงเท่านั้น
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  app.listen(PORT, () => {
    console.log(`✂  2PP The Barber Club API → http://localhost:${PORT}`);
  });
}
