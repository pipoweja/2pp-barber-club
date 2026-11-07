import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getServices, getStaff, getAvailability, createBooking } from './api/bookingService';

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */
const DAYS_AHEAD = 14;
const OPEN_MIN = 10 * 60; // 10:00 (ตรงกับ server.js)
const CLOSE_MIN = 20 * 60; // 20:00
const SLOT_STEP_MIN = 30;

/** วันนี้ยังเหลือช่วงเวลาให้จองบริการยาว `duration` นาทีหรือไม่ (เช็กแบบคร่าว ๆ ฝั่ง client, server ตัดสินจริง) */
const isTodayClosed = (duration = SLOT_STEP_MIN) => {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const lastStart = OPEN_MIN + Math.floor((CLOSE_MIN - duration - OPEN_MIN) / SLOT_STEP_MIN) * SLOT_STEP_MIN;
  return nowMin + 1 > lastStart;
};
const TH_DAY_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

const toISODate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const parseISODate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** "วันเสาร์ที่ 7 พฤศจิกายน 2569" */
const formatThaiFullDate = (iso) => {
  const d = parseISODate(iso);
  const weekday = d.toLocaleDateString('th-TH', { weekday: 'long' });
  const rest = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
  return `${weekday}ที่ ${rest}`;
};

const formatDuration = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m} นาที`;
  return m ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
};

const formatPrice = (n) => `฿${Number(n).toLocaleString('th-TH')}`;

const normalizePhone = (s) => s.replace(/[\s-]/g, '');
const isValidPhone = (s) => /^0\d{8,9}$/.test(normalizePhone(s));

function buildDates(count) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return { iso: toISODate(d), day: TH_DAY_SHORT[d.getDay()], date: d.getDate(), weekday: d.getDay(), isToday: i === 0 };
  });
}

const cx = (...c) => c.filter(Boolean).join(' ');

/* ================================================================== */
/*  Icons (inline SVG)                                                 */
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
const ClockIcon = ({ className = 'h-4 w-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const CheckIcon = ({ className = 'h-5 w-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
const CalendarIcon = ({ className = 'h-4 w-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 10h18" />
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
/*  UI building blocks                                                 */
/* ================================================================== */
function Header() {
  return (
    <header className="px-5 pt-10 pb-6 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#061257] text-white shadow-lg shadow-[#061257]/20">
        <ScissorsIcon className="h-7 w-7" />
      </div>
      <h1 className="flex items-center justify-center gap-2 text-2xl font-semibold tracking-tight text-[#061257]">
        <ScissorsIcon className="h-5 w-5" />
        <span>
          2PP <span className="font-light text-gray-900">The Barber Club</span>
        </span>
      </h1>
      <p className="mt-2 text-sm text-gray-500">ประณีตทุกรายละเอียด ให้ทุกการมาเยือนเป็นช่วงเวลาพิเศษของคุณ</p>
    </header>
  );
}

function Section({ step, title, subtitle, children, disabled }) {
  return (
    <section className={cx('px-5 py-5 transition-opacity', disabled && 'pointer-events-none opacity-40')} aria-disabled={disabled}>
      <div className="mb-3 flex items-baseline gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#061257]/8 text-xs font-semibold text-[#061257]">
          {step}
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

const Skeleton = ({ className }) => <div className={cx('animate-pulse rounded-2xl bg-gray-100', className)} />;

function EmptyNote({ children }) {
  return <p className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center text-sm text-gray-500">{children}</p>;
}

/* ---------- 2. Services ---------- */
function ServiceList({ services, loading, selectedId, onSelect }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[76px]" />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-3" role="radiogroup" aria-label="เลือกบริการ">
      {services.map((s) => {
        const active = s.id === selectedId;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(s)}
            className={cx(
              'flex min-h-[64px] w-full items-center gap-4 rounded-2xl border px-4 py-3.5 text-left transition-all active:scale-[0.99]',
              active
                ? 'border-[#061257] bg-[#061257] text-white shadow-lg shadow-[#061257]/15'
                : 'border-gray-100 bg-gray-50 text-gray-900 hover:border-gray-200'
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{s.name}</p>
              <p className={cx('mt-0.5 flex items-center gap-1 text-xs', active ? 'text-white/70' : 'text-gray-500')}>
                <ClockIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="shrink-0 whitespace-nowrap">{formatDuration(s.duration)}</span>
                <span className="mx-1 shrink-0">·</span>
                <span className="truncate">{s.description}</span>
              </p>
            </div>
            <p className={cx('shrink-0 text-base font-semibold', active ? 'text-white' : 'text-[#061257]')}>{formatPrice(s.price)}</p>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- 3. Staff ---------- */
function Avatar({ src, name, active }) {
  const [failed, setFailed] = useState(false);
  const initials = name.replace(/^ช่าง\s*/, '').slice(0, 2).toUpperCase();
  return (
    <div className={cx('h-16 w-16 overflow-hidden rounded-full ring-2 ring-offset-2', active ? 'ring-white ring-offset-[#061257]' : 'ring-gray-100 ring-offset-gray-50')}>
      {src && !failed ? (
        <img src={src} alt={name} className="h-full w-full object-cover" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className={cx('flex h-full w-full items-center justify-center text-lg font-semibold', active ? 'bg-white/15 text-white' : 'bg-[#061257]/10 text-[#061257]')}>
          {initials}
        </div>
      )}
    </div>
  );
}

function StaffScroller({ staff, loading, selectedId, onSelect }) {
  if (loading) {
    return (
      <div className="-mx-5 flex gap-3 overflow-hidden px-5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[148px] w-[120px] shrink-0" />
        ))}
      </div>
    );
  }
  if (!staff.length) return <EmptyNote>ยังไม่มีช่างที่ให้บริการนี้</EmptyNote>;
  return (
    <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1" role="radiogroup" aria-label="เลือกช่าง">
      {staff.map((m) => {
        const active = m.id === selectedId;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(m)}
            className={cx(
              'flex w-[120px] shrink-0 snap-start flex-col items-center rounded-2xl border px-3 py-4 transition-all active:scale-[0.98]',
              active ? 'border-[#061257] bg-[#061257] text-white shadow-lg shadow-[#061257]/15' : 'border-gray-100 bg-gray-50 text-gray-900'
            )}
          >
            <Avatar src={m.avatar} name={m.name} active={active} />
            <p className="mt-3 text-sm font-medium">{m.name}</p>
            <p className={cx('text-[11px]', active ? 'text-white/70' : 'text-gray-500')}>{m.title}</p>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- 4. Dates ---------- */
function DateScroller({ dates, selected, onSelect, unavailableLabel }) {
  const activeRef = useRef(null);
  const trackRef = useRef(null);
  // เลื่อนเฉพาะแถบวันที่แนวนอน (ไม่ใช้ scrollIntoView เพื่อไม่ให้ทั้งหน้าเลื่อนตาม)
  useEffect(() => {
    const track = trackRef.current;
    const el = activeRef.current;
    if (!track || !el) return;
    const left = el.offsetLeft - track.clientWidth / 2 + el.clientWidth / 2;
    track.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [selected]);

  return (
    <>
      <div className="mb-3 flex items-center gap-2 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
        <CalendarIcon className="h-4 w-4 text-[#061257]" />
        <span className="font-medium text-[#061257]">{formatThaiFullDate(selected)}</span>
      </div>
      <div ref={trackRef} className="no-scrollbar relative -mx-5 flex snap-x gap-2.5 overflow-x-auto px-5 pb-1" role="radiogroup" aria-label="เลือกวันนัด">
        {dates.map((d) => {
          const active = d.iso === selected;
          const off = unavailableLabel?.(d); // เช่น "ปิดแล้ว" / "หยุด" หรือ null
          return (
            <button
              key={d.iso}
              ref={active ? activeRef : undefined}
              type="button"
              role="radio"
              aria-checked={active}
              aria-disabled={!!off}
              disabled={!!off}
              aria-label={`${formatThaiFullDate(d.iso)}${off ? ` (${off})` : ''}`}
              onClick={() => onSelect(d.iso)}
              className={cx(
                'flex h-[76px] w-[60px] shrink-0 snap-start flex-col items-center justify-center rounded-2xl border transition-all',
                active
                  ? 'border-[#061257] bg-[#061257] text-white shadow-lg shadow-[#061257]/15'
                  : off
                    ? 'cursor-not-allowed border-gray-100 bg-white text-gray-300'
                    : 'border-gray-100 bg-gray-50 text-gray-900 active:scale-[0.97]'
              )}
            >
              <span className={cx('text-xs', active ? 'text-white/75' : off ? 'text-gray-300' : 'text-gray-500')}>{d.day}</span>
              <span className={cx('text-xl font-semibold leading-tight', off && !active && 'line-through decoration-1')}>{d.date}</span>
              {off ? (
                <span className={cx('text-[10px] font-medium', active ? 'text-white/80' : 'text-gray-400')}>{off}</span>
              ) : (
                d.isToday && <span className={cx('text-[10px] font-medium', active ? 'text-white/80' : 'text-[#061257]')}>วันนี้</span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ---------- 5. Time slots ---------- */
const EMPTY_MESSAGES = {
  closed: 'วันนี้ร้านปิดรับคิวแล้ว (เปิด 10:00 – 20:00 น.)',
  dayOff: 'ช่างหยุดในวันนี้',
  past: 'ไม่สามารถจองย้อนหลังได้',
  full: 'คิวของช่างเต็มแล้วในวันนี้',
};

function TimeGrid({ slots, loading, reason, selected, onSelect, error, onNextDay }) {
  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  if (error) return <EmptyNote>{error}</EmptyNote>;
  if (!slots.length) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center">
        <p className="text-sm text-gray-600">{EMPTY_MESSAGES[reason] || EMPTY_MESSAGES.full}</p>
        {onNextDay && (
          <button
            type="button"
            onClick={onNextDay}
            className="mt-3 inline-flex h-12 items-center justify-center rounded-xl bg-[#061257] px-5 text-sm font-medium text-white active:scale-[0.98]"
          >
            ดูวันถัดไปที่ว่าง →
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4" role="radiogroup" aria-label="เลือกเวลา">
      {slots.map((t) => {
        const active = t === selected;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(t)}
            className={cx(
              'h-12 rounded-xl border text-sm font-medium tabular-nums transition-all active:scale-[0.97]',
              active ? 'border-[#061257] bg-[#061257] text-white shadow-md shadow-[#061257]/15' : 'border-gray-100 bg-gray-50 text-gray-900 hover:border-gray-200'
            )}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- 6. Customer form ---------- */
function Field({ label, required, hint, error, children, htmlFor }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-gray-700">
        {label} {required ? <span className="text-[#061257]">*</span> : <span className="font-normal text-gray-400">(ไม่บังคับ)</span>}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-gray-400">{hint}</p> : null}
    </div>
  );
}

const inputClass =
  'w-full rounded-xl border border-gray-100 bg-gray-50 px-4 text-base text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-[#061257] focus:bg-white focus:ring-4 focus:ring-[#061257]/10';

function CustomerForm({ form, onChange, touched, onBlur, serverErrors }) {
  const nameErr =
    serverErrors?.customerName || (touched.customerName && form.customerName.trim().length < 2 ? 'กรุณากรอกชื่อ-นามสกุล' : '');
  const phoneErr =
    serverErrors?.customerPhone || (touched.customerPhone && !isValidPhone(form.customerPhone) ? 'กรุณากรอกเบอร์โทร 9–10 หลัก ขึ้นต้นด้วย 0' : '');
  return (
    <div className="space-y-4">
      <Field label="ชื่อ-นามสกุล" required htmlFor="customerName" error={nameErr}>
        <input
          id="customerName"
          name="customerName"
          autoComplete="name"
          className={cx(inputClass, 'h-12', nameErr && 'border-red-300')}
          placeholder="เช่น สมชาย ใจดี"
          value={form.customerName}
          onChange={onChange}
          onBlur={onBlur}
        />
      </Field>
      <Field label="เบอร์โทร" required htmlFor="customerPhone" error={phoneErr} hint="ร้านจะติดต่อกลับเพื่อยืนยันคิว">
        <input
          id="customerPhone"
          name="customerPhone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={12}
          className={cx(inputClass, 'h-12 tabular-nums', phoneErr && 'border-red-300')}
          placeholder="08X-XXX-XXXX"
          value={form.customerPhone}
          onChange={onChange}
          onBlur={onBlur}
        />
      </Field>
      <Field label="ความต้องการพิเศษ" htmlFor="specialRequest">
        <textarea
          id="specialRequest"
          name="specialRequest"
          rows={3}
          maxLength={500}
          className={cx(inputClass, 'resize-none py-3')}
          placeholder="เช่น ต้องการทรงสั้นด้านข้าง, แพ้ผลิตภัณฑ์บางชนิด"
          value={form.specialRequest}
          onChange={onChange}
        />
      </Field>
    </div>
  );
}

/* ---------- Success modal ---------- */
function SuccessModal({ booking, service, onClose }) {
  const btnRef = useRef(null);
  useEffect(() => {
    btnRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const rows = [
    ['บริการ', booking.serviceName],
    ['ช่าง', booking.staffName],
    ['วันที่', formatThaiFullDate(booking.date)],
    ['เวลา', `${booking.time} น.${service ? ` (${formatDuration(service.duration)})` : ''}`],
    ['ชื่อผู้จอง', booking.customerName],
    ['เบอร์โทร', booking.customerPhone],
  ];
  if (service) rows.push(['ราคา', formatPrice(service.price)]);

  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-[#061257]/40 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="success-title"
        className="animate-pop-in w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[#061257] px-6 pt-8 pb-6 text-center text-white">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white/10 ring-8 ring-white/5">
            <CheckIcon className="h-8 w-8" />
          </div>
          <h3 id="success-title" className="mt-4 text-2xl font-semibold">
            จองสำเร็จ!
          </h3>
          <p className="mt-1 text-sm text-white/70">ขอบคุณที่ไว้วางใจ 2PP The Barber Club</p>
        </div>

        <div className="px-6 py-5">
          <dl className="divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-gray-50 px-4">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2.5 text-sm">
                <dt className="shrink-0 text-gray-500">{k}</dt>
                <dd className="text-right font-medium text-gray-900">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-center text-xs text-gray-400">
            หมายเลขการจอง <span className="font-mono text-gray-600">#{booking.id.slice(0, 8).toUpperCase()}</span> · สถานะ: รอยืนยัน
          </p>
          <button
            ref={btnRef}
            type="button"
            onClick={onClose}
            className="mt-5 h-12 w-full rounded-2xl bg-[#061257] text-base font-medium text-white transition active:scale-[0.99]"
          >
            เสร็จสิ้น
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  App (container + state)                                            */
/* ================================================================== */
const EMPTY_FORM = { customerName: '', customerPhone: '', specialRequest: '' };

export default function App() {
  const dates = useMemo(() => buildDates(DAYS_AHEAD), []);

  // data
  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [availability, setAvailability] = useState({ slots: [], reason: null });

  // loading / error
  const [loadingServices, setLoadingServices] = useState(true);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [slotsError, setSlotsError] = useState('');

  // selections
  const [serviceId, setServiceId] = useState(null);
  const [staffId, setStaffId] = useState(null);
  // วันนี้เป็นค่าเริ่มต้น — ถ้าร้านปิดรับคิววันนี้แล้ว เริ่มที่พรุ่งนี้แทน
  const defaultDate = () => (isTodayClosed() ? dates[1].iso : dates[0].iso);
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(null);

  // form & submit
  const [form, setForm] = useState(EMPTY_FORM);
  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [serverErrors, setServerErrors] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  const [slotsVersion, setSlotsVersion] = useState(0); // ใช้บังคับโหลดช่วงเวลาใหม่

  const service = services.find((s) => s.id === serviceId) || null;
  const member = staff.find((s) => s.id === staffId) || null;

  // วันที่เลือกไม่ได้: ช่างหยุด หรือวันนี้เลยเวลารับคิวแล้ว
  const unavailableLabel = useCallback(
    (d) => {
      if (member?.daysOff?.includes(d.weekday)) return 'หยุด';
      if (d.isToday && isTodayClosed(service?.duration)) return 'ปิดแล้ว';
      return null;
    },
    [member, service]
  );
  const nextAvailableDate = useCallback(
    (fromIso) => dates.find((d) => d.iso > fromIso && !unavailableLabel(d))?.iso ?? null,
    [dates, unavailableLabel]
  );

  // ถ้าเปลี่ยนช่าง/บริการแล้ววันที่เลือกไว้ใช้ไม่ได้ ให้เลื่อนไปวันถัดไปที่ใช้ได้อัตโนมัติ
  useEffect(() => {
    const cur = dates.find((d) => d.iso === date);
    if (cur && unavailableLabel(cur)) {
      const next = dates.find((d) => !unavailableLabel(d));
      if (next) setDate(next.iso);
    }
  }, [date, dates, unavailableLabel]);

  // ---- โหลดบริการ ----
  const loadServices = useCallback(() => {
    const ctrl = new AbortController();
    setLoadingServices(true);
    setLoadError('');
    getServices({ signal: ctrl.signal })
      .then(setServices)
      .catch((e) => e.name !== 'AbortError' && setLoadError(e.message))
      .finally(() => !ctrl.signal.aborted && setLoadingServices(false));
    return ctrl;
  }, []);

  useEffect(() => {
    const ctrl = loadServices();
    return () => ctrl.abort();
  }, [loadServices]);

  // ---- โหลดช่างตามบริการที่เลือก ----
  useEffect(() => {
    if (!serviceId) return;
    const ctrl = new AbortController();
    setLoadingStaff(true);
    getStaff(serviceId, { signal: ctrl.signal })
      .then((list) => {
        setStaff(list);
        // ถ้าช่างที่เลือกไว้ทำบริการใหม่ไม่ได้ ให้ล้างการเลือก
        setStaffId((cur) => (list.some((m) => m.id === cur) ? cur : null));
      })
      .catch((e) => e.name !== 'AbortError' && setLoadError(e.message))
      .finally(() => !ctrl.signal.aborted && setLoadingStaff(false));
    return () => ctrl.abort();
  }, [serviceId]);

  // ---- โหลดช่วงเวลาว่าง ----
  useEffect(() => {
    if (!staffId || !serviceId || !date) {
      setAvailability({ slots: [], reason: null });
      return;
    }
    const ctrl = new AbortController();
    setLoadingSlots(true);
    setSlotsError('');
    getAvailability({ staffId, date, serviceId }, { signal: ctrl.signal })
      .then((data) => {
        setAvailability({ slots: data.slots, reason: data.reason ?? (data.dayOff ? 'dayOff' : null) });
        setTime((cur) => (data.slots.includes(cur) ? cur : null));
      })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setSlotsError(e.message);
        setAvailability({ slots: [], reason: null });
      })
      .finally(() => !ctrl.signal.aborted && setLoadingSlots(false));
    return () => ctrl.abort();
  }, [staffId, serviceId, date, slotsVersion]);

  // ---- handlers ----
  const clearSubmitError = () => {
    setSubmitError('');
    setServerErrors(null);
  };
  const handleField = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: name === 'customerPhone' ? value.replace(/[^\d\s-]/g, '') : value }));
    if (serverErrors?.[name]) setServerErrors((s) => ({ ...s, [name]: undefined }));
  };
  const handleBlur = (e) => setTouched((t) => ({ ...t, [e.target.name]: true }));

  const missing = [];
  if (!service) missing.push('บริการ');
  if (!member) missing.push('ช่าง');
  if (!time) missing.push('เวลา');
  if (form.customerName.trim().length < 2) missing.push('ชื่อ');
  if (!isValidPhone(form.customerPhone)) missing.push('เบอร์โทร');
  const canSubmit = missing.length === 0 && !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    clearSubmitError();
    try {
      const booking = await createBooking({
        serviceId,
        staffId,
        date,
        time,
        customerName: form.customerName.trim(),
        customerPhone: normalizePhone(form.customerPhone),
        specialRequest: form.specialRequest.trim(),
      });
      setConfirmed(booking);
    } catch (err) {
      setSubmitError(err.message);
      if (err.errors) setServerErrors(err.errors);
      // เวลาที่เลือกถูกจองไปแล้ว → อัปเดตช่วงว่างล่าสุดและให้เลือกใหม่
      if (err.status === 409) {
        setTime(null);
        if (Array.isArray(err.payload?.slots)) {
          setAvailability((a) => ({ ...a, slots: err.payload.slots }));
        } else {
          setSlotsVersion((v) => v + 1);
        }
        document.getElementById('step-time')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseModal = useCallback(() => {
    setConfirmed(null);
    setServiceId(null);
    setStaffId(null);
    setStaff([]);
    setTime(null);
    setDate(isTodayClosed() ? dates[1].iso : dates[0].iso);
    setForm(EMPTY_FORM);
    setTouched({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [dates]);

  /* ---------------------------------------------------------------- */
  return (
    <div className="min-h-dvh bg-white">
      <div className="mx-auto max-w-md pb-44">
        <Header />

        {loadError && (
          <div className="mx-5 mb-2 flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1">
              <p>{loadError}</p>
              <button type="button" className="mt-1 font-medium underline underline-offset-2" onClick={loadServices}>
                ลองใหม่
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <Section step={1} title="เลือกบริการ" subtitle="เลือกบริการที่ต้องการ 1 รายการ">
            <ServiceList
              services={services}
              loading={loadingServices}
              selectedId={serviceId}
              onSelect={(s) => {
                clearSubmitError();
                setServiceId(s.id);
              }}
            />
          </Section>

          <div className="mx-5 border-t border-gray-100" />

          <Section step={2} title="เลือกช่าง" subtitle={service ? `ช่างที่ให้บริการ${service.name}` : 'กรุณาเลือกบริการก่อน'} disabled={!service}>
            {service ? (
              <StaffScroller
                staff={staff}
                loading={loadingStaff}
                selectedId={staffId}
                onSelect={(m) => {
                  clearSubmitError();
                  setStaffId(m.id);
                }}
              />
            ) : (
              <EmptyNote>เลือกบริการเพื่อดูรายชื่อช่าง</EmptyNote>
            )}
          </Section>

          <div className="mx-5 border-t border-gray-100" />

          <Section step={3} title="เลือกวันนัด" subtitle={`จองล่วงหน้าได้ ${DAYS_AHEAD} วัน`}>
            <DateScroller
              dates={dates}
              selected={date}
              unavailableLabel={unavailableLabel}
              onSelect={(d) => {
                clearSubmitError();
                setDate(d);
              }}
            />
          </Section>

          <div className="mx-5 border-t border-gray-100" />

          <div id="step-time" className="scroll-mt-4">
            <Section
              step={4}
              title="เลือกเวลา"
              subtitle={member ? `เวลาว่างของ${member.name}` : 'กรุณาเลือกช่างก่อน'}
              disabled={!member}
            >
              {member ? (
                <TimeGrid
                  slots={availability.slots}
                  reason={availability.reason}
                  onNextDay={
                    nextAvailableDate(date)
                      ? () => {
                          clearSubmitError();
                          setDate(nextAvailableDate(date));
                        }
                      : undefined
                  }
                  loading={loadingSlots}
                  error={slotsError}
                  selected={time}
                  onSelect={(t) => {
                    clearSubmitError();
                    setTime(t);
                  }}
                />
              ) : (
                <EmptyNote>เลือกช่างเพื่อดูเวลาว่าง</EmptyNote>
              )}
            </Section>
          </div>

          <div className="mx-5 border-t border-gray-100" />

          <Section step={5} title="ข้อมูลผู้จอง">
            <CustomerForm form={form} onChange={handleField} touched={touched} onBlur={handleBlur} serverErrors={serverErrors} />
          </Section>

          {/* ---------- 7. Sticky confirm bar ---------- */}
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-100 bg-white/95 backdrop-blur">
            <div className="mx-auto max-w-md px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {submitError && (
                <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              <div className="mb-3 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900">
                    {service ? service.name : 'ยังไม่ได้เลือกบริการ'}
                    {member && <span className="font-normal text-gray-500"> · {member.name}</span>}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {parseISODate(date).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {time ? ` · ${time} น.` : ' · ยังไม่เลือกเวลา'}
                  </p>
                </div>
                {service && <p className="shrink-0 text-lg font-semibold text-[#061257]">{formatPrice(service.price)}</p>}
              </div>

              <button
                type="submit"
                disabled={!canSubmit}
                aria-busy={submitting}
                className={cx(
                  'flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold transition-all',
                  canSubmit || submitting
                    ? 'bg-[#061257] text-white shadow-lg shadow-[#061257]/25 active:scale-[0.99]'
                    : 'cursor-not-allowed bg-gray-100 text-gray-400'
                )}
              >
                {submitting ? (
                  <>
                    <Spinner /> กำลังจอง...
                  </>
                ) : (
                  'จองเลย'
                )}
              </button>
              {!canSubmit && !submitting && <p className="mt-2 text-center text-xs text-gray-400">กรุณาเลือก/กรอก: {missing.join(', ')}</p>}
            </div>
          </div>
        </form>

        <footer className="px-5 pt-6 text-center text-xs text-gray-400">
          เปิดทุกวัน 10:00 – 20:00 น. · © {new Date().getFullYear()} 2PP The Barber Club
        </footer>
      </div>

      {confirmed && <SuccessModal booking={confirmed} service={service} onClose={handleCloseModal} />}
    </div>
  );
}
