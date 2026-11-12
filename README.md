# ✂ 2PP The Barber Club — ระบบจองคิว

Web App จองคิวร้านบาร์เบอร์/สปา แบบ Mobile-First (React + Vite + Tailwind) พร้อม Express API
และหน้าหลังร้าน (`/admin`) สำหรับเจ้าของ/พนักงาน

## เริ่มใช้งาน

```bash
npm install
npm run dev        # รัน API (http://localhost:3001) + Frontend (http://localhost:5173) พร้อมกัน
```

- หน้าจองคิว: http://localhost:5173
- หน้าหลังร้าน: http://localhost:5173/admin — รันในเครื่องโดยไม่ตั้ง `ADMIN_PASSWORD` รหัสผ่านคือ `admin1234`

หรือแยกรัน: `npm run server` และ `npm run client`

## โครงสร้าง

| ไฟล์ | หน้าที่ |
| --- | --- |
| `server.js` | Express API, ข้อมูลร้าน, storage (Redis/memory), ล็อกกันจองซ้ำ, admin auth |
| `api/index.js` | ตัวเชื่อมให้ Vercel รัน `server.js` เป็น Serverless Function |
| `src/api/bookingService.js` | Service layer ฝั่งลูกค้า (fetch + `ApiError`) |
| `src/api/adminService.js` | Service layer หน้าหลังร้าน (login, รายการคิว, เปลี่ยนสถานะ) |
| `src/App.jsx` | หน้าจองคิวของลูกค้า |
| `src/admin/AdminApp.jsx` | หน้าหลังร้าน `/admin` |
| `vite.config.js` | proxy `/api` → `localhost:3001` |

## API

| Method | Path | คำอธิบาย |
| --- | --- | --- |
| GET | `/api/services` | บริการทั้งหมด |
| GET | `/api/staff?serviceId=` | ช่างที่ทำบริการนั้นได้ |
| GET | `/api/availability?staffId=&date=[&serviceId=]` | ช่วงเวลาว่าง + `reason` (`closed`/`dayOff`/`full`/`past`) |
| POST | `/api/bookings` | สร้างการจอง — 400 ข้อมูลไม่ครบ, 409 เวลาชน (`SLOT_TAKEN`) |
| POST | `/api/admin/login` | `{ password }` → `{ token, expiresAt }` (อายุ 12 ชม.) |
| GET | `/api/admin/bookings?date=` | 🔒 รายการคิวของวันนั้น (ไม่ส่ง date = ตั้งแต่วันนี้) |
| PATCH | `/api/admin/bookings/:id` | 🔒 `{ status }` = `pending` / `confirmed` / `completed` / `cancelled` |

🔒 = ต้องส่ง `Authorization: Bearer <token>`
สถานะ `cancelled` คืนช่วงเวลาให้คนอื่นจองได้ทันที; เปิดคิวที่ยกเลิกกลับมาได้ถ้าเวลานั้นยังว่าง

## Environment variables

| ชื่อ | ใช้ทำอะไร |
| --- | --- |
| `ADMIN_PASSWORD` | รหัสผ่านหน้าหลังร้าน — **บน Vercel ต้องตั้ง** ไม่งั้นเข้าหลังร้านไม่ได้ |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis (Vercel ตั้งให้อัตโนมัติเมื่อต่อ Upstash จาก Marketplace) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | ใช้แทนชุดบนได้ ถ้าสร้าง Upstash เอง |

ถ้าไม่ได้ตั้ง Redis ระบบจะเก็บการจองในหน่วยความจำ (มีข้อมูลตัวอย่างให้) — รีสตาร์ทแล้วหาย
และหน้าหลังร้านจะขึ้นแถบเตือนสีเหลือง

## Deploy บน Vercel

1. **ต่อฐานข้อมูล:** Vercel Dashboard → โปรเจกต์ → **Storage** → **Create / Connect** → เลือก **Upstash (Redis)** → แผนฟรี → Connect กับโปรเจกต์นี้
2. **ตั้งรหัสหลังร้าน:** Settings → **Environment Variables** → เพิ่ม `ADMIN_PASSWORD` (ตั้งรหัสที่เดายาก)
3. **Redeploy** (Deployments → ⋯ → Redeploy) เพื่อให้ค่าใหม่มีผล

รายละเอียดอื่น
- `vercel.json` rewrite `/api/*` → function และ `/admin` → หน้าเว็บ
- คำนวณ "วันนี้/เวลาตอนนี้" ตามเวลาไทย (`Asia/Bangkok`) เสมอ แม้ server ของ Vercel จะเป็น UTC
- กันจองซ้ำข้าม instance ด้วยล็อกใน Redis (`SET NX PX`) ต่อช่าง+วัน
