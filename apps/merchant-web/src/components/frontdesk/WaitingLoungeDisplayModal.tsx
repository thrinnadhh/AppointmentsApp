'use client';

import React, { useState, useEffect } from 'react';
import { 
  X, 
  Tv, 
  Clock, 
  UserCheck, 
  Stethoscope, 
  Sparkles,
  Maximize2,
  Minimize2,
  Building2,
  CheckCircle2
} from 'lucide-react';

export interface DisplayQueueItem {
  id: string;
  tokenNumber: number;
  referenceCode: string;
  maskedName: string;
  doctorName: string;
  departmentName?: string;
  roomNumber?: string;
  status: 'IN_CONSULTATION' | 'UP_NEXT' | 'WAITING' | 'STANDBY';
  slotTime: string;
  estimatedWaitMinutes?: number;
}

interface WaitingLoungeDisplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  hospitalName?: string;
  queueItems: DisplayQueueItem[];
}

export default function WaitingLoungeDisplayModal({
  isOpen,
  onClose,
  hospitalName = 'Tirupati Multispecialty Hospital',
  queueItems,
}: WaitingLoungeDisplayModalProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!isOpen) return null;

  const inConsultationItems = queueItems.filter((q) => q.status === 'IN_CONSULTATION');
  const upNextItems = queueItems.filter((q) => q.status === 'UP_NEXT');
  const waitingItems = queueItems.filter((q) => q.status === 'WAITING' || q.status === 'STANDBY');

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col overflow-hidden animate-fadeIn select-none">
      {/* Top Bar for Waiting Lounge TV */}
      <header className="px-8 py-5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black text-xl shadow-lg">
            <Building2 className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
              {hospitalName}
              <span className="text-xs font-mono font-bold px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-widest">
                Live Waiting Lounge Queue
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Please watch your token number and proceed to the designated room when called.
            </p>
          </div>
        </div>

        {/* Live Clock & Controls */}
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-2xl font-black font-mono tracking-wider text-emerald-400">
              {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div className="text-xs text-slate-400 font-medium">
              {currentTime.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
              aria-label="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-rose-900/40 text-slate-300 hover:text-rose-400 transition cursor-pointer"
              aria-label="Close Kiosk Mode"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main TV Board Grid */}
      <main className="flex-1 p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 overflow-y-auto">
        {/* Left Column (5 cols): NOW SERVING & UP NEXT */}
        <div className="lg:col-span-5 space-y-6 flex flex-col">
          {/* NOW SERVING (In Consultation) */}
          <div className="bg-slate-900 border-2 border-emerald-500/40 rounded-3xl p-6 shadow-2xl relative overflow-hidden flex-1 flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <span className="text-xs font-black uppercase tracking-widest text-emerald-400 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" />
                Now Serving / In Consultation
              </span>
              <span className="text-xs font-mono text-slate-400">
                {inConsultationItems.length} active
              </span>
            </div>

            <div className="mt-4 flex-1 flex flex-col justify-center space-y-4">
              {inConsultationItems.length === 0 ? (
                <div className="text-center py-10 text-slate-500">
                  <Stethoscope className="w-12 h-12 mx-auto text-slate-700 mb-2" />
                  <p className="text-base font-bold text-slate-400">Doctor Preparing Consultation</p>
                  <p className="text-xs text-slate-500 mt-1">Next patient will be called shortly.</p>
                </div>
              ) : (
                inConsultationItems.map((item) => (
                  <div 
                    key={item.id}
                    className="p-5 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="text-4xl sm:text-5xl font-black font-mono text-emerald-400 tracking-tight">
                        Token #{item.tokenNumber}
                      </div>
                      <div className="text-lg font-bold text-white mt-1">
                        {item.maskedName}
                      </div>
                      <div className="text-xs text-emerald-300/80 mt-0.5">
                        {item.doctorName} {item.departmentName ? `• ${item.departmentName}` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="px-3.5 py-1.5 rounded-xl bg-emerald-500 text-slate-950 text-sm font-black tracking-wider uppercase">
                        {item.roomNumber || 'Room 204'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* UP NEXT (Please be ready) */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <span className="text-xs font-black uppercase tracking-widest text-amber-400 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                Up Next • Please Be Ready
              </span>
              <span className="text-xs font-mono text-slate-400">
                {upNextItems.length} patient
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {upNextItems.length === 0 ? (
                <p className="text-xs text-slate-500 py-3">Queue dispatcher computing next turn...</p>
              ) : (
                upNextItems.map((item) => (
                  <div 
                    key={item.id}
                    className="p-4 rounded-xl bg-slate-800/80 border border-amber-500/30 flex items-center justify-between"
                  >
                    <div>
                      <span className="text-2xl font-black font-mono text-amber-300">
                        Token #{item.tokenNumber}
                      </span>
                      <p className="text-sm font-bold text-slate-200 mt-0.5">
                        {item.maskedName}
                      </p>
                      <p className="text-xs text-slate-400">
                        {item.doctorName}
                      </p>
                    </div>
                    <span className="text-xs font-bold text-amber-400 bg-amber-950/60 border border-amber-500/40 px-3 py-1 rounded-lg">
                      Ready at Door
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column (7 cols): WAITING LOUNGE ROSTER */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <h2 className="text-base font-black uppercase tracking-widest text-slate-200 flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-emerald-400" />
                Waiting Queue Sequence
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Estimated wait times update dynamically upon consultation progress.
              </p>
            </div>
            <span className="text-xs font-mono font-bold px-3 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              {waitingItems.length} Waiting
            </span>
          </div>

          <div className="mt-4 flex-1 overflow-y-auto space-y-2.5 pr-1">
            {waitingItems.length === 0 ? (
              <div className="py-20 text-center text-slate-500">
                <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-600/40 mb-2" />
                <p className="text-base font-bold text-slate-400">All Waiting Patients Attended</p>
                <p className="text-xs text-slate-500 mt-1">Lounge queue is clear.</p>
              </div>
            ) : (
              waitingItems.map((item, idx) => (
                <div 
                  key={item.id}
                  className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/80 hover:border-slate-600 transition flex items-center justify-between"
                >
                  <div className="flex items-center gap-4">
                    <span className="w-8 h-8 rounded-lg bg-slate-800 text-slate-400 font-mono font-bold text-xs flex items-center justify-center">
                      #{idx + 1}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xl font-black font-mono text-emerald-400">
                          Token #{item.tokenNumber}
                        </span>
                        <span className="text-sm font-bold text-slate-200">
                          {item.maskedName}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {item.doctorName} • Slot {item.slotTime}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    {item.status === 'STANDBY' ? (
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                        Standby Gap Fill
                      </span>
                    ) : (
                      <div className="text-xs font-mono text-slate-400">
                        Wait: <strong className="text-white">~{item.estimatedWaitMinutes || (idx + 1) * 15}m</strong>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>

      {/* Footer ticker */}
      <footer className="px-8 py-3 bg-slate-900 border-t border-slate-800 text-xs text-slate-500 flex items-center justify-between">
        <span>Emergency &amp; triage cases are prioritized by clinical need.</span>
        <span>Confidential Healthcare Queue Display • No Medical Data Broadcasted</span>
      </footer>
    </div>
  );
}
