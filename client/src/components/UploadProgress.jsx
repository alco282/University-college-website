import React from 'react';

/**
 * Thin determinate progress bar for file uploads.
 * `percent` is 0-100; at 95+ the bytes are sent and the server is still
 * moderating / encoding the image, which is shown as "Processing…".
 */
export function UploadProgress({ percent = 0, label = 'Uploading' }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const processing = value >= 95 && value < 100;
  return (
    <div className="w-full mt-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label}>
      <div className="flex items-center justify-between text-[10px] font-bold text-gray-500 mb-1">
        <span>{processing ? 'Processing…' : `${label}…`}</span>
        <span>{value}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
        <div
          className={`h-full rounded-full bg-[#B31217] transition-all duration-200 ${processing ? 'animate-pulse' : ''}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

export default UploadProgress;
