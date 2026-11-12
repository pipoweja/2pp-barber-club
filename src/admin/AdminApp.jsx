import { useCallback, useEffect, useMemo, useState } from 'react';
import { getServices, getStaff } from '../api/bookingService';
import { login, listBookings, updateStatus, tokenStore } from '../api/adminService';

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */
const TH_DAY_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const cx = (...c) => c.filter(Boolean).join(' ');

const toISODate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISODate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const formatThaiFullDate = (iso) => {
  const d = parseISODate(iso);
  return `${d.toLocaleDateString('th-TH', { weekday: 'long' })}ที่ ${d.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })}`;
};
const formatPrice = (n) => `฿${Number(n).toLocaleString('th-TH')}`;
const formatPhone = (p) => (p?.length === 10 ? `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}` : p);
const addMinutes = (hhmm, mins) => {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + mins;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

function buildDates(count) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return { iso: toISODate(d), day: TH_DAY_SHORT[d.getDay()], date: d.getDate(), isToday: i === 0 };
  });
}

const STATUS = {
  pending: { label: 'รอยืนยัน', badge: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  confirmed: { label: 'ยืนยันแล้ว', badge: 'bg-[#061257]/5 text-[#061257] ring-[#061257]/20', dot: 'bg-[#061257]' },
  completed: { label: 'เสร็จสิ้น', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  cancelled: { label: 'ยกเลิก', badge: 'bg-gray-100 text-gray-500 ring-gray-200', dot: 'bg-gray-400' },
};

/* ================================================================== */
/*  Icons                                                              */
/* ================================================================== */
const ScissorsIcon = ({ className = 'h-6 w-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </svg>
);
const RefreshIcon = ({ className = 'h-5 w-5', spinning }) => (
  <svg className={cx(className, spinning && 'animate-spin')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);
const LogoutIcon = ({ className = 'h-5 w-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </svg>
);
const PhoneIcon = ({ className = 'h-4 w-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
  </svg>
);
const AlertIcon = ({ className = 'h-5 w-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4.5M12 16h.01" />
  </svg>
);
const Spinner = ({ className = 'h-5 w-5' }) => (
  <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

/* ================================================================== */
/*  Login                                                              */
/* ================================================================== */
function LoginScreen({ onLoggedIn }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setError('');
    try {
      const { token } = await login(password);
      tokenStore.set(token);
      onLoggedIn(token);
    } catch (err) {
      setError(err.message);
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-white px-5">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#061257] text-white shadow-lg shadow-[#061257]/20">
            <ScissorsIcon className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-semibold text-[#061257]">
            2PP <span className="font-light text-gray-900">The Barber Club</span>
          </h1>
          <p className="mt-1 text-sm text-gray-500">ระบบหลังร้าน — สำหรับเจ้าของและพนักงาน</p>
        </div>

        <label htmlFor="admin-password" className="mb-1.5 block text-sm font-medium text-gray-700">
          รหัสผ่าน
        </label>
        <input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-12 w-full rounded-xl border border-gray-100 bg-gray-50 px-4 text-base outline-none transition focus:border-[#061257] focus:bg-white focus:ring-4 focus:ring-[#061257]/10"
          placeholder="••••••••"
        />
        {error && (
          <p role="alert" className="mt-2 flex items-center gap-1.5 text-sm text-red-600">
            <AlertIcon className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}
        <button
          type="submit"
          disabled={!password || loading}
          className={cx(
            'mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold transition',
            password && !loading ? 'bg-[#061257] text-white shadow-lg shadow-[#061257]/20 active:scale-[0.99]' : 'bg-gray-100 text-gray-400'
          )}
        >
          {loading ? (
            <>
              <Spinner /> กำลังเข้าสู่ระบบ...
            </>
          ) : (
            'เข้าสู่ระบบ'
          )}
        </button>
        <a href="/" className="mt-6 block text-center text-sm text-gray-400 underline-offset-2 hover:underline">
          ← กลับหน้าจองคิว
        </a>
      </form>
    </div>
  );
}

/* ================================================================== */
/*  Booking card                                                       */
/* ================================================================== */
function BookingCard({ booking, service, busy, onChange }) {
  const st = STATUS[booking.status] ?? STATUS.pending;
  const end = service ? addMinutes(booking.time, service.duration) : null;
  const cancelled = booking.status === 'cancelled';

  const actions = {
    pending: [
      { to: 'confirmed', label: 'ยืนยันคิว', primary: true },
      { to: 'cancelled', label: 'ยกเลิก', confirm: true },
    ],
    confirmed: [
      { to: 'completed', label: 'เสร็จสิ้น', primary: true },
      { to: 'cancelled', label: 'ยกเลิก', confirm: true },
    ],
    completed: [{ to: 'confirmed', label: 'ย้อนเป็นยืนยันแล้ว' }],
    cancelled: [{ to: 'pending', label: 'เปิดคิวคืน' }],
  }[booking.status] ?? [];

  return (
    <article className={cx('rounded-2xl border bg-white p-4 shadow-sm', cancelled ? 'border-gray-100 opacity-60' : 'border-gray-100')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className={cx('text-2xl font-semibold tabular-nums', cancelled ? 'text-gray-400 line-through' : 'text-[#061257]')}>
            {booking.time}
          </span>
          {end && <span className="text-xs text-gray-400 tabular-nums">– {end} น.</span>}
        </div>
        <span className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1', st.badge)}>
          <span className={cx('h-1.5 w-1.5 rounded-full', st.dot)} />
          {st.label}
        </span>
      </div>

      <p className="mt-2 text-base font-medium text-gray-900">{booking.customerName}</p>
      <a
        href={`tel:${booking.customerPhone}`}
        className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-[#061257] underline-offset-2 hover:underline"
      >
        <PhoneIcon className="h-3.5 w-3.5" />
        <span className="tabular-nums">{formatPhone(booking.customerPhone)}</span>
      </a>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600">
        <span className="font-medium text-gray-900">{booking.serviceName}</span>
        <span className="text-gray-300">·</span>
        <span>{booking.staffName}</span>
        {service && (
          <>
            <span className="text-gray-300">·</span>
            <span>{formatPrice(service.price)}</span>
          </>
        )}
      </div>

      {booking.specialRequest && (
        <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">
          <span className="text-gray-400">หมายเหตุ: </span>
          {booking.specialRequest}
        </p>
      )}

      {actions.length > 0 && (
        <div className="mt-4 flex gap-2">
          {actions.map((a) => (
            <button
              key={a.to}
              type="button"
              disabled={busy}
              onClick={() => {
                if (a.confirm && !window.confirm(`ยกเลิกคิวของ ${booking.customerName} เวลา ${booking.time} น. ใช่ไหม?`)) return;
                onChange(booking, a.to);
              }}
              className={cx(
                'flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-medium transition active:scale-[0.98] disabled:opacity-50',
                a.primary
                  ? 'bg-[#061257] text-white'
                  : a.to === 'cancelled'
                    ? 'border border-gray-200 bg-white text-red-600'
                    : 'border border-gray-200 bg-white text-gray-700'
              )}
            >
              {busy && a.primary ? <Spinner className="h-4 w-4" /> : null}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

/* ================================================================== */
/*  Dashboard                                                          */
/* ================================================================== */
function Dashboard({ token, onLogout }) {
  const dates = useMemo(() => buildDates(14), []);
  const [date, setDate] = useState(dates[0].iso);
  const [data, setData] = useState({ bookings: [], storage: null });
  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [staffFilter, setStaffFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active'); // active = ไม่รวมที่ยกเลิก
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');

  const handleAuthError = useCallback(
    (err) => {
      if (err.status === 401) {
        tokenStore.clear();
        onLogout('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        return true;
      }
      return false;
    },
    [onLogout]
  );

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError('');
      try {
        setData(await listBookings(token, date));
      } catch (err) {
        if (!handleAuthError(err)) setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [token, date, handleAuthError]
  );

  useEffect(() => {
    getServices().then(setServices).catch(() => {});
    getStaff().then(setStaff).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // รีเฟรชอัตโนมัติทุก 30 วินาที และเมื่อกลับมาที่แท็บ
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && load(true), 30000);
    const onVis = () => document.visibilityState === 'visible' && load(true);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const changeStatus = async (booking, status) => {
    setBusyId(booking.id);
    try {
      const updated = await updateStatus(token, booking.id, status);
      setData((d) => ({ ...d, bookings: d.bookings.map((b) => (b.id === updated.id ? updated : b)) }));
      setToast(`${booking.customerName} → ${STATUS[status].label}`);
    } catch (err) {
      if (!handleAuthError(err)) setToast(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const serviceById = useMemo(() => Object.fromEntries(services.map((s) => [s.id, s])), [services]);

  const byStaff = data.bookings.filter((b) => staffFilter === 'all' || b.staffId === staffFilter);
  const counts = {
    active: byStaff.filter((b) => b.status !== 'cancelled').length,
    pending: byStaff.filter((b) => b.status === 'pending').length,
    confirmed: byStaff.filter((b) => b.status === 'confirmed').length,
    completed: byStaff.filter((b) => b.status === 'completed').length,
    cancelled: byStaff.filter((b) => b.status === 'cancelled').length,
  };
  const revenue = byStaff
    .filter((b) => b.status !== 'cancelled')
    .reduce((sum, b) => sum + (serviceById[b.serviceId]?.price ?? 0), 0);
  const visible = byStaff.filter((b) => (statusFilter === 'active' ? b.status !== 'cancelled' : b.status === statusFilter));

  const filterChips = [
    { key: 'active', label: 'ทั้งหมด' },
    { key: 'pending', label: 'รอยืนยัน' },
    { key: 'confirmed', label: 'ยืนยันแล้ว' },
    { key: 'completed', label: 'เสร็จสิ้น' },
    { key: 'cancelled', label: 'ยกเลิก' },
  ];

  return (
    <div className="min-h-dvh bg-gray-50">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-gray-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#061257] text-white">
              <ScissorsIcon className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-[#061257]">2PP The Barber Club</p>
              <p className="text-xs text-gray-500">หลังร้าน</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => load()}
              aria-label="รีเฟรช"
              className="flex h-12 w-12 items-center justify-center rounded-xl text-gray-600 hover:bg-gray-50"
            >
              <RefreshIcon spinning={loading} />
            </button>
            <button
              type="button"
              onClick={() => {
                tokenStore.clear();
                onLogout();
              }}
              aria-label="ออกจากระบบ"
              className="flex h-12 w-12 items-center justify-center rounded-xl text-gray-600 hover:bg-gray-50"
            >
              <LogoutIcon />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-4 pb-16">
        {data.storage === 'memory' && (
          <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <p>
              ยังไม่ได้ต่อฐานข้อมูล — การจองเก็บในหน่วยความจำชั่วคราวและอาจหายได้ (ตั้งค่า Upstash Redis บน Vercel เพื่อเก็บถาวร)
            </p>
          </div>
        )}

        {/* Date picker */}
        <section className="mb-4 rounded-2xl border border-gray-100 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-900">{formatThaiFullDate(date)}</h2>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              aria-label="เลือกวันที่อื่น"
              className="h-10 rounded-lg border border-gray-100 bg-gray-50 px-2 text-sm text-gray-700"
            />
          </div>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {dates.map((d) => {
              const active = d.iso === date;
              return (
                <button
                  key={d.iso}
                  type="button"
                  onClick={() => setDate(d.iso)}
                  aria-pressed={active}
                  className={cx(
                    'flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-xl border transition',
                    active ? 'border-[#061257] bg-[#061257] text-white' : 'border-gray-100 bg-gray-50 text-gray-900'
                  )}
                >
                  <span className={cx('text-xs', active ? 'text-white/75' : 'text-gray-500')}>{d.day}</span>
                  <span className="text-lg font-semibold leading-tight">{d.date}</span>
                  {d.isToday && <span className={cx('text-[10px]', active ? 'text-white/80' : 'text-[#061257]')}>วันนี้</span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* Summary */}
        <section className="mb-4 grid grid-cols-3 gap-2">
          <div className="rounded-2xl border border-gray-100 bg-white p-3">
            <p className="text-xs text-gray-500">คิวทั้งหมด</p>
            <p className="text-2xl font-semibold text-gray-900 tabular-nums">{counts.active}</p>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white p-3">
            <p className="text-xs text-gray-500">รอยืนยัน</p>
            <p className={cx('text-2xl font-semibold tabular-nums', counts.pending ? 'text-amber-600' : 'text-gray-900')}>{counts.pending}</p>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white p-3">
            <p className="text-xs text-gray-500">รายได้ประมาณ</p>
            <p className="text-xl font-semibold text-[#061257] tabular-nums">{formatPrice(revenue)}</p>
          </div>
        </section>

        {/* Filters */}
        <div className="no-scrollbar -mx-4 mb-2 flex gap-2 overflow-x-auto px-4">
          {[{ id: 'all', name: 'ทุกช่าง' }, ...staff].map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStaffFilter(s.id)}
              aria-pressed={staffFilter === s.id}
              className={cx(
                'h-10 shrink-0 rounded-full border px-4 text-sm transition',
                staffFilter === s.id ? 'border-[#061257] bg-[#061257] text-white' : 'border-gray-200 bg-white text-gray-700'
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
          {filterChips.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              aria-pressed={statusFilter === f.key}
              className={cx(
                'h-10 shrink-0 rounded-full px-4 text-sm transition',
                statusFilter === f.key ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'
              )}
            >
              {f.label} <span className="tabular-nums opacity-70">{counts[f.key]}</span>
            </button>
          ))}
        </div>

        {/* List */}
        {error ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-4 text-sm text-red-700">
            {error}{' '}
            <button type="button" className="font-medium underline" onClick={() => load()}>
              ลองใหม่
            </button>
          </div>
        ) : loading && !data.bookings.length ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-white" />
            ))}
          </div>
        ) : visible.length ? (
          <div className="space-y-3">
            {visible.map((b) => (
              <BookingCard key={b.id} booking={b} service={serviceById[b.serviceId]} busy={busyId === b.id} onChange={changeStatus} />
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
            ไม่มีคิวในวันนี้ตามตัวกรองที่เลือก
          </p>
        )}
      </main>

      {toast && (
        <div className="animate-fade-in fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <p role="status" className="rounded-full bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg">
            {toast}
          </p>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Root                                                               */
/* ================================================================== */
export default function AdminApp() {
  const [token, setToken] = useState(() => tokenStore.get());
  const [notice, setNotice] = useState('');

  useEffect(() => {
    document.title = 'หลังร้าน — 2PP The Barber Club';
  }, []);

  if (!token) {
    return (
      <>
        {notice && (
          <p className="fixed inset-x-0 top-4 z-50 mx-auto w-fit rounded-full bg-gray-900 px-4 py-2 text-sm text-white">{notice}</p>
        )}
        <LoginScreen
          onLoggedIn={(t) => {
            setNotice('');
            setToken(t);
          }}
        />
      </>
    );
  }
  return (
    <Dashboard
      token={token}
      onLogout={(msg = '') => {
        setNotice(msg);
        setToken(null);
      }}
    />
  );
}
