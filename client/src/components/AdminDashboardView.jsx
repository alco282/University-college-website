import React, { useState, useEffect } from 'react';
import { 
  Crown, Award, PlusCircle, Megaphone, CheckCircle2, 
  Check, X, Eye, EyeOff, Sparkles, Users, Trash2, ShieldCheck
} from 'lucide-react';

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239CA3AF'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

export function AdminDashboardView({ 
  allStudents = [], 
  pendingStudents = [], 
  currentUser, 
  welcomeMessage, 
  onUpdateWelcomeMessage, 
  onApprove, 
  onReject, 
  onSelectStudent, 
  onPromoteToAdmin, 
  onPromoteToSuperAdmin, 
  onDemoteToStudent, 
  onDeleteUserAccount, 
  onOpenBroadcastModal, 
  onOpenCreateUserModal,
}) {
  const [welcomeText, setWelcomeText] = useState(welcomeMessage || '');
  const [activeTab, setActiveTab] = useState('pending');
  const isSuperAdmin = currentUser?.role === 'superadmin';

  useEffect(() => { 
    setWelcomeText(welcomeMessage || ''); 
  }, [welcomeMessage]);

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fadeIn">
      {/* Header Dashboard */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="font-['Oswald'] text-3xl font-bold uppercase tracking-wider text-gray-900 flex items-center gap-3">
            {currentUser?.isFounder ? (
              <Award className="w-8 h-8 text-amber-600" />
            ) : isSuperAdmin ? (
              <Crown className="w-8 h-8 text-purple-700" />
            ) : (
              <ShieldCheck className="w-8 h-8 text-[#B31217]" />
            )}
            {currentUser?.isFounder
              ? 'FOUNDER EXECUTIVE DASHBOARD'
              : isSuperAdmin
              ? 'SUPERADMIN CONTROL PANEL'
              : 'ADMINISTRATION PANEL'}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Verification queues, role promotions, and platform-wide broadcast communications.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <button
              type="button"
              onClick={onOpenCreateUserModal}
              className="flex items-center gap-2 px-4 py-2.5 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold shadow transition-all"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Create Resident</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenBroadcastModal}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow transition-all"
          >
            <Megaphone className="w-4 h-4" />
            <span>Send Announcement</span>
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-4 border-b border-gray-200">
        <button
          type="button"
          onClick={() => setActiveTab('pending')}
          className={`pb-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'pending'
              ? 'border-[#B31217] text-[#B31217]'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          <span>Pending Approvals</span>
          <span className="bg-[#B31217] text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
            {pendingStudents.length}
          </span>
        </button>
        
        <button
          type="button"
          onClick={() => setActiveTab('all')}
          className={`pb-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'all'
              ? 'border-[#B31217] text-[#B31217]'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          <span>All Residents ({allStudents.length})</span>
        </button>

        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => setActiveTab('welcome')}
            className={`pb-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'welcome'
                ? 'border-[#B31217] text-[#B31217]'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            <Crown className="w-3.5 h-3.5 text-purple-700" />
            <span>Welcome Overlay</span>
          </button>
        )}
      </div>

      {/* Tab: Pending Approvals */}
      {activeTab === 'pending' && (
        <div className="space-y-4">
          {pendingStudents.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-3xl border border-dashed border-[#D5D3CC]">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-gray-700">No pending account approvals.</p>
            </div>
          ) : (
            pendingStudents.map((student) => (
              <div
                key={student.id}
                className="p-5 bg-white rounded-2xl border border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm"
              >
                <div className="flex items-center gap-4">
                  <img
                    src={
                      (typeof student.photos?.[0] === 'object' ? student.photos[0].url : student.avatar) || DEFAULT_AVATAR
                    }
                    alt={student.name}
                    className="w-12 h-12 rounded-xl object-cover border"
                  />
                  <div>
                    <h4 className="font-bold text-gray-900 flex items-center gap-2">
                      <span>{student.name}</span>
                    </h4>
                    <p className="text-xs text-gray-500">
                      {student.email} • Sez. {student.residence} ({student.course})
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectStudent(student.id)}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold"
                  >
                    Inspect
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => onApprove(student.id)}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow"
                  >
                    <Check className="w-4 h-4" />
                    <span>Approve</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onReject(student.id)}
                    className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow"
                  >
                    <X className="w-4 h-4" />
                    <span>Reject</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: All Residents Table */}
      {activeTab === 'all' && (
        <div className="bg-white rounded-3xl border border-[#D5D3CC] overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-700">
              <thead className="bg-[#FAF8F5] border-b border-gray-200 text-gray-900 font-bold uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="p-4">Resident</th>
                  <th className="p-4">Residence</th>
                  <th className="p-4">Role</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allStudents.map((st) => (
                  <tr key={st.id} className="hover:bg-gray-50/50">
                    <td className="p-4 font-bold text-gray-900 flex items-center gap-2">
                      <img
                        src={(typeof st.photos?.[0] === 'object' ? st.photos[0].url : st.avatar) || DEFAULT_AVATAR}
                        alt={st.name}
                        className="w-8 h-8 rounded-full object-cover"
                      />
                      <span>{st.name}</span>
                    </td>
                    <td className="p-4">{st.residence || '—'}</td>
                    <td className="p-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          st.isFounder && !st.isCurrentlyInCollege
                            ? 'bg-[#FFD700] text-white border border-amber-400 font-extrabold'
                            : st.role === 'superadmin'
                            ? 'bg-purple-100 text-purple-900'
                            : st.role === 'admin'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {st.isFounder && !st.isCurrentlyInCollege ? 'FOUNDER' : st.role}
                      </span>
                    </td>
                    <td className="p-4 space-y-1">
                      <div>
                        {st.verified ? (
                          <span className="text-emerald-700 font-bold">✅ Verified</span>
                        ) : (
                          <span className="text-amber-600 font-bold">⏳ Pending</span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-right space-x-1">
                      <button
                        type="button"
                        onClick={() => onSelectStudent(st.id)}
                        className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-[11px] font-bold"
                      >
                        Inspect
                      </button>
                      
                      {isSuperAdmin && st.role !== 'superadmin' && (
                        <>
                          <button
                            type="button"
                            onClick={() => onPromoteToSuperAdmin(st.id)}
                            className="px-2.5 py-1 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-[11px] font-bold"
                          >
                            Make SuperAdmin
                          </button>

                          {st.role === 'admin' ? (
                            <button
                              type="button"
                              onClick={() => onDemoteToStudent(st.id)}
                              className="px-2.5 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-[11px] font-bold"
                            >
                              Demote
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onPromoteToAdmin(st.id)}
                              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[11px] font-bold"
                            >
                              Make Admin
                            </button>
                          )}
                          
                          <button
                            type="button"
                            onClick={() => onDeleteUserAccount(st.id)}
                            className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[11px] font-bold"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Welcome Overlay Config */}
      {activeTab === 'welcome' && isSuperAdmin && (
        <div className="bg-white rounded-3xl p-6 border border-[#D5D3CC] shadow-md space-y-4">
          <div className="flex items-center gap-2 text-purple-900 font-bold text-lg">
            <Crown className="w-5 h-5 text-purple-700" />
            <h3>Edit Welcome Overlay Content (SuperAdmin Only)</h3>
          </div>
          <p className="text-xs text-gray-500">
            This message is displayed to residents on their first login to the digital portal.
          </p>
          <textarea
            rows={6}
            value={welcomeText}
            onChange={(e) => setWelcomeText(e.target.value)}
            className="w-full p-4 border border-[#D5D3CC] rounded-2xl text-sm font-serif focus:outline-none focus:border-[#B31217]"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => onUpdateWelcomeMessage(welcomeText)}
              className="px-6 py-2.5 bg-[#B31217] hover:bg-[#8A0E12] text-white font-bold rounded-xl text-xs shadow transition-all"
            >
              Save Message
            </button>
          </div>
        </div>
      )}
    </div>
  );
}