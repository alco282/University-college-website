import React, { useMemo } from 'react';
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];

export function MonthYearPicker({
  value = '',
  onChange,
  minYear = 1935,
  maxYear = new Date().getFullYear(),
  minValue = '',
  maxValue = '',
  label
}) {
  const [open, setOpen] = React.useState(false);
  const [draftMonth, setDraftMonth] = React.useState('');
  const [draftYear, setDraftYear] = React.useState('');
  const ref = React.useRef(null);

  const normalized = /^\d{4}-\d{2}$/.test(String(value)) ? String(value) : '';
  const [selectedYear, selectedMonth] = normalized
    ? normalized.split('-').map(Number)
    : ['', ''];

  const years = useMemo(
    () => Array.from(
      { length: Math.max(1, maxYear - minYear + 1) },
      (_, i) => maxYear - i
    ),
    [minYear, maxYear]
  );

  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  const isAllowed = (year, month) => {
    const candidate = `${year}-${String(month).padStart(2, '0')}`;
    return (!minValue || candidate >= minValue) && (!maxValue || candidate <= maxValue);
  };

  React.useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = event => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const openPicker = () => {
    // The interaction is intentionally month -> year, not a huge
    // month/year option list.
    setDraftMonth('');
    setDraftYear('');
    setOpen(true);
  };

  const chooseMonth = month => {
    setDraftMonth(month);
    // Year is deliberately selected in the next step.
    setDraftYear('');
  };

  const chooseYear = year => {
    const numericYear = Number(year);
    const numericMonth = Number(draftMonth);
    if (!numericYear || !numericMonth || !isAllowed(numericYear, numericMonth)) return;
    setDraftYear(numericYear);
    onChange(`${numericYear}-${String(numericMonth).padStart(2, '0')}`);
    setOpen(false);
  };

  const displayValue = normalized
    ? `${months[selectedMonth - 1]} ${selectedYear}`
    : 'Month / Year';

  return (
    <div className="relative w-full" ref={ref}>
      <button
        type="button"
        aria-label={label || 'Month and year'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openPicker}
        className="w-full min-w-0 px-3 py-2 border border-gray-300 rounded-xl text-sm bg-white text-left truncate flex items-center justify-between gap-2"
      >
        <span className={normalized ? 'text-gray-900' : 'text-gray-500'}>{displayValue}</span>
        <span aria-hidden="true" className="text-gray-400">▾</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={label || 'Select month and year'}
          className="absolute z-50 mt-2 w-full min-w-[260px] rounded-2xl border border-gray-200 bg-white p-3 shadow-xl"
        >
          <div className="grid grid-cols-4 gap-2 mb-3">
            {months.map((month, index) => {
              const monthNumber = index + 1;
              const active = Number(draftMonth) === monthNumber;

              return (
                <button
                  key={month}
                  type="button"
                  onClick={() => chooseMonth(monthNumber)}
                  className={`px-2 py-2 rounded-lg text-xs font-semibold border ${
                    active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {month}
                </button>
              );
            })}
          </div>

          <label className="sr-only" htmlFor={`${label || 'month-year'}-year`}>Year</label>
          <select
            id={`${label || 'month-year'}-year`}
            value={draftYear || ''}
            disabled={!draftMonth}
            onChange={e => chooseYear(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="">{draftMonth ? 'Select year' : 'Select month first'}</option>
            {years.map(year => (
              <option
                key={year}
                value={year}
                disabled={!isAllowed(year, Number(draftMonth))}
              >
                {year}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export function formatMonthYear(value) {
  if (!/^\d{4}-\d{2}$/.test(String(value || ''))) {
    return '—';
  }

  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  const [year, month] = String(value).split('-').map(Number);

  return `${months[month - 1]} ${year}`;
}

export function DateTimePicker({ value = '', onChange, min = '', max = '', label = 'Date and time' }) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || '');
  const y = match ? Number(match[1]) : '';
  const m = match ? Number(match[2]) : '';
  const d = match ? Number(match[3]) : '';
  const hh = match ? Number(match[4]) : 18;
  const mm = match ? Number(match[5]) : 0;
  const maxYear = new Date(max || Date.now()).getFullYear();
  const minYear = new Date(min || Date.now()).getFullYear();
  const years = Array.from({ length: Math.max(1, maxYear - minYear + 1) }, (_, i) => minYear + i);
  const days = m && y ? new Date(y, m, 0).getDate() : 31;
  const emit = (yy, mo, day, hour, minute) => {
    if (!yy || !mo || !day) return onChange('');
    const safeDay = Math.min(Number(day), new Date(Number(yy), Number(mo), 0).getDate());
    const next = `${yy}-${String(mo).padStart(2,'0')}-${String(safeDay).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
    if (min && next < min) return;
    if (max && next > max) return;
    onChange(next);
  };
  return <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
    <select aria-label={`${label} month`} value={m || ''} onChange={e => emit(y, Number(e.target.value), d, hh, mm)} className="px-2.5 py-2 border border-gray-300 rounded-xl text-sm bg-white"><option value="">Month</option>{MONTHS.map((x,i)=><option key={x} value={i+1}>{x}</option>)}</select>
    <select aria-label={`${label} day`} value={d || ''} onChange={e => emit(y,m,Number(e.target.value),hh,mm)} className="px-2.5 py-2 border border-gray-300 rounded-xl text-sm bg-white"><option value="">Day</option>{Array.from({length:days},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select>
    <select aria-label={`${label} year`} value={y || ''} onChange={e => emit(Number(e.target.value),m,d,hh,mm)} className="px-2.5 py-2 border border-gray-300 rounded-xl text-sm bg-white"><option value="">Year</option>{years.map(x=><option key={x} value={x}>{x}</option>)}</select>
    <select aria-label={`${label} hour`} value={hh} onChange={e => emit(y,m,d,Number(e.target.value),mm)} className="px-2.5 py-2 border border-gray-300 rounded-xl text-sm bg-white">{Array.from({length:24},(_,i)=><option key={i} value={i}>{String(i).padStart(2,'0')}</option>)}</select>
    <select aria-label={`${label} minute`} value={mm} onChange={e => emit(y,m,d,hh,Number(e.target.value))} className="px-2.5 py-2 border border-gray-300 rounded-xl text-sm bg-white">{[0,15,30,45].map(x=><option key={x} value={x}>{String(x).padStart(2,'0')}</option>)}</select>
  </div>;
}
