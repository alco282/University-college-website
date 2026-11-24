import React from 'react';
import { Lightbulb, FileText } from 'lucide-react';

export function FooterBar({ setCurrentView }) {
  return (
    <footer className="bg-[#1A1A1A] text-gray-300 border-t border-gray-800 py-3 px-4 md:px-8 text-xs relative z-20">
      <div className="max-w-[1600px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-['Oswald'] tracking-wider text-white uppercase font-bold text-sm">UNIVERSITY RESIDENCE</span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-400 text-[11px]">Digital Portal</span>
        </div>

        <div className="flex items-center gap-6 flex-wrap justify-center">

          <button
            onClick={() => setCurrentView('suggestions')}
            className="flex items-center gap-1.5 hover:text-white transition-colors text-gray-300 font-medium"
          >
            <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
            <span>Site Suggestions</span>
          </button>

          <button
            onClick={() => setCurrentView('letter')}
            className="flex items-center gap-1.5 hover:text-white transition-colors text-gray-300 font-medium"
          >
            <FileText className="w-3.5 h-3.5 text-purple-400" />
            <span>To Whom It May Concern</span>
          </button>
        </div>

        <div className="text-[11px] text-gray-500">&copy; {new Date().getFullYear()} University Residence </div>
      </div>
    </footer>
  );
}
