
import React from 'react';

interface BadgeProps {
  type?: 'Urgent' | 'Alert' | 'Info' | 'default';
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({ type = 'default', children }) => {
  const styles = {
    Urgent: 'bg-rose-500/80 text-white border-rose-400/30 shadow-sm shadow-rose-500/10 backdrop-blur-sm',
    Alert: 'bg-amber-500/80 text-white border-amber-400/30 shadow-sm shadow-amber-500/10 backdrop-blur-sm',
    Info: 'bg-sky-500/80 text-white border-sky-400/30 shadow-sm shadow-sky-500/10 backdrop-blur-sm',
    default: 'bg-slate-500/70 text-white border-white/10 shadow-sm backdrop-blur-sm'
  };

  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border ${styles[type]}`}>
      {children}
    </span>
  );
};
