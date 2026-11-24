import React, { useState, useEffect } from 'react';
import { 
  User, Crown, Award, ShieldCheck, ShieldPlus, UserMinus, 
  Trash2, Flag, Edit3, MessageSquare, Check, ChevronLeft, ChevronRight, EyeOff, AlertCircle, ShieldAlert
} from 'lucide-react';
import { canViewField, canViewPhoto, getSafeUrl } from '../utils/security';
import { userApi } from '../services/api';
import { HexagonalBacheca } from './HexagonalBacheca';
import { ResidenceHistoryTable } from './ResidenceHistoryEditor';

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239CA3AF'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

function InputField({ label, value }) {
  const renderValue = (input) => {
    if (input === null || input === undefined || input === '') {
      return '—';
    }

    if (
      typeof input === 'string' ||
      typeof input === 'number' ||
      typeof input === 'boolean'
    ) {
      return String(input);
    }

    // Never allow an arbitrary object to reach React as a child.
    if (Array.isArray(input)) {
      return input
        .map((item) => {
          if (
            item === null ||
            item === undefined
          ) {
            return '';
          }

          if (
            typeof item === 'string' ||
            typeof item === 'number'
          ) {
            return String(item);
          }

          if (typeof item === 'object') {
            return (
              item.name ||
              item.label ||
              item.title ||
              item.value ||
              ''
            );
          }

          return String(item);
        })
        .filter(Boolean)
        .join(', ') || '—';
    }

    if (typeof input === 'object') {
      return (
        input.name ||
        input.label ||
        input.title ||
        input.value ||
        '—'
      );
    }

    return String(input);
  };

  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-gray-700 block">
        {label}
      </label>

      <div className="w-full min-w-0 px-4 py-2.5 rounded-xl border text-sm font-medium shadow-sm bg-white border-[#D5D3CC] text-gray-800 break-words">
        <span>{renderValue(value)}</span>
      </div>
    </div>
  );
}

export function ProfileView({ 
  student, 
  currentUser, 
  contactsShared = {}, 
  showToast, 
  onEndorse, 
  onRequestContact, 
  onReportStudent, 
  onPromoteToAdmin, 
  onPromoteToSuperAdmin, 
  onDemoteToStudent, 
  onDeleteUserAccount, 
  onUpdateBacheca, 
  onOpenEditProfile 
}) {
  const [activeSlide, setActiveSlide] = useState(0);
  const [showEndorseWarningModal, setShowEndorseWarningModal] = useState(false);
  const [endorserData, setEndorserData] = useState(null);
  const [loadingEndorsers, setLoadingEndorsers] = useState(false);

  useEffect(() => {
    setActiveSlide(0);
  }, [student?.id]);

  const isOwner = currentUser && currentUser.id === student?.id;
  const isSuperAdmin = currentUser?.role === 'superadmin';
  const isAdmin = currentUser?.role === 'admin' || isSuperAdmin;

  useEffect(() => {
    if (isSuperAdmin && student?.id) {
      setLoadingEndorsers(true);
      userApi.getEndorsers(student.id)
        .then(data => setEndorserData(data))
        .catch(() => setEndorserData(null))
        .finally(() => setLoadingEndorsers(false));
    } else {
      setEndorserData(null);
    }
  }, [student?.id, isSuperAdmin]);

  const canSeeName = canViewField('firstName', student, currentUser);
  const canSeeLastName = canViewField('lastName', student, currentUser);
  const canSeeResidence = canViewField('residence', student, currentUser);
  const canSeeFloorRoom = canViewField('floorRoom', student, currentUser);
  const canSeeCourse = canViewField('course', student, currentUser);
  const canSeeStudyLevel = canViewField('studyLevel', student, currentUser);
  const canSeeAcademicYear = canViewField('academicYear', student, currentUser);
  const canSeeYearsInCollege = canViewField('yearsInCollege', student, currentUser);
  const canSeeResidenceHistory = canViewField('residencyHistory', student, currentUser);
  const canSeeOrigin = canViewField('originLocation', student, currentUser);
  const canSeeBirth = canViewField('birthDate', student, currentUser);
  const canSeeStory = canViewField('story', student, currentUser);
  const canSeeBacheca = canViewField('bacheca', student, currentUser);


  const parsedPhotos = Array.isArray(student?.photos)
    ? student.photos
    : (typeof student?.photos === 'string' ? (() => { try { return JSON.parse(student.photos); } catch { return []; } })() : []);

  const allPhotos = parsedPhotos.length > 0
    ? parsedPhotos
    : [{ url: student?.avatar || DEFAULT_AVATAR, privacy: 'public' }];
    
  const visiblePhotos = allPhotos.filter(p => canViewPhoto(p, student, currentUser));
  const photosList = visiblePhotos.length > 0 ? visiblePhotos : [{ url: DEFAULT_AVATAR, privacy: 'public' }];

  const sharedKey = currentUser ? `${currentUser.id}_${student?.id}` : null;
  const sharedContactData = sharedKey ? contactsShared[sharedKey] : null;

  return (
    <div className="space-y-6 animate-fadeIn max-w-6xl mx-auto">
      {/* SuperAdmin Inspector Bar */}
      {isSuperAdmin && (
        <div className="p-4 bg-slate-900 border-2 border-purple-500/50 rounded-2xl text-white shadow-xl space-y-3">
          <div className="flex items-center gap-2 border-b border-purple-800/60 pb-2.5">
            <Crown className="w-5 h-5 text-purple-400" />
            <span className="font-['Oswald'] text-sm uppercase tracking-wider font-bold text-purple-200">
              SuperAdmin Inspector Bar
            </span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-purple-200">
              <span>Peer Endorsements ({endorserData?.endorsers?.length || 0} / 3 Required):</span>
              {loadingEndorsers && <span className="text-[10px] text-gray-400">Loading details...</span>}
            </div>
            {endorserData?.endorsers && endorserData.endorsers.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                {endorserData.endorsers.map((endorser, idx) => (
                  <div key={endorser.id || idx} className="bg-slate-800 p-2.5 rounded-xl border border-slate-700 text-xs space-y-1">
                    <div className="font-bold text-white truncate">{idx + 1}. {endorser.name}</div>
                    <p className="text-[10px] text-gray-400 truncate">{endorser.email}</p>
                    <p className="text-[10px] text-purple-300 font-medium">Sez. {endorser.residence || 'N/A'}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">No peer endorsements registered for this user yet.</p>
            )}
          </div>
        </div>
      )}

      {/* Header and Controls */}
      <div className="p-4 bg-white rounded-2xl border border-[#E5E3DC] flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <User className="w-6 h-6 text-[#B31217]" />
          <div>
            <h4 className="font-bold text-sm text-gray-900 flex items-center gap-2">
              <span>{student?.isCurrentlyInCollege ? 'In Residence' : 'Alumni'} Member</span>
              {student?.isFounder && !student?.isCurrentlyInCollege ? (
                <span className="bg-[#FFD700] text-white border border-amber-400 text-[10px] font-extrabold px-2 py-0.5 rounded uppercase flex items-center gap-1 shadow-sm">
                  <Award className="w-3.5 h-3.5 text-white" /> Founder
                </span>
              ) : student?.role === 'superadmin' ? (
                <span className="bg-purple-100 text-purple-900 text-[10px] font-extrabold px-2 py-0.5 rounded uppercase flex items-center gap-1">
                  <Crown className="w-3.5 h-3.5 text-purple-700" /> SuperAdmin
                </span>
              ) : student?.role === 'admin' ? (
                <ShieldCheck className="w-4 h-4 text-amber-600" title="Admin" />
              ) : null}
            </h4>
            <p className="text-xs text-gray-500">{student?.course} • {student?.studyLevel || 'Degree'}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isSuperAdmin && !isOwner && student?.role !== 'superadmin' && (
            <button onClick={() => onPromoteToSuperAdmin(student?.id)} className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold shadow transition-all">
              <Crown className="w-3.5 h-3.5" />
              <span>Make SuperAdmin</span>
            </button>
          )}

          {isSuperAdmin && !isOwner && student?.role !== 'superadmin' && (
            <>
              {student?.role !== 'admin' ? (
                <button onClick={() => onPromoteToAdmin(student?.id)} className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow transition-all">
                  <ShieldPlus className="w-3.5 h-3.5" />
                  <span>Make Admin</span>
                </button>
              ) : (
                <button onClick={() => onDemoteToStudent(student?.id)} className="flex items-center gap-1.5 px-3.5 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-xl text-xs font-bold shadow transition-all">
                  <UserMinus className="w-3.5 h-3.5" />
                  <span>Demote to Resident</span>
                </button>
              )}
              <button onClick={() => onDeleteUserAccount(student?.id)} className="flex items-center gap-1.5 px-3.5 py-2 bg-red-700 hover:bg-red-800 text-white rounded-xl text-xs font-bold shadow transition-all">
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Account</span>
              </button>
            </>
          )}

          {isAdmin && !isOwner && student?.role !== 'superadmin' && (
            <button onClick={() => onReportStudent(student)} className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold transition-all">
              <Flag className="w-3.5 h-3.5 text-amber-700" />
              <span>Report User</span>
            </button>
          )}

          {isOwner && (
            <button onClick={onOpenEditProfile} className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-gray-100 text-gray-800 rounded-xl text-xs font-bold border border-gray-300 shadow transition-all">
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Profile & Credentials</span>
            </button>
          )}

          {!isOwner && currentUser && (
            <button onClick={() => onRequestContact(student)} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow transition-all">
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Request Contact Info</span>
            </button>
          )}

          {!student?.verified && !isOwner && (
            <button 
              onClick={() => setShowEndorseWarningModal(true)} 
              className="px-4 py-2 rounded-xl text-xs font-bold bg-[#B31217] hover:bg-[#8A0E12] text-white shadow flex items-center gap-1.5"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Confirm Resident Identity</span>
            </button>
          )}
        </div>
      </div>

      {/* Profile Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 space-y-8">
          <div>
            <h1 className="font-['Oswald'] text-4xl sm:text-5xl font-bold text-[#1A1A1A] tracking-wider uppercase leading-none">
              {canSeeName ? student?.firstName : 'Resident'} {canSeeLastName ? student?.lastName : ''}
            </h1>
            <p className="text-base text-gray-500 mt-2 font-medium">{student?.academicYear || 'Student'} • {student?.course} ({student?.studyLevel || 'BSc'})</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField label="First Name" value={canSeeName ? student?.firstName : 'Private'} />
            <InputField label="Last Name" value={canSeeLastName ? student?.lastName : 'Private'} />
            <InputField label="Residence Section" value={canSeeResidence ? `Sezione ${student?.residence || '—'}` : 'Private'} />
            <InputField label="Floor & Room" value={canSeeFloorRoom ? `${student?.floor || '—'} / ${student?.room || '—'}` : 'Private'} />
            <InputField label="Degree Course / Discipline" value={canSeeCourse ? student?.course : 'Private'} />
            <InputField label="Study Level" value={canSeeStudyLevel ? (student?.studyLevel || 'BSc') : 'Private'} />
            <InputField label="Academic Year" value={canSeeAcademicYear ? (student?.academicYear || 'In progress') : 'Private'} />
            <InputField label="First Year/Month in Residence" value={canSeeYearsInCollege ? `${student?.firstYearInCollege || '—'}-${student?.firstMonthInCollege || '01'}` : 'Private'} />
<InputField 
              label="Origin Location" 
              value={canSeeOrigin ? `${student?.originCity || '—'}, ${student?.originRegion || '—'}, ${student?.originCountry || '—'}` : 'Private'} 
            />
            <InputField label="Email" value={isOwner || isSuperAdmin ? (student?.email || 'Not set') : (sharedContactData?.email || 'Request contact to view')} />
            <InputField 
              label="Date / Year of Birth" 
              value={
                canSeeBirth 
                  ? (student?.birthDate && !isNaN(new Date(student.birthDate).getTime())
                      ? new Date(student.birthDate).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) 
                      : (student?.birthYear || '—')) 
                  : 'Private'
              } 
            />
            <InputField label="Phone" value={isOwner || isSuperAdmin ? (student?.phone || 'Not set') : (sharedContactData?.phone || 'Request contact to view')} />
            <InputField label="Instagram" value={isOwner || isSuperAdmin ? (student?.instagram || 'Not set') : (sharedContactData?.instagram || 'Request contact to view')} />
            <InputField label="LinkedIn" value={isOwner || isSuperAdmin ? (student?.linkedin || 'Not set') : (sharedContactData?.linkedin || 'Request contact to view')} />
          </div>

          <div className="space-y-4 pt-4 border-t border-[#E5E3DC]">
            <h2 className="font-['Playfair_Display'] italic text-3xl font-normal text-[#1A1A1A]">Residence History</h2>
            {canSeeResidenceHistory ? (
              <ResidenceHistoryTable
                history={
                  Array.isArray(student?.residencyHistory)
                    ? student.residencyHistory
                    : []
                }
              />
            ) : (
              <div className="p-4 bg-gray-100 rounded-2xl text-xs text-gray-500 italic flex items-center gap-2">
                <EyeOff className="w-4 h-4" />
                <span>Residence history is private.</span>
              </div>
            )}
          </div>

          <div className="space-y-4 pt-4 border-t border-[#E5E3DC]">
            <h2 className="font-['Playfair_Display'] italic text-3xl font-normal text-[#1A1A1A]">My Story</h2>
            {canSeeStory ? (
              <div className="prose text-gray-700 text-base leading-relaxed whitespace-pre-line font-serif">{student?.story || 'No biography provided yet.'}</div>
            ) : (
              <div className="p-4 bg-gray-100 rounded-2xl text-xs text-gray-500 italic flex items-center gap-2">
                <EyeOff className="w-4 h-4" />
                <span>Biography is set to private.</span>
              </div>
            )}
          </div>

          <div className="space-y-4 pt-6 border-t border-[#E5E3DC]">
            {canSeeBacheca ? (
              <HexagonalBacheca items={Array.isArray(student?.bacheca) ? student.bacheca : []} isOwner={Boolean(isOwner)} onUpdateBacheca={onUpdateBacheca} showToast={showToast} />
            ) : (
              <div className="p-6 bg-gray-100 rounded-3xl text-xs text-gray-500 italic flex items-center justify-center gap-2">
                <EyeOff className="w-4 h-4" />
                <span>The interactive board is restricted.</span>
              </div>
            )}
          </div>
        </div>

        {/* Image Carousel */}
        <div className="lg:col-span-5 sticky top-24">
          <div className="bg-white p-4 rounded-3xl border border-[#E5E3DC] shadow-lg space-y-4">
            <div className="relative aspect-[3/4] w-full rounded-2xl overflow-hidden bg-gray-100 select-none group">
              <img 
                src={getSafeUrl(typeof photosList[activeSlide] === 'object' ? photosList[activeSlide].url : photosList[activeSlide], DEFAULT_AVATAR)} 
                alt="slide" 
                className="w-full h-full object-cover transition-all duration-300" 
              />
              {photosList.length > 1 && (
                <>
                  <button onClick={() => setActiveSlide((prev) => (prev - 1 + photosList.length) % photosList.length)} className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/40 text-white p-2 rounded-full backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button onClick={() => setActiveSlide((prev) => (prev + 1) % photosList.length)} className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/40 text-white p-2 rounded-full backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <div className="absolute top-3 right-3 bg-black/50 backdrop-blur-md text-white text-[11px] font-semibold px-2.5 py-1 rounded-full">
                    {activeSlide + 1} / {photosList.length}
                  </div>
                </>
              )}
            </div>

            {photosList.length > 1 && (
              <div className="flex items-center justify-center gap-1.5 py-1">
                {photosList.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveSlide(idx)}
                    className={`transition-all duration-200 rounded-full ${
                      activeSlide === idx ? 'w-6 h-2 bg-[#B31217]' : 'w-2 h-2 bg-gray-300 hover:bg-gray-400'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showEndorseWarningModal && (
        <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-6 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-xl border border-amber-200 space-y-5 my-auto">
            <div className="flex items-center gap-3 text-amber-700">
              <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center shrink-0">
                <ShieldAlert className="w-7 h-7 text-amber-600" />
              </div>
              <div>
                <h3 className="font-['Oswald'] text-xl font-bold uppercase tracking-wide text-gray-900">
                  Identity Confirmation
                </h3>
                <p className="text-xs text-amber-600 font-bold uppercase">Community Safety Check</p>
              </div>
            </div>

            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-950 space-y-2 leading-relaxed">
              <p className="font-bold">
                Please make sure to only confirm people you personally know.
              </p>
              <p>
                By proceeding, you vouch that <strong>{student?.name || `${student?.firstName || ''} ${student?.lastName || ''}`.trim() || 'this resident'}</strong> resided in Residence  (Sez. {student?.residence}) during the declared period.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowEndorseWarningModal(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowEndorseWarningModal(false);
                  onEndorse(student?.id);
                }}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-md flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Confirm Identity</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}