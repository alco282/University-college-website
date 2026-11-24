import React, { useEffect, useState } from 'react';
import { Check, Crown, FileEdit, Upload } from 'lucide-react';
import { uploadMediaFile } from '../services/api';
import { safeErrorMessage } from '../services/api';

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239CA3AF'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

export function ConcernLetterView({ currentUser, letterData, onUpdateLetter, showToast }) {
  // Authorization is enforced by the server as well; this is only a UI affordance.
  const canEditLetter = Boolean(currentUser?.isFounder);
  const [isEditing, setIsEditing] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  const [title, setTitle] = useState(letterData.title || 'To Whom It May Concern');
  const [subtitle, setSubtitle] = useState(letterData.subtitle || 'A letter for future, past and present generations');
  const [authorName, setAuthorName] = useState(letterData.authorName || 'Author Name');
  const [authorRole, setAuthorRole] = useState(letterData.authorRole || 'Platform founder');
  const [authorPhoto, setAuthorPhoto] = useState(letterData.authorPhoto || DEFAULT_AVATAR);
  const [content, setContent] = useState(letterData.content || '');
  const [footerLeft, setFooterLeft] = useState(letterData.footerLeft || ' University Residence ');
  const [footerRight, setFooterRight] = useState(letterData.footerRight || 'Official Letter');

  const syncFromLetterData = (data) => {
    setTitle(data.title || 'To Whom It May Concern');
    setSubtitle(data.subtitle || 'A letter for future, past and present generations');
    setAuthorName(data.authorName || 'Author Name');
    setAuthorRole(data.authorRole || 'Platform founder');
    setAuthorPhoto(data.authorPhoto || DEFAULT_AVATAR);
    setContent(data.content || '');
    setFooterLeft(data.footerLeft || ' University Residence ');
    setFooterRight(data.footerRight || 'Official Letter');
  };

  useEffect(() => {
    if (isEditing) return;
    syncFromLetterData(letterData);
  }, [letterData, isEditing]);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';

    if (!file || !canEditLetter) return;

    setIsUploadingPhoto(true);

    try {
      const uploadedUrl = await uploadMediaFile(file);

      if (!uploadedUrl) {
        throw new Error('Il server non ha restituito l’URL della foto.');
      }

      console.log('[ConcernLetter] Photo uploaded:', uploadedUrl);

      // Aggiorna immediatamente la preview locale
      setAuthorPhoto(uploadedUrl);

      showToast?.('Author photo uploaded.', 'success');
    } catch (err) {
      console.error('[ConcernLetter] Photo upload failed:', err);
      showToast?.(safeErrorMessage(err) || 'Error uploading photo.', 'error');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);

    try {
      const newLetterObj = {
        title: title || 'To Whom May Concern',
        subtitle: subtitle || '',
        authorName: authorName || '',
        authorRole: authorRole || '',
        authorPhoto: authorPhoto || DEFAULT_AVATAR,
        content: content || '',
        footerLeft: footerLeft || '',
        footerRight: footerRight || ''
      };

      console.log('[ConcernLetter] Saving:', newLetterObj);

      await onUpdateLetter(newLetterObj);

      setIsEditing(false);
    } catch (err) {
      console.error('[ConcernLetter] Save failed:', err);
      showToast?.(safeErrorMessage(err) || 'Error saving letter.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between border-b pb-4">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="space-y-2">
              <input
                type="text"
                value={title}
                maxLength={255}
                onChange={e => setTitle(e.target.value)}
                className="font-['Playfair_Display'] italic text-2xl font-bold text-gray-900 border rounded-xl px-3 py-1.5 w-full"
              />
              <input
                type="text"
                value={subtitle}
                maxLength={255}
                onChange={e => setSubtitle(e.target.value)}
                className="text-xs text-gray-500 uppercase tracking-widest font-bold border rounded-xl px-3 py-1 w-full"
              />
            </div>
          ) : (
            <>
              <h1 className="font-['Playfair_Display'] italic text-3xl md:text-4xl font-bold text-gray-900">{title}</h1>
              <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest font-bold">{subtitle}</p>
            </>
          )}
        </div>

        {canEditLetter && (
          <button
            onClick={() => { if (isEditing) handleSave(); else setIsEditing(true); }}
            disabled={isUploadingPhoto || isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow transition-all shrink-0"
          >
            {isEditing ? <Check className="w-4 h-4" /> : <FileEdit className="w-4 h-4" />}
            <span>{isEditing ? (isSaving ? 'Saving...' : 'Save Changes') : 'Edit Executive Letter'}</span>
          </button>
        )}
      </div>

      <div className="bg-white rounded-3xl p-8 md:p-12 border border-[#D5D3CC] shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b pb-4 gap-4">
          <div className="flex items-center gap-3">
            <div className="relative group w-14 h-14 shrink-0">
              <img
                src={authorPhoto || DEFAULT_AVATAR}
                alt={authorName}
                className="w-14 h-14 rounded-full object-cover border-2 border-gray-200 shadow-sm block"
                onError={(e) => {
                  console.error('[ConcernLetter] Failed to load author photo:', {
                    authorPhoto,
                    renderedSrc: e.currentTarget.src
                  });

                  e.currentTarget.onerror = null;
                  e.currentTarget.src = DEFAULT_AVATAR;
                }}
              />

              {isEditing && (
                <label className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center cursor-pointer text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  <Upload className="w-4 h-4" />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    disabled={isUploadingPhoto}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-1">
                <input type="text" value={authorName} maxLength={100} onChange={e => setAuthorName(e.target.value)} className="font-bold text-sm text-gray-900 uppercase border rounded-lg px-2 py-1" />
                <input type="text" value={authorRole} maxLength={255} onChange={e => setAuthorRole(e.target.value)} className="text-xs text-gray-500 border rounded-lg px-2 py-1 block w-full" />
              </div>
            ) : (
              <div>
                <h4 className="font-bold text-sm text-gray-900 uppercase">{authorName}</h4>
                <p className="text-xs text-gray-500">{authorRole}</p>
              </div>
            )}
          </div>
          <Crown className="w-6 h-6 text-purple-700 shrink-0 hidden sm:block" />
        </div>

        {isEditing ? (
          <textarea
            rows={12}
            value={content}
            maxLength={20000}
            onChange={e => setContent(e.target.value)}
            className="w-full p-4 border border-[#D5D3CC] rounded-2xl text-sm font-serif leading-relaxed focus:outline-none focus:border-[#B31217]"
          />
        ) : (
          <div className="prose text-gray-800 font-serif text-base md:text-lg leading-relaxed whitespace-pre-line">
            {content}
          </div>
        )}

        <div className="pt-6 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between text-xs text-gray-400 font-sans gap-2">
          {isEditing ? (
            <>
              <input type="text" value={footerLeft} maxLength={255} onChange={e => setFooterLeft(e.target.value)} className="border rounded-lg px-2 py-1 text-xs w-full sm:w-1/2" />
              <input type="text" value={footerRight} maxLength={255} onChange={e => setFooterRight(e.target.value)} className="border rounded-lg px-2 py-1 text-xs w-full sm:w-1/2 text-right" />
            </>
          ) : (
            <>
              <span>{footerLeft}</span>
              <span>{footerRight}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
