import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface PanelProps {
  id?: string;
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  task?: string; // e.g. "Task 6" - ties the panel to the lab brief
}

/** Glass section with a heading; fades up once when scrolled into view. */
export function Panel({ id, title, subtitle, icon, actions, children, className = "", task }: PanelProps) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={`glass scroll-mt-28 p-4 sm:p-6 ${className}`}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-aqua">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold text-ink">
              {title}
              {task && <span className="chip py-0.5 text-[10px] uppercase tracking-wider">{task}</span>}
            </h2>
            {subtitle && <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </motion.section>
  );
}
