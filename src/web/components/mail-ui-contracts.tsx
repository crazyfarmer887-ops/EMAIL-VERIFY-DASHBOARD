import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface RestrictedMailRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'aria-disabled' | 'tabIndex'> {
  restricted: boolean;
  onOpen: () => void;
  children: ReactNode;
}

export function RestrictedMailRow({
  restricted,
  onOpen,
  children,
  onClick,
  ...buttonProps
}: RestrictedMailRowProps) {
  return (
    <button
      {...buttonProps}
      type={buttonProps.type ?? 'button'}
      disabled={restricted}
      aria-disabled={restricted}
      tabIndex={restricted ? -1 : 0}
      onClick={event => {
        onClick?.(event);
        if (!event.defaultPrevented && !restricted) onOpen();
      }}
    >
      {children}
    </button>
  );
}

export function MailSearchFeedback({ count, hasQuery }: { count: number; hasQuery: boolean }) {
  return (
    <>
      <p role="status" aria-live="polite" aria-atomic="true" style={{ margin: '6px 2px 0', color: '#6B7280', fontSize: 11 }}>
        검색 결과 {count}개
      </p>
      {hasQuery && count === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#9CA3AF' }}>
          검색 조건에 맞는 별칭이 없어요
        </div>
      )}
    </>
  );
}
