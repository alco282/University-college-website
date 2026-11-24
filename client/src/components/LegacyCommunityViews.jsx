import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import * as Lucide from 'lucide-react';
import { request, communityApi, uploadMediaFile } from '../services/api';
import { UploadProgress } from './UploadProgress';
import { getSafeUrl, canViewPhoto } from '../utils/security';
import { safeErrorMessage } from '../services/api';

// Optional city appended to addresses for map lookups (set REACT_APP_CITY_NAME in client/.env).
const CITY_NAME = process.env.REACT_APP_CITY_NAME || '';

const {
  AlertCircle, AlertTriangle, ArrowLeft, BookOpen, Check, ChevronRight, Clock,
  Edit3, ExternalLink, Heart, Mail, MapPin, MessageSquare, Music, Phone,
  Plus, Rocket, Sparkles, Star, Trash2, Trophy, Upload, User, UserCheck,
  UserPlus, Users, X
} = Lucide;

const API_BASE = '/api';
function buildGoogleMapsEmbedUrl(address) {
  const rawAddress = String(address || '').trim();
  if (!rawAddress) return '';

  // The Maps Embed API endpoint requires a configured API key and was causing
  // every preview to fall back when REACT_APP_GOOGLE_MAPS_EMBED_API_KEY was
  // absent or restricted. The public Google Maps embed URL can render a
  // place/address without exposing an application key in the browser.
  const query = [rawAddress, CITY_NAME].filter(Boolean).join(', ');
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
}

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239CA3AF'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3 3 3-3 3-3 3-3-1.34-3-3 1.34-3 3-3 3 1.34 3 3 3 3-1.34 3-3.22-6-3.22-6-3.22z'/%3E%3C/svg%3E";

/**
 * Legacy-compatible response adapter over the hardened API client.
 * It keeps the old view code's Response-like `ok/json()` contract while
 * routing every mutating request through the centralized CSRF/session
 * protection in services/api.js.
 */
async function secureLegacyFetch(endpoint, options = {}) {
  const normalizedEndpoint = typeof endpoint === 'string' && endpoint.startsWith('/api/')
    ? endpoint.slice(4)
    : endpoint;

  let body = options.body;
  if (typeof body === 'string' && options.headers?.['Content-Type']?.includes('application/json')) {
    try { body = JSON.parse(body); } catch { /* request() will surface the server validation error */ }
  }

  const data = await request(normalizedEndpoint, { ...options, body });

  // The hardened backend uses paginated envelopes. Legacy views expect arrays.
  const payload = (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Array.isArray(data.items) &&
    !String(normalizedEndpoint).includes('/time-capsule/')
  ) ? data.items : data;

  return {
    ok: true,
    status: 200,
    json: async () => payload
  };
}


/**
 * Mounts an <iframe> only while its box is near the viewport.
 *
 * A page with dozens of cards used to create dozens of cross-origin iframes
 * (Google Maps, Spotify) at once. Each one is a full browsing context with its
 * own network, CPU and memory cost, which is what froze the site on busy
 * pages. Now only the iframes close to the screen exist; the others are cheap
 * placeholders and are torn down again after they have been off-screen for a
 * moment, so the number of live iframes stays small however long the list is.
 */
function LazyEmbed({ src, title, height = '100%', label = 'Loading…', allow, referrerPolicy, allowFullScreen, rootMargin = '300px' }) {
  const holderRef = useRef(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const node = holderRef.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setActive(true);
      return undefined;
    }

    let releaseTimer = null;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
        setActive(true);
      } else if (!releaseTimer) {
        // Keep it alive briefly so quick scroll-backs do not reload it.
        releaseTimer = setTimeout(() => { setActive(false); releaseTimer = null; }, 4000);
      }
    }, { rootMargin });

    observer.observe(node);
    return () => {
      observer.disconnect();
      if (releaseTimer) clearTimeout(releaseTimer);
    };
  }, [rootMargin]);

  return (
    <div ref={holderRef} style={{ width: '100%', height }} className="bg-gray-50">
      {active && src ? (
        <iframe
          width="100%"
          height="100%"
          frameBorder="0"
          loading="lazy"
          title={title}
          src={src}
          allow={allow}
          allowFullScreen={allowFullScreen}
          referrerPolicy={referrerPolicy}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[10px] font-bold uppercase tracking-wide text-gray-400">
          {label}
        </div>
      )}
    </div>
  );
}

function RecipePlaceholder({ title }) {
  return (
    <div
      role="img"
      aria-label={`No photo available for ${title || 'this recipe'}`}
      className="w-full h-52 rounded-2xl border border-gray-200 shadow-sm bg-gradient-to-br from-amber-50 to-orange-100 flex flex-col items-center justify-center gap-2 text-amber-700/70"
    >
      <svg viewBox="0 0 24 24" className="w-14 h-14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 14a4 4 0 0 1-.5-7.9A5 5 0 0 1 15 4.6a4.5 4.5 0 0 1 3 8.4V20H6z" />
        <path d="M6 17h12" />
      </svg>
      <span className="text-[11px] font-bold uppercase tracking-wider">No photo yet</span>
    </div>
  );
}

function FeatureHeader({ title, description, backLabel, onBack }) {
  return (
    <div className="bg-white rounded-3xl p-6 border border-[#D5D3CC] shadow-sm mb-6">
      {onBack && <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold text-gray-600 hover:text-[#B31217]"><ArrowLeft className="w-4 h-4" /> {backLabel || "Back"}</button>}
      <h2 className="font-['Oswald'] text-2xl font-bold uppercase tracking-wider text-gray-900 mb-1">{title}</h2>
      <p className="text-xs text-gray-600 font-serif italic max-w-3xl leading-relaxed">"{description}"</p>
    </div>
  );
}

function ModerationActions({ endpoint, itemId, currentUser, showToast, onSuccess }) {
  const isSuperAdmin = currentUser?.role === 'superadmin';
  const isAdmin = currentUser?.role === 'admin';

  const handleReport = async (e) => {
    e.stopPropagation();
    if (!window.confirm('Do you want to report this content to the safety moderators?')) return;
    try {
      const res = await secureLegacyFetch(`${API_BASE}${endpoint}/${itemId}/report`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      if (res.ok) {
        if (data.status === 'removed') {
          showToast('Content automatically removed due to excessive reports.', 'info');
          onSuccess?.();
        } else {
          showToast(`Report recorded (${data.reportsCount} total).`, 'success');
        }
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error while submitting the report.', 'error');
    }
  };

  const handleAdminModerate = async (e) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to administratively remove this item?')) return;
    try {
      const res = await secureLegacyFetch(`${API_BASE}${endpoint}/${itemId}/moderate`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json();
      if (res.ok) {
        if (data.status === 'deleted') {
          showToast('Item removed from the database for moderation.', 'info');
          onSuccess?.();
        } else if (data.status === 'pending_second_admin') {
          showToast(`Removal vote recorded (${data.adminVotes}/2 Admins). Waiting for the second vote.`, 'info');
        }
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error during moderation.', 'error');
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <button onClick={handleReport} className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="Report inappropriate content">
        <AlertTriangle className="w-3.5 h-3.5" />
      </button>
      {(isAdmin || isSuperAdmin) && (
        <button onClick={handleAdminModerate} className="p-1.5 text-gray-400 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors" title={isSuperAdmin ? "Immediate deletion (SuperAdmin)" : "Admin removal vote (requires 2 approvals)"}>
          <Lucide.ShieldAlert className="w-3.5 h-3.5 text-red-600" />
        </button>
      )}
    </div>
  );
}

function ContactExchangeModal({ targetName, targetRoleDescription, currentUser, onSend, onClose }) {
  const hasEmail = Boolean(currentUser?.email && currentUser.email.trim() !== '');
  const hasPhone = Boolean(currentUser?.phone && currentUser.phone.trim() !== '');
  const [selectedType, setSelectedType] = useState(hasPhone ? 'phone' : (hasEmail ? 'email' : ''));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const handleConfirm = async (e) => {
    e.preventDefault();
    if (!selectedType) return;
    setError('');
    try { await onSend(selectedType, note); } catch (err) { setError(safeErrorMessage(err) || 'Unable to transmit the contact request.'); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/65 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-fadeIn border border-[#D5D3CC]">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[#B31217]" />
            <h3 className="font-['Oswald'] text-lg font-bold uppercase tracking-wider text-gray-900">Share Contact Details</h3>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-full"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-xs text-gray-600 font-serif leading-relaxed">
          You are contacting <strong>{targetName}</strong> regarding <em>{targetRoleDescription}</em>. Choose which verified channel from your profile you wish to disclose:
        </p>

        <form onSubmit={handleConfirm} className="space-y-3 pt-1">
          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700" role="alert">{error}</div>}
          <label className={`flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer ${!hasPhone ? 'bg-gray-50 border-gray-200 opacity-40 cursor-not-allowed' : selectedType === 'phone' ? 'bg-red-50 border-[#B31217] text-gray-900 shadow-sm' : 'hover:bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center gap-3">
              <input type="radio" name="contactMethod" disabled={!hasPhone} checked={selectedType === 'phone'} onChange={() => setSelectedType('phone')} className="text-[#B31217] focus:ring-[#B31217]" />
              <div><span className="text-xs font-bold block">Mobile Phone</span><span className="text-[11px] text-gray-500">{hasPhone ? currentUser.phone : 'Not set in profile'}</span></div>
            </div>
            <Phone className={`w-4 h-4 ${hasPhone ? 'text-gray-700' : 'text-gray-300'}`} />
          </label>

          <label className={`flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer ${!hasEmail ? 'bg-gray-50 border-gray-200 opacity-40 cursor-not-allowed' : selectedType === 'email' ? 'bg-red-50 border-[#B31217] text-gray-900 shadow-sm' : 'hover:bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center gap-3">
              <input type="radio" name="contactMethod" disabled={!hasEmail} checked={selectedType === 'email'} onChange={() => setSelectedType('email')} className="text-[#B31217] focus:ring-[#B31217]" />
              <div><span className="text-xs font-bold block">Institutional Email</span><span className="text-[11px] text-gray-500">{hasEmail ? currentUser.email : 'Not set in profile'}</span></div>
            </div>
            <Mail className={`w-4 h-4 ${hasEmail ? 'text-gray-700' : 'text-gray-300'}`} />
          </label>

          <div className="pt-1">
            <textarea rows={2} placeholder="Add an optional friendly message or meeting idea..." value={note} maxLength={1000} onChange={e => setNote(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs bg-[#FAF8F5] focus:outline-none focus:border-[#B31217]" />
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
            <button type="submit" disabled={!selectedType} className="px-5 py-2 bg-[#B31217] hover:bg-[#8A0E12] disabled:bg-gray-300 text-white rounded-xl text-xs font-bold shadow">Share & Transmit</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}



export function VirtualStudyRoomsView({ currentUser, showToast, onSelectStudent, onBack }) {
  const [rooms, setRooms] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [targetRoomForJoin, setTargetRoomForJoin] = useState(null);
  const [editingRoom, setEditingRoom] = useState(null);

  // Creation form
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [cloudLink, setCloudLink] = useState('');
  const [chatLink, setChatLink] = useState('');

  // Chosen contact channel
  const hasPhone = Boolean(currentUser?.phone && currentUser.phone.trim() !== '');
  const hasEmail = Boolean(currentUser?.email && currentUser.email.trim() !== '');
  const [chosenChannel, setChosenChannel] = useState(hasPhone ? 'phone' : (hasEmail ? 'email' : ''));

  const fetchRooms = () => {
    secureLegacyFetch(`${API_BASE}/community/study-rooms`, { credentials: 'include' })
      .then(res => res.json())
      .then(d => setRooms(Array.isArray(d) ? d : []));
  };

  useEffect(() => { 
    fetchRooms(); 
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!chosenChannel) {
      showToast('Select the contact you want to share in the room.', 'error');
      return;
    }

    const contactValue = chosenChannel === 'phone' ? currentUser.phone : currentUser.email;
    
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/study-rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          subject, 
          description, 
          meetingLink, 
          cloudLink, 
          chatLink, 
          chosenContact: `${chosenChannel.toUpperCase()}: ${contactValue}` 
        })
      });

      if (res.ok) {
        showToast('Virtual study room created successfully!', 'success');
        setShowCreateModal(false);
        setSubject('');
        setDescription('');
        setMeetingLink('');
        setCloudLink('');
        setChatLink('');
        fetchRooms();
      } else {
        showToast('Error creating the room.', 'error');
      }
    } catch {
      showToast('Connection error.', 'error');
    }
  };

  const handleJoinConfirmed = async (contactType, note) => {
    const contactValue = contactType === 'phone' ? currentUser.phone : currentUser.email;
    const res = await secureLegacyFetch(`${API_BASE}/community/study-rooms/${targetRoomForJoin.id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ 
        chosenContact: `${contactType.toUpperCase()}: ${contactValue}${note ? ` (Note: ${note})` : ''}` 
      })
    });
    if (res.ok) {
      showToast('Request sent! The room creator will be notified.', 'success');
      setTargetRoomForJoin(null);
      fetchRooms();
    } else {
      const err = await res.json();
      showToast(err.error || 'Failed to request.', 'error');
    }
  };

  const handleLeave = async (room) => {
    const isCreator = room.creator_id === currentUser?.id;
    const msg = isCreator
      ? 'You created this room. If you leave, ownership passes to the next member (or the room is deleted if you are the only one). Continue?'
      : `Leave "${room.subject}"?`;

    if (!window.confirm(msg)) return;

    const res = await secureLegacyFetch(`${API_BASE}/community/study-rooms/${room.id}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: '{}'
    });

    if (res.ok) {
      showToast('You left the study room.', 'success');
      fetchRooms();
    } else {
      const err = await res.json();
      showToast(err.error || 'Failed to leave.', 'error');
    }
  };

  const handleUpdateLinks = async (e) => {
    e.preventDefault();
    const res = await secureLegacyFetch(`${API_BASE}/community/study-rooms/${editingRoom.id}/links`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        meetingLink: editingRoom.meeting_link,
        cloudLink: editingRoom.cloud_link,
        chatLink: editingRoom.chat_link,
        description: editingRoom.description
      })
    });
    if (res.ok) {
      showToast('Room resources updated successfully!', 'success');
      setEditingRoom(null);
      fetchRooms();
    } else {
      showToast('Error during the update.', 'error');
    }
  };

  const myRooms = rooms.filter(r => (r.members || []).some(m => m.id === currentUser?.id));
  const availableRooms = rooms.filter(r => !(r.members || []).some(m => m.id === currentUser?.id));

  return (
    <div className="space-y-8 animate-fadeIn max-w-6xl mx-auto pb-12">
      <FeatureHeader 
        title="Virtual Study Rooms" 
        backLabel="Back to Board"
        onBack={onBack}
        description="A dedicated space for exam preparation: create or join a room to share lecture links, cloud notes, WhatsApp/Telegram groups, and direct contacts with your coursemates."
      />

      <div className="flex justify-end">
        <button 
          onClick={() => setShowCreateModal(true)} 
          className="px-5 py-2.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Create Virtual Study Room
        </button>
      </div>

      {/* SECTION 1: YOUR ROOMS (JOINED) */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 border-b pb-2">
          <UserCheck className="w-5 h-5 text-emerald-700" />
          <h3 className="font-['Oswald'] text-lg uppercase font-bold text-gray-900">
            Your Study Rooms ({myRooms.length})
          </h3>
        </div>

        {myRooms.length === 0 ? (
          <p className="text-xs text-gray-500 italic p-4 bg-white rounded-2xl border">
            You are not part of any study room yet. Create one or request access to an open one!
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {myRooms.map(r => (
              <div key={r.id} className="bg-white rounded-3xl p-6 border-2 border-emerald-600/30 shadow-sm space-y-4 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start gap-2">
                    <h4 className="font-['Oswald'] text-xl uppercase font-bold text-gray-900 leading-tight">
                      {r.subject}
                    </h4>
                    
                    <div className="flex items-center gap-2 shrink-0">

                      <ModerationActions 
                        endpoint="/community/study-rooms" 
                        itemId={r.id} 
                        currentUser={currentUser} 
                        showToast={showToast} 
                        onSuccess={fetchRooms}
                        level={2}
                      />
                    </div>
                  </div>
                  
                  <p className="text-xs text-gray-600 font-serif mt-1">
                    {r.description || 'No additional notes specified.'}
                  </p>

                  {/* Active Links Box */}
                  <div className="mt-4 p-3.5 bg-gray-50 rounded-2xl border border-gray-200 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-gray-700">Video Session:</span>
                      {r.meeting_link ? (
                        <a href={getSafeUrl(r.meeting_link)} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1 font-bold">
                          Join Lesson <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : <span className="text-gray-400">Not set</span>}
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="font-bold text-gray-700">Drive/Cloud Folder:</span>
                      {r.cloud_link ? (
                        <a href={getSafeUrl(r.cloud_link)} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline flex items-center gap-1 font-bold">
                          Open Drive / Notes <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : <span className="text-gray-400">Not set</span>}
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="font-bold text-gray-700">WhatsApp / Telegram Chat:</span>
                      {r.chat_link ? (
                        <a href={getSafeUrl(r.chat_link)} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline flex items-center gap-1 font-bold">
                          Join Group <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : <span className="text-gray-400">Not set</span>}
                    </div>
                  </div>

                  {/* Members Directory */}
                  <div className="mt-4 space-y-2">
                    <span className="text-[11px] font-bold uppercase text-gray-400 block">
                      Members and Shared Contacts ({(r.members || []).length}):
                    </span>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {(r.members || []).map(m => (
                        <div key={m.id} className="p-2 rounded-xl bg-[#FAF8F5] border border-gray-200 flex items-center justify-between text-xs">
                          <button 
                            type="button"
                            onClick={() => onSelectStudent && onSelectStudent(m.id)}
                            className="font-bold text-[#B31217] hover:underline"
                          >
                            {m.name}
                          </button>
                          <span className="text-[11px] font-mono text-gray-600 bg-white px-2 py-0.5 rounded border">
                            {m.contact}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 mt-4">
                    <button
                      onClick={() => handleLeave(r)}
                      className="px-3 py-1 border border-[#B31217] text-[#B31217] hover:bg-[#B31217] hover:text-white rounded-lg text-[11px] font-bold"
                    >
                      Leave Room
                    </button>
                    {r.creator_id === currentUser?.id && (
                      <button 
                        onClick={async () => {
                          if (!window.confirm('Do you want to delete this study room?')) return;
                          const res = await secureLegacyFetch(`${API_BASE}/community/study-rooms/${r.id}`, { method: 'DELETE', credentials: 'include' });
                          if (res.ok) {
                            showToast('Room deleted.', 'info');
                            fetchRooms();
                          } else {
                            const err = await res.json().catch(() => ({}));
                            showToast(err.error || 'Failed to delete room.', 'error');
                          }
                        }}
                        className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-[11px] font-bold flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    )}
                    <button 
                      onClick={() => setEditingRoom(r)} 
                      className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-[11px] font-bold flex items-center gap-1"
                    >
                      <Edit3 className="w-3.5 h-3.5" /> Edit Links
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SECTION 2: OTHER AVAILABLE ROOMS */}
      <div className="space-y-4 pt-4">
        <div className="flex items-center gap-2 border-b pb-2">
          <BookOpen className="w-5 h-5 text-gray-700" />
          <h3 className="font-['Oswald'] text-lg uppercase font-bold text-gray-900">
            Open Study Rooms ({availableRooms.length})
          </h3>
        </div>

        {availableRooms.length === 0 ? (
          <p className="text-xs text-gray-500 italic p-4 bg-white rounded-2xl border">
            There are no other open rooms at the moment.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {availableRooms.map(r => (
              <div key={r.id} className="bg-white rounded-3xl p-5 border border-gray-200 shadow-sm flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-bold text-base text-gray-900">{r.subject}</h4>
                    <ModerationActions 
                      endpoint="/community/study-rooms" 
                      itemId={r.id} 
                      currentUser={currentUser} 
                      showToast={showToast} 
                      onSuccess={fetchRooms}
                      level={2}
                    />
                  </div>
                  <p className="text-xs text-gray-600 font-serif mt-2 line-clamp-3">
                    {r.description || 'Study group for exam preparation.'}
                  </p>
                </div>
                
                <div className="pt-3 border-t flex items-center justify-between">
                  <span className="text-xs text-gray-500">{r.member_count ?? (r.members || []).length} Members</span>
                  {r.my_request_status === 'pending' ? (
                    <span className="px-4 py-2 bg-gray-100 text-gray-500 rounded-xl text-xs font-bold">Request pending</span>
                  ) : (
                    <button
                      onClick={() => setTargetRoomForJoin(r)}
                      className="px-4 py-2 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow transition-all"
                    >
                      Request Access
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/65 flex items-center justify-center p-4">
          <form 
            onSubmit={handleCreate} 
            className="bg-white rounded-3xl p-6 md:p-7 max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-4 border border-[#D5D3CC] shadow-2xl animate-fadeIn"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-['Oswald'] text-xl font-bold uppercase text-gray-900">
                  Create Virtual Study Room
                </h3>
                <p className="text-xs text-gray-500">Share materials, chats, and lessons for your exam.</p>
              </div>
              <button 
                type="button" 
                onClick={() => setShowCreateModal(false)} 
                className="p-1 text-gray-400 hover:text-gray-600 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Subject / Course *</label>
                <input 
                  required 
                  type="text" 
                  placeholder="e.g. Calculus II, Private Law..." 
                  value={subject} 
                  onChange={e => setSubject(e.target.value)} 
                  className="w-full px-3 py-2 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" 
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Course topics and syllabus</label>
                <textarea 
                  rows={3} 
                  placeholder="Exam details, required notes, deadlines..." 
                  value={description} 
                  onChange={e => setDescription(e.target.value)} 
                  className="w-full px-3 py-2 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" 
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Virtual Classroom Link (Teams / Zoom / Meet)</label>
                <input 
                  type="url" 
                  placeholder="https://teams.microsoft.com/..." 
                  value={meetingLink} 
                  onChange={e => setMeetingLink(e.target.value)} 
                  className="w-full px-3 py-2 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" 
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Notes / Cloud Folder (Google Drive / OneDrive)</label>
                <input 
                  type="url" 
                  placeholder="https://drive.google.com/..." 
                  value={cloudLink} 
                  onChange={e => setCloudLink(e.target.value)} 
                  className="w-full px-3 py-2 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" 
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Chat Group (WhatsApp / Telegram)</label>
                <input 
                  type="url" 
                  placeholder="https://chat.whatsapp.com/... or https://t.me/..." 
                  value={chatLink} 
                  onChange={e => setChatLink(e.target.value)} 
                  className="w-full px-3 py-2 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" 
                />
              </div>

              {/* Explicit choice of which contact to share */}
              <div className="bg-[#FAF8F5] p-3.5 rounded-2xl border border-gray-200 space-y-2">
                <label className="text-xs font-bold text-gray-800 block">
                  Which contact do you want to show to room members? *
                </label>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                    !hasPhone 
                      ? 'bg-gray-100 opacity-40 cursor-not-allowed border-gray-200' 
                      : chosenChannel === 'phone' 
                      ? 'bg-red-50 border-[#B31217] text-gray-900 font-bold' 
                      : 'bg-white border-gray-200'
                  }`}>
                    <input 
                      type="radio" 
                      name="createRoomChannel" 
                      disabled={!hasPhone} 
                      checked={chosenChannel === 'phone'} 
                      onChange={() => setChosenChannel('phone')} 
                      className="text-[#B31217]"
                    />
                    <Phone className="w-3.5 h-3.5 text-gray-500" />
                    <span className="truncate">{hasPhone ? currentUser.phone : 'Phone not set'}</span>
                  </label>

                  <label className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                    !hasEmail 
                      ? 'bg-gray-100 opacity-40 cursor-not-allowed border-gray-200' 
                      : chosenChannel === 'email' 
                      ? 'bg-red-50 border-[#B31217] text-gray-900 font-bold' 
                      : 'bg-white border-gray-200'
                  }`}>
                    <input 
                      type="radio" 
                      name="createRoomChannel" 
                      disabled={!hasEmail} 
                      checked={chosenChannel === 'email'} 
                      onChange={() => setChosenChannel('email')} 
                      className="text-[#B31217]"
                    />
                    <Mail className="w-3.5 h-3.5 text-gray-500" />
                    <span className="truncate">{hasEmail ? currentUser.email : 'Email not set'}</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button 
                type="button" 
                onClick={() => setShowCreateModal(false)} 
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                disabled={!chosenChannel}
                className="px-5 py-2 bg-[#B31217] hover:bg-[#8A0E12] disabled:bg-gray-300 text-white rounded-xl text-xs font-bold shadow"
              >
                Start Room
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {editingRoom && (
        <div className="fixed inset-0 z-[9999] bg-black/65 flex items-center justify-center p-4">
          <form 
            onSubmit={handleUpdateLinks} 
            className="bg-white rounded-3xl p-6 md:p-7 max-w-md w-full space-y-4 border border-[#D5D3CC] shadow-2xl animate-fadeIn"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-['Oswald'] text-xl font-bold uppercase text-gray-900">
                Update Room Resources
              </h3>
              <button 
                type="button" 
                onClick={() => setEditingRoom(null)} 
                className="p-1 text-gray-400 hover:text-gray-600 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Classroom Link (Teams/Zoom/Meet):</label>
                <input 
                  type="url" 
                  value={editingRoom.meeting_link || ''} 
                  onChange={e => setEditingRoom({ ...editingRoom, meeting_link: e.target.value })} 
                  className="w-full px-3 py-2 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" 
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Cloud Folder (Drive/OneDrive):</label>
                <input 
                  type="url" 
                  value={editingRoom.cloud_link || ''} 
                  onChange={e => setEditingRoom({ ...editingRoom, cloud_link: e.target.value })} 
                  className="w-full px-3 py-2 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" 
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Chat WhatsApp / Telegram:</label>
                <input 
                  type="url" 
                  value={editingRoom.chat_link || ''} 
                  onChange={e => setEditingRoom({ ...editingRoom, chat_link: e.target.value })} 
                  className="w-full px-3 py-2 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" 
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Notes and Syllabus:</label>
                <textarea 
                  rows={3} 
                  value={editingRoom.description || ''} 
                  onChange={e => setEditingRoom({ ...editingRoom, description: e.target.value })} 
                  className="w-full px-3 py-2 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" 
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button 
                type="button" 
                onClick={() => setEditingRoom(null)} 
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="px-5 py-2 bg-gray-900 hover:bg-black text-white rounded-xl text-xs font-bold shadow"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CONTACT EXCHANGE MODAL TO JOIN */}
      {targetRoomForJoin && (
        <ContactExchangeModal 
          targetName={targetRoomForJoin.subject}
          targetRoleDescription="joining the study room"
          currentUser={currentUser}
          onSend={handleJoinConfirmed}
          onClose={() => setTargetRoomForJoin(null)}
        />
      )}
    </div>
  );
}

export function AnnualTimeCapsuleView({ currentUser, showToast, onBack }) {
  const [activeTab, setActiveTab] = useState('current');
  const [capsuleData, setCapsuleData] = useState({ capsule: null, entries: [] });
  const [archiveCapsules, setArchiveCapsules] = useState([]);
  const [selectedArchiveCapsule, setSelectedArchiveCapsule] = useState(null);
  const [content, setContent] = useState('');
  const [entryType, setEntryType] = useState('quote');
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const mySection = currentUser?.residence || 'Residence_name_1';

  const fetchCurrentCapsule = useCallback(() => {
    secureLegacyFetch(`${API_BASE}/community/time-capsule/${encodeURIComponent(mySection)}`, { credentials: 'include' })
      .then(res => res.json()).then(setCapsuleData).catch(() => setCapsuleData({ capsule: null, entries: [] }));
  }, [mySection]);

  useEffect(() => { if (activeTab === 'current') fetchCurrentCapsule(); }, [activeTab, fetchCurrentCapsule]);
  useEffect(() => {
    if (activeTab !== 'archive') return;
    secureLegacyFetch(`${API_BASE}/community/time-capsule/archive`, { credentials: 'include' })
      .then(res => res.json()).then(setArchiveCapsules).catch(() => setArchiveCapsules([]));
  }, [activeTab]);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try {
      const data = { url: await uploadMediaFile(file, { onProgress: setUploadPercent }) }; setPhotoUrl(data.url); showToast('Photo uploaded from device!', 'success');
    } catch { showToast('Error uploading photo', 'error'); } finally { setUploading(false); setUploadPercent(0); }
  };

  const handleAddEntry = async (e) => {
    e.preventDefault(); if (!capsuleData.capsule) return;
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/time-capsule/${capsuleData.capsule.id}/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ entryType, content, photoUrl }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save memory.');
      showToast('Memory proposed to section capsule!', 'success'); setContent(''); setPhotoUrl(''); fetchCurrentCapsule();
    } catch (err) { showToast(safeErrorMessage(err) || 'Failed to save memory.', 'error'); }
  };

  const handleConfirmEntry = async (id) => {
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/time-capsule/entries/${id}/confirm`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to confirm memory.');
      showToast(data.is_confirmed ? 'Memory confirmed and sealed.' : 'Confirmation recorded.', 'success');
      fetchCurrentCapsule();
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Unable to confirm memory.', 'error');
    }
  };

  const handleDeleteEntry = async (id) => {
    if (!window.confirm('Delete this memory? This action cannot be undone.')) return;
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/time-capsule/entries/${id}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Unable to delete memory.');
      showToast('Memory deleted.', 'info'); fetchCurrentCapsule();
    } catch (err) { showToast(safeErrorMessage(err) || 'Unable to delete memory.', 'error'); }
  };

  const openArchiveCapsule = async (capsule) => {
    try {
      const data = await secureLegacyFetch(
        `${API_BASE}/community/time-capsule/archive/${encodeURIComponent(capsule.id)}/entries`,
        { credentials: 'include' }
      ).then(r => r.json());
      setSelectedArchiveCapsule({ ...capsule, entries: data.entries || [] });
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Unable to load archive.', 'error');
    }
  };

  return <div className="space-y-6 animate-fadeIn">
    <FeatureHeader title="Section Time Capsule" backLabel="Back to Board" onBack={onBack} description="The historical memory of your residence: preserve photos, anecdotes, and memories of the current academic year. The capsule opens every September 1, closes on July 31, and becomes public automatically three years after closure." />
    <div className="flex gap-4 border-b border-gray-200">
      <button onClick={() => setActiveTab('current')} className={`pb-2 text-sm font-bold border-b-2 ${activeTab === 'current' ? 'border-[#B31217] text-[#B31217]' : 'border-transparent text-gray-400'}`}>Active Capsule • {mySection} Section</button>
      <button onClick={() => setActiveTab('archive')} className={`pb-2 text-sm font-bold border-b-2 ${activeTab === 'archive' ? 'border-[#B31217] text-[#B31217]' : 'border-transparent text-gray-400'}`}>Permanent Historic Archive (All Sections)</button>
    </div>
    {activeTab === 'current' ? <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <form onSubmit={handleAddEntry} className="bg-white rounded-3xl p-6 border shadow-sm space-y-3 h-fit">
        <h4 className="font-['Oswald'] text-base uppercase font-bold text-gray-900">Add Memory ({mySection} Section)</h4>
        {!capsuleData.acceptingEntries && (
          <div className="rounded-xl bg-gray-100 p-3 text-[11px] text-gray-600 font-bold">
            {capsuleData.isUnlocked
              ? 'This historic capsule is public and closed to new contributions.'
              : 'The annual contribution window is currently closed. It reopens on September 1.'}
          </div>
        )}
        <select disabled={!capsuleData.acceptingEntries} value={entryType} onChange={e => setEntryType(e.target.value)} className="w-full p-2 border rounded-xl text-xs disabled:bg-gray-100"><option value="quote">Quote / Funny Saying</option><option value="text">Story of the Floor</option><option value="photo">Group Photograph</option></select>
        <textarea disabled={!capsuleData.acceptingEntries} required rows={4} placeholder="Record the anecdote..." value={content} onChange={e => setContent(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs disabled:bg-gray-100" />
        {entryType === 'photo' && <label className={`cursor-pointer bg-gray-100 hover:bg-gray-200 border rounded-xl p-2.5 text-xs font-bold text-gray-700 flex items-center justify-center gap-2 ${!capsuleData.acceptingEntries ? 'opacity-50 pointer-events-none' : ''}`}><Upload className="w-4 h-4" /><span>{uploading ? 'Uploading...' : (photoUrl ? 'Change Local Photo' : 'Upload Photo from Device')}</span><input disabled={!capsuleData.acceptingEntries} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" /></label>}
        {entryType === 'photo' && uploading && <UploadProgress percent={uploadPercent} />}
        <button disabled={!capsuleData.acceptingEntries} type="submit" className="w-full py-2.5 bg-[#B31217] disabled:bg-gray-300 text-white font-bold rounded-xl text-xs shadow">Add to Capsule</button>
      </form>
      <div className="lg:col-span-2 space-y-4"><h4 className="font-['Oswald'] text-base uppercase font-bold text-gray-900">Current Capsule • {mySection} ({capsuleData.entries.length} items)</h4>
        {capsuleData.entries.map(e => <div key={e.id} className="bg-white rounded-2xl p-4 border space-y-2 shadow-sm"><div className="flex justify-between items-center border-b pb-1.5"><span className="text-xs font-bold">{e.author_name}</span><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${e.is_confirmed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{e.is_confirmed ? 'Sealed (3/3 Confirmed)' : `${(e.confirmed_by || []).length}/3 Confirms`}</span></div><p className="text-xs font-serif italic text-gray-800">"{e.content}"</p>{e.photo_url && <img src={getSafeUrl(e.photo_url, DEFAULT_AVATAR)} alt="Memory" className="w-full max-h-56 object-cover rounded-xl" />}<div className="flex gap-2 flex-wrap">{capsuleData.acceptingEntries && !e.is_confirmed && !e.confirmed_by?.includes(currentUser?.id) && e.author_id !== currentUser?.id && <button type="button" onClick={() => handleConfirmEntry(e.id)} className="mt-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-[11px] font-bold">Confirm Memory</button>}{e.author_id === currentUser?.id && !e.is_confirmed && <button type="button" onClick={() => handleDeleteEntry(e.id)} className="mt-2 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-[11px] font-bold">Delete Memory</button>}<div className="mt-2 ml-auto"><ModerationActions endpoint="/community/time-capsule/entries" itemId={e.id} currentUser={currentUser} showToast={showToast} onSuccess={fetchCurrentCapsule} level={1} /></div></div></div>)}
      </div>
    </div> : <div className="space-y-4">
      {selectedArchiveCapsule ? <div className="space-y-4"><button type="button" onClick={() => setSelectedArchiveCapsule(null)} className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-600 hover:text-[#B31217]"><ArrowLeft className="w-4 h-4" /> Back to archive</button><h4 className="font-['Oswald'] text-lg uppercase font-bold">{selectedArchiveCapsule.section} - {selectedArchiveCapsule.academic_year}</h4><div className="grid grid-cols-1 md:grid-cols-3 gap-5">{selectedArchiveCapsule.entries.map(e => <div key={e.id} className="bg-white rounded-3xl p-5 border shadow-sm space-y-2"><span className="text-[10px] uppercase font-bold text-purple-700"></span><p className="font-serif text-sm text-gray-800">"{e.content}"</p>{e.photo_url && <img src={getSafeUrl(e.photo_url, DEFAULT_AVATAR)} alt="Historical memory" className="w-full h-40 object-cover rounded-xl" />}</div>)}</div></div> : <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">{archiveCapsules.map(c => <button type="button" key={c.id} onClick={() => openArchiveCapsule(c)} className="text-left bg-white rounded-3xl p-5 border hover:border-[#B31217] shadow-sm"><div className="text-[10px] uppercase font-bold text-purple-700"></div><div className="font-['Oswald'] text-lg uppercase font-bold text-gray-900 mt-1">{c.section} - {c.academic_year}</div><div className="text-xs text-gray-500 mt-2">Click to inspect the contents.</div></button>)}</div>}
    </div>}
  </div>;
}

export function TheWorldOfAcademicsView({ currentUser, students = [], showToast, onSelectStudent, leafletReady, onBack }) {
  const [exchanges, setExchanges] = useState([]);
  const [loading, setLoading] = useState(false);

  const [viewMode, setViewMode] = useState('map');
  const [selectedUniName, setSelectedUniName] = useState('');
  const [selectedReview, setSelectedReview] = useState(null);

  const [contactNoticeModal, setContactNoticeModal] = useState(null);

  // Review form
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingExchange, setEditingExchange] = useState(null);
  const [universityName, setUniversityName] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [programType, setProgramType] = useState('Erasmus+');
  const [academicsRating, setAcademicsRating] = useState(5);
  const [costOfLivingRating, setCostOfLivingRating] = useState(3);
  const [housingRating, setHousingRating] = useState(4);
  const [neighborhoodAdvice, setNeighborhoodAdvice] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isSearchingUni, setIsSearchingUni] = useState(false);
  const [saving, setSaving] = useState(false);

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  const [universityCoords, setUniversityCoords] = useState(null);

  const fetchExchanges = async () => {
    setLoading(true);
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/academics-map`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setExchanges(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExchanges();
  }, []);

  const getAuthorAvatar = useCallback((userId) => {
    if (!userId || !students.length) return null;
    const author = students.find(s => s.id === userId);
    if (!author) return null;
    const authorPhoto = author.photos?.find(p => (typeof p === 'object' ? p.url : p) === author.avatar) || author.photos?.[0];
    const canSeePhoto = canViewPhoto(authorPhoto, author, currentUser);
    if (canSeePhoto && author.avatar && author.avatar !== DEFAULT_AVATAR) return author.avatar;
    if (canSeePhoto && authorPhoto) {
      const url = typeof authorPhoto === 'object' ? authorPhoto.url : authorPhoto;
      if (url && url !== DEFAULT_AVATAR) return url;
    }
    return null;
  }, [students, currentUser]);

  const universityGroups = useMemo(() => {
    const map = new Map();
    exchanges.forEach(ex => {
      const key = (ex.university_name || 'University').trim();
      if (!map.has(key)) {
        map.set(key, {
          name: key,
          city: ex.city,
          country: ex.country,
          coords: ex.coords,
          reviews: []
        });
      }
      map.get(key).reviews.push(ex);
    });
    return Array.from(map.values());
  }, [exchanges]);

  const currentUniReviews = useMemo(() => {
    if (!selectedUniName) return [];
    return exchanges.filter(e => (e.university_name || '').trim().toLowerCase() === selectedUniName.trim().toLowerCase());
  }, [exchanges, selectedUniName]);

  // Leaflet Map Init
  useEffect(() => {
    if (viewMode !== 'map' || !mapContainerRef.current) return;
    const L = window.L;
    if (!L && !leafletReady) return;

    let isMounted = true;
    const initMap = async () => {
      let key = process.env.REACT_APP_CARTO_API_KEY;
      if (!key && typeof API_BASE !== 'undefined') {
        try {
          const res = await secureLegacyFetch(`${API_BASE}/config`);
          if (res.ok) {
            const cfg = await res.json();
            key = cfg.cartoKey;
          }
        } catch (e) {
          console.error(e);
        }
      }

      if (!isMounted || mapInstanceRef.current || !mapContainerRef.current) return;

      const map = (window.L || L).map(mapContainerRef.current, {
        center: [48.8566, 12.3522],
        zoom: 4,
        zoomControl: false
      });

      const tileUrl = key
        ? `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${key}`
        : `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png`;

      (window.L || L).tileLayer(tileUrl, {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 18
      }).addTo(map);

      (window.L || L).control.zoom({ position: 'bottomright' }).addTo(map);
      markersLayerRef.current = (window.L || L).layerGroup().addTo(map);
      mapInstanceRef.current = map;

      setTimeout(() => {
        if (mapInstanceRef.current) mapInstanceRef.current.invalidateSize();
      }, 250);
    };

    initMap();

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersLayerRef.current = null;
      }
    };
  }, [leafletReady, viewMode]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    const L = window.L;
    if (!map || !markersLayer || !L || viewMode !== 'map') return;

    markersLayer.clearLayers();

    universityGroups.forEach(group => {
      if (!group.coords || group.coords.length !== 2 || isNaN(group.coords[0]) || isNaN(group.coords[1])) return;

      const customHtml = `
        <div style="background: #B31217; color: white; width: 34px; height: 34px; border-radius: 9999px; display: flex; align-items: center; justify-content: center; border: 2.5px solid #ffffff; box-shadow: 0 3px 10px rgba(0,0,0,0.35); font-family: 'Oswald', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer;">
          ${group.reviews.length}
        </div>
      `;

      const icon = L.divIcon({
        html: customHtml,
        className: '',
        iconSize: [34, 34],
        iconAnchor: [17, 17]
      });

      const marker = L.marker(group.coords, { icon }).addTo(markersLayer);
      const popupEl = document.createElement('div');
      popupEl.style.cssText = 'font-family: sans-serif; padding: 6px; min-width: 190px;';

      const title = document.createElement('h4');
      title.style.cssText = 'margin: 0; font-size: 14px; font-weight: bold; color: #111;';
      title.textContent = group.name;

      const place = document.createElement('p');
      place.style.cssText = 'margin: 3px 0 8px 0; font-size: 11px; color: #666;';
      place.textContent = `${group.city}, ${group.country}`;

      const count = document.createElement('div');
      count.style.cssText = 'font-size: 11px; font-weight: 600; color: #B31217; margin-bottom: 8px;';
      count.textContent = `${group.reviews.length} ${group.reviews.length === 1 ? 'review available' : 'reviews available'}`;

      const button = document.createElement('button');
      button.type = 'button';
      button.style.cssText = 'width: 100%; background: #B31217; color: white; border: none; padding: 7px 12px; border-radius: 8px; font-size: 11px; font-weight: bold; cursor: pointer;';
      button.textContent = 'See all reviews →';
      button.addEventListener('click', () => {
        setSelectedUniName(group.name);
        setViewMode('university_reviews');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      popupEl.append(title, place, count, button);
      marker.bindPopup(popupEl, { offset: [0, -8] });
    });
  }, [universityGroups, viewMode]);


  const handleUniSearch = (val) => {
    setUniversityName(val);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (val.trim().length < 2) {
      setSuggestions([]);
      setIsSearchingUni(false);
      return;
    }
    setIsSearchingUni(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val + ' university')}&format=json&addressdetails=1&limit=6`, {
          headers: { 'Accept-Language': 'en' }
        });
        if (res.ok) {
          const data = await res.json();
          const parsed = data.map(item => {
            const addr = item.address || {};
            const itemCity = addr.city || addr.town || addr.municipality || addr.county || '';
            const itemCountry = addr.country || '';
            const cleanTitle = (item.namedetails?.name || item.name || item.display_name.split(',')[0]).trim();
            return { name: cleanTitle, city: itemCity, country: itemCountry, lat: item.lat, lon: item.lon };
          }).filter(p => p.name);
          setSuggestions(parsed);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsSearchingUni(false);
      }
    }, 400);
  };

  const handleSelectSuggestion = (sug) => {
    setUniversityName(sug.name || '');

    if (sug.city) setCity(sug.city);
    if (sug.country) setCountry(sug.country);

    const lat = Number.parseFloat(sug.lat);
    const lon = Number.parseFloat(sug.lon);

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      setUniversityCoords([lat, lon]);
    } else {
      setUniversityCoords(null);
    }

    setSuggestions([]);
  };

  const handleOpenCreate = () => {
    setEditingExchange(null);

    const existingCoords = currentUniReviews[0]?.coords;

    setUniversityCoords(
      Array.isArray(existingCoords) && existingCoords.length === 2
        ? existingCoords
        : null
    );

    setUniversityName(selectedUniName || '');

    if (currentUniReviews[0]) {
      setCity(currentUniReviews[0].city);
      setCountry(currentUniReviews[0].country);
    } else {
      setCity('');
      setCountry('');
    }

    setProgramType('Erasmus+');
    setAcademicsRating(5);
    setCostOfLivingRating(3);
    setHousingRating(4);
    setNeighborhoodAdvice('');
    setShowAddModal(true);
  };

  const handleOpenEdit = (rev) => {
    setEditingExchange(rev);
    setUniversityName(rev.university_name);
    setCity(rev.city);
    setCountry(rev.country);
    setProgramType(rev.program_type || 'Erasmus+');
    setAcademicsRating(rev.academics_rating || 5);
    setCostOfLivingRating(rev.cost_of_living_rating || 3);
    setHousingRating(rev.housing_rating || 4);
    setNeighborhoodAdvice(rev.neighborhood_advice || '');
    setShowAddModal(true);
  };

  const handleSendContactNotice = async (contactType, note) => {
    if (!contactNoticeModal?.user_id || !currentUser) {
      showToast('Unable to send contact: user not available.', 'error');
      return;
    }

    try {
      await communityApi.sendContactNotice({
        targetUserId: String(contactNoticeModal.user_id),
        featureTitle: 'The World of Academics',
        itemTitle: `${contactNoticeModal.university_name || 'Academic experience'} — ${contactNoticeModal.city || ''}`.trim(),
        chosenContactType: contactType,
        customNote: note || ''
      });

      showToast('Review author notified!', 'success');
      setContactNoticeModal(null);
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Unable to send the contact request.', 'error');
    }
  };

  const handleDeleteExchange = async (id) => {
    if (!window.confirm('Are you sure you want to delete this review?')) return;
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/academics-map/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        showToast('Review deleted!', 'info');
        if (selectedReview?.id === id) {
          setViewMode('university_reviews');
          setSelectedReview(null);
        }
        fetchExchanges();
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error during deletion.', 'error');
    }
  };

  const handleSaveAcademicExchange = async (e) => {
    e.preventDefault();
    if (!universityName.trim() || !city.trim() || !country.trim()) {
      showToast('Fill in the university, city, and country fields.', 'error');
      return;
    }

    setSaving(true);
    try {
      let resolvedCoords = editingExchange?.coords || universityCoords;

      if (
        !resolvedCoords ||
        resolvedCoords.length !== 2 ||
        !Number.isFinite(Number(resolvedCoords[0])) ||
        !Number.isFinite(Number(resolvedCoords[1]))
      ) {
        showToast('Please select the university from the search suggestions so its exact location can be identified.', 'error');
        setSaving(false);
        return;
      }

      resolvedCoords = [
        Number(resolvedCoords[0]),
        Number(resolvedCoords[1])
      ];

      const url = editingExchange ? `${API_BASE}/community/academics-map/${editingExchange.id}` : `${API_BASE}/community/academics-map`;
      const method = editingExchange ? 'PUT' : 'POST';

      const res = await secureLegacyFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          universityName: universityName.trim(),
          city: city.trim(),
          country: country.trim(),
          programType,
          academicsRating,
          costOfLivingRating,
          housingRating,
          neighborhoodAdvice,
          coords: resolvedCoords
        })
      });

      if (res.ok) {
        showToast(editingExchange ? 'Review updated successfully!' : 'Academic experience saved!', 'success');
        setShowAddModal(false);
        fetchExchanges();
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Connection error.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-6xl mx-auto pb-12">
      {viewMode === 'map' && (
        <div className="space-y-6">
          <FeatureHeader 
            title="The World of Academics"
        backLabel="Back to Board"
        onBack={onBack}
            description="The map of universities and study-abroad stays of our residents: explore partner universities, click the pins to read reviews, and contact those who have already been there."
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-gray-500 font-semibold">
              Universities reviewed: <strong className="text-gray-900">{universityGroups.length}</strong> • Experiences: <strong className="text-gray-900">{exchanges.length}</strong>
            </div>

            <button onClick={handleOpenCreate} className="px-5 py-2.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add University Review
            </button>
          </div>

          <div className="relative z-0 isolate w-full h-[520px] rounded-3xl overflow-hidden border border-[#D5D3CC] shadow-lg bg-[#FAF8F5]">
            <div ref={mapContainerRef} className="w-full h-full" />
          </div>

          <div className="space-y-3 pt-2">
            <h3 className="font-['Oswald'] text-lg font-bold uppercase text-gray-900">Explore by University</h3>
            {universityGroups.length === 0 ? (
              <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-[#D5D3CC] text-xs text-gray-500">
                No reviews yet. Add your experience!
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {universityGroups.map(group => (
                  <div
                    key={group.name}
                    onClick={() => {
                      setSelectedUniName(group.name);
                      setViewMode('university_reviews');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="p-5 bg-white rounded-2xl border border-[#D5D3CC] shadow-sm hover:shadow-md hover:border-[#B31217] transition-all cursor-pointer flex flex-col justify-between space-y-3 group"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-red-100 text-[#B31217] px-2 py-0.5 rounded-full">
                          {group.reviews.length} {group.reviews.length === 1 ? 'Review' : 'Reviews'}
                        </span>
                        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-[#B31217] transition-colors" />
                      </div>
                      <h4 className="font-bold text-base text-gray-900 mt-2 group-hover:text-[#B31217] transition-colors">{group.name}</h4>
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                        <MapPin className="w-3.5 h-3.5 text-gray-400" /> {group.city}, {group.country}
                      </p>
                    </div>
                    <span className="text-[11px] font-bold text-[#B31217] hover:underline">Open Reviews →</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {viewMode === 'university_reviews' && (
        <div className="space-y-6 animate-fadeIn">
          <div className="flex items-center justify-between border-b pb-4">
            <button onClick={() => setViewMode('map')} className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-full text-xs font-bold text-gray-700 shadow-sm">
              <ArrowLeft className="w-4 h-4" /> Back to Map
            </button>
            <button onClick={handleOpenCreate} className="px-4 py-2 bg-[#B31217] text-white rounded-xl text-xs font-bold shadow flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Write a Review for this University
            </button>
          </div>

          <div className="bg-white rounded-3xl p-6 md:p-8 border border-[#D5D3CC] shadow-sm space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#B31217]">{currentUniReviews[0]?.city}, {currentUniReviews[0]?.country}</span>
            <h2 className="font-['Oswald'] text-3xl md:text-4xl font-bold uppercase text-gray-900">{selectedUniName}</h2>
          </div>

          <div className="space-y-4">
            {currentUniReviews.map((review, idx) => {
              const authorPhotoUrl = getAuthorAvatar(review.user_id);
              const isMyReview = review.user_id === currentUser?.id;

              return (
                <div key={review.id || idx} className="bg-white rounded-3xl p-6 border border-[#D5D3CC] shadow-sm hover:shadow-md transition-all space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
                    <div className="flex items-center gap-3">
                      {authorPhotoUrl ? (
                        <img src={getSafeUrl(authorPhotoUrl, DEFAULT_AVATAR)} alt={review.user_name} className="w-11 h-11 rounded-full object-cover border-2 border-[#D5D3CC] shadow-sm shrink-0" />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-red-100 text-[#B31217] flex items-center justify-center font-bold text-sm shrink-0 shadow-inner">
                          {review.user_name ? review.user_name.charAt(0).toUpperCase() : 'U'}
                        </div>
                      )}
                      <div>
                        <h4 className="font-bold text-sm text-gray-900">{review.user_name}</h4>
                        <p className="text-[11px] text-gray-500">Program: <span className="font-semibold text-gray-800">{review.program_type || 'Erasmus+'}</span></p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="bg-amber-100 text-amber-900 px-2.5 py-1 rounded-full font-bold">Academics: ★ {review.academics_rating || 5}/5</span>
                        <span className="bg-blue-100 text-blue-900 px-2.5 py-1 rounded-full font-bold">Cost: {review.cost_of_living_rating || 3}/5</span>
                        <span className="bg-emerald-100 text-emerald-900 px-2.5 py-1 rounded-full font-bold">Housing: {review.housing_rating || 4}/5</span>
                      </div>

                      {isMyReview && (
                        <div className="flex items-center gap-1 border-l pl-2 ml-1">
                          <button onClick={() => handleOpenEdit(review)} className="p-1 text-gray-600 hover:text-purple-700" title="Edit Review"><Edit3 className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleDeleteExchange(review.id)} className="p-1 text-gray-400 hover:text-red-600" title="Delete Review"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      )}

                      <ModerationActions endpoint="/community/academics-map" itemId={review.id} currentUser={currentUser} showToast={showToast} onSuccess={fetchExchanges} level={2} />
                    </div>
                  </div>

                  <p className="text-xs md:text-sm text-gray-700 font-serif leading-relaxed line-clamp-2">"{review.neighborhood_advice || 'No specific written advice provided.'}"</p>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-gray-100">
                    <button onClick={() => { setSelectedReview(review); setViewMode('review_detail'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="px-4 py-2 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded-xl shadow">
                      Read Full Review →
                    </button>
                    <div className="flex items-center gap-2">
                      {onSelectStudent && review.user_id && (
                        <button onClick={() => onSelectStudent(review.user_id)} className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold rounded-xl flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5" /> <span>Author Profile</span>
                        </button>
                      )}
                      <button onClick={() => setContactNoticeModal(review)} className="px-3.5 py-2 bg-[#B31217] hover:bg-[#8A0E12] text-white text-xs font-bold rounded-xl shadow flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5" /> <span>Contact</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {viewMode === 'review_detail' && selectedReview && (
        <div className="space-y-6 animate-fadeIn">
          <div className="flex items-center justify-between border-b pb-4">
            <button onClick={() => setViewMode('university_reviews')} className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-full text-xs font-bold text-gray-700 shadow-sm">
              <ArrowLeft className="w-4 h-4" /> Back to reviews of {selectedReview.university_name}
            </button>
            {(selectedReview.user_id === currentUser?.id || currentUser?.role === 'superadmin') && (
              <div className="flex items-center gap-2">
                {selectedReview.user_id === currentUser?.id && <button onClick={() => handleOpenEdit(selectedReview)} className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold flex items-center gap-1.5"><Edit3 className="w-3.5 h-3.5" /> Edit</button>}
                <button onClick={() => handleDeleteExchange(selectedReview.id)} className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-3xl p-8 border border-[#D5D3CC] shadow-xl space-y-6">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 border-b pb-6">
              <div className="flex items-start gap-3.5">
                {getAuthorAvatar(selectedReview.user_id) ? (
                  <img src={getAuthorAvatar(selectedReview.user_id)} alt={selectedReview.user_name} className="w-14 h-14 rounded-full object-cover border-2 border-[#D5D3CC] shadow-md shrink-0 mt-1" />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-red-100 text-[#B31217] flex items-center justify-center font-bold text-lg shrink-0 mt-1 shadow-inner">
                    {selectedReview.user_name ? selectedReview.user_name.charAt(0).toUpperCase() : 'U'}
                  </div>
                )}
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#B31217]">{selectedReview.city}, {selectedReview.country} • {selectedReview.program_type}</span>
                  <h2 className="font-['Oswald'] text-3xl md:text-4xl font-bold uppercase text-gray-900 mt-1">{selectedReview.university_name}</h2>
                  <p className="text-xs text-gray-500 mt-1">Experience by <strong>{selectedReview.user_name}</strong></p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {onSelectStudent && selectedReview.user_id && (
                  <button onClick={() => onSelectStudent(selectedReview.user_id)} className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold rounded-xl border flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-600" /> <span>View College Profile</span>
                  </button>
                )}
                <button onClick={() => setContactNoticeModal(selectedReview)} className="px-5 py-2.5 bg-[#B31217] hover:bg-[#8A0E12] text-white text-xs font-bold rounded-xl shadow flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" /> <span>Contact Author</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 bg-[#FAF8F5] rounded-2xl border text-center space-y-1">
                <span className="text-[11px] font-bold text-gray-500 uppercase">Academic Quality</span>
                <div className="text-xl font-bold text-gray-900">★ {selectedReview.academics_rating || 5} / 5</div>
              </div>
              <div className="p-4 bg-[#FAF8F5] rounded-2xl border text-center space-y-1">
                <span className="text-[11px] font-bold text-gray-500 uppercase">Cost of Living</span>
                <div className="text-xl font-bold text-gray-900">{selectedReview.cost_of_living_rating || 3} / 5</div>
              </div>
              <div className="p-4 bg-[#FAF8F5] rounded-2xl border text-center space-y-1">
                <span className="text-[11px] font-bold text-gray-500 uppercase">Finding Housing</span>
                <div className="text-xl font-bold text-gray-900">{selectedReview.housing_rating || 4} / 5</div>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <h3 className="font-['Oswald'] text-lg font-bold uppercase text-gray-900">Advice on Housing, Neighborhoods, and Academic Life</h3>
              <div className="p-5 bg-[#FAF8F5] rounded-2xl border text-sm md:text-base font-serif text-gray-800 leading-relaxed whitespace-pre-line">
                {selectedReview.neighborhood_advice || 'No additional details provided.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/65 flex items-center justify-center p-4">
          <form onSubmit={handleSaveAcademicExchange} className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 md:p-7 shadow-2xl space-y-4 border border-[#D5D3CC]">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-['Oswald'] text-xl font-bold uppercase text-gray-900">{editingExchange ? 'Edit University Review' : 'Review Your Academic Experience'}</h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-3">
              <div className="relative">
                <label className="text-xs font-bold text-gray-700 block mb-1">University Name *</label>
                <input required type="text" placeholder="Start typing..." value={universityName} onChange={e => {
                  const value = e.target.value;
                  setUniversityCoords(null);
                  handleUniSearch(value);
                  }} className="w-full px-3 py-2 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" />
                {suggestions.length > 0 && (
                  <div className="absolute w-full bg-white border border-gray-200 rounded-xl mt-1 shadow-2xl z-[9999] max-h-48 overflow-y-auto">
                    {suggestions.map((s, i) => (
                      <div key={i} className="p-2.5 hover:bg-gray-100 cursor-pointer text-xs border-b last:border-b-0 flex flex-col" onClick={() => handleSelectSuggestion(s)}>
                        <span className="font-bold text-gray-900">{s.name}</span>
                        <span className="text-[10px] text-gray-500">📍 {[s.city, s.country].filter(Boolean).join(', ')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">City *</label>
                  <input required type="text" value={city} onChange={e => setCity(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs bg-[#FAF8F5]" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">Country *</label>
                  <input required type="text" value={country} onChange={e => setCountry(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs bg-[#FAF8F5]" />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Mobility Program</label>
                <select value={programType} onChange={e => setProgramType(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs bg-white">
                  <option value="Erasmus+">Erasmus+ Studio</option>
                  <option value="Erasmus Traineeship">Erasmus Traineeship</option>
                  <option value="Double Degree">Double Degree</option>
                  <option value="Thesis Abroad">Thesis Abroad</option>
                  <option value="Exchange Extra-UE">Exchange Extra-UE</option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2 bg-[#FAF8F5] p-3 rounded-2xl border">
                <div>
                  <label className="text-[10px] font-bold text-gray-600 block mb-1">Academics (1-5)</label>
                  <input type="number" min="1" max="5" value={academicsRating} onChange={e => setAcademicsRating(parseInt(e.target.value, 10))} className="w-full p-1.5 border rounded-lg text-xs font-bold text-center" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-600 block mb-1">Cost of Living (1-5)</label>
                  <input type="number" min="1" max="5" value={costOfLivingRating} onChange={e => setCostOfLivingRating(parseInt(e.target.value, 10))} className="w-full p-1.5 border rounded-lg text-xs font-bold text-center" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-600 block mb-1">Housing (1-5)</label>
                  <input type="number" min="1" max="5" value={housingRating} onChange={e => setHousingRating(parseInt(e.target.value, 10))} className="w-full p-1.5 border rounded-lg text-xs font-bold text-center" />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Practical advice *</label>
                <textarea required rows={4} value={neighborhoodAdvice} onChange={e => setNeighborhoodAdvice(e.target.value)} className="w-full p-3 border rounded-xl text-xs font-serif leading-relaxed" />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
              <button type="submit" disabled={saving} className="px-5 py-2 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow">
                {saving ? 'Saving...' : (editingExchange ? 'Save Changes' : 'Publish')}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {contactNoticeModal && (
        <ContactExchangeModal targetName={contactNoticeModal.user_name} targetRoleDescription={`the experience at ${contactNoticeModal.university_name}`} currentUser={currentUser} onSend={handleSendContactNotice} onClose={() => setContactNoticeModal(null)} />
      )}
    </div>
  );
}

export function SocialKitchenView({ currentUser, showToast, onBack }) {
  const [recipes, setRecipes] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState(null);

  const [title, setTitle] = useState('');
  const [regionalOrigin, setRegionalOrigin] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [steps, setSteps] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [ratingRecipeId, setRatingRecipeId] = useState(null);

  const fetchRecipes = () => {
    secureLegacyFetch(`${API_BASE}/community/recipes`, { credentials: 'include' })
      .then(res => res.json())
      .then(d => setRecipes(Array.isArray(d) ? d : []));
  };

  useEffect(() => { fetchRecipes(); }, []);

  const handleOpenCreate = () => {
    setEditingRecipe(null);
    setTitle('');
    setRegionalOrigin('');
    setIngredients('');
    setSteps('');
    setImageUrl('');
    setShowModal(true);
  };

  const handleOpenEdit = (recipe) => {
    setEditingRecipe(recipe);
    setTitle(recipe.title);
    setRegionalOrigin(recipe.regional_origin || '');
    setIngredients(recipe.ingredients);
    setSteps(recipe.steps);
    setImageUrl(recipe.image_url || '');
    setShowModal(true);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const data = { url: await uploadMediaFile(file, { onProgress: setUploadPercent }) };
      setImageUrl(data.url);
      showToast('Dish photo uploaded!', 'success');
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error uploading photo', 'error');
    } finally {
      setUploading(false);
      setUploadPercent(0);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = { title, regionalOrigin, ingredients, steps, imageUrl };

    try {
      const url = editingRecipe ? `${API_BASE}/community/recipes/${editingRecipe.id}` : `${API_BASE}/community/recipes`;
      const method = editingRecipe ? 'PUT' : 'POST';

      const res = await secureLegacyFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        showToast(editingRecipe ? 'Recipe updated!' : 'Recipe added to the cookbook!', 'success');
        setShowModal(false);
        fetchRecipes();
      } else {
        const err = await res.json();
        showToast(err.error || 'Error while saving.', 'error');
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Connection error.', 'error');
    }
  };

  const handleDelete = async (recipeId) => {
    if (!window.confirm('Are you sure you want to delete this recipe?')) return;
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/recipes/${recipeId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        showToast('Recipe removed!', 'info');
        fetchRecipes();
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error during deletion.', 'error');
    }
  };

  const handleRate = async (recipeId, stars) => {
    setRatingRecipeId(recipeId);
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/recipes/${recipeId}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ rating: stars })
      });
      if (res.ok) {
        showToast(`You rated ${stars} stars!`, 'success');
        fetchRecipes();
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Connection error.', 'error');
    } finally {
      setRatingRecipeId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-6xl mx-auto pb-12">
      <FeatureHeader 
        title="The Section Cookbook (Social Kitchen)"
        backLabel="Back to Board"
        onBack={onBack}
        description="The College's gastronomic archive: share your culinary specialties, edit them whenever you like, and rate your floormates' dishes."
      />

      <div className="flex justify-end">
        <button 
          onClick={handleOpenCreate} 
          className="px-5 py-2.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Share Recipe
        </button>
      </div>

      <div className="space-y-6">
        {recipes.map(r => {
          const isMyRecipe = r.author_id === currentUser?.id;
          const userRatings = typeof r.ratings === 'string' ? JSON.parse(r.ratings || '{}') : (r.ratings || {});
          const myVote = userRatings[currentUser?.id] || 0;

          return (
            <div key={r.id} className="bg-white rounded-3xl p-6 border border-[#D5D3CC] shadow-sm flex flex-col md:flex-row gap-6 justify-between items-start">
              <div className="flex-1 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase bg-amber-100 text-amber-900 px-2.5 py-0.5 rounded-full">
                      {r.regional_origin} • {r.residence} Section
                    </span>
                    <h3 className="font-['Oswald'] text-2xl uppercase font-bold text-gray-900 mt-1">{r.title}</h3>
                    <p className="text-xs text-gray-400">Chef: <strong>{r.author_name}</strong></p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isMyRecipe && (
                      <>
                        <button
                          onClick={() => handleOpenEdit(r)}
                          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold flex items-center gap-1"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                        <button
                          onClick={() => handleDelete(r.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl"
                          title="Delete Recipe"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}

                    <ModerationActions 
                      endpoint="/community/recipes" 
                      itemId={r.id} 
                      currentUser={currentUser} 
                      showToast={showToast} 
                      onSuccess={fetchRecipes}
                      level={2}
                    />
                  </div>
                </div>

                <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-200 text-xs">
                  <span className="font-bold text-gray-700 block mb-1">Ingredients:</span>
                  <p className="text-gray-600 leading-relaxed whitespace-pre-line">{r.ingredients}</p>
                </div>

                <div className="space-y-2 text-xs">
                  <span className="font-bold text-gray-700 block">Steps:</span>
                  <div className="space-y-1.5 font-serif text-gray-700 leading-relaxed">
                    {r.steps.split('\n').filter(Boolean).map((st, idx) => (
                      <div key={idx} className="flex gap-2">
                        <span className="font-bold text-[#B31217] shrink-0">{idx + 1}.</span>
                        <span>{st.replace(/^[0-9]+\.\s*/, '')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right column: real photo if present, and rating */}
              <div className="w-full md:w-80 shrink-0 space-y-3">
                {r.image_url ? (
                  <img
                    src={getSafeUrl(r.image_url, '')}
                    alt={r.title}
                    onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }}
                    className="w-full h-52 object-cover rounded-2xl border border-gray-200 shadow-sm"
                  />
                ) : null}
                <div className={r.image_url ? 'hidden' : ''}><RecipePlaceholder title={r.title} /></div>

                <div className="p-3.5 bg-[#FAF8F5] rounded-2xl border border-gray-200 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-gray-700">Media: ★ {r.average_rating || '5.0'}</span>
                    <span className="text-gray-400">{r.total_votes || 0} votes</span>
                  </div>

                  <div className="pt-1 border-t border-gray-200 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-gray-600">Rate:</span>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          disabled={ratingRecipeId === r.id}
                          onClick={() => handleRate(r.id, star)}
                          className="p-1 text-gray-300 hover:text-amber-500 transition-colors"
                        >
                          <Star className={`w-4 h-4 ${star <= myVote ? 'fill-amber-500 text-amber-500' : ''}`} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>


      {showModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/65 flex items-center justify-center p-4">
          <form onSubmit={handleSubmit} className="bg-white rounded-3xl p-6 md:p-7 max-w-md w-full max-h-[90vh] overflow-y-auto space-y-3.5 border border-[#D5D3CC] shadow-2xl animate-fadeIn">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-['Oswald'] text-xl font-bold uppercase text-gray-900">
                {editingRecipe ? 'Edit Recipe' : 'Share Recipe'}
              </h3>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <input required type="text" placeholder="Dish Title *" value={title} onChange={e => setTitle(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" />
            <input type="text" placeholder="Regional Origin / Country" value={regionalOrigin} onChange={e => setRegionalOrigin(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" />
            <textarea required rows={3} placeholder="Ingredient list with quantities (comma separated)... *" value={ingredients} onChange={e => setIngredients(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" />
            <textarea required rows={4} placeholder="Preparation steps (one per line)... *" value={steps} onChange={e => setSteps(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" />
            
            <div className="space-y-2">
              <label className="cursor-pointer bg-gray-100 hover:bg-gray-200 border rounded-xl p-2.5 text-xs font-bold text-gray-700 flex items-center justify-center gap-2">
                <Upload className="w-4 h-4 text-[#B31217]" />
                <span>{uploading ? 'Uploading...' : (imageUrl ? '✓ Change Dish Photo' : 'Upload Dish Photo (Optional)')}</span>
                <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
              </label>
              {uploading && <UploadProgress percent={uploadPercent} />}

              {imageUrl && (
                <div className="flex items-center justify-between text-xs bg-green-50 p-2 rounded-xl border border-green-200">
                  <span className="truncate text-green-700 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Photo uploaded</span>
                  <button type="button" onClick={() => setImageUrl('')} className="text-red-600 font-bold hover:underline">
                    Remove
                  </button>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => { setShowModal(false); setEditingRecipe(null); }} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
              <button type="submit" disabled={uploading} className="px-5 py-2 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow">
                {editingRecipe ? 'Save Changes' : 'Publish Recipe'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}

export function ResidenceJukeboxView({ currentUser, showToast, onBack }) {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingSlotIndex, setEditingSlotIndex] = useState(null);
  const [slotUrlInput, setSlotUrlInput] = useState('');
  const [savingSlot, setSavingSlot] = useState(false);

  const fetchTracks = async () => {
    setLoading(true);
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/jukebox`, { credentials: 'include' });
      if (res.ok) {
        const d = await res.json();
        setTracks(Array.isArray(d) ? d : []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTracks();
  }, []);

  const myTracks = useMemo(() => {
    return tracks.filter(t => t.user_id === currentUser?.id);
  }, [tracks, currentUser]);

  const userSlots = useMemo(() => {
    const slots = [null, null, null];
    myTracks.slice(0, 3).forEach((track, i) => {
      slots[i] = track;
    });
    return slots;
  }, [myTracks]);

  const sortedCommunityTracks = useMemo(() => {
    const frequencyMap = {};
    tracks.forEach(t => {
      const id = t.spotify_track_id;
      frequencyMap[id] = (frequencyMap[id] || 0) + 1;
    });

    // A song can be shared by multiple residents, but the community feed
    // should render one entry for one exact Spotify track.
    const uniqueTracks = [];
    const seenTrackIds = new Set();

    [...tracks]
      .sort((a, b) => {
        const likesA = (a.likes || []).length;
        const likesB = (b.likes || []).length;
        const freqA = frequencyMap[a.spotify_track_id] || 1;
        const freqB = frequencyMap[b.spotify_track_id] || 1;
        return (freqB * 10 + likesB) - (freqA * 10 + likesA);
      })
      .forEach(track => {
        if (seenTrackIds.has(track.spotify_track_id)) return;
        seenTrackIds.add(track.spotify_track_id);
        uniqueTracks.push(track);
      });

    return uniqueTracks;
  }, [tracks]);

  const handleSaveSlot = async (slotIndex, existingTrackId = null) => {
    if (!slotUrlInput || !slotUrlInput.includes('spotify.com/track/')) {
      showToast('Enter a valid Spotify track link.', 'error');
      return;
    }

    setSavingSlot(true);
    try {
      // The server checks duplicates before updating the existing slot, so a
      // failed duplicate attempt never deletes the original song.
      await secureLegacyFetch(`${API_BASE}/community/jukebox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          spotifyUrl: slotUrlInput,
          existingTrackId
        })
      });

      showToast(`Slot #${slotIndex + 1} saved successfully!`, 'success');
      setEditingSlotIndex(null);
      setSlotUrlInput('');
      fetchTracks();
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error while saving the track.', 'error');
    } finally {
      setSavingSlot(false);
    }
  };

  const handleClearSlot = async (trackId, slotIndex) => {
    if (!trackId) return;
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/jukebox/${trackId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        showToast(`Slot #${slotIndex + 1} cleared!`, 'info');
        fetchTracks();
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error during removal.', 'error');
    }
  };

  const handleToggleLike = async (id) => {
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/jukebox/${id}/like`, { 
        method: 'POST', 
        credentials: 'include' 
      });
      if (res.ok) {
        fetchTracks();
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn max-w-6xl mx-auto pb-12">
      {/* Compact hero banner, contained within limits to avoid overlap with the Header */}
      <div className="relative z-0 overflow-hidden rounded-3xl bg-gradient-to-r from-purple-950 via-slate-900 to-indigo-950 p-6 md:p-8 text-white border border-purple-800/40 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[11px] font-bold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>Campus Music Lounge</span>
            </div>
            <h1 className="font-['Oswald'] text-2xl md:text-4xl uppercase font-bold tracking-wide text-white">
              RESIDENCE JUKEBOX
            </h1>
            <p className="text-xs text-purple-200/80 font-serif max-w-lg leading-relaxed">
              The residents' playlist: manage your 3 personal music slots and vote for the community's favorite songs.
            </p>
          </div>

          <div className="flex items-center gap-3 bg-white/5 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-white/10 shrink-0">
            <Music className="w-6 h-6 text-purple-400" />
            <div>
              <span className="text-[10px] text-purple-300 font-bold uppercase block">Active tracks</span>
              <span className="text-lg font-bold font-mono text-white">{tracks.length} Tracks</span>
            </div>
          </div>
        </div>
      </div>

      {/* Personal mini-table: 3 song slots */}
      <div className="bg-white rounded-3xl p-6 md:p-7 border border-[#D5D3CC] shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
          <div>
            <h3 className="font-['Oswald'] text-xl font-bold uppercase text-gray-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              <span>Your 3 Personal Slots</span>
            </h3>
            <p className="text-xs text-gray-500 font-serif">
              Every resident has 3 always-editable slots: paste a Spotify link and update your music.
            </p>
          </div>
          <span className="text-xs font-bold px-3 py-1 rounded-full bg-purple-100 text-purple-800 self-start sm:self-auto">
            {myTracks.length} / 3 Slots Filled
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
          {userSlots.map((track, index) => {
            const isEditing = editingSlotIndex === index;

            return (
              <div
                key={index}
                className={`rounded-2xl p-4 border transition-all flex flex-col justify-between space-y-3 ${
                  track 
                    ? 'bg-gradient-to-br from-purple-50/70 to-indigo-50/50 border-purple-200 shadow-sm' 
                    : 'bg-[#FAF8F5] border-dashed border-gray-300 hover:border-purple-400'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-purple-900 text-white font-mono">
                    SLOT #{index + 1}
                  </span>
                  {track && !isEditing && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingSlotIndex(index);
                          setSlotUrlInput(track.spotify_url || '');
                        }}
                        className="p-1.5 text-gray-600 hover:text-purple-700 hover:bg-white rounded-lg transition-colors text-xs font-bold flex items-center gap-1"
                        title="Change track"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => handleClearSlot(track.id, index)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Remove from slot"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-2 pt-1 animate-fadeIn">
                    <label className="text-[11px] font-bold text-gray-700 block">
                      Paste Spotify track URL:
                    </label>
                    <input
                      type="url"
                      placeholder="https://open.spotify.com/track/..."
                      value={slotUrlInput}
                      onChange={e => setSlotUrlInput(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-purple-300 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                    />
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSlotIndex(null);
                          setSlotUrlInput('');
                        }}
                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={savingSlot || !slotUrlInput.trim()}
                        onClick={() => handleSaveSlot(index, track ? track.id : null)}
                        className="px-3.5 py-1.5 bg-purple-700 hover:bg-purple-800 disabled:bg-gray-300 text-white text-xs font-bold rounded-lg shadow"
                      >
                        {savingSlot ? 'Saving...' : 'Save Slot'}
                      </button>
                    </div>
                  </div>
                ) : track ? (
                  <div className="space-y-2">
                    <div>
                      <h4 className="font-bold text-sm text-gray-900 truncate" title={track.track_title}>
                        {track.track_title}
                      </h4>
                      <p className="text-xs text-purple-900/80 truncate font-medium">
                        {track.track_artist}
                      </p>
                    </div>
                    <div className="rounded-xl overflow-hidden shadow-inner border border-purple-200/60">
                      <LazyEmbed
                        src={`https://open.spotify.com/embed/track/${track.spotify_track_id}`}
                        height={80}
                        label="Spotify"
                        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                        title={`Slot ${index + 1}`}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 space-y-2">
                    <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center mx-auto">
                      <Plus className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-gray-700">Empty Slot</p>
                      <p className="text-[11px] text-gray-400">No song set</p>
                    </div>
                    <button
                      onClick={() => {
                        setEditingSlotIndex(index);
                        setSlotUrlInput('');
                      }}
                      className="px-3 py-1.5 bg-white hover:bg-purple-50 text-purple-700 border border-purple-300 rounded-xl text-xs font-bold shadow-sm"
                    >
                      + Add Song
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* COMMUNITY FEED IN A RANKED LIST STYLE */}
      <div className="bg-white rounded-3xl p-6 md:p-8 border border-[#D5D3CC] shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            <h3 className="font-['Oswald'] text-xl uppercase font-bold text-gray-900">
              Community Track Ranking ({sortedCommunityTracks.length})
            </h3>
          </div>
          <span className="text-xs text-gray-400 font-semibold">
            Sorted by popularity and likes
          </span>
        </div>

        {sortedCommunityTracks.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-xs">
            No tracks added yet.
          </div>
        ) : (
          <div className="space-y-3">
            {sortedCommunityTracks.map((t, idx) => {
              const hasLiked = (t.likes || []).includes(currentUser?.id);

              return (
                <div
                  key={t.id}
                  className="flex flex-col lg:flex-row items-center justify-between gap-4 p-4 rounded-2xl border border-gray-200 hover:border-purple-300 bg-[#FAF8F5] hover:bg-white transition-all shadow-sm group"
                >
                  <div className="flex items-center gap-4 w-full lg:w-1/3 min-w-0">
                    <span className="font-['Oswald'] font-black text-lg text-gray-400 w-6 text-center shrink-0 group-hover:text-purple-700">
                      #{idx + 1}
                    </span>

                    <div className="truncate min-w-0">
                      <h4 className="font-bold text-sm text-gray-900 truncate" title={t.track_title}>
                        {t.track_title}
                      </h4>
                      <p className="text-xs text-purple-900/80 font-medium truncate">
                        {t.track_artist}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        Shared by <strong>{t.user_name}</strong> ({t.residence} Section)
                      </p>
                    </div>
                  </div>

                  <div className="w-full lg:w-1/2 rounded-xl overflow-hidden shadow-inner border border-gray-200">
                    <LazyEmbed
                        src={`https://open.spotify.com/embed/track/${t.spotify_track_id}`}
                        height={80}
                        label="Spotify"
                        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                        title={t.track_title}
                      />
                  </div>

                  <div className="flex items-center justify-end gap-3 w-full lg:w-auto shrink-0">
                    <button
                      onClick={() => handleToggleLike(t.id)}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                        hasLiked
                          ? 'bg-pink-100 text-pink-700 shadow-sm'
                          : 'bg-white hover:bg-pink-50 text-gray-600 hover:text-pink-600 border border-gray-200'
                      }`}
                      title="Like"
                    >
                      <Heart className={`w-4 h-4 ${hasLiked ? 'fill-pink-600 text-pink-600' : ''}`} />
                      <span>{(t.likes || []).length} Likes</span>
                    </button>

                    <ModerationActions 
                      endpoint="/community/jukebox" 
                      itemId={t.id} 
                      currentUser={currentUser} 
                      showToast={showToast} 
                      onSuccess={fetchTracks}
                      level={2}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function MatchFinderView({ currentUser, showToast, onBack }) {
  const [matches, setMatches] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [contactNoticeModal, setContactNoticeModal] = useState(null);

  const [category, setCategory] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('18:00');
  const [location, setLocation] = useState('');
  const [missingPlayers, setMissingPlayers] = useState(2);
  const [dateError, setDateError] = useState('');

  const todayLocal = new Date();
  const minMatchDate = `${todayLocal.getFullYear()}-${String(todayLocal.getMonth() + 1).padStart(2, '0')}-${String(todayLocal.getDate()).padStart(2, '0')}`;
  const maxMatchDateValue = new Date(todayLocal);
  maxMatchDateValue.setDate(maxMatchDateValue.getDate() + 15);
  const maxMatchDate = `${maxMatchDateValue.getFullYear()}-${String(maxMatchDateValue.getMonth() + 1).padStart(2, '0')}-${String(maxMatchDateValue.getDate()).padStart(2, '0')}`;

  const fetchMatches = () => {
    secureLegacyFetch(`${API_BASE}/community/matches`, { credentials: 'include' })
      .then(res => res.json())
      .then(d => setMatches(Array.isArray(d) ? d : []));
  };

  useEffect(() => { fetchMatches(); }, []);

  const validateMatchDateTime = (dateValue, timeValue) => {
    if (!dateValue || !timeValue) return 'Select both a date and an available time.';
    if (dateValue < minMatchDate || dateValue > maxMatchDate) {
      return 'You can schedule a match only from today through the next 15 days.';
    }

    const selected = new Date(`${dateValue}T${timeValue}:00`);
    const now = new Date();
    const maxFuture = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(selected.getTime())) return 'Choose a valid date and time.';
    if (selected <= now) return 'The match date and time must be in the future.';
    if (selected > maxFuture) return 'The match must be scheduled within the next 15 days.';
    return '';
  };

  const handleDateChange = (val) => {
    setEventDate(val);
    setDateError(validateMatchDateTime(val, eventTime));
  };

  const handleTimeChange = (val) => {
    setEventTime(val);
    setDateError(validateMatchDateTime(eventDate, val));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const validationError = validateMatchDateTime(eventDate, eventTime);
    if (validationError) {
      setDateError(validationError);
      showToast(validationError, 'error');
      return;
    }

    const eventDateTime = new Date(`${eventDate}T${eventTime}:00`).toISOString();
    const res = await secureLegacyFetch(`${API_BASE}/community/matches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ category, eventDate: eventDateTime, location, missingPlayers })
    });
    if (res.ok) {
      showToast('Match published successfully!', 'success');
      setShowModal(false);
      setCategory('');
      setEventDate('');
      setLocation('');
      fetchMatches();
    } else {
      const err = await res.json();
      showToast(err.error || 'Error creating the challenge.', 'error');
    }
  };

  const handleDeleteMatch = async (id) => {
    if (!window.confirm('Do you want to cancel and delete this match?')) return;
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/matches/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        showToast('Match removed!', 'info');
        fetchMatches();
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error during removal.', 'error');
    }
  };

  const handleSendNotice = async (contactType, note) => {
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/send-contact-notice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        targetUserId: contactNoticeModal.creator_id,
        featureTitle: 'Match Finder Challenge',
        itemTitle: `${contactNoticeModal.category} in ${contactNoticeModal.location}`,
        chosenContactType: contactType,
        customNote: note
      })
    });
      if (res.ok) {
        showToast('Organizer notified of your availability!', 'success');
        setContactNoticeModal(null);
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Unable to transmit your contact request.', 'error');
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-6xl mx-auto pb-12">
      <FeatureHeader 
        title="Match Finder (Sports & Quick Games)"
        backLabel="Back to Board"
        onBack={onBack}
        description="Organize impromptu challenges in the courts or common rooms (within a maximum of 15 days) and find the missing players by leaving your contact info."
      />

      <div className="flex justify-end">
        <button onClick={() => setShowModal(true)} className="px-5 py-2.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow flex items-center gap-2">
          <Plus className="w-4 h-4" /> Propose Quick Match
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {matches.map(m => {
          const isMyMatch = m.creator_id === currentUser?.id;

          return (
            <div key={m.id} className="bg-white rounded-3xl p-5 border border-gray-200 shadow-sm space-y-4 flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start gap-2">
                  <span className="text-xs font-bold uppercase bg-blue-100 text-blue-900 px-2.5 py-0.5 rounded-full">
                    {m.category}
                  </span>

                  <div className="flex items-center gap-1.5">
                    {isMyMatch && (
                      <button
                        onClick={() => handleDeleteMatch(m.id)}
                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete match"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}

                    <ModerationActions 
                      endpoint="/community/matches" 
                      itemId={m.id} 
                      currentUser={currentUser} 
                      showToast={showToast} 
                      onSuccess={fetchMatches}
                      level={2}
                    />
                  </div>
                </div>

                <div className="mt-2 flex justify-between items-baseline">
                  <h4 className="font-bold text-base text-gray-900">{m.location}</h4>
                  <span className="text-xs text-red-600 font-bold">{m.missing_players} open spots</span>
                </div>

                <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  {new Date(m.event_date).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              </div>

              <div className="pt-3 border-t flex items-center justify-between text-xs">
                <span className="text-gray-500">Organized by {m.creator_name}</span>
                <button onClick={() => setContactNoticeModal(m)} className="px-4 py-1.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl font-bold shadow">
                  Join the Match
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/65 flex items-center justify-center p-4">
          <form onSubmit={handleCreate} className="bg-white rounded-3xl p-6 md:p-7 max-w-md w-full space-y-3.5 border border-[#D5D3CC] shadow-2xl animate-fadeIn">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-['Oswald'] text-xl font-bold uppercase text-gray-900">Propose a Match or Challenge</h3>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <input required type="text" placeholder="Sport / Game (e.g. 5-a-side football, Basketball, Chess...)" value={category} onChange={e => setCategory(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" />
            
            <div>
              <label className="text-[11px] font-bold text-gray-700 block mb-1">Date and time (within 15 days) *</label>
              <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr] gap-2">
                <div className="relative">
                  <input
                    required
                    type="date"
                    value={eventDate}
                    min={minMatchDate}
                    max={maxMatchDate}
                    onChange={e => handleDateChange(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:border-[#B31217]"
                    aria-label="Match date"
                  />
                  <span className="absolute left-3 -top-2 bg-white px-1 text-[9px] font-bold uppercase tracking-wide text-gray-500">Date</span>
                </div>
                <div className="relative">
                  <select
                    required
                    value={eventTime}
                    onChange={e => handleTimeChange(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:border-[#B31217]"
                    aria-label="Match time"
                  >
                    {Array.from({ length: 48 }, (_, index) => {
                      const hour = Math.floor(index / 2);
                      const minute = index % 2 === 0 ? '00' : '30';
                      const value = `${String(hour).padStart(2, '0')}:${minute}`;
                      return <option key={value} value={value}>{value}</option>;
                    })}
                  </select>
                  <span className="absolute left-3 -top-2 bg-white px-1 text-[9px] font-bold uppercase tracking-wide text-gray-500">Time</span>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">The calendar prevents selecting a date beyond 15 days. The exact time is validated again before publishing.</p>
              {dateError && (
                <p className="text-[11px] text-red-600 font-bold mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{dateError}</span>
                </p>
              )}
            </div>

            <input required type="text" placeholder="Location or Court " value={location} onChange={e => setLocation(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" />
            <input required type="number" min="1" max="25" placeholder="Number of missing players" value={missingPlayers} onChange={e => setMissingPlayers(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" />

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
              <button type="submit" disabled={Boolean(dateError) || !eventDate} className="px-5 py-2 bg-[#B31217] hover:bg-[#8A0E12] disabled:bg-gray-300 text-white rounded-xl text-xs font-bold shadow">
                Publish Match
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {contactNoticeModal && (
        <ContactExchangeModal 
          targetName={contactNoticeModal.creator_name}
          targetRoleDescription={`the ${contactNoticeModal.category} match`}
          currentUser={currentUser}
          onSend={handleSendNotice}
          onClose={() => setContactNoticeModal(null)}
        />
      )}
    </div>
  );
}

export function CitySurvivalGuideView({ currentUser, showToast, onBack }) {
  const [places, setPlaces] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [editingPlace, setEditingPlace] = useState(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('Budget Pizzerias');
  const [address, setAddress] = useState('');
  const [practicalAdvice, setPracticalAdvice] = useState('');
  const [placeSuggestions, setPlaceSuggestions] = useState([]);
  const [reviewPlace, setReviewPlace] = useState(null);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewText, setReviewText] = useState('');
  const [placeReviews, setPlaceReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  const fetchPlaces = () => {
    secureLegacyFetch(`${API_BASE}/community/city-guide`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => setPlaces(Array.isArray(data) ? data : []));
  };
  useEffect(() => {
    const query = name.trim();
    if (editingPlace || query.length < 2) {
      setPlaceSuggestions([]);
      return undefined;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await secureLegacyFetch(
          `${API_BASE}/community/city-guide/suggestions?q=${encodeURIComponent(query)}`,
          { credentials: 'include' }
        );
        if (res.ok) {
          const data = await res.json();
          setPlaceSuggestions(Array.isArray(data) ? data : []);
        }
      } catch {
        setPlaceSuggestions([]);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [name, editingPlace]);

  const openReviewPlace = async (place) => {
    setReviewPlace(place);
    setShowReviewForm(false); // "Show all reviews" must open the READING view
    setReviewText('');
    setReviewsLoading(true);
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/city-guide/${place.id}/reviews`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to load reviews.');
      setPlaceReviews(data.reviews || []);
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Unable to load reviews.', 'error');
      setPlaceReviews([]);
    } finally {
      setReviewsLoading(false);
    }
  };

  const handleSubmitReview = async (e) => {
    e.preventDefault();
    if (!reviewPlace || !reviewText.trim()) return;
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/city-guide/${reviewPlace.id}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ review: reviewText.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to save review.');
      showToast('Review published!', 'success');
      setReviewText('');
      setShowReviewForm(false);
      setPlaceReviews(prev => [data, ...prev]);
      fetchPlaces();
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Unable to save review.', 'error');
    }
  };

  const [ratingPlaceId, setRatingPlaceId] = useState(null);

  const handleRate = async (placeId, stars) => {
    setRatingPlaceId(placeId);
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/city-guide/${placeId}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ rating: stars })
      });
      if (res.ok) {
        showToast(`You rated ${stars} stars!`, 'success');
        fetchPlaces();
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error while voting.', 'error');
    } finally {
      setRatingPlaceId(null);
    }
  };

  useEffect(() => { fetchPlaces(); }, []);

  const handleOpenCreate = () => {
    setEditingPlace(null);
    setName('');
    setCategory('Budget Pizzerias');
    setAddress('');
    setPracticalAdvice('');
    setShowModal(true);
  };

  const handleOpenEdit = (p) => {
    setEditingPlace(p);
    setName(p.name);
    setCategory(p.category);
    setAddress(p.address);
    setPracticalAdvice(p.practical_advice);
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      name,
      category,
      address,
      practicalAdvice,
      nearestSections: [currentUser?.residence || 'Residence_name_1']
    };

    try {
      const url = editingPlace ? `${API_BASE}/community/city-guide/${editingPlace.id}` : `${API_BASE}/community/city-guide`;
      const method = editingPlace ? 'PUT' : 'POST';

      const res = await secureLegacyFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        showToast(editingPlace ? 'Tip updated!' : 'New place recommended!', 'success');
        setShowModal(false);
        setPlaceSuggestions([]);
        fetchPlaces();
      }
    } catch (err) {
      if (err?.status === 409 && err?.data?.existingPlaces?.length) {
        setShowModal(false);
        setPlaceSuggestions([]);
        await openReviewPlace(err.data.existingPlaces[0]);
        showToast('This place already exists. You can add your review to it.', 'info');
      } else {
        showToast(safeErrorMessage(err) || 'Connection error.', 'error');
      }
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this tip?')) return;
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/city-guide/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        showToast('Place removed from the guide!', 'info');
        fetchPlaces();
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error during deletion.', 'error');
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-6xl mx-auto pb-12">
      <FeatureHeader 
        title="City Survival Guide"
        backLabel="Back to Board"
        onBack={onBack}
        description="Places tested and recommended by fellow residents: budget pizzerias, study cafes and bars with power outlets, hardware stores, markets, and useful spots, with an integrated Google map."
      />

      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
          {['All', 'Budget Pizzerias', 'Study Cafes (WiFi/Outlets)', 'Gelaterias', 'Bike Repair', 'Hardware Stores', 'Copy Shops', 'Other'].map(c => (
            <button
              key={c}
              onClick={() => setSelectedCategory(c)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                selectedCategory === c 
                  ? 'bg-[#B31217] text-white shadow' 
                  : 'bg-white border text-gray-700 hover:bg-gray-100'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <button onClick={handleOpenCreate} className="px-4 py-2.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow shrink-0 flex items-center gap-1 self-start sm:self-auto">
          <Plus className="w-4 h-4" /> Recommend a Place
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {places.filter(p => selectedCategory === 'All' || p.category === selectedCategory).map(p => {
          const isMyPlace = p.author_id === currentUser?.id;
          const ratingsMap = typeof p.ratings === 'string' ? JSON.parse(p.ratings || '{}') : (p.ratings || {});
          const myVote = ratingsMap[currentUser?.id] || 0;

          return (
            <div key={p.id} className="bg-white rounded-3xl p-5 border border-gray-200 shadow-sm flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase bg-amber-100 text-amber-900 px-2.5 py-0.5 rounded-full">
                    {p.category}
                  </span>

                  <div className="flex items-center gap-1.5">
                    {isMyPlace && (
                      <>
                        <button
                          onClick={() => handleOpenEdit(p)}
                          className="p-1 text-gray-500 hover:text-purple-700 hover:bg-gray-100 rounded-lg text-xs font-bold"
                          title="Edit tip"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(p.id)}
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Delete tip"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}

                    <ModerationActions 
                      endpoint="/community/city-guide" 
                      itemId={p.id} 
                      currentUser={currentUser} 
                      showToast={showToast} 
                      onSuccess={fetchPlaces}
                      level={2}
                    />
                  </div>
                </div>

                <h4 className="font-bold text-base text-gray-900 mt-2">{p.name}</h4>
                <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                  <MapPin className="w-3.5 h-3.5 text-[#B31217]" /> {p.address}
                </p>

                {/* Google Maps embed box opened to the address */}
                <div className="mt-3 w-full h-36 rounded-2xl overflow-hidden border border-gray-200 shadow-inner">
                  {(() => {
                    const mapUrl = buildGoogleMapsEmbedUrl(p.address);
                    return mapUrl ? (
                      <LazyEmbed
                        src={mapUrl}
                        title={`Map ${p.name}`}
                        label="Map"
                        referrerPolicy="strict-origin-when-cross-origin"
                        allowFullScreen
                      />
                    ) : (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.address, CITY_NAME].filter(Boolean).join(', '))}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full h-full flex items-center justify-center text-xs font-bold text-[#B31217] bg-gray-50"
                      >
                        Open address in Google Maps
                      </a>
                    );
                  })()}
                </div>

                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold tracking-wide text-gray-500">
                      {p.review_count || 0} review{Number(p.review_count) === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      onClick={() => openReviewPlace(p)}
                      className="text-[10px] font-bold text-[#B31217] hover:underline"
                    >
                      Show all reviews
                    </button>
                  </div>
                  {(p.review_previews || []).length > 0 ? (
                    (p.review_previews || []).map(review => (
                      <div key={review.id} className="bg-[#FAF8F5] p-3 rounded-2xl border border-gray-200">
                        <p className="text-xs text-gray-700 font-serif leading-relaxed italic">"{review.review}"</p>
                        <p className="text-[10px] text-gray-400 mt-1.5">
                          {review.author_name} · {new Date(review.created_at).toLocaleDateString('en-GB')}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-gray-700 font-serif leading-relaxed italic bg-[#FAF8F5] p-3 rounded-2xl border border-gray-200">
                      "{p.practical_advice}"
                    </p>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t text-xs text-gray-500 flex justify-between items-center">
                <span>Recommended by {p.author_name}</span>
                <div className="flex items-center gap-1">
                  <span className="font-bold text-amber-600 mr-1.5">★ {p.average_rating || '5.0'}</span>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      disabled={ratingPlaceId === p.id}
                      onClick={() => handleRate(p.id, star)}
                      className="p-0.5 text-gray-300 hover:text-amber-500 transition-colors"
                      title={`Rate ${star} stars`}
                    >
                      <Star className={`w-3.5 h-3.5 ${star <= myVote ? 'fill-amber-500 text-amber-500' : ''}`} />
                    </button>
                  ))}
                </div>
              </div>

            </div>
          );
        })}
      </div>

      {reviewPlace && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/65 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 md:p-7 max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-5 border border-[#D5D3CC] shadow-2xl animate-fadeIn">
            <div className="flex items-start justify-between border-b pb-3 gap-4">
              <div>
                <h3 className="font-['Oswald'] text-xl font-bold uppercase text-gray-900">{reviewPlace.name}</h3>
                <p className="text-xs text-gray-500 flex items-center gap-1 mt-1"><MapPin className="w-3.5 h-3.5 text-[#B31217]" /> {reviewPlace.address}</p>
              </div>
              <button type="button" onClick={() => { setReviewPlace(null); setShowReviewForm(false); }} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="w-full h-44 rounded-2xl overflow-hidden border border-gray-200">
              <iframe
                width="100%"
                height="100%"
                frameBorder="0"
                loading="lazy"
                title={`Map ${reviewPlace.name}`}
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
                src={buildGoogleMapsEmbedUrl(reviewPlace.address)}
              />
            </div>

            <div className="border-t pt-4">
              <h4 className="font-['Oswald'] text-base font-bold uppercase text-gray-900 mb-3">All reviews</h4>
              {reviewsLoading ? (
                <p className="text-xs text-gray-500">Loading reviews…</p>
              ) : placeReviews.length === 0 ? (
                <p className="text-xs text-gray-500">No reviews yet. Be the first to write one.</p>
              ) : (
                <div className="space-y-3">
                  {placeReviews.map(review => (
                    <article key={review.id} className="rounded-2xl border border-gray-200 bg-[#FAF8F5] p-4">
                      <p className="text-sm text-gray-800 font-serif leading-relaxed">{review.review}</p>
                      <p className="text-[10px] text-gray-500 mt-2 font-bold">
                        {review.author_name} · {new Date(review.created_at).toLocaleDateString('en-GB')}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </div>

            {/* Writing is opt-in: the modal opens on the reviews themselves. */}
            {(() => {
              const myReview = placeReviews.find(r => r.author_id === currentUser?.id);
              if (myReview) {
                return <p className="text-[11px] text-gray-500 font-bold border-t pt-3">You have already reviewed this place.</p>;
              }
              if (!showReviewForm) {
                return (
                  <div className="border-t pt-4 flex justify-end">
                    <button type="button" onClick={() => setShowReviewForm(true)} className="px-5 py-2 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow">
                      Write a review
                    </button>
                  </div>
                );
              }
              return (
                  <form onSubmit={handleSubmitReview} className="space-y-2">
                    <label className="text-xs font-bold text-gray-700">Write your review</label>
                    <textarea
                      required
                      rows={4}
                      maxLength={3000}
                      value={reviewText}
                      onChange={e => setReviewText(e.target.value)}
                      placeholder="Share practical advice, prices, atmosphere, opening hours, or what students should know..."
                      className="w-full px-3 py-2.5 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]"
                    />
                    <div className="flex justify-end">
                      <button type="submit" disabled={!reviewText.trim()} className="px-5 py-2 bg-[#B31217] hover:bg-[#8A0E12] disabled:bg-gray-300 text-white rounded-xl text-xs font-bold shadow">
                        Publish review
                      </button>
                    </div>
                  </form>
              );
            })()}
          </div>
        </div>,
        document.body
      )}

      {showModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/65 flex items-center justify-center p-4">
          <form onSubmit={handleSubmit} className="bg-white rounded-3xl p-6 md:p-7 max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-4 border border-[#D5D3CC] shadow-2xl animate-fadeIn">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-['Oswald'] text-xl font-bold uppercase text-gray-900">
                {editingPlace ? 'Edit Place' : 'Add a Place in the City'}
              </h3>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Place / Shop Name *</label>
                <div className="relative">
                  <input required type="text" placeholder="e.g. Pizzeria Da Michele, San Salvario Print Shop..." value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" autoComplete="off" />
                  {placeSuggestions.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 border-b">Existing places</div>
                      {placeSuggestions.map(place => (
                        <button
                          type="button"
                          key={place.id}
                          onClick={() => openReviewPlace(place).then(() => { setShowModal(false); setPlaceSuggestions([]); })}
                          className="w-full text-left px-3 py-2.5 hover:bg-gray-50 border-b last:border-b-0"
                        >
                          <span className="block text-xs font-bold text-gray-900">{place.name}</span>
                          <span className="block text-[10px] text-gray-500">{place.address} · {place.review_count || 0} reviews</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Category *</label>
                <select value={category} onChange={e => setCategory(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs bg-white">
                  <option value="Budget Pizzerias">Budget Pizzerias / Trattorias</option>
                  <option value="Study Cafes (WiFi/Outlets)">Study Cafe (WiFi & Outlets)</option>
                  <option value="Gelaterias">Ice Cream Shops</option>
                  <option value="Bike Repair">Bike Workshop / Repair</option>
                  <option value="Hardware Stores">Hardware Store</option>
                  <option value="Copy Shops">Copy Shop / Printing</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Exact Address *</label>
                <input required type="text" placeholder="e.g. Via Madama Cristina 40, Corso Duca degli Abruzzi 24..." value={address} onChange={e => setAddress(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" />
              </div>

              {/* Live Google Maps preview of the typed address */}
              {address.trim().length > 3 && (
                <div className="space-y-1">
                  <span className="text-[10px] text-gray-500 font-bold block">Google Maps Preview:</span>
                  <div className="w-full h-36 rounded-xl overflow-hidden border border-gray-300">
                    {(() => {
                      const mapUrl = buildGoogleMapsEmbedUrl(address);
                      return mapUrl ? (
                        <iframe
                          width="100%"
                          height="100%"
                          frameBorder="0"
                          loading="lazy"
                          title="Map preview"
                          referrerPolicy="strict-origin-when-cross-origin"
                          allowFullScreen
                          src={mapUrl}
                        />
                      ) : (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([address, CITY_NAME].filter(Boolean).join(', '))}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full h-full flex items-center justify-center text-xs font-bold text-[#B31217] bg-gray-50"
                        >
                          Open address in Google Maps
                        </a>
                      );
                    })()}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Practical Advice and Student Perks *</label>
                <textarea required rows={3} placeholder="Why go here? Do they offer a College discount? Power outlets for laptops? Special hours?" value={practicalAdvice} onChange={e => setPracticalAdvice(e.target.value)} className="w-full p-3 border rounded-xl text-xs font-serif leading-relaxed focus:outline-none focus:border-[#B31217]" />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
              <button type="submit" className="px-5 py-2 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow">
                {editingPlace ? 'Save Changes' : 'Share Tip'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}

export function LanguageTandemView({ currentUser, showToast, onSelectStudent, onBack }) {
  const [tandems, setTandems] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [contactNoticeModal, setContactNoticeModal] = useState(null);
  const [nativeLanguage, setNativeLanguage] = useState('Italian');
  const [targetLanguage, setTargetLanguage] = useState('English');
  const [declaredLevel, setDeclaredLevel] = useState('Intermediate');
  const [meetingPreference, setMeetingPreference] = useState('');

  const fetchTandems = () => {
    secureLegacyFetch(`${API_BASE}/community/tandem`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => setTandems(Array.isArray(data) ? data : []));
  };

  useEffect(() => { fetchTandems(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    const res = await secureLegacyFetch(`${API_BASE}/community/tandem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ 
        nativeLanguage, 
        targetLanguage, 
        declaredLevel, 
        meetingPreference, 
        contactInfo: currentUser.phone || currentUser.email 
      })
    });
      if (res.ok) {
        showToast('Language tandem group created!', 'success');
        setShowModal(false);
        fetchTandems();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to create tandem.', 'error');
      }
  };

  const handleDeleteTandem = async (id) => {
    if (!window.confirm('Are you sure you want to close and delete this tandem?')) return;
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/tandem/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        showToast('Language tandem deleted!', 'info');
        fetchTandems();
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error during deletion.', 'error');
    }
  };

  const handleSendNotice = async (contactType, note) => {
    const res = await secureLegacyFetch(`${API_BASE}/community/send-contact-notice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        targetUserId: contactNoticeModal.creator_id,
        featureTitle: 'Language Tandem',
        itemTitle: `${contactNoticeModal.native_language} ↔ ${contactNoticeModal.target_language}`,
        chosenContactType: contactType,
        customNote: note
      })
    });
    if (res.ok) {
      showToast('Tandem creator notified!', 'success');
      setContactNoticeModal(null);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-6xl mx-auto pb-12">
      <FeatureHeader 
        title="Language Tandem"
        backLabel="Back to Board"
        onBack={onBack}
        description="Learn and practice new languages live: create a language exchange group between Italian and international residents over coffee."
      />

      <div className="flex justify-between items-center mb-6">
        <h3 className="font-['Oswald'] text-lg uppercase font-bold text-gray-800">
          Active Language Exchanges ({tandems.length})
        </h3>
        <button 
          onClick={() => setShowModal(true)} 
          className="px-5 py-2.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow flex items-center gap-1.5 transition-all"
        >
          <Plus className="w-4 h-4" /> Propose Tandem
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {tandems.map(tan => {
          const isMyTandem = tan.creator_id === currentUser?.id;

          return (
            <div key={tan.id} className="bg-white rounded-3xl p-5 border border-gray-200 shadow-sm flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-bold uppercase bg-indigo-100 text-indigo-900 px-2.5 py-0.5 rounded-full">
                    {tan.native_language} ↔ {tan.target_language}
                  </span>

                  <div className="flex items-center gap-1.5">
                    {isMyTandem && (
                      <button
                        onClick={() => handleDeleteTandem(tan.id)}
                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete tandem group"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}

                    <ModerationActions 
                      endpoint="/community/tandem" 
                      itemId={tan.id} 
                      currentUser={currentUser} 
                      showToast={showToast} 
                      onSuccess={fetchTandems}
                      level={2}
                    />
                  </div>
                </div>

                <p className="text-xs font-semibold text-gray-500 mt-2">
                  Required / declared level: <strong className="text-gray-800">{tan.declared_level}</strong>
                </p>
                <p className="text-xs text-gray-700 mt-2 font-serif bg-[#FAF8F5] p-3 rounded-2xl border border-gray-200">
                  "{tan.meeting_preference || 'Available for conversation practice in the common room or over coffee.'}"
                </p>
              </div>

              <div className="pt-3 border-t text-xs text-gray-500 flex justify-between items-center">
                <span>Created by {tan.creator_name}</span>
                <button
                  onClick={() => setContactNoticeModal(tan)}
                  className="px-3.5 py-1.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl font-bold shadow"
                >
                  Join
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/65 flex items-center justify-center p-4">
          <form onSubmit={handleCreate} className="bg-white rounded-3xl p-6 md:p-7 max-w-md w-full space-y-3.5 border border-[#D5D3CC] shadow-2xl animate-fadeIn">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-['Oswald'] text-xl font-bold uppercase text-gray-900">Start a Language Tandem</h3>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <input required type="text" placeholder="Your Native Language (e.g. Italian, Spanish...)" value={nativeLanguage} onChange={e => setNativeLanguage(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" />
            <input required type="text" placeholder="Language you want to practice (e.g. English, German...)" value={targetLanguage} onChange={e => setTargetLanguage(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" />
            
            <select value={declaredLevel} onChange={e => setDeclaredLevel(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs bg-white">
              <option value="Beginner">Beginner (A1-A2)</option>
              <option value="Intermediate">Intermediate (B1-B2)</option>
              <option value="Native">Advanced / Fluent (C1-C2)</option>
            </select>

            <textarea placeholder="Meeting preferences (e.g. lunch break, after dinner, study room...)" value={meetingPreference} onChange={e => setMeetingPreference(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs focus:outline-none focus:border-[#B31217]" />

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
              <button type="submit" className="px-5 py-2 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow">Create Tandem</button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {contactNoticeModal && (
        <ContactExchangeModal 
          targetName={contactNoticeModal.creator_name}
          targetRoleDescription={`the ${contactNoticeModal.target_language} tandem`}
          currentUser={currentUser}
          onSend={handleSendNotice}
          onClose={() => setContactNoticeModal(null)}
        />
      )}
    </div>
  );
}

export function PassionClubsView({ currentUser, showToast, onSelectStudent, onBack }) {
  const [clubs, setClubs] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [targetClubForJoin, setTargetClubForJoin] = useState(null);
  const [editingClub, setEditingClub] = useState(null);

  // Creation form
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [chatLink, setChatLink] = useState('');

  const hasPhone = Boolean(currentUser?.phone && currentUser.phone.trim() !== '');
  const hasEmail = Boolean(currentUser?.email && currentUser.email.trim() !== '');
  const [chosenChannel, setChosenChannel] = useState(hasPhone ? 'phone' : (hasEmail ? 'email' : ''));

  const fetchClubs = () => {
    secureLegacyFetch(`${API_BASE}/community/passion-clubs`, { credentials: 'include' })
      .then(res => res.json())
      .then(d => setClubs(Array.isArray(d) ? d : []));
  };

  useEffect(() => { fetchClubs(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!chosenChannel) {
      showToast('Select the contact you want to share in the club.', 'error');
      return;
    }

    const contactValue = chosenChannel === 'phone' ? currentUser.phone : currentUser.email;
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/passion-clubs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          description,
          meetingLink,
          chatLink,
          contactInfo: `${chosenChannel.toUpperCase()}: ${contactValue}`
        })
      });

      if (res.ok) {
        showToast('Passion club founded successfully!', 'success');
        setShowCreateModal(false);
        setName('');
        setDescription('');
        setMeetingLink('');
        setChatLink('');
        fetchClubs();
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Connection error.', 'error');
    }
  };

  const handleJoinConfirmed = async (contactType, note) => {
    const contactValue = contactType === 'phone' ? currentUser.phone : currentUser.email;
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/passion-clubs/${targetClubForJoin.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          contactInfo: `${contactType.toUpperCase()}: ${contactValue}${note ? ` (Note: ${note})` : ''}`
        })
      });
      if (res.ok) {
        showToast('Request sent! The club founder will be notified.', 'success');
        setTargetClubForJoin(null);
        fetchClubs();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to send the request.', 'error');
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error joining.', 'error');
    }
  };

  const handleUpdateLinks = async (e) => {
    e.preventDefault();
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/passion-clubs/${editingClub.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: editingClub.name,
          description: editingClub.description,
          meetingLink: editingClub.meeting_link,
          chatLink: editingClub.chat_link
        })
      });
      if (res.ok) {
        showToast('Club data updated successfully!', 'success');
        setEditingClub(null);
        fetchClubs();
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Connection error.', 'error');
    }
  };

  const handleDeleteClub = async (id) => {
    if (!window.confirm('Are you sure you want to close and delete this club?')) return;
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/passion-clubs/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        showToast('Club deleted!', 'info');
        fetchClubs();
      }
      else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to delete club.', 'error');
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error during deletion.', 'error');
    }
  };

  const handleLeaveClub = async (club) => {
    const isCreator = club.creator_id === currentUser?.id;
    const msg = isCreator
      ? 'You founded this club. If you leave, it passes to the next member (or is deleted if you are the only one). Continue?'
      : `Leave "${club.name}"?`;
    if (!window.confirm(msg)) return;
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/passion-clubs/${club.id}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: '{}'
      });
      if (res.ok) {
        showToast('You left the club.', 'success');
        fetchClubs();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to leave.', 'error');
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Failed to leave.', 'error');
    }
  };

  const myClubs = clubs.filter(c => (c.members || []).some(m => m.userId === currentUser?.id || m.id === currentUser?.id));
  const availableClubs = clubs.filter(c => !(c.members || []).some(m => m.userId === currentUser?.id || m.id === currentUser?.id));

  return (
    <div className="space-y-8 animate-fadeIn max-w-6xl mx-auto pb-12">
      <FeatureHeader 
        title="Passion Clubs" 
        backLabel="Back to Board"
        onBack={onBack}
        description="Permanent circles of residents with shared interests: film, chess, music, photography, programming, or sports. Join to organize events and meetups."
      />

      <div className="flex justify-end">
        <button onClick={() => setShowCreateModal(true)} className="px-5 py-2.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow flex items-center gap-2">
          <Plus className="w-4 h-4" /> Found a Club
        </button>
      </div>

      {/* MY CLUBS */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 border-b pb-2">
          <UserCheck className="w-5 h-5 text-emerald-700" />
          <h3 className="font-['Oswald'] text-lg uppercase font-bold text-gray-900">Your Clubs ({myClubs.length})</h3>
        </div>

        {myClubs.length === 0 ? (
          <p className="text-xs text-gray-500 italic p-4 bg-white rounded-2xl border">You haven't joined any clubs yet.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {myClubs.map(c => {
              const isCreator = c.creator_id === currentUser?.id;

              return (
                <div key={c.id} className="bg-white rounded-3xl p-6 border-2 border-emerald-600/30 shadow-sm space-y-4 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start gap-2">
                      <h4 className="font-['Oswald'] text-xl uppercase font-bold text-gray-900">{c.name}</h4>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleLeaveClub(c)}
                          className="px-3 py-1 border border-[#B31217] text-[#B31217] hover:bg-[#B31217] hover:text-white rounded-lg text-[11px] font-bold"
                        >
                          Leave
                        </button>
                        {isCreator && (
                          <>
                            <button onClick={() => setEditingClub(c)} className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-[11px] font-bold flex items-center gap-1">
                              <Edit3 className="w-3.5 h-3.5" /> Edit
                            </button>
                            <button onClick={() => handleDeleteClub(c.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg" title="Delete Club">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        <ModerationActions endpoint="/community/passion-clubs" itemId={c.id} currentUser={currentUser} showToast={showToast} onSuccess={fetchClubs} level={2} />
                      </div>
                    </div>

                    <p className="text-xs text-gray-600 font-serif mt-1">{c.description}</p>

                    <div className="mt-4 p-3.5 bg-gray-50 rounded-2xl border space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-700">Meeting / Lesson Channel:</span>
                        {c.meeting_link ? (
                          <a href={getSafeUrl(c.meeting_link)} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1 font-bold">
                            Open Link <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : <span className="text-gray-400">Not set</span>}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-700">WhatsApp / Telegram Chat:</span>
                        {c.chat_link ? (
                          <a href={getSafeUrl(c.chat_link)} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline flex items-center gap-1 font-bold">
                            Chat Group <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : <span className="text-gray-400">Not set</span>}
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      <span className="text-[11px] font-bold uppercase text-gray-400 block">Club Members ({(c.members || []).length}):</span>
                      <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                        {(c.members || []).map((m, idx) => (
                          <div key={idx} className="p-2 rounded-xl bg-[#FAF8F5] border flex items-center justify-between text-xs">
                            <button type="button" onClick={() => onSelectStudent && onSelectStudent(m.userId || m.id)} className="font-bold text-[#B31217] hover:underline">
                              {m.name}
                            </button>
                            <span className="text-[11px] font-mono text-gray-600 bg-white px-2 py-0.5 rounded border">{m.contact}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* OTHER OPEN CLUBS */}
      <div className="space-y-4 pt-4">
        <div className="flex items-center gap-2 border-b pb-2">
          <Users className="w-5 h-5 text-gray-700" />
          <h3 className="font-['Oswald'] text-lg uppercase font-bold text-gray-900">Other Available Clubs ({availableClubs.length})</h3>
        </div>

        {availableClubs.length === 0 ? (
          <p className="text-xs text-gray-500 italic p-4 bg-white rounded-2xl border">No other open clubs at the moment.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {availableClubs.map(c => (
              <div key={c.id} className="bg-white rounded-3xl p-5 border shadow-sm flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-bold text-base text-gray-900">{c.name}</h4>
                    <ModerationActions endpoint="/community/passion-clubs" itemId={c.id} currentUser={currentUser} showToast={showToast} onSuccess={fetchClubs} level={2} />
                  </div>
                  <p className="text-xs text-gray-600 font-serif mt-2 line-clamp-3">{c.description}</p>
                </div>
                <div className="pt-3 border-t flex items-center justify-between">
                  <span className="text-xs text-gray-500">{c.member_count ?? (c.members || []).length} Members</span>
                  {c.my_request_status === 'pending' ? (
                    <span className="px-4 py-2 bg-gray-100 text-gray-500 rounded-xl text-xs font-bold">Request pending</span>
                  ) : (
                    <button onClick={() => setTargetClubForJoin(c)} className="px-4 py-2 bg-[#B31217] text-white rounded-xl text-xs font-bold shadow">
                      Request to Join
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/65 flex items-center justify-center p-4">
          <form onSubmit={handleCreate} className="bg-white rounded-3xl p-6 md:p-7 max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-4 border border-[#D5D3CC] shadow-2xl animate-fadeIn">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-['Oswald'] text-xl font-bold uppercase text-gray-900">Found a Passion Club</h3>
              <button type="button" onClick={() => setShowCreateModal(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <input required type="text" placeholder="Club Name (e.g.  Film Club, Chess, Guitar...)" value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs" />
            <textarea required rows={3} placeholder="Description of goals, meetups, and interests..." value={description} onChange={e => setDescription(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs" />
            <input type="url" placeholder="Virtual Meetup Link (optional)" value={meetingLink} onChange={e => setMeetingLink(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs" />
            <input type="url" placeholder="WhatsApp / Telegram Chat Group Link (optional)" value={chatLink} onChange={e => setChatLink(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs" />

            <div className="bg-[#FAF8F5] p-3.5 rounded-2xl border space-y-2">
              <label className="text-xs font-bold text-gray-800 block">Contact info to share with members:</label>
              <div className="grid grid-cols-2 gap-2">
                <label className={`flex items-center gap-2 p-2 rounded-xl border text-xs cursor-pointer ${chosenChannel === 'phone' ? 'bg-red-50 border-[#B31217] font-bold' : 'bg-white'}`}>
                  <input type="radio" name="clubChannel" disabled={!hasPhone} checked={chosenChannel === 'phone'} onChange={() => setChosenChannel('phone')} />
                  <span>{hasPhone ? currentUser.phone : 'Phone not set'}</span>
                </label>
                <label className={`flex items-center gap-2 p-2 rounded-xl border text-xs cursor-pointer ${chosenChannel === 'email' ? 'bg-red-50 border-[#B31217] font-bold' : 'bg-white'}`}>
                  <input type="radio" name="clubChannel" disabled={!hasEmail} checked={chosenChannel === 'email'} onChange={() => setChosenChannel('email')} />
                  <span>{hasEmail ? currentUser.email : 'Email not set'}</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
              <button type="submit" disabled={!chosenChannel} className="px-5 py-2 bg-[#B31217] text-white rounded-xl text-xs font-bold shadow">Create Club</button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {editingClub && (
        <div className="fixed inset-0 z-[9999] bg-black/65 flex items-center justify-center p-4">
          <form onSubmit={handleUpdateLinks} className="bg-white rounded-3xl p-6 md:p-7 max-w-md w-full space-y-4 border shadow-2xl animate-fadeIn">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-['Oswald'] text-xl font-bold uppercase text-gray-900">Edit Club</h3>
              <button type="button" onClick={() => setEditingClub(null)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <input required type="text" value={editingClub.name} onChange={e => setEditingClub({ ...editingClub, name: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-xs" />
            <textarea rows={3} value={editingClub.description} onChange={e => setEditingClub({ ...editingClub, description: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-xs" />
            <input type="url" placeholder="Virtual Meetup Link" value={editingClub.meeting_link || ''} onChange={e => setEditingClub({ ...editingClub, meeting_link: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-xs" />
            <input type="url" placeholder="WhatsApp / Telegram Chat" value={editingClub.chat_link || ''} onChange={e => setEditingClub({ ...editingClub, chat_link: e.target.value })} className="w-full px-3 py-2 border rounded-xl text-xs" />
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setEditingClub(null)} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
              <button type="submit" className="px-5 py-2 bg-gray-900 text-white rounded-xl text-xs font-bold">Save Changes</button>
            </div>
          </form>
        </div>
      )}

      {targetClubForJoin && (
        <ContactExchangeModal 
          targetName={targetClubForJoin.name}
          targetRoleDescription="joining the passion club"
          currentUser={currentUser}
          onSend={handleJoinConfirmed}
          onClose={() => setTargetClubForJoin(null)}
        />
      )}
    </div>
  );
}

export function BookMarketplaceView({ currentUser, showToast, onBack }) {
  const [books, setBooks] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingBook, setEditingBook] = useState(null);
  const [targetBookForContact, setTargetBookForContact] = useState(null);

  const [subject, setSubject] = useState('');
  const [title, setTitle] = useState('');
  const [priceTag, setPriceTag] = useState('');
  const [wearCondition, setWearCondition] = useState('Good condition');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);

  const fetchBooks = () => {
    secureLegacyFetch(`${API_BASE}/community/marketplace`, { credentials: 'include' })
      .then(res => res.json())
      .then(d => setBooks(Array.isArray(d) ? d : []))
      .catch(err => showToast(safeErrorMessage(err) || 'Unable to load the marketplace.', 'error'));
  };

  useEffect(() => {
    fetchBooks();
  }, []);

  const handleOpenCreate = () => {
    setEditingBook(null);
    setSubject('');
    setTitle('');
    setPriceTag('');
    setWearCondition('Good condition');
    setCoverImageUrl('');
    setShowModal(true);
  };

  const handleOpenEdit = (book) => {
    setEditingBook(book);
    setSubject(book.subject);
    setTitle(book.title);
    setPriceTag(book.price_tag);
    setWearCondition(book.wear_condition);
    setCoverImageUrl(book.cover_image_url || '');
    setShowModal(true);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const data = { url: await uploadMediaFile(file, { onProgress: setUploadPercent }) };
      setCoverImageUrl(data.url);
      showToast('Cover photo uploaded!', 'success');
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error uploading photo', 'error');
    } finally {
      setUploading(false);
      setUploadPercent(0);
    }
  };

  const [savingBook, setSavingBook] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    if (savingBook) return;
    const url = editingBook ? `${API_BASE}/community/marketplace/${editingBook.id}` : `${API_BASE}/community/marketplace`;
    const method = editingBook ? 'PUT' : 'POST';

    // secureLegacyFetch never returns a failed response: it THROWS on any
    // 4xx/5xx. Without this try/catch a rejected listing (validation,
    // moderation, expired session...) produced an unhandled rejection and the
    // button looked dead, with no message at all.
    setSavingBook(true);
    try {
      await secureLegacyFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          subject: subject.trim(),
          title: title.trim(),
          priceTag: priceTag.trim(),
          wearCondition,
          coverImageUrl: coverImageUrl || null
        })
      });
      showToast(editingBook ? 'Listing updated successfully!' : 'Book published on the marketplace!', 'success');
      setShowModal(false);
      fetchBooks();
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error while saving the listing.', 'error');
    } finally {
      setSavingBook(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this listing?')) return;
    const res = await secureLegacyFetch(`${API_BASE}/community/marketplace/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    if (res.ok) {
      showToast('Listing deleted.', 'info');
      fetchBooks();
    } else {
      showToast('Error during deletion.', 'error');
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn max-w-6xl mx-auto pb-12">
      <FeatureHeader 
        title="Books & Notes Marketplace" 
        backLabel="Back to Board"
        onBack={onBack}
        description="Exchange or sell textbooks, exam study guides, and lecture notes with other College students."
      />

      <div className="flex justify-end">
        <button 
          onClick={handleOpenCreate} 
          className="px-5 py-2.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Publish Book Listing
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {books.map(b => {
          const isOwner = b.seller_id === currentUser?.id;
          return (
            <div key={b.id} className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm flex flex-col justify-between space-y-4">
              <div>
                {b.cover_image_url && (
                  <div className="w-full h-36 rounded-2xl overflow-hidden border border-gray-200 mb-3">
                    <img src={b.cover_image_url} alt={b.title} className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-red-100 text-[#B31217] px-2.5 py-0.5 rounded-full">
                    {b.subject}
                  </span>
                  <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
                    {b.price_tag}
                  </span>
                </div>

                <h3 className="font-['Oswald'] text-xl uppercase font-bold text-gray-900 mt-2">{b.title}</h3>
                <p className="text-xs text-gray-500 mt-1">Condition: <strong className="text-gray-700">{b.wear_condition}</strong></p>
                <p className="text-xs text-gray-400 mt-0.5">Seller: {b.seller_name} ({b.seller_section} Section)</p>
              </div>

              <div className="pt-4 border-t flex items-center justify-between gap-2">
                <ModerationActions endpoint="/community/marketplace" itemId={b.id} currentUser={currentUser} showToast={showToast} onSuccess={fetchBooks} level={2} />
                {isOwner ? (
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleOpenEdit(b)} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold flex items-center gap-1">
                      <Edit3 className="w-3.5 h-3.5" /> Edit
                    </button>
                    <button onClick={() => handleDelete(b.id)} className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl text-xs font-bold flex items-center gap-1">
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => setTargetBookForContact(b)}
                    className="w-full py-2 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow transition-all"
                  >
                    Contact Seller
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/65 flex items-center justify-center p-4 overflow-y-auto">
          <form onSubmit={handleSave} className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full my-auto space-y-4 shadow-2xl border">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-['Oswald'] text-xl font-bold uppercase text-gray-900">
                {editingBook ? 'Edit Listing' : 'Publish Book or Notes'}
              </h3>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Subject / Exam *</label>
                <input required type="text" value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Physical Chemistry" className="w-full px-3 py-2 border rounded-xl text-xs" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Book / Notes Title *</label>
                <input required type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Atkins Physical Chemistry 11th ed." className="w-full px-3 py-2 border rounded-xl text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">Price / Offer *</label>
                  <input required type="text" value={priceTag} onChange={e => setPriceTag(e.target.value)} placeholder="e.g. €20 or Free" className="w-full px-3 py-2 border rounded-xl text-xs" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">Condition *</label>
                  <select value={wearCondition} onChange={e => setWearCondition(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs bg-white">
                    <option value="New / Never used">New / Never used</option>
                    <option value="Good condition">Good condition</option>
                    <option value="Visible signs of wear">Visible signs of wear</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Cover Photo (Optional)</label>
                <label className="flex items-center justify-center gap-2 px-3 py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-xs font-bold text-gray-500 hover:border-[#B31217] hover:text-[#B31217] cursor-pointer transition-colors">
                  {uploading ? (
                    <span>Uploading...</span>
                  ) : coverImageUrl ? (
                    <span className="flex items-center gap-2 text-emerald-700"><Check className="w-4 h-4" /> Photo uploaded — click to change</span>
                  ) : (
                    <span className="flex items-center gap-2"><Upload className="w-4 h-4" /> Upload a cover photo (optional)</span>
                  )}
                  <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                </label>
                {uploading && <UploadProgress percent={uploadPercent} />}
                {coverImageUrl && (
                  <div className="mt-2 relative w-24 h-24 rounded-xl overflow-hidden border">
                    <img src={coverImageUrl} alt="Cover preview" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setCoverImageUrl('')}
                      className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 hover:bg-black/80"
                      title="Remove photo"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t">
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
              <button type="submit" disabled={uploading || savingBook} className="px-5 py-2 bg-[#B31217] disabled:bg-gray-300 text-white rounded-xl text-xs font-bold shadow">{savingBook ? 'Saving…' : 'Save Listing'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {targetBookForContact && (
        <ContactExchangeModal 
          targetName={targetBookForContact.seller_name}
          targetRoleDescription={`purchasing the book: ${targetBookForContact.title}`}
          currentUser={currentUser}
          onSend={async (type, note) => {
            await secureLegacyFetch(`${API_BASE}/community/marketplace/${targetBookForContact.id}/contact`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ contactInfo: `${type.toUpperCase()}: ${currentUser[type]}` })
            });
            showToast('Request sent to the seller!', 'success');
            setTargetBookForContact(null);
          }}
          onClose={() => setTargetBookForContact(null)}
        />
      )}
    </div>
  );
}

export function FreeboxView({ currentUser, showToast, onBack }) {
  const [items, setItems] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [contactNoticeModal, setContactNoticeModal] = useState(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [floorRoom, setFloorRoom] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);

  const fetchItems = () => {
    secureLegacyFetch(`${API_BASE}/community/freebox`, { credentials: 'include' })
      .then(res => res.json())
      .then(d => setItems(Array.isArray(d) ? d : []));
  };

  useEffect(() => { fetchItems(); }, []);

  const handleOpenCreate = () => {
    setEditingItem(null);
    setTitle('');
    setDescription('');
    setFloorRoom(`${currentUser?.floor || ''} ${currentUser?.room || ''}`.trim());
    setPhotoUrl('');
    setShowModal(true);
  };

  const handleOpenEdit = (it) => {
    setEditingItem(it);
    setTitle(it.title);
    setDescription(it.description);
    setFloorRoom(it.donor_floor_room || '');
    setPhotoUrl(it.photo_url || '');
    setShowModal(true);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const data = { url: await uploadMediaFile(file, { onProgress: setUploadPercent }) };
      setPhotoUrl(data.url);
      showToast('Item photo uploaded!', 'success');
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error during upload.', 'error');
    } finally {
      setUploading(false);
      setUploadPercent(0);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = { title, description, photoUrl, floorRoom };
    const url = editingItem ? `${API_BASE}/community/freebox/${editingItem.id}` : `${API_BASE}/community/freebox`;
    const method = editingItem ? 'PUT' : 'POST';

    try {
      const res = await secureLegacyFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        showToast(editingItem ? 'Donation updated successfully!' : 'Item added to the Freebox!', 'success');
        setShowModal(false);
        fetchItems();
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Connection error.', 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to remove this donation?')) return;
    try {
      const res = await secureLegacyFetch(`${API_BASE}/community/freebox/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        showToast('Item removed!', 'info');
        fetchItems();
      }
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Error during deletion.', 'error');
    }
  };

  const handleClaim = async (contactType, note) => {
    const res = await secureLegacyFetch(`${API_BASE}/community/send-contact-notice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        targetUserId: contactNoticeModal.donor_id,
        featureTitle: 'Freebox',
        itemTitle: contactNoticeModal.title,
        chosenContactType: contactType,
        customNote: note
      })
    });
    if (res.ok) {
      showToast('Donor notified of your interest in picking this up!', 'success');
      setContactNoticeModal(null);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-6xl mx-auto pb-12">
      <FeatureHeader 
        title="Freebox" 
        backLabel="Back to Board"
        onBack={onBack}
        description="End-of-year donations and giveaways: drying racks, blankets, lamps, dishware, and items left for free by residents changing rooms or finishing their time at the College."
      />

      <div className="flex justify-between items-center mb-6">
        <h3 className="font-['Oswald'] text-lg uppercase font-bold text-gray-800">Available Items ({items.length})</h3>
        <button onClick={handleOpenCreate} className="px-5 py-2.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow flex items-center gap-2">
          <Plus className="w-4 h-4" /> Leave a Donation
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {items.map(it => {
          const isMyItem = it.donor_id === currentUser?.id;

          return (
            <div key={it.id} className="bg-white rounded-3xl p-5 border border-gray-200 shadow-sm flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded">
                    Free / Donation
                  </span>
                  <div className="flex items-center gap-1">
                    {isMyItem && (
                      <>
                        <button onClick={() => handleOpenEdit(it)} className="p-1 text-gray-500 hover:text-purple-700" title="Edit"><Edit3 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleDelete(it.id)} className="p-1 text-gray-400 hover:text-red-600" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                      </>
                    )}
                    <ModerationActions endpoint="/community/freebox" itemId={it.id} currentUser={currentUser} showToast={showToast} onSuccess={fetchItems} level={2} />
                  </div>
                </div>

                {it.photo_url && (
                  <img src={getSafeUrl(it.photo_url, DEFAULT_AVATAR)} alt={it.title} className="w-full h-44 object-cover rounded-xl mt-2 border" />
                )}

                <h4 className="font-bold text-base text-gray-900 mt-2">{it.title}</h4>
                <p className="text-xs text-gray-600 font-serif mt-1 leading-relaxed">{it.description}</p>
              </div>

              <div className="pt-3 border-t text-xs text-gray-500 flex justify-between items-center">
                <span>{it.donor_name} ({it.donor_section} • {it.donor_floor_room})</span>
                {!isMyItem && (
                  <button onClick={() => setContactNoticeModal(it)} className="px-3.5 py-1.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow">
                    Claim
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/65 flex items-center justify-center p-4">
          <form onSubmit={handleSubmit} className="bg-white rounded-3xl p-6 md:p-7 max-w-md w-full space-y-3.5 border border-[#D5D3CC] shadow-2xl animate-fadeIn">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-['Oswald'] text-xl font-bold uppercase text-gray-900">{editingItem ? 'Edit Donation' : 'Leave an Item'}</h3>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <input required type="text" placeholder="Item Name *" value={title} onChange={e => setTitle(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs" />
            <textarea required rows={3} placeholder="Description and condition..." value={description} onChange={e => setDescription(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs font-serif" />
            <input type="text" placeholder="Where to pick it up (e.g. Floor 3, Room 312, or Common Room)" value={floorRoom} onChange={e => setFloorRoom(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs" />
            
            <label className="cursor-pointer bg-gray-100 hover:bg-gray-200 border rounded-xl p-2.5 text-xs font-bold text-gray-700 flex items-center justify-center gap-2">
              <Upload className="w-4 h-4 text-[#B31217]" />
              <span>{uploading ? 'Uploading...' : (photoUrl ? '✓ Photo Added (Change)' : 'Upload Item Photo (Optional)')}</span>
              <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
            </label>
            {uploading && <UploadProgress percent={uploadPercent} />}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
              <button type="submit" disabled={uploading} className="px-5 py-2 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow">
                {editingItem ? 'Save Changes' : 'Publish Donation'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {contactNoticeModal && (
        <ContactExchangeModal 
          targetName={contactNoticeModal.donor_name}
          targetRoleDescription={`picking up "${contactNoticeModal.title}"`}
          currentUser={currentUser}
          onSend={handleClaim}
          onClose={() => setContactNoticeModal(null)}
        />
      )}
    </div>
  );
}

export function CommunityStartUpView({ currentUser, showToast, onBack }) {
  const [startups, setStartups] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingStartup, setEditingStartup] = useState(null);
  const [applyingTo, setApplyingTo] = useState(null);

  // Listing creation form
  const [title, setTitle] = useState('');
  const [industry, setIndustry] = useState('AI & Software');
  const [stage, setStage] = useState('💡 Just an Idea / Brainstorming');
  const [elevatorPitch, setElevatorPitch] = useState('');
  const [neededRoles, setNeededRoles] = useState([]);
  const [commitmentType, setCommitmentType] = useState('A few hours a week (side project)');

  // Application form
  const [roleCompetence, setRoleCompetence] = useState('');
  const [portfolioLink, setPortfolioLink] = useState('');

  const industriesList = [
    'AI & Software', 'GreenTech & Sustainability', 'BioTech & Health', 
    'E-commerce', 'EdTech', 'FinTech', 'Social Impact', 'Hardware & Robotics'
  ];

  const stagesList = [
    '💡 Just an Idea / Brainstorming',
    '🛠️ Prototype / MVP in development',
    '🚀 First users / Launching now',
    '📑 University grant / competition (e.g. StartCup, I3P, 2i3T)'
  ];

  const rolesAvailable = [
    '💻 Developer / Tech Lead',
    '📈 Business & Marketing',
    '🎨 UI/UX & Graphic Design',
    '⚖️ Legal & Bureaucracy',
    '🧪 Domain Expert (Medicine, Chemistry, etc.)'
  ];

  const fetchStartups = () => {
    secureLegacyFetch(`${API_BASE}/community/startups`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => setStartups(Array.isArray(data) ? data : []));
  };

  useEffect(() => { fetchStartups(); }, []);

  const toggleRole = (r) => {
    setNeededRoles(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  };

  const handleOpenEdit = (startup) => {
    setEditingStartup(startup); setTitle(startup.title || ''); setIndustry(startup.industry || industriesList[0]); setStage(startup.stage || stagesList[0]); setElevatorPitch(startup.elevator_pitch || ''); setNeededRoles(startup.needed_roles || []); setCommitmentType(startup.commitment_type || 'A few hours a week (side project)'); setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this startup project?')) return;
    const res = await secureLegacyFetch(`${API_BASE}/community/startups/${id}`, { method:'DELETE', credentials:'include' });
    if (res.ok) { showToast('Startup project deleted.', 'info'); fetchStartups(); } else { const d=await res.json(); showToast(d.error || 'Unable to delete startup.', 'error'); }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (neededRoles.length === 0) return showToast('Select at least one needed role.', 'error');
    const res = await secureLegacyFetch(editingStartup ? `${API_BASE}/community/startups/${editingStartup.id}` : `${API_BASE}/community/startups`, {
      method: editingStartup ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ title, industry, stage, elevatorPitch, neededRoles, commitmentType })
    });
    if (res.ok) {
      showToast(editingStartup ? 'Startup project updated!' : 'Startup project published!', 'success');
      setShowModal(false); setEditingStartup(null);
      setTitle('');
      setElevatorPitch('');
      setNeededRoles([]);
      fetchStartups();
    }
  };

  const handleApply = async (contactType, note) => {
    const contactVal = contactType === 'phone' ? currentUser.phone : currentUser.email;
    const res = await secureLegacyFetch(`${API_BASE}/community/startups/${applyingTo.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        roleCompetence: `${roleCompetence}${note ? ` | Note: ${note}` : ''}`,
        portfolioLink,
        contactInfo: `${contactType.toUpperCase()}: ${contactVal}`
      })
    });
    if (res.ok) {
      showToast('Application privately sent to the founder!', 'success');
      setApplyingTo(null);
      setRoleCompetence('');
      setPortfolioLink('');
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <FeatureHeader 
        title="Community StartUp"
        backLabel="Back to Board"
        onBack={onBack}
        description="Projects born from residents: propose or take part in ideas and projects in development."
      />

      <div className="flex justify-end">
        <button type="button" onClick={() => { setEditingStartup(null); setTitle(''); setElevatorPitch(''); setNeededRoles([]); setShowModal(true); }} className="px-5 py-2.5 bg-purple-800 hover:bg-purple-900 text-white rounded-xl text-xs font-bold shadow flex items-center gap-2"><Plus className="w-4 h-4" /> Propose Startup Project</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {startups.map(s => (
          <div key={s.id} className="bg-white rounded-3xl p-6 border shadow-sm flex flex-col justify-between space-y-4 hover:border-purple-300 transition-all">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase bg-purple-100 text-purple-900 px-2.5 py-0.5 rounded-full">
                  {s.industry}
                </span>
                <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {s.commitment_type}
                </span>
              </div>

              <div>
                <h4 className="font-['Oswald'] text-2xl uppercase font-bold text-gray-900">{s.title}</h4>
                <p className="text-[11px] font-semibold text-purple-700 mt-0.5">{s.stage}</p>
              </div>

              <div className="p-3 bg-[#FAF8F5] rounded-2xl border border-gray-200">
                <span className="text-[10px] font-bold uppercase text-gray-400 block mb-1">Elevator Pitch:</span>
                <p className="text-xs text-gray-800 font-serif leading-relaxed italic">
                  "{s.elevator_pitch}"
                </p>
              </div>

              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase text-gray-400 block">Roles Needed:</span>
                <div className="flex flex-wrap gap-1.5">
                  {(s.needed_roles || []).map((role, idx) => (
                    <span key={idx} className="text-[11px] font-medium bg-slate-100 text-slate-800 px-2.5 py-1 rounded-xl border">
                      {role}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t flex items-center justify-between text-xs gap-2">
              <div className="flex items-center gap-1.5"><ModerationActions endpoint="/community/startups" itemId={s.id} currentUser={currentUser} showToast={showToast} onSuccess={fetchStartups} level={2} />{s.founder_id === currentUser?.id && <><button onClick={() => handleOpenEdit(s)} className="p-1.5 text-gray-500" title="Edit startup"><Edit3 className="w-3.5 h-3.5" /></button><button onClick={() => handleDelete(s.id)} className="p-1.5 text-red-600" title="Delete startup"><Trash2 className="w-3.5 h-3.5" /></button></>}</div>
              <span className="text-gray-400">Founder: <strong>{s.founder_name}</strong> ({s.founder_section} Section)</span>
              {s.founder_id !== currentUser?.id && (
                <button 
                  onClick={() => setApplyingTo(s)} 
                  className="px-4 py-2 bg-purple-800 hover:bg-purple-900 text-white rounded-xl font-bold shadow flex items-center gap-1.5"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Apply as Collaborator</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* STARTUP PROJECT CREATION MODAL */}
      {showModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl">
            <h3 className="font-['Oswald'] text-2xl font-bold uppercase">{editingStartup ? 'Edit Startup Project' : 'New Startup Project'}</h3>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Project Name / Working Title *</label>
                <input required type="text" placeholder="e.g. Campus waste management app" value={title} onChange={e => setTitle(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">Sector / Industry *</label>
                  <select value={industry} onChange={e => setIndustry(e.target.value)} className="w-full p-2 border rounded-xl text-xs bg-white">
                    {industriesList.map(ind => <option key={ind} value={ind}>{ind}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">Progress Status *</label>
                  <select value={stage} onChange={e => setStage(e.target.value)} className="w-full p-2 border rounded-xl text-xs bg-white">
                    {stagesList.map(stg => <option key={stg} value={stg}>{stg}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold text-gray-700">Elevator Pitch (Vision and problem) *</label>
                  <span className={`text-[10px] ${elevatorPitch.length > 400 ? 'text-red-600 font-bold' : 'text-gray-400'}`}>
                    {elevatorPitch.length}/400 characters
                  </span>
                </div>
                <textarea 
                  required 
                  maxLength={400}
                  rows={3} 
                  placeholder="Briefly explain the problem you solve and your vision..." 
                  value={elevatorPitch} 
                  onChange={e => setElevatorPitch(e.target.value)} 
                  className="w-full p-2.5 border rounded-xl text-xs" 
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Who We're Looking For (Missing Roles) *</label>
                <div className="space-y-1.5">
                  {rolesAvailable.map(r => (
                    <label key={r} className="flex items-center gap-2 text-xs p-2 rounded-xl border hover:bg-gray-50 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={neededRoles.includes(r)} 
                        onChange={() => toggleRole(r)} 
                        className="text-purple-700 rounded"
                      />
                      <span>{r}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Type of Commitment *</label>
                <select value={commitmentType} onChange={e => setCommitmentType(e.target.value)} className="w-full p-2 border rounded-xl text-xs bg-white">
                  <option value="A few hours a week (side project)">A few hours a week (side project)</option>
                  <option value="Full-time to found a startup">Full-time to found a startup</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-purple-800 text-white rounded-xl text-xs font-bold shadow">{editingStartup ? 'Save Changes' : 'Publish Project'}</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* COLLABORATOR / CO-FOUNDER APPLICATION MODAL */}
      {applyingTo && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="font-['Oswald'] text-xl font-bold uppercase text-gray-900">
              Apply for {applyingTo.title}
            </h3>
            <p className="text-xs text-gray-600 font-serif">
              Privately send your profile to <strong>{applyingTo.founder_name}</strong> to arrange an introductory coffee chat.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Role / Skills You Can Offer *</label>
                <input 
                  required 
                  type="text" 
                  placeholder="e.g. I can handle the frontend and graphic design..." 
                  value={roleCompetence} 
                  onChange={e => setRoleCompetence(e.target.value)} 
                  className="w-full p-2.5 border rounded-xl text-xs" 
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">Portfolio / LinkedIn / GitHub Link (Optional)</label>
                <input 
                  type="url" 
                  placeholder="https://linkedin.com/in/... or GitHub" 
                  value={portfolioLink} 
                  onChange={e => setPortfolioLink(e.target.value)} 
                  className="w-full p-2.5 border rounded-xl text-xs" 
                />
              </div>

              <div className="border-t pt-3">
                <span className="text-xs font-bold text-gray-800 block mb-1">Verified Contact Sharing:</span>
                <ContactExchangeModal 
                  targetName={applyingTo.founder_name}
                  targetRoleDescription={`Co-Founder Application: ${applyingTo.title}`}
                  currentUser={currentUser}
                  onSend={handleApply}
                  onClose={() => setApplyingTo(null)}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
