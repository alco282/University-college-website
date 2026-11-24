import React from 'react';
import { BookOpen, Globe, ShoppingBag } from 'lucide-react';

export function CampusStudioHub({ setCurrentView }) {
  const items = [
    {
      id: 'study_rooms',
      title: 'Virtual Study Rooms',
      desc: 'Share lesson links, cloud notes, and prepare for exams with your coursemates.',
      icon: BookOpen,
      color: 'border-blue-500'
    },
    {
      id: 'academics_map',
      title: 'The World of Academics',
      desc: 'Interactive Globe-style map of Erasmus experiences and advice on universities and cities worldwide.',
      icon: Globe,
      color: 'border-indigo-500'
    },
    {
      id: 'marketplace',
      title: 'Book & Notes Marketplace',
      desc: 'Buy, sell, or give away university textbooks and notes directly within the residence.',
      icon: ShoppingBag,
      color: 'border-emerald-500'
    }
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="bg-white rounded-3xl p-6 border border-[#D5D3CC] shadow-sm">
        <h2 className="font-['Oswald'] text-3xl font-bold uppercase tracking-wider text-gray-900">
          Campus & Study Board
        </h2>
        <p className="text-xs text-gray-600 font-serif italic mt-1">
          The space dedicated to academic life, exams, Erasmus, and sharing lecture notes.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {items.map(it => {
          const Icon = it.icon;
          return (
            <div
              key={it.id}
              onClick={() => setCurrentView(it.id)}
              className={`bg-white rounded-3xl p-6 border-2 ${it.color} shadow-sm hover:shadow-xl transition-all cursor-pointer flex flex-col justify-between group transform hover:-translate-y-1`}
            >
              <div className="flex items-start gap-4">
                <div className="p-3.5 bg-gray-50 rounded-2xl group-hover:bg-[#B31217] group-hover:text-white transition-colors text-[#B31217]">
                  <Icon className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="font-['Oswald'] text-xl uppercase font-bold text-gray-900 group-hover:text-[#B31217] transition-colors">
                    {it.title}
                  </h3>
                  <p className="text-xs text-gray-600 font-serif mt-1 leading-relaxed">{it.desc}</p>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t flex justify-end">
                <span className="text-xs font-bold text-[#B31217] flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                  Enter the section →
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
