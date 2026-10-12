import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './ui.module.css';

export function ActionLink({href,children,secondary=false}:{href:string;children:ReactNode;secondary?:boolean}) {
  return <Link className={`${styles.button} ${secondary?styles.secondary:''}`} href={href}>{children}</Link>;
}
export function ActionButton({children,secondary=false,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{secondary?:boolean}) {
  return <button {...props} className={`${styles.button} ${secondary?styles.secondary:''} ${props.className??''}`}>{children}</button>;
}
export function Card({children}:{children:ReactNode}) {return <article className={styles.card}>{children}</article>;}
export function Badge({children}:{children:ReactNode}) {return <span className={styles.badge}>{children}</span>;}
export function EmptyState({title,body,children}:{title:string;body:string;children?:ReactNode}) {
  return <section className={styles.state} aria-live="polite"><h2>{title}</h2><p>{body}</p>{children}</section>;
}
export function LoadingCards({label}:{label:string}) {
  return <div role="status" aria-label={label}><div className={styles.skeleton} aria-hidden="true"/><p>{label}</p></div>;
}
