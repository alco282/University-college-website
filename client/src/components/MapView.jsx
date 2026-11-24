import React, { useRef, useState, useEffect, useCallback } from 'react';
import { escapeHtml, getSafeUrl, getVisibleAvatar } from '../utils/security';
import { commsApi } from '../services/api';

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239CA3AF'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

export function MapView({ students = [], currentUser = null, leafletReady, onSelectStudent }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const [isMapReady, setIsMapReady] = useState(false);

  const onSelectStudentRef = useRef(onSelectStudent);
  useEffect(() => {
    onSelectStudentRef.current = onSelectStudent;
  }, [onSelectStudent]);

  const renderMarkers = useCallback(() => {
    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    const L = window.L;

    if (!map || !markersLayer || !L) return;

    markersLayer.clearLayers();

    const validStudents = students.filter(
      s => Array.isArray(s.coords) && s.coords.length === 2 && !isNaN(s.coords[0]) && !isNaN(s.coords[1])
    );
    const clusterDistancePx = 50;
    const clusters = [];

    validStudents.forEach(st => {
      const latLng = L.latLng(st.coords[0], st.coords[1]);
      const point = map.latLngToLayerPoint(latLng);

      let added = false;
      for (const cl of clusters) {
        const centerPoint = map.latLngToLayerPoint(cl.latLng);
        if (point.distanceTo(centerPoint) < clusterDistancePx) {
          cl.students.push(st);
          added = true;
          break;
        }
      }

      if (!added) {
        clusters.push({ latLng, students: [st] });
      }
    });

    clusters.forEach(cl => {
      const group = cl.students;
      if (group.length === 1) {
        const st = group[0];
        const photoUrl = getSafeUrl(getVisibleAvatar(st, currentUser, DEFAULT_AVATAR), DEFAULT_AVATAR);

        const customHtml = `
          <div style="width: 42px; height: 42px; border-radius: 9999px; border: 2.5px solid #B31217; overflow: hidden; background: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.25); cursor: pointer;">
            <img src="${escapeHtml(photoUrl)}" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
          </div>
        `;

        const icon = L.divIcon({
          html: customHtml,
          className: '',
          iconSize: [42, 42],
          iconAnchor: [21, 21]
        });

        const marker = L.marker(cl.latLng, { icon }).addTo(markersLayer);
        marker.on('click', () => {
          if (onSelectStudentRef.current) {
            onSelectStudentRef.current(st.id);
          }
        });
      } else {
        const clusterHtml = `
          <div style="width: 44px; height: 44px; border-radius: 9999px; background: #B31217; color: #fff; border: 2.5px solid #ffffff; font-weight: 700; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(0,0,0,0.3); font-family: 'Oswald', sans-serif; font-size: 14px; cursor: pointer;">
            +${group.length}
          </div>
        `;

        const icon = L.divIcon({
          html: clusterHtml,
          className: '',
          iconSize: [44, 44],
          iconAnchor: [22, 22]
        });

        const groupListHtml = `
          <div style="padding: 4px; max-height: 220px; overflow-y: auto; font-family: sans-serif; min-width: 190px;">
            <div style="font-size: 11px; font-weight: bold; color: #888; text-transform: uppercase; border-bottom: 1px solid #eee; padding-bottom: 4px; margin-bottom: 6px;">
              ${escapeHtml(group[0].originCity || 'City')} (${group.length} Residents)
            </div>
            ${group.map(s => {
              const avatar = getSafeUrl(getVisibleAvatar(s, currentUser, DEFAULT_AVATAR), DEFAULT_AVATAR);
              return `
                <div data-student-id="${escapeHtml(s.id)}" style="display: flex; align-items: center; gap: 8px; padding: 6px; border-radius: 8px; cursor: pointer; transition: background 0.2s;">
                  <img src="${escapeHtml(avatar)}" style="width: 26px; height: 26px; border-radius: 9999px; object-fit: cover; border: 1px solid #ddd;" />
                  <div style="text-align: left; overflow: hidden;">
                    <div style="font-size: 12px; font-weight: bold; color: #111; white-space: nowrap; text-overflow: ellipsis; overflow: hidden;">${escapeHtml(s.name)}</div>
                    <div style="font-size: 10px; color: #666; white-space: nowrap; text-overflow: ellipsis; overflow: hidden;">${escapeHtml(s.course || '')}</div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;

        const marker = L.marker(cl.latLng, { icon }).addTo(markersLayer);
        marker.bindPopup(groupListHtml, { closeButton: false, offset: [0, -10] });

        marker.on('popupopen', event => {
          const popupNode = event.popup?.getElement?.();
          if (!popupNode) return;

          popupNode.querySelectorAll('[data-student-id]').forEach(node => {
            node.addEventListener('click', () => {
              const studentId = node.getAttribute('data-student-id');
              if (!studentId || !onSelectStudentRef.current) return;
              event.target.closePopup();
              onSelectStudentRef.current(studentId);
            }, { once: true });
          });
        });
      }
    });
  }, [students, currentUser]);

  useEffect(() => {
    if (!leafletReady || !mapRef.current) return;
    let isMounted = true;

    const initMap = async () => {
      let key = '';
      try {
        const cfg = await commsApi.getMapConfig();
        key = cfg.cartoKey || '';
      } catch (e) {
        console.error('Config fetch error:', e);
      }

      if (!isMounted || mapInstanceRef.current || !mapRef.current) return;

      const L = window.L;
      const map = L.map(mapRef.current, {
        center: [45.0683, 7.6831],
        zoom: 5,
        zoomControl: false
      });

      const tileUrl = key
        ? `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${key}`
        : `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png`;

      L.tileLayer(tileUrl, {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 18
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);
      markersLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
      setIsMapReady(true);
    };

    initMap();

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersLayerRef.current = null;
      }
      setIsMapReady(false);
    };
  }, [leafletReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isMapReady) return;

    renderMarkers();
    map.on('zoomend moveend', renderMarkers);

    return () => {
      map.off('zoomend moveend', renderMarkers);
    };
  }, [isMapReady, renderMarkers]);

  return (
    <div className="space-y-4 animate-fadeIn">
      <div>
        <h1 className="font-['Oswald'] text-3xl font-bold uppercase tracking-wider text-gray-900">THE GLOBE</h1>
        <p className="text-sm text-gray-600">Interactive map of student origin locations</p>
      </div>
      <div className="relative z-0 isolate w-full h-[650px] rounded-3xl overflow-hidden border border-[#D5D3CC] shadow-lg">
        <div ref={mapRef} className="w-full h-full" />
      </div>
    </div>
  );
}