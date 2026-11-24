import React from 'react';
import { Utensils, Music, Flame, Compass, Languages, Users, Package, Clock, Rocket } from 'lucide-react';

export function ResidenceLifeHub({ setCurrentView }) {
  const items = [
    {
      id: 'social_kitchen',
      title: 'Social Kitchen & Cookbook',
      desc: 'Discover and share traditional recipes cooked on our floors, with photos and steps.',
      icon: Utensils,
      color: 'border-amber-500'
    },
    {
      id: 'jukebox',
      title: 'Residence Jukebox',
      desc: 'The shared soundtrack: add your Spotify tracks and vote for everyone else\'s.',
      icon: Music,
      color: 'border-rose-500'
    },
    {
      id: 'match_finder',
      title: 'Match Finder',
      desc: 'Organize 5-a-side football, chess, table tennis, and quick games in the courts and common rooms.',
      icon: Flame,
      color: 'border-orange-500'
    },
    {
      id: 'city_guide',
      title: 'City Survival Guide',
      desc: 'Places recommended by residents: budget pizzerias, bars with power outlets, and bike workshops.',
      icon: Compass,
      color: 'border-teal-500'
    },
    {
      id: 'tandem',
      title: 'Language Tandem',
      desc: 'Practice languages with Italian and international residents over coffee.',
      icon: Languages,
      color: 'border-blue-500'
    },
    {
      id: 'passion_clubs',
      title: 'Passion Clubs',
      desc: 'The College\'s permanent circles: film club, reading groups, music, and chess.',
      icon: Users,
      color: 'border-purple-500'
    },
    {
      id: 'freebox',
      title: 'Freebox',
      desc: 'Residents leaving the College make furniture and dishware freely available to incoming students.',
      icon: Package,
      color: 'border-emerald-500'
    },
    {
      id: 'time_capsule',
      title: 'Section Time Capsule',
      desc: "Preserve memories and anecdotes from the current year: it opens in 3 years.",
      icon: Clock,
      color: 'border-indigo-500'
    },
    {
      id: 'startup',
      title: 'Community StartUp',
      desc: 'Projects born from residents: apply as a co-founder or launch your own idea.',
      icon: Rocket,
      color: 'border-violet-600'
    }
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="bg-white rounded-3xl p-6 border border-[#D5D3CC] shadow-sm">
        <h2 className="font-['Oswald'] text-3xl font-bold uppercase tracking-wider text-gray-900">
          Residence Life Board
        </h2>
        <p className="text-xs text-gray-600 font-serif italic mt-1">
          The central hub for activities, relaxation, clubs, and shared memories across sections.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map(it => {
          const Icon = it.icon;
          return (
            <div
              key={it.id}
              onClick={() => setCurrentView(it.id)}
              className={`bg-white rounded-3xl p-5 border-2 ${it.color} shadow-sm hover:shadow-xl transition-all cursor-pointer flex flex-col justify-between group transform hover:-translate-y-1`}
            >
              <div className="flex items-start gap-3.5">
                <div className="p-3 bg-gray-50 rounded-2xl group-hover:bg-[#B31217] group-hover:text-white transition-colors text-[#B31217] shrink-0">
                  <Icon className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-['Oswald'] text-lg uppercase font-bold text-gray-900 group-hover:text-[#B31217] transition-colors">
                    {it.title}
                  </h3>
                  <p className="text-xs text-gray-600 font-serif mt-1 leading-relaxed line-clamp-3">{it.desc}</p>
                </div>
              </div>
              <div className="mt-4 pt-2.5 border-t flex justify-end">
                <span className="text-[11px] font-bold text-[#B31217] flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                  Open →
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
