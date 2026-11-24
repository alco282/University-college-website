import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, CheckCircle2, AlertCircle, Upload } from 'lucide-react';

import { validateCollegeAndBirth, parseBirthInput, validateResidenceFields, normalizeRoomInput, FLOOR_OPTIONS } from '../utils/security';
import { authApi, uploadRegistrationAvatar } from '../services/api';
import { UploadProgress } from './UploadProgress';
import { GeoLocationPicker, resolveLocationCoords } from './GeoLocationPicker';
import { STUDY_DISCIPLINES } from '../constants/studyDisciplines';
import { ResidenceHistoryEditor } from './ResidenceHistoryEditor';
import { TurnstileInvisible } from './TurnstileInvisible';
import { MonthYearPicker } from './MonthYearPicker';
import { safeErrorMessage } from '../services/api';

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239CA3AF'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

const RESIDENCES = ['Residence_name_1','Residence_name_2','Residence_name_3'];
const ACADEMIC_YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year', 'Master / Postgrad', 'PhD'];
const STUDY_LEVELS = ['BSc', 'MSc (Magistrale)', 'PhD'];

export function RegisterModal({ onClose, onSubmit, showToast }) {
  const [step, setStep] = useState(1); // 1 = registration details, 2 = email verification + final submission

  // --- Step 1: personal data ---
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [avatar, setAvatar] = useState('');
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarPercent, setAvatarPercent] = useState(0);
  const [avatarFile, setAvatarFile] = useState(null); 
  const [registrationToken, setRegistrationToken] = useState(''); 

  const [residence, setResidence] = useState('Residence_name_1');
  const [floor, setFloor] = useState('');
  const [room, setRoom] = useState('');
  const [phone, setPhone] = useState('');
  const [instagram, setInstagram] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [story, setStory] = useState('');

  const [firstYearInCollege, setFirstYearInCollege] = useState(`${new Date().getFullYear()}-09`);
  const [isCurrentlyInCollege, setIsCurrentlyInCollege] = useState(true);
  const [departureYear, setDepartureYear] = useState('');
  const [departureMonth, setDepartureMonth] = useState('');

  const [selectedCourse, setSelectedCourse] = useState('');
  const [academicYear, setAcademicYear] = useState('1st Year');
  const [studyLevel, setStudyLevel] = useState('BSc');

  // Single unified "date of birth" input: accepts a full date (DD/MM/YYYY
  // or DD/MM/YY) or just a bare year (YYYY). birthDate/birthYear below are
  // derived automatically from it via parseBirthInput (see utils/security.js).
  const [birthInput, setBirthInput] = useState('');
  const [birthInputError, setBirthInputError] = useState('');
  const [birthDate, setBirthDate] = useState(null);
  const [birthYear, setBirthYear] = useState(null);

  const handleBirthInputChange = (value) => {
    setBirthInput(value);
    const parsed = parseBirthInput(value);
    setBirthInputError(parsed.error || '');
    setBirthDate(parsed.birthDate);
    setBirthYear(parsed.birthYear);
  };

  // Geographic origin (reuses the existing GeoLocationPicker component)
  const [originContinent, setOriginContinent] = useState('');
  const [originCountry, setOriginCountry] = useState('');
  const [originRegion, setOriginRegion] = useState('');
  const [originCity, setOriginCity] = useState('');
  const [isOriginCountryValid, setIsOriginCountryValid] = useState(false);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  // --- Step 2: email OTP ---
  const [otpCode, setOtpCode] = useState('');
  const [otpTimer, setOtpTimer] = useState(120);
  const [isTimerActive, setIsTimerActive] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);

  const [residencyHistory, setResidencyHistory] = useState([]);
  const [isSubmittingFinal, setIsSubmittingFinal] = useState(false);
  const otpTurnstileRef = useRef(null);
  const submitTurnstileRef = useRef(null);
  // The sitekey is public and must be available at React build time.
// Cloudflare's official invisible test key is used only outside production when
// no explicit key was supplied. Production deployments must provide the real
// sitekey (or the explicit test key while TURNSTILE_TEST_MODE is enabled server-side).
const SITE_KEY = process.env.REACT_APP_TURNSTILE_SITE_KEY
  || (process.env.NODE_ENV !== 'production' ? '1x00000000000000000000BB' : '');

  useEffect(() => {
    if (!isTimerActive) return undefined;
    const interval = setInterval(() => setOtpTimer((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(interval);
  }, [isTimerActive]);

  useEffect(() => {
    if (otpTimer === 0) setIsTimerActive(false);
  }, [otpTimer]);

  const otpRequestedForEmailRef = useRef('');

  useEffect(() => {
    if (step !== 2 || !email.trim()) return undefined;

    const normalizedEmail = email.trim().toLowerCase();
    if (otpRequestedForEmailRef.current === normalizedEmail) {
      return undefined;
    }

    otpRequestedForEmailRef.current = normalizedEmail;
    let cancelled = false;

    const sendInitialVerificationCode = async () => {
      setIsSendingOtp(true);
      try {
        const token = await executeTurnstile(otpTurnstileRef);
        if (token === null) {
          otpRequestedForEmailRef.current = '';
          return;
        }

        await authApi.sendOtp(normalizedEmail, 'registration', token);

        if (!cancelled) {
          setOtpTimer(120);
          setIsTimerActive(true);
          showToast('Verification code sent to your email!', 'success');
        }
      } catch (err) {
        otpRequestedForEmailRef.current = '';
        if (!cancelled) {
          showToast(safeErrorMessage(err) || 'Failed to send verification code.', 'error');
        }
      } finally {
        if (!cancelled) {
          setIsSendingOtp(false);
        }
      }
    };

    sendInitialVerificationCode();

    return () => {
      cancelled = true;
    };
  }, [step, email, showToast]);

  const handleAvatarUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 15 * 1024 * 1024) {
      showToast('Choose a JPG, PNG, or WEBP image up to 15MB.', 'error');
      return;
    }
    setAvatarFile(file);
    setAvatar(URL.createObjectURL(file));
    showToast('Photo successfully selected!', 'info');
  };

  const validationCheck = useMemo(
    () => validateCollegeAndBirth(firstYearInCollege, isCurrentlyInCollege, departureYear ? `${departureYear}-${String(departureMonth || 1).padStart(2, '0')}` : '', birthDate, birthYear),
    [firstYearInCollege, isCurrentlyInCollege, departureYear, departureMonth, birthDate, birthYear]
  );
  const roomError = validateResidenceFields(floor, room);
  const finalCourseVal = selectedCourse;
  const isStep1Valid = Boolean(
    firstName.trim() && lastName.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    password.trim().length >= 8 && finalCourseVal.trim() && isOriginCountryValid &&
    originCountry.trim() && originCity.trim() && !birthInputError &&
    validationCheck.valid && floor && room && roomError.valid
  );

  const executeTurnstile = async (ref) => {
    if (!SITE_KEY) {
      if (process.env.NODE_ENV !== 'production') return 'dev-bypass-token';
      showToast('Bot protection is not configured.', 'error');
      return null;
    }

    try {
      const token = await ref.current?.execute?.();
      if (!token) {
        if (process.env.NODE_ENV !== 'production') return 'dev-bypass-token';
        showToast('Bot verification failed. Please check your connection or adblocker.', 'error');
        return null;
      }
      return token;
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        return 'dev-bypass-token';
      }
      showToast(safeErrorMessage(err) || 'Bot verification failed. Please check your connection or adblocker.', 'error');
      return null;
    }
  };

  // Step 1 -> 2: validate registration details only.
  // OTP delivery belongs to the verification step.
  const handleProceedToOtp = () => {
    if (!birthInput.trim()) {
      setBirthInputError('Date of birth is required.');
      showToast('Date of birth is required.', 'error');
      return;
    }

    if (!isStep1Valid) {
      showToast(
        birthInputError ||
        validationCheck.error ||
        (!roomError.valid ? roomError.error : '') ||
        (!isOriginCountryValid ? 'Select a valid country from the geographic dataset.' : '') ||
        'Please complete all required fields correctly.',
        'error'
      );
      return;
    }

    setStep(2);
  };

  const handleResendOtp = async () => {
    if (isTimerActive) return;
    setIsSendingOtp(true);
    try {
      const token = await executeTurnstile(otpTurnstileRef);
      if (token === null) return;
      await authApi.sendOtp(email.trim().toLowerCase(), 'registration', token);
      setOtpTimer(120);
      setIsTimerActive(true);
      showToast('A new code has been sent.', 'success');
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Failed to resend code.', 'error');
    } finally {
      setIsSendingOtp(false);
    }
  };

  // Step 2: verify the email OTP and prepare the final submission
  const handleVerifyRegistrationOtp = async () => {
    if (!/^\d{6}$/.test(otpCode.trim())) {
      showToast('Enter the 6-digit code.', 'error');
      return;
    }
    setIsVerifyingOtp(true);
    try {
      const otpRes = await authApi.verifyOtp(email.trim().toLowerCase(), otpCode.trim(), 'registration');
      const token = otpRes?.registrationToken;
      if (!token) throw new Error('Email verification succeeded but no registration token was returned.');
      setRegistrationToken(token);
      if (avatarFile) {
        try {
          setIsUploadingAvatar(true);
          showToast('Email verified! Uploading your profile picture...', 'info');
          const uploadedUrl = await uploadRegistrationAvatar(avatarFile, token, { onProgress: setAvatarPercent });
          setAvatar(uploadedUrl);
          showToast('Profile picture confirmed!', 'success');
        } catch (uploadErr) {
          showToast(`Notice: ${safeErrorMessage(uploadErr) || 'Photo upload failed, the default avatar will be used.'}`, 'error');
        } finally {
          setIsUploadingAvatar(false);
          setAvatarPercent(0);
        }
      }
      showToast('Email verified successfully. You can now submit your registration.', 'success');
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Invalid or expired code.', 'error');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleSubmitFinal = async (e) => {
    e.preventDefault();
    if (isSubmittingFinal) return;
    if (!registrationToken) {
      showToast('Verify your email before submitting.', 'error');
      return;
    }
    if (!isStep1Valid || !residence) {
      showToast(
        birthInputError ||
        validationCheck.error ||
        (!roomError.valid ? roomError.error : '') ||
        (!isOriginCountryValid ? 'Select a valid country from the geographic dataset.' : '') ||
        'Please complete the registration details correctly.',
        'error'
      );
      setStep(1);
      return;
    }
    const turnstileToken = await executeTurnstile(submitTurnstileRef);
    if (turnstileToken === null) return;
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    const finalCoords = Number.isFinite(parsedLat) && Number.isFinite(parsedLng)
      ? [parsedLat, parsedLng]
      : resolveLocationCoords(originContinent, originCountry, originRegion, originCity);
    const chosenAvatar = (avatar && avatar.startsWith('/uploads/')) ? avatar : DEFAULT_AVATAR;
    const resolvedBirthDate = birthDate || '';

    setIsSubmittingFinal(true);
    try {
      await onSubmit({
        firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim().toLowerCase(), password,
        avatar: chosenAvatar, residence, floor, room: normalizeRoomInput(room), phone, instagram, linkedin, story,
        firstYearInCollege: parseInt(firstYearInCollege.substring(0, 4), 10), firstMonthInCollege: parseInt(firstYearInCollege.substring(5, 7), 10), isCurrentlyInCollege,
        departureYear: isCurrentlyInCollege ? null : (departureYear ? parseInt(departureYear, 10) : null),
        departureMonth: isCurrentlyInCollege ? null : (departureMonth ? parseInt(departureMonth, 10) : null),
        course: finalCourseVal, academicYear, studyLevel, birthDate: resolvedBirthDate || null,
        birthYear: birthYear ? parseInt(birthYear, 10) : (resolvedBirthDate ? parseInt(resolvedBirthDate.substring(0, 4), 10) : null),
        originContinent, originCountry, originRegion: originRegion || 'N/A', originCity: originCity || 'N/A',
        coords: finalCoords, residencyHistory, emailVerificationToken: registrationToken, turnstileToken
      });
    } finally {
      setIsSubmittingFinal(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 md:p-8 shadow-2xl space-y-6">
        <div className="flex items-center justify-between border-b pb-4">
          <div>
            <h2 className="font-['Oswald'] text-2xl font-bold uppercase tracking-wider text-gray-900">
              Resident Registration
            </h2>
            <p className="text-xs text-gray-500">
              {step === 1 && 'Step 1 of 2: Personal Data, Residence & Origin'}
              {step === 2 && 'Step 2 of 2: Verify Email & Submit'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ================= STEP 1: PERSONAL DATA & ORIGIN ================= */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-2xl overflow-hidden bg-gray-100 border border-gray-200 shrink-0">
                <img src={avatar || DEFAULT_AVATAR} alt="Avatar preview" className="w-full h-full object-cover" />
              </div>
              <label className="flex-1">
                <span className="text-xs font-semibold text-gray-700 block mb-1">Profile Photo</span>
                <div className="inline-flex items-center gap-2 px-3 py-2 bg-[#FAF8F5] border border-gray-300 rounded-xl text-xs font-bold text-gray-700 cursor-pointer hover:border-[#B31217]">
                  <Upload className="w-3.5 h-3.5" />
                  {isUploadingAvatar ? 'Uploading...' : 'Choose Photo'}
                </div>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarUpload} className="hidden" disabled={isUploadingAvatar} />
                {isUploadingAvatar && <UploadProgress percent={avatarPercent} />}
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">First Name *</label>
                <input required type="text" value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Last Name *</label>
                <input required type="text" value={lastName} onChange={e => setLastName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Email *</label>
                <input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Password (min 8 chars) *</label>
                <input required type="password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="col-span-2 sm:col-span-2">
                <label className="text-xs font-semibold text-gray-700 block mb-1">Residence Section *</label>
                <select value={residence} onChange={e => setResidence(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm">
                  {RESIDENCES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Floor *</label>
                <select value={floor} onChange={e => setFloor(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm">
                  <option value="">Select floor</option>
                  {FLOOR_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Room *</label>
                <input type="text" inputMode="numeric" pattern="[0-9]+" value={room} onChange={e => setRoom(normalizeRoomInput(e.target.value))} className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm" />
                {(floor || room) && !roomError.valid && <p className="text-[11px] text-red-600 mt-1">{roomError.error}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-gray-700 block mb-1">Degree Course *</label>
                <input
                  list="study-disciplines"
                  value={selectedCourse}
                  onChange={e => { setSelectedCourse(e.target.value); }}
                  placeholder="Search or type your course"
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm"
                />
                <datalist id="study-disciplines">
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
                <label className="text-xs font-semibold text-gray-700 block mb-1">First Year in Residence</label>
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

            {!birthInputError && !validationCheck.valid && (firstYearInCollege || birthInput) && (
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
              onCountryValidityChange={setIsOriginCountryValid}
            />

            <ResidenceHistoryEditor value={residencyHistory} onChange={setResidencyHistory} showToast={showToast} primaryPeriod={{ startDate: firstYearInCollege, endDate: !isCurrentlyInCollege && departureYear && departureMonth ? `${departureYear}-${String(departureMonth).padStart(2, '0')}` : null, section: residence }} />

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
              <button
                type="button"
                onClick={handleProceedToOtp}
                disabled={false}
                className="px-5 py-2 bg-[#B31217] hover:bg-[#8A0E12] disabled:bg-gray-300 text-white rounded-xl text-xs font-bold shadow transition-all"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP 2: EMAIL VERIFICATION & SUBMISSION ================= */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-[#FAF8F5] border border-gray-200">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Verify your email address</p>
                  <p className="text-xs text-gray-500 mt-1">We sent a 6-digit verification code to <strong>{email}</strong>. After verification, submit your registration for peer endorsement.</p>
                </div>
              </div>
            </div>

            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={otpCode}
              onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="w-full px-3 py-3 border border-gray-300 rounded-xl text-center text-2xl font-mono tracking-[0.5em] focus:outline-none focus:border-[#B31217]"
            />

            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{isTimerActive ? `Resend available in ${otpTimer}s` : 'Code expired?'}</span>
              <button type="button" onClick={handleResendOtp} disabled={isTimerActive || isSendingOtp} className="font-bold text-[#B31217] disabled:text-gray-300">
                {isSendingOtp ? 'Sending...' : 'Resend Code'}
              </button>
            </div>

            {!registrationToken ? (
              <button
                type="button"
                onClick={handleVerifyRegistrationOtp}
                disabled={otpCode.trim().length !== 6 || isVerifyingOtp}
                className="w-full py-2.5 bg-[#B31217] hover:bg-[#8A0E12] disabled:bg-gray-300 text-white rounded-xl text-xs font-bold shadow transition-all"
              >
                {isVerifyingOtp ? 'Verifying...' : 'Verify Email'}
              </button>
            ) : (
              <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-xs text-emerald-700 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Email verified. Your registration is ready to be submitted.
              </div>
            )}

            <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-600">
              Identity verification uses <strong>email verification and peer endorsement</strong>.
            </div>

            <div className="flex justify-between gap-2 pt-3 border-t">
              <button type="button" onClick={() => setStep(1)} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Back</button>
              <button
                type="button"
                onClick={handleSubmitFinal}
                disabled={!registrationToken || isSubmittingFinal || isUploadingAvatar}
                className="px-5 py-2 bg-[#B31217] hover:bg-[#8A0E12] disabled:bg-gray-300 text-white rounded-xl text-xs font-bold shadow transition-all"
              >
                {isSubmittingFinal ? 'Submitting...' : 'Submit Registration'}
              </button>
            </div>
          </div>
        )}

        <TurnstileInvisible ref={otpTurnstileRef} siteKey={SITE_KEY} action="registration_otp" />
        <TurnstileInvisible ref={submitTurnstileRef} siteKey={SITE_KEY} action="registration_submit" />
      </div>
    </div>
  );
}

export function RegistrationSuccessModal({ onClose, onRedirectHome }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-md w-full p-8 shadow-2xl space-y-5 text-center border border-[#D5D3CC]">
        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
          <CheckCircle2 className="w-10 h-10" />
        </div>
        <h3 className="font-['Oswald'] text-2xl font-bold uppercase tracking-wider text-gray-900"> Registration received - Wait for approval</h3>
        <p className="text-xs text-gray-600 font-serif leading-relaxed">
          Your resident account has been queued for verification. You will receive an email as soon as your profile will be ready and confirmed by community.
        </p>
        <button onClick={onRedirectHome} className="w-full py-3 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow transition-all">
          Return to Directory
        </button>
      </div>
    </div>
  );
}
