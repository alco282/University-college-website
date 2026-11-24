import React, { useMemo } from 'react';
import { Search, Filter, BookOpen, X } from 'lucide-react';
import { StudentCard } from './StudentCard';
import { STUDY_DISCIPLINES } from '../constants/studyDisciplines';


export function DirectoryView({
  students = [],
  searchTerm,
  setSearchTerm,
  filterBirthYear,
  setFilterBirthYear,
  filterSection,
  setFilterSection,
  filterCourseCluster,
  setFilterCourseCluster,
  filterAcademicYear,
  setFilterAcademicYear,
  filterContinent,
  setFilterContinent,
  filterCountry,
  setFilterCountry,
  filterResidentStatus,
  setFilterResidentStatus,
  filterRoleAdmin,
  setFilterRoleAdmin,
  onSelectStudent,
  currentUser
}) {
  const currentYear = new Date().getFullYear();

  const birthYearsList = useMemo(() => {
    const years = ['All'];
    for (let y = currentYear; y >= 1935; y--) {
      years.push(String(y));
    }
    return years;
  }, [currentYear]);

  const sectionsList = ['All', 'Residence_name_1','Residence_name_2','Residence_name_3'];
  const academicYearsList = ['All', '1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year', 'Master / Postgrad', 'PhD', 'Graduated'];
  const continentsList = ['All', 'Europe', 'North America', 'South America', 'Asia', 'Africa', 'Oceania'];

  const resetAllFilters = () => {
    setFilterBirthYear('All');
    setFilterSection('All');
    setFilterCourseCluster('All');
    setFilterAcademicYear('All');
    setFilterContinent('All');
    setFilterCountry('All');
    setFilterResidentStatus('All');
    setFilterRoleAdmin('All');
    setSearchTerm('');
  };

  const hasActiveFilters = 
    filterBirthYear !== 'All' ||
    filterSection !== 'All' ||
    filterCourseCluster !== 'All' ||
    filterAcademicYear !== 'All' ||
    filterContinent !== 'All' ||
    filterCountry !== 'All' ||
    filterResidentStatus !== 'All' ||
    filterRoleAdmin !== 'All' ||
    searchTerm.trim() !== '';

  return (
    <div className="space-y-6">
      {/* Search Bar */}
      <div className="relative max-w-3xl mx-auto">
        <div className="relative flex items-center bg-white rounded-full shadow-md border border-[#D5D3CC] overflow-hidden focus-within:border-[#B31217] focus-within:ring-2 focus-within:ring-[#B31217]/20 transition-all">
          <Search className="w-5 h-5 text-gray-400 ml-5 shrink-0" />
          <input
            type="text"
            placeholder="Search residents by Name, Degree Course, or City..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full py-3.5 px-4 text-gray-800 placeholder-gray-400 bg-transparent text-sm md:text-base focus:outline-none"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="mr-4 text-gray-400 hover:text-gray-600 focus:outline-none"
              aria-label="Clear search"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Filter Control Box */}
      <div className="bg-white rounded-3xl p-5 border border-[#D5D3CC] shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#B31217]" />
            <h3 className="font-['Oswald'] text-base font-bold uppercase tracking-wider text-gray-900">
              Filters & Attributes
            </h3>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetAllFilters}
              className="text-xs text-[#B31217] hover:underline font-bold"
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="text-[11px] font-bold text-gray-500 block mb-1">Residence</label>
            <select
              value={filterSection}
              onChange={(e) => setFilterSection(e.target.value)}
              className="w-full p-2 bg-[#FAF8F5] border border-gray-300 rounded-xl text-xs font-semibold text-gray-800 focus:outline-none focus:border-[#B31217]"
            >
              {sectionsList.map((sec) => (
                <option key={sec} value={sec}>{sec}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-gray-500 block mb-1">Discipline</label>
            <select
              value={filterCourseCluster}
              onChange={(e) => setFilterCourseCluster(e.target.value)}
              className="w-full p-2 bg-[#FAF8F5] border border-gray-300 rounded-xl text-xs font-semibold text-gray-800 truncate focus:outline-none focus:border-[#B31217]"
            >
              <option value="All">All Disciplines</option>
              {STUDY_DISCIPLINES.map((discipline) => (
                <option key={discipline} value={discipline}>{discipline}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-gray-500 block mb-1">Academic Year</label>
            <select
              value={filterAcademicYear}
              onChange={(e) => setFilterAcademicYear(e.target.value)}
              className="w-full p-2 bg-[#FAF8F5] border border-gray-300 rounded-xl text-xs font-semibold text-gray-800 focus:outline-none focus:border-[#B31217]"
            >
              {academicYearsList.map((yr) => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-gray-500 block mb-1">Birth Year</label>
            <select
              value={filterBirthYear}
              onChange={(e) => setFilterBirthYear(e.target.value)}
              className="w-full p-2 bg-[#FAF8F5] border border-gray-300 rounded-xl text-xs font-semibold text-gray-800 focus:outline-none focus:border-[#B31217]"
            >
              {birthYearsList.map((yr) => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-gray-500 block mb-1">Origin Continent</label>
            <select
              value={filterContinent}
              onChange={(e) => setFilterContinent(e.target.value)}
              className="w-full p-2 bg-[#FAF8F5] border border-gray-300 rounded-xl text-xs font-semibold text-gray-800 focus:outline-none focus:border-[#B31217]"
            >
              {continentsList.map((cnt) => (
                <option key={cnt} value={cnt}>{cnt}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-gray-500 block mb-1">Resident Status</label>
            <select
              value={filterResidentStatus}
              onChange={(e) => setFilterResidentStatus(e.target.value)}
              className="w-full p-2 bg-[#FAF8F5] border border-gray-300 rounded-xl text-xs font-semibold text-gray-800 focus:outline-none focus:border-[#B31217]"
            >
              <option value="All">All Statuses</option>
              <option value="In Residence">In Residence</option>
              <option value="Alumni">Alumni</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results Counter */}
      <div className="flex items-center justify-between text-xs text-gray-500 px-2 font-medium">
        <span>Showing <strong className="text-gray-900">{students.length}</strong> resident profile(s)</span>
      </div>

      {/* Grid Layout or Empty State */}
      {students.length === 0 ? (
        <div className="text-center py-16 bg-white/60 rounded-3xl border border-dashed border-[#D5D3CC]">
          <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-700">No matching residents found</h3>
          <p className="text-sm text-gray-500 mt-1">Try clearing or adjusting your active filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pt-2">
          {students.map((student) => (
            <StudentCard
              key={student.id}
              student={student}
              currentUser={currentUser}
              onClick={() => onSelectStudent(student.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}