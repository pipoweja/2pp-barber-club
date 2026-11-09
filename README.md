# ✂ 2PP The Barber Club — ระบบจองคิว

Web App จองคิวร้านบาร์เบอร์/สปา แบบ Mobile-First (React + Vite + Tailwind) พร้อม Express API แบบ in-memory

## เริ่มใช้งาน

```bash
npm install
npm run dev        # รัน API (http://localhost:3001) + Frontend (http://localhost:5173) พร้อมกัน
```

หรือแยกรัน: `npm run server` และ `npm run client`

## โครงสร้าง

| ไฟล์ | หน้าที่ |
| --- | --- |
| `server.js` | Express API + in-memory store (`services`, `staff`, `bookings`) + seed data |
| `src/api/bookingService.js` | Service layer เรียก API ด้วย fetch + `ApiError` |
| `src/App.jsx` | UI ทั้งหมด, state, modal ยืนยัน |
| `vite.config.js` | proxy `/api` → `localhost:3001` |

## API

| Method | Path | คำอธิบาย |
| --- | --- | --- |
| GET | `/api/services` | บริการทั้งหมด |
| GET | `/api/staff?serviceId=` | ช่างที่ทำบริการนั้นได้ |
| GET | `/api/availability?staffId=&date=[&serviceId=]` | ช่วงเวลาว่าง (ตัดช่วงที่ทับคิวเดิม, ช่วงที่ผ่านไปแล้ว, วันหยุดช่าง) |
| POST | `/api/bookings` | สร้างการจอง — 400 ข้อมูลไม่ครบ, 409 เวลาชน (`SLOT_TAKEN`) |
| GET | `/api/bookings` | ดูการจองทั้งหมด (ตรวจสอบ) |

## Deploy บน Vercel

- `api/index.js` ส่งต่อทุก request `/api/*` ให้ Express app ใน `server.js` (rewrite อยู่ใน `vercel.json`)
- Frontend build ด้วย `npm run build` → `dist/`
- คำนวณ "วันนี้/เวลาตอนนี้" ตามเวลาไทย (`Asia/Bangkok`) เสมอ แม้ server ของ Vercel จะเป็น UTC
- ⚠️ ข้อมูลการจองยังเก็บใน memory: บน Vercel แต่ละ instance มีข้อมูลแยกกันและหายเมื่อ function ถูกปลุกใหม่ (cold start)
  การจองจริงจึงอาจหาย/ไม่เห็นกันข้าม instance — ถ้าจะใช้งานจริงควรต่อฐานข้อมูล (เช่น Vercel Postgres/Neon, Upstash Redis)

หมายเหตุ: `serviceId` ใน availability เป็นตัวเลือกเสริม ใช้คำนวณความยาวบริการ เพื่อไม่ให้เสนอเวลาที่บริการยาวจะไปทับคิวถัดไป
ข้อมูลอยู่ในหน่วยความจำ — รีสตาร์ท server แล้วการจองจะหายไป
