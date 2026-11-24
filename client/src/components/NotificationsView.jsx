import React, { useState } from 'react';
import {
  Bell, MessageSquare, CheckCircle2, UserPlus, Megaphone, Flag,
  ShieldCheck, Lightbulb, User, Eye, Trash2, Image as ImageIcon,
  FileText, ExternalLink, Download, Check
} from 'lucide-react';
import { getSafeUrl } from '../utils/security';

export function NotificationsView({
  userNotifications,
  currentUser,
  onRespondContact,
  onDeleteNotification,
  onMarkAsRead,
  onSelectStudent,
  onOpenBroadcastModal,
  onRespondJoinRequest
}) {
  const [selectedNotifForContact, setSelectedNotifForContact] = useState(null);
  const [channelsToShare, setChannelsToShare] = useState({ phone: false, instagram: false, email: false, linkedin: false });

  const handleOpenContactModal = (notif) => {
    setSelectedNotifForContact(notif);
    const requested = notif.requestedChannels || [];
    setChannelsToShare({
      phone: requested.includes('phone'),
      instagram: requested.includes('instagram'),
      email: requested.includes('email'),
      linkedin: requested.includes('linkedin')
    });
  };

  const handleConfirmAcceptContact = (notifId) => {
    const selected = Object.keys(channelsToShare).filter(k => channelsToShare[k]);
    onRespondContact(notifId, true, selected);
    setSelectedNotifForContact(null);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="font-['Oswald'] text-3xl font-bold uppercase tracking-wider text-gray-900 flex items-center gap-3">
            <Bell className="w-8 h-8 text-[#B31217]" />
            NOTIFICATION CENTER
          </h1>
          <p className="text-sm text-gray-600 mt-1">Notices, contact requests and college announcements.</p>
        </div>

        {(currentUser?.role === 'admin' || currentUser?.role === 'superadmin') && (
          <button onClick={onOpenBroadcastModal} className="flex items-center gap-2 px-4 py-2.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow transition-all shrink-0">
            <Megaphone className="w-4 h-4" />
            <span>Send Announcement</span>
          </button>
        )}
      </div>

      {userNotifications.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-[#D5D3CC] shadow-sm space-y-3">
          <Bell className="w-12 h-12 text-gray-300 mx-auto" />
          <h3 className="font-bold text-gray-700 text-lg">No notification present</h3>
          <p className="text-sm text-gray-500">All new messages and requests will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {userNotifications.map((notif) => {
            const isUnread = notif.status === 'pending';

            return (
              <div
                key={notif.id}
                className={`p-5 rounded-2xl border transition-all flex flex-col md:flex-row md:items-start justify-between gap-4 shadow-sm ${
                  isUnread
                    ? 'bg-white border-[#B31217]/50 ring-1 ring-[#B31217]/20 shadow-md'
                    : 'bg-[#FAF8F5] border-[#E5E3DC] opacity-85'
                }`}
              >
                <div className="flex items-start gap-4 flex-1">
                  <div className={`p-3 rounded-2xl shrink-0 ${
                    notif.type === 'contact_request'
                      ? 'bg-blue-100 text-blue-700'
                      : notif.type === 'contact_approved'
                      ? 'bg-emerald-100 text-emerald-700'
                      : notif.type === 'account_flagged'
                      ? 'bg-red-100 text-red-700'
                      : notif.type === 'admin_announcement'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-gray-100 text-gray-700'
                  }`}>
                    {notif.type === 'contact_request' && <MessageSquare className="w-6 h-6" />}
                    {notif.type === 'contact_approved' && <CheckCircle2 className="w-6 h-6" />}
                    {notif.type === 'identity_confirm' && <UserPlus className="w-6 h-6" />}
                    {notif.type === 'admin_announcement' && <Megaphone className="w-6 h-6" />}
                    {notif.type === 'account_flagged' && <Flag className="w-6 h-6" />}
                    {notif.type === 'admin_approval_notice' && <ShieldCheck className="w-6 h-6" />}
                    {notif.type === 'suggestion_submitted' && <Lightbulb className="w-6 h-6 text-amber-500" />}
                    {!['contact_request', 'contact_approved', 'identity_confirm', 'admin_announcement', 'account_flagged', 'admin_approval_notice', 'suggestion_submitted'].includes(notif.type) && <Bell className="w-6 h-6" />}
                  </div>

                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-gray-900 text-base">{notif.title}</h4>
                        {isUnread ? (
                          <span className="bg-[#B31217] text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse">
                            Nuovo
                          </span>
                        ) : (
                          <span className="bg-gray-200 text-gray-700 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase">
                            Letto
                          </span>
                        )}
                        {notif.type === 'contact_request' && <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Contact Request</span>}
                        {notif.type === 'contact_approved' && <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Contacts Received</span>}
                        {notif.type === 'admin_announcement' && <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Official</span>}
                      </div>

                      <span className="text-[10px] text-gray-400 whitespace-nowrap">
                        {new Date(notif.date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })} • {new Date(notif.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <p className="text-xs font-semibold text-gray-500">Da: {notif.senderName}</p>

                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-sm text-gray-800 font-mono whitespace-pre-line leading-relaxed">
                      {notif.message}
                    </div>

                    {Array.isArray(notif.attachments) && notif.attachments.length > 0 && (
                      <div className="space-y-2 pt-2">
                        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">
                          Allegati & Link:
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {notif.attachments.map((att, attIdx) => (
                            <a
                              key={attIdx}
                              href={getSafeUrl(att.url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              download={att.type === 'file' ? att.name : undefined}
                              className="inline-flex items-center gap-2 px-3 py-1.5 bg-white hover:bg-gray-100 text-gray-800 border border-gray-300 rounded-xl text-xs font-semibold shadow-sm transition-all group"
                            >
                              {att.type === 'photo' && <ImageIcon className="w-3.5 h-3.5 text-blue-600" />}
                              {att.type === 'file' && <FileText className="w-3.5 h-3.5 text-emerald-600" />}
                              {att.type === 'link' && <ExternalLink className="w-3.5 h-3.5 text-indigo-600" />}
                              <span className="group-hover:text-[#B31217] transition-colors">{att.name}</span>
                              {att.size && <span className="text-[10px] text-gray-400">({att.size})</span>}
                              {att.type === 'file' && <Download className="w-3 h-3 text-gray-400 group-hover:text-gray-700 ml-1" />}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 justify-between md:justify-end">
                  {notif.targetStudentId && (
                    <button
                      onClick={() => onSelectStudent(notif.targetStudentId)}
                      className="px-3.5 py-2 bg-gray-900 hover:bg-black text-white rounded-xl text-xs font-bold shadow flex items-center gap-1.5 transition-all"
                    >
                      <User className="w-3.5 h-3.5" />
                      <span>Go to Profile</span>
                    </button>
                  )}

                  {notif.type === 'identity_confirm' && (
                    <button
                      onClick={() => onSelectStudent(notif.targetStudentId || notif.senderId)}
                      className="px-4 py-2 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-bold shadow flex items-center gap-1.5 transition-all"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>Review & Confirm Identity</span>
                    </button>
                  )}

                  {notif.type === 'contact_request' && notif.status === 'pending' && (
                    <button
                      onClick={() => handleOpenContactModal(notif)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Reply /Share</span>
                    </button>
                  )}

                  {notif.type === 'join_request' && ['pending', 'read'].includes(notif.status) && (
                      <>
                        <button
                          onClick={() => onRespondJoinRequest(notif.resourceId, 'accept', notif.id)}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow flex items-center gap-1.5"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Accept</span>
                        </button>
                        <button
                          onClick={() => onRespondJoinRequest(notif.resourceId, 'decline', notif.id)}
                          className="px-4 py-2 bg-white hover:bg-red-50 text-red-700 border border-red-200 rounded-xl text-xs font-bold"
                        >
                          Decline
                        </button>
                      </>
                    )}
                    {notif.type === 'join_request' && notif.status === 'accepted' && (
                      <span className="text-xs font-bold text-emerald-700">Accepted</span>
                    )}
                    {notif.type === 'join_request' && notif.status === 'declined' && (
                      <span className="text-xs font-bold text-red-700">Declined</span>
                    )}

                  {isUnread && (
                    <button
                      onClick={() => onMarkAsRead(notif.id)}
                      className="p-2 text-gray-500 hover:text-emerald-700 bg-white hover:bg-emerald-50 border border-gray-200 rounded-xl transition-all shadow-sm flex items-center gap-1 text-xs font-bold"
                      title="Segna come visto"
                    >
                      <Eye className="w-4 h-4 text-emerald-600" />
                      <span className="hidden sm:inline">Seen</span>
                    </button>
                  )}

                  <button
                    onClick={() => onDeleteNotification(notif.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                    title="Delete notification"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedNotifForContact && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <h3 className="font-['Oswald'] text-lg font-bold uppercase text-gray-900">Confirm Data to Share</h3>
            <p className="text-xs text-gray-500">The following channels were requested by <strong>{selectedNotifForContact.senderName}</strong>:</p>

            <div className="space-y-2">
              {[
                { id: 'phone', label: 'Telephone Number' },
                { id: 'instagram', label: 'Instagram' },
                { id: 'email', label: 'Email' },
                { id: 'linkedin', label: 'LinkedIn' }
              ].map(ch => (
                <label key={ch.id} className="flex items-center gap-2.5 text-xs font-semibold text-gray-800 cursor-pointer p-2.5 rounded-xl hover:bg-gray-50 border border-gray-200">
                  <input
                    type="checkbox"
                    checked={channelsToShare[ch.id]}
                    onChange={e => setChannelsToShare(prev => ({ ...prev, [ch.id]: e.target.checked }))}
                    className="w-4 h-4 text-[#B31217] rounded"
                  />
                  <span>{ch.label}</span>
                </label>
              ))}
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t">
              <button type="button" onClick={() => setSelectedNotifForContact(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-xs font-bold">Cancel</button>
              <button type="button" onClick={() => handleConfirmAcceptContact(selectedNotifForContact.id)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow">Send Data</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
