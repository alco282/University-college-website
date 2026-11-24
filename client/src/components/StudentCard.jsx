import React from 'react';
import { MapPin, Award, Crown, ShieldCheck } from 'lucide-react';
import { canViewField, canViewPhoto, getSafeUrl } from '../utils/security';

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239CA3AF'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

export function StudentCard({ student, currentUser, onClick }) {
  const canSeeName = canViewField('firstName', student, currentUser);
  const canSeeResidence = canViewField('residence', student, currentUser);
  
  const photoObj = Array.isArray(student?.photos)
    ? student.photos.find(p => (typeof p === 'object' ? p?.url : p) === student?.avatar) || student.photos[0]
    : null;
    
  const canSeeMainPhoto = canViewPhoto(photoObj, student, currentUser);

  const displayName = canSeeName
    ? (student?.name || `${student?.firstName || ''} ${student?.lastName || ''}`.trim() || 'Resident Member')
    : 'Resident Member';

  const rawAvatarUrl = canSeeMainPhoto
    ? (student?.avatar || (typeof photoObj === 'object' ? photoObj?.url : photoObj) || DEFAULT_AVATAR)
    : DEFAULT_AVATAR;

  const displayAvatar = getSafeUrl(rawAvatarUrl, DEFAULT_AVATAR);

  // Badging logic based on institutional roles & status
  let badgeLabel = student?.isCurrentlyInCollege ? 'In Residence' : 'Alumni';
  let badgeColor = 'bg-emerald-700 text-white';

  if (student?.isFounder && !student?.isCurrentlyInCollege) {
    badgeLabel = 'FOUNDER';
    badgeColor = 'bg-[#FFD700] text-white font-black border border-amber-400';
  } else if (student?.role === 'superadmin') {
    badgeLabel = 'SuperAdmin';
    badgeColor = 'bg-purple-700 text-white';
  } else if (student?.role === 'admin') {
    badgeLabel = 'Admin';
    badgeColor = 'bg-amber-600 text-white';
  }

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="group bg-white rounded-2xl border border-[#E5E3DC] overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer flex flex-col transform hover:-translate-y-1 relative focus:outline-none focus:ring-2 focus:ring-[#B31217]"
    >
      <div className="p-3 bg-[#FAF8F5] pb-0">
        <div className="aspect-square w-full rounded-xl overflow-hidden bg-gray-100 relative">
          <img
            src={displayAvatar}
            alt={displayName}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = DEFAULT_AVATAR;
            }}
          />
          <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider shadow ${badgeColor}`}>
            {badgeLabel}
          </div>
        </div>
      </div>

      <div className="p-4 flex flex-col justify-between flex-1">
        <div>
          <h3 className="font-['Oswald'] text-xl font-bold tracking-wider text-[#1A1A1A] group-hover:text-[#B31217] transition-colors uppercase leading-tight truncate">
            {displayName}
          </h3>
          <p className="text-sm font-medium text-gray-600 mt-1 truncate">
            {student?.course || 'Undeclared'} ({student?.studyLevel || 'BSc'})
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {canSeeResidence ? `Section ${student?.residence || 'Undisclosed'}` : 'Restricted Section'}
          </p>
        </div>

        <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span className="flex items-center gap-1 truncate pr-2">
            <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <span className="truncate">
              {student?.originCity || 'N/A'}, {student?.originCountry || 'N/A'}
            </span>
          </span>
          <span className="font-semibold text-gray-700 shrink-0">
            {student?.birthYear || '—'}
          </span>
        </div>
      </div>
    </div>
  );
}