/**
 * Service layer ฝั่ง frontend สำหรับเรียก Booking API
 *
 * ค่าเริ่มต้นเรียกผ่าน path แบบ relative (/api/...) ซึ่ง Vite จะ proxy ไปที่ Express
 * ถ้า deploy แยกโดเมน ให้ตั้ง VITE_API_URL เช่น https://api.example.com
 */
const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** Error ที่มีข้อมูลจาก server (status, code, errors, payload) */
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'UNKNOWN', errors = null, payload = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.payload = payload;
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', {
      code: 'NETWORK_ERROR',
    });
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* response ไม่ใช่ JSON */
  }

  if (!res.ok) {
    throw new ApiError(data?.message || `เกิดข้อผิดพลาด (${res.status})`, {
      status: res.status,
      code: data?.code,
      errors: data?.errors ?? null,
      payload: data,
    });
  }
  return data;
}

const qs = (params) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

/** GET /api/services */
export const getServices = (opts) => request('/api/services', opts);

/** GET /api/staff?serviceId= */
export const getStaff = (serviceId, opts) => request(`/api/staff?${qs({ serviceId })}`, opts);

/**
 * GET /api/availability?staffId=&date=&serviceId=
 * @returns {Promise<{ staffId: string, date: string, dayOff: boolean, slots: string[] }>}
 */
export const getAvailability = ({ staffId, date, serviceId }, opts) =>
  request(`/api/availability?${qs({ staffId, date, serviceId })}`, opts);

/**
 * POST /api/bookings
 * @param {{ serviceId, staffId, date, time, customerName, customerPhone, specialRequest }} payload
 */
export const createBooking = (payload) => request('/api/bookings', { method: 'POST', body: payload });

export default { getServices, getStaff, getAvailability, createBooking };
