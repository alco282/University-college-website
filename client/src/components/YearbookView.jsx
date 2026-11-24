import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar, Building, Image as ImageIcon } from 'lucide-react';
import { canViewPhoto, getSafeUrl, getVisibleAvatar } from '../utils/security';

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239CA3AF'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

/**
 * Geometric Honeycomb Matrix Coordinate Generator
 * Calculates 2D Cartesian offset coordinates for a uniform hex mesh.
 */
function buildHexagonalHoneycombGrid(items, targetAspectRatio = 1.6) {
  const N = items.length;
  if (N === 0) return { positionedItems: [], totalWidth: 0, totalHeight: 0 };

  const W = 130; // Hexagon width in pixels
  const H = 150; // Hexagon height in pixels
  const gap = 8; // Spacing gap between facets

  const stepX = W + gap;
  const stepY = H * 0.75 + (gap * 0.866);

  let colsBase = Math.round(Math.sqrt((N * targetAspectRatio * stepY) / stepX));
  colsBase = Math.max(3, colsBase);

  const positioned = [];
  let currRow = 0;
  let currCol = 0;

  for (let i = 0; i < N; i++) {
    const maxColsThisRow = (currRow % 2 === 1) ? (colsBase - 1) : colsBase;
    const offsetX = (currRow % 2 === 1) ? (stepX / 2) : 0;
    const x = currCol * stepX + offsetX;
    const y = currRow * stepY;

    positioned.push({
      item: items[i],
      x,
      y,
      width: W,
      height: H
    });

    currCol++;
    if (currCol >= maxColsThisRow) {
      currCol = 0;
      currRow++;
    }
  }

  const allX = positioned.map(p => p.x);
  const allY = positioned.map(p => p.y);
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX) + W;
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY) + H;

  const totalWidth = maxX - minX;
  const totalHeight = maxY - minY;

  const centeredItems = positioned.map(p => ({
    ...p,
    x: p.x - minX,
    y: p.y - minY
  }));

  return {
    positionedItems: centeredItems,
    totalWidth,
    totalHeight
  };
}

export function YearbookView({ students = [], currentUser, onSelectStudent }) {
  const currentYearNum = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState('All');
  const [selectedSection, setSelectedSection] = useState('All');

  // Pan and Zoom engine transform state
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hasMoved, setHasMoved] = useState(false);

  const containerRef = useRef(null);

  const sectionsList = ['All', 'Residence_name_1','Residence_name_2','Residence_name_3'];
  const yearsList = useMemo(() => {
    const list = ['All'];
    for (let y = currentYearNum; y >= 1935; y--) {
      list.push(String(y));
    }
    return list;
  }, [currentYearNum]);

  // Filter students based on real photo presence, access policy, section, and attendance year
  const yearbookResidents = useMemo(() => {
    return students.filter(student => {
      const allPhotos = (student.photos && student.photos.length > 0)
        ? student.photos.filter(p => {
            const url = typeof p === 'object' ? p.url : p;
            return url && url !== DEFAULT_AVATAR;
          })
        : (student.avatar && student.avatar !== DEFAULT_AVATAR 
            ? [{ url: student.avatar, privacy: 'public' }] 
            : []);

      if (allPhotos.length === 0) return false;

      const visiblePhotos = allPhotos.filter(p => canViewPhoto(p, student, currentUser));
      if (visiblePhotos.length === 0) return false;

      if (selectedSection !== 'All' && student.residence !== selectedSection) {
        return false;
      }

      if (selectedYear === 'All') return true;

      const filterYearNum = parseInt(selectedYear, 10);
      const startYear = parseInt(student.firstYearInCollege || String(currentYearNum), 10);
      
      let endYear;
      if (student.isCurrentlyInCollege) {
        endYear = currentYearNum;
      } else {
        endYear = student.departureYear ? parseInt(student.departureYear, 10) : startYear;
      }

      return !isNaN(filterYearNum) && filterYearNum >= startYear && filterYearNum <= endYear;
    });
  }, [students, selectedYear, selectedSection, currentUser, currentYearNum]);

  const { positionedItems, totalWidth, totalHeight } = useMemo(() => {
    return buildHexagonalHoneycombGrid(yearbookResidents, 1.6);
  }, [yearbookResidents]);

  // Passive wheel listener registration with clean detachment
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const handleNativeWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const zoomFactor = 1.12;
      if (e.deltaY < 0) {
        setScale(prev => Math.min(prev * zoomFactor, 3.5));
      } else {
        setScale(prev => Math.max(prev / zoomFactor, 0.4));
      }
    };

    node.addEventListener('wheel', handleNativeWheel, { passive: false });

    return () => {
      node.removeEventListener('wheel', handleNativeWheel);
    };
  }, []);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setHasMoved(false);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const deltaX = Math.abs(e.clientX - (dragStart.x + position.x));
    const deltaY = Math.abs(e.clientY - (dragStart.y + position.y));
    if (deltaX > 4 || deltaY > 4) {
      setHasMoved(true);
    }
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setHasMoved(false);
      setDragStart({
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y
      });
    }
  };

  const handleTouchMove = (e) => {
    if (!isDragging || e.touches.length !== 1) return;
    setHasMoved(true);
    setPosition({
      x: e.touches[0].clientX - dragStart.x,
      y: e.touches[0].clientY - dragStart.y
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const handleResetView = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-6xl mx-auto">
      {/* Title Header */}
      <div className="border-b pb-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-['Playfair_Display'] italic text-3xl md:text-5xl font-bold text-gray-900 leading-tight">
            Residence Yearbook
          </h1>
          <p className="text-xs text-gray-500 mt-2 uppercase tracking-widest font-bold">
            Historical Mosaic & Resident Generations • University Residence
          </p>
        </div>

        <div className="text-xs text-gray-500 font-semibold">
          Residents pictured: <strong className="text-gray-900 text-sm">{yearbookResidents.length}</strong>
        </div>
      </div>

      {/* Filter Control Bar */}
      <div className="bg-white rounded-3xl p-5 border border-[#D5D3CC] shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#B31217]" />
            <label className="text-xs font-bold text-gray-700">Academic Year:</label>
            <select
              value={selectedYear}
              onChange={(e) => { setSelectedYear(e.target.value); handleResetView(); }}
              className="px-3 py-1.5 bg-[#FAF8F5] border border-gray-300 rounded-xl text-xs font-bold text-gray-800 focus:outline-none focus:border-[#B31217]"
            >
              {yearsList.map(yr => <option key={yr} value={yr}>{yr}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Building className="w-4 h-4 text-[#B31217]" />
            <label className="text-xs font-bold text-gray-700">Section:</label>
            <select
              value={selectedSection}
              onChange={(e) => { setSelectedSection(e.target.value); handleResetView(); }}
              className="px-3 py-1.5 bg-[#FAF8F5] border border-gray-300 rounded-xl text-xs font-bold text-gray-800 focus:outline-none focus:border-[#B31217]"
            >
              {sectionsList.map(sec => <option key={sec} value={sec}>{sec}</option>)}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>💡 Drag canvas to pan • Scroll to zoom</span>
        </div>
      </div>

      {/* Interactive Mosaic Viewport */}
      {yearbookResidents.length === 0 ? (
        <div className="p-16 text-center bg-white/70 rounded-3xl border border-dashed border-[#D5D3CC] space-y-2">
          <ImageIcon className="w-12 h-12 text-gray-300 mx-auto" />
          <h3 className="text-base font-bold text-gray-700">No photos cataloged for this selection</h3>
          <p className="text-xs text-gray-400">
            {!currentUser 
              ? 'Certain profiles are configured to display photos to authenticated residents only.' 
              : 'Try selecting a broader year range or an alternative residence section.'}
          </p>
        </div>
      ) : (
        <div className="relative rounded-3xl border border-[#D5D3CC] shadow-xl overflow-hidden bg-[#FAF8F5] z-0 isolate">
          {/* Floating Zoom & Pan Controls */}
          <div className="absolute top-4 right-4 z-10 flex flex-col gap-1.5 bg-white/90 backdrop-blur-md p-1.5 rounded-2xl border border-gray-200 shadow-md">
            <button
              type="button"
              onClick={() => setScale(prev => Math.min(prev * 1.2, 3.5))}
              className="w-8 h-8 flex items-center justify-center bg-gray-100 hover:bg-[#B31217] hover:text-white rounded-xl text-gray-700 font-bold transition-all text-sm"
              title="Zoom In"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setScale(prev => Math.max(prev / 1.2, 0.4))}
              className="w-8 h-8 flex items-center justify-center bg-gray-100 hover:bg-[#B31217] hover:text-white rounded-xl text-gray-700 font-bold transition-all text-sm"
              title="Zoom Out"
            >
              -
            </button>
            <button
              type="button"
              onClick={handleResetView}
              className="w-8 h-8 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-xl text-gray-600 text-[10px] font-bold transition-all"
              title="Reset View 1:1"
            >
              1:1
            </button>
          </div>

          <div
            ref={containerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className={`yearbook-viewport ${isDragging ? 'is-dragging' : ''}`}
            style={{
              position: 'relative',
              width: '100%',
              height: '680px',
              overflow: 'hidden',
              userSelect: 'none',
              cursor: isDragging ? 'grabbing' : 'grab'
            }}
          >
            <div
              className="yearbook-canvas"
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transformOrigin: 'center center',
                willChange: 'transform',
                transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${scale})`,
                transition: isDragging ? 'none' : 'transform 0.15s ease-out'
              }}
            >
              <div 
                className="honeycomb-plane"
                style={{
                  position: 'relative',
                  width: `${totalWidth}px`,
                  height: `${totalHeight}px`
                }}
              >
                {positionedItems.map(({ item: st, x, y, width, height }) => {
                  const resolvedUrl = getVisibleAvatar(st, currentUser, DEFAULT_AVATAR);
                  const safePhotoUrl = getSafeUrl(resolvedUrl, DEFAULT_AVATAR);

                  return (
                    <div
                      key={st.id}
                      onClick={() => {
                        if (!hasMoved) {
                          onSelectStudent(st.id);
                        }
                      }}
                      className="honeycomb-node group"
                      style={{
                        position: 'absolute',
                        left: `${x}px`,
                        top: `${y}px`,
                        width: `${width}px`,
                        height: `${height}px`,
                        clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
                        cursor: 'pointer',
                        backgroundColor: '#1a1a1a',
                        userSelect: 'none'
                      }}
                      title={`${st.name} (Sez. ${st.residence})`}
                    >
                      <img
                        src={safePhotoUrl}
                        alt={st.name}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500 pointer-events-none"
                        loading="lazy"
                        draggable={false}
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = DEFAULT_AVATAR;
                        }}
                      />
                      
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-2 text-center">
                        <span className="text-[10px] font-['Oswald'] font-bold text-white uppercase tracking-wider leading-tight drop-shadow truncate">
                          {st.name}
                        </span>
                        <span className="text-[8px] text-red-200 uppercase font-semibold">
                          {st.residence}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}