import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { 
  Plus, X, ChevronLeft, ChevronRight, Quote, Music, Video, 
  Image as ImageIcon, Globe, ExternalLink, FolderPlus 
} from 'lucide-react';
import { getSafeUrl } from '../utils/security';
import { uploadMediaFile } from '../services/api';
import { UploadProgress } from './UploadProgress';

// These files live in src/tiles/, so they must be imported through the bundler.
// Using /tiles/... would make the browser look for them under public/tiles/.
import quoteTile from '../tiles/quote.jpg';
import linkTile from '../tiles/link.jpg';
import audioTile from '../tiles/audio.jpg';
import videoTile from '../tiles/video.webp';
import photoTile from '../tiles/photo.jpg';
import { safeErrorMessage } from '../services/api';

const DEFAULT_TILE_COVERS = {
  quote: quoteTile,
  link: linkTile,
  audio: audioTile,
  video: videoTile,
  photo: photoTile
};

export function HexagonalBacheca({ items = [], isOwner, onUpdateBacheca, showToast }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('quote');
  const [content, setContent] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [coverPercent, setCoverPercent] = useState(0);

  const getTileImage = (item) => {
    const fallbackImage = DEFAULT_TILE_COVERS[item?.type] || quoteTile;
    const rawImage = typeof item?.coverImage === 'string' ? item.coverImage.trim() : '';
    if (!rawImage) return fallbackImage;

    // Bundled fallback assets are valid browser URLs but are intentionally not
    // accepted by the server-side URL sanitizer. Keep them local and only
    // sanitize user/uploaded URLs.
    if (Object.values(DEFAULT_TILE_COVERS).includes(rawImage)) return rawImage;

    return getSafeUrl(rawImage, fallbackImage);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingCover(true);
    try {
      if (showToast) showToast(`Uploading ${file.name}...`, 'info');
      const uploadedUrl = await uploadMediaFile(file, { onProgress: setCoverPercent });
      setCoverImage(uploadedUrl);
      if (showToast) showToast('Background image uploaded!', 'success');
    } catch (err) {
      if (showToast) showToast(safeErrorMessage(err) || 'Upload failed.', 'error');
    } finally {
      setIsUploadingCover(false);
      setCoverPercent(0);
      e.target.value = '';
    }
  };

  const handleAddItem = (e) => {
    e.preventDefault();
    const fallbackImage = DEFAULT_TILE_COVERS[type] || quoteTile;

    const newItem = {
      id: `hex-${crypto.randomUUID()}`,
      title: title.trim(),
      type,
      content: content.trim(),
      // Keep the bundled fallback client-side. It is not a server upload and
      // the API's URL sanitizer intentionally rejects webpack asset URLs.
      coverImage: coverImage.trim()
    };

    onUpdateBacheca([...items, newItem]);
    setShowAddModal(false);
    setTitle('');
    setType('quote');
    setContent('');
    setCoverImage('');
  };

  const handleRemoveItem = (id) => {
    onUpdateBacheca(items.filter(i => i.id !== id));
    if (selectedItem?.id === id) setSelectedItem(null);
  };

  const handleMoveItem = (e, index, direction) => {
    e.stopPropagation();
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    const reordered = [...items];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    onUpdateBacheca(reordered);
  };

  const getTypeIcon = (t) => {
    switch (t) {
      case 'quote': return <Quote className="w-5 h-5 text-amber-500" />;
      case 'audio': return <Music className="w-5 h-5 text-emerald-500" />;
      case 'video': return <Video className="w-5 h-5 text-rose-500" />;
      case 'photo': return <ImageIcon className="w-5 h-5 text-blue-500" />;
      default: return <Globe className="w-5 h-5 text-indigo-500" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-['Playfair_Display'] italic text-3xl font-normal text-[#1A1A1A] flex items-center gap-2">
            Interactive Board
          </h2>
          <p className="text-xs text-gray-500">Hexagonal mosaic of quotes, audio tracks, links, and passions.</p>
        </div>

        {isOwner && (
          <button 
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#B31217] hover:bg-[#8A0E12] text-white rounded-xl text-xs font-semibold transition-all shadow"
          >
            <Plus className="w-4 h-4" />
            <span>Add Tile</span>
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-3xl border border-dashed border-[#D5D3CC]">
          <p className="text-sm text-gray-500">No items present on this board.</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-4 pt-2 items-center">
          {items.map((item, idx) => {
            const displayImage = getTileImage(item);

            return (
              <div 
                key={item.id}
                onClick={() => setSelectedItem(item)}
                className="relative w-28 h-32 cursor-pointer group transition-transform hover:scale-105"
              >
                <div 
                  className="w-full h-full bg-cover bg-center overflow-hidden flex flex-col items-center justify-center p-2 text-center shadow-md group-hover:shadow-xl transition-all"
                  style={{
                    clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
                    backgroundImage: `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.6)), url('${displayImage}')`
                  }}
                >
                  <div className="p-1.5 rounded-full bg-black/40 backdrop-blur-md mb-1">
                    {getTypeIcon(item.type)}
                  </div>
                  <span className="text-[10px] font-bold text-white uppercase tracking-wider line-clamp-2 px-1 drop-shadow">
                    {item.title}
                  </span>
                </div>

                {isOwner && (
                  <>
                    <button 
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveItem(item.id);
                      }}
                      className="absolute -top-1 -right-1 bg-red-600 hover:bg-red-700 text-white p-1 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity z-20"
                      title="Remove tile"
                    >
                      <X className="w-3 h-3" />
                    </button>

                    <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20 bg-black/70 backdrop-blur-sm px-1.5 py-0.5 rounded-full shadow">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={(e) => handleMoveItem(e, idx, -1)}
                        className="text-white hover:text-amber-400 disabled:opacity-30 p-0.5"
                        title="Move left"
                      >
                        <ChevronLeft className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === items.length - 1}
                        onClick={(e) => handleMoveItem(e, idx, 1)}
                        className="text-white hover:text-amber-400 disabled:opacity-30 p-0.5"
                        title="Move right"
                      >
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                {getTypeIcon(selectedItem.type)}
                <h3 className="font-bold text-lg text-gray-900">{selectedItem.title}</h3>
              </div>
              <button onClick={() => setSelectedItem(null)} className="p-1 text-gray-400 hover:text-gray-600 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-gray-100">
              <img 
                src={getTileImage(selectedItem)}
                className="w-full h-full object-cover"
                alt={selectedItem.title}
                onError={(event) => {
                  const fallbackImage = DEFAULT_TILE_COVERS[selectedItem.type] || quoteTile;
                  if (event.currentTarget.src !== fallbackImage) {
                    event.currentTarget.src = fallbackImage;
                  }
                }}
              />
            </div>

            <div className="p-4 bg-[#FAF8F5] rounded-2xl border border-gray-200">
              {selectedItem.type === 'quote' ? (
                <p className="font-serif italic text-base text-gray-800 leading-relaxed whitespace-pre-line">
                  {selectedItem.content}
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase">Linked Resource:</p>
                  {(() => {
                    const safeHref = getSafeUrl(selectedItem.content, '#');
                    return (
                      <a 
                        href={safeHref} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-sm font-bold text-[#B31217] hover:underline flex items-center gap-1.5 break-all"
                      >
                        <span>{safeHref}</span>
                        <ExternalLink className="w-4 h-4 shrink-0" />
                      </a>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showAddModal && createPortal(
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-['Oswald'] text-xl font-bold uppercase tracking-wider text-gray-900">
                Add Hex Tile
              </h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddItem} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Title *</label>
                <input 
                  required 
                  type="text" 
                  maxLength={100}
                  value={title} 
                  onChange={e => setTitle(e.target.value)} 
                  className="w-full px-3 py-2 border border-[#D5D3CC] rounded-xl text-sm" 
                  placeholder="e.g. Favorite Quote" 
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Content Type</label>
                <select 
                  value={type} 
                  onChange={e => setType(e.target.value)} 
                  className="w-full px-3 py-2 border border-[#D5D3CC] rounded-xl text-sm"
                >
                  <option value="quote">Citation / Text</option>
                  <option value="link">Website / Link</option>
                  <option value="audio">Audio / Spotify</option>
                  <option value="video">Video / YouTube</option>
                  <option value="photo">Photo / Portfolio</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  {type === 'quote' ? 'Quote text *' : 'URL Link *'}
                </label>
                {type === 'quote' ? (
                  <textarea 
                    required 
                    rows={3} 
                    maxLength={1000}
                    value={content} 
                    onChange={e => setContent(e.target.value)} 
                    className="w-full px-3 py-2 border rounded-xl text-sm" 
                  />
                ) : (
                  <input 
                    required 
                    type="url" 
                    maxLength={1000}
                    value={content} 
                    onChange={e => setContent(e.target.value)} 
                    className="w-full px-3 py-2 border rounded-xl text-sm" 
                    placeholder="https://..." 
                  />
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Background Image</label>
                <div className="space-y-2">
                  <label className="cursor-pointer bg-gray-100 hover:bg-gray-200 border border-[#D5D3CC] rounded-xl px-3 py-2 text-xs font-semibold text-gray-700 flex items-center justify-center gap-2">
                    <FolderPlus className="w-4 h-4 text-[#B31217]" />
                    <span>{isUploadingCover ? 'Uploading...' : 'Select File from Device'}</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileUpload} className="hidden" />
                  </label>
                  {isUploadingCover && <UploadProgress percent={coverPercent} />}
                  <input 
                    type="text" 
                    value={coverImage} 
                    onChange={e => setCoverImage(e.target.value)} 
                    className="w-full px-3 py-2 border rounded-xl text-sm" 
                    placeholder="or paste local /uploads/ image path..." 
                  />
                </div>
              </div>

              <div className="pt-2">
                <button 
                  type="submit" 
                  disabled={isUploadingCover}
                  className="w-full py-2.5 bg-[#B31217] hover:bg-[#8A0E12] disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold shadow"
                >
                  Save Tile
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}