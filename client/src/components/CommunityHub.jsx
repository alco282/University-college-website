import React from 'react';
import { Home } from 'lucide-react';

import { ResidenceLifeHub } from './ResidenceLifeHub';
import {
  VirtualStudyRoomsView,
  AnnualTimeCapsuleView,
  TheWorldOfAcademicsView,
  SocialKitchenView,
  ResidenceJukeboxView,
  MatchFinderView,
  CitySurvivalGuideView,
  LanguageTandemView,
  PassionClubsView,
  BookMarketplaceView,
  FreeboxView,
  CommunityStartUpView
} from './LegacyCommunityViews';

const COMMUNITY_VIEWS = {
  study_rooms: VirtualStudyRoomsView,
  time_capsule: AnnualTimeCapsuleView,
  academics_map: TheWorldOfAcademicsView,
  social_kitchen: SocialKitchenView,
  jukebox: ResidenceJukeboxView,
  match_finder: MatchFinderView,
  city_guide: CitySurvivalGuideView,
  tandem: LanguageTandemView,
  passion_clubs: PassionClubsView,
  marketplace: BookMarketplaceView,
  freebox: FreeboxView,
  startup: CommunityStartUpView
};

export function CommunityHub({
  currentView,
  currentUser,
  showToast,
  setCurrentView,
  students = [],
  leafletReady = false,
  onSelectStudent
}) {
  if (currentView === 'community') {
    return <ResidenceLifeHub setCurrentView={setCurrentView} />;
  }

  const View = COMMUNITY_VIEWS[currentView];
  if (!View) {
    return (
      <div className="max-w-4xl mx-auto bg-white rounded-3xl p-10 border border-[#D5D3CC] text-center">
        <Home className="w-10 h-10 text-[#B31217] mx-auto mb-3" />
        <h2 className="font-['Oswald'] text-2xl font-bold uppercase text-gray-900">Residence Life</h2>
        <p className="text-xs text-gray-500 mt-2">Sezione non disponibile.</p>
      </div>
    );
  }

  const backTarget = new Set(['study_rooms','academics_map','marketplace']).has(currentView) ? 'campus' : 'community';
  const sharedProps = { currentUser, showToast, onSelectStudent, onBack: () => setCurrentView(backTarget) };

  return (
    <div className="animate-fadeIn">
      <View
        {...sharedProps}
        {...(currentView === 'academics_map' ? { students, leafletReady } : {})}
      />
    </div>
  );
}
