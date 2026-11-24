import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, Megaphone, Search, CheckSquare, Square, Upload, 
  Image as ImageIcon, FileText, ExternalLink, Paperclip, MessageSquare, 
  Phone, Mail, Linkedin, Instagram, Check
} from 'lucide-react';
import { uploadMediaFile } from '../services/api';
import { STUDY_DISCIPLINES } from '../constants/studyDisciplines';
import { FLOOR_OPTIONS as ADMIN_FLOOR_OPTIONS, normalizeRoomInput as adminNormalizeRoom } from '../utils/security';
import { safeErrorMessage } from '../services/api';

export function WelcomeOverlay({ welcomeMessage, isDismissing, onDismiss }) {
  return (
    <div className={`fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 transition-opacity duration-500 ${isDismissing ? 'opacity-0' : 'opacity-100'}`}>
      <div className="bg-white rounded-3xl max-w-xl w-full p-8 text-center space-y-6 animate-fadeIn">
        <h2 className="font-['Oswald'] text-3xl font-bold uppercase text-gray-900">
          UNIVERSITY RESIDENCE PORTAL
        </h2>
        <div className="p-6 bg-[#FAF8F5] rounded-2xl border border-gray-200 text-sm font-serif leading-relaxed text-left whitespace-pre-line">
          {welcomeMessage || 'Welcome to the official resident community portal.'}
        </div>
        <button 
          type="button"
          onClick={onDismiss} 
          className="w-full py-3.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-2xl font-['Oswald'] text-lg uppercase shadow-xl transition-all"
        >
          Enter Students Portal
        </button>
      </div>
    </div>
  );
}

export function AdminBroadcastModal({ students = [], onClose, onSend, showToast }) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');

  const [targetScope, setTargetScope] = useState('all');

  const [selectedSection, setSelectedSection] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [activeFilter, setActiveFilter] = useState(null); // 'residence' | 'status'

  const [selectedRecipientIds, setSelectedRecipientIds] = useState([]);
  const [studentSearchTerm, setStudentSearchTerm] = useState('');
  
  const [attachments, setAttachments] = useState([]);
  const [linkInput, setLinkInput] = useState('');
  const [linkTitleInput, setLinkTitleInput] = useState('');

  const RESIDENCE_SECTIONS = [
    'Residence_name_1',
    'Residence_name_2',
    'Residence_name_3'
  ];

  const RESIDENT_STATUSES = [
    'In Residence',
    'Alumni',
    'Admin',
    'SuperAdmin'
  ];

  const getResidentStatus = student => {
    if (student.role === 'admin') return 'Admin';
    if (student.role === 'superadmin') return 'SuperAdmin';
    return student.isCurrentlyInCollege
      ? 'In Residence'
      : 'Alumni';
  };

  const filteredByActiveFilters = useMemo(() => {
    return students.filter(student => {
      const matchesSection =
        !selectedSection ||
        student.residence === selectedSection;

      const matchesStatus =
        !selectedStatus ||
        getResidentStatus(student) === selectedStatus;

      return matchesSection && matchesStatus;
    });
  }, [students, selectedSection, selectedStatus]);

  useEffect(() => {
    if (targetScope !== 'individual') return;

    setSelectedRecipientIds(
      filteredByActiveFilters.map(student => String(student.id))
    );
  }, [
    targetScope,
    selectedSection,
    selectedStatus,
    filteredByActiveFilters
  ]);

  const searchedStudents = useMemo(() => {
    if (!studentSearchTerm) return students;
    const term = studentSearchTerm.toLowerCase();
    return students.filter(s => 
      (s.name && s.name.toLowerCase().includes(term)) ||
      (s.email && s.email.toLowerCase().includes(term))
    );
  }, [students, studentSearchTerm]);

  const toggleStudentSelection = (studentId) => {
    setSelectedRecipientIds(prev => 
      prev.includes(studentId) ? prev.filter(id => id !== studentId) : [...prev, studentId]
    );
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      try {
        const isPhoto = file.type.startsWith('image/');
        const uploadedUrl = await uploadMediaFile(file);
        setAttachments(prev => [
          ...prev,
          {
            name: file.name,
            url: uploadedUrl,
            type: isPhoto ? 'photo' : 'file',
            size: `${(file.size / 1024).toFixed(1)} KB`
          }
        ]);
      } catch (err) {
        if (showToast) showToast(safeErrorMessage(err) || 'File upload failed.', 'error');
      }
    }
    e.target.value = '';
  };

  const handleAddLink = () => {
    if (!linkInput.trim()) return;
    const formattedUrl = linkInput.startsWith('http') ? linkInput.trim() : `https://${linkInput.trim()}`;
    setAttachments(prev => [
      ...prev,
      {
        name: linkTitleInput.trim() || linkInput.trim(),
        url: formattedUrl,
        type: 'link'
      }
    ]);
    setLinkInput('');
    setLinkTitleInput('');
  };

  const handleSubmit = e => {
    e.preventDefault();

    if (!title.trim() || !message.trim()) return;

    if (
      targetScope === 'individual' &&
      selectedRecipientIds.length === 0
    ) {
      showToast?.('Select at least one recipient.', 'error');
      return;
    }

    onSend({
      title: title.trim(),
      message: message.trim(),

      targetScope,

      targetFilters: {
        sections: selectedSection
          ? [selectedSection]
          : [],

        statuses: selectedStatus
          ? [selectedStatus]
          : [],

        residentIds:
          targetScope === 'individual'
            ? selectedRecipientIds
            : []
      },

      // Explicit IDs are only used for Specific Resident mode.
      targetStudentIds:
        targetScope === 'individual'
          ? selectedRecipientIds
          : [],

      attachments
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-5 animate-fadeIn">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-[#B31217]" />
            <h3 className="font-['Oswald'] text-xl font-bold uppercase tracking-wider text-gray-900">
              Send Institutional Announcement
            </h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2 bg-[#FAF8F5] p-3.5 rounded-2xl border border-gray-200">
            <label className="text-xs font-bold text-gray-800 block">Recipients Scope</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => {
                  setTargetScope('all');
                  setSelectedSection('');
                  setSelectedStatus('');
                  setSelectedRecipientIds([]);
                  setStudentSearchTerm('');
                  setActiveFilter(null);
                }}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  targetScope === 'all' && !selectedSection && !selectedStatus
                    ? 'bg-[#B31217] text-white border-[#B31217] shadow'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                }`}
              >
                All Residents
              </button>

              <button
                type="button"
                onClick={() => setTargetScope('individual')}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  targetScope === 'individual'
                    ? 'bg-[#B31217] text-white border-[#B31217] shadow'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                }`}
              >
                Specific Resident
              </button>

              <button
                type="button"
                onClick={() => setActiveFilter('residence')}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  activeFilter === 'residence'
                    ? 'bg-[#B31217] text-white border-[#B31217] shadow'
                    : selectedSection
                      ? 'bg-red-100 text-[#B31217] border-red-300'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                }`}
              >
                Residence
              </button>

              <button
                type="button"
                onClick={() => setActiveFilter('status')}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  activeFilter === 'status'
                    ? 'bg-[#B31217] text-white border-[#B31217] shadow'
                    : selectedStatus
                      ? 'bg-red-100 text-[#B31217] border-red-300'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                }`}
              >
                Status
              </button>
            </div>

            {activeFilter === 'residence' && (
              <div className="mt-3">
                <label className="text-[11px] font-bold text-gray-700 block mb-1">
                  Residence
                </label>
                <select
                  value={selectedSection}
                  onChange={e => {
                    setSelectedSection(e.target.value);
                    if (e.target.value) setTargetScope('individual');
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs bg-white"
                >
                  <option value="">All residences</option>
                  {RESIDENCE_SECTIONS.map(section => (
                    <option key={section} value={section}>{section}</option>
                  ))}
                </select>
              </div>
            )}

            {activeFilter === 'status' && (
              <div className="mt-3">
                <label className="text-[11px] font-bold text-gray-700 block mb-1">
                  Role / Status
                </label>
                <select
                  value={selectedStatus}
                  onChange={e => {
                    setSelectedStatus(e.target.value);
                    if (e.target.value) setTargetScope('individual');
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs bg-white"
                >
                  <option value="">All statuses</option>
                  {RESIDENT_STATUSES.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>
            )}

            {targetScope === 'individual' && (
              <div className="space-y-3 mt-3">
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div>
                      <p className="text-xs font-bold text-gray-800">
                        Matching residents
                      </p>

                      <p className="text-[10px] text-gray-400">
                        Matching residents are selected automatically.
                      </p>
                    </div>

                    <span className="text-[10px] font-bold text-[#B31217]">
                      {selectedRecipientIds.length} selected
                    </span>
                  </div>

                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {filteredByActiveFilters.map(student => {
                      const id = String(student.id);
                      const isSelected = selectedRecipientIds.includes(id);

                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => toggleStudentSelection(id)}
                          className={`w-full flex items-center justify-between gap-2 p-2 rounded-lg text-xs text-left ${
                            isSelected
                              ? 'bg-red-50 text-[#B31217] border border-red-200'
                              : 'hover:bg-gray-50 text-gray-700'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 shrink-0" />
                            )}

                            <span className="truncate">
                              {student.name}
                            </span>
                          </span>

                          <span className="text-[10px] text-gray-400 shrink-0">
                            {student.residence || '—'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <div className="relative flex items-center">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3" />

                    <input
                      type="text"
                      placeholder="Others / search residents..."
                      value={studentSearchTerm}
                      onChange={e => setStudentSearchTerm(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-xl text-xs"
                    />
                  </div>

                  {studentSearchTerm.trim() && (
                    <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                      {students
                        .filter(student => {
                          const term = studentSearchTerm.toLowerCase().trim();

                          return (
                            student.name?.toLowerCase().includes(term) ||
                            student.email?.toLowerCase().includes(term)
                          );
                        })
                        .map(student => {
                          const id = String(student.id);
                          const isSelected = selectedRecipientIds.includes(id);

                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => toggleStudentSelection(id)}
                              className={`w-full flex items-center gap-2 p-2 rounded-lg text-xs text-left ${
                                isSelected
                                  ? 'bg-red-50 text-[#B31217]'
                                  : 'hover:bg-white text-gray-700'
                              }`}
                            >
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 shrink-0" />
                              ) : (
                                <Square className="w-4 h-4 shrink-0" />
                              )}

                              <span className="truncate">
                                {student.name}
                              </span>

                              <span className="ml-auto text-[10px] text-gray-400">
                                {student.residence || '—'}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Title *</label>
            <input required type="text" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm" />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Message Body *</label>
            <textarea required rows={4} maxLength={5000} value={message} onChange={e => setMessage(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm" />
          </div>

          <div className="space-y-3 p-3.5 bg-[#FAF8F5] rounded-2xl border border-gray-200">
            <label className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
              <Paperclip className="w-4 h-4 text-[#B31217]" />
              <span>Attachments & Links</span>
            </label>

            <div className="flex flex-wrap gap-2">
              <label className="cursor-pointer bg-white hover:bg-gray-100 border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold text-gray-700 flex items-center gap-1.5 shadow-sm">
                <Upload className="w-3.5 h-3.5 text-[#B31217]" />
                <span>Upload File / Document</span>
                <input type="file" multiple onChange={handleFileUpload} className="hidden" />
              </label>

              <label className="cursor-pointer bg-white hover:bg-gray-100 border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold text-gray-700 flex items-center gap-1.5 shadow-sm">
                <ImageIcon className="w-3.5 h-3.5 text-blue-600" />
                <span>Upload Photo</span>
                <input type="file" accept="image/*" multiple onChange={handleFileUpload} className="hidden" />
              </label>
            </div>

            <div className="flex gap-2 pt-1">
              <input 
                type="text" 
                placeholder="Link Title" 
                value={linkTitleInput} 
                onChange={e => setLinkTitleInput(e.target.value)} 
                className="w-1/3 px-3 py-1.5 border rounded-xl text-xs bg-white"
              />
              <input 
                type="url" 
                placeholder="https://..." 
                value={linkInput} 
                onChange={e => setLinkInput(e.target.value)} 
                className="flex-1 px-3 py-1.5 border rounded-xl text-xs bg-white"
              />
              <button 
                type="button" 
                onClick={handleAddLink} 
                disabled={!linkInput.trim()} 
                className="px-3 py-1.5 bg-gray-800 hover:bg-black disabled:bg-gray-300 text-white rounded-xl text-xs font-bold"
              >
                Add Link
              </button>
            </div>

            {attachments.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-gray-200">
                {attachments.map((att, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-white rounded-xl border text-xs">
                    <span className="font-semibold text-gray-800 truncate">{att.name}</span>
                    <button 
                      type="button" 
                      onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))} 
                      className="text-gray-400 hover:text-red-600 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-3 flex justify-end gap-3 border-t">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-semibold">Cancel</button>
            <button type="submit" className="px-6 py-2 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-semibold shadow">
              Broadcast
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ContactRequestModal({ targetStudent, onClose, onSend }) {
  const [selectedChannels, setSelectedChannels] = useState({
    phone: true,
    instagram: false,
    email: false,
    linkedin: false
  });
  const [note, setNote] = useState('');

  const toggleChannel = (key) => {
    setSelectedChannels(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const channels = Object.keys(selectedChannels).filter(k => selectedChannels[k]);
    if (channels.length === 0) return;
    onSend(channels, note);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-fadeIn">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="font-['Oswald'] text-xl font-bold uppercase tracking-wider text-gray-900 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-blue-600" />
            Request Contact Details
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-gray-600">
          Select which contact details you would like to request from <strong>{targetStudent?.name}</strong>:
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            {[
              { id: 'phone', label: 'Telephone Number', icon: Phone, color: 'text-blue-600' },
              { id: 'instagram', label: 'Instagram Profile', icon: Instagram, color: 'text-pink-600' },
              { id: 'email', label: 'Email Address', icon: Mail, color: 'text-purple-600' },
              { id: 'linkedin', label: 'LinkedIn Profile', icon: Linkedin, color: 'text-blue-700' }
            ].map(ch => {
              const Icon = ch.icon;
              return (
                <button 
                  key={ch.id}
                  type="button" 
                  onClick={() => toggleChannel(ch.id)}
                  className={`w-full p-3 rounded-xl border flex items-center justify-between transition-all ${
                    selectedChannels[ch.id] ? 'bg-blue-50 border-blue-500 text-blue-900 font-bold' : 'bg-white border-gray-200 text-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <Icon className={`w-4 h-4 ${ch.color}`} />
                    <span>{ch.label}</span>
                  </div>
                  {selectedChannels[ch.id] && <Check className="w-4 h-4 text-blue-600" />}
                </button>
              );
            })}
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Attached Note (Optional)</label>
            <textarea 
              rows={2}
              maxLength={500}
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full px-3 py-2 border border-[#D5D3CC] rounded-xl text-xs focus:outline-none focus:border-[#B31217]"
              placeholder="Hi! Let's connect regarding residence activities..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-xs font-bold">Cancel</button>
            <button 
              type="submit" 
              disabled={!Object.values(selectedChannels).some(Boolean)}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-xl text-xs font-bold shadow"
            >
              Send Request
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ReportAccountModal({ targetStudent, onClose, onSubmit }) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-fadeIn">
        <h3 className="font-['Oswald'] text-xl font-bold uppercase text-red-600">Report Resident Account</h3>
        <p className="text-xs text-gray-600">Please provide a clear justification for flagging {targetStudent?.name}:</p>
        <textarea 
          required 
          rows={3} 
          maxLength={1000}
          placeholder="State security concern or reason..." 
          value={reason} 
          onChange={e => setReason(e.target.value)} 
          className="w-full p-3 border rounded-xl text-xs focus:outline-none focus:border-red-600" 
        />
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
          <button 
            type="button" 
            disabled={!reason.trim()}
            onClick={() => onSubmit(reason.trim())} 
            className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-xl text-xs font-bold shadow"
          >
            Submit Report
          </button>
        </div>
      </div>
    </div>
  );
}

export function CreateUserModal({ onClose, onSubmit }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [residence, setResidence] = useState('Residence_name_1');
  const [course, setCourse] = useState('Computer Engineering');
  const [role, setRole] = useState('student');
  const [floor, setFloor] = useState('');
  const [room, setRoom] = useState('');

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-fadeIn">
        <h3 className="font-['Oswald'] text-xl font-bold uppercase text-purple-900">
          Create Resident Account (SuperAdmin Direct)
        </h3>
        <form 
          onSubmit={(e) => { 
            e.preventDefault(); 
            onSubmit({ 
              firstName: firstName.trim(), 
              lastName: lastName.trim(), 
              email: email.trim().toLowerCase(), 
              password, 
              residence, 
              course: course.trim(), 
              role,
              ...(floor ? { floor } : {}),
              ...(room ? { room } : {})
            }); 
          }} 
          className="space-y-3"
        >
          <input required type="text" placeholder="First Name" value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs" />
          <input required type="text" placeholder="Last Name" value={lastName} onChange={e => setLastName(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs" />
          <input required type="email" placeholder="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs" />
          <input required type="password" minLength={8} placeholder="Password (min 8 chars)" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs" />
          
          <select value={residence} onChange={e => setResidence(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs">
            {['Residence_name_1','Residence_name_2','Residence_name_3'].map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>

          <div className="grid grid-cols-2 gap-2">
            <select value={floor} onChange={e => setFloor(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs bg-white">
              <option value="">Floor (optional)</option>
              {ADMIN_FLOOR_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <input type="text" inputMode="numeric" placeholder="Room (optional)" value={room} onChange={e => setRoom(adminNormalizeRoom(e.target.value))} className="w-full px-3 py-2 border rounded-xl text-xs" />
          </div>

          <select required value={course} onChange={e => setCourse(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs bg-white"><option value="">Select field of study</option>{STUDY_DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}</select>

          <select value={role} onChange={e => setRole(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-xs font-bold">
            <option value="student">Student Resident</option>
            <option value="admin">Admin</option>
            <option value="superadmin">SuperAdmin</option>
          </select>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold">Cancel</button>
            <button type="submit" className="px-5 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold shadow">
              Create & Verify
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}