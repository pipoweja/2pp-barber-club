/**
 * Service layer ของหน้าหลังร้าน (/admin)
 * เก็บ token ไว้ใน sessionStorage (ปิดแท็บแล้วต้อง login ใหม่)
 */
import { ApiError } from './bookingService';

const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const TOKEN_KEY = '2pp-admin-token';

export const tokenStore = {
  get() {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode ฯลฯ — ใช้ได้แค่ในหน้านี้ */
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

async function request(path, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้', { code: 'NETWORK_ERROR' });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.message || `เกิดข้อผิดพลาด (${res.status})`, {
      status: res.status,
      code: data?.code,
      payload: data,
    });
  }
  return data;
}

/** POST /api/admin/login → { token, expiresAt } */
export const login = (password) => request('/api/admin/login', { method: 'POST', body: { password } });

/** GET /api/admin/bookings?date= → { storage, today, bookings } */
export const listBookings = (token, date) =>
  request(`/api/admin/bookings${date ? `?date=${encodeURIComponent(date)}` : ''}`, { token });

/** PATCH /api/admin/bookings/:id { status } */
export const updateStatus = (token, id, status) =>
  request(`/api/admin/bookings/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status }, token });
