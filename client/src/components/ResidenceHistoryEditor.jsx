import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { normalizeRoomInput, FLOOR_OPTIONS } from '../utils/security';
import { MonthYearPicker, formatMonthYear } from './MonthYearPicker';

const RESIDENCE_SECTIONS = ['Residence_name_1','Residence_name_2','Residence_name_3'];

function monthValue(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-\d{2}/);
  return isoMatch ? `${isoMatch[1]}-${isoMatch[2]}` : '';
}

function displayMonth(value) {
  const normalized = monthValue(value);
  if (!normalized) return '';
  const [year, month] = normalized.split('-');
  return `${month}/${year}`;
}

function validateEntry(entry, history, editingIndex, primaryPeriod = null) {
  if (!entry.startDate) return 'Start month and year are required.';
  if (!/^\d{4}-\d{2}$/.test(entry.startDate)) return 'Start date must use month and year (MM/YYYY).';
  if (entry.endDate && !/^\d{4}-\d{2}$/.test(entry.endDate)) return 'End date must use month and year (MM/YYYY).';
  if (entry.endDate && entry.endDate < entry.startDate) return 'End month cannot be earlier than the start month.';
  if (!RESIDENCE_SECTIONS.includes(entry.section)) return 'Select a valid residence section.';
  if (!FLOOR_OPTIONS.includes(entry.floor)) return 'Select a valid floor.';
  if (!/^[0-9]+$/.test(entry.room)) return 'Room number must contain digits only.';

  const candidateStart = entry.startDate;
  const candidateEnd = entry.endDate || '9999-12';

  if (primaryPeriod?.startDate && primaryPeriod?.section && entry.section !== primaryPeriod.section) {
    const primaryStart = monthValue(primaryPeriod.startDate);
    const primaryEnd = monthValue(primaryPeriod.endDate) || '9999-12';
    const candidateStart = entry.startDate;
    const candidateEnd = entry.endDate || '9999-12';
    if (primaryStart && candidateStart <= primaryEnd && primaryStart <= candidateEnd) {
      return `This period overlaps the current residence in ${primaryPeriod.section}. Please correct the dates.`;
    }
  }

  for (let index = 0; index < history.length; index += 1) {
    if (index === editingIndex) continue;
    const other = history[index];
    const otherStart = monthValue(other.startDate);
    const otherEnd = monthValue(other.endDate) || '9999-12';
    if (!otherStart) continue;

    const overlaps = candidateStart <= otherEnd && otherStart <= candidateEnd;
    if (overlaps && entry.section !== String(other.section || '').trim()) {
      return `This period overlaps with ${other.section}. A resident cannot occupy two different sections at the same time.`;
    }
  }

  return '';
}

function emptyEntry() {
  return { startDate: '', endDate: '', section: '', floor: FLOOR_OPTIONS[0], room: '' };
}

export function ResidenceHistoryTable({ history = [], showActions = false, onEdit, onDelete }) {
  return <div className="overflow-x-auto">{history.length === 0 ? <p className="text-xs text-gray-500 py-3">No historical residence entries yet.</p> : <table className="w-full text-xs border-collapse"><thead><tr className="text-left border-b border-gray-200"><th className="p-2">Start</th><th className="p-2">End</th><th className="p-2">Section</th><th className="p-2">Floor</th><th className="p-2">Room</th>{showActions && <th className="p-2 text-right">Actions</th>}</tr></thead><tbody>{history.map((entry,index)=><tr key={`${entry.startDate}-${entry.section}-${entry.room}-${index}`} className="border-b border-gray-100"><td className="p-2 whitespace-nowrap">{formatMonthYear(entry.startDate)}</td><td className="p-2 whitespace-nowrap">{entry.endDate ? formatMonthYear(entry.endDate) : '- ongoing'}</td><td className="p-2">{entry.section}</td><td className="p-2">{entry.floor}</td><td className="p-2 font-mono">{entry.room}</td>{showActions && <td className="p-2 text-right"><button type="button" onClick={()=>onEdit?.(index)} className="p-1.5"><Pencil className="w-3.5 h-3.5 inline"/></button><button type="button" onClick={()=>onDelete?.(index)} className="p-1.5 text-red-600"><Trash2 className="w-3.5 h-3.5 inline"/></button></td>}</tr>)}</tbody></table>}</div>;
}

export function ResidenceHistoryEditor({ value = [], onChange, showToast, primaryPeriod = null }) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(emptyEntry());
  const [editingIndex, setEditingIndex] = useState(null);
  const [draftError, setDraftError] = useState('');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const history = useMemo(
    () => (Array.isArray(value) ? value.map((entry) => ({
      startDate: monthValue(entry.startDate),
      endDate: entry.endDate ? monthValue(entry.endDate) : '',
      section: String(entry.section || ''),
      floor: String(entry.floor || ''),
      room: normalizeRoomInput(entry.room)
    })) : []),
    [value]
  );

  useEffect(() => {
    if (!isEditorOpen || (!draft.startDate && !draft.endDate)) { setDraftError(''); return; }
    setDraftError(validateEntry(draft, history, editingIndex, primaryPeriod));
  }, [draft, history, editingIndex, primaryPeriod, isEditorOpen]);

  const beginAdd = () => {
    setEditingIndex(null);
    setDraft(emptyEntry());
    setDraftError('');
    setIsEditorOpen(true);
    setExpanded(true);
  };

  const beginEdit = (index) => {
    setEditingIndex(index);
    setDraft({ ...history[index] });
    setDraftError('');
    setIsEditorOpen(true);
    setExpanded(true);
  };

  const saveDraft = () => {
    const cleaned = {
      startDate: monthValue(draft.startDate),
      endDate: draft.endDate ? monthValue(draft.endDate) : null,
      section: String(draft.section || '').trim().slice(0, 64),
      floor: draft.floor,
      room: normalizeRoomInput(draft.room)
    };

    const error = validateEntry(cleaned, history, editingIndex, primaryPeriod);
    if (error) {
      setDraftError(error);
      return;
    }
    if (!cleaned.room) {
      setDraftError('Room number is required.');
      return;
    }

    const next = [...history];
    if (editingIndex === null) next.push(cleaned);
    else next[editingIndex] = cleaned;

    next.sort((a, b) => a.startDate.localeCompare(b.startDate));
    onChange(next);
    setDraft(emptyEntry());
    setEditingIndex(null);
    setDraftError('');
    setIsEditorOpen(false);
    showToast?.(editingIndex === null ? 'Historical residence added.' : 'Historical residence updated.', 'success');
  };

  const removeEntry = (index) => {
    onChange(history.filter((_, i) => i !== index));
    if (editingIndex === index) {
      setEditingIndex(null);
      setDraft(emptyEntry());
      setDraftError('');
      setIsEditorOpen(false);
    }
  };

  return (
    <div className="border border-[#D5D3CC] rounded-2xl bg-[#FAF8F5] p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-800">Residence history</h3>
          <p className="text-[11px] text-gray-500">Optional past stays used for historical identity matching and date-based notifications.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setExpanded(v => !v)} className="px-3 py-1.5 rounded-xl border border-gray-300 bg-white text-xs font-bold">
            {expanded ? 'Hide history' : 'Show history of visited residences'}
          </button>
          <button type="button" onClick={beginAdd} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-900 text-white text-xs font-bold">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </div>

      {expanded && (
        <>
          {isEditorOpen && (
            <div className="p-3 rounded-xl bg-white border border-gray-200 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
                <div>
                  <label className="sr-only" htmlFor="history-start-month">History start month</label>
                  <MonthYearPicker label="History start" value={draft.startDate} onChange={value => setDraft(d => ({ ...d, startDate: value }))} />
                </div>
                <div>
                  <label className="sr-only" htmlFor="history-end-month">History end month</label>
                  <MonthYearPicker label="History end" value={draft.endDate} onChange={value => setDraft(d => ({ ...d, endDate: value }))} />
                </div>
                <select
                  value={draft.section}
                  onChange={e =>
                    setDraft(d => ({
                      ...d,
                      section: e.target.value
                    }))
                  }
                  className="w-full min-w-0 px-2.5 py-2 border border-gray-300 rounded-lg text-xs bg-white"
                  aria-label="Residence section"
                >
                  <option value="">Select section</option>

                  {RESIDENCE_SECTIONS.map(section => (
                    <option key={section} value={section}>
                      {section}
                    </option>
                  ))}
                </select>

                <select
                  value={draft.floor}
                  onChange={e =>
                    setDraft(d => ({
                      ...d,
                      floor: e.target.value
                    }))
                  }
                  className="w-full min-w-0 px-2.5 py-2 border border-gray-300 rounded-lg text-xs bg-white"
                  aria-label="Floor"
                >
                  {FLOOR_OPTIONS.map(floor => (
                    <option key={floor} value={floor}>
                      {floor}
                    </option>
                  ))}
                </select>

                <input
                  inputMode="numeric"
                  pattern="[0-9]+"
                  value={draft.room}
                  onChange={e =>
                    setDraft(d => ({
                      ...d,
                      room: normalizeRoomInput(e.target.value)
                    }))
                  }
                  placeholder="Room"
                  aria-label="Room"
                  className="w-full min-w-0 px-2.5 py-2 border border-gray-300 rounded-lg text-xs"
                />
              </div>
              <p className="text-[10px] text-gray-400">Dates are recorded by month and year only (MM/YYYY).</p>
              {draftError && <p className="text-[11px] text-red-600">{draftError}</p>}
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setEditingIndex(null); setDraft(emptyEntry()); setDraftError(''); setIsEditorOpen(false); }} className="px-3 py-1.5 bg-gray-100 rounded-lg text-xs font-bold"><X className="w-3.5 h-3.5 inline" /> Cancel</button>
                <button type="button" onClick={saveDraft} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold"><Check className="w-3.5 h-3.5 inline" /> Save</button>
              </div>
            </div>
          )}

          <ResidenceHistoryTable history={history} showActions onEdit={beginEdit} onDelete={removeEntry} />
        </>
      )}
    </div>
  );
}
