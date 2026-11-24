import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Users, BookOpen, Globe, Compass, Home, Bell, ShieldAlert, 
  MessageCircle, Crown, ShieldCheck, ArrowLeft, User, Plus, 
  Edit3, LogOut, CheckCircle2, AlertCircle, Clock, Award, X,
  Trash2
} from 'lucide-react';

import { authApi, userApi, commsApi } from './services/api';
import { FooterBar } from './components/FooterBar';

import { DirectoryView } from './components/DirectoryView';
import { YearbookView } from './components/YearbookView';
import { ProfileView } from './components/ProfileView';
import { MapView } from './components/MapView';
import { RegisterModal, RegistrationSuccessModal } from './components/RegisterModal';
import { EditProfileModal } from './components/EditProfileModal';
import { AdminDashboardView } from './components/AdminDashboardView';
import { CampusStudioHub } from './components/CampusStudioHub';
import { CommunityHub } from './components/CommunityHub';
import { NotificationsView } from './components/NotificationsView';
import { ConcernLetterView } from './components/ConcernLetterView';
import { safeErrorMessage } from './services/api';
import { 
  WelcomeOverlay, 
  AdminBroadcastModal, 
  ContactRequestModal, 
  ReportAccountModal, 
  CreateUserModal 
} from './components/AdministrativeModals';

async function fetchAllPaginated(fetchPageFn) {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50;
  let offset = 0;
  let all = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchPageFn({ limit: PAGE_SIZE, offset });
    const items = res?.items || [];
    all = all.concat(items);

    const total = typeof res?.total === 'number' ? res.total : all.length;
    offset += PAGE_SIZE;

    if (items.length < PAGE_SIZE || all.length >= total) break;
  }

  return all;
}

const COMMUNITY_VIEW_IDS = [
  'community', 'study_rooms', 'time_capsule', 'academics_map',
  'social_kitchen', 'jukebox', 'match_finder', 'city_guide', 'tandem',
  'passion_clubs', 'marketplace', 'freebox', 'startup'
];

export default function App() {
  const [students, setStudents] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [adminChatMessages, setAdminChatMessages] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [contactShares, setContactShares] = useState({});


  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [concernLetter, setConcernLetter] = useState({
    title: "To Whom It May Concern",
    authorName: "Author Name",
    authorRole: "Platform founder",
    authorPhoto: '/uploads/alco_prfpic.webp',
    content: "",
    footerLeft: "University Residence",
    footerRight: "Signed Letter"
  });

  const [currentView, setCurrentView] = useState('directory');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterBirthYear, setFilterBirthYear] = useState('All');
  const [filterSection, setFilterSection] = useState('All');
  const [filterCourseCluster, setFilterCourseCluster] = useState('All');
  const [filterAcademicYear, setFilterAcademicYear] = useState('All');
  const [filterContinent, setFilterContinent] = useState('All');
  const [filterCountry, setFilterCountry] = useState('All');
  const [filterResidentStatus, setFilterResidentStatus] = useState('All');
  const [filterRoleAdmin, setFilterRoleAdmin] = useState('All');

  const [currentUser, setCurrentUser] = useState(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [showContactRequestModal, setShowContactRequestModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [showWelcomeOverlay, setShowWelcomeOverlay] = useState(false);
  const [isDismissingWelcome, setIsDismissingWelcome] = useState(false);
  const [showSuccessRegisterModal, setShowSuccessRegisterModal] = useState(false);

  const [targetContactStudent, setTargetContactStudent] = useState(null);
  const [targetReportStudent, setTargetReportStudent] = useState(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const [notificationToast, setNotificationToast] = useState(null);

  const toastTimeoutRef = useRef(null);
  const showToast = useCallback((message, type = 'success') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    
    // If message is an object, convert it to normal text so React never crashes
    const safeText = typeof message === 'string'
      ? message
      : (message?.error || message?.message || String(message || 'Notification'));

    setNotificationToast({ message: safeText, type });
    toastTimeoutRef.current = setTimeout(() => {
      setNotificationToast(null);
    }, 4000);
  }, []);

  const contactsShared = useMemo(() => {
    if (!currentUser) return {};
    const map = {};

    notifications.forEach((n) => {
      if (n.type === 'contact_approved' && n.targetStudentId) {
        const key = `${currentUser.id}_${n.targetStudentId}`;
        let data = {};

        const structAtt = Array.isArray(n.attachments) 
          ? n.attachments.find(a => a.type === 'shared_data') 
          : null;

        if (structAtt && structAtt.data) {
          data = { ...structAtt.data };
        } else if (n.message) {
          const lines = n.message.split('\n');
          lines.forEach(line => {
            if (line.includes('📞 Telephone:')) data.phone = line.replace(/.*📞 Telephone:\s*/, '').trim();
            if (line.includes('📸 Instagram:')) data.instagram = line.replace(/.*📸 Instagram:\s*/, '').trim();
            if (line.includes('✉️ Email:')) data.email = line.replace(/.*✉️ Email:\s*/, '').trim();
            if (line.includes('💼 LinkedIn:')) data.linkedin = line.replace(/.*💼 LinkedIn:\s*/, '').trim();
          });
        }
        map[key] = { ...(map[key] || {}), ...data };
      }
    });


      Object.entries(contactShares).forEach(([ownerId, data]) => {
      const key = `${currentUser.id}_${ownerId}`;
      map[key] = { ...(map[key] || {}), ...data };
    });

    return map;
  }, [notifications, currentUser, contactShares]);

  useEffect(() => {
    const compactViews = [
      'profile', 'map', 'notifications', 'admin_chat', 'suggestions', 
      'letter', 'yearbook', 'audit_logs', 'campus', 'community',
      'study_rooms', 'time_capsule', 'academics_map', 'social_kitchen', 
      'jukebox', 'match_finder', 'city_guide', 'tandem',  
      'passion_clubs', 'marketplace', 'freebox', 'startup', 'admin'
    ];
    setIsSidebarExpanded(!compactViews.includes(currentView));
  }, [currentView]);

  const fetchInitialData = useCallback(async (userOverride = null, signal = null) => {
    try {
      let loggedUser = userOverride;
      if (!userOverride) {
        try {
          const meData = await authApi.getMe(signal);
          loggedUser = meData.user;
          setCurrentUser(loggedUser);
        } catch (err) {
          if (err?.name === 'AbortError') return;
          if (err?.status === 401 || err?.status === 403) {
            loggedUser = null;
            setCurrentUser(null);
          } else {
            console.warn('[SESSION CHECK] Temporary failure, keeping the session:', err?.message);
            return;
          }
        }
      } else {
        loggedUser = userOverride;
        setCurrentUser(userOverride);
      }

      const usersData = await fetchAllPaginated((params) => userApi.getAllUsers(params, signal));
      setStudents(usersData);
      if (usersData.length > 0 && !selectedStudentId) {
        setSelectedStudentId(usersData[0].id);
      }

      if (loggedUser) {
        const notifData = await commsApi.getNotifications(signal);
        setNotifications(notifData);
        try { setContactShares(await commsApi.getContactShares(signal)); } catch { /* null */ }

        if (loggedUser.role === 'admin' || loggedUser.role === 'superadmin') {
          const chatData = await commsApi.getAdminChat(signal);
          setAdminChatMessages(chatData);
        }

        if (loggedUser.role === 'superadmin') {
          const sugData = await commsApi.getSuggestions(signal);
          setSuggestions(sugData);
        }
      } else {
        setNotifications([]);
        setAdminChatMessages([]);
        setSuggestions([]);
      }

      const settingsData = await commsApi.getSettings(signal);
      setWelcomeMessage(settingsData.welcomeMessage || '');
      if (settingsData.concernLetter) {
        try {
          const parsed = typeof settingsData.concernLetter === 'string'
            ? JSON.parse(settingsData.concernLetter)
            : settingsData.concernLetter;
          setConcernLetter(prev => ({ ...prev, ...parsed }));
        } catch {
          setConcernLetter(prev => ({ ...prev, content: settingsData.concernLetter }));
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[API RECOVERY ERROR]: Failed fetching initial application state:', err);
      }
    }
  }, [selectedStudentId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchInitialData(null, controller.signal);

    const interval = setInterval(() => {
      fetchInitialData(null, controller.signal);
    }, 60000);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchInitialData]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (window.L) {
      setLeafletReady(true);
      return;
    }

    const cssId = 'leaflet-css-bundle';
    if (!document.getElementById(cssId)) {
      const link = document.createElement('link');
      link.id = cssId;
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    const scriptId = 'leaflet-js-bundle';
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.async = true;
      script.onload = () => setLeafletReady(true);
      document.head.appendChild(script);
    }
  }, []);

  const visibleNotifications = useMemo(() => {
    if (!currentUser) return [];
    return notifications.filter(n => {
      if (['contact_request', 'contact_approved', 'join_request', 'join_response'].includes(n.type)) {
        if (n.recipientId === currentUser.id) return true;
        if (Array.isArray(n.recipientIds) && n.recipientIds.includes(currentUser.id)) return true;
        return false;
      }

        if (currentUser.role === 'admin' || currentUser.role === 'superadmin') {
        if (n.recipientScope === 'all' || n.recipientScope === 'admin') return true;
        if (n.recipientId === currentUser.id) return true;
        if (Array.isArray(n.recipientIds) && n.recipientIds.includes(currentUser.id)) return true;
        return false;
      }

      if (n.recipientId === currentUser.id) return true;
      if (n.recipientScope === 'all') return true;
      if (Array.isArray(n.recipientIds) && n.recipientIds.includes(currentUser.id)) return true;
      return false;
    });
  }, [notifications, currentUser]);

  const unreadCount = useMemo(() => {
    return visibleNotifications.filter(n => n.status === 'pending').length;
  }, [visibleNotifications]);

  const selectedStudent = useMemo(() => {
    return students.find(s => s.id === selectedStudentId) || students[0] || {};
  }, [students, selectedStudentId]);

  const verifiedStudents = useMemo(() => {
    return students.filter(s => Boolean(s.verified) === true && !s.isHidden);
  }, [students]);

  const pendingStudents = useMemo(() => {
    return students.filter(s => Boolean(s.verified) === false && !s.isHidden);
  }, [students]);

  const filteredStudents = useMemo(() => {
    return verifiedStudents.filter(s => {
      if (!s) return false;

      const sName = String(s.name || `${s.firstName || ''} ${s.lastName || ''}`).toLowerCase();
      const sCourse = String(s.course || '').toLowerCase();
      const sCity = String(s.originCity || '').toLowerCase();
      const search = searchTerm.toLowerCase();

      const matchesSearch = 
        !searchTerm ||
        sName.includes(search) ||
        sCourse.includes(search) ||
        sCity.includes(search);

      const matchesBirthYear = filterBirthYear === 'All' || String(s.birthYear || '') === String(filterBirthYear);
      const matchesSection = filterSection === 'All' || s.residence === filterSection;
      const matchesCluster = filterCourseCluster === 'All' || s.course === filterCourseCluster;
      const matchesAcademicYear = filterAcademicYear === 'All' || s.academicYear === filterAcademicYear;
      const matchesContinent = filterContinent === 'All' || s.originContinent === filterContinent;
      const matchesCountry = filterCountry === 'All' || s.originCountry === filterCountry;

      const matchesResidentStatus = filterResidentStatus === 'All' || 
        (filterResidentStatus === 'In Residence' && Boolean(s.isCurrentlyInCollege)) ||
        (filterResidentStatus === 'Alumni' && !s.isCurrentlyInCollege);

      const matchesRoleAdmin = filterRoleAdmin === 'All' || 
        (filterRoleAdmin === 'Admins Only' && (s.role === 'admin' || s.role === 'superadmin')) ||
        (filterRoleAdmin === 'Residents Only' && s.role === 'student');

      return matchesSearch && matchesBirthYear && matchesSection && matchesCluster && 
             matchesAcademicYear && matchesContinent && matchesCountry && 
             matchesResidentStatus && matchesRoleAdmin;
    });
  }, [
    verifiedStudents, searchTerm, filterBirthYear, filterSection, filterCourseCluster,
    filterAcademicYear, filterContinent, filterCountry, filterResidentStatus, filterRoleAdmin
  ]);

  const handleLogin = async (identifier, password, otpCode) => {
    try {
      const data = await authApi.login(identifier, password, otpCode);
      if (data.require2FA) {
        return { require2FA: true, message: data.message };
      }

      setCurrentUser(data.user);
      setSelectedStudentId(data.user.id);
      setShowLoginModal(false);
      showToast(`Welcome back, ${data.user.firstName}!`, 'success');

      await fetchInitialData(data.user);

      if (!data.user.hasSeenWelcome) {
        setIsDismissingWelcome(false);
        setShowWelcomeOverlay(true);
      }
      return { success: true };
    } catch (err) {
      showToast(safeErrorMessage(err) || 'Authentication failed. Please verify credentials.', 'error');
      throw err;
    }
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch (err) {
      console.error('Logout error:', err);
    }
    setCurrentUser(null);
    setNotifications([]);
    setContactShares({});
    setAdminChatMessages([]);
    setSuggestions([]);
    // The directory loaded while logged in still contains photos/fields that
    // are hidden from anonymous visitors. Drop it NOW and reload the public
    // view, instead of leaving it on screen until the next 30s poll.
    setStudents([]);
    fetchInitialData();
    if (['admin', 'notifications', 'admin_chat', 'audit_logs'].includes(currentView)) {
      setCurrentView('directory');
    }
    showToast('Session terminated.', 'info');
  };

  const handleDismissWelcome = async () => {
    setIsDismissingWelcome(true);
    try {
      await userApi.dismissWelcome();
      if (currentUser) {
        setCurrentUser(prev => ({ ...prev, hasSeenWelcome: true }));
      }
    } catch (e) {
      console.error(e);
    }
    setTimeout(() => {
      setShowWelcomeOverlay(false);
      setIsDismissingWelcome(false);
    }, 450);
  };

  const handleOpenProfile = (id) => {
    if (!students.some(s => s.id === id)) {
      showToast('This profile is not available yet. Please try again in a few seconds.', 'info');
      return;
    }
    setSelectedStudentId(id);
    setCurrentView('profile');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#F4F3EF] text-[#1A1A1A] font-sans flex flex-col antialiased selection:bg-[#B31217] selection:text-white relative">
      {/* Welcome Modal */}
      {showWelcomeOverlay && (
        <WelcomeOverlay 
          welcomeMessage={welcomeMessage}
          isDismissing={isDismissingWelcome}
          onDismiss={handleDismissWelcome}
        />
      )}

      {/* Notifications Toast */}
      {notificationToast && (
        <div 
          role="status"
          aria-live="polite"
          className={`fixed top-5 right-5 z-[9999] px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 text-sm font-semibold border transition-all animate-bounce ${
            notificationToast.type === 'error' 
              ? 'bg-red-600 text-white border-red-700' 
              : notificationToast.type === 'info'
              ? 'bg-blue-600 text-white border-blue-700'
              : 'bg-emerald-700 text-white border-emerald-800'
          }`}
        >
          {notificationToast.type === 'error' && <AlertCircle className="w-5 h-5 shrink-0" />}
          {notificationToast.type === 'info' && <Clock className="w-5 h-5 shrink-0" />}
          {notificationToast.type === 'success' && <CheckCircle2 className="w-5 h-5 shrink-0" />}
          <span>{notificationToast.message}</span>
        </div>
      )}

      <div className="flex-1 flex flex-col md:flex-row min-w-0">
        <Sidebar 
          isExpanded={isSidebarExpanded} 
          onToggle={() => setIsSidebarExpanded(!isSidebarExpanded)}
          currentView={currentView}
          setCurrentView={setCurrentView}
          currentUser={currentUser}
          unreadCount={unreadCount}
          onOpenMyProfile={() => { if (currentUser) handleOpenProfile(currentUser.id); }}
        />

        <div className="flex-1 flex flex-col min-w-0 min-h-screen">
          <Header 
            currentView={currentView} 
            onBack={() => setCurrentView('directory')}
            currentUser={currentUser}
            unreadCount={unreadCount}
            setCurrentView={setCurrentView}
            onOpenLogin={() => setShowLoginModal(true)}
            onOpenRegister={() => setShowRegisterModal(true)}
            onOpenEditProfile={() => setShowEditProfileModal(true)}
            onOpenMyProfile={() => { if (currentUser) handleOpenProfile(currentUser.id); }}
            onLogout={handleLogout}
          />

          <main className="flex-1 p-4 md:p-8 max-w-[1600px] w-full mx-auto pb-12">
            {currentView === 'directory' && (
              <DirectoryView 
                students={filteredStudents}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                filterBirthYear={filterBirthYear}
                setFilterBirthYear={setFilterBirthYear}
                filterSection={filterSection}
                setFilterSection={setFilterSection}
                filterCourseCluster={filterCourseCluster}
                setFilterCourseCluster={setFilterCourseCluster}
                filterAcademicYear={filterAcademicYear}
                setFilterAcademicYear={setFilterAcademicYear}
                filterContinent={filterContinent}
                setFilterContinent={setFilterContinent}
                filterCountry={filterCountry}
                setFilterCountry={setFilterCountry}
                filterResidentStatus={filterResidentStatus}
                setFilterResidentStatus={setFilterResidentStatus}
                filterRoleAdmin={filterRoleAdmin}
                setFilterRoleAdmin={setFilterRoleAdmin}
                onSelectStudent={handleOpenProfile}
                currentUser={currentUser}
              />
            )}

            {currentView === 'yearbook' && (
              <YearbookView 
                students={verifiedStudents}
                currentUser={currentUser}
                onSelectStudent={handleOpenProfile}
              />
            )}

            {currentView === 'admin' && (currentUser?.role === 'admin' || currentUser?.role === 'superadmin') && (
              <AdminDashboardView 
                allStudents={students.filter(s => !s.isHidden)}
                pendingStudents={pendingStudents}
                currentUser={currentUser}
                welcomeMessage={welcomeMessage}
                onUpdateWelcomeMessage={async (msg) => {
                  await commsApi.updateSetting('welcomeMessage', msg);
                  setWelcomeMessage(msg);
                  showToast('Welcome screen message updated!', 'success');
                }}
                onApprove={async (id) => {
                  try {
                    const approved = await userApi.approveUser(id);
                    setStudents(prev => prev.map(s => s.id === id ? approved : s));
                    showToast('Resident account approved!', 'success');
                  } catch (err) { showToast(safeErrorMessage(err) || 'The operation could not be completed.', 'error'); }
                }}
                onReject={async (id) => {
                  try {
                    await userApi.deleteUser(id);
                    setStudents(prev => prev.filter(s => s.id !== id));
                    showToast('Account removed from directory.', 'info');
                  } catch (err) { showToast(safeErrorMessage(err) || 'The operation could not be completed.', 'error'); }
                }}
                onSelectStudent={handleOpenProfile}
                onPromoteToAdmin={async (id) => {
                  try {
                    const updated = await userApi.updateUserRole(id, { role: 'admin', status: 'Admin' });
                    setStudents(prev => prev.map(s => s.id === id ? updated : s));
                    showToast('Resident promoted to Administrator!', 'success');
                  } catch (err) { showToast(safeErrorMessage(err) || 'The operation could not be completed.', 'error'); }
                }}
                onPromoteToSuperAdmin={async (id) => {
                  try {
                    const updated = await userApi.updateUserRole(id, { role: 'superadmin', status: 'SuperAdmin' });
                    setStudents(prev => prev.map(s => s.id === id ? updated : s));
                    showToast('SuperAdmin privileges granted!', 'success');
                  } catch (err) { showToast(safeErrorMessage(err) || 'The operation could not be completed.', 'error'); }
                }}
                onDemoteToStudent={async (id) => {
                  try {
                    const target = students.find(s => s.id === id);
                    const updated = await userApi.updateUserRole(id, {
                      role: 'student',
                      status: target?.isCurrentlyInCollege ? 'In Residence' : 'Alumni'
                    });
                    setStudents(prev => prev.map(s => s.id === id ? updated : s));
                    showToast('User demoted to standard resident status.', 'info');
                  } catch (err) { showToast(safeErrorMessage(err) || 'The operation could not be completed.', 'error'); }
                }}
                onDeleteUserAccount={async (id) => {
                  if (!window.confirm('Delete this account permanently?')) return;
                  try {
                    await userApi.deleteUser(id);
                    setStudents(prev => prev.filter(s => s.id !== id));
                    showToast('Resident deleted.', 'info');
                  } catch (err) { showToast(safeErrorMessage(err) || 'The operation could not be completed.', 'error'); }
                }}
                onOpenBroadcastModal={() => setShowBroadcastModal(true)}
                onOpenCreateUserModal={() => setShowCreateUserModal(true)}
              />
            )}

            {currentView === 'profile' && (
              <ProfileView 
                student={selectedStudent} 
                currentUser={currentUser}
                contactsShared={contactsShared}
                showToast={showToast}
                onEndorse={async (studentId) => {
                  if (!currentUser) { setShowLoginModal(true); return; }
                  try {
                    const updated = await userApi.endorseUser(studentId);
                    setStudents(prev => prev.map(s => s.id === studentId ? updated : s));
                    showToast('Endorsement permanently recorded!', 'success');
                  } catch (e) { showToast(safeErrorMessage(e) || 'The operation could not be completed.', 'error'); }
                }}
                onRequestContact={(target) => {
                  setTargetContactStudent(target);
                  setShowContactRequestModal(true);
                }}
                onReportStudent={(target) => {
                  setTargetReportStudent(target);
                  setShowReportModal(true);
                }}
                onPromoteToAdmin={async (id) => {
                  try {
                    const updated = await userApi.updateUserRole(id, { role: 'admin', status: 'Admin' });
                    setStudents(prev => prev.map(s => s.id === id ? updated : s));
                    showToast('Resident promoted to Administrator!', 'success');
                  } catch (err) { showToast(safeErrorMessage(err) || 'The operation could not be completed.', 'error'); }
                }}
                onPromoteToSuperAdmin={async (id) => {
                  try {
                    const updated = await userApi.updateUserRole(id, { role: 'superadmin', status: 'SuperAdmin' });
                    setStudents(prev => prev.map(s => s.id === id ? updated : s));
                    showToast('SuperAdmin permissions granted!', 'success');
                  } catch (err) { showToast(safeErrorMessage(err) || 'The operation could not be completed.', 'error'); }
                }}
                onDemoteToStudent={async (id) => {
                  try {
                    const target = students.find(s => s.id === id);
                    const updated = await userApi.updateUserRole(id, {
                      role: 'student',
                      status: target?.isCurrentlyInCollege ? 'In Residence' : 'Alumni'
                    });
                    setStudents(prev => prev.map(s => s.id === id ? updated : s));
                    showToast('User restored to standard resident status.', 'info');
                  } catch (err) { showToast(safeErrorMessage(err) || 'The operation could not be completed.', 'error'); }
                }}
                onDeleteUserAccount={async (id) => {
                  if (!window.confirm('Delete this user account permanently from database?')) return;
                  try {
                    await userApi.deleteUser(id);
                    setStudents(prev => prev.filter(s => s.id !== id));
                    showToast('Resident removed.', 'info');
                    setCurrentView('directory');
                  } catch (err) { showToast(safeErrorMessage(err) || 'The operation could not be completed.', 'error'); }
                }}
                onUpdateBacheca={async (newBacheca) => {
                  try {
                    const updated = await userApi.updateProfile(selectedStudent.id, { bacheca: newBacheca });
                    setStudents(prev => prev.map(s => s.id === selectedStudent.id ? updated : s));
                    if (currentUser?.id === selectedStudent.id) setCurrentUser(updated);
                    showToast('Interactive board updated successfully!', 'success');
                  } catch (err) { showToast(safeErrorMessage(err) || 'Failed to update board.', 'error'); }
                }}
                onOpenEditProfile={() => setShowEditProfileModal(true)}
              />
            )}

            {currentView === 'map' && (
              <MapView 
                students={verifiedStudents} 
                currentUser={currentUser}
                leafletReady={leafletReady}
                onSelectStudent={handleOpenProfile}
              />
            )}

            {currentView === 'campus' && currentUser && (
              <CampusStudioHub setCurrentView={setCurrentView} />
            )}

            {COMMUNITY_VIEW_IDS.includes(currentView) && currentUser && (
              <CommunityHub currentView={currentView} currentUser={currentUser} showToast={showToast} setCurrentView={setCurrentView} students={students} leafletReady={leafletReady} onSelectStudent={handleOpenProfile} />
            )}

            {currentView === 'notifications' && currentUser && (
              <NotificationsView 
                userNotifications={visibleNotifications}
                currentUser={currentUser}
                onSelectStudent={handleOpenProfile}
                onMarkAsRead={async (notifId) => {
                  try {
                    await commsApi.updateNotificationStatus(notifId, 'read');
                    setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, status: 'read' } : n));
                  } catch (err) { showToast('Error marking as read.', 'error'); }
                }}
                onRespondJoinRequest={async (requestId, decision, notifId) => {
                  try {
                    await commsApi.respondJoinRequest(requestId, decision);
                    setNotifications(prev => prev.map(n =>
                      n.id === notifId ? { ...n, status: decision === 'accept' ? 'accepted' : 'declined' } : n
                    ));
                    showToast(decision === 'accept' ? 'Member added.' : 'Request declined.', 'success');
                  } catch (err) {
                    showToast(safeErrorMessage(err) || 'Could not process the request.', 'error');
                  }
                }}
                onRespondContact={async (notifId, accept, sharedChannels) => {
                  const notif = notifications.find(n => n.id === notifId);
                  if (!notif) return;

                  try {
                    if (accept) {
                      const sharedData = {};
                      const contactLines = [];

                      if (sharedChannels.includes('phone') && currentUser.phone) {
                        sharedData.phone = currentUser.phone;
                        contactLines.push(`📞 Telephone: ${currentUser.phone}`);
                      }
                      if (sharedChannels.includes('instagram') && currentUser.instagram) {
                        sharedData.instagram = currentUser.instagram;
                        contactLines.push(`📸 Instagram: ${currentUser.instagram}`);
                      }
                      if (sharedChannels.includes('email') && currentUser.email) {
                        sharedData.email = currentUser.email;
                        contactLines.push(`✉️ Email: ${currentUser.email}`);
                      }
                      if (sharedChannels.includes('linkedin') && currentUser.linkedin) {
                        sharedData.linkedin = currentUser.linkedin;
                        contactLines.push(`💼 LinkedIn: ${currentUser.linkedin}`);
                      }

                      // Deliver the details BEFORE marking the request as
                      // accepted: if delivery fails the request stays pending
                      // and can simply be answered again, instead of being
                      // stuck as "accepted" with nothing ever sent.
                      await commsApi.sendNotification({
                        recipientId: notif.senderId,
                        recipientScope: 'individual',
                        senderName: currentUser.name,
                        type: 'contact_approved',
                        targetStudentId: currentUser.id,
                        title: `✅ Contact details shared by ${currentUser.name}`,
                        message: `${currentUser.name} has approved your contact request.\n\nChannels:\n${contactLines.join('\n')}`,
                        attachments: [{ type: 'shared_data', data: sharedData }]
                      });
                    }

                    await commsApi.updateNotificationStatus(notifId, accept ? 'accepted' : 'declined');
                    showToast(accept ? 'Contact info shared!' : 'Request declined.', 'info');
                  } catch (err) {
                    showToast(safeErrorMessage(err) || 'Could not answer the contact request. Please try again.', 'error');
                  } finally {
                    fetchInitialData();
                  }
                }}
                onDeleteNotification={async (notifId) => {
                  await commsApi.deleteNotification(notifId);
                  setNotifications(prev => prev.filter(n => n.id !== notifId));
                }}
                onOpenBroadcastModal={() => setShowBroadcastModal(true)}
              />
            )}

            {currentView === 'admin_chat' && (currentUser?.role === 'admin' || currentUser?.role === 'superadmin') && (
              <AdminChatView 
                messages={adminChatMessages}
                currentUser={currentUser}
                onSendMessage={async (text) => {
                  try {
                    const msg = await commsApi.sendAdminChatMessage(text, currentUser.name);
                    setAdminChatMessages(prev => [...prev, msg]);
                  } catch (err) { showToast(safeErrorMessage(err) || 'Error sending chat message.', 'error'); }
                }}
              />
            )}

            {currentView === 'suggestions' && (
              <SuggestionsView 
                currentUser={currentUser}
                suggestions={suggestions}
                onSubmitSuggestion={async (text) => {
                  try {
                    await commsApi.submitSuggestion({
                      userName: currentUser.name,
                      userEmail: currentUser.email,
                      userResidence: currentUser.residence,
                      text
                    });
                    showToast('Suggestion transmitted to SuperAdmins.', 'success');
                    fetchInitialData();
                    return true;
                  } catch (err) {
                    showToast(safeErrorMessage(err) || 'Unable to send your suggestion. Please try again.', 'error');
                    return false;
                  }
                }}
                onOpenLogin={() => setShowLoginModal(true)}
              />
            )}

            {currentView === 'letter' && (
              <ConcernLetterView 
                currentUser={currentUser}
                letterData={concernLetter}
                showToast={showToast}
                onUpdateLetter={async (newLetterObj) => {
                  await commsApi.updateSetting('concernLetter', JSON.stringify(newLetterObj));
                  setConcernLetter(newLetterObj);
                  showToast('Official letter saved.', 'success');
                }}
              />
            )}

            {currentView === 'audit_logs' && currentUser?.role === 'superadmin' && (
              <AuditLogsView currentUser={currentUser} />
            )}

            {!currentUser && (['campus', ...COMMUNITY_VIEW_IDS]).includes(currentView) && (
              <div className="bg-white rounded-3xl p-12 text-center border border-[#D5D3CC] shadow-sm max-w-lg mx-auto space-y-4">
                <ShieldCheck className="w-12 h-12 text-[#B31217] mx-auto" />
                <h3 className="font-['Oswald'] text-2xl font-bold uppercase text-gray-900">Resident Access Only</h3>
                <p className="text-xs text-gray-600 font-serif leading-relaxed">
                  This feature is reserved strictly for authenticated residents of University Residence. Please sign in to verify your identity.
                </p>
                <div className="pt-2">
                  <button
                    onClick={() => setShowLoginModal(true)}
                    className="px-6 py-2.5 bg-[#B31217] hover:bg-[#8A0E12] text-white font-bold rounded-xl text-xs shadow transition-all"
                  >
                    Sign In
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      <FooterBar setCurrentView={setCurrentView} />

      {/* Modals & Dialogs */}
      {showLoginModal && (
        <LoginModal 
          onClose={() => setShowLoginModal(false)}
          onLogin={handleLogin}
        />
      )}

      {showRegisterModal && (
        <RegisterModal 
          onClose={() => setShowRegisterModal(false)}
          onSubmit={async (regData) => {
            try {
              const user = await userApi.registerUser(regData);
              setStudents(prev => [user, ...prev]);
              setShowRegisterModal(false);
              setShowSuccessRegisterModal(true);
              fetchInitialData();
            } catch (err) {
              showToast(safeErrorMessage(err) || 'Registration failed.', 'error');
            }
          }}
          showToast={showToast}
        />
      )}

      {showSuccessRegisterModal && (
        <RegistrationSuccessModal 
          onClose={() => setShowSuccessRegisterModal(false)}
          onRedirectHome={() => {
            setShowSuccessRegisterModal(false);
            setCurrentView('directory');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}

      {showCreateUserModal && currentUser?.role === 'superadmin' && (
        <CreateUserModal 
          onClose={() => setShowCreateUserModal(false)}
          onSubmit={async (userData) => {
            try {
              const created = await userApi.superadminCreateUser(userData);
              setStudents(prev => [created, ...prev]);
              setShowCreateUserModal(false);
              showToast(`Account created for ${created.name}!`, 'success');
              fetchInitialData();
            } catch (err) {
              showToast(safeErrorMessage(err) || 'Account creation failed.', 'error');
            }
          }}
        />
      )}

      {showEditProfileModal && currentUser && (
        <EditProfileModal 
          user={currentUser}
          onClose={() => setShowEditProfileModal(false)}
          onSave={async (updatedData) => {
            try {
              const updated = await userApi.updateProfile(currentUser.id, updatedData);

              if (!updated || typeof updated !== 'object' || !updated.id) {
                throw new Error('Malformed response received from server.');
              }

              const asString = (value, fallback = '') => {
                if (value === null || value === undefined) {
                  return fallback;
                }

                if (
                  typeof value === 'string' ||
                  typeof value === 'number' ||
                  typeof value === 'boolean'
                ) {
                  return String(value);
                }

                return fallback;
              };

              const safeUpdated = {
                ...updated,

                id: asString(updated.id),

                name:
                  asString(updated.name) ||
                  `${asString(updated.firstName)} ${asString(updated.lastName)}`.trim() ||
                  'Resident',

                firstName: asString(updated.firstName),
                lastName: asString(updated.lastName),
                email: asString(updated.email),
                phone: asString(updated.phone),
                instagram: asString(updated.instagram),
                linkedin: asString(updated.linkedin),

                residence: asString(updated.residence),
                floor: asString(updated.floor),
                room: asString(updated.room),

                course: asString(updated.course),
                academicYear: asString(updated.academicYear),
                studyLevel: asString(updated.studyLevel),

                firstYearInCollege: asString(updated.firstYearInCollege),
                firstMonthInCollege: asString(updated.firstMonthInCollege),
                departureYear:
                  updated.departureYear === null
                    ? null
                    : asString(updated.departureYear),
                departureMonth:
                  updated.departureMonth === null
                    ? null
                    : asString(updated.departureMonth),

                originContinent: asString(updated.originContinent),
                originCountry: asString(updated.originCountry),
                originRegion: asString(updated.originRegion),
                originCity: asString(updated.originCity),

                birthDate:
                  updated.birthDate === null
                    ? null
                    : asString(updated.birthDate),

                birthYear:
                  updated.birthYear === null
                    ? ''
                    : asString(updated.birthYear),

                story: asString(updated.story),

                coords:
                  Array.isArray(updated.coords) &&
                  updated.coords.length === 2 &&
                  updated.coords.every((v) => Number.isFinite(Number(v)))
                    ? updated.coords.map(Number)
                    : [45.0683, 7.6831],

                photos: Array.isArray(updated.photos)
                  ? updated.photos.filter(
                      (photo) =>
                        photo &&
                        typeof photo === 'object' &&
                        typeof photo.url === 'string'
                    )
                  : [],

                bacheca: Array.isArray(updated.bacheca)
                  ? updated.bacheca
                  : [],

                residencyHistory: Array.isArray(updated.residencyHistory)
                  ? updated.residencyHistory
                  : [],

                tags: Array.isArray(updated.tags)
                  ? updated.tags
                  : [],

                privacy:
                  updated.privacy &&
                  typeof updated.privacy === 'object' &&
                  !Array.isArray(updated.privacy)
                    ? updated.privacy
                    : {}
              };

              setCurrentUser(safeUpdated);
              setStudents(prev => prev.map(s => (s.id === safeUpdated.id ? { ...s, ...safeUpdated } : s)));
              setShowEditProfileModal(false);
              showToast('Profile updated successfully!', 'success');
            } catch (err) {
              console.error('[PROFILE SAVE ERROR]:', err);
              showToast(safeErrorMessage(err) || 'Update failed.', 'error');
              throw err; // Re-throw so EditProfileModal keeps the modal open and resets button state
            }
          }}
          onUpdateCredentials={async (creds) => {
            try {
              const res = await authApi.updateCredentials(creds);
              setCurrentUser(res.user);
              setStudents(prev => prev.map(s => s.id === res.user.id ? { ...s, ...res.user } : s));
              showToast('Security credentials updated.', 'success');
            } catch (err) {
              showToast(safeErrorMessage(err) || 'Failed updating credentials.', 'error');
              throw err;
            }
          }}
          onUserRefresh={(updatedUser) => {
            setCurrentUser(updatedUser);
            setStudents(prev => prev.map(s => s.id === updatedUser.id ? { ...s, ...updatedUser } : s));
          }}
          showToast={showToast}
        />
      )}

      {showBroadcastModal && (currentUser?.role === 'admin' || currentUser?.role === 'superadmin') && (
        <AdminBroadcastModal 
          students={students.filter(s => !s.isHidden)}
          onClose={() => setShowBroadcastModal(false)}
          onSend={async (bData) => {
            try {
              const { title, message, targetStudentIds, attachments, targetFilters } = bData;
              await commsApi.sendNotification({
                recipientIds: targetStudentIds || [],
                recipientScope: 'group',
                type: 'admin_announcement',
                title,
                message,
                targetFilters: targetFilters || {},
                attachments: attachments || []
              });
              setShowBroadcastModal(false);
              showToast('Announcement dispatched to the selected audience!', 'success');
              fetchInitialData();
            } catch (err) {
              showToast(safeErrorMessage(err) || 'Failed to dispatch announcement.', 'error');
            }
          }}
          showToast={showToast}
        />
      )}

      {showContactRequestModal && targetContactStudent && (
        <ContactRequestModal 
          targetStudent={targetContactStudent}
          onClose={() => setShowContactRequestModal(false)}
          onSend={async (selectedChannels, note) => {
            try {
              await commsApi.sendNotification({
                recipientId: targetContactStudent.id,
                recipientScope: 'individual',
                senderName: currentUser.name,
                type: 'contact_request',
                requestedChannels: selectedChannels,
                title: 'Contact Details Request',
                message: `${currentUser.name} requested access to your ${selectedChannels.join(', ')}.\nNote: "${note || 'No note attached'}"`,
                attachments: []
              });
              setShowContactRequestModal(false);
              showToast('Contact request sent!', 'success');
              fetchInitialData();
            } catch (err) {
              showToast(safeErrorMessage(err) || 'Request failed.', 'error');
            }
          }}
        />
      )}

      {showReportModal && targetReportStudent && (
        <ReportAccountModal 
          targetStudent={targetReportStudent}
          onClose={() => setShowReportModal(false)}
          onSubmit={async (reason) => {
            try {
              await commsApi.sendNotification({
                recipientScope: 'admin',
                senderName: currentUser.name,
                type: 'account_flagged',
                targetStudentId: targetReportStudent.id,
                title: '⚠️ Resident Account Reported',
                message: `Account [${targetReportStudent.name}] was flagged by ${currentUser.name}.\nReason: ${reason}`,
                attachments: []
              });
              setShowReportModal(false);
              showToast('Report submitted to SuperAdmins.', 'success');
            } catch (err) {
              showToast(safeErrorMessage(err) || 'Report failed.', 'error');
            }
          }}
        />
      )}
    </div>
  );
}

function Sidebar({ isExpanded, onToggle, currentView, setCurrentView, currentUser, unreadCount, onOpenMyProfile }) {
  const menuItems = [
    { id: 'directory', label: 'People Directory', icon: Users },
    { id: 'yearbook', label: 'Yearbook', icon: BookOpen },
    { id: 'map', label: 'The Globe', icon: Globe }
  ];

  if (currentUser) {
    menuItems.push(
      { id: 'campus', label: 'Campus & Study', icon: Compass },
      { id: 'community', label: 'College Life', icon: Home },
      { id: 'notifications', label: 'Notifications', icon: Bell, badge: unreadCount }
    );
  }

  if (currentUser?.role === 'superadmin') {
    menuItems.push({ id: 'audit_logs', label: 'Forensic Audit Logs', icon: ShieldAlert });
  }

  if (currentUser?.role === 'admin' || currentUser?.role === 'superadmin') {
    menuItems.push(
      { id: 'admin_chat', label: 'Admin Chat', icon: MessageCircle },
      { 
        id: 'admin', 
        label: currentUser.isFounder ? 'Founder Control Panel' : (currentUser.role === 'superadmin' ? 'SuperAdmin Panel' : 'Admin Panel'), 
        icon: currentUser.role === 'superadmin' ? Crown : ShieldCheck 
      }
    );
  }

  return (
    <aside className={`bg-[#B31217] text-white flex flex-col justify-between transition-all duration-300 relative z-20 shadow-xl ${
      isExpanded ? 'w-full md:w-80 p-6' : 'w-full md:w-20 p-4'
    }`}>
      <div>
        <div className="flex items-center justify-between mb-8">
          {isExpanded ? (
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentView('directory')}>
              <img src="/faviconV2.jpg" alt="Logo" className="w-10 h-10 object-contain transform hover:scale-110 transition-transform" />
              <div>
                <h1 className="font-['Oswald'] text-2xl font-bold tracking-wider leading-tight uppercase">UNIVERSITY RESIDENCE</h1>
                <p className="font-['Playfair_Display'] italic text-xs text-red-100 opacity-90">Your story, our future.</p>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex flex-col items-center justify-center cursor-pointer" onClick={onToggle} title="University Residence">
              <img src="/faviconV2.jpg" alt="Logo" className="w-10 h-10 object-contain transform hover:scale-110 transition-transform" />
            </div>
          )}

          <button onClick={onToggle} className="hidden md:flex p-1.5 rounded-full hover:bg-white/10 text-white/80 transition-colors">
            <ArrowLeft className={`w-5 h-5 transform transition-transform duration-300 ${!isExpanded ? 'rotate-180' : ''}`} />
          </button>
        </div>

        <nav className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentView(item.id)}
                className={`w-full flex items-center justify-between px-3 py-3 rounded-xl text-left transition-all ${
                  isActive ? 'bg-[#8A0E12] font-semibold text-white shadow-inner border-l-4 border-white' : 'text-red-100 hover:bg-white/10 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-5 h-5 shrink-0 ${!isExpanded ? 'mx-auto' : ''}`} />
                  {isExpanded && <span className="text-sm tracking-wide">{item.label}</span>}
                </div>
                {item.badge > 0 && (
                  <span className="bg-white text-[#B31217] text-xs font-bold px-2 py-0.5 rounded-full shadow">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}

          {currentUser && (
            <button
              onClick={onOpenMyProfile}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all text-red-100 hover:bg-white/10 hover:text-white mt-4 border-t border-white/10 pt-4"
            >
              <User className={`w-5 h-5 shrink-0 ${!isExpanded ? 'mx-auto' : ''}`} />
              {isExpanded && <span className="text-sm tracking-wide">My Profile</span>}
            </button>
          )}
        </nav>
      </div>

      <div className="mt-8 pt-6 border-t border-white/10">
        {isExpanded ? (
          <p className="text-xs text-red-200/70">University Residence &copy; {new Date().getFullYear()}</p>
        ) : (
          <div className="text-center font-['Oswald']">'26</div>
        )}
      </div>
    </aside>
  );
}

function Header({ currentView, onBack, currentUser, unreadCount, setCurrentView, onOpenLogin, onOpenRegister, onOpenEditProfile, onOpenMyProfile, onLogout }) {
  return (
    <header className="px-4 md:px-8 py-4 bg-[#F4F3EF]/90 backdrop-blur-md sticky top-0 z-10 flex items-center justify-between border-b border-[#E5E3DC]">
      <div className="flex items-center gap-4">
        {currentView !== 'directory' && (
          <button onClick={onBack} className="flex items-center gap-2 px-3.5 py-1.5 bg-white rounded-full text-xs font-semibold border border-[#D5D3CC] hover:bg-[#E5E3DC] transition-all shadow-sm text-gray-800">
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        {currentUser ? (
          <div className="flex items-center gap-2">
            <button onClick={() => setCurrentView('notifications')} className="relative p-2 bg-white hover:bg-gray-100 rounded-full border border-[#D5D3CC] text-gray-700 transition-colors" title="Notifications">
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-[#B31217] text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center animate-pulse">
                  {unreadCount}
                </span>
              )}
            </button>

            <button onClick={onOpenMyProfile} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full text-xs font-semibold text-gray-700 transition-all border border-[#D5D3CC]">
              <User className="w-3.5 h-3.5" />
              <span>View Profile</span>
            </button>

            <button onClick={onOpenEditProfile} className="flex items-center gap-2 bg-white px-3.5 py-1.5 rounded-full border border-[#D5D3CC] text-xs font-semibold hover:border-[#B31217] transition-all group shadow-sm">
              <span className={`w-2.5 h-2.5 rounded-full ${
                currentUser.isFounder && !currentUser.isCurrentlyInCollege 
                  ? 'bg-[#FFD700] animate-pulse' 
                  : (currentUser.role === 'superadmin' ? 'bg-purple-600' : (currentUser.role === 'admin' ? 'bg-amber-500' : 'bg-emerald-500'))
              }`} />
              <span className="text-gray-800 group-hover:text-[#B31217] transition-colors">
                {currentUser.name}
              </span>
              <Edit3 className="w-3.5 h-3.5 text-gray-400 group-hover:text-[#B31217] ml-1" />
            </button>

            <button onClick={onLogout} className="p-2 text-gray-700 hover:text-[#B31217] bg-white hover:bg-gray-100 rounded-full transition-colors border border-[#D5D3CC]" title="Sign Out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={onOpenLogin} className="bg-white hover:bg-[#F0EEE6] text-[#1A1A1A] font-semibold text-xs px-4 py-2 rounded-full border border-[#D5D3CC] shadow-sm transition-all">
              Log In
            </button>
            <button onClick={onOpenRegister} className="bg-[#B31217] hover:bg-[#8A0E12] text-white font-semibold text-xs px-4 py-2 rounded-full shadow transition-all flex items-center gap-1.5">
              <Plus className="w-4 h-4" />
              <span>Register</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function LoginModal({ onClose, onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'forgot-email' | 'forgot-reset'
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [require2FA, setRequire2FA] = useState(false);
  const [otp2FA, setOtp2FA] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const inputClass = 'w-full px-3.5 py-2.5 border border-[#D5D3CC] rounded-xl text-sm bg-[#FAF8F5] focus:outline-none focus:border-[#B31217]';

  const resetAllFormState = () => {
    setRequire2FA(false);
    setOtp2FA('');
    setPassword('');
    setErrorMsg('');
    setSuccessMsg('');
    setResetCode('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const goTo = (nextMode) => {
    setMode(nextMode);
    resetAllFormState();
  };

  const handleClose = () => {
    goTo('login');
    onClose();
  };

  const executeLogin = async (otpCode) => {
    if (loading) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const codeToSend = otpCode ?? (require2FA ? otp2FA : undefined);
      const result = await onLogin(identifier, password, codeToSend);
      if (result?.require2FA) {
        setRequire2FA(true);
      }
    } catch (err) {
      setErrorMsg(safeErrorMessage(err) || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    executeLogin();
  };

  const sendResetCode = async () => {
    await authApi.sendOtp(identifier.trim().toLowerCase(), 'reset_password');
    setMode('forgot-reset');
    setSuccessMsg('If an account exists for this email, a 6-digit code has been sent. It is valid for 5 minutes.');
  };

  const handleSendResetCode = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setErrorMsg('');
    try {
      await sendResetCode();
    } catch (err) {
      setErrorMsg(safeErrorMessage(err) || 'Could not send the code.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (loading) return;
    setLoading(true);
    setErrorMsg('');
    try {
      await sendResetCode();
    } catch (err) {
      setErrorMsg(safeErrorMessage(err) || 'Could not send the code.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (loading) return;
    setErrorMsg('');
    if (newPassword.length < 8) {
      setErrorMsg('The new password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('The two passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await authApi.resetPassword(identifier.trim().toLowerCase(), resetCode, newPassword);
      setResetCode('');
      setNewPassword('');
      setConfirmPassword('');
      setPassword('');
      setMode('login');
      setSuccessMsg('Password updated. You can now sign in with your new password.');
    } catch (err) {
      setErrorMsg(safeErrorMessage(err) || 'Could not reset the password.');
    } finally {
      setLoading(false);
    }
  };

  // Submit automatico appena l'OTP 2FA raggiunge 6 cifre
  const handleOtpChange = (val) => {
    const cleaned = val.replace(/[^0-9]/g, '');
    setOtp2FA(cleaned);
    if (cleaned.length === 6) {
      executeLogin(cleaned);
    }
  };

  const title = mode === 'forgot-email' ? 'Forgot Password'
    : mode === 'forgot-reset' ? 'Reset Password'
    : (require2FA ? '2FA Verification' : 'Resident Sign In');

  const onSubmit = mode === 'forgot-email' ? handleSendResetCode
    : mode === 'forgot-reset' ? handleResetPassword
    : handleSubmit;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 md:p-8 shadow-2xl space-y-5 animate-fadeIn">
        <div className="flex items-center justify-between border-b pb-4">
          <h2 className="font-['Oswald'] text-2xl font-bold uppercase tracking-wider text-gray-900">
            {title}
          </h2>
          <button onClick={handleClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold">
            {successMsg}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {mode === 'login' && !require2FA && (
            <>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Email Address *</label>
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  placeholder="resident@example.com"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Password *</label>
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => goTo('forgot-email')}
                  className="mt-2 text-xs font-semibold text-[#B31217] hover:underline"
                >
                  Forgot your password?
                </button>
              </div>
            </>
          )}

          {mode === 'login' && require2FA && (
            <div className="space-y-3 bg-purple-50 p-4 rounded-2xl border border-purple-200">
              <p className="text-xs text-purple-900 font-semibold">
                🛡️ Enter the 6-digit verification code sent to your registered address.
              </p>
              <input
                required
                autoFocus
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp2FA}
                onChange={e => handleOtpChange(e.target.value)}
                placeholder="123456"
                className="w-full text-center text-2xl tracking-[8px] font-mono font-bold py-2 border rounded-xl bg-white focus:border-purple-600 focus:outline-none"
              />
            </div>
          )}

          {mode === 'forgot-email' && (
            <div>
              <p className="text-xs text-gray-600 mb-3">
                Enter the email of your account. We will send you a 6-digit code to choose a new password.
              </p>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Email Address *</label>
              <input
                required
                type="email"
                autoComplete="email"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="resident@example.com"
                className={inputClass}
              />
            </div>
          )}

          {mode === 'forgot-reset' && (
            <>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Code from the email *</label>
                <input
                  required
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={resetCode}
                  onChange={e => setResetCode(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="123456"
                  className="w-full text-center text-2xl tracking-[8px] font-mono font-bold py-2 border border-[#D5D3CC] rounded-xl bg-[#FAF8F5] focus:border-[#B31217] focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">New password * (min. 8 characters)</label>
                <input
                  required
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Confirm new password *</label>
                <input
                  required
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className={inputClass}
                />
              </div>
              <button
                type="button"
                onClick={handleResendCode}
                disabled={loading}
                className="text-xs font-semibold text-[#B31217] hover:underline"
              >
                Send a new code
              </button>
            </>
          )}

          <div className="pt-2 flex justify-end gap-3 border-t">
            {mode === 'login' ? (
              require2FA ? (
                <button
                  type="button"
                  onClick={() => {
                    setRequire2FA(false);
                    setOtp2FA('');
                    setErrorMsg('');
                  }}
                  className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200"
                >
                  Back to credentials
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200"
                >
                  Cancel
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={() => goTo('login')}
                className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200"
              >
                Back to sign in
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-sm font-semibold shadow disabled:opacity-50"
            >
              {loading
                ? 'Please wait...'
                : mode === 'forgot-email'
                ? 'Send code'
                : mode === 'forgot-reset'
                ? 'Update password'
                : require2FA
                ? 'Confirm Code'
                : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AdminChatView({ messages, currentUser, onSendMessage }) {
  const [text, setText] = useState('');
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <h1 className="font-['Oswald'] text-3xl font-bold uppercase tracking-wider text-gray-900 flex items-center gap-3">
        <MessageCircle className="w-8 h-8 text-[#B31217]" /> Executive Admin Chat
      </h1>
      <div className="bg-white rounded-3xl border border-[#D5D3CC] shadow-md p-4 h-96 overflow-y-auto space-y-2">
        {messages.map(m => {
          const isOwnMessage =
            String(m.senderId) === String(currentUser?.id);

          return (
            <div
              key={m.id}
              className={`flex ${
                isOwnMessage
                  ? 'justify-end'
                  : 'justify-start'
              }`}
            >
              <div
                className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-xs shadow-sm ${
                  isOwnMessage
                    ? 'bg-[#DCF8C6] text-gray-900 rounded-br-md'
                    : 'bg-gray-100 text-gray-900 rounded-bl-md'
                }`}
              >
                {!isOwnMessage && (
                  <div className="font-bold text-gray-700 mb-1">
                    {m.senderName}
                  </div>
                )}

                <div className="whitespace-pre-wrap break-words">
                  {m.text}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSendMessage(text); setText(''); } }} className="flex gap-2">
        <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="Type an administrative message..." className="flex-1 p-3 border rounded-xl text-xs" />
        <button type="submit" className="px-5 py-3 bg-[#B31217] text-white font-bold rounded-xl text-xs">Send</button>
      </form>
    </div>
  );
}

function SuggestionsView({ currentUser, suggestions, onSubmitSuggestion, onOpenLogin }) {
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      // Only clear the box once the server has actually accepted the
      // suggestion — on failure the resident keeps what they typed.
      const ok = await onSubmitSuggestion(text);
      if (ok !== false) setText('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="font-['Oswald'] text-3xl font-bold uppercase tracking-wider text-gray-900">Feedback & Suggestions</h1>
      {currentUser ? (
        <form onSubmit={handleSubmit} className="space-y-4 bg-white p-6 rounded-3xl border shadow-sm">
          <textarea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder="Enter portal enhancement feedback..." className="w-full p-4 border rounded-2xl text-sm" />
          <button type="submit" disabled={isSubmitting || !text.trim()} className="px-6 py-2.5 bg-[#B31217] disabled:bg-gray-400 text-white font-bold rounded-xl text-xs shadow">
            {isSubmitting ? 'Sending...' : 'Submit Feedback'}
          </button>
        </form>
      ) : (
        <button onClick={onOpenLogin} className="px-5 py-2.5 bg-[#B31217] text-white font-bold rounded-xl text-xs">Log In to Submit</button>
      )}
    </div>
  );
}

function AuditLogsView({ currentUser }) {
  const [logs, setLogs] = useState([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const PAGE_SIZE = 50;

  const loadPage = useCallback(async (nextOffset) => {
    setIsLoadingMore(true);
    try {
      const res = await commsApi.getAuditLogs({ limit: PAGE_SIZE, offset: nextOffset });
      setLogs(prev => (nextOffset === 0 ? res.items : [...prev, ...res.items]));
      setTotal(typeof res.total === 'number' ? res.total : 0);
      setOffset(nextOffset + (res.items?.length || 0));
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    loadPage(0);
  }, [loadPage]);

  const hasMore = offset < total;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="font-['Oswald'] text-3xl font-bold uppercase tracking-wider text-gray-900 flex items-center gap-3">
        <ShieldAlert className="w-8 h-8 text-purple-700" /> Forensic System Audit Logs
      </h1>
      <div className="bg-white rounded-3xl border border-[#D5D3CC] overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs text-gray-700">
          <thead className="bg-[#FAF8F5] border-b uppercase text-[10px]">
            <tr>
              <th className="p-4">Timestamp</th>
              <th className="p-4">Actor</th>
              <th className="p-4">Action</th>
              <th className="p-4">IP Address</th>
              <th className="p-4">Payload / Changes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="p-4">{new Date(l.created_at).toLocaleString()}</td>
                <td className="p-4 font-bold">{l.user_name}</td>
                <td className="p-4 text-[#B31217] font-semibold">{l.action}</td>
                <td className="p-4 font-mono">{l.ip_address}</td>
                <td className="p-4 align-top">
                  <details>
                    <summary className="cursor-pointer text-[#B31217] font-bold">View exact changes</summary>
                    <div className="mt-2 space-y-2 max-w-xl">
                      <pre className="bg-gray-50 border rounded-xl p-3 overflow-auto text-[10px] whitespace-pre-wrap">{JSON.stringify({ previous: l.previous_state, new: l.new_state }, null, 2)}</pre>
                    </div>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {hasMore && (
          <div className="p-4 text-center border-t">
            <button
              onClick={() => loadPage(offset)}
              disabled={isLoadingMore}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 rounded-xl text-xs font-bold"
            >
              {isLoadingMore ? 'Loading...' : `Load More (${total - offset} remaining)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

