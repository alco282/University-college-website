import React, { useState, useMemo, useRef, useEffect } from 'react';
import { X, Upload, GripVertical, Trash2, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import { MonthYearPicker } from './MonthYearPicker';
import { validateCollegeAndBirth, parseBirthInput, validateResidenceFields, normalizeRoomInput, FLOOR_OPTIONS } from '../utils/security';
import { userApi, uploadMediaFile } from '../services/api';
import { UploadProgress } from './UploadProgress';
import { GeoLocationPicker, resolveLocationCoords } from './GeoLocationPicker';
import { STUDY_DISCIPLINES } from '../constants/studyDisciplines';
import { ResidenceHistoryEditor } from './ResidenceHistoryEditor';
import { safeErrorMessage } from '../services/api';

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239CA3AF'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

const RESIDENCES = ['Residence_name_1','Residence_name_2','Residence_name_3'];
const ACADEMIC_YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year', 'Master / Postgrad', 'PhD'];
const STUDY_LEVELS = ['BSc', 'MSc (Magistrale)', 'PhD'];
const TABS = [
  { id: 'general', label: 'General' },
  { id: 'photos', label: 'Photos & Avatar' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'security', label: 'Security' }
];


function PrivacySelector({ label, value, onChange }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-[#FAF8F5] rounded-xl border border-gray-200 gap-2">
      <span className="text-xs font-bold text-gray-800">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-1.5 bg-white border border-[#D5D3CC] rounded-lg text-xs font-semibold text-gray-800"
      >
        <option value="public">Public (Everyone)</option>
        <option value="registered_only">College Members Only</option>
      </select>
    </div>
  );
}

export function EditProfileModal({ user, onClose, onSave, onUpdateCredentials, showToast }) {
  const [activeTab, setActiveTab] = useState('general');

  const [phone, setPhone] = useState(user.phone || '');
  const [instagram, setInstagram] = useState(user.instagram || '');
  const [linkedin, setLinkedin] = useState(user.linkedin || '');

  const [residence, setResidence] = useState(user.residence || 'Residence_name_1');
  const [floor, setFloor] = useState(user.floor || '');
  const [room, setRoom] = useState(user.room || '');
  const initialFirstYear = String(user.firstYearInCollege || new Date().getFullYear());
  const initialFirstMonth = String(user.firstMonthInCollege || '01').padStart(2, '0');
  const [firstYearInCollege, setFirstYearInCollege] = useState(`${initialFirstYear}-${initialFirstMonth}`);
  const [isCurrentlyInCollege, setIsCurrentlyInCollege] = useState(user.isCurrentlyInCollege !== undefined ? user.isCurrentlyInCollege : true);
  const [departureYear, setDepartureYear] = useState(user.departureYear || '');
  const [departureMonth, setDepartureMonth] = useState(user.departureMonth || '');

  const [selectedCourse, setSelectedCourse] = useState(user.course || STUDY_DISCIPLINES[0]);

  const [academicYear, setAcademicYear] = useState(user.academicYear || '1st Year');
  const [studyLevel, setStudyLevel] = useState(user.studyLevel || 'BSc');

  // Single unified "date of birth" input: accepts a full date (DD/MM/YYYY
  // or DD/MM/YY) or just a bare year (YYYY). Pre-filled from the existing
  // profile data, formatted the same way the field expects it typed.
  const initialBirthInput = user.birthDate
    ? (() => {
        const [y, m, d] = String(user.birthDate).split('-');
        return (y && m && d) ? `${d}/${m}/${y}` : String(user.birthDate);
      })()
    : (user.birthYear ? String(user.birthYear) : '');
  const [birthInput, setBirthInput] = useState(initialBirthInput);
  const [birthInputError, setBirthInputError] = useState('');
  const [birthDate, setBirthDate] = useState(user.birthDate || null);
  const [birthYear, setBirthYear] = useState(user.birthYear || null);

  const handleBirthInputChange = (value) => {
    setBirthInput(value);
    const parsed = parseBirthInput(value);
    setBirthInputError(parsed.error || '');
    setBirthDate(parsed.birthDate);
    setBirthYear(parsed.birthYear);
  };

  const [originContinent, setOriginContinent] = useState(user.originContinent || 'Europe');
  const [originCountry, setOriginCountry] = useState(user.originCountry || 'Italy');
  const [originRegion, setOriginRegion] = useState(user.originRegion || 'Piemonte');
  const [originCity, setOriginCity] = useState(user.originCity || '');
  const [lat, setLat] = useState(user.coords?.[0] !== undefined ? String(user.coords[0]) : '45.0703');
  const [lng, setLng] = useState(user.coords?.[1] !== undefined ? String(user.coords[1]) : '7.6869');

  const [story, setStory] = useState(user.story || '');
  const [isSaving, setIsSaving] = useState(false);

  // --- Photos (upload-only — no more raw external URL entry, since the
  // backend no longer accepts anything other than /uploads/ paths for
  // stored images) ---
  const initialPhotos = (user.photos || []).map(p => (typeof p === 'string' ? { url: p, privacy: 'public' } : p));
  const [photos, setPhotos] = useState(initialPhotos.length > 0 ? initialPhotos : [{ url: user.avatar || DEFAULT_AVATAR, privacy: 'public' }]);
  const [selectedAvatar, setSelectedAvatar] = useState(user.avatar || photos[0]?.url || DEFAULT_AVATAR);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoPercent, setPhotoPercent] = useState(0);

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    setIsUploadingPhoto(true);
    for (const file of files) {
      try {
        showToast(`Uploading ${file.name}...`, 'info');
        const uploadedUrl = await uploadMediaFile(file, { onProgress: setPhotoPercent });
        setPhotos(prev => [...prev.filter(p => p.url !== DEFAULT_AVATAR), { url: uploadedUrl, privacy: 'public' }]);
        setSelectedAvatar(prev => (!prev || prev === DEFAULT_AVATAR ? uploadedUrl : prev));
        showToast('Photo uploaded successfully!', 'success');
      } catch (err) {
        showToast(safeErrorMessage(err) || 'Upload failed.', 'error');
      }
    }
    setIsUploadingPhoto(false);
    setPhotoPercent(0);
    e.target.value = '';
  };

  const handleMovePhoto = (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= photos.length) return;
    const reordered = [...photos];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    setPhotos(reordered);
  };

  const handleTogglePhotoPrivacy = (idx) => {
    setPhotos(prev => prev.map((p, i) => (i === idx ? { ...p, privacy: p.privacy === 'public' ? 'registered_only' : 'public' } : p)));
  };

  const handleRemovePhoto = (idx) => {
    const photoToRemove = photos[idx]?.url;
    const remaining = photos.filter((_, i) => i !== idx);
    setPhotos(remaining);
    if (selectedAvatar === photoToRemove) {
      setSelectedAvatar(remaining.find(p => p.url !== DEFAULT_AVATAR)?.url || DEFAULT_AVATAR);
    }
  };

  // --- Privacy ---
  const [privacy, setPrivacy] = useState({
    firstName: user.privacy?.firstName || 'public',
    lastName: user.privacy?.lastName || 'public',
    email: user.privacy?.email || 'registered_only',
    phone: user.privacy?.phone || 'registered_only',
    instagram: user.privacy?.instagram || 'public',
    linkedin: user.privacy?.linkedin || 'public',
    residence: user.privacy?.residence || 'public',
    floorRoom: user.privacy?.floorRoom || 'public',
    course: user.privacy?.course || 'public',
    studyLevel: user.privacy?.studyLevel || 'public',
    academicYear: user.privacy?.academicYear || 'public',
    yearsInCollege: user.privacy?.yearsInCollege || 'public',
    originLocation: user.privacy?.originLocation || 'public',
    birthDate: user.privacy?.birthDate || 'public',
    story: user.privacy?.story || 'public',
    bacheca: user.privacy?.bacheca || 'public',
    residencyHistory: user.privacy?.residencyHistory || 'private'
  });

  // --- Credentials ---
  const [newEmail, setNewEmail] = useState(user.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [credLoading, setCredLoading] = useState(false);

  const [residencyHistory, setResidencyHistory] = useState(
    Array.isArray(user.residencyHistory) ? user.residencyHistory : []
  );

  // The General Info fields are the source of truth for the user's latest
  // residence stay. Keep that stay represented in Residence History automatically.
  const primaryResidenceEntry = useMemo(() => {
    const year = parseInt(String(firstYearInCollege).substring(0, 4), 10);
    const month = parseInt(String(firstYearInCollege).substring(5, 7), 10) || 1;
    const normalizedRoom = normalizeRoomInput(room);

    if (!residence || !Number.isFinite(year) || !normalizedRoom) return null;

    return {
      startDate: `${year}-${String(month).padStart(2, '0')}`,
      endDate: isCurrentlyInCollege
        ? null
        : (departureYear && departureMonth
          ? `${departureYear}-${String(departureMonth).padStart(2, '0')}`
          : null),
      section: residence,
      floor: floor || FLOOR_OPTIONS[0],
      room: normalizedRoom
    };
  }, [
    firstYearInCollege,
    isCurrentlyInCollege,
    departureYear,
    departureMonth,
    residence,
    floor,
    room
  ]);

  const previousPrimaryResidenceRef = useRef(null);

  useEffect(() => {
    if (!primaryResidenceEntry) return;

    setResidencyHistory(prev => {
      let next = Array.isArray(prev) ? prev.map(entry => ({
        ...entry,
        startDate: String(entry.startDate || ''),
        endDate: entry.endDate ? String(entry.endDate) : null,
        section: String(entry.section || ''),
        floor: String(entry.floor || ''),
        room: normalizeRoomInput(entry.room)
      })) : [];

      // Remove the previous automatically-generated primary row when the
      // General Info residence changes, but leave genuine historical rows alone.
      const previous = previousPrimaryResidenceRef.current;
      if (previous) {
        next = next.filter(entry => !(
          entry.startDate === previous.startDate &&
          entry.section === previous.section &&
          entry.floor === previous.floor &&
          entry.room === previous.room &&
          (entry.endDate || null) === (previous.endDate || null)
        ));
      }

      const matchingIndex = next.findIndex(entry =>
        entry.startDate === primaryResidenceEntry.startDate &&
        entry.section === primaryResidenceEntry.section
      );

      if (matchingIndex >= 0) {
        next[matchingIndex] = { ...next[matchingIndex], ...primaryResidenceEntry };
      } else {
        next.unshift(primaryResidenceEntry);
      }

      next.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
      previousPrimaryResidenceRef.current = primaryResidenceEntry;
      return next;
    });
  }, [primaryResidenceEntry]);

  const validationCheck = useMemo(
    () => validateCollegeAndBirth(firstYearInCollege, isCurrentlyInCollege, departureYear ? `${departureYear}-${String(departureMonth || 1).padStart(2, '0')}` : '', birthDate, birthYear),
    [firstYearInCollege, isCurrentlyInCollege, departureYear, departureMonth, birthDate, birthYear]
  );

  const handleSubmit = async (e) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }

    if (birthInputError) {
      showToast(birthInputError, 'error');
      return;
    }

    const yearCheck = validateCollegeAndBirth(firstYearInCollege, isCurrentlyInCollege, departureYear ? `${departureYear}-${String(departureMonth || 1).padStart(2, '0')}` : '', birthDate, birthYear);
    if (!yearCheck.valid) {
      showToast(yearCheck.error, 'error');
      return;
    }

    const finalCourse = (selectedCourse || '').trim();
    const residenceCheck = validateResidenceFields(floor, room);
    if (!floor || !room || !residenceCheck.valid) { 
      showToast(residenceCheck.error || 'Floor and numeric room are required.', 'error'); 
      return; 
    }
    if (!finalCourse) {
      showToast('Enter the name of the degree course.', 'error');
      return;
    }

    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    const calculatedCoords = (!isNaN(parsedLat) && !isNaN(parsedLng))
      ? [parsedLat, parsedLng]
      : resolveLocationCoords(originContinent, originCountry, originRegion, originCity);

    let cleanPhotos = (photos || []).filter(p => p && p.url);
    let resolvedAvatar = selectedAvatar && selectedAvatar !== DEFAULT_AVATAR ? selectedAvatar : null;

    if (!resolvedAvatar && cleanPhotos.length > 0) {
      resolvedAvatar = cleanPhotos[0].url;
    }
    if (!resolvedAvatar) {
      resolvedAvatar = DEFAULT_AVATAR;
    }
    if (resolvedAvatar !== DEFAULT_AVATAR && !cleanPhotos.some(p => p.url === resolvedAvatar)) {
      cleanPhotos.unshift({ url: resolvedAvatar, privacy: 'public' });
    }

    setIsSaving(true);
    try {
      await Promise.resolve(onSave({
        phone: phone || '',
        instagram: instagram || '',
        linkedin: linkedin || '',
        residence,
        floor,
        room: normalizeRoomInput(room),
        firstYearInCollege: parseInt(String(firstYearInCollege).substring(0, 4), 10) || new Date().getFullYear(),
        firstMonthInCollege: parseInt(String(firstYearInCollege).substring(5, 7), 10) || 1,
        isCurrentlyInCollege,
        departureYear: isCurrentlyInCollege ? null : (departureYear ? parseInt(departureYear, 10) : null),
        departureMonth: isCurrentlyInCollege ? null : (departureMonth ? parseInt(departureMonth, 10) : null),
        course: finalCourse,
        academicYear,
        studyLevel,
        birthDate: birthDate || null,
        birthYear: birthYear ? parseInt(birthYear, 10) : (birthDate ? parseInt(String(birthDate).substring(0, 4), 10) : null),
        originContinent,
        originCountry,
        originRegion: originRegion || 'N/A',
        originCity: originCity || 'N/A',
        coords: calculatedCoords,
        story: story || '',
        photos: cleanPhotos.length > 0 ? cleanPhotos : [{ url: DEFAULT_AVATAR, privacy: 'public' }],
        avatar: resolvedAvatar,
        privacy,
        residencyHistory: Array.isArray(residencyHistory) ? residencyHistory : []
      }));
    } catch (err) {
      console.error('[PROFILE SAVE ERROR]:', err);
      showToast(safeErrorMessage(err) || 'Failed to update profile.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveCredentials = async (e) => {
    e.preventDefault();
    if (!currentPassword) {
      showToast('Enter your current password to confirm changes.', 'error');
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      showToast('The new passwords do not match!', 'error');
      return;
    }

    setCredLoading(true);
    try {
      await onUpdateCredentials({
        currentPassword,
        newPassword: newPassword || undefined,
        newEmail: newEmail !== user.email ? newEmail : undefined
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      // onUpdateCredentials already surfaces the error via showToast; keep the modal open.
    } finally {
      setCredLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 md:p-8 shadow-2xl space-y-6">
        <div className="flex items-center justify-between border-b pb-4">
          <h2 className="font-['Oswald'] text-2xl font-bold uppercase tracking-wider text-gray-900">Edit Profile</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>


        <div className="flex gap-1 border-b overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wide whitespace-nowrap border-b-2 transition-colors ${activeTab === tab.id ? 'border-[#B31217] text-[#B31217]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ================= GENERAL TAB ================= */}
        {activeTab === 'general' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Phone</label>
                <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Instagram</label>
                <input type="text" value={instagram} onChange={e => setInstagram(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm" />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">LinkedIn URL</label>
              <input type="text" value={linkedin} onChange={e => setLinkedin(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm" />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="col-span-2 sm:col-span-2">
                <label className="text-xs font-semibold text-gray-700 block mb-1">Residence Section</label>
                <select value={residence} onChange={e => setResidence(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm">
                  {RESIDENCES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Floor</label>
                <select value={floor} onChange={e => setFloor(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm"><option value="">Select floor...</option>{FLOOR_OPTIONS.map(x => <option key={x}>{x}</option>)}</select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Room</label>
                <input type="text" inputMode="numeric" pattern="[0-9]+" value={room} onChange={e => setRoom(normalizeRoomInput(e.target.value))} maxLength={30} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-gray-700 block mb-1">Field of Study</label>
                <input
                  list="edit-study-disciplines"
                  value={selectedCourse}
                  onChange={e => setSelectedCourse(e.target.value)}
                  maxLength={255}
                  placeholder="Search or enter a custom field of study"
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm"
                />
                <datalist id="edit-study-disciplines">
                  {STUDY_DISCIPLINES.map(d => <option key={d} value={d} />)}
                </datalist>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Study Level</label>
                <select value={studyLevel} onChange={e => setStudyLevel(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm">
                  {STUDY_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Academic Year</label>
                <select value={academicYear} onChange={e => setAcademicYear(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm">
                  {ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">First Month / Year in Residence</label>
                <MonthYearPicker label="First Month / Year in Residence" value={firstYearInCollege} onChange={setFirstYearInCollege} minYear={1935} maxYear={new Date().getFullYear()} maxValue={`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`} />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                  <input type="checkbox" checked={isCurrentlyInCollege} onChange={e => setIsCurrentlyInCollege(e.target.checked)} />
                  Currently in Residence
                </label>
              </div>
              {!isCurrentlyInCollege && (
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">Departure Month / Year *</label>
                  <MonthYearPicker label="Departure Month / Year" value={departureYear && departureMonth ? `${departureYear}-${String(departureMonth).padStart(2, '0')}` : ''} onChange={value => { if (!value) { setDepartureYear(''); setDepartureMonth(''); return; } const [y,m] = value.split('-'); setDepartureYear(y); setDepartureMonth(m); }} minYear={1935} maxYear={new Date().getFullYear()} maxValue={`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`} />
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">
                Date of Birth <span className="text-gray-900">*</span>
              </label>
              <input
                type="text"
                required
                value={birthInput}
                onChange={e => handleBirthInputChange(e.target.value)}
                placeholder="DD/MM/YYYY, DD/MM/YY, or just YYYY"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Enter your full date of birth, or just the birth year if you prefer not to share the exact date.
              </p>
              {birthInputError && (
                <p className="text-xs text-red-600 flex items-center gap-1.5 mt-1"><AlertCircle className="w-3.5 h-3.5 shrink-0" />{birthInputError}</p>
              )}
            </div>

            {!validationCheck.valid && (
              <p className="text-xs text-red-600 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0" />{validationCheck.error}</p>
            )}

            <GeoLocationPicker
              continent={originContinent} setContinent={setOriginContinent}
              country={originCountry} setCountry={setOriginCountry}
              region={originRegion} setRegion={setOriginRegion}
              city={originCity} setCity={setOriginCity}
              lat={lat} setLat={setLat}
              lng={lng} setLng={setLng}
              showToast={showToast}
            />

            <ResidenceHistoryEditor value={residencyHistory} onChange={setResidencyHistory} primaryPeriod={{ startDate: firstYearInCollege, endDate: !isCurrentlyInCollege && departureYear && departureMonth ? `${departureYear}-${String(departureMonth).padStart(2, '0')}` : null, section: residence }} />

            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Your Story</label>
              <textarea rows={4} maxLength={3000} value={story} onChange={e => setStory(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm resize-none" />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
              <button type="submit" disabled={isSaving} className="px-5 py-2 bg-[#B31217] hover:bg-[#8A0E12] disabled:bg-gray-300 text-white rounded-xl text-xs font-bold shadow transition-all">
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}

        {/* ================= PHOTOS TAB ================= */}
        {activeTab === 'photos' && (
          <div className="space-y-4">
            <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-900 hover:bg-black text-white rounded-xl text-xs font-bold cursor-pointer">
              <Upload className="w-4 h-4" />
              {isUploadingPhoto ? 'Uploading...' : 'Upload Photo(s)'}
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleFileUpload} className="hidden" disabled={isUploadingPhoto} />
            </label>
            {isUploadingPhoto && <UploadProgress percent={photoPercent} />}

            <div className="space-y-2">
              {photos.map((p, idx) => (
                <div key={p.url + idx} className="flex items-center gap-3 p-2.5 bg-[#FAF8F5] rounded-xl border border-gray-200">
                  <GripVertical className="w-4 h-4 text-gray-300 shrink-0" />
                  <img src={p.url} alt="" className="w-12 h-12 rounded-lg object-cover border border-gray-200 shrink-0" onError={e => { e.currentTarget.src = DEFAULT_AVATAR; }} />
                  <div className="flex-1 min-w-0">
                    <button type="button" onClick={() => setSelectedAvatar(p.url)} className={`text-xs font-bold ${selectedAvatar === p.url ? 'text-[#B31217]' : 'text-gray-500 hover:text-gray-700'}`}>
                      {selectedAvatar === p.url ? '✓ Current Avatar' : 'Set as Avatar'}
                    </button>
                  </div>
                  <button type="button" onClick={() => handleTogglePhotoPrivacy(idx)} title="Toggle visibility" className="p-1.5 text-gray-400 hover:text-gray-700">
                    {p.privacy === 'public' ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                  <button type="button" onClick={() => handleMovePhoto(idx, -1)} disabled={idx === 0} className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-20">↑</button>
                  <button type="button" onClick={() => handleMovePhoto(idx, 1)} disabled={idx === photos.length - 1} className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-20">↓</button>
                  <button type="button" onClick={() => handleRemovePhoto(idx)} className="p-1.5 text-red-400 hover:text-red-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
              <button type="button" onClick={handleSubmit} disabled={isSaving} className="px-5 py-2 bg-[#B31217] hover:bg-[#8A0E12] disabled:bg-gray-300 text-white rounded-xl text-xs font-bold shadow transition-all">
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}

        {/* ================= PRIVACY TAB ================= */}
        {activeTab === 'privacy' && (
          <div className="space-y-2.5">
            <PrivacySelector label="First / Last Name" value={privacy.firstName} onChange={v => setPrivacy(p => ({ ...p, firstName: v, lastName: v }))} />
            <PrivacySelector label="Email Address" value={privacy.email} onChange={v => setPrivacy(p => ({ ...p, email: v }))} />
            <PrivacySelector label="Phone Number" value={privacy.phone} onChange={v => setPrivacy(p => ({ ...p, phone: v }))} />
            <PrivacySelector label="Instagram" value={privacy.instagram} onChange={v => setPrivacy(p => ({ ...p, instagram: v }))} />
            <PrivacySelector label="LinkedIn" value={privacy.linkedin} onChange={v => setPrivacy(p => ({ ...p, linkedin: v }))} />
            <PrivacySelector label="Residence Section" value={privacy.residence} onChange={v => setPrivacy(p => ({ ...p, residence: v }))} />
            <PrivacySelector label="Floor & Room" value={privacy.floorRoom} onChange={v => setPrivacy(p => ({ ...p, floorRoom: v }))} />
            <PrivacySelector label="Degree Course" value={privacy.course} onChange={v => setPrivacy(p => ({ ...p, course: v }))} />
            <PrivacySelector label="Study Level" value={privacy.studyLevel} onChange={v => setPrivacy(p => ({ ...p, studyLevel: v }))} />
            <PrivacySelector label="Academic Year" value={privacy.academicYear} onChange={v => setPrivacy(p => ({ ...p, academicYear: v }))} />
            <PrivacySelector label="Years in Residence" value={privacy.yearsInCollege} onChange={v => setPrivacy(p => ({ ...p, yearsInCollege: v }))} />
            <PrivacySelector label="Origin Location" value={privacy.originLocation} onChange={v => setPrivacy(p => ({ ...p, originLocation: v }))} />
            <PrivacySelector label="Birth Date" value={privacy.birthDate} onChange={v => setPrivacy(p => ({ ...p, birthDate: v }))} />
            <PrivacySelector label="Your Story" value={privacy.story} onChange={v => setPrivacy(p => ({ ...p, story: v }))} />
            <PrivacySelector label="Residence History" value={privacy.residencyHistory} onChange={v => setPrivacy(p => ({ ...p, residencyHistory: v }))} />
            <PrivacySelector label="Bacheca (Wall Posts)" value={privacy.bacheca} onChange={v => setPrivacy(p => ({ ...p, bacheca: v }))} />

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
              <button type="button" onClick={handleSubmit} disabled={isSaving} className="px-5 py-2 bg-[#B31217] hover:bg-[#8A0E12] disabled:bg-gray-300 text-white rounded-xl text-xs font-bold shadow transition-all">
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}

        {/* ================= SECURITY TAB ================= */}
        {activeTab === 'security' && (
          <div className="space-y-6">
            <form onSubmit={handleSaveCredentials} className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-800">Login Credentials</h3>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Email Address</label>
                <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Current Password *</label>
                <input type="password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">New Password</label>
                  <input type="password" minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">Confirm New Password</label>
                  <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Close</button>
                <button type="submit" disabled={credLoading} className="px-5 py-2 bg-[#B31217] hover:bg-[#8A0E12] disabled:bg-gray-300 text-white rounded-xl text-xs font-bold shadow transition-all">
                  {credLoading ? 'Updating...' : 'Update Credentials'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
